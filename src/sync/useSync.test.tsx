// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'

/**
 * Sync only when I ask, as the app holds it (useSync): kept on this device,
 * told to the running session, and taken up again when it's turned off. The
 * session itself is sync/index.test; here it's stood in for.
 */
const made = vi.hoisted(() => ({ sessions: [] as { manual: () => boolean; run: ReturnType<typeof import('vitest').vi.fn>; nudge: ReturnType<typeof import('vitest').vi.fn>; onStatus: (status: { state: string }) => void }[], nudgedWhile: [] as boolean[], order: [] as string[] }))
vi.mock('./session', () => ({
  Session: class {
    run = vi.fn(() => void made.order.push('look'))
    hold = vi.fn(async (work: () => Promise<unknown>) => {
      made.order.push('held')
      await work()
      made.order.push('let go')
    })
    // What the switch said at the moment of each nudge: a real session looks only if it says "by itself".
    nudge = vi.fn(() => void made.nudgedWhile.push(this.manual()))
    manual: () => boolean
    onStatus: (status: { state: string }) => void
    constructor(_keys: unknown, handlers: { manual: () => boolean; onStatus: (status: { state: string }) => void }) {
      this.manual = handlers.manual
      this.onStatus = handlers.onStatus
      made.sessions.push(this)
    }
    start() {}
    stop() {
      made.order.push('stopped')
    }
  },
}))
const kept = vi.hoisted(() => ({ code: '0123-4567-89AB-CDEF-GHJK-MNPQ' as string | null }))
vi.mock('./codeStore', () => ({ codeStore: { get: async () => kept.code, set: async () => {}, clear: async () => {} } }))
vi.mock('./crypto', () => ({ deriveKeys: async () => ({}), newCode: () => '' }))
vi.mock('./engine', () => ({ resetSyncState: vi.fn(async () => void made.order.push('forgotten')) }))

const { useSync } = await import('./index')
const plus = { active: false } as never
const running = async () => {
  const hook = renderHook(() => useSync(plus, () => {}))
  await waitFor(() => expect(made.sessions).toHaveLength(1))
  return hook
}

beforeEach(() => {
  localStorage.clear()
  made.sessions.length = 0
  made.nudgedWhile.length = 0
  made.order.length = 0
})
afterEach(cleanup)

describe('sync only when I ask, on this device', () => {
  it('is off as Nib comes, and the session is told so', async () => {
    const { result } = await running()
    expect(result.current.manual).toBe(false)
    expect(made.sessions[0].manual()).toBe(false)
  })

  it('is told to the running session at once, and kept for the next time Nib opens', async () => {
    const { result, unmount } = await running()
    act(() => result.current.setManual(true))
    expect(result.current.manual).toBe(true)
    expect(made.sessions[0].manual()).toBe(true)
    // Nothing asked of it for turning it on.
    expect(made.sessions[0].nudge).not.toHaveBeenCalled()
    unmount()
    made.sessions.length = 0
    const again = await running()
    expect(again.result.current.manual).toBe(true)
    expect(made.sessions[0].manual()).toBe(true)
  })

  it('says so in place of "Synced" once it’s on', async () => {
    const { result } = await running()
    act(() => made.sessions[0].onStatus({ state: 'synced' }))
    act(() => result.current.setManual(true))
    expect(result.current.status.state).toBe('manual')
  })

  it('takes up again when it’s turned off: the session is nudged to look', async () => {
    localStorage.setItem('nib-sync-manual', 'true')
    const { result } = await running()
    act(() => result.current.setManual(false))
    expect(made.sessions[0].manual()).toBe(false)
    expect(made.sessions[0].nudge).toHaveBeenCalledTimes(1)
    // Already off when the session is nudged, or it wouldn't look.
    expect(made.nudgedWhile).toEqual([false])
    expect(localStorage.getItem('nib-sync-manual')).toBe('false')
  })

  // A renewal or a first purchase is told to the server at once, by itself: not while only when asked.
  it('leaves a renewal to the next Sync now', async () => {
    localStorage.setItem('nib-sync-manual', 'true')
    const { rerender } = renderHook(({ jws }) => useSync({ active: true, jws } as never, () => {}), { initialProps: { jws: 'one' } })
    await waitFor(() => expect(made.sessions).toHaveLength(1))
    made.sessions[0].nudge.mockClear()
    rerender({ jws: 'two' })
    expect(made.sessions[0].nudge).toHaveBeenCalledTimes(1)
    expect(made.sessions[0].run).not.toHaveBeenCalled()
  })

  it('syncs now by the session’s own look, whichever way the switch is', async () => {
    const { result } = await running()
    act(() => result.current.syncNow())
    act(() => result.current.setManual(true))
    act(() => result.current.syncNow())
    expect(made.sessions[0].run).toHaveBeenCalledTimes(2)
  })
})

describe('turning sync off', () => {
  // Its state forgotten under a pass still going, that pass began again with the code it held.
  it('forgets what this device knows with no pass under way, and stops the session before it’s let go', async () => {
    const { result } = await running()
    await act(() => result.current.turnOff())
    expect(made.order.slice(0, 4)).toEqual(['held', 'forgotten', 'stopped', 'let go'])
    expect(result.current.code).toBeNull()
  })
})

describe('fetching everything again', () => {
  it('forgets what this device knows of the server with no pass under way, then looks, though it’s only when asked', async () => {
    localStorage.setItem('nib-sync-manual', 'true')
    const { result } = await running()
    await act(() => result.current.refetch())
    expect(made.order).toEqual(['held', 'forgotten', 'let go', 'look'])
  })
})


describe('the room the library’s files take on the server', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is asked of the server, and is nothing when it can’t be reached', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url)
      return new Response(JSON.stringify({ files: [{ k: 'a-key', size: 5 }], bytes: 5, limit: 2_000_000_000 }))
    })
    const { result } = await running()
    expect(await result.current.filesRoom()).toEqual({ bytes: 5, limit: 2_000_000_000 })
    expect(asked.map((url) => url.slice(url.indexOf('/v1/')))).toEqual(['/v1/files'])
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Load failed')
    })
    expect(await result.current.filesRoom()).toBeNull()
  })

  it('isn’t asked with sync off', async () => {
    kept.code = null
    const asked = vi.fn()
    vi.stubGlobal('fetch', asked)
    const { result } = renderHook(() => useSync(plus, () => {}))
    await waitFor(() => expect(result.current.known).toBe(true))
    expect(await result.current.filesRoom()).toBeNull()
    expect(asked).not.toHaveBeenCalled()
    kept.code = '0123-4567-89AB-CDEF-GHJK-MNPQ'
  })
})
