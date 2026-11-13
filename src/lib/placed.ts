import type { Item, Placed } from '../db/db'
import { holidayOn, type Holiday } from './holidays'
import { BOOK, type Entry } from './stampbook'

/**
 * Stamps put on writing, from the Stampbook: a few on a note or page, kept on
 * the document itself like its categories, so sync and backups carry them and
 * every device shows them, whatever that device's own stamps. A manuscript
 * (lib/manuscript) wears its chapters' stamps, gathered.
 */

/** A few: stamps, not a sticker sheet. */
export const MAX_PLACED = 3

/** As many as a manuscript's cover shows. */
export const MAX_GATHERED = 12

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The one check on stamps arriving from outside: a backup, or another
 * device. `undefined` means nothing usable, which callers treat as saying
 * nothing, as with `asCategories`; none at all is an empty list.
 */
export function asPlaced(raw: unknown): Placed[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const kept: Placed[] = []
  for (const entry of raw) {
    if (kept.length === MAX_PLACED) break
    const { day, no } = (entry ?? {}) as Partial<Placed>
    if (typeof day !== 'string' || !DAY.test(day)) continue
    const stamp = no === undefined ? (holidayOn(day) ? { day } : null) : Number.isInteger(no) && no >= 1 && no <= BOOK.length ? { day, no } : null
    if (stamp && !kept.some((had) => samePlaced(had, stamp))) kept.push(stamp)
  }
  return kept
}

/** The same stamp, found on whatever day: the book's by number, a holiday's by the holiday. */
export function samePlaced(a: Placed, b: Placed): boolean {
  return a.no !== undefined || b.no !== undefined ? a.no === b.no : holidayOn(a.day)?.name === holidayOn(b.day)?.name
}

/** What a stamp put on writing is: its entry in the book, or its holiday. */
export function whatIs(placed: Placed): { entry: Entry } | { holiday: Holiday } {
  return placed.no !== undefined ? { entry: BOOK[placed.no - 1] } : { holiday: holidayOn(placed.day)! }
}

/** A manuscript's stamps: its chapters', each once, in chapter order, as many as its cover shows. */
export function gathered(chapters: Item[]): Placed[] {
  const all: Placed[] = []
  for (const chapter of chapters) for (const stamp of chapter.stamps ?? []) if (!all.some((had) => samePlaced(had, stamp))) all.push(stamp)
  return all.slice(0, MAX_GATHERED)
}
