import type { Item } from '../db/db'
import { dateOf, isDay, localDay } from './time'
import { isLocked, shownTitle } from './vault'

/**
 * A document's expiry date (Nib Plus): the day it moves itself to the trash.
 * Nib never empties the trash, so it can be put back from there. A day, not
 * a time: `YYYY-MM-DD` on the writer's own calendar, which is that day on
 * each of their devices wherever its clock is set. Nothing rings and nothing
 * is sent anywhere for it: a device moves what's due when Nib is open on it.
 *
 * With Plus ended, a date already set still stands and can be taken off;
 * setting or changing one is what needs Plus.
 */

/** The one check on a date arriving from outside (lib/documentFields): a real day, null for taken off, or nothing said. */
export const asExpiry = (raw: unknown): string | null | undefined => (raw === null ? null : isDay(raw) && localDay(dateOf(raw).getTime()) === raw ? raw : undefined)

/** The same date `months` on, or that month's last day where it has no such date. */
function monthsOn(now: number, months: number): string {
  const date = new Date(now)
  const last = new Date(date.getFullYear(), date.getMonth() + months + 1, 0)
  return localDay(new Date(last.getFullYear(), last.getMonth(), Math.min(date.getDate(), last.getDate())).getTime())
}

/** The first day that can be chosen: tomorrow. Today's would go at once. */
export const firstExpiry = (now = Date.now()) => localDay(new Date(now).setDate(new Date(now).getDate() + 1))

/** Quick choices: a week, a month and a year on. */
export function expiryChoices(now = Date.now()): { label: string; day: string }[] {
  return [
    { label: 'In a week', day: localDay(new Date(now).setDate(new Date(now).getDate() + 7)) },
    { label: 'In a month', day: monthsOn(now, 1) },
    { label: 'In a year', day: monthsOn(now, 12) },
  ]
}

/** After "Expires": "today" (or a day gone by, which goes the next time Nib looks), "tomorrow", or the date, with its year only when it isn't this one. */
export function describeExpiry(day: string, now = Date.now()): string {
  if (day <= localDay(now)) return 'today'
  if (day === firstExpiry(now)) return 'tomorrow'
  const date = dateOf(day)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' })
}

/** Those whose day has come, on `today`: what moves to the trash (lib/useExpiring). */
export const dueOn = (documents: Item[], today: string) => documents.filter((item) => typeof item.expires === 'string' && item.expires <= today)

/** What's said once they've gone: the one by its title, cut short, though never a locked one's; several by their number. */
export function expiredNotice(gone: Item[]): string {
  if (gone.length > 1) {
    const what = gone.every((item) => item.kind === 'note') ? 'notes' : gone.every((item) => item.kind === 'page') ? 'pages' : 'notes and pages'
    return `${gone.length} ${what} expired and are in the trash.`
  }
  const [one] = gone
  if (isLocked(one)) return `A locked ${one.kind} expired and is in the trash.`
  const title = shownTitle(one)
  return `“${title.length > 44 ? `${title.slice(0, 43).trimEnd()}…` : title}” expired and is in the trash.`
}

