// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

// usePlus as it runs in the iOS app, with the App Store faked.
vi.mock('./platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform')>()),
  nativeApp: true,
}))

const store = vi.hoisted(() => ({
  entitlement: vi.fn(),
  addListener: vi.fn(async (_event: string, _listener: (next: unknown) => void) => ({ remove: async () => {} })),
}))
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: () => store,
}))

const { usePlus, useEntitled } = await import('./plus')

beforeEach(() => vi.clearAllMocks())

describe('usePlus', () => {
  it('asks the App Store again when Nib comes back to the front, catching a lapse or a cancellation', async () => {
    store.entitlement.mockResolvedValueOnce({ active: true }).mockResolvedValueOnce({ active: false })
    const { result } = renderHook(() => usePlus())
    await waitFor(() => expect(result.current[0].active).toBe(true))
    expect(result.current[2]).toBe(true)

    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(result.current[0].active).toBe(false))
  })

  // The plugin answers from the device's own record, at once, and asks the App Store whether Plus renews only after
  // (ios NibStorePlugin `learnRenewal`): the day's coins wait for the first, and Billing's line for the second.
  it('knows Plus by the first answer, and takes whether it renews when the App Store says, after', async () => {
    store.entitlement.mockResolvedValueOnce({ active: true, expiresAt: 60_000 })
    const { result } = renderHook(() => usePlus())
    await waitFor(() => expect(result.current[2]).toBe(true))
    expect(result.current[0]).toEqual({ active: true, expiresAt: 60_000 })

    const said = store.addListener.mock.calls.find(([event]) => event === 'entitlementChanged')![1]
    act(() => said({ active: true, expiresAt: 60_000, willRenew: false }))
    expect(result.current[0].willRenew).toBe(false)
  })

  // Asked each time Nib comes back, and a new object each time had the whole app drawn again for nothing.
  it('keeps what it had when the App Store says the same again', async () => {
    store.entitlement.mockImplementation(async () => ({ active: true, productId: 'app.nib.plus.yearly', expiresAt: 60_000, jws: 'signed' }))
    const { result } = renderHook(() => usePlus())
    await waitFor(() => expect(result.current[0].active).toBe(true))
    const had = result.current[0]

    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(store.entitlement).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(result.current[0]).toBe(had)
  })

  // Asked again only on coming back to the front, a Mac left open kept Plus past its end.
  it('asks again as Plus runs out, with Nib left open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: 0 })
    store.entitlement.mockResolvedValueOnce({ active: true, expiresAt: 60_000 }).mockResolvedValueOnce({ active: false })
    const { result } = renderHook(() => usePlus())
    await vi.waitFor(() => expect(result.current[0].active).toBe(true))
    await act(async () => void vi.advanceTimersByTime(66_000))
    await vi.waitFor(() => expect(result.current[0].active).toBe(false))
    vi.useRealTimers()
  })
})

// Days of Plus's features from coins or the feedback gift, ending (lib/upsell endingNotice).
describe('useEntitled', () => {
  const HOUR = 60 * 60 * 1000
  const notMine = { active: false }

  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: new Date(2026, 10, 20, 9, 0) })
  })

  it('tells the day before free days end, and when they have', () => {
    const until = new Date(2026, 10, 21, 12, 0).getTime()
    const setNotice = vi.fn()
    const { result } = renderHook(() => useEntitled(notMine, true, until, setNotice))
    expect(result.current.features).toBe(true)
    act(() => vi.advanceTimersByTime(3 * HOUR - 1))
    expect(setNotice).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(setNotice).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^Your days of Nib Plus end tomorrow at 12:00\sPM\.$/))
    act(() => vi.advanceTimersByTime(24 * HOUR))
    expect(setNotice).toHaveBeenLastCalledWith('Your days of Nib Plus have ended.')
    expect(result.current.features).toBe(false)
    vi.useRealTimers()
  })

  it('tells at once when Nib opens in the last day, and only once', () => {
    const until = new Date(2026, 10, 20, 17, 0).getTime()
    const setNotice = vi.fn()
    const first = renderHook(() => useEntitled(notMine, true, until, setNotice))
    act(() => vi.advanceTimersByTime(0))
    expect(setNotice).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^Your days of Nib Plus end today at 5:00\sPM\.$/))
    first.unmount()
    renderHook(() => useEntitled(notMine, true, until, setNotice))
    act(() => vi.advanceTimersByTime(HOUR))
    expect(setNotice).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('says nothing of them to a subscriber', () => {
    const setNotice = vi.fn()
    renderHook(() => useEntitled({ active: true }, true, new Date(2026, 10, 20, 17, 0).getTime(), setNotice))
    act(() => vi.advanceTimersByTime(24 * HOUR))
    expect(setNotice).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
