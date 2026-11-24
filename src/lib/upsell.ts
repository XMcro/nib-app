import { quiet, watchTyping } from './quiet'

/**
 * When Nib offers Plus of its own accord (components/UpgradeDialog). Never in
 * someone's first days with Nib, then at most once a week, and once a month
 * after it has been shown three times. And only at a pause: a moment after
 * Nib opens or comes back to the front, or on an hourly look while it stays
 * open, so long as nothing has been typed for a minute and no other dialog
 * is up. Whoever has Plus is never asked: App only watches without it.
 *
 * Free days of Plus (bought with coins, or the feedback gift) are told of the
 * day before they end, and offered on once when they have, at the next pause,
 * whatever the week's offers. That counts as one of them.
 */

const KEY = 'nib-upsell'
const DAY = 24 * 60 * 60 * 1000
/** Days from the first look on this device before it's offered at all. */
export const SETTLE_DAYS = 3
/** Days between showings: weekly for the first few, then monthly. */
const WEEKLY_TIMES = 3
/** Waited after Nib opens or comes back, so it isn't the first thing drawn. */
export const PAUSE_MS = 2000
export const LOOK_MS = 60 * 60 * 1000
/** Free days of Plus that ended longer ago than this aren't brought up. */
export const ENDED_WITHIN = 7 * DAY
/** What the offer says once free days of Plus have ended. */
export const DAYS_ENDED = 'Your days of Nib Plus have ended. Keep everything they opened with Nib Plus.'

/** `endedFor` and `warnedFor`: the end of the run of free days last offered on, and last told of. */
export type UpsellState = { first: number; last?: number; times: number; endedFor?: number; warnedFor?: number }

/** Words written here before the offer says how many, rather than nothing in particular. */
export const KEPT_WORDS = 1000

const DEVICES = ['iPhone', 'iPad', 'Mac'] as const

/**
 * What the offer says of its own accord, once there's enough here to lose:
 * how much, that it's all on this one device, and where else Plus puts it.
 */
export function keptHere(words: number, device: (typeof DEVICES)[number]): string | undefined {
  if (words < KEPT_WORDS) return undefined
  const [one, other] = DEVICES.filter((each) => each !== device)
  return `${words.toLocaleString()} words, all on this ${device}. Nib Plus puts them on your ${one} and ${other} too, with an encrypted backup.`
}

export function due(state: UpsellState, now: number): boolean {
  if (now - state.first < SETTLE_DAYS * DAY) return false
  if (state.last === undefined) return true
  return now - state.last >= (state.times < WEEKLY_TIMES ? 7 : 30) * DAY
}

/** Whether free days of Plus that ran till `until` (0 for none) have ended lately, and not yet been offered on. */
export function endedOffer(until: number, state: UpsellState, now: number): boolean {
  return until > 0 && until <= now && now - until < ENDED_WITHIN && state.endedFor !== until
}

/**
 * The day before free days of Plus end at `until`: what to tell, once for
 * each run of days, or null. Without storage, nothing: it would come up on
 * every launch.
 */
export function endingNotice(until: number, now: number): string | null {
  const state = read(now)
  if (!state || until <= now || until - now > DAY || state.warnedFor === until) return null
  write({ ...state, warnedFor: until })
  const day = new Date(until).toDateString() === new Date(now).toDateString() ? 'today' : 'tomorrow'
  return `Your days of Nib Plus end ${day} at ${new Date(until).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`
}

/** This device's record, started at `now` the first time it's read. Null when storage is off: without it Nib would ask on every launch. */
function read(now: number): UpsellState | null {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<UpsellState> | null
    if (stored && typeof stored.first === 'number' && typeof stored.times === 'number') {
      const { last, endedFor, warnedFor } = stored
      return {
        first: stored.first,
        times: stored.times,
        ...(typeof last === 'number' && { last }),
        ...(typeof endedFor === 'number' && { endedFor }),
        ...(typeof warnedFor === 'number' && { warnedFor }),
      }
    }
    const fresh = { first: now, times: 0 }
    localStorage.setItem(KEY, JSON.stringify(fresh))
    return fresh
  } catch {
    return null
  }
}

function write(state: UpsellState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Storage off: read() already says never.
  }
}

/**
 * Looks at each pause and calls `show` when it's time, with `shown` to call as
 * the offer comes up: that's a showing, whatever comes of it. One dropped on
 * the way isn't, and is looked for again. `ended` says it's for free days of
 * Plus that have ended, which `endedUntil` gives the end of (0 for none).
 * Returns the way to stop looking.
 */
export function watchUpsell(show: (shown: () => void, ended: boolean) => void, endedUntil: () => number = () => 0): () => void {
  const stopWatching = watchTyping()
  const look = () => {
    if (!quiet()) return
    const now = Date.now()
    const state = read(now)
    if (!state) return
    const until = endedUntil()
    const ended = endedOffer(until, state, now)
    if (!ended && !due(state, now)) return
    show(() => write({ ...state, last: now, times: state.times + 1, ...(ended && { endedFor: until }) }), ended)
  }

  let pause = setTimeout(look, PAUSE_MS)
  const onVisible = () => {
    clearTimeout(pause)
    if (document.visibilityState === 'visible') pause = setTimeout(look, PAUSE_MS)
  }
  const hourly = setInterval(look, LOOK_MS)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearTimeout(pause)
    clearInterval(hourly)
    stopWatching()
    document.removeEventListener('visibilitychange', onVisible)
  }
}
