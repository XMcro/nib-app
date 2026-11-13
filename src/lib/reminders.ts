import { useEffect, useReducer } from 'react'
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { Item, Reminder, Repeat } from '../db/db'
import * as items from '../db/items'
import { readJson, writeJson } from './jsonStorage'
import { nativeApp } from './platform'
import { titleOf } from './text'
import { isTime } from './time'
import { isLocked } from './vault'

/**
 * A reminder on a note: a notification at a time the writer picks. One per
 * note: setting another moves it.
 *
 * The note is the record (`Item.reminder`), so it goes where the note goes:
 * to the writer's other devices by sync, and into backups. Nothing rings from
 * a server. Each device schedules its own notification for every note of its
 * library with a reminder still to come
 * (ios/App/App/NibRemindersPlugin.swift), and keeps that in step as the
 * library changes (`keepReminders`): set or moved on another device, the note
 * trashed or put back, its title changed, locked into the vault. A device
 * that hasn't allowed Nib's notifications stays silent and is never asked
 * unprompted: only setting a reminder by hand asks.
 *
 * One can repeat: at the same hour each day, week, month or year. The note
 * keeps when it first rang and how it repeats; when it comes next is worked
 * out from those (`nextAt`), the way the device's own calendar does it.
 */

interface NibReminders {
  /** `ask: false` schedules only where notifications are already allowed, and is refused as `denied` otherwise without asking. */
  schedule(options: { id: string; at: number; title: string; ask?: boolean; repeat?: Repeat }): Promise<void>
  cancel(options: { ids: string[] }): Promise<void>
  list(): Promise<{ reminders: Waiting[] }>
  addListener(event: 'open', listener: (data: { id: string }) => void): Promise<PluginListenerHandle>
}

/**
 * A notification this device has waiting: whose, when next, the title it was
 * given, and how it repeats, if it does. `snoozed`: not the note's own but
 * one put off from its notification, on this device ("Remind me in an hour"),
 * which waits beside the note's own.
 */
type Waiting = { id: string; at: number; title?: string; repeat?: string; snoozed?: boolean }

export const reminderPlugin = registerPlugin<NibReminders>('NibReminders')

/** Only the app can ring. */
export const remindersAvailable = nativeApp

/** What a reminder on a locked note says, in place of its title. */
export const LOCKED_REMINDER = 'A locked note'

/** The daily reminder's ids among the device's (lib/dailyReminder): this, then a day. Never a note's, and not this file's to keep. */
export const DAILY = 'daily-'

export class ReminderError extends Error {
  readonly reason: 'denied' | 'past' | 'failed'
  constructor(reason: ReminderError['reason'], message: string) {
    super(message)
    this.name = 'ReminderError'
    this.reason = reason
  }
}

/** The ways one repeats, as the device knows them too (NibRemindersPlugin.swift). */
export const REPEATS = ['day', 'week', 'month', 'year'] as const
const asRepeat = (raw: unknown): Repeat | undefined => (REPEATS.includes(raw as Repeat) ? (raw as Repeat) : undefined)
const REPEAT_WORDS: Record<Repeat, string> = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }

/** How it repeats, in a word, or nothing for one that doesn't. */
export const repeatWord = (reminder: Reminder | null | undefined) => (reminder?.repeat ? REPEAT_WORDS[reminder.repeat] : '')

/** The one check on a reminder arriving from outside (lib/documentFields): a time and perhaps a way of repeating, null for taken off, or nothing said. */
export function asReminder(raw: unknown): Reminder | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'object' || raw === undefined || Array.isArray(raw)) return undefined
  const { at, repeat } = raw as Record<string, unknown>
  if (!isTime(at)) return undefined
  return asRepeat(repeat) ? { at, repeat: asRepeat(repeat) } : { at }
}

/**
 * The time `turns` turns from its first: the same hour that many days, weeks,
 * months or years on (or back), by the calendar, so through a change of the
 * clocks. Null where that month has no such date: the 31st, or the 29th of
 * February. The device rings on none there, and so does this.
 */
