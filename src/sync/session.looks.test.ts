// @vitest-environment jsdom
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { syncOnce } from './engine'
import { Session } from './session'

/** When a session looks (sync/session), and when it tells the engine the documents here haven't changed since they were all sent. */

vi.mock('./engine', () => ({ syncOnce: vi.fn(), expireHistory: vi.fn(async () => {}), resetSyncState: vi.fn(), SyncReset: class SyncReset extends Error {} }))
vi.mock('./files', () => ({ syncFiles: vi.fn(async () => ({ full: false, more: false })), fetchFile: vi.fn() }))
vi.mock('../lib/originals', () => ({ fetchOriginalsWith: vi.fn() }))

const sentAll = { changed: [], full: false, tooLarge: 0, copies: 0, moved: new Map(), clean: true }
const KEYS = { libraryId: 'a-library' } as never

describe('a session’s looks', () => {
  let session: Session
  const looks = () => vi.mocked(syncOnce).mock.calls.length
  /** Whether the latest look was told the documents are unchanged. */
  const unchanged = () => vi.mocked(syncOnce).mock.calls.at(-1)![3]
  const settle = () => vi.advanceTimersByTimeAsync(1000)
  /** Back online: a look at once. */
  const look = async () => {
    window.dispatchEvent(new Event('online'))
    await settle()
  }
  const write = () => Dexie.on.storagemutated.fire({ [`idb://${db.name}/items/`]: true } as never)

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(syncOnce).mockResolvedValue(sentAll)
    session = new Session(KEYS, { onStatus: () => {}, onApplied: () => {}, receipt: () => undefined, manual: () => false })
    session.start()
    await settle()
  })
  afterEach(() => {
    session.stop()
    vi.mocked(syncOnce).mockReset()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('come once as Nib comes back, though it’s shown and then focused', async () => {
    await vi.advanceTimersByTimeAsync(10_000)
    expect(looks()).toBe(1)
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(looks()).toBe(2)
  })

  it('come at once when it’s back online, however lately it looked', async () => {
    await look()
    expect(looks()).toBe(2)
  })

  it('read the documents the first time, and not again till something’s written here', async () => {
    expect(unchanged()).toBe(false)
    await look()
    expect(unchanged()).toBe(true)
    write()
    await look()
    expect(unchanged()).toBe(false)
    await look()
    expect(unchanged()).toBe(true)
  })

  it('read them again after a look that left something unsent', async () => {
    vi.mocked(syncOnce).mockResolvedValueOnce({ ...sentAll, clean: false })
    await look()
    await look()
    expect(unchanged()).toBe(false)
  })

  it('read them again after a look that failed', async () => {
    await look()
    vi.mocked(syncOnce).mockRejectedValueOnce(new Error('offline'))
    await look()
    expect(unchanged()).toBe(true)
    await look()
    expect(unchanged()).toBe(false)
  })

  const shown = (visibility: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value: visibility, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }
  afterEach(() => shown('visible'))
  const answered = (status: number, body: unknown) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body })
  /** A look that asks the server for changes, as the engine's does first. */
  const asking = () => vi.mocked(syncOnce).mockImplementation(async (_keys, api) => (await api.changes(0), sentAll))

  // Put away with a look in flight, Nib is stopped where it stands, and the request with it: back, it may never be
  // answered, and every look after waited behind it.
  it('end one left in flight while Nib was away a minute or more, and look afresh, with no word of being offline', async () => {
    const said: string[] = []
    const away = new Session(KEYS, { onStatus: (status) => said.push(status.state), onApplied: () => {}, receipt: () => undefined, manual: () => false })
    const signals: AbortSignal[] = []
    const fetched = vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal!)
      // The first is never answered; ended, it fails as a fetch does.
      if (signals.length > 1) return Promise.resolve(answered(200, { records: [], seq: 0, more: false }))
      return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError'))))
    })
    vi.stubGlobal('fetch', fetched)
    asking()
    session.stop()
    away.start()
    // A request is signed off the timers' clock: waited for as it is.
    await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(1))
    shown('hidden')
    await vi.advanceTimersByTimeAsync(61_000)
    shown('visible')
    await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(2))
    expect(signals[0].aborted).toBe(true)
    await vi.waitFor(() => expect(said.at(-1)).toBe('synced'))
    expect(said).not.toContain('offline')
    away.stop()
    vi.unstubAllGlobals()
  })

  it('leave one in flight to finish when Nib was away only a moment', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => (signals.push(init.signal!), new Promise(() => {})))
    asking()
    await look()
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    shown('hidden')
    await vi.advanceTimersByTimeAsync(5000)
    shown('visible')
    await settle()
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)
    vi.unstubAllGlobals()
  })

  // Refused (too many libraries on the receipt, a refund), every look stopped there: nothing synced, though the library was still paid for.
  it('go on though this device’s receipt is refused, and say what the look itself finds', async () => {
    const said: string[] = []
    const refused = new Session(KEYS, { onStatus: (status) => said.push(status.state), onApplied: () => {}, receipt: () => 'a-receipt', manual: () => false })
    vi.stubGlobal('fetch', async (url: string) => (url.endsWith('/v1/entitlement') ? answered(403, { error: 'This receipt is on five libraries already.' }) : answered(200, {})))
    session.stop()
    const before = looks()
    refused.start()
    await vi.waitFor(() => expect(looks()).toBe(before + 1))
    await vi.waitFor(() => expect(said.at(-1)).toBe('synced'))
    refused.stop()
    vi.unstubAllGlobals()
  })

  it('read them again after the library has been changed under it', async () => {
    await look()
    await session.hold(async () => {})
    await settle()
    await look()
    expect(unchanged()).toBe(false)
  })
})
