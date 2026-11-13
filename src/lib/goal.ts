import { useEffect, useReducer, useState } from 'react'
import type { Item } from '../db/db'
import { readJson, writeJson } from './jsonStorage'
import { localDay, startOfDay } from './time'
import { recount, wordsToday } from './writtenHere'

/**
 * Goals. Free: the daily word goal, one target for all of the day's writing,
 * and a count of days in a row it was met. Nib Plus: a document's own goal,
 * with an optional deadline; sprints; and a calendar of words per day. All
 * but the document's goal are kept on this device.
 */

const GOAL_KEY = 'nib-goal'
const STREAK_KEY = 'nib-goal-streak'
const CALENDAR_KEY = 'nib-goal-calendar'

/** About 26 weeks. */
export const CALENDAR_DAYS = 182

/** The last day the goal was met, and how many days in a row that makes. */
type Streak = { last: string; count: number }

const DAY_MS = 86_400_000

/** Records today if the goal is met, and returns the current run of days in a row. */
export function streakAfter(written: number, goal: number, now: number): number {
  const today = localDay(now)
  const yesterday = localDay(startOfDay(now) - 1)
  let streak = readJson<Streak>(STREAK_KEY, { last: '', count: 0 })
  if (goal > 0 && written >= goal && streak.last !== today) {
    streak = { last: today, count: streak.last === yesterday ? streak.count + 1 : 1 }
    writeJson(STREAK_KEY, streak)
  }
  // A run survives until the end of the day after it was last met.
  return streak.last === today || streak.last === yesterday ? streak.count : 0
}

/**
 * Keeps today's count in the calendar, and lets go of days older than about
 * 26 weeks. Per device: words written elsewhere arrive already written, and
 * are counted on the device they were written on.
 */
export function recordDay(written: number, now: number) {
  const today = localDay(now)
  const calendar = readJson<Record<string, number>>(CALENDAR_KEY, {})
  if (calendar[today] === written || (written === 0 && !(today in calendar))) return
  calendar[today] = written
  const oldest = localDay(startOfDay(now) - (CALENDAR_DAYS - 1) * DAY_MS)
  for (const day of Object.keys(calendar)) if (day < oldest) delete calendar[day]
  writeJson(CALENDAR_KEY, calendar)
}

/** Words per day, by `YYYY-MM-DD`. Days with nothing written are missing. */
export function readCalendar(): Record<string, number> {
  return readJson<Record<string, number>>(CALENDAR_KEY, {})
}

export type DailyGoal = { goal: number; written: number; streak: number }

/**
 * The goal for the editor to show, or null when there is none (or it's off:
 * outside the app); and the words written today, goal or none, for the day's
 * stamp (lib/rewards).
 */
export function useDailyGoal(notes: Item[], pages: Item[], enabled: boolean): [DailyGoal | null, number, (goal: number) => void, number] {
  const [goal, setGoal] = useState(() => readJson<number>(GOAL_KEY, 0))
  // Counted on every render rather than cached: the day turns over at
  // midnight, and a new document is marked just after its save lands, and
  // neither changes the documents. Both simply ask for another render.
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const timer = setInterval(rerender, 60_000)
    recount.add(rerender)
    return () => {
      clearInterval(timer)
      recount.delete(rerender)
    }
  }, [])

  let progress: DailyGoal | null = null
  let written = 0
  // Counted goal or no goal, Plus or not, or the calendar would miss the days
  // before one was set, or before Plus.
  if (enabled) {
    const now = Date.now()
    written = wordsToday([...notes, ...pages], now)
    recordDay(written, now)
    if (goal > 0) progress = { goal, written, streak: streakAfter(written, goal, now) }
  }

  const change = (next: number) => {
    const value = Number.isFinite(next) ? Math.max(0, Math.min(100_000, Math.floor(next))) : 0
    setGoal(value)
    writeJson(GOAL_KEY, value)
  }
  return [progress, goal, change, written]
}
