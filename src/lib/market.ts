import { BOOK, type Rarity, type Received } from './stampbook'
import { codeCoinsKept } from './codes'
import { isDay, isTime } from './time'

/**
 * The stamp market: repeats from the stampbook sold for coins, and the day's
 * coins for coming back to Nib, which buy a pack, another go at today's
 * stamp, or days of Nib Plus's features (not sync, which is the
 * subscription's). A stamp is never bought outright, and only the 300 are
 * sold; a holiday's, a door's and the keepsakes are never repeats. Every trade,
 * and every day's coins, is kept, by an id of its own, in a log that syncs
 * with the stamps (lib/collection): two devices' logs merge by keeping every
 * trade either made, so a stamp sold or bought on one is on all, and the
 * coins are worked out from the log wherever it's read, never stored.
 */

/** What a repeat sells for, by rarity. */
export const VALUE: Record<Rarity, number> = { common: 1, rare: 5, unique: 25, legendary: 100, mythic: 500 }
/** The packs to buy, by how many stamps are in them, and what each costs. */
export const PACKS = [
  { size: 1, price: 50 },
  { size: 3, price: 150 },
  { size: 10, price: 500 },
] as const
/** How many packs can be bought a week, Monday to Sunday, of any size. */
export const PACKS_A_WEEK = 5
/** Another go at today's stamp, and how many a week. */
export const REROLL = 50
export const REROLLS_A_WEEK = 10
/** Days of Nib Plus's features, and what each length costs. */
export const PLUS_DAYS = [
  { days: 1, label: '1 day', price: 500 },
  { days: 7, label: '1 week', price: 3000 },
  { days: 14, label: '2 weeks', price: 6500 },
  { days: 30, label: '1 month', price: 13000 },
] as const
/** Their prices before 5 November's (Nib 1.10.09 builds 33 to 36), for days bought then. */
const PLUS_DAYS_BEFORE = [
  { days: 1, price: 150 },
  { days: 7, price: 750 },
  { days: 14, price: 1500 },
  { days: 30, price: 5000 },
]
const DAY_MS = 86_400_000
/** A first message of feedback's two weeks of Plus's features (lib/feedback). One id, so two devices' logs hold it once. */
export const FEEDBACK_GIFT = { id: 'gift:feedback', days: 14 } as const

/**
 * The day's coins for coming back: 10 the first day, twice the day before's
 * each day after, for a week running (10 to 640); a day missed starts it over.
 * After a week's seventh day it's 10 a day, and no doubling, for 31 days.
 * Two and a half times as many with Nib Plus's subscription.
 */
const LOGIN = 10
export const LOGIN_WEEK = 7
const LOGIN_REST = 31
const LOGIN_PLUS = 2.5

const KINDS = ['stamp', 'pack', 'reroll', 'plus', 'login', 'code'] as const

/**
 * One trade, on its day. `sold`: repeats traded in, a copy each, by number.
 * `spent`, the coins it took, for `bought`: a stamp chosen ('stamp'), a
 * pack's ('pack'), or for a re-roll ('reroll') today's stamp's new draw, in
 * place of the one it `gave` back; or ('plus') `days` of Plus's features,
 * from the moment it was made (`at`). Or the day's coins ('login', by the
 * id `login:` and the day), `earned` on the week's day `step`, 1 to 7, or
 * 0 for a day after a week, at 10. Or a code's coins ('code', by the id
 * `code:` and its fingerprint, lib/codes), `earned` once.
 */
export type Trade = {
  id: string
  day: string
  sold: number[]
  kind?: (typeof KINDS)[number]
  spent?: number
  bought?: number[]
  gave?: number[]
  days?: number
  at?: number
  earned?: number
  step?: number
  /** A code's: the claim it was asked with, and the server's signature on its coins (lib/codes). */
  claim?: string
  sig?: string
}

const stamps = (nos: unknown) => (Array.isArray(nos) ? nos.filter((no): no is number => Number.isInteger(no) && no >= 1 && no <= BOOK.length) : [])
/** A trade's fields as this Nib reads them. Any other, from a later Nib, is kept as it is, so a merge here doesn't strip it. */
/**
 * The first day the market checks the trades it reads (Nib 1.10.09 build 40,
 * Docs/audit-2026-11-05.md): a sale only while it leaves one, a code's coins
 * only as the server signed them, a day's coins only as its day of the week
 * gives. Trades from before are counted as they were then, or the checks took
 * coins already earned, and already spent, from their writers.
 */
