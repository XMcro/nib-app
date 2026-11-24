import { useEffect, useReducer, useState } from 'react'
import type { Item } from '../db/db'
import { readJson, writeJson } from './jsonStorage'
import { localDay, startOfDay } from './time'
import { KEEP_DAYS, recordFolders, recordHour } from './writingStats'
import { CALENDAR_KEY } from './yearCard'
import { recount, wordsToday } from './writtenHere'

/**
 * Goals. Free: the daily word goal, one target for all of the day's writing,
 * and a count of days in a row it was met. Nib Plus: a document's own goal,
 * with an optional deadline; sprints; and a calendar of words per day. All
 * but the document's goal are kept on this device.
 */

const GOAL_KEY = 'nib-goal'
const STREAK_KEY = 'nib-goal-streak'

/** About 26 weeks: what the calendar shows. It keeps more, KEEP_DAYS (lib/writingStats), for the year's stats. */
export const CALENDAR_DAYS = 182

/** The last day the goal was met, and how many days in a row that makes. */
type Streak = { last: string; count: number }

const DAY_MS = 86_400_000

/** The last day the goal was met and the run it made then, as kept: for the widgets (lib/widgets), which say whether it still stands. */
export const streakRecord = (): Streak => readJson<Streak>(STREAK_KEY, { last: '', count: 0 })
/** The daily goal as set, 0 for none, for what reads it outside the app's render (lib/invitations). */
export const readGoal = (): number => readJson<number>(GOAL_KEY, 0)

/** Records today if the goal is met, and returns the current run of days in a row. */
export function streakAfter(written: number, goal: number, now: number): number {
  const today = localDay(now)
  const yesterday = localDay(startOfDay(now) - 1)
  let streak = streakRecord()
  if (goal > 0 && written >= goal && streak.last !== today) {
    streak = { last: today, count: streak.last === yesterday ? streak.count + 1 : 1 }
    writeJson(STREAK_KEY, streak)
  }
  // A run survives until the end of the day after it was last met.
  return streak.last === today || streak.last === yesterday ? streak.count : 0
}

/**
 * Keeps today's count in the calendar, and lets go of days older than
 * KEEP_DAYS, past a year (lib/writingStats). Per device: words written elsewhere arrive already written, and
 * are counted on the device they were written on.
 */
export function recordDay(written: number, now: number) {
  const today = localDay(now)
  const calendar = readJson<Record<string, number>>(CALENDAR_KEY, {})
  if (calendar[today] === written || (written === 0 && !(today in calendar))) return
  calendar[today] = written
  const oldest = localDay(startOfDay(now) - (KEEP_DAYS - 1) * DAY_MS)
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
    const documents = [...notes, ...pages]
    const each = new Map<string, number>()
    written = wordsToday(documents, now, each)
    recordDay(written, now)
    // For the stats (lib/writingStats): the hour the words came in, and the books and folders they went into.
    recordHour(written, now)
    recordFolders(each, documents, now)
    if (goal > 0) progress = { goal, written, streak: streakAfter(written, goal, now) }
  }

  const change = (next: number) => {
    const value = Number.isFinite(next) ? Math.max(0, Math.min(100_000, Math.floor(next))) : 0
    setGoal(value)
    writeJson(GOAL_KEY, value)
  }
  return [progress, goal, change, written]
}
