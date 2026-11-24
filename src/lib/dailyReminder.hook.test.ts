// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

/**
 * Keeping the daily reminder's fortnight on the device (lib/dailyReminder `useDailyReminder`), the device stood in
 * for: what it has waiting, kept as the calls change it. Looked at each time Nib comes to the front, it took every
 * one off and set them all again, sixteen calls, whatever was there.
 */

const native = vi.hoisted(() => ({ list: vi.fn(), cancel: vi.fn(), set: vi.fn() }))
vi.mock('./reminders', async (actual) => ({ ...(await actual<typeof import('./reminders')>()), DAILY: 'daily-', remindersAvailable: true, reminderPlugin: { list: native.list, cancel: native.cancel }, setReminder: native.set }))

const { DAILY, DAILY_TITLE, dailyTimes: times, useDailyReminder } = await import('./dailyReminder')
/** The pack's line each day, as the device has it waiting: with the title it was given. */
const dailyTimes = (time: string, now: number, opened: boolean) => times(time, now, opened).map((one) => ({ ...one, title: DAILY_TITLE }))

const at = (date: string, time: string) => new Date(`${date}T${time}`).getTime()
const settled = () => act(() => vi.advanceTimersByTimeAsync(50))
const back = () => act(() => void document.dispatchEvent(new Event('visibilitychange')))

let device: { id: string; at: number; title: string }[]
const ids = () => device.map((one) => one.id).sort()

beforeEach(() => {
  vi.useFakeTimers({ now: at('2026-11-04', '10:00') })
  localStorage.clear()
  localStorage.setItem('nib-daily-reminder', JSON.stringify('19:00'))
  device = []
  native.list.mockImplementation(async () => ({ reminders: device }))
  native.cancel.mockImplementation(async ({ ids }: { ids: string[] }) => void (device = device.filter((one) => !ids.includes(one.id))))
  // As the device has them, with the title each was given (NibRemindersPlugin `list`).
  native.set.mockImplementation(async (id: string, when: number, title: string) => void (device = [...device.filter((one) => one.id !== id), { id, at: when, title }]))
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

  it('with invitations on and the reminder off, holds the week’s invitations; the day’s first words take today’s off', async () => {
    const { tellInvitations } = await import('./invitations')
    localStorage.setItem('nib-daily-reminder', JSON.stringify(null))
    localStorage.setItem('nib-invitations', JSON.stringify(true))
    renderHook(() => useDailyReminder(false))
    await settled()
    // A week, from today: 18:45 is still to come.
    expect(ids()).toEqual(['04', '05', '06', '07', '08', '09', '10'].map((date) => `${DAILY}2026-11-${date}`))
    expect(device.every((one) => one.title !== DAILY_TITLE && new Date(one.at).getHours() === 18 && new Date(one.at).getMinutes() === 45)).toBe(true)
    localStorage.setItem('nib-goal-calendar', JSON.stringify({ '2026-11-04': 120 }))
    act(() => tellInvitations({ documents: [], plus: false, inkwell: false, wrote: true }))
    await settled()
    expect(ids()[0]).toBe(`${DAILY}2026-11-05`)
    expect(device).toHaveLength(6)
  })

  it('with both on, a day written on has no notification at all: not the pack’s line in the invitation’s place', async () => {
    const { tellInvitations } = await import('./invitations')
    tellInvitations({ documents: [], plus: false, inkwell: false, wrote: false })
    localStorage.setItem('nib-invitations', JSON.stringify(true))
    renderHook(() => useDailyReminder(false))
    await settled()
    const today = `${DAILY}2026-11-04`
    expect(device.find((one) => one.id === today)).toMatchObject({ at: at('2026-11-04', '19:00') })
    localStorage.setItem('nib-goal-calendar', JSON.stringify({ '2026-11-04': 120 }))
    act(() => tellInvitations({ documents: [], plus: false, inkwell: false, wrote: true }))
    await settled()
    expect(ids()).not.toContain(today)
    // The reminder alone is as it always was: the pack's, whatever was written.
    localStorage.setItem('nib-invitations', JSON.stringify(false))
    back()
    await settled()
    expect(device.find((one) => one.id === today)).toMatchObject({ at: at('2026-11-04', '19:00'), title: DAILY_TITLE })
  })

  it('rings one invitation a day: once today’s has rung, nothing that moves the slot later sets it again', async () => {
    localStorage.setItem('nib-daily-reminder', JSON.stringify(null))
    localStorage.setItem('nib-invitations', JSON.stringify(true))
    const { result } = renderHook(() => useDailyReminder(false))
    await settled()
    const today = `${DAILY}2026-11-04`
    expect(device.find((one) => one.id === today)?.at).toBe(at('2026-11-04', '18:45'))
    // It rings, and the device has it no longer.
    vi.setSystemTime(at('2026-11-04', '19:00'))
    device = device.filter((one) => one.id !== today)
    // The daily reminder turned on for later tonight: its time is the slot's now, and today's has had its one.
    await act(() => result.current.change('21:30'))
    expect(ids()).not.toContain(today)
    expect(device.find((one) => one.id === `${DAILY}2026-11-05`)?.at).toBe(at('2026-11-05', '21:30'))
    // Tomorrow is a day of its own.
    vi.setSystemTime(at('2026-11-05', '08:00'))
    back()
    await settled()
    expect(ids()).toContain(`${DAILY}2026-11-05`)
  })

  it('moves an invitation still to come as often as its time changes, and gives today back to the reminder when invitations go off', async () => {
    localStorage.setItem('nib-daily-reminder', JSON.stringify(null))
    localStorage.setItem('nib-invitations', JSON.stringify(true))
    const { result } = renderHook(() => useDailyReminder(false))
    await settled()
    const today = `${DAILY}2026-11-04`
    await act(() => result.current.change('20:00'))
    expect(device.find((one) => one.id === today)?.at).toBe(at('2026-11-04', '20:00'))
    await act(() => result.current.changeInvitations(false))
    expect(device.find((one) => one.id === today)).toMatchObject({ at: at('2026-11-04', '20:00'), title: DAILY_TITLE })
    // The reminder's own, moved after the invitation's old time has gone by, still rings today: nothing of an invitation rang.
    vi.setSystemTime(at('2026-11-04', '20:30'))
    device = device.filter((one) => one.id !== today)
    await act(() => result.current.change('22:00'))
    expect(device.find((one) => one.id === today)?.at).toBe(at('2026-11-04', '22:00'))
  })

  it('turns invitations on and off from Settings or their offer, and stays off, saying why, when notifications are off for Nib', async () => {
    const { ReminderError } = await import('./reminders')
    const { invitationsAsked, invitationsOn } = await import('./invitationSwitch')
    localStorage.setItem('nib-daily-reminder', JSON.stringify(null))
    const { result } = renderHook(() => useDailyReminder(false))
    await settled()
    expect(device).toEqual([])
    await act(() => result.current.changeInvitations(true))
    expect(result.current.invitations).toBe(true)
    expect(invitationsAsked()).toBe(true)
    expect(device).toHaveLength(7)
    await act(() => result.current.changeInvitations(false))
    expect(result.current.invitations).toBe(false)
    expect(device).toEqual([])

    native.set.mockImplementation(async () => {
      throw new ReminderError('denied', 'Notifications are off for Nib. Turn them on in Settings, under Notifications.')
    })
    await act(() => expect(result.current.changeInvitations(true)).rejects.toThrow('Notifications are off'))
    expect(result.current.invitations).toBe(false)
    expect(invitationsOn()).toBe(false)
  })
})