function turned(at: number, repeat: Repeat, turns: number): number | null {
  const first = new Date(at)
  const [year, month, date] = [first.getFullYear(), first.getMonth(), first.getDate()]
  const on = (y: number, m: number, d: number) => new Date(y, m, d, first.getHours(), first.getMinutes(), first.getSeconds(), first.getMilliseconds())
  if (repeat === 'day') return on(year, month, date + turns).getTime()
  if (repeat === 'week') return on(year, month, date + 7 * turns).getTime()
  const then = repeat === 'month' ? on(year, month + turns, date) : on(year + turns, month, date)
  return then.getDate() === date ? then.getTime() : null
}

const DAY_MS = 86_400_000

/** When it comes next, after `now`: its own time until that has passed, then its next turn if it repeats. */
export function nextAt(reminder: Reminder, now: number): number | undefined {
  if (reminder.at > now) return reminder.at
  const { at, repeat } = reminder
  if (!repeat) return undefined
  // One begun long ago: near the turn at once for the short ones, a turn early for a change of the clocks, then turn by turn.
  const span = repeat === 'day' ? DAY_MS : repeat === 'week' ? 7 * DAY_MS : Infinity
  for (let turns = Math.max(1, Math.floor((now - at) / span) - 1); ; turns++) {
    const then = turned(at, repeat, turns)
    if (then !== null && then > now) return then
  }
}

/** When this note's reminder comes next, if it has one still to come. */
export function reminderOf(item: Item | undefined, now = Date.now()): number | undefined {
  return item?.reminder ? nextAt(item.reminder, now) : undefined
}

/** What its notification says: its title, and never a locked note's. */
const saidOf = (item: Item) => (isLocked(item) ? LOCKED_REMINDER : titleOf(item.body))

/** A notification a device is to have waiting: `at` its next time, and `repeat` if it's to come round by itself from there. */
type Ring = { id: string; at: number; title: string; repeat?: Repeat }

/**
 * The notification for this note's reminder, if it has one still to come.
 * A device's repeating notification rings at the next day, weekday or date
 * that fits, whenever that is: so one that begins more than a turn away is
 * to ring once, at its beginning, and repeat only once it's within a turn,
 * by a later look. (Never looked at again before its second turn, that turn
 * is missed. So is the next turn of one rung a turn at a time, below.)
 */
function ringFor(item: Item, now: number): Ring | undefined {
  const at = reminderOf(item, now)
  if (at === undefined) return undefined
  const once = { id: item.id, at, title: saidOf(item) }
  const repeat = item.reminder!.repeat
  if (!repeat) return once
  // The turn before it: back past the months with no such date.
  let before: number | null = null
  for (let turns = -1; before === null; turns--) before = turned(at, repeat, turns)
  // A date not every month has, or every year: the device's own repeat rings on the 1st after a month without it,
  // where the note has none that month. Rung a turn at a time instead, each set by the look after the last.
  const date = new Date(at)
  const sometimes = (repeat === 'month' && date.getDate() > 28) || (repeat === 'year' && date.getMonth() === 1 && date.getDate() === 29)
  return before > now || sometimes ? once : { ...once, repeat }
}

/**
 * What this device has to do for its notifications to be those of
 * `documents`, the library out of the trash: ring for each reminder still to
 * come that it isn't waiting to ring as it is now (another time, another
 * title, or repeating another way), and cancel what it's waiting to ring for
 * anything else: a reminder taken off, a note in the trash or gone. The daily
 * reminder's are left alone. So is one snoozed here, while its note still has
 * a reminder, though that one's time has passed; cancelling a note's cancels
 * both.
 */
