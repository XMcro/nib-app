import { STAMP_INKS, type Ground, type Rarity } from './stampbook'
import { dayMonth } from './time'

/**
 * The holidays with a stamp of their own: the eleven US federal holidays,
 * and Valentine's Day, St Patrick's Day, Easter, Mother's Day, Father's Day
 * and Halloween. The day's pack holds its stamp as well as its one from
 * the stampbook, as a Christmas calendar door's does in December. Each comes
 * with a prompt of its own.
 */

export type Holiday = {
  name: string
  story: string
  prompt: string
  /** What its drawing shows, as lib/stampWords' MOTIFS has it. */
  motif: string
  ink: string
  ground: Ground
  rarity: Rarity
  /** Its day in a year, as `MM-DD`. */
  date: (year: number) => string
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The same day every year. */
const fixed = (month: number, date: number) => () => `${pad(month)}-${pad(date)}`

/** The `nth` of a weekday (0 for Sunday) in a month, or with `nth` -1 the last. */
const nth = (month: number, weekday: number, nth: number) => (year: number) => {
  if (nth > 0) {
    const first = new Date(year, month - 1, 1).getDay()
    return `${pad(month)}-${pad(1 + ((weekday - first + 7) % 7) + 7 * (nth - 1))}`
  }
  const days = new Date(year, month, 0).getDate()
  const last = new Date(year, month - 1, days).getDay()
  return `${pad(month)}-${pad(days - ((last - weekday + 7) % 7))}`
}

/** Easter Sunday, as Western churches keep it: the anonymous Gregorian reckoning. */
export function easter(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const date = ((h + l - 7 * m + 114) % 31) + 1
  return `${pad(month)}-${pad(date)}`
}

type Row = [name: string, motif: string, ink: keyof typeof STAMP_INKS, ground: Ground, story: string, prompt: string, date: (year: number) => string]

// In the order of the year. Juneteenth comes before Father's Day, which
// shares its day now and then (2033, 2039): that year, the day's stamp is
// Juneteenth's.
const ROWS: Row[] = [
  ['New Year’s Day', 'Fireworks', 'violet', 'stars', 'A clean page, and a whole year of them.', 'Write the first page of this year as if it were a book.', fixed(1, 1)],
  [
    'Martin Luther King Jr. Day',
    'A dove with an olive branch',
    'blue',
    'rays',
    'For words that changed what people believed was possible.',
    'Write about a time someone’s words changed your mind.',
    nth(1, 1, 3),
  ],
  ['Valentine’s Day', 'A heart with an arrow through it', 'rose', 'dots', 'For the letters that were hardest to write.', 'Write a love letter to something that isn’t a person.', fixed(2, 14)],
  ['Presidents’ Day', 'A hall with columns', 'blue', 'lines', 'For the long work of keeping a promise.', 'Write the speech you’d give if everyone had to listen.', nth(2, 1, 3)],
  ['St Patrick’s Day', 'A shamrock', 'green', 'checks', 'Three leaves, and the luck of a fourth.', 'Write about the luckiest thing that ever happened to you.', fixed(3, 17)],
  ['Easter', 'A painted egg', 'violet', 'waves', 'Hidden in the garden, and found before lunch.', 'Write about something that came back.', easter],
  ['Mother’s Day', 'A bouquet', 'rose', 'dots', 'For the first person who listened to your stories.', 'Write down something your mother, or someone like her, always said.', nth(5, 0, 2)],
  ['Memorial Day', 'A poppy', 'red', 'hatch', 'Remembered, every one.', 'Write about someone you want remembered.', nth(5, 1, -1)],
  ['Juneteenth', 'A star bursting over the horizon', 'red', 'rays', 'For freedom, and the day the news of it arrived.', 'Write about what freedom means to you, today.', fixed(6, 19)],
  [
    'Father’s Day',
    'A necktie',
    'blue',
    'lines',
    'Worn once a year, and kept in the drawer.',
    'Write about something your father, or someone like him, taught you without saying it.',
    nth(6, 0, 3),
  ],
  ['Independence Day', 'A flag', 'blue', 'stars', 'Signed in ink, by people who meant it.', 'Write your own declaration: what you will and won’t do this year.', fixed(7, 4)],
  ['Labor Day', 'A hard hat', 'amber', 'checks', 'For the work, and the day off from it.', 'Write about the hardest job you ever had.', nth(9, 1, 1)],
  [
    'Indigenous Peoples’ Day and Columbus Day',
    'A globe',
    'teal',
    'lines',
    'For the whole of the map, and its oldest stories.',
    'Write about the oldest story you know about the place you live.',
    nth(10, 1, 2),
  ],
  ['Halloween', 'A jack-o’-lantern', 'amber', 'hatch', 'For the night the streets fill with small ghosts.', 'Write something that frightens you a little.', fixed(10, 31)],
  ['Veterans Day', 'A medal', 'blue', 'rays', 'For those who served, and came home.', 'Write a thank-you to someone who served.', fixed(11, 11)],
  ['Thanksgiving', 'A turkey', 'umber', 'waves', 'A long table, and room for one more.', 'Write down ten things you’re thankful for, the small ones first.', nth(11, 4, 4)],
]

/** All seventeen, in the order of the year: Christmas Day's is the gold one the calendar's present gives (lib/rewards). */
export const HOLIDAYS: Holiday[] = [
  ...ROWS.map(([name, motif, ink, ground, story, prompt, date]) => ({ name, motif, ink: STAMP_INKS[ink], ground, rarity: 'unique' as Rarity, story, prompt, date })),
  {
    name: 'Christmas Day',
    motif: 'A gold star for Christmas Day',
    ink: STAMP_INKS.gold,
    ground: 'rays',
    rarity: 'legendary',
    story: 'For the last door, and the present behind it.',
    prompt: 'Write about this year, in one page.',
    date: fixed(12, 25),
  },
]

/** The holiday `day` is (`YYYY-MM-DD`), or null. */
export function holidayOn(day: string): Holiday | null {
  const year = Number(day.slice(0, 4))
  return HOLIDAYS.find((holiday) => holiday.date(year) === day.slice(5)) ?? null
}

/** The days `on` finds, by name: the days, oldest first, from the days stamped (lib/rewards). */
function foundBy(on: (day: string) => Holiday | null, stamps: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const day of [...stamps].sort()) {
    const holiday = on(day)
    if (holiday) found.set(holiday.name, [...(found.get(holiday.name) ?? []), day])
  }
  return found
}

