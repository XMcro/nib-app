import { KEEPSAKE_DAYS, keepsakeDaysFound } from './holidays'
import { doorOf, type Stamp } from './rewards'
import { DOORS, MOTIFS } from './stampWords'
import { BOOK, RARITIES, STAMP_INKS, type Rarity } from './stampbook'

/**
 * Two keepsakes earned rather than found on a day, for the Stampbook's
 * keepsakes page: a year with Nib, a year from the first day stamped or the
 * oldest document, whichever came first; and a
 * rarity completed, the first time every stamp of one rarity has been found.
 * Worked out from the stamps wherever they're read, so they come to every
 * device with them (lib/collection), and they're never traded or a repeat.
 */

export function yearStamp(day: string): Stamp {
  return { day, motif: MOTIFS.indexOf('Rings in a tree stump'), ink: STAMP_INKS.umber, prompt: '', rarity: 'legendary', ground: 'rays' }
}

export function rarityStamp(day: string): Stamp {
  return { day, motif: MOTIFS.indexOf('A rosette'), ink: STAMP_INKS.rose, prompt: '', rarity: 'mythic', ground: 'rays' }
}

/** Inkwell's own (components/Buddy), kept the first time it tells its story (lib/buddy `keepInkwell`): on this device, as first steps' is. */
export function inkwellStamp(day: string): Stamp {
  return { day, motif: MOTIFS.indexOf('Inkwell, the nib with a face'), ink: STAMP_INKS.violet, prompt: '', rarity: 'unique', ground: 'lines' }
}

/** Nib's first day: a year with it is counted from no earlier, whatever the dates of documents imported from elsewhere. */
const NIB_BEGAN = '2026-08-06'

/**
 * A year from the first day stamped, or from `written`, the day of the oldest
 * document, if that came first: a writer from before the stamps has been with
 * Nib since then. Documents imported keep their old apps' dates, and Nib
 * can't tell them apart, so none counts from before NIB_BEGAN. Kept once it's
 * come; null with nothing stamped or written yet. A first day on 29 February
 * comes round on 1 March.
 */
export function yearOf(stamps: string[], written: string | null = null): string | null {
  const days = [...stamps, ...(written ? [written < NIB_BEGAN ? NIB_BEGAN : written] : [])]
  const first = days.reduce<string | null>((earliest, day) => (!earliest || day < earliest ? day : earliest), null)
  if (!first) return null
  return `${Number(first.slice(0, 4)) + 1}-${first.slice(5) === '02-29' ? '03-01' : first.slice(5)}`
}

/** The first rarity completed, and the day: its last stamp found. `found`: each stamp's days found, oldest first (lib/stampbook's foundIn). */
export function rarityOf(found: Map<number, string[]>): { rarity: Rarity; day: string } | null {
  let first: { rarity: Rarity; day: string } | null = null
  for (const rarity of RARITIES) {
    const days = BOOK.filter((entry) => entry.rarity === rarity).map((entry) => found.get(entry.no)?.[0])
    if (days.some((day) => !day)) continue
    const day = (days as string[]).reduce((last, one) => (one > last ? one : last))
    if (!first || day < first.day) first = { rarity, day }
  }
  return first
}

/** The keepsakes: first steps' stamp, Nib's birthday's and Inkwell's, the five specials (a year with Nib, a rarity completed, and the keepsake days), and the Christmas calendar's 24 doors. */
export const KEEPSAKES = 3 + 2 + KEEPSAKE_DAYS.length + DOORS

/** The keepsakes found: the days first steps were done and Nib's birthday stamp kept, and the days each door was opened. */
/** `year`: the day a year with Nib was kept, once it's come (`yearDue`); `days`: the keepsake days found (lib/holidays), by name. */
export type Keeps = {
  firstSteps: string | null
  birthday: string | null
  /** The day Inkwell first told its story. */
  inkwell: string | null
  year: string | null
  yearDue: string | null
  rarity: { rarity: Rarity; day: string } | null
  days: Map<string, string[]>
  doors: Map<number, string[]>
}

/** Each Christmas calendar door opened, in any December, and the days it was. */
function doorsFound(stamps: string[]): Map<number, string[]> {
  const doors = new Map<number, string[]>()
  for (const day of stamps) {
    const door = doorOf(day)
    if (door !== null) doors.set(door, [...(doors.get(door) ?? []), day])
  }
  return doors
}

/** What's been kept, from the days stamped. `found`: each stamp's days found (lib/stampbook's foundIn). */
export function keepsOf({ stamps, found, firstSteps, birthday, inkwell = null, written, today }: { stamps: string[]; found: Map<number, string[]>; firstSteps: string | null; birthday: string | null; inkwell?: string | null; written: string | null; today: string }): Keeps {
  const year = yearOf(stamps, written)
  return { firstSteps, birthday, inkwell, year: year && year <= today ? year : null, yearDue: year, rarity: rarityOf(found), days: keepsakeDaysFound(stamps), doors: doorsFound(stamps) }
}

export const keptOf = (keeps: Keeps) => (keeps.firstSteps ? 1 : 0) + (keeps.birthday ? 1 : 0) + (keeps.inkwell ? 1 : 0) + (keeps.year ? 1 : 0) + (keeps.rarity ? 1 : 0) + keeps.days.size + keeps.doors.size