export const CHECKED_FROM = '2026-11-07'
/**
 * The first day the market asks more of a trade (security 2 of
 * Docs/audit-2026-11-08.md): coins only from a kind with a rule for them, a
 * day's coins only under that day's own id, an id counted once, and a spend
 * only if the coins were there (`counted`). New Year's Day, weeks past any
 * build these checks could ship in, so nothing written under the old rules is
 * ever read by the new: those trades are counted as they always were.
 */
export const LEDGER_FROM = '2027-01-01'
const KNOWN = new Set(Object.keys({ id: 1, day: 1, sold: 1, kind: 1, spent: 1, bought: 1, gave: 1, days: 1, at: 1, earned: 1, step: 1, claim: 1, sig: 1 } satisfies Record<keyof Trade, 1>))

/** As stored, or as sync brings it: anything that isn't a trade is passed over. */
export const asTrades = (trades: unknown): Trade[] =>
  Array.isArray(trades)
    ? trades
        .filter((trade) => !!trade && typeof trade.id === 'string' && !!trade.id && isDay(trade.day))
        .map((trade): Trade => {
          const one: Trade = { id: trade.id, day: trade.day, sold: stamps(trade.sold) }
          if (KINDS.includes(trade.kind)) one.kind = trade.kind
          if (Number.isInteger(trade.spent) && trade.spent > 0) one.spent = trade.spent
          if (Array.isArray(trade.bought)) one.bought = stamps(trade.bought)
          if (Array.isArray(trade.gave)) one.gave = stamps(trade.gave)
          // Days of Plus only as they're sold, a length for its price: written in by hand, they open nothing.
          const sold = [...PLUS_DAYS, ...(one.day < CHECKED_FROM ? PLUS_DAYS_BEFORE : [])]
          const gift = one.id === FEEDBACK_GIFT.id && trade.days === FEEDBACK_GIFT.days && one.spent === undefined
          if (one.kind === 'plus' && (gift || sold.some(({ days, price }) => days === trade.days && price === one.spent))) one.days = trade.days
          if (isTime(trade.at)) one.at = trade.at
          if (Number.isInteger(trade.step) && trade.step >= 0 && trade.step <= LOGIN_WEEK) one.step = trade.step
          if (typeof trade.claim === 'string') one.claim = trade.claim
          if (typeof trade.sig === 'string') one.sig = trade.sig
          // The day's coins only as many as its day of the week gives, with Plus or without; a code's only as the server signed them.
          // Any other kind's, from LEDGER_FROM on, are written in by hand: only those two ever earned any.
          const earned =
            Number.isInteger(trade.earned) &&
            trade.earned > 0 &&
            (one.day < CHECKED_FROM ||
              (one.kind === 'login'
                ? one.step !== undefined && [false, true].some((plus) => loginCoins(one.step!, plus) === trade.earned) && (one.day < LEDGER_FROM || one.id === `login:${one.day}`)
                : one.kind === 'code'
                  ? one.id.startsWith('code:') && codeCoinsKept(one.id.slice('code:'.length), trade.earned, one.claim, one.sig)
                  : one.day < LEDGER_FROM))
          if (earned) one.earned = trade.earned
          for (const [key, value] of Object.entries(trade)) if (!KNOWN.has(key)) (one as Record<string, unknown>)[key] = value
          return one
        })
    : []

/**
 * The day's packs' stamps, by day, each re-roll's draw in place of the stamp
 * it gave back. A re-roll that gave back another's draw goes once that one
 * has, so a day's re-rolls chain whatever order a merge put the log in; one
 * with nothing here to give back (its day's pack not here yet) keeps its draw.
 */
export const dailyOf = (received: Received, trades: Trade[]): Received => swapped(received, counted(received, trades))

function swapped(received: Received, trades: Trade[]): Received {
  const daily = [...received]
  let left = trades.flatMap(({ kind, day, gave = [], bought = [] }) => (kind === 'reroll' ? gave.flatMap((no, i) => (bought[i] ? [{ day, gave: no, got: bought[i] }] : [])) : []))
  for (let going = true; going; ) {
    going = false
    left = left.filter(({ day, gave, got }) => {
      const at = daily.findIndex(([on, had]) => on === day && had === gave)
      if (at < 0) return true
      daily[at] = [day, got]
      going = true
      return false
    })
  }
  for (const { day, got } of left) daily.push([day, got])
  return daily
}

