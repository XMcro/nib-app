import { readJson, writeJson } from './jsonStorage'
import { asTrades, type Trade } from './market'
import { BOOK, type Received } from './stampbook'
import { isDay } from './time'

/**
 * The stamps as sync carries them between devices (sync/engine): the days
 * stamped, the stampbook's stamps received, the doors opened late, the years
 * Christmas Day's and Nib's birthday's presents were opened, and the market's
 * trades (lib/market), each by its id. One record, sealed like a document.
 * Two devices' are merged by keeping all that either has, so a pack or a
 * present opened on one is opened on all of them, a stamp sold on one is sold
 * on all, and nothing found anywhere is lost. Always in one order, so the same
 * stamps read the same on every device and nothing goes back and forth for
 * nothing.
 */
export type Collection = { stamps: string[]; book: Received; late: Record<string, string>; christmas: number[]; birthday: number[]; trades: Trade[] }

/** Where each is kept on this device, in the order they are written. */
const KEYS: Record<keyof Collection, string> = {
  /** The days a pack was opened, and the doors and Christmas Days given besides. */
  stamps: 'nib-stamps',
  /** The stampbook's stamps received, as `[day, number]`, in the order they came: three to each day's pack. */
  book: 'nib-book',
  /** Each door opened after its own day, with the day it was: `{ door: day }`. */
  late: 'nib-doors-late',
  /** The years whose Christmas present has been opened. */
  christmas: 'nib-christmas',
  /** The years its present has been opened (lib/birthday). */
  birthday: 'nib-birthday',
  trades: 'nib-trades',
}

/** Sent on the window a few seconds after this device opens a pack or a present (`keepStamps`), for sync to send it soon (sync/session). */
export const STAMPS_CHANGED = 'nib-stamps-changed'
/** Sent when sync brings stamps from another device (lib/collection), for what shows them to read them again. */
export const STAMPS_SYNCED = 'nib-stamps-synced'

/** As stored, or as sync brings them (lib/collection): anything else is passed over. */
const asDays = (days: unknown): string[] => (Array.isArray(days) ? days.filter(isDay) : [])
const asLate = (late: unknown): Record<string, string> =>
  late && typeof late === 'object' && !Array.isArray(late)
    ? Object.fromEntries(Object.entries(late).filter((entry): entry is [string, string] => isDay(entry[1])))
    : {}
const asBook = (book: unknown): Received =>
  Array.isArray(book)
    ? book.filter((one): one is [string, number] => Array.isArray(one) && isDay(one[0]) && Number.isInteger(one[1]) && one[1] >= 1 && one[1] <= BOOK.length)
    : []
const asYears = (years: unknown): number[] => (Array.isArray(years) ? years.filter((year): year is number => Number.isInteger(year)) : [])

const byDayThenNumber = ([a, x]: [string, number], [b, y]: [string, number]) => (a < b ? -1 : a > b ? 1 : x - y)
const years = (value: unknown) => [...new Set(asYears(value))].sort((a, b) => a - b)

/** Taken from storage or from another device: anything that isn't stamps is passed over, and the rest put in order. */
export function asCollection(value: unknown): Collection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const seen = new Set<string>()
  const book = asBook(v.book).filter(([day, no]) => !seen.has(`${day} ${no}`) && seen.add(`${day} ${no}`))
  const late = asLate(v.late)
  // A day's coins collected on two devices before they synced, as different days of the week: the more, on every device.
  // Otherwise the copy that holds more, as a later Nib's with fields this one doesn't know; only then, to agree, the greater.
  const holds = (trade: Trade) => Object.keys(trade).length + trade.sold.length + (trade.bought?.length ?? 0) + (trade.gave?.length ?? 0)
  const byId = new Map<string, Trade>()
  for (const trade of asTrades(v.trades)) {
    const had = byId.get(trade.id)
    const more = had && ((trade.earned ?? 0) - (had.earned ?? 0) || holds(trade) - holds(had))
    if (!had || (more ? more > 0 : JSON.stringify(trade) > JSON.stringify(had))) byId.set(trade.id, trade)
  }
  const trades = [...byId.values()]
  return {
    stamps: [...new Set(asDays(v.stamps))].sort(),
    book: book.sort(byDayThenNumber),
    late: Object.fromEntries(Object.keys(late).sort().map((door) => [door, late[door]])),
    christmas: years(v.christmas),
    birthday: years(v.birthday),
    trades: trades.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }
}

