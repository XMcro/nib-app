import type { Goal } from '../db/db'
import { localDay, startOfDay } from './time'

/** A document's own goal, with an optional deadline (Nib Plus): the one check on it, and what's said of it. */

export const MAX_GOAL_WORDS = 1_000_000

const DAY_MS = 86_400_000

const DEADLINE = /^\d{4}-\d{2}-\d{2}$/

/** Midnight at the start of a `YYYY-MM-DD` day, in the writer's time zone, or null if there is no such day. */
function deadlineStart(deadline: string): number | null {
  if (!DEADLINE.test(deadline)) return null
  const [year, month, day] = deadline.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  // Date rolls 2026-02-30 over into March rather than refusing it.
  return localDay(date.getTime()) === deadline ? date.getTime() : null
}

/**
 * The one check on a document's goal arriving from outside: a backup, or
 * another device. `undefined` means there was no usable goal in it, which
 * callers treat as saying nothing, never as "removed"; that is `null`.
 */
export function asGoal(raw: unknown): Goal | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'object' || raw === undefined || Array.isArray(raw)) return undefined
  const { words, deadline } = raw as Record<string, unknown>
  if (typeof words !== 'number' || !Number.isInteger(words) || words < 1 || words > MAX_GOAL_WORDS) return undefined
  const goal: Goal = { words }
  if (typeof deadline === 'string' && deadlineStart(deadline) !== null) goal.deadline = deadline
  return goal
}

/** "Nov 30", with the year only when it isn't this one. */
function describeDeadline(deadline: string, now: number): string {
  const date = new Date(deadlineStart(deadline) ?? now)
  const year = date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year })
}

/**
 * Words still to write each day to make the deadline, counting today. Null
 * when there's nothing left to write, no deadline, or the day has passed.
 */
export function perDay(goal: Goal, written: number, now: number): number | null {
  const remaining = goal.words - written
  const end = goal.deadline ? deadlineStart(goal.deadline) : null
  if (remaining <= 0 || end === null) return null
  // Rounded rather than floored, so a day an hour short across a clock
  // change still counts as a day.
  const days = Math.round((end - startOfDay(now)) / DAY_MS) + 1
  return days > 0 ? Math.ceil(remaining / days) : null
}

/** "1,240 of 5,000 · 310/day to make Nov 30", for the status line. */
export function describeGoal(goal: Goal, written: number, now: number): string {
  const progress = `${written.toLocaleString()} of ${goal.words.toLocaleString()}`
  if (written >= goal.words) return `${progress} · Goal met`
  if (!goal.deadline) return progress
  const day = describeDeadline(goal.deadline, now)
  const pace = perDay(goal, written, now)
  return pace === null ? `${progress} · ${day} has passed` : `${progress} · ${pace.toLocaleString()}/day to make ${day}`
}
