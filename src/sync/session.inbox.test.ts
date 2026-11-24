// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from './api'
import { syncOnce } from './engine'
import { takePosts } from './inbox'
import { Session } from './session'
import type { SyncStatus } from './status'

/** The inbox's part of a look (sync/session): asked for only when the server says posts wait, after the documents and the files, and never the reason sync fails. */

vi.mock('./engine', () => ({ syncOnce: vi.fn(), expireHistory: vi.fn(async () => {}), resetSyncState: vi.fn(), SyncReset: class SyncReset extends Error {} }))
vi.mock('./files', () => ({ syncFiles: vi.fn(async () => ({ full: false, more: false })), fetchFile: vi.fn(), nameFiles: vi.fn(async () => 0) }))
vi.mock('../lib/originals', () => ({ fetchOriginalsWith: vi.fn() }))
vi.mock('./inbox', () => ({ takePosts: vi.fn() }))
const server = vi.hoisted(() => ({ waiting: 0 as number | undefined, asked: 0 }))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  httpApi: () => ({
    changes: async () => {
      server.asked += 1
      return { records: [], seq: 0, more: false, ...(server.waiting === undefined ? {} : { inbox: server.waiting }) }
    },
  }),
}))

const nothing = { changed: [], full: false, tooLarge: 0, copies: 0, moved: new Map(), clean: false }
const KEYS = { libraryId: 'a-library' } as never

describe('a look, and the library’s inbox', () => {
  let said: SyncStatus[]
  let session: Session
  let folder: string | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    said = []
    folder = undefined
    server.waiting = undefined
    server.asked = 0
    // The documents' part asks the server for changes, as the engine does.
    vi.mocked(syncOnce).mockImplementation(async (_keys, api: Api) => (await api.changes(0), nothing))
    vi.mocked(takePosts).mockResolvedValue(0)
    session = new Session(KEYS, { onStatus: (status) => said.push(status), onApplied: () => {}, receipt: () => undefined, manual: () => false, postsFolder: () => folder })
  })

  afterEach(() => {
    session.stop()
    vi.mocked(syncOnce).mockReset()
    vi.mocked(takePosts).mockReset()
    vi.useRealTimers()
  })

  it('asks for nothing of the inbox while the server says no posts wait', async () => {
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(server.asked).toBe(1)
    expect(takePosts).not.toHaveBeenCalled()
    expect(said.at(-1)).toMatchObject({ state: 'synced' })
  })

  it('takes posts in when the server says some wait, into the folder for what’s new as it is then', async () => {
    server.waiting = 2
    folder = 'Harbour'
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(takePosts).toHaveBeenCalledTimes(1)
    expect(vi.mocked(takePosts).mock.calls[0][0]).toBe(KEYS)
    expect(vi.mocked(takePosts).mock.calls[0][2]).toBe('Harbour')
    // None made: no second look for them.
    expect(vi.mocked(syncOnce)).toHaveBeenCalledTimes(1)
    // And through the same server the look itself asks.
    await vi.mocked(takePosts).mock.calls[0][1].changes(0)
    expect(server.asked).toBe(2)
  })

  it('looks again at once when notes were made, so they’re sent; and not when none were', async () => {
    server.waiting = 1
    vi.mocked(takePosts).mockImplementationOnce(async () => ((server.waiting = undefined), 1))
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.mocked(syncOnce)).toHaveBeenCalledTimes(2)
    expect(takePosts).toHaveBeenCalledTimes(1)
    // Nothing waiting any more, and nothing made: as ever from here.
    await vi.advanceTimersByTimeAsync(1000)
    expect(vi.mocked(syncOnce)).toHaveBeenCalledTimes(2)
  })

  it('stops asking once the server says none wait', async () => {
    server.waiting = 3
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(takePosts).toHaveBeenCalledTimes(1)
    server.waiting = undefined
    session.run()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.mocked(syncOnce)).toHaveBeenCalledTimes(2)
    expect(takePosts).toHaveBeenCalledTimes(1)
  })

  it('is never the reason sync shows as failing: said in the log, and tried at the next look', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    server.waiting = 1
    vi.mocked(takePosts).mockRejectedValueOnce(new Error('the inbox is out of reach'))
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(said.at(-1)).toMatchObject({ state: 'synced' })
    expect(said.at(-1)!.message).toBeUndefined()
    expect(warned).toHaveBeenCalledWith('Nib: could not take in the inbox', expect.any(Error))
    expect(vi.mocked(syncOnce)).toHaveBeenCalledTimes(1)
    session.run()
    await vi.advanceTimersByTimeAsync(0)
    expect(takePosts).toHaveBeenCalledTimes(2)
    warned.mockRestore()
  })

  it('takes nothing in by itself while this device syncs only when asked', async () => {
    session.stop()
    server.waiting = 1
    session = new Session(KEYS, { onStatus: (status) => said.push(status), onApplied: () => {}, receipt: () => undefined, manual: () => true })
    session.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(takePosts).not.toHaveBeenCalled()
    session.run()
    await vi.advanceTimersByTimeAsync(0)
    expect(takePosts).toHaveBeenCalledTimes(1)
  })
})
