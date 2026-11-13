// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { Item } from '../db/db'
import * as items from '../db/items'
import type { Notice } from './notices'
import { useExpiring, useToday } from './useExpiring'

vi.mock('../db/items', () => ({ remove: vi.fn(async () => {}), restore: vi.fn(async () => {}) }))

beforeEach(() => void vi.useFakeTimers({ now: new Date('2026-11-10T23:50:00') }))
afterEach(() => void vi.useRealTimers())
afterEach(cleanup)

describe('today, while Nib is open', () => {
  it('turns over at midnight, and at the next', () => {
    const { result } = renderHook(() => useToday())
    expect(result.current).toBe('2026-11-10')
    act(() => void vi.advanceTimersByTime(9 * 60_000))
    expect(result.current).toBe('2026-11-10')
    act(() => void vi.advanceTimersByTime(2 * 60_000))
    expect(result.current).toBe('2026-11-11')
    act(() => void vi.advanceTimersByTime(24 * 60 * 60_000))
    expect(result.current).toBe('2026-11-12')
  })

  it('is looked at again when Nib comes back to the front: a timer doesn’t run while a phone sleeps', () => {
    const { result } = renderHook(() => useToday())
    vi.setSystemTime(new Date('2026-11-13T08:00:00'))
    expect(result.current).toBe('2026-11-10')
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(result.current).toBe('2026-11-13')
    state.mockRestore()
  })

  // On an iPhone, moving what was due as Nib went to the back wrote to the database while iOS was putting Nib to sleep:
  // the write, or the file copy's read after it, was cut off, and Nib came back saying it couldn't save.
  it('isn’t looked at as Nib goes to the back, only as it comes to the front', () => {
    const { result } = renderHook(() => useToday())
    vi.setSystemTime(new Date('2026-11-13T08:00:00'))
    const state = vi.spyOn(document, 'visibilityState', 'get')
    state.mockReturnValue('hidden')
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(result.current).toBe('2026-11-10')
    // Nor at a midnight that passes with it at the back.
    act(() => void vi.advanceTimersByTime(24 * 60 * 60_000))
    expect(result.current).toBe('2026-11-10')
    state.mockReturnValue('visible')
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(result.current).toBe('2026-11-14')
    // And the midnights after are watched for again.
    act(() => void vi.advanceTimersByTime(24 * 60 * 60_000))
    expect(result.current).toBe('2026-11-15')
    state.mockRestore()
  })

  it('stops looking when it’s done with', () => {
    const { unmount } = renderHook(() => useToday())
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('what is due, as the lists change under it', () => {
  const note = (id: string, expires?: string): Item => ({ id, kind: 'note', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }] }, version: 1, createdAt: 1, updatedAt: 1, expires })
  const guarded = (action: () => Promise<unknown>) => action()
  const said: Notice[] = []
  const setNotice = (notice: Notice) => void said.push(notice)
  const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(1)))
  beforeEach(() => {
    vi.mocked(items.remove).mockClear()
    vi.mocked(items.restore).mockClear()
    said.length = 0
  })

  it('is asked to go once, though the lists are read again before it has left them', async () => {
    const { rerender } = renderHook(({ listed }) => useExpiring(listed, [], null, guarded, setNotice), { initialProps: { listed: [note('a', '2026-11-10'), note('b')] } })
    await settle()
    // Another document saved: the same lists again, the one that's due still in them.
    rerender({ listed: [note('a', '2026-11-10'), note('b')] })
    await settle()
    expect(vi.mocked(items.remove).mock.calls).toEqual([[['a']]])
    expect(said.map((notice) => notice.text)).toEqual(['“a” expired and is in the trash.'])
  })

  it('goes again another day, put back and given a new date since', async () => {
    const { rerender } = renderHook(({ listed }) => useExpiring(listed, [], null, guarded, setNotice), { initialProps: { listed: [note('a', '2026-11-10')] } })
    await settle()
    rerender({ listed: [] })
    said[0].action!.run()
    await settle()
    expect(vi.mocked(items.restore).mock.calls).toEqual([['a']])
    rerender({ listed: [note('a', '2026-11-11')] })
    await settle()
    expect(items.remove).toHaveBeenCalledTimes(1)
    await act(async () => void (await vi.advanceTimersByTimeAsync(11 * 60_000)))
    expect(vi.mocked(items.remove).mock.calls).toEqual([[['a']], [['a']]])
  })

  it('leaves the one in front out of what it says, and out of Undo: that one has a banner and a Restore of its own', async () => {
    renderHook(() => useExpiring([note('a', '2026-11-10'), note('b', '2026-11-10')], [], 'a', guarded, setNotice))
    await settle()
    expect(vi.mocked(items.remove).mock.calls).toEqual([[['a', 'b']]])
    expect(said.map((notice) => notice.text)).toEqual(['“b” expired and is in the trash.'])
    said[0].action!.run()
    await settle()
    expect(vi.mocked(items.restore).mock.calls).toEqual([['b']])
  })

  it('says nothing at all when the one in front is all that went', async () => {
    // And nothing goes wrong for want of anything to say: that would be taken for the device not saving.
    const failed = vi.fn()
    renderHook(() => useExpiring([note('a', '2026-11-10')], [], 'a', (action) => action().catch(failed), setNotice))
    await settle()
    expect(items.remove).toHaveBeenCalledTimes(1)
    expect(said).toEqual([])
    expect(failed).not.toHaveBeenCalled()
  })

  it('says nothing went when it couldn’t be moved', async () => {
    vi.mocked(items.remove).mockRejectedValueOnce(new Error('full'))
    const failed = vi.fn()
    renderHook(() => useExpiring([note('a', '2026-11-10')], [], null, (action) => action().catch(failed), setNotice))
    await settle()
    expect(failed).toHaveBeenCalled()
    expect(said).toEqual([])
  })
})

