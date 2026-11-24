import type { Item } from '../db/db'
import { filingOf, split } from './folders'
import { readJson, writeJson } from './jsonStorage'
import { localDay, startOfDay } from './time'

/**
 * Writing stats (Phase 13): what the day's count (lib/goal, lib/writtenHere)
 * is also kept as, on this device only, as the calendar is. Counted from the
 * update that brought them, and not before: the words each day went into
 * each book or folder, and the words in each hour of the day, by year. The sums at the end read them with
 * the calendar for the stats (Nib Plus) and the year's card (free).
 */

const HOURS_KEY = 'nib-goal-hours'
const FOLDERS_KEY = 'nib-goal-folders'
const DAY_MS = 86_400_000

/** How long the calendar, and the day's books and folders, are kept: past a year, so a year's card always has the whole of it. */
export const KEEP_DAYS = 400

/** The day's highest count (`last`), and the words written in each hour, by year: 24 a year. */
type Hours = { day: string; last: number; years: Record<string, number[]> }
/** Words written each day into each book or folder, by its top folder: '' for none. */
type Folders = Record<string, Record<string, number>>

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

function readHoursRecord(): Hours {
  const stored = readJson<Partial<Hours> | null>(HOURS_KEY, null)
  const years: Record<string, number[]> = {}
  if (stored && typeof stored.years === 'object' && stored.years !== null) {
    for (const [year, hours] of Object.entries(stored.years)) if (Array.isArray(hours) && hours.length === 24 && hours.every(isCount)) years[year] = hours
  }
  return stored && typeof stored.day === 'string' && isCount(stored.last) ? { day: stored.day, last: stored.last, years } : { day: '', last: 0, years }
}

/**
 * The day's count, `written`, as it is `now`: what it went past the day's
 * highest count by goes to this hour. A count that falls and rises again
 * isn't counted twice: on opening, before the library has loaded, it reads
 * nothing; and words cut and written again are the day's words once.
 */
// The last count each was given, so the day's count, taken at every render (lib/goal), reads storage only when it changes.
let lastHour = ''
let lastFolders = ''

export function recordHour(written: number, now: number) {
  const today = localDay(now)
  if (lastHour === `${today} ${written}`) return
  lastHour = `${today} ${written}`
  const stored = readHoursRecord()
  const highest = stored.day === today ? stored.last : 0
  if (written <= highest) return
  const year = today.slice(0, 4)
  const hours = [...(stored.years[year] ?? Array<number>(24).fill(0))]
  hours[new Date(now).getHours()] += written - highest
  writeJson(HOURS_KEY, { day: today, last: written, years: { ...stored.years, [year]: hours } })
}

/** Words written in each hour of the day, by year (`YYYY`). */
export const readHours = (): Record<string, number[]> => readHoursRecord().years

/** A document's book or folder: its top folder, as a subfolder is a part of its book; '' for none. */
export function bookOf(item: Item): string {
  const folder = filingOf(item).folder
  return folder ? (split(folder).parent ?? folder) : ''
}

/**
 * Today's words, `each` by document (lib/writtenHere), as they went into each
 * book or folder: today's entry replaced, and days older than KEEP_DAYS let go.
 */
export function recordFolders(each: Map<string, number>, documents: Item[], now: number) {
  const byBook: Record<string, number> = {}
  for (const item of documents) {
    const words = each.get(item.id)
    if (words) byBook[bookOf(item)] = (byBook[bookOf(item)] ?? 0) + words
  }
  const today = localDay(now)
  const counted = `${today} ${JSON.stringify(byBook)}`
  if (lastFolders === counted) return
  lastFolders = counted
  const stored = readFolders()
  if (JSON.stringify(stored[today] ?? {}) === JSON.stringify(byBook)) return
  if (Object.keys(byBook).length === 0 && !(today in stored)) return
  const oldest = localDay(startOfDay(now) - (KEEP_DAYS - 1) * DAY_MS)
  const kept: Folders = {}
  for (const [day, books] of Object.entries(stored)) if (day >= oldest && day !== today) kept[day] = books
  kept[today] = byBook
  writeJson(FOLDERS_KEY, kept)
}

