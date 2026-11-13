// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

describe('the writing buddy', () => {
  it('is off, and not yet asked, till it’s answered; yes puts it in its corner, kept on this device', async () => {
    localStorage.clear()
    vi.resetModules()
    const buddy = await import('./buddy')
    const { result } = renderHook(() => buddy.useBuddy())
    expect(result.current).toBe(false)
    expect(buddy.buddyAsked()).toBe(false)
    act(() => buddy.setBuddy(true))
    expect(result.current).toBe(true)
    expect(buddy.buddyAsked()).toBe(true)
    expect(localStorage.getItem('nib-buddy')).toBe('on')

    // As Nib opens again.
    vi.resetModules()
    const reopened = await import('./buddy')
    expect(reopened.buddyAsked()).toBe(true)
    expect(renderHook(() => reopened.useBuddy()).result.current).toBe(true)
    act(() => reopened.setBuddy(false))
    expect(localStorage.getItem('nib-buddy')).toBe('off')
    expect(reopened.buddyAsked()).toBe(true)
  })
})
