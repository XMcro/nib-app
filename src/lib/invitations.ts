import type { Item } from '../db/db'
import { readFolderSettings } from './folderSettings'
import { readJson, writeJson } from './jsonStorage'
import { localDay } from './time'
import { booksOf } from './widgets'

/**
 * Notifications that invite the writer back (free, iPhone and iPad): a short
 * line in Nib's voice for a day, chosen here from what Nib knows of it, and
 * scheduled on the device (lib/reminders). Nothing leaves the device: the
 * lines come with the app, and new ones only with an update.
 *
 * At most one a day, counting the daily reminder (lib/dailyReminder), whose
 * line, today's pack, is one of these. None on a day already written on. The
 * same line never twice in a row. While Lock Nib is on, no line that names a
 * book: numbers only, as the widgets have it.
 */

/** What prompts a line, most pressing first: `pick` takes the first that has something to say. */
export type Prompt = 'streak' | 'deadline' | 'book' | 'door' | 'away' | 'goal' | 'pack' | 'sounds' | 'inkwell' | 'any'

/** What Nib knows of the day an invitation is for. */
export type Day = {
  /** The local day ("YYYY-MM-DD") it's for. */
  day: string
  /** Words already written that day: none for a day still to come. */
  written: number
  /** The daily goal, 0 for none. */
  goal: number
  /** The goal's run of days that this day would carry on, 0 for none (lib/goal streakRecord, if it ended the day before). */
  streak: number
  /** Whole days since the writer last wrote, by this day. */
  away: number
  /** A book with a word goal (Nib Plus): the one written in last. */
  book?: { folder: string; title: string; words: number; goal: number; deadline?: string }
  /** Whether Nib Plus is on: a line about a Plus feature leads to the Plus screen without it. */
  plus: boolean
  /** Inkwell is in its corner. */
  inkwell: boolean
  /** Lock Nib is on: no line that names a book. */
  locked: boolean
  /** The line sent last, by its id, not to be sent again next. */
  last: string | null
}

export type Line = { id: string; prompt: Prompt; text: (day: Day) => string; titled?: true; plusOnly?: true }
export type Invitation = { id: string; text: string; link: string | null }

