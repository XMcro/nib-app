import type { Placed } from '../db/db'
import { holidayOn, keepsakeDayOn } from './holidays'
import { BOOK, GROUNDS, packFor, RARITIES, type Ground, type Rarity, type Received } from './stampbook'
import { CHRISTMAS, DOORS, EVERYDAY, MOTIFS, PROMPTS, WINTER_PROMPTS } from './stampWords'

/**
 * Daily rewards, free: the first time Nib opens on a day, a pack of stamps
 * waits to be opened, kept on this device to look back on. It holds three of
 * the stampbook's 300 (lib/stampbook `packFor`), new ones first, and a prompt
 * to write from. A holiday's pack holds its stamp too (lib/holidays).
 *
 * In December the stamps for the 1st to the 24th are the Christmas
 * calendar's doors, each a winter stamp of its own, in that day's pack, and a
 * pack opens the latest door missed before it too, one a day. Christmas Day's
 * is gold, and from the 25th to the 31st it's waiting as a present for anyone
 * who opened a door that December.
 */

/** The stamp for a new writer's first steps (lib/firsts), all four done. */
const FIRST_STEPS = CHRISTMAS + 1

export function firstStepsStamp(day: string): Stamp {
  return { day, motif: FIRST_STEPS, ink: '#4f86c6', prompt: '', rarity: 'unique', ground: 'dots' }
}

/** The doors' inks: red, green, gold and blue in turn. */
export const WINTER_INKS = ['#c8463a', '#2f8a5b', '#c99a2e', '#4a86c5']

/** The Christmas calendar's door this day is, 1 to 24, or null. */
export function doorOf(day: string): number | null {
  const [, month, date] = day.split('-').map(Number)
  return month === 12 && date <= DOORS ? date : null
}

/**
 * The door a day's pack opens as well as its own, in December: the latest
 * one before it not opened yet. Null outside December, and when there's none.
 */
export function catchUp(stamps: string[], today: string): string | null {
  const [year, month, date] = today.split('-').map(Number)
  if (month !== 12) return null
  const opened = new Set(stamps)
  for (let door = Math.min(date - 1, DOORS); door >= 1; door--) {
    const day = `${year}-12-${String(door).padStart(2, '0')}`
    if (!opened.has(day)) return day
  }
  return null
}

/** `no`: the stampbook's number (lib/stampbook), for one of its 200. */
export type Stamp = { day: string; motif: number; ink: string; prompt: string; rarity?: Rarity; ground?: Ground; no?: number }

/** Whether a day's stamp is drawn from the stampbook: every day but a door's, a holiday's and a keepsake day's, which are their own. */
export function drawnOn(day: string): boolean {
  return doorOf(day) === null && holidayOn(day) === null && keepsakeDayOn(day) === null
}

/** The stampbook's stamp `no`, as received on `day`. */
export function bookStamp(no: number, day: string, prompt = ''): Stamp {
  const entry = BOOK[no - 1]
  return { day, motif: MOTIFS.indexOf(entry.motif), ink: entry.ink, prompt, rarity: entry.rarity, ground: entry.ground, no }
}

/**
 * A day's stamp. A door's, a holiday's and a keepsake day's are their own; any other day's is
 * the rarest its pack held, in `received`. A day with no pack, as for a
 * welcome's sample, shows what its pack would hold. The prompts step on by
 * one a day, so days side by side differ.
 */
export function stampFor(day: string, received: Received = []): Stamp {
  const door = doorOf(day)
  if (door !== null) {
    // Dots to stars, in turn.
    const ground = GROUNDS[1 + ((door - 1) % 6)]
    return { day, motif: EVERYDAY + door - 1, ink: WINTER_INKS[(door - 1) % WINTER_INKS.length], prompt: WINTER_PROMPTS[door - 1], rarity: 'rare', ground }
  }
  const holiday = holidayOn(day) ?? keepsakeDayOn(day)
  if (holiday) return { day, motif: MOTIFS.indexOf(holiday.motif), ink: holiday.ink, prompt: holiday.prompt, rarity: holiday.rarity, ground: holiday.ground }
  const [year, month, date] = day.split('-').map(Number)
  const n = Math.round(Date.UTC(year, month - 1, date) / 86_400_000)
  const rank = (no: number) => RARITIES.indexOf(BOOK[no - 1].rarity)
  const held = received.filter(([on]) => on === day).map(([, no]) => no)
  const shown = held.length ? held.reduce((best, no) => (rank(no) > rank(best) ? no : best)) : packFor(day)[0]
  return bookStamp(shown, day, PROMPTS[n % PROMPTS.length])
}

/** To draw (components/StampArt). */
export function drawn(placed: Placed): Stamp {
  return placed.no !== undefined ? bookStamp(placed.no, placed.day) : stampFor(placed.day)
}

export type Door = {
  /** 1 to 24. */
  door: number
  day: string
  /** Open; today's, its pack still to open; missed, to open with the next day's pack; or still ahead. */
  state: 'open' | 'today' | 'missed' | 'ahead'
}

/** A door's day in this year's December: the one to come, or the one now. */
export const doorDay = (door: number, today: string) => `${today.slice(0, 4)}-12-${String(door).padStart(2, '0')}`

/** How a door not opened stands. */
export const doorUnopened = (day: string, today: string): Door['state'] => (day === today ? 'today' : day < today ? 'missed' : 'ahead')

/** The Christmas calendar for the December `today` is in: its 24 doors, and how each stands. */
export function calendarDoors(stamps: string[], today: string): Door[] {
  const opened = new Set(stamps)
  return Array.from({ length: DOORS }, (_, i) => {
    const day = doorDay(i + 1, today)
    return { door: i + 1, day, state: opened.has(day) ? 'open' : doorUnopened(day, today) }
  })
}

/** From the 25th to the 31st of December, for anyone who opened a door that December, until it's opened. */
export function christmasWaiting(stamps: string[], opened: number[], today: string): boolean {
  const [year, month, date] = today.split('-').map(Number)
  if (month !== 12 || date < 25 || opened.includes(year)) return false
  return stamps.some((day) => day.startsWith(`${year}-12-`) && doorOf(day) !== null)
}

export type LookBack = { days: number; words: number; doors: number }

/**
 * December so far, for the present's card: days written on and words written
 * on this device, from lib/goal's calendar, and doors opened. Totals only.
 */
export function decemberLookBack(calendar: Record<string, number>, stamps: string[], today: string): LookBack {
  const month = `${today.slice(0, 4)}-12-`
  const written = Object.entries(calendar).filter(([day, words]) => day.startsWith(month) && day <= today && words > 0)
  return {
    days: written.length,
    words: written.reduce((sum, [, words]) => sum + words, 0),
    doors: stamps.filter((day) => day.startsWith(month) && doorOf(day) !== null).length,
  }
}

/** What a day's pack held, once opened. */
export type Pack = {
  day: string
  /** A Christmas calendar door's or a holiday's stamp: the day's own. */
  dayStamp: Stamp | null
  /** In December: the latest door missed, opened by this pack too. */
  caughtUp: Stamp | null
  /** The stamp from the stampbook; `fresh` if new to the book, and `copies`, how many there are now. */
  stamps: (Stamp & { fresh: boolean; copies: number })[]
  /** Something to write: the day's. */
  prompt: string
}

/** What came of a code for coins (lib/codes): its coins, or why not. */
export type Redeemed = number | 'unknown' | 'ended' | 'used up' | 'too many' | 'used' | 'offline'
