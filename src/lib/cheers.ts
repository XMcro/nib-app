import { useEffect, useRef, useSyncExternalStore } from 'react'
import { readCalendar, type DailyGoal } from './goal'
import type { SprintDone } from './sprint'
import { localDay, startOfDay } from './time'

/**
 * The writing buddy cheering you on (components/Buddy): a line by its corner,
 * at most once a day, when you come back after days away, meet the day's
 * goal, take a piece past a milestone, or finish a sprint. Each is seen
 * happen while Nib is open, not found already done. The day it last spoke is
 * kept on this device.
 */

const SPOKE_KEY = 'nib-buddy-spoke'
const DAY_MS = 86_400_000

/** Days without writing that make a welcome back. */
export const AWAY_DAYS = 3
/** A piece's word counts worth a word. */
export const MILESTONES = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000]

export type Moment = { kind: 'back'; title?: string } | { kind: 'goal' } | { kind: 'milestone'; words: number } | { kind: 'sprint'; minutes: number; written: number }

const count = (n: number) => n.toLocaleString('en-GB')
/** A title short enough for the bubble. */
const short = (title: string) => (title.length > 40 ? `${title.slice(0, 39).trimEnd()}…` : title)

const MILESTONE_LINES: Record<number, string> = {
  1_000: 'A real start.',
  5_000: 'It’s taking shape.',
  10_000: 'That’s a proper body of work.',
  25_000: 'You’re a long way in.',
  50_000: 'That’s a lot of ink.',
  100_000: 'Remarkable.',
}

/** What the buddy says for a moment: one of a few, so it doesn't always say the same. */
export function lineFor(moment: Moment, pick: () => number = Math.random): string {
  const one = (lines: string[]) => lines[Math.floor(pick() * lines.length)]
  switch (moment.kind) {
    case 'back':
      return moment.title
        ? one([`Welcome back. “${short(moment.title)}” is where you left off.`, `Good to see you. “${short(moment.title)}” kept your place.`])
        : one(['Welcome back. Your writing is just where you left it.', 'Good to see you again.'])
    case 'goal':
      return one(['That’s today’s goal met. Nicely done.', 'Goal reached. Anything more is a bonus.', 'Today’s words are in. Well done.'])
    case 'milestone':
      return `${count(moment.words)} words in this one. ${MILESTONE_LINES[moment.words] ?? ''}`.trim()
    case 'sprint':
      return one([`${count(moment.written)} ${moment.written === 1 ? 'word' : 'words'} in ${moment.minutes} minutes. Good sprint.`, `Sprint done: ${count(moment.written)} ${moment.written === 1 ? 'word' : 'words'}. Have a stretch.`])
  }
}

/** Whole days since the last day anything was written, before today; null for a writer with none. */
export function daysAway(calendar: Record<string, number>, now: number): number | null {
  const today = localDay(now)
  const last = Object.keys(calendar)
    .filter((day) => day < today && calendar[day] > 0)
    .sort()
    .at(-1)
  if (!last) return null
  const [year, month, day] = last.split('-').map(Number)
  return Math.round((startOfDay(now) - new Date(year, month - 1, day).getTime()) / DAY_MS)
}

/** The largest milestone a piece went past, from one count to the next, if any. */
export function passed(before: number, after: number): number | null {
  return MILESTONES.filter((words) => before < words && after >= words).at(-1) ?? null
}

function spokeOn(): string | null {
  try {
    return localStorage.getItem(SPOKE_KEY)
  } catch {
    return spokeUnstored
  }
}
/** The day it spoke, with storage off, for this session. */
let spokeUnstored: string | null = null

/** The line waiting to be said, until the corner can say it. */
let waiting: string | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const tell = () => listeners.forEach((listener) => listener())

/** A moment to cheer: kept for the corner, unless it has spoken today or has a line waiting already. */
export function cheer(moment: Moment, now = Date.now()) {
  if (waiting || spokeOn() === localDay(now)) return
  waiting = lineFor(moment)
  tell()
}

/** The line waiting to be said, if any. */
export const useCheer = () => useSyncExternalStore(subscribe, () => waiting)

/** Said: none other today. */
export function spoke(now = Date.now()) {
  spokeUnstored = localDay(now)
  try {
    localStorage.setItem(SPOKE_KEY, spokeUnstored)
  } catch {
    // Storage off: once a day for this session.
  }
  waiting = null
  tell()
}

/** Forgets a line not yet said: the buddy was turned off. */
export function hush() {
  waiting = null
  tell()
}

/** The open piece, as the buddy counts it: unlocked, with its words. */
export type Open = { id: string; words: number }

/**
 * Watches for the moments to cheer, while the buddy is on: a welcome back
 * once the library is in (with the title of the piece last written in, if it
 * has one and isn't locked), and the goal, a milestone or a sprint as each
 * happens, never one found already done.
 */
export function useCheers({ on, ready, last, goal, sprint, open }: { on: boolean; ready: boolean; last: () => string | undefined; goal: DailyGoal | null; sprint: SprintDone | null; open: Open | null }) {
  const welcomed = useRef(false)
  useEffect(() => {
    if (!on || !ready || welcomed.current) return
    welcomed.current = true
    const away = daysAway(readCalendar(), Date.now())
    if (away !== null && away >= AWAY_DAYS) cheer({ kind: 'back', title: last() })
  }, [on, ready, last])

  const met = goal ? goal.goal > 0 && goal.written >= goal.goal : null
  const wasMet = useRef(met)
  useEffect(() => {
    if (on && wasMet.current === false && met === true) cheer({ kind: 'goal' })
    wasMet.current = met
  }, [on, met])

  // Read from storage each render (lib/sprint), so by what it holds, not which object.
  const minutes = sprint?.minutes ?? null
  const written = sprint?.written ?? null
  const hadEnded = useRef(minutes !== null)
  useEffect(() => {
    if (on && !hadEnded.current && minutes !== null && written) cheer({ kind: 'sprint', minutes, written })
    hadEnded.current = minutes !== null
  }, [on, minutes, written])

  const before = useRef(open)
  useEffect(() => {
    const was = before.current
    before.current = open
    if (!on || !open || !was || was.id !== open.id) return
    const words = passed(was.words, open.words)
    if (words) cheer({ kind: 'milestone', words })
  }, [on, open])

  useEffect(() => {
    if (!on) hush()
  }, [on])
}