/** Every stamp got, by day: the day's packs' (re-rolls and all), and the market's. */
export const gotOf = (received: Received, trades: Trade[]): Received => gotIn(received, counted(received, trades))

function gotIn(received: Received, trades: Trade[]): Received {
  const got = swapped(received, trades)
  for (const { kind, day, bought = [] } of trades) if (kind === 'stamp' || kind === 'pack') for (const no of bought) got.push([day, no])
  return got
}

/**
 * How many of each stamp were got, and how many of those sold: a sale counts
 * only while it leaves one, so the same spare sold on two devices before they
 * caught up with each other is sold once, and one never got isn't sold at all.
 */
function heldOf(received: Received, trades: Trade[]): { got: Map<number, number>; sold: Map<number, number> } {
  const got = new Map<number, number>()
  for (const [, no] of gotIn(received, trades)) got.set(no, (got.get(no) ?? 0) + 1)
  // Sales from before the checks (CHECKED_FROM) count as they did then; later ones only while one is left.
  const before = new Map<number, number>()
  const asked = new Map<number, number>()
  for (const { day, sold } of trades) for (const no of sold) (day < CHECKED_FROM ? before : asked).set(no, ((day < CHECKED_FROM ? before : asked).get(no) ?? 0) + 1)
  const sold = new Map(
    [...new Set([...before.keys(), ...asked.keys()])].map((no): [number, number] => {
      const then = before.get(no) ?? 0
      return [no, then + Math.min(asked.get(no) ?? 0, Math.max(0, (got.get(no) ?? 0) - then - 1))]
    }),
  )
  return { got, sold }
}

/** The coins all the stamps sold have brought. */
const salesOf = (sold: Map<number, number>) => [...sold].reduce((sum, [no, n]) => sum + n * VALUE[BOOK[no - 1].rarity], 0)

/**
 * The same coins can be spent on each of a writer's devices before they catch
 * up with each other, and every one of those trades is real: an iPhone, an
 * iPad and a Mac.
 */
const DEVICES = 3

/**
 * The trades that count, as the log is read; the log itself keeps them all,
 * for a later Nib or a device with more to go on. Before LEDGER_FROM, every
 * one. From then, an id once, and a spend only if the coins were there: what
 * the whole log has earned, once for each device, whenever it was earned, so
 * no spend made on a device that hadn't heard of another's is ever lost. Oldest
 * first and, on a day, the smallest, so what's left out is the last and the
 * largest; and round again, as a pack's stamps, sold, can pay for the next.
 */
export function counted(received: Received, trades: Trade[]): Trade[] {
  if (!trades.some(({ day }) => day >= LEDGER_FROM)) return trades
  const ids = new Set<string>()
  const once = trades.filter(({ id, day }) => day < LEDGER_FROM || (!ids.has(id) && !!ids.add(id)))
  const unpaid = new Set(once.filter(({ day, spent }) => day >= LEDGER_FROM && spent).sort((a, b) => a.day.localeCompare(b.day) || a.spent! - b.spent! || a.id.localeCompare(b.id)))
  for (let going = true; going; ) {
    going = false
    const log = once.filter((trade) => !unpaid.has(trade))
    let left = DEVICES * log.reduce((sum, { earned = 0 }) => sum + earned, salesOf(heldOf(received, log).sold)) - log.reduce((sum, { day, spent = 0 }) => sum + (day >= LEDGER_FROM ? spent : 0), 0)
    for (const trade of unpaid) {
      if (trade.spent! > left) continue
      left -= trade.spent!
      unpaid.delete(trade)
      going = true
    }
  }
  return unpaid.size ? once.filter((trade) => !unpaid.has(trade)) : once
}

/** How many of each stamp there are: every one got, less those sold. */
export function copiesOf(received: Received, trades: Trade[]): Map<number, number> {
  const { got, sold } = heldOf(received, counted(received, trades))
  return new Map([...got].map(([no, n]): [number, number] => [no, n - (sold.get(no) ?? 0)]))
}

/** The coins to spend: all that's been sold or earned, less all that's been spent. Below nothing only when two devices spent the same coins before they caught up with each other. */
export function pointsOf(received: Received, trades: Trade[]): number {
  const log = counted(received, trades)
  return log.reduce((sum, { spent = 0, earned = 0 }) => sum - spent + earned, salesOf(heldOf(received, log).sold))
}