const NAMES = Object.keys(KEYS) as (keyof Collection)[]
const stored = (name: keyof Collection) => readJson<unknown>(KEYS[name], null)

/** The days stamped, oldest first. */
export function readStamps(): string[] {
  return asDays(stored('stamps'))
}

/** The day each door was opened, for those opened after their own (`catchUp`); any other opened on its day. */
export function openedLate(): Record<string, string> {
  return asLate(stored('late'))
}

/** The stampbook's stamps received, oldest first: any that aren't a day and one of the 300 are passed over. */
export function readBook(): Received {
  return asBook(stored('book'))
}

/** The years Christmas Day's present has been opened. */
export function openedChristmases(): number[] {
  return asYears(stored('christmas'))
}

/** The years Nib's birthday's present has been opened. */
export function openedBirthdays(): number[] {
  return asYears(stored('birthday'))
}

export function readTrades(): Trade[] {
  return asTrades(stored('trades'))
}

/** This device's. */
export function readCollection(): Collection {
  return asCollection(Object.fromEntries(NAMES.map((name) => [name, stored(name)])))!
}

/** All that either has. A day's pack opened on both before they synced keeps both packs' stamps; a door opened late on both keeps the earlier day, on both; every trade either made is kept. */
export function merge(here: Collection, there: Collection): Collection {
  return asCollection({
    stamps: [...here.stamps, ...there.stamps],
    book: [...here.book, ...there.book],
    late: Object.fromEntries([...new Set([...Object.keys(here.late), ...Object.keys(there.late)])].map((door) => [door, [here.late[door], there.late[door]].filter(Boolean).sort()[0]])),
    christmas: [...here.christmas, ...there.christmas],
    birthday: [...here.birthday, ...there.birthday],
    trades: [...here.trades, ...there.trades],
  } satisfies Record<keyof Collection, unknown>)!
}

export const sameCollection = (a: Collection, b: Collection) => JSON.stringify(a) === JSON.stringify(b)
export const emptyCollection = (c: Collection) => !c.stamps.length && !c.book.length && !c.christmas.length && !c.birthday.length && !c.trades.length

/** How long after this device's stamps change it's said (`keepStamps`): past the coins' count and a pack's opening, which the tap that changed them begins. */
const SOON_MS = 4000
let saying: ReturnType<typeof setTimeout> | undefined

function say() {
  clearTimeout(saying)
  saying = undefined
  document.removeEventListener('visibilitychange', sayAsPutAway)
  window.dispatchEvent(new Event(STAMPS_CHANGED))
}
const sayAsPutAway = () => document.visibilityState === 'hidden' && say()

/**
 * What this device opened, sold or bought, kept, and said once, however much of it there is, for sync and iCloud to
 * send it soon. Not within the tap: iCloud's merge and a whole look by sync then ran before the coins could spring
 * or the pack tear. A few seconds after the last of it, or at once as Nib is put away, while it can still be sent.
 */
export function keepStamps(changed: Partial<Collection>) {
  for (const [name, value] of Object.entries(changed)) writeJson(KEYS[name as keyof Collection], value)
  clearTimeout(saying)
  saying = setTimeout(say, SOON_MS)
  document.addEventListener('visibilitychange', sayAsPutAway)
}

/** Kept as this device's, and said, for what shows the stamps to read them again. */
function writeCollection(c: Collection) {
  try {
    for (const name of NAMES) localStorage.setItem(KEYS[name], JSON.stringify(c[name]))
  } catch {
    // Storage off: as before, until it's back.
  }
  window.dispatchEvent(new Event(STAMPS_SYNCED))
}

/** This device's, with `there`'s, if there are any known. */
export function mergedWith(there: Collection | null): Collection {
  const here = readCollection()
  return there ? merge(here, there) : here
}

/** Another device's, taken in with this one's, and said if they brought any: whether they did. */
export function takeIn(there: Collection | null): boolean {
  const here = readCollection()
  const both = there ? merge(here, there) : here
  if (sameCollection(both, here)) return false
  writeCollection(both)
  return true
}