export function reminderPlan(documents: Item[], waiting: Waiting[], now: number): { ring: Ring[]; cancel: string[] } {
  const wanted = new Map(documents.flatMap((item) => { const ring = ringFor(item, now); return ring ? [[item.id, ring] as const] : [] }))
  const mine = waiting.filter((one) => !one.id.startsWith(DAILY) && !one.snoozed)
  const as = new Map(mine.map((one) => [one.id, one]))
  const reminded = new Set(documents.filter((item) => item.reminder).map((item) => item.id))
  // The device says its times to the second.
  const waited = (one: Ring) => { const has = as.get(one.id); return has !== undefined && Math.abs(has.at - one.at) < 1000 && has.title === one.title && asRepeat(has.repeat) === one.repeat }
  return {
    ring: [...wanted.values()].filter((one) => !waited(one)),
    cancel: [...new Set([...mine.filter((one) => !wanted.has(one.id)), ...waiting.filter((one) => one.snoozed && !reminded.has(one.id))].map((one) => one.id))],
  }
}

/**
 * Reminders from a Nib that kept them on the device alone: those it's
 * waiting to ring for notes that say nothing of a reminder. Not one whose
 * note says it was taken off (`null`), which another device did since.
 */
export function unkept(documents: Item[], waiting: Waiting[]): { id: string; at: number }[] {
  const said = new Map(documents.map((item) => [item.id, item.reminder]))
  return waiting.filter((one) => !one.id.startsWith(DAILY) && !one.snoozed && said.has(one.id) && said.get(one.id) === undefined).map(({ id, at }) => ({ id, at }))
}

/** What this device is waiting to ring, as it last said: each note's own, and those snoozed here. */
let waiting = new Map<string, Waiting>()
let snoozes = new Map<string, number>()
/** It wouldn't schedule one, unasked: notifications aren't allowed here. */
let silent = false
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

/** This device has a reminder it won't ring: Nib's notifications aren't allowed on it. */
export const silentHere = () => silent

export async function refreshReminders(): Promise<void> {
  if (!remindersAvailable) return
  const { reminders } = await reminderPlugin.list()
  waiting = new Map(reminders.filter((reminder) => !reminder.snoozed).map((reminder) => [reminder.id, reminder]))
  snoozes = new Map(reminders.filter((reminder) => reminder.snoozed).map((reminder) => [reminder.id, reminder.at]))
  changed()
}

/** Until when this note's reminder is snoozed on this device, if it is. */
export function snoozedFor(id: string, now = Date.now()): number | undefined {
  const at = snoozes.get(id)
  return at !== undefined && at > now ? at : undefined
}

/**
 * A notification on this device, at `at`. `ask`: by the writer's own hand, so
 * the device may ask to be allowed; without, it's scheduled only where it
 * already is. Throws a ReminderError saying why not.
 */
export async function setReminder(id: string, at: number, title: string, ask = true, repeat?: Repeat): Promise<void> {
  try {
    await reminderPlugin.schedule({ id, at, title, ask, ...(repeat ? { repeat } : {}) })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'denied') {
      throw new ReminderError('denied', 'Notifications are off for Nib. Turn them on in Settings, under Notifications.')
    }
    if (code === 'past') throw new ReminderError('past', 'That time has passed.')
    throw new ReminderError('failed', 'Couldn’t set the reminder.')
  }
  waiting.set(id, { id, at, title, repeat })
  changed()
}

/**
 * A reminder set on this note, by hand, to repeat or not: on this device
 * first, which may ask to be allowed and says so if it isn't, then on the
 * note, for the others.
 */
export async function remind(item: Item, at: number, repeat: Repeat | null = null): Promise<void> {
  const reminder: Reminder = repeat ? { at, repeat } : { at }
  const ring = ringFor({ ...item, reminder }, Date.now())
  // No ring for a time that has passed and comes round no more: the device says so.
  await setReminder(item.id, ring?.at ?? at, saidOf(item), true, ring?.repeat)
  silent = false
  await items.setReminder(item.id, reminder)
}

/** The reminder off this note, everywhere: this device stops waiting as its library changes (`keepReminders`). */
export const forget = (id: string) => items.setReminder(id, null)

const KEPT_KEY = 'nib-reminders-kept'

/** One at a time, and the library as it is when its turn comes. */
let turn: Promise<void> = Promise.resolve()
let latest: Item[] | null = null

