// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncOnce } from './engine'
import { fetchFile, syncFiles } from './files'
import { Session } from './session'
import type { SyncStatus } from './status'
import { fetchOriginalsWith } from '../lib/originals'

/** The files' part of a look (sync/session): after the documents, never the reason sync fails, and how an original is fetched while sync runs. */

vi.mock('./engine', () => ({ syncOnce: vi.fn(), expireHistory: vi.fn(async () => {}), resetSyncState: vi.fn(), SyncReset: class SyncReset extends Error {} }))
vi.mock('./files', () => ({ syncFiles: vi.fn(), fetchFile: vi.fn() }))
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
    vi.mocked(syncFiles).mockReset()
    vi.mocked(fetchFile).mockReset()
    vi.mocked(fetchOriginalsWith).mockReset()
    vi.useRealTimers()
  })

  it('sends the files after the documents that name them', async () => {
    session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['documents', 'files'])
    expect(vi.mocked(syncFiles).mock.calls[0][0]).toBe(KEYS)
    expect(said.at(-1)).toMatchObject({ state: 'synced' })
    expect(said.at(-1)!.message).toBeUndefined()
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
