// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncHttpError } from './api'
import { expireHistory, syncOnce } from './engine'
import { fetchFile, nameFiles, syncFiles } from './files'
import { Session } from './session'
import type { SyncStatus } from './status'
import { fetchOriginalsWith } from '../lib/originals'

/** The files' part of a look (sync/session): after the documents, never the reason sync fails, and how an original is fetched while sync runs. */

vi.mock('./engine', () => ({ syncOnce: vi.fn(), expireHistory: vi.fn(async () => {}), resetSyncState: vi.fn(), SyncReset: class SyncReset extends Error {} }))
vi.mock('./files', () => ({ syncFiles: vi.fn(), fetchFile: vi.fn(), nameFiles: vi.fn(async () => 0) }))
vi.mock('../lib/originals', () => ({ fetchOriginalsWith: vi.fn() }))

const nothing = { changed: [], full: false, tooLarge: 0, copies: 0, moved: new Map(), clean: false }
const KEYS = { libraryId: 'a-library' } as never

describe('a look, and the library’s files', () => {
  let said: SyncStatus[]
  let order: string[]
  let session: Session

  beforeEach(() => {
    vi.useFakeTimers()
    said = []
    order = []
    vi.mocked(syncOnce).mockImplementation(async () => (order.push('documents'), nothing))
    vi.mocked(syncFiles).mockImplementation(async () => (order.push('files'), { full: false, more: false }))
    session = new Session(KEYS, { onStatus: (status) => said.push(status), onApplied: () => {}, receipt: () => undefined, manual: () => false })
  })

  afterEach(() => {
    session.stop()
    vi.mocked(syncOnce).mockReset()
    vi.mocked(expireHistory).mockClear()
    vi.mocked(syncFiles).mockReset()
    vi.mocked(nameFiles).mockReset().mockImplementation(async () => 0)
    vi.mocked(fetchFile).mockReset()
    vi.mocked(fetchOriginalsWith).mockReset()
    vi.useRealTimers()
  })

  // Past versions are kept on the server for 90 days, and then a device asks it to let go of them (engine
  // `expireHistory`): but only after a look that went well, and a lapsed library's never does, so they stayed till
  // the library itself was deleted, a year and more on (the server audit of 2026-11-23).
  it('still asks the server to let go of old history when Plus has lapsed, and says sync has stopped as before', async () => {
    vi.mocked(syncOnce).mockRejectedValue(new SyncHttpError(402, 'Nib Plus is not active for this library.'))
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(expireHistory).toHaveBeenCalledTimes(1)
    expect(said.at(-1)).toMatchObject({ state: 'inactive' })
    expect(order).toEqual([])
  })

  it('doesn’t ask it when a look fails any other way', async () => {
    vi.mocked(syncOnce).mockRejectedValue(new SyncHttpError(500, 'Sync failed (500)'))
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(expireHistory).not.toHaveBeenCalled()
  })

  it('sends the files after the documents that name them', async () => {
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['documents', 'files'])
    expect(vi.mocked(syncFiles).mock.calls[0][0]).toBe(KEYS)
    expect(said.at(-1)).toMatchObject({ state: 'synced' })
    expect(said.at(-1)!.message).toBeUndefined()
  })

  // Which files this device's documents use, said to the server (sync/files `nameFiles`): once what's new is fetched
  // and what's waiting is sent, so it's said of everything this device has.
  it('says which files are used after the documents and the files, and looks again at once if any were found lost', async () => {
    vi.mocked(nameFiles).mockImplementationOnce(async () => (order.push('named'), 2))
    session.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(order).toEqual(['documents', 'files', 'named', 'documents', 'files'])
    expect(vi.mocked(nameFiles).mock.calls[0][0]).toBe(KEYS)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(order).toHaveLength(5)
  })

  // Within the look, it read every document and every past version while sync showed as syncing, and no other look
  // could start till it had: what was just written waited with it (found checking step 4, 2026-11-23).
  it('says it beside the look: the look ends, and others run, while it’s still being said; and it isn’t said twice at once', async () => {
    let done!: (lost: number) => void
    vi.mocked(nameFiles).mockImplementation(() => (order.push('named'), new Promise<number>((resolve) => (done = resolve))))
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(said.at(-1)).toMatchObject({ state: 'synced' })
    session.run()
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['documents', 'files', 'named', 'documents', 'files'])
    // Done, with one lost: a look for it; and the next look says it again (sync/files keeps it to once a day).
    done(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['documents', 'files', 'named', 'documents', 'files', 'documents', 'files', 'named'])
  })

  it('makes no look for a lost file once sync is stopped', async () => {
    let done!: (lost: number) => void
    vi.mocked(nameFiles).mockImplementation(() => new Promise<number>((resolve) => (done = resolve)))
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    session.stop()
    done(3)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(order).toEqual(['documents', 'files'])
  })

  it('doesn’t begin to say it once sync is stopped', async () => {
    vi.mocked(syncFiles).mockImplementation(async () => (session.stop(), { full: false, more: false }))
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(nameFiles).not.toHaveBeenCalled()
  })

  // Its requests are its own: a look ended as Nib comes back doesn't end them. And one with no answer is ended in
  // a minute: never answered, as when WebKit's networking is lost under Nib, it left this under way for good, and
  // nothing was said again till Nib was opened afresh (found checking step 4 again, 2026-11-23).
  it('says it by requests of its own, each ended after a minute with no answer, and says it again at a later look', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const asked: AbortSignal[] = []
    vi.stubGlobal('fetch', (_path: string, init: RequestInit) => {
      asked.push(init.signal!)
      return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
    })
    vi.mocked(nameFiles).mockImplementation(async (_keys, api) => (await api.files()).files.length)
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.mocked(nameFiles).mock.calls[0][1]).not.toBe(vi.mocked(syncFiles).mock.calls[0][1])
    // Looks go on meanwhile, and none says it again while it's under way; nor does putting Nib away end it.
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(59_000)
    expect(vi.mocked(syncFiles).mock.calls.length).toBeGreaterThan(1)
    expect(nameFiles).toHaveBeenCalledTimes(1)
    expect(asked).toHaveLength(1)
    expect(asked[0].aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(asked[0].aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(vi.mocked(nameFiles).mock.calls.length).toBeGreaterThan(1)
    expect(said.at(-1)).toMatchObject({ state: 'synced' })
    vi.unstubAllGlobals()
    warned.mockRestore()
  })

  it('is synced all the same when that can’t be said: a server from before it listened, say', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(nameFiles).mockRejectedValueOnce(new SyncHttpError(404, 'Not found.'))
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(said.at(-1)).toMatchObject({ state: 'synced' })
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('which files are used'), expect.anything())
    warned.mockRestore()
  })

  it('looks again at once while more files wait, and then as ever', async () => {
    vi.mocked(syncFiles)
      .mockImplementationOnce(async () => (order.push('files'), { full: false, more: true }))
      .mockImplementationOnce(async () => (order.push('files'), { full: false, more: true }))
    session.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(order).toEqual(['documents', 'files', 'documents', 'files', 'documents', 'files'])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(order).toHaveLength(6)
  })

  it('says when there’s no more room for full-quality pictures, with the documents synced all the same', async () => {
    vi.mocked(syncFiles).mockResolvedValue({ full: true, more: false })
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(said.at(-1)).toMatchObject({ state: 'synced', message: 'The room for full-quality pictures and attachments on the server is full. New ones stay on this device.' })
  })

  it('is synced all the same when the files can’t be: a server from before it kept any, say', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(syncFiles).mockRejectedValue(new Error('Not found.'))
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(said.at(-1)).toMatchObject({ state: 'synced' })
    expect(said.at(-1)!.message).toBeUndefined()
    warned.mockRestore()
  })

  it('fetches an original that’s wanted while it runs, a failure being none; and no longer once it stops', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    session.start()
    const [fetch] = vi.mocked(fetchOriginalsWith).mock.calls[0] as [(full: unknown) => Promise<boolean>]
    const full = { id: 'an-id', type: 'image/png', size: 5 }
    vi.mocked(fetchFile).mockResolvedValueOnce(true)
    expect(await fetch(full)).toBe(true)
    expect(vi.mocked(fetchFile).mock.calls[0][0]).toBe(KEYS)
    expect(vi.mocked(fetchFile).mock.calls[0][2]).toBe(full)
    vi.mocked(fetchFile).mockRejectedValueOnce(new TypeError('Load failed'))
    expect(await fetch(full)).toBe(false)
    session.stop()
    expect(vi.mocked(fetchOriginalsWith).mock.calls.at(-1)).toEqual([null, fetch])
    warned.mockRestore()
  })
})
