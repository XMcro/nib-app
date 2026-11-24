// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { Item } from '../db/db'

// The device's side, stood in for: what it has waiting to ring.
const native = vi.hoisted(() => ({ schedule: vi.fn(), cancel: vi.fn(), list: vi.fn(), addListener: vi.fn() }))
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: () => native,
}))
vi.mock('./platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./platform')>()), nativeApp: true }))

const { useReminders } = await import('./reminders')
const { asReminder, describeReminder, followedUp, followUpsOf, forget, keepReminders, nextAt, remind, ReminderError, reminderOf, reminderPlan, refreshReminders, repeatWord, setReminder, silentHere, snoozedFor, suggestedTimes, toLocalInput, unkept, useKeptReminders } = await import('./reminders')
const { db } = await import('../db/db')
const items = await import('../db/items')

// Local times, so the expectations hold in any time zone.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()
const NOW = at(8, 7, 2) // Thursday 8 October 2026, 07:02
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

const note = (id: string, fields: Partial<Item> = {}): Item => ({ id, kind: 'note', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Note ${id}` }] }] }, version: 1, createdAt: 1, updatedAt: 1, ...fields })
const LOCKED = { vault: { salt: 's', sealed: 'x' } }
const denied = () => Promise.reject(Object.assign(new Error('Notifications are off for Nib.'), { code: 'denied' }))

/** What the device has waiting, kept as the calls change it, as the device would. */
let device: { id: string; at: number; title?: string; repeat?: string; snoozed?: boolean }[]

// A fresh spy per test: in this Vitest a spy reset in a hook and then rejected fails the test even when handled.
beforeEach(async () => {
  device = []
  native.schedule = vi.fn(async (one: { id: string; at: number; title: string; repeat?: string }) => void (device = [...device.filter((kept) => kept.id !== one.id), { id: one.id, at: one.at, title: one.title, ...(one.repeat ? { repeat: one.repeat } : {}) }]))
  native.cancel = vi.fn(async ({ ids }: { ids: string[] }) => void (device = device.filter((kept) => !ids.includes(kept.id))))
  native.list = vi.fn(async () => ({ reminders: device }))
  localStorage.clear()
  // Taken into their notes already: what an earlier Nib left is its own test.
  localStorage.setItem('nib-reminders-kept', 'true')
  await db.items.clear()
})

describe('a reminder arriving from outside', () => {
  it('is a time, or null for taken off, and anything else says nothing', () => {
    expect(asReminder({ at: 1794000000000 })).toEqual({ at: 1794000000000 })
    expect(asReminder({ at: 1794000000000, title: 'x' })).toEqual({ at: 1794000000000 })
    expect(asReminder(null)).toBeNull()
    for (const odd of [undefined, 1794000000000, 'soon', {}, { at: 'soon' }, { at: -1 }, [{ at: 1 }], true]) expect(asReminder(odd), JSON.stringify(odd)).toBeUndefined()
  })
})

describe('a reminder that repeats', () => {
  const on = (year: number, month: number, day: number, hour = 9, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime()

  it('arrives saying how, by one of four words, and as one that doesn’t for any other', () => {
    for (const repeat of ['day', 'week', 'month', 'year']) expect(asReminder({ at: 9, repeat })).toEqual({ at: 9, repeat })
    for (const odd of ['hour', 'weekday', '', 7, null, true]) expect(asReminder({ at: 9, repeat: odd })).toEqual({ at: 9 })
  })

  it('comes next at its own time until that has passed, then at the same hour a day, a week, a month or a year on', () => {
    const first = on(2026, 10, 8)
    for (const repeat of ['day', 'week', 'month', 'year'] as const) expect(nextAt({ at: first, repeat }, first - 1)).toBe(first)
    expect(nextAt({ at: first, repeat: 'day' }, first)).toBe(on(2026, 10, 9))
    expect(nextAt({ at: first, repeat: 'day' }, on(2027, 3, 1, 9, 1))).toBe(on(2027, 3, 2))
    expect(nextAt({ at: first, repeat: 'week' }, on(2026, 10, 20))).toBe(on(2026, 10, 22))
    expect(nextAt({ at: first, repeat: 'month' }, on(2026, 12, 8))).toBe(on(2027, 1, 8))
    expect(nextAt({ at: first, repeat: 'year' }, on(2030, 1, 1))).toBe(on(2030, 10, 8))
    // One that doesn't repeat comes once.
    expect(nextAt({ at: first }, first - 1)).toBe(first)
    expect(nextAt({ at: first }, first)).toBeUndefined()
  })

  // As the device's own calendar does it: a repeat by the month rings on that date, and a month without it has none.
  it('by the month skips the months that have no such date, and by the year the years', () => {
    expect(nextAt({ at: on(2027, 1, 31), repeat: 'month' }, on(2027, 2, 1))).toBe(on(2027, 3, 31))
    expect(nextAt({ at: on(2027, 3, 31), repeat: 'month' }, on(2027, 4, 1))).toBe(on(2027, 5, 31))
    expect(nextAt({ at: on(2028, 2, 29), repeat: 'year' }, on(2028, 3, 1))).toBe(on(2032, 2, 29))
  })

  it('is said in a word', () => {
    expect(['day', 'week', 'month', 'year'].map((repeat) => repeatWord({ at: 1, repeat: repeat as 'day' }))).toEqual(['daily', 'weekly', 'monthly', 'yearly'])
    expect(repeatWord({ at: 1 })).toBe('')
    expect(repeatWord(undefined)).toBe('')
  })

  it('is the note’s reminder at its next time, however long ago it began', () => {
    const first = on(2026, 10, 8)
    expect(reminderOf(note('a', { reminder: { at: first, repeat: 'week' } }), on(2026, 11, 10))).toBe(on(2026, 11, 12))
  })
})

describe('what a device has to do for a reminder that repeats', () => {
  const on = (year: number, month: number, day: number, hour = 9, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime()
  const now = on(2026, 10, 8, 7)

  it('rings at its next time, repeating, and is left alone while the device is waiting for just that', () => {
    const weekly = note('a', { reminder: { at: on(2026, 10, 1), repeat: 'week' } })
    expect(reminderPlan([weekly], [], now)).toEqual({ ring: [{ id: 'a', at: on(2026, 10, 8), title: 'Note a', repeat: 'week' }], cancel: [] })
    expect(reminderPlan([weekly], [{ id: 'a', at: on(2026, 10, 8), title: 'Note a', repeat: 'week' }], now)).toEqual({ ring: [], cancel: [] })
    // It rang, and the device moved on to the next by itself: still in step.
    expect(reminderPlan([weekly], [{ id: 'a', at: on(2026, 10, 15), title: 'Note a', repeat: 'week' }], on(2026, 10, 8, 10))).toEqual({ ring: [], cancel: [] })
  })

  it('rings again when how it repeats is changed, or taken off', () => {
    const waiting = [{ id: 'a', at: on(2026, 10, 8), title: 'Note a', repeat: 'week' as const }]
    expect(reminderPlan([note('a', { reminder: { at: on(2026, 10, 8), repeat: 'day' } })], waiting, now).ring).toEqual([{ id: 'a', at: on(2026, 10, 8), title: 'Note a', repeat: 'day' }])
    expect(reminderPlan([note('a', { reminder: { at: on(2026, 10, 8) } })], waiting, now).ring).toEqual([{ id: 'a', at: on(2026, 10, 8), title: 'Note a' }])
  })

  // The device's repeating notification rings at the next day, weekday or date that fits, whenever that is.
  it('rings once, not repeating, for one that begins more than a turn away, so it can’t ring before it begins; and repeating once it’s within one', () => {
    const later = note('a', { reminder: { at: on(2026, 10, 30), repeat: 'week' } })
    expect(reminderPlan([later], [], now).ring).toEqual([{ id: 'a', at: on(2026, 10, 30), title: 'Note a' }])
    expect(reminderPlan([later], [{ id: 'a', at: on(2026, 10, 30), title: 'Note a' }], now)).toEqual({ ring: [], cancel: [] })
    expect(reminderPlan([later], [{ id: 'a', at: on(2026, 10, 30), title: 'Note a' }], on(2026, 10, 25)).ring).toEqual([{ id: 'a', at: on(2026, 10, 30), title: 'Note a', repeat: 'week' }])
    // The same for each: a day, a month and a year.
    expect(reminderPlan([note('d', { reminder: { at: on(2026, 10, 10), repeat: 'day' } })], [], now).ring[0].repeat).toBeUndefined()
    expect(reminderPlan([note('d', { reminder: { at: on(2026, 10, 9), repeat: 'day' } })], [], on(2026, 10, 8, 12)).ring[0].repeat).toBe('day')
    expect(reminderPlan([note('m', { reminder: { at: on(2026, 12, 8), repeat: 'month' } })], [], now).ring[0].repeat).toBeUndefined()
    expect(reminderPlan([note('m', { reminder: { at: on(2026, 11, 1), repeat: 'month' } })], [], now).ring[0].repeat).toBe('month')
    expect(reminderPlan([note('y', { reminder: { at: on(2028, 1, 1), repeat: 'year' } })], [], now).ring[0].repeat).toBeUndefined()
    expect(reminderPlan([note('y', { reminder: { at: on(2027, 6, 1), repeat: 'year' } })], [], now).ring[0].repeat).toBe('year')
  })

  // Seen on an iPhone: its own monthly repeat for the 31st said it would ring next on the 1st of December, after a
  // November with no 31st, where the note has none that month. The two never agreed, and it was set again at every look.
  it('rings once at a time, not repeating, for a date not every month has, or every year', () => {
    const thirtyFirst = note('m', { reminder: { at: on(2026, 10, 31), repeat: 'month' } })
    expect(reminderPlan([thirtyFirst], [], on(2026, 11, 10)).ring).toEqual([{ id: 'm', at: on(2026, 12, 31), title: 'Note m' }])
    expect(reminderPlan([thirtyFirst], [{ id: 'm', at: on(2026, 12, 31), title: 'Note m' }], on(2026, 11, 10))).toEqual({ ring: [], cancel: [] })
    for (const date of [29, 30]) expect(reminderPlan([note('m', { reminder: { at: on(2026, 10, date), repeat: 'month' } })], [], on(2026, 11, 10)).ring[0].repeat).toBeUndefined()
    // The 28th every month has.
    expect(reminderPlan([note('m', { reminder: { at: on(2026, 10, 28), repeat: 'month' } })], [], on(2026, 11, 10)).ring[0].repeat).toBe('month')
    expect(reminderPlan([note('y', { reminder: { at: on(2028, 2, 29), repeat: 'year' } })], [], on(2031, 12, 1)).ring).toEqual([{ id: 'y', at: on(2032, 2, 29), title: 'Note y' }])
    expect(reminderPlan([note('y', { reminder: { at: on(2028, 2, 28), repeat: 'year' } })], [], on(2028, 12, 1)).ring[0].repeat).toBe('year')
    // And a week or a day never falls on a date that isn't there.
    expect(reminderPlan([note('w', { reminder: { at: on(2026, 10, 31), repeat: 'week' } })], [], on(2026, 11, 10)).ring[0].repeat).toBe('week')
  })

  it('takes the device’s time as the note’s when they’re the same second', () => {
    const daily = note('a', { reminder: { at: on(2026, 10, 8) + 400, repeat: 'day' } })
    expect(reminderPlan([daily], [{ id: 'a', at: on(2026, 10, 8), title: 'Note a', repeat: 'day' }], now)).toEqual({ ring: [], cancel: [] })
  })
})

describe('when a note’s reminder comes', () => {
  it('is its time while that’s still to come, and nothing once it has passed or been taken off', () => {
    expect(reminderOf(note('a', { reminder: { at: NOW + 1 } }), NOW)).toBe(NOW + 1)
    expect(reminderOf(note('a', { reminder: { at: NOW } }), NOW)).toBeUndefined()
    expect(reminderOf(note('a', { reminder: null }), NOW)).toBeUndefined()
    expect(reminderOf(note('a'), NOW)).toBeUndefined()
    expect(reminderOf(undefined, NOW)).toBeUndefined()
  })
})

describe('what a device has to do to ring for its library', () => {
  const soon = NOW + 3_600_000

  it('rings for each reminder still to come, with the note’s title, and never a locked note’s', () => {
    const plan = reminderPlan([note('a', { reminder: { at: soon } }), note('b', { reminder: { at: soon + 1, }, ...LOCKED }), note('c'), note('d', { reminder: { at: NOW - 1 } }), note('e', { reminder: null })], [], NOW)
    expect(plan).toEqual({ ring: [{ id: 'a', at: soon, title: 'Note a' }, { id: 'b', at: soon + 1, title: 'A locked note' }], cancel: [] })
  })

  it('leaves what it’s already waiting to ring as it is, and rings again for another time or another title', () => {
    const library = [note('a', { reminder: { at: soon } }), note('b', { reminder: { at: soon } }), note('c', { reminder: { at: soon } }), note('d', { reminder: { at: soon }, ...LOCKED })]
    const waiting = [{ id: 'a', at: soon, title: 'Note a' }, { id: 'b', at: soon + 60_000, title: 'Note b' }, { id: 'c', at: soon, title: 'An older title' }, { id: 'd', at: soon, title: 'Note d' }]
    expect(reminderPlan(library, waiting, NOW)).toEqual({
      ring: [{ id: 'b', at: soon, title: 'Note b' }, { id: 'c', at: soon, title: 'Note c' }, { id: 'd', at: soon, title: 'A locked note' }],
      cancel: [],
    })
  })

  it('stops waiting for a reminder taken off, and for a note in the trash or gone, and leaves the daily reminder’s alone', () => {
    const waiting = [{ id: 'off', at: soon, title: 'Note off' }, { id: 'trashed-or-gone', at: soon, title: 'x' }, { id: 'kept', at: soon, title: 'Note kept' }, { id: 'daily-2026-10-09', at: soon, title: 'Today’s pack is waiting.' }]
    // The library is given without its trash: a note there is as one that's gone.
    expect(reminderPlan([note('off', { reminder: null }), note('kept', { reminder: { at: soon } })], waiting, NOW)).toEqual({ ring: [], cancel: ['off', 'trashed-or-gone'] })
  })
})

// Snoozed from its notification, on this device (NibRemindersPlugin.swift): a second notification, waiting beside the note's own.
describe('a reminder snoozed on this device', () => {
  const soon = NOW + 3_600_000
  const snooze = (id: string) => ({ id, at: soon, title: `Note ${id}`, snoozed: true })

  it('waits on, whatever became of the time it was snoozed from, while its note still has a reminder', () => {
    // Rung and snoozed: the note's own time has passed.
    expect(reminderPlan([note('a', { reminder: { at: NOW - 60_000 } })], [snooze('a')], NOW)).toEqual({ ring: [], cancel: [] })
    // One that repeats, snoozed: both wait.
    const daily = note('b', { reminder: { at: NOW - 60_000, repeat: 'day' } })
    const next = NOW - 60_000 + 86_400_000
    expect(reminderPlan([daily], [snooze('b'), { id: 'b', at: next, title: 'Note b', repeat: 'day' }], NOW)).toEqual({ ring: [], cancel: [] })
  })

  it('isn’t the note’s own notification: that is still to be rung', () => {
    expect(reminderPlan([note('a', { reminder: { at: soon } })], [snooze('a')], NOW).ring).toEqual([{ id: 'a', at: soon, title: 'Note a' }])
  })

  it('is cancelled with a note in the trash or gone, or whose reminder was taken off', () => {
    expect(reminderPlan([note('off', { reminder: null }), note('never')], [snooze('off'), snooze('never'), snooze('gone')], NOW)).toEqual({ ring: [], cancel: ['off', 'never', 'gone'] })
  })

  it('is cancelled once, with a notification of the note’s own that goes too', () => {
    expect(reminderPlan([], [snooze('gone'), { id: 'gone', at: soon, title: 'Note gone' }], NOW).cancel).toEqual(['gone'])
  })

  it('is known to the page apart from the note’s own, until it rings', async () => {
    device = [{ id: 'a', at: Date.now() + 60_000, title: 'Note a', snoozed: true }, { id: 'a', at: Date.now() + 86_400_000, title: 'Note a', repeat: 'day' }, { id: 'b', at: Date.now() + 60_000, title: 'Note b' }]
    await refreshReminders()
    expect(snoozedFor('a')).toBe(device[0].at)
    expect(snoozedFor('b')).toBeUndefined()
    expect(snoozedFor('a', device[0].at)).toBeUndefined()
  })

  it('isn’t taken for a reminder an earlier Nib left', () => {
    expect(unkept([note('a')], [snooze('a')])).toEqual([])
  })
})

describe('reminders an earlier Nib kept on the device alone', () => {
  it('are those waiting for notes that say nothing of one: not a note that says it was taken off, one that’s gone, or the daily reminder', () => {
    const waiting = [{ id: 'a', at: 5 }, { id: 'off', at: 6 }, { id: 'has', at: 7 }, { id: 'gone', at: 8 }, { id: 'daily-2026-10-09', at: 9 }]
    expect(unkept([note('a'), note('off', { reminder: null }), note('has', { reminder: { at: 70 } })], waiting)).toEqual([{ id: 'a', at: 5 }])
  })

  it('are taken into their notes once, and never again: a reminder taken off later isn’t brought back by a device still waiting', async () => {
    localStorage.removeItem('nib-reminders-kept')
    const soon = Date.now() + 3_600_000
    await items.create('note', note('a').body, { id: 'a' })
    device = [{ id: 'a', at: soon }]
    await keepReminders(await items.listAll())
    expect((await items.get('a'))!.reminder).toEqual({ at: soon })
    // Still waiting to ring, now with the note's title to compare by.
    expect(device).toEqual([{ id: 'a', at: soon, title: 'Note a' }])

    await forget('a')
    device = [{ id: 'a', at: soon, title: 'Note a' }]
    await keepReminders(await items.listAll())
    expect((await items.get('a'))!.reminder).toBeNull()
    expect(device).toEqual([])
  })
})

describe('setting a reminder by hand', () => {
  it('schedules it on this device, which may ask to be allowed, and keeps it with the note for the others', async () => {
    await items.create('note', note('ferry').body, { id: 'ferry' })
    const when = Date.now() + 3_600_000
    await remind((await items.get('ferry'))!, when)
    expect(native.schedule).toHaveBeenCalledWith({ id: 'ferry', at: when, title: 'Note ferry', ask: true })
    expect((await items.get('ferry'))!.reminder).toEqual({ at: when })
  })

  it('says how to turn notifications on when they are off, and keeps nothing', async () => {
    await items.create('note', note('ferry').body, { id: 'ferry' })
    native.schedule = vi.fn(denied)
    const attempt = remind((await items.get('ferry'))!, Date.now() + 60_000)
    await expect(attempt).rejects.toBeInstanceOf(ReminderError)
    await expect(attempt).rejects.toThrow('Turn them on in Settings, under Notifications.')
    expect((await items.get('ferry'))!.reminder).toBeUndefined()
  })

  it('repeats as it’s told to, on this device and on the note', async () => {
    await items.create('note', note('ferry').body, { id: 'ferry' })
    const when = Date.now() + 3_600_000
    await remind((await items.get('ferry'))!, when, 'week')
    expect(native.schedule).toHaveBeenCalledWith({ id: 'ferry', at: when, title: 'Note ferry', ask: true, repeat: 'week' })
    expect((await items.get('ferry'))!.reminder).toEqual({ at: when, repeat: 'week' })
    // And told not to again, it doesn't.
    await remind((await items.get('ferry'))!, when, null)
    expect((await items.get('ferry'))!.reminder).toEqual({ at: when })
  })

  it('rings as "A locked note" for a note in the vault', async () => {
    await remind(note('ferry', LOCKED), Date.now() + 60_000)
    expect(native.schedule).toHaveBeenCalledWith(expect.objectContaining({ title: 'A locked note' }))
  })

  it('is taken off the note, for every device', async () => {
    await items.create('note', note('ferry').body, { id: 'ferry' })
    await items.setReminder('ferry', { at: Date.now() + 60_000 })
    await forget('ferry')
    expect((await items.get('ferry'))!.reminder).toBeNull()
  })
})

describe('keeping a device in step with its library', () => {
  const soon = () => Date.now() + 3_600_000

  it('schedules a reminder that came with a note from another device, without asking to be allowed', async () => {
    const when = soon()
    await keepReminders([note('a', { reminder: { at: when } })])
    expect(native.schedule).toHaveBeenCalledWith({ id: 'a', at: when, title: 'Note a', ask: false })
    expect(silentHere()).toBe(false)
  })

  it('schedules one that repeats to repeat, here as where it was set', async () => {
    const when = soon()
    await keepReminders([note('a', { reminder: { at: when, repeat: 'week' } })])
    expect(native.schedule).toHaveBeenCalledWith({ id: 'a', at: when, title: 'Note a', ask: false, repeat: 'week' })
    // And waiting for just that, it's left alone at the next look.
    native.schedule.mockClear()
    device = [{ id: 'a', at: when, title: 'Note a', repeat: 'week' }]
    await keepReminders([note('a', { reminder: { at: when, repeat: 'week' } })])
    expect(native.schedule).not.toHaveBeenCalled()
  })

  it('cancels what the library no longer has, and does nothing where nothing has changed', async () => {
    const when = soon()
    device = [{ id: 'a', at: when, title: 'Note a' }, { id: 'gone', at: when, title: 'Gone' }]
    await keepReminders([note('a', { reminder: { at: when } })])
    expect(native.cancel).toHaveBeenCalledWith({ ids: ['gone'] })
    expect(native.schedule).not.toHaveBeenCalled()
  })

  // What has rung already is taken down with it: a title it shows may be a note's since locked into the vault.
  it('takes one down before it rings again under another title', async () => {
    const when = soon()
    device = [{ id: 'a', at: when, title: 'Note a' }]
    const calls: string[] = []
    native.cancel = vi.fn(async ({ ids }: { ids: string[] }) => void calls.push(`cancel ${ids}`))
    native.schedule = vi.fn(async ({ title }: { title: string }) => void calls.push(`ring ${title}`))
    await keepReminders([note('a', { reminder: { at: when }, ...LOCKED })])
    expect(calls).toEqual(['cancel a', 'ring A locked note'])
  })

  it('stays silent where notifications aren’t allowed, says so, and stops trying the rest', async () => {
    native.schedule = vi.fn(denied)
    await keepReminders([note('a', { reminder: { at: soon() } }), note('b', { reminder: { at: soon() } })])
    expect(native.schedule).toHaveBeenCalledTimes(1)
    expect(silentHere()).toBe(true)
    // Allowed since, in Settings: the next look rings them.
    native.schedule = vi.fn(async () => {})
    await keepReminders([note('a', { reminder: { at: soon() } })])
    expect(silentHere()).toBe(false)
  })

  it('takes the library as it is when its turn comes, one look at a time', async () => {
    const when = soon()
    let release = () => {}
    // The device slow to answer the first look, and only that one.
    native.list = vi.fn(async () => ({ reminders: device })).mockImplementationOnce(() => new Promise<{ reminders: typeof device }>((resolve) => (release = () => resolve({ reminders: device }))))
    const first = keepReminders([note('a', { reminder: { at: when } })])
    await vi.waitFor(() => expect(native.list).toHaveBeenCalled())
    void keepReminders([note('a', { reminder: { at: when } }), note('b', { reminder: { at: when } })])
    const last = keepReminders([note('c', { reminder: { at: when } })])
    release()
    await first
    await last
    // The first look, then the last library given: the one between was never needed.
    expect(native.schedule.mock.calls.map(([one]) => one.id)).toEqual(['a', 'c'])
    expect(device.map((one) => one.id)).toEqual(['c'])
  })

  it('schedules a daily reminder as before, asking', async () => {
    const when = soon()
    await setReminder('daily-2026-10-09', when, 'Today’s pack is waiting.')
    expect(native.schedule).toHaveBeenCalledWith({ id: 'daily-2026-10-09', at: when, title: 'Today’s pack is waiting.', ask: true })
  })
})

describe('keeping in step while Nib is open', () => {
  afterEach(cleanup)
  const library = () => [note('a', { reminder: { at: Date.now() + 3_600_000 } })]
  const looked = () => vi.waitFor(() => expect(native.list).toHaveBeenCalled())

  it('waits for the library to be read: before that there are no notes to see, which isn’t a library with none', async () => {
    device = [{ id: 'a', at: Date.now() + 3_600_000, title: 'Note a' }]
    const { rerender } = renderHook(({ ready }) => useKeptReminders([], [], ready), { initialProps: { ready: false } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(native.list).not.toHaveBeenCalled()
    expect(native.cancel).not.toHaveBeenCalled()
    rerender({ ready: true })
    await looked()
  })

  it('looks again as Nib comes back to the front, and not as it goes to the back', async () => {
    const listed = library()
    renderHook(() => useKeptReminders(listed, [], true))
    await looked()
    await keepReminders(listed)
    native.list.mockClear()
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(native.list).not.toHaveBeenCalled()
    state.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await looked()
    state.mockRestore()
  })

  it('keeps the archive’s reminders too', async () => {
    const archived = library()
    renderHook(() => useKeptReminders([], archived, true))
    await vi.waitFor(() => expect(device.map((one) => one.id)).toEqual(['a']))
  })
})

describe('describing a time', () => {
  it('reads as the time today, tomorrow, a weekday this week, else the date', () => {
    expect(describeReminder(at(8, 19, 30), NOW)).toBe(clock(at(8, 19, 30)))
    expect(describeReminder(at(9, 9), NOW)).toBe(`Tomorrow ${clock(at(9, 9))}`)
    expect(describeReminder(at(12, 9), NOW)).toMatch(new RegExp(`^\\S+ ${clock(at(12, 9))}$`))
    expect(describeReminder(at(20, 9), NOW)).toContain('20')
  })

  it('offers an hour from now on the five minutes, this evening while it is still ahead, and tomorrow at nine', () => {
    expect(suggestedTimes(NOW)).toEqual([
      { label: 'In an hour', at: at(8, 8, 5) },
      { label: 'This evening', at: at(8, 18) },
      { label: 'Tomorrow morning', at: at(9, 9) },
    ])
    expect(suggestedTimes(at(8, 17, 30)).map((choice) => choice.label)).toEqual(['In an hour', 'Tomorrow morning'])
  })

  it('gives the date picker local time with no zone', () => {
    expect(toLocalInput(at(8, 7, 5))).toBe('2026-10-08T07:05')
  })
})

// Each look said so whatever it found, and each save looked: the whole app drawn again, and the device asked twice, for nothing.
describe('looking at what this device will ring, with nothing changed', () => {
  const later = () => Date.now() + 3_600_000
  const settled = () => act(() => new Promise<void>((done) => setTimeout(done, 30)))
  /** How many times what shows the reminders has been drawn. */
  function shown() {
    let drawn = 0
    renderHook(() => {
      drawn++
      useReminders()
    })
    return () => drawn
  }
  afterEach(cleanup)

  it('says nothing to what shows them, and says so once something has', async () => {
    device = [{ id: 'a', at: later(), title: 'Note a' }]
    await refreshReminders()
    const drawn = shown()
    const before = drawn()
    await act(() => refreshReminders())
    expect(drawn()).toBe(before)
    device = [...device, { id: 'b', at: later(), title: 'Note b' }]
    await act(() => refreshReminders())
    expect(drawn()).toBe(before + 1)
  })

  it('still says so when notifications turn out not to be allowed here, with nothing waiting either way', async () => {
    await keepReminders([])
    expect(silentHere()).toBe(false)
    const drawn = shown()
    const before = drawn()
    native.schedule = vi.fn(denied)
    await act(() => keepReminders([note('a', { reminder: { at: later() } })]))
    expect(silentHere()).toBe(true)
    expect(drawn()).toBeGreaterThan(before)
  })

  it('asks the device nothing for a save that changes nothing a reminder says', async () => {
    const when = later()
    const reminded = note('a', { reminder: { at: when } })
    const { rerender } = renderHook(({ listed }: { listed: Item[] }) => useKeptReminders(listed, [], true), { initialProps: { listed: [reminded, note('b')] } })
    await settled()
    const asked = native.list.mock.calls.length
    expect(asked).toBeGreaterThan(0)
    // Another note written in, and this one's text below its title.
    rerender({ listed: [{ ...reminded, rev: 2 }, { ...note('b'), body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note b, written in' }] }] } }] })
    await settled()
    expect(native.list.mock.calls.length).toBe(asked)
    rerender({ listed: [note('a', { reminder: { at: when + 60_000 } }), note('b')] })
    await settled()
    expect(native.list.mock.calls.length).toBeGreaterThan(asked)
    expect(device.find((one) => one.id === 'a')?.at).toBe(when + 60_000)
  })

  it('looks again as Nib comes back to the front, whatever has or hasn’t changed', async () => {
    renderHook(() => useKeptReminders([note('a', { reminder: { at: later() } })], [], true))
    await settled()
    const asked = native.list.mock.calls.length
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    await settled()
    expect(native.list.mock.calls.length).toBeGreaterThan(asked)
  })
})

describe('a submission’s follow-up', () => {
  const sent = (piece: object, fields: object = {}) => ({ at: 1, piece, where: 'Granta', followUp: '2026-10-20', ...fields }) as never
  const library = [note('p'), note('q', LOCKED), note('ch', { kind: 'page', folder: 'The Lighthouse/Part One' })]

  it('rings on its day at nine while it’s still waiting, saying where it went and what, and for nothing gone or answered', () => {
    const { ring, pending } = followUpsOf(
      {
        a: sent({ document: 'p' }),
        b: sent({ document: 'q' }, { answer: 'more', where: undefined }),
        c: sent({ book: 'The Lighthouse' }, { answer: 'shortlisted' }),
        d: sent({ document: 'p' }, { answer: 'declined' }),
        e: sent({ document: 'gone' }),
        f: sent({ document: 'p' }, { followUp: '2026-10-07' }),
        g: sent({ document: 'p' }, { followUp: undefined }),
        h: { at: 2, gone: true },
        // A book with no page left in its folder: renamed away from, removed, or all in the trash.
        i: sent({ book: 'Old Title' }),
      },
      library,
      NOW,
    )
    expect(ring).toEqual([
      { id: 'follow-a', at: at(20, 9), title: 'Follow up with Granta about Note p' },
      // A locked note's title is never said; an answer this Nib doesn't know is still waiting.
      { id: 'follow-b', at: at(20, 9), title: 'Follow up about A locked note' },
      { id: 'follow-c', at: at(20, 9), title: 'Follow up with Granta about The Lighthouse' },
    ])
    // Yesterday's has rung already, and one for a piece not here rings for nothing: each still kept, if snoozed.
    expect(pending.sort()).toEqual(['follow-a', 'follow-b', 'follow-c', 'follow-e', 'follow-f', 'follow-i'])
  })

  it('is in the device’s plan beside the notes’ own: kept while it’s due, its snooze kept while it’s waiting, cancelled once answered', () => {
    const followUps = followUpsOf({ a: sent({ document: 'p' }) }, library, NOW)
    const waiting = [{ id: 'follow-a', at: at(20, 9), title: 'Follow up with Granta about Note p' }, { id: 'follow-a', at: at(9, 9), snoozed: true }]
    expect(reminderPlan(library, waiting, NOW, followUps)).toEqual({ ring: [], cancel: [] })
    const answered = followUpsOf({ a: sent({ document: 'p' }, { answer: 'accepted' }) }, library, NOW)
    expect(reminderPlan(library, waiting, NOW, answered)).toEqual({ ring: [], cancel: ['follow-a'] })
  })

  it('when tapped, is for its piece, or says its submission is gone', () => {
    const submissions = { a: sent({ document: 'p' }), c: sent({ book: 'The Lighthouse' }), h: { at: 2, gone: true } } as never
    expect(followedUp('follow-a', submissions)).toEqual({ document: 'p' })
    expect(followedUp('follow-c', submissions)).toEqual({ book: 'The Lighthouse' })
    expect(followedUp('follow-h', submissions)).toBe('gone')
    expect(followedUp('follow-never', submissions)).toBe('gone')
    expect(followedUp('p', submissions)).toBeNull()
  })
})

