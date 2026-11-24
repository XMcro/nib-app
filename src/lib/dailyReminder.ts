import { useEffect, useState } from 'react'
import { localDay } from './time'
import { readJson, writeJson } from './jsonStorage'
import { DAILY, reminderPlugin, remindersAvailable, setReminder } from './reminders'
import { ahead, declineInvitations, invitationsOn, inviteTime, keepSent, onInvitationChange, setInvitationsOn, usualHours, type Invitation } from './invitations'
import { readCalendar, readGoal, streakRecord } from './goal'
import { readHours } from './writingStats'
import { lock } from './lock'
import { nativeApp } from './platform'

/**
 * The daily reminder, free, in the app: a notification at a time the writer
 * picks, on each day whose pack (lib/rewards) is still to open. Offered once,
 * when the first pack is put away; on and off in Settings → Goals. Scheduled
 * on this device like a note's reminder (lib/reminders): a fortnight ahead,
 * topped up whenever Nib comes to the front, with today's taken off the
 * moment today's pack is opened. So it never rings on a day it's been
 * opened, and goes quiet after two weeks away.
 *
 * Its slot is a day's one notification from Nib (lib/invitations, free):
 * with invitations on, each of the next week's days has the day's invitation
 * in it in place of the pack's line, at the reminder's time if it's on, or
 * else just before the writer's usual hour. One a day in all.
 */

const TIME_KEY = 'nib-daily-reminder'
const ASKED_KEY = 'nib-daily-asked'

/** A daily reminder's id among the reminders (lib/reminders `DAILY`): that, then its day, `daily-2026-11-05`. Never a note's. */
export { DAILY }
export const DAYS_AHEAD = 14
/** Short enough for a banner's one line. */
export const DAILY_TITLE = 'Today’s pack is waiting.'
/** Evening, so the day has had its chance first. */
export const DEFAULT_TIME = '19:00'

/** When to ring, from today for a fortnight, at `time` ("HH:MM", the writer's own clock): today too, if it's still to come and not yet written on. */
export function dailyTimes(time: string, now: number, openedToday: boolean): { id: string; at: number }[] {
  const [hours, minutes] = time.split(':').map(Number)
  const times: { id: string; at: number }[] = []
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const date = new Date(now)
    date.setDate(date.getDate() + i)
    date.setHours(hours, minutes, 0, 0)
    if (i === 0 && (openedToday || date.getTime() <= now)) continue
    times.push({ id: DAILY + localDay(date.getTime()), at: date.getTime() })
  }
  return times
}

/** At "HH:MM" on the local day `date` is on. */
function timeOn(date: Date, time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  const at = new Date(date)
  at.setHours(hours, minutes, 0, 0)
  return at.getTime()
}

/**
 * Each day's one notification for the next fortnight: its invitation where it
 * has one, at the reminder's time or `inviting`'s; else, with the reminder on,
 * the pack's line at its time (`dailyTimes`). None whose time has passed.
 */
export function slots(time: string | null, openedToday: boolean, now: number, invitations: { day: string; invitation: Invitation }[], inviting: string): { id: string; at: number; title: string }[] {
  const byDay = new Map(invitations.map(({ day, invitation }) => [day, invitation]))
  const pack = new Map(time === null ? [] : dailyTimes(time, now, openedToday).map(({ id, at }) => [id, at]))
  const out: { id: string; at: number; title: string }[] = []
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const date = new Date(now)
    date.setDate(date.getDate() + i)
    const day = localDay(date.getTime())
    const invitation = byDay.get(day)
    if (invitation) {
      const at = timeOn(date, time ?? inviting)
      if (at > now) out.push({ id: DAILY + day, at, title: invitation.text })
    } else if (pack.has(DAILY + day)) out.push({ id: DAILY + day, at: pack.get(DAILY + day)!, title: DAILY_TITLE })
  }
  return out
}

/** The week's invitations, as they stand now; none while they're off. Lock Nib's asked of the device: no book named while it's on. */
async function invitationsNow(now: number) {
  if (!invitationsOn()) return []
  // Not known is as on: a line that names a book is only for a device known to show it to its writer alone.
  const locked = nativeApp ? await lock.status().then((status) => status.enabled, () => true) : false
  return ahead({ now, calendar: readCalendar(), streak: streakRecord(), goal: readGoal(), locked })
}

/** Today's slot while it holds an invitation: its id and when it rings (`reschedule`). */
const INVITED_KEY = 'nib-invitation-set'

/** One at a time (`reschedule`). */
let turn: Promise<unknown> = Promise.resolve()

