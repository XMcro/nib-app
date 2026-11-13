import { useEffect, useState } from 'react'
import { readJson, writeJson } from './jsonStorage'
import { localDay } from './time'

/**
 * First steps, for a new writer: four things to try, ticked off as each is
 * done, with a stamp of their own once all four are (lib/rewards
 * `firstStepsStamp`). Begun as the welcome ends, by Start writing, Import or
 * putting it aside; not by Sync, which brings a library already known. Kept
 * on this device, and put away for good whenever the writer likes. A writer
 * with a library from before first steps, who never saw the welcome, is given
 * theirs (`grant`).
 */

export const STEPS = ['write', 'page', 'focus', 'commands'] as const
export type Step = (typeof STEPS)[number]

type Firsts = {
  done: Step[]
  /** Put away before the end: not shown again. */
  away?: boolean
  /** The day the last was done: `YYYY-MM-DD`. */
  finished?: string
  /** All four done, the card waiting for a pause (lib/useUnprompted): it came up mid-sentence. Stored, as Nib can quit before the pause comes. */
  owed?: boolean
}

const KEY = 'nib-firsts'

function read(): Firsts | null {
  const value = readJson<Firsts | null>(KEY, null)
  return value && Array.isArray(value.done) ? value : null
}

const write = (firsts: Firsts) => writeJson(KEY, firsts)

/** `signals`: whether each step has been done, as the app sees it now. */
export function useFirsts(signals: Record<Step, boolean>) {
  const [firsts, setFirsts] = useState(read)
  // The step just done, for its little celebration; and the big one at the end.
  const [fresh, setFresh] = useState<Step | null>(null)
  const [celebrating, setCelebrating] = useState(false)

  const going = firsts !== null && !firsts.away && !firsts.finished
  // The steps done now that weren't before, as one value for the effect to follow.
  const key = going ? STEPS.filter((step) => signals[step] && !firsts.done.includes(step)).join() : ''
  useEffect(() => {
    if (!firsts || !key) return
    const newly = key.split(',') as Step[]
    const done = [...firsts.done, ...newly]
    const next: Firsts = { ...firsts, done, ...(done.length === STEPS.length ? { finished: localDay(Date.now()), owed: true } : {}) }
    write(next)
    setFirsts(next)
    setFresh(newly[newly.length - 1])
  }, [key, firsts])

  function save(next: Firsts) {
    write(next)
    setFirsts(next)
  }

  return {
    /** The checklist has been begun, or given (`grant`). */
    begun: firsts !== null,
    /** The checklist is under way. */
    showing: going,
    done: firsts?.done ?? [],
    fresh,
    finished: firsts?.finished ?? null,
    celebrating,
    earned: firsts?.owed === true,
    celebrate: () => {
      if (firsts) save({ ...firsts, owed: false })
      setCelebrating(true)
    },
    start: () => {
      if (!firsts) save({ done: [] })
    },
    putAway: () => {
      if (firsts) save({ ...firsts, away: true })
    },
    /** For a writer with a library from before first steps, which they never began: theirs, done today, with its card. */
    grant: () => {
      if (firsts) return
      save({ done: [...STEPS], finished: localDay(Date.now()) })
      setCelebrating(true)
    },
    endCelebration: () => setCelebrating(false),
  }
}