const words = (n: number) => `${n.toLocaleString('en-US')} word${n === 1 ? '' : 's'}`
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`
/** Whole days from `day` to `deadline`, both "YYYY-MM-DD". */
const daysTo = (day: string, deadline: string) => Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)
const percent = (book: NonNullable<Day['book']>) => Math.floor((100 * book.words) / book.goal)
const doorOf = (day: string) => {
  const [, month, date] = day.split('-').map(Number)
  return month === 12 && date <= 24 ? date : null
}

/** Every line Nib can send. Each id is the line's for good: `last` is kept by it. */
export const LINES: Line[] = [
  // A run of days on the goal, kept alive by today's words.
  { id: 'streak-1', prompt: 'streak', text: (d) => `Day ${d.streak + 1} of your streak is waiting. ${words(d.goal)} keeps it going.` },
  { id: 'streak-2', prompt: 'streak', text: (d) => `${d.streak} days in a row. Make it ${d.streak + 1}? ✒️` },
  { id: 'streak-3', prompt: 'streak', text: (d) => `Your ${d.streak}-day streak would love a little company today.` },
  { id: 'streak-4', prompt: 'streak', text: (d) => `${words(d.goal)} today, and that’s ${d.streak + 1} days running.` },

  // A book with a deadline coming.
  { id: 'deadline-1', prompt: 'deadline', titled: true, text: (d) => `${d.book!.title}: ${days(daysTo(d.day, d.book!.deadline!))} to go. A page today?` },
  { id: 'deadline-2', prompt: 'deadline', titled: true, text: (d) => `${words(d.book!.goal - d.book!.words)} to go on ${d.book!.title}. You’ve got this.` },
  { id: 'deadline-3', prompt: 'deadline', titled: true, text: (d) => `${d.book!.title} is due in ${days(daysTo(d.day, d.book!.deadline!))}. One scene closer?` },

  // A book on its way to its goal.
  { id: 'book-1', prompt: 'book', titled: true, text: (d) => `${d.book!.title} is ${percent(d.book!)}% written. One more scene today?` },
  { id: 'book-2', prompt: 'book', titled: true, text: (d) => `${d.book!.title} is waiting where you left it. 📖` },
  { id: 'book-3', prompt: 'book', titled: true, text: (d) => `${words(d.book!.goal - d.book!.words)} between you and the end of ${d.book!.title}.` },

  // December's calendar.
  { id: 'door-1', prompt: 'door', text: (d) => `Door ${doorOf(d.day)} is open 🎄` },
  { id: 'door-2', prompt: 'door', text: (d) => `Door ${doorOf(d.day)} of the calendar has a stamp behind it. 🎁` },
  { id: 'door-3', prompt: 'door', text: (d) => `Day ${doorOf(d.day)} of 24. Your door’s waiting. ✨` },

  // A few quiet days.
  { id: 'away-1', prompt: 'away', text: () => `Your pen’s getting cold. Five minutes? ✒️` },
  { id: 'away-2', prompt: 'away', text: (d) => `It’s been ${d.away} days. One sentence counts.` },
  { id: 'away-3', prompt: 'away', text: () => `Your story’s right where you left it.` },
  { id: 'away-4', prompt: 'away', text: () => `No pressure. Just a blank page, if you want one.` },

  // A goal for the day.
  { id: 'goal-1', prompt: 'goal', text: (d) => `${words(d.goal)} today? Start with one sentence.` },
  { id: 'goal-2', prompt: 'goal', text: (d) => `Today’s ${words(d.goal)} are waiting for you.` },
  { id: 'goal-3', prompt: 'goal', text: (d) => `Ten quiet minutes might get you ${words(d.goal)}.` },

  // Today's pack (lib/rewards): the daily reminder's own.
  { id: 'pack-1', prompt: 'pack', text: () => `Today’s pack is in. What’s inside? ✨` },
  { id: 'pack-2', prompt: 'pack', text: () => `A new stamp is waiting, and it might be rare.` },
  { id: 'pack-3', prompt: 'pack', text: () => `Today’s pack is waiting.` },

  // Focus sounds (Nib Plus).
  { id: 'sounds-1', prompt: 'sounds', plusOnly: true, text: () => `Write to the sound of rain. 🌧️` },
  { id: 'sounds-2', prompt: 'sounds', plusOnly: true, text: () => `A café’s hum, a fire, a blank page. Shall we? ☕` },

  // Inkwell, in its corner.
  { id: 'inkwell-1', prompt: 'inkwell', text: () => `Stuck? Ask Inkwell for a prompt. ✒️` },
  { id: 'inkwell-2', prompt: 'inkwell', text: () => `Inkwell has something for you to write about.` },

  // Any day.
  { id: 'any-1', prompt: 'any', text: () => `What happens next? Only you know. ✒️` },
  { id: 'any-2', prompt: 'any', text: () => `A blank page and ten quiet minutes.` },
  { id: 'any-3', prompt: 'any', text: () => `Got a sentence in you today?` },
  { id: 'any-4', prompt: 'any', text: () => `Write badly. Fix it later. ✏️` },
]

/** Whether a prompt has something to say on `d`, in the order `pick` asks. */
const PROMPTS: [Prompt, (d: Day) => boolean][] = [
  ['streak', (d) => d.goal > 0 && d.streak >= 2],
  ['deadline', (d) => d.plus && !!d.book?.deadline && d.book.words < d.book.goal && daysTo(d.day, d.book.deadline) >= 1 && daysTo(d.day, d.book.deadline) <= 14],
  ['book', (d) => d.plus && !!d.book && d.book.words > 0 && d.book.words < d.book.goal],
  ['door', (d) => doorOf(d.day) !== null],
  ['away', (d) => d.away >= 3],
  ['goal', (d) => d.goal > 0],
  // Most days after that: pack, sounds, Inkwell and any day take turns, by the day.
]
const TURNS: [Prompt, (d: Day) => boolean][] = [
  ['pack', () => true],
  ['sounds', () => true],
  ['inkwell', (d) => d.inkwell],
  ['any', () => true],
]

/** Days since 1970 of `day`, so each day turns to a line of its own. */
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000)

/** What a line opens: its book, the Plus screen for a Plus feature without Plus, or Nib as it was. */
function linkOf(line: Line, d: Day): string | null {
  if (line.titled && d.book) return `nib://book/${encodeURIComponent(d.book.folder)}`
  if (line.plusOnly && !d.plus) return 'nib://plus'
  return null
}

/**
 * The invitation for `d`, or none: none on a day already written on. The
 * first prompt with something to say, then pack, sounds, Inkwell and any day
 * in turn; of its lines, the day's, never the one sent last, and none that
 * names a book while Lock Nib is on.
 */
export function pick(d: Day): Invitation | null {
  if (d.written > 0) return null
  const n = dayNumber(d.day)
  const usable = (prompt: Prompt) => LINES.filter((line) => line.prompt === prompt && line.id !== d.last && !(d.locked && line.titled))
  const turns = TURNS.filter(([, says]) => says(d))
  const order = [...PROMPTS.filter(([, says]) => says(d)), ...turns.map((_, i) => turns[(n + i) % turns.length])]
  for (const [prompt] of order) {
    const lines = usable(prompt)
    if (lines.length === 0) continue
    const line = lines[n % lines.length]
    return { id: line.id, text: line.text(d), link: linkOf(line, d) }
  }
  return null
}

// ---------------------------------------------------------------------------
// The days ahead, as the daily reminder's slots have them (lib/dailyReminder).

