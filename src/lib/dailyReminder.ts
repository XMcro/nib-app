import { useEffect, useState } from 'react'
import { localDay } from './time'
import { readJson, writeJson } from './jsonStorage'
import { DAILY, reminderPlugin, remindersAvailable, setReminder } from './reminders'

/**
 * The daily reminder, free, in the app: a notification at a time the writer
 * picks, on each day whose pack (lib/rewards) is still to open. Offered once,
 * when the first pack is put away; on and off in Settings → Goals. Scheduled
 * on this device like a note's reminder (lib/reminders): a fortnight ahead,
 * topped up whenever Nib comes to the front, with today's taken off the
 * moment today's pack is opened. So it never rings on a day it's been
 * opened, and goes quiet after two weeks away.
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

/** Every daily reminder waiting replaced with these; none, for `time` null. Throws ReminderError when notifications are off for Nib. */
async function reschedule(time: string | null, openedToday: boolean) {
  const { reminders } = await reminderPlugin.list()
  const waiting = reminders.map((reminder) => reminder.id).filter((id) => id.startsWith(DAILY))
  if (waiting.length) await reminderPlugin.cancel({ ids: waiting })
  if (time === null) return
  for (const { id, at } of dailyTimes(time, Date.now(), openedToday)) await setReminder(id, at, DAILY_TITLE)
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
}

export function useDailyReminder(openedToday: boolean): DailyReminder {
  const [time, setTime] = useState(() => readJson<string | null>(TIME_KEY, null))
  const [asked, setAsked] = useState(dailyAsked)

  useEffect(() => {
    if (!remindersAvailable || time === null) return
    const refresh = () => {
      if (document.visibilityState === 'visible') reschedule(time, openedToday).catch((error) => console.warn('Nib: could not set the daily reminder', error))
    }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [time, openedToday])

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
  }
}