/** Words into each book or folder, by day. */
export function readFolders(): Folders {
  const stored = readJson<unknown>(FOLDERS_KEY, {})
  const days: Folders = {}
  if (typeof stored !== 'object' || stored === null) return days
  for (const [day, books] of Object.entries(stored)) {
    if (typeof books !== 'object' || books === null) continue
    const kept = Object.fromEntries(Object.entries(books).filter(([, words]) => isCount(words)))
    days[day] = kept as Record<string, number>
  }
  return days
}

/** An hour of the day as the writer's clock says it: "7 AM", or "07". */
export const hourOf = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric' })

export type Summary = {
  /** The year, `YYYY`, and the first day of it with words kept, if any. */
  year: string
  since?: string
  total: number
  /** Days of the year with words written. */
  days: number
  /** Monday to Sunday, and the calendar month, both as of `now`. */
  thisWeek: number
  thisMonth: number
  best?: { day: string; words: number }
  /** The longest run of writing days this year, and the run that reaches today or yesterday. */
  longestRun: number
  currentRun: number
  /** This year's books and folders, most words first; '' is none. */
  books: { name: string; words: number }[]
  /** This year's busiest hour, 0 to 23, if any hour has words. */
  busiestHour?: number
}

/** Monday of the week `ms` falls in, as `YYYY-MM-DD`. */
function mondayOf(ms: number): string {
  const date = new Date(startOfDay(ms))
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return localDay(date.getTime())
}

/** The stats and the year's card, from the calendar (lib/goal readCalendar) and what's kept here, as of `now`. */
export function summarize(calendar: Record<string, number>, folders: Folders, hours: Record<string, number[]>, now: number): Summary {
  const today = localDay(now)
  const year = today.slice(0, 4)
  const month = today.slice(0, 7)
  const monday = mondayOf(now)
  const written = Object.entries(calendar)
    .filter(([day, words]) => day.startsWith(year) && day <= today && isCount(words) && words > 0)
    .sort(([a], [b]) => a.localeCompare(b))

  let total = 0
  // A week can begin in the year before: early in January, it's counted from all the calendar.
  let thisWeek = 0
  for (const [day, words] of Object.entries(calendar)) if (day >= monday && day <= today && isCount(words)) thisWeek += words
  let thisMonth = 0
  let best: Summary['best']
  for (const [day, words] of written) {
    total += words
    if (day.startsWith(month)) thisMonth += words
    if (!best || words > best.words) best = { day, words }
  }

  // Runs of days one after another, by the calendar's own days.
  const next = (day: string) => {
    const date = new Date(`${day}T12:00:00`)
    date.setDate(date.getDate() + 1)
    return localDay(date.getTime())
  }
  let longestRun = 0
  let run = 0
  let previous = ''
  for (const [day] of written) {
    run = previous && next(previous) === day ? run + 1 : 1
    longestRun = Math.max(longestRun, run)
    previous = day
  }
  const yesterday = localDay(startOfDay(now) - 1)
  const currentRun = previous === today || previous === yesterday ? run : 0

  const byBook: Record<string, number> = {}
  for (const [day, books] of Object.entries(folders)) {
    if (!day.startsWith(year) || day > today) continue
    for (const [name, words] of Object.entries(books)) byBook[name] = (byBook[name] ?? 0) + words
  }
  const books = Object.entries(byBook)
    .map(([name, words]) => ({ name, words }))
    .filter(({ words }) => words > 0)
    .sort((a, b) => b.words - a.words || a.name.localeCompare(b.name))

  const yearHours = hours[year]
  const most = yearHours ? Math.max(...yearHours) : 0
  return {
    year,
    ...(written.length > 0 && { since: written[0][0] }),
    total,
    days: written.length,
    thisWeek,
    thisMonth,
    ...(best && { best }),
    longestRun,
    currentRun,
    books,
    ...(most > 0 && { busiestHour: yearHours!.indexOf(most) }),
  }
}
