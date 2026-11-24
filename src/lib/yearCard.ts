import { readJson, writeJson } from './jsonStorage'
import { localDay } from './time'

/**
 * When the year's card (components/yearCard) is due: December, and offered
 * once a year without being asked (lib/feedback askDue) to a writer with words
 * this year on this device. Apart from the rest of Goals (lib/goal), which
 * brings the library with it, for what Nib asks once to read.
 */

/** Words per day, by `YYYY-MM-DD`: the calendar lib/goal keeps. */
export const CALENDAR_KEY = 'nib-goal-calendar'
/** The year the card was last offered unasked. */
const OFFERED_KEY = 'nib-goal-card'

export const cardDue = (now: number) => new Date(now).getMonth() === 11

export function cardToOffer(now: number): boolean {
  const year = localDay(now).slice(0, 4)
  const calendar = readJson<Record<string, number>>(CALENDAR_KEY, {})
  return cardDue(now) && readJson<string>(OFFERED_KEY, '') !== year && Object.entries(calendar).some(([day, words]) => day.startsWith(year) && words > 0)
}

export const rememberCardOffered = (now: number) => writeJson(OFFERED_KEY, localDay(now).slice(0, 4))