/**
 * The coins that can buy days of Plus: not those from codes, which packs and
 * re-rolls spend first. Plus is sold in the App Store, and App Review's rule
 * 3.1.1 keeps a code from unlocking what's sold there.
 */
export function plusCoinsOf(received: Received, trades: Trade[]): number {
  const log = counted(received, trades)
  const fromCodes = log.reduce((sum, { kind, earned = 0 }) => sum + (kind === 'code' ? earned : 0), 0)
  const onStamps = log.reduce((sum, { kind, spent = 0 }) => sum + (kind === 'pack' || kind === 'reroll' ? spent : 0), 0)
  return pointsOf(received, log) - Math.max(0, fromCodes - onStamps)
}

/** Whether giving back `no` today, a re-roll's, would leave none of a stamp had before today: the one of each that's always kept. */
export function lastOne(received: Received, trades: Trade[], no: number, today: string): boolean {
  return (copiesOf(received, trades).get(no) ?? 0) <= 1 && gotOf(received, trades).some(([day, had]) => had === no && day < today)
}

/** Each stamp with more than one copy, by number, and how many can go: all but one. */
export function repeatsOf(received: Received, trades: Trade[]): { no: number; spare: number }[] {
  return [...copiesOf(received, trades)]
    .filter(([, copies]) => copies > 1)
    .map(([no, copies]) => ({ no, spare: copies - 1 }))
    .sort((a, b) => a.no - b.no)
}

/** The Monday of `day`'s week, `YYYY-MM-DD`. */
export function weekOf(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  const at = new Date(Date.UTC(year, month - 1, date))
  at.setUTCDate(date - ((at.getUTCDay() + 6) % 7))
  return at.toISOString().slice(0, 10)
}

/** How many of a kind of trade there have been in `today`'s week. */
export function thisWeek(trades: Trade[], kind: Trade['kind'], today: string): number {
  const monday = weekOf(today)
  return trades.filter((trade) => trade.kind === kind && weekOf(trade.day) === monday).length
}

/**
 * Until when Plus's features are open by coins: each length bought runs on
 * from the last, or from when it was bought. 0 for none. One bought with the
 * clock set ahead of `now` opens nothing till then, so setting it back
 * after doesn't keep it open for years.
 */
export function plusUntil(trades: Trade[], now: number): number {
  return trades
    .filter((trade) => trade.kind === 'plus' && trade.days && trade.at !== undefined && trade.at <= now)
    .sort((a, b) => a.at! - b.at!)
    .reduce((until, { days, at }) => Math.max(until, at!) + days! * DAY_MS, 0)
}

/** Days from `from` to `to`, both `YYYY-MM-DD`. */
function daysFrom(from: string, to: string): number {
  const at = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
  return Math.round((at(to) - at(from)) / DAY_MS)
}

/** What a day of the week's coins is: 10, doubling each day; 0, a day after a week, is 10 too. */
export const loginCoins = (step: number, plus: boolean) => LOGIN * 2 ** Math.max(0, step - 1) * (plus ? LOGIN_PLUS : 1)

/**
 * Today's coins for coming back, by the days before: the week's next day if
 * yesterday's were collected, or its first; 10 a day, step 0, for 31 days
 * after a week's seventh, and `rest`, the days of them left (0 for none).
 */
export function loginFor(trades: Trade[], today: string, plus: boolean): { step: number; coins: number; rest: number } {
  // Worked out again from the days collected, not the day of the week each was kept as: one collected
  // on a device that hadn't yet heard of the days before was kept as a week's first, and froze the week.
  const days = [...new Set(trades.filter((trade) => trade.kind === 'login' && trade.day < today).map((trade) => trade.day))].sort()
  let last: { day: string; step: number } | null = null
  let week: string | null = null
  const on = (day: string) => {
    const rest = week ? Math.max(0, LOGIN_REST - daysFrom(week, day)) : 0
    const step = rest ? 0 : last && daysFrom(last.day, day) === 1 && last.step && last.step < LOGIN_WEEK ? last.step + 1 : 1
    return { step, rest }
  }
  for (const day of days) {
    last = { day, step: on(day).step }
    if (last.step === LOGIN_WEEK) week = day
  }
  const { step, rest } = on(today)
  return { step, coins: loginCoins(step, plus), rest }
}