/**
 * Brings this device's notifications in step with `documents`: the whole
 * library out of the trash, once it has been read. Never before: an empty
 * list would say every reminder had gone. Once, first, takes into their notes
 * the reminders an earlier Nib kept on this device alone.
 */
export function keepReminders(documents: Item[]): Promise<void> {
  latest = documents
  turn = turn
    .then(async () => {
      if (!remindersAvailable || !latest) return
      let library = latest
      latest = null
      const { reminders } = await reminderPlugin.list()
      if (!readJson(KEPT_KEY, false)) {
        const found = unkept(library, reminders)
        for (const { id, at } of found) await items.setReminder(id, { at })
        writeJson(KEPT_KEY, true)
        const taken = new Map(found.map((one) => [one.id, one.at]))
        library = library.map((item) => (taken.has(item.id) ? { ...item, reminder: { at: taken.get(item.id)! } } : item))
      }
      const plan = reminderPlan(library, reminders, Date.now())
      if (plan.cancel.length) await reminderPlugin.cancel({ ids: plan.cancel })
      silent = false
      for (const one of plan.ring) {
        try {
          // Taken down first, if it has rung already: a title it shows may be a note's since locked.
          await reminderPlugin.cancel({ ids: [one.id] })
          await setReminder(one.id, one.at, one.title, false, one.repeat)
        } catch (error) {
          if (!(error instanceof ReminderError) || error.reason !== 'denied') throw error
          // Not allowed here, and not asked: none of them will ring.
          silent = true
          break
        }
      }
      await refreshReminders()
    })
    .catch((error: unknown) => console.warn('Nib: could not keep the reminders', error))
  return turn
}

/**
 * Keeps this device's notifications in step with the library (`keepReminders`)
 * as it changes and as Nib comes back to the front, where a reminder that has
 * rung has dropped out, or notifications have been allowed in Settings since.
 * `ready`: the library has been read.
 */
export function useKeptReminders(listed: Item[], archived: Item[], ready: boolean) {
  useEffect(() => {
    if (!ready) return
    const keep = () => {
      // Only in front: what an earlier Nib left is written into its notes, and a write as Nib goes to the back is cut off.
      if (document.visibilityState === 'visible') void keepReminders([...listed, ...archived])
    }
    keep()
    document.addEventListener('visibilitychange', keep)
    return () => document.removeEventListener('visibilitychange', keep)
  }, [listed, archived, ready])
}

/** Re-renders when what this device will ring changes. */
export function useReminders() {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    listeners.add(rerender)
    return () => void listeners.delete(rerender)
  }, [])
}

const minutes = (date: Date) => date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const dayStart = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)

/** "7:15 PM" today, "Tomorrow 9:00 AM", "Thu 9:00 AM" this week, else "10 Oct 9:00 AM" (in the device's own format). */
export function describeReminder(at: number, now = Date.now()): string {
  const date = new Date(at)
  const days = Math.round((dayStart(at) - dayStart(now)) / 86_400_000)
  if (days === 0) return minutes(date)
  if (days === 1) return `Tomorrow ${minutes(date)}`
  if (days > 1 && days < 7) return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${minutes(date)}`
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${minutes(date)}`
}

/** Quick choices: in an hour, this evening while it's still to come, and tomorrow morning. */
export function suggestedTimes(now = Date.now()): { label: string; at: number }[] {
  const hour = Math.ceil((now + 60 * 60_000) / (5 * 60_000)) * 5 * 60_000
  const evening = new Date(now).setHours(18, 0, 0, 0)
  const morning = new Date(dayStart(now) + 86_400_000 * 1.5).setHours(9, 0, 0, 0)
  return [
    { label: 'In an hour', at: hour },
    ...(evening - now > 60 * 60_000 ? [{ label: 'This evening', at: evening }] : []),
    { label: 'Tomorrow morning', at: morning },
  ]
}

/** `<input type="datetime-local">` wants local time with no zone: "2026-10-08T07:15". */
export function toLocalInput(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
