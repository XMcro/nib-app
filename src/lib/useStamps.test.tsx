// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useStamps } from './useStamps'

describe('the day, as Nib knows it', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ now: new Date('2026-11-04T23:50:00') })
  })
  afterEach(() => void vi.useRealTimers())

  // A Mac that sleeps through midnight: the timer set for it hasn't run, and Nib is on the screen, so nothing else says so.
  it('moves within a minute of waking on a new day', () => {
    const { result } = renderHook(() => useStamps(false))
    expect(result.current.today).toBe('2026-11-04')
    vi.setSystemTime(new Date('2026-11-05T07:30:00'))
    act(() => void vi.advanceTimersByTime(60_000))
    expect(result.current.today).toBe('2026-11-05')
  })
})
