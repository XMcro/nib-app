// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

/**
 * Keeping the daily reminder's fortnight on the device (lib/dailyReminder `useDailyReminder`), the device stood in
 * for: what it has waiting, kept as the calls change it. Looked at each time Nib comes to the front, it took every
 * one off and set them all again, sixteen calls, whatever was there.
 */

const native = vi.hoisted(() => ({ list: vi.fn(), cancel: vi.fn(), set: vi.fn() }))
vi.mock('./reminders', () => ({ DAILY: 'daily-', remindersAvailable: true, reminderPlugin: { list: native.list, cancel: native.cancel }, setReminder: native.set }))

const { DAILY, dailyTimes, useDailyReminder } = await import('./dailyReminder')

const at = (date: string, time: string) => new Date(`${date}T${time}`).getTime()
const settled = () => act(() => vi.advanceTimersByTimeAsync(50))
const back = () => act(() => void document.dispatchEvent(new Event('visibilitychange')))

let device: { id: string; at: number }[]
const ids = () => device.map((one) => one.id).sort()

beforeEach(() => {
  vi.useFakeTimers({ now: at('2026-11-04', '10:00') })
  localStorage.clear()
  localStorage.setItem('nib-daily-reminder', JSON.stringify('19:00'))
  device = []
  native.list.mockImplementation(async () => ({ reminders: device }))
  native.cancel.mockImplementation(async ({ ids }: { ids: string[] }) => void (device = device.filter((one) => !ids.includes(one.id))))
  native.set.mockImplementation(async (id: string, when: number) => void (device = [...device.filter((one) => one.id !== id), { id, at: when }]))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('the daily reminder’s fortnight on the device', () => {
  it('is set, every day of it, when none of it is there', async () => {
    renderHook(() => useDailyReminder(false))
    await settled()
    expect(device).toEqual(dailyTimes('19:00', Date.now(), false))
  })

  it('is left alone when it’s all there as it should be, as Nib opens and each time it comes back', async () => {
    device = dailyTimes('19:00', Date.now(), false)
    renderHook(() => useDailyReminder(false))
    await settled()
    back()
    await settled()
    expect(native.cancel).not.toHaveBeenCalled()
    expect(native.set).not.toHaveBeenCalled()
  })

  it('is topped up by the one new day when a day has gone by, the rest left as they are', async () => {
    // As set yesterday morning, less yesterday's, which rang.
    device = dailyTimes('19:00', at('2026-11-03', '10:00'), false).slice(1)
    renderHook(() => useDailyReminder(false))
    await settled()
    expect(native.cancel).not.toHaveBeenCalled()
    expect(native.set).toHaveBeenCalledTimes(1)
    expect(native.set.mock.calls[0][0]).toBe(`${DAILY}2026-11-17`)
    expect(device).toHaveLength(14)
  })

  it('has only today’s taken off once today’s pack is opened', async () => {
    device = dailyTimes('19:00', Date.now(), false)
    const { rerender } = renderHook(({ opened }: { opened: boolean }) => useDailyReminder(opened), { initialProps: { opened: false } })
    await settled()
    rerender({ opened: true })
    await settled()
    expect(native.cancel).toHaveBeenCalledTimes(1)
    expect(native.cancel).toHaveBeenCalledWith({ ids: [`${DAILY}2026-11-04`] })
    expect(native.set).not.toHaveBeenCalled()
    expect(ids()).toEqual(dailyTimes('19:00', Date.now(), true).map((one) => one.id))
  })

  it('ends as it should when a new day’s look and the pack’s come at once: one at a time, neither undoing the other', async () => {
    // Yesterday's pack was opened, so Nib comes back still thinking today's is; then finds it isn't.
    device = dailyTimes('19:00', at('2026-11-03', '10:00'), true)
    const { rerender } = renderHook(({ opened }: { opened: boolean }) => useDailyReminder(opened), { initialProps: { opened: true } })
    rerender({ opened: false })
    await settled()
    expect(ids()).toEqual(dailyTimes('19:00', Date.now(), false).map((one) => one.id))
  })

  it('is all taken off when the reminder is turned off', async () => {
    device = dailyTimes('19:00', Date.now(), false)
    const { result } = renderHook(() => useDailyReminder(false))
    await settled()
    await act(() => result.current.change(null))
    expect(device).toEqual([])
  })
})