/**
 * The daily reminders waiting made these; none, for `time` null. Throws ReminderError when notifications are off for Nib.
 * Only what differs is touched: those already waiting at their times are left, where every one was taken off and set
 * again, sixteen calls each time Nib came to the front. And one at a time: as a new day begins two are asked for at
 * once, and each could take off what the other had just set.
 */
export function reschedule(time: string | null, openedToday: boolean): Promise<void> {
  const mine = turn.then(async () => {
    const { reminders } = await reminderPlugin.list()
    const waiting = new Map(reminders.filter((reminder) => reminder.id.startsWith(DAILY)).map((reminder) => [reminder.id, reminder]))
    const now = Date.now()
    const invitations = await invitationsNow(now)
    // One a day: today's invitation, once its time has come, has rung, and today has no other. Without this, anything
    // that moved the slot's time later (the reminder's time changed or turned off, a new year's hours, a flight
    // west) set it again, and it rang twice. The time it was last set for is kept, while it's still to come.
    const today = DAILY + localDay(now)
    const set = readJson<{ id: string; at: number } | null>(INVITED_KEY, null)
    const rung = set?.id === today && set.at <= now
    // And none once the writer has written, as invitations promise when they're offered: not the pack's line in its place.
    const written = invitationsOn() && (readCalendar()[localDay(now)] ?? 0) > 0
    const wanted = slots(time, openedToday, now, invitations, inviteTime(usualHours(readHours(), now))).filter(({ id }) => !((rung || written) && id === today))
    // The device says its times to the second. A day's line changes as the days ahead do.
    const there = new Set(wanted.filter(({ id, at, title }) => { const has = waiting.get(id); return has !== undefined && Math.abs(has.at - at) < 1000 && has.title === title }).map(({ id }) => id))
    const gone = [...waiting.keys()].filter((id) => !there.has(id))
    if (gone.length) await reminderPlugin.cancel({ ids: gone })
    for (const { id, at, title } of wanted) if (!there.has(id)) await setReminder(id, at, title)
    keepSent(invitations, now)
    const mine = wanted.find(({ id }) => id === today)
    if (!rung) writeJson(INVITED_KEY, mine && mine.title !== DAILY_TITLE ? { id: today, at: mine.at } : null)
  })
  turn = mine.catch(() => {})
  return mine
}

/** Offered already, whatever the answer, or set in Settings without being offered. */
export const dailyAsked = () => readJson(ASKED_KEY, false)

export type DailyReminder = {
  /** "HH:MM", or null while it's off. */
  time: string | null
  /** Offered already, whatever the answer. */
  asked: boolean
  /** On at a time, or off with null. Throws ReminderError, and stays as it was, when it couldn't be set. */
  change: (time: string | null) => Promise<void>
  /** Not now: not offered again. */
  decline: () => void
  /** Invitations to write (lib/invitations): on or off. */
  invitations: boolean
  /** On asks iOS the first time, and throws ReminderError, staying off, when notifications are off for Nib. */
  changeInvitations: (on: boolean) => Promise<void>
  /** Offered and turned down: not offered again. */
  declineInvitations: () => void
}

export function useDailyReminder(openedToday: boolean): DailyReminder {
  const [time, setTime] = useState(() => readJson<string | null>(TIME_KEY, null))
  const [asked, setAsked] = useState(dailyAsked)
  const [invitations, setInvitations] = useState(invitationsOn)

  useEffect(() => {
    if (!remindersAvailable || (time === null && !invitations)) return
    // Coming to the front, and going from it, when the day ahead is best known; and the day's first words, which take its invitation off.
    const refresh = () => void reschedule(time, openedToday).catch((error) => console.warn('Nib: could not set the daily reminder', error))
    refresh()
    document.addEventListener('visibilitychange', refresh)
    const stop = onInvitationChange(refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      stop()
    }
  }, [time, openedToday, invitations])

  return {
    time,
    asked,
    change: async (next) => {
      await reschedule(next, openedToday)
      writeJson(TIME_KEY, next)
      setTime(next)
      writeJson(ASKED_KEY, true)
      setAsked(true)
    },
    decline: () => {
      writeJson(ASKED_KEY, true)
      setAsked(true)
    },
    invitations,
    changeInvitations: async (on) => {
      setInvitationsOn(on)
      try {
        await reschedule(time, openedToday)
      } catch (error) {
        // Notifications off for Nib: off again, and said why.
        if (on) {
          setInvitationsOn(false)
          await reschedule(time, openedToday).catch(() => {})
        }
        throw error
      }
      setInvitations(on)
    },
    declineInvitations,
  }
}
