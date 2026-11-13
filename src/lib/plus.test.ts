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
  addListener: vi.fn(async () => ({ remove: async () => {} })),
}))
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: () => store,
}))

const { usePlus } = await import('./plus')

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