/** As far ahead as invitations are set: a week away is the last one. */
export const INVITE_DAYS = 7
/** The line set for each day, by its id, and what it opens: `last` for the next, and where a tap goes. */
const SENT_KEY = 'nib-invitations-sent'
type Sent = Record<string, { id: string; link: string | null }>

export { declineInvitations, invitationsAsked, invitationsHere, invitationsOn, setInvitationsOn } from './invitationSwitch'

/** What a tapped invitation for `day` opens: its book, the Plus screen, or nothing but Nib. */
export const linkFor = (day: string): string | null => readJson<Sent>(SENT_KEY, {})[day]?.link ?? null

/** The latest of the app's own, which the days ahead are worked out from: its documents, Plus and Inkwell (App). */
let told: { documents: Item[]; plus: boolean; inkwell: boolean; synced?: boolean } = { documents: [], plus: false, inkwell: false }
let wrote = false
const listeners = new Set<() => void>()
export function tellInvitations(now: { documents: Item[]; plus: boolean; inkwell: boolean; wrote: boolean; synced?: boolean }) {
  told = now
  // The day's first words take its invitation off.
  if (now.wrote !== wrote) {
    wrote = now.wrote
    listeners.forEach((listener) => listener())
  }
}
export function onInvitationChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const QUIET_FROM = 8 * 60
const QUIET_TO = 21 * 60 + 30
/** Before the writer's usual hour: by a quarter of an hour. */
const AHEAD = 15
/** With nothing to go on yet: early evening. */
const EVENING = 19 * 60

/**
 * When an invitation comes, "HH:MM": a quarter of an hour before the hour
 * the writer has written most in this year (lib/writingStats recordHour),
 * kept out of quiet hours, before 8:00 and after 21:30.
 */
export function inviteTime(hours: number[] | undefined): string {
  const most = hours && Math.max(...hours) > 0 ? hours.indexOf(Math.max(...hours)) : null
  const at = Math.min(QUIET_TO, Math.max(QUIET_FROM, most === null ? EVENING - AHEAD : most * 60 - AHEAD))
  return `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`
}

/**
 * The words written in each hour of the day, this year and last together:
 * what `inviteTime` goes by. This year's alone are none on New Year's Day,
 * and a first morning's would move the time by themselves.
 */
export function usualHours(years: Record<string, number[]>, now: number): number[] {
  const year = new Date(now).getFullYear()
  return Array.from({ length: 24 }, (_, hour) => (years[year]?.[hour] ?? 0) + (years[year - 1]?.[hour] ?? 0))
}

/** What the days ahead are worked out from. */
export type Known = { now: number; calendar: Record<string, number>; streak: { last: string; count: number }; goal: number; locked: boolean }

/** `day` + `n` days, a local day. */
function after(day: string, n: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return localDay(new Date(year, month - 1, date + n, 12).getTime())
}
const between = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/**
 * Each of the next INVITE_DAYS days' invitation, today's first, as far as Nib
 * can tell now: today with what's been written so far, the days after as if
 * nothing more will be. A run of days only for the day after its last, and
 * each day's line not the one before's.
 */
export function ahead(known: Known): { day: string; invitation: Invitation }[] {
  const today = localDay(known.now)
  const sent = readJson<Sent>(SENT_KEY, {})
  const lastWritten = Object.keys(known.calendar).filter((day) => known.calendar[day] > 0 && day <= today).sort().at(-1)
  const book = told.plus ? booksOf(told.documents, readFolderSettings()).find((one) => one.goal) : undefined
  const out: { day: string; invitation: Invitation }[] = []
  let last = sent[after(today, -1)]?.id ?? null
  for (let i = 0; i < INVITE_DAYS; i++) {
    const day = after(today, i)
    const invitation = pick({
      day,
      written: i === 0 ? (known.calendar[today] ?? 0) : 0,
      goal: known.goal,
      // With sync on there are other devices to write on, and this one counts only its own days: it would say
      // "It's been 6 days" the morning after an evening's writing on the Mac. No line that counts days, then.
      streak: !told.synced && known.streak.last === after(day, -1) ? known.streak.count : 0,
      away: !told.synced && lastWritten ? between(lastWritten, day) : 0,
      ...(book?.goal !== undefined && { book: { folder: book.folder, title: book.title, words: book.words, goal: book.goal, ...(book.deadline && { deadline: book.deadline }) } }),
      plus: told.plus,
      inkwell: told.inkwell,
      locked: known.locked,
      last,
    })
    if (invitation) {
      out.push({ day, invitation })
      last = invitation.id
    }
  }
  return out
}

/** Kept, for `last` and for a tap: those set now, and a fortnight of those before. */
export function keepSent(set: { day: string; invitation: Invitation }[], now: number) {
  const oldest = after(localDay(now), -14)
  const kept = Object.fromEntries(Object.entries(readJson<Sent>(SENT_KEY, {})).filter(([day]) => day >= oldest))
  for (const { day, invitation } of set) kept[day] = { id: invitation.id, link: invitation.link }
  writeJson(SENT_KEY, kept)
}