/** The holidays found, by name, and the days. */
export const holidaysFound = (stamps: string[]) => foundBy(holidayOn, stamps)

/**
 * Three days that are keepsakes rather than holidays (the Stampbook's
 * keepsakes page): World Book Day, 23 April; leap day, 29 February, once in
 * four years; and New Year's Eve. The day's pack holds its stamp, as a
 * holiday's does, and it's never traded or a repeat.
 */
export const KEEPSAKE_DAYS: Holiday[] = [
  {
    name: 'World Book Day',
    motif: 'A book with a bookmark',
    ink: STAMP_INKS.blue,
    ground: 'lines',
    rarity: 'unique',
    story: 'For the books, and everyone who reads them.',
    prompt: 'Write about the book you’ve given away most.',
    date: fixed(4, 23),
  },
  {
    name: 'Leap day',
    motif: 'A leaping frog',
    ink: STAMP_INKS.green,
    ground: 'dots',
    rarity: 'legendary',
    story: 'A day that comes once in four years.',
    prompt: 'Write about what you’d do with a day nobody counted.',
    date: fixed(2, 29),
  },
  {
    name: 'New Year’s Eve',
    motif: 'A clock at midnight',
    ink: STAMP_INKS.violet,
    ground: 'stars',
    rarity: 'unique',
    story: 'The last page of the year, and the countdown.',
    prompt: 'Write a letter to yourself, to open next December.',
    date: fixed(12, 31),
  },
]

/** The keepsake day `day` is, or null. */
export function keepsakeDayOn(day: string): Holiday | null {
  return KEEPSAKE_DAYS.find((keepsake) => keepsake.date(0) === day.slice(5)) ?? null
}

/** The keepsake days found, by name, and the days. */
export const keepsakeDaysFound = (stamps: string[]) => foundBy(keepsakeDayOn, stamps)

/** A keepsake day as the writer would put it, and when it next comes: 29 February in the next leap year. */
export function onDay(keepsake: Holiday, today: string): string {
  const date = keepsake.date(0)
  let year = Number(today.slice(0, 4))
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  while (`${year}-${date}` < today || (date === '02-29' && !leap(year))) year++
  const when = dayMonth(`${year}-${date}`)
  return date === '02-29' ? `${when}, the next in ${year}` : when
}

/** A holiday's next day from `today` on, this year's or next. */
export function nextOf(holiday: Holiday, today: string): string {
  const year = Number(today.slice(0, 4))
  const day = `${year}-${holiday.date(year)}`
  return day >= today ? day : `${year + 1}-${holiday.date(year + 1)}`
}
