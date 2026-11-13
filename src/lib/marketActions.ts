import { newClaim, normalCode } from '../../worker/wire.mjs'
import { askForCoins, fingerprintOf } from './codes'
import { keepStamps, readBook, readTrades } from './collection'
import { readJson, writeJson } from './jsonStorage'
import { copiesOf, counted, dailyOf, FEEDBACK_GIFT, lastOne, loginFor, PACKS, PACKS_A_WEEK, PLUS_DAYS, plusCoinsOf, plusUntil, pointsOf, REROLL, REROLLS_A_WEEK, thisWeek, type Trade } from './market'
import { bookStamp, type Pack, type Redeemed } from './rewards'
import { BOOK, drawStamp, RARITIES, type Received } from './stampbook'

/** Codes for coins being asked for (lib/codes), by fingerprint: each attempt's claim, till its coins are kept. On this device only. */
const CLAIMS_KEY = 'nib-coin-claims'

/** The market as its screens take it (components/Stampbook and Market), made once from the stamps as they stand (lib/useStamps). */
export type StampMarket = {
  /** The stampbook's stamps received. */
  received: Received
  /** The market's trades (lib/market). */
  trades: Trade[]
  /** Today's pack is open, so there's a stamp to draw again. */
  canReroll: boolean
  /** Nib Plus from the App Store: nothing for points to add. */
  subscribed: boolean
  /** The day it is (lib/useStamps), kept up to date past midnight. */
  today: string
  /** The latest day the stamps and coins have seen, with the device's date before it (lib/useStamps): nothing to spend on till then. */
  behind: string | null
  /** Sells these repeats, a copy each, by number, for coins. */
  sell: (nos: number[]) => void
  /** The coins there are (lib/market). */
  points: number
  /** Today's coins for coming back, still to collect (lib/market's loginFor); null once they are. */
  login: { step: number; coins: number; rest: number } | null
  /** Collects them, once: the coins kept, worked out afresh, or null if there were none to collect. */
  collect: () => number | null
  /** Takes a code's coins from Nib's server (lib/codes): how many; or that it's no code, has ended, is used up, was used on this Apple Account or with sync, or the server couldn't be reached. */
  redeem: (code: string) => Promise<Redeemed>
  /** Buys a pack of `size` stamps, each at the odds, and opens it; null if the points or this week's packs have run out. */
  buyPack: (size: number) => Pack | null
  /** Draws today's stamp again, in place of the one there was; null without today's pack opened, the points, or this week's re-rolls. */
  reroll: () => Pack | null
  /** Until when Nib Plus's features are open by points (lib/market): 0 for never. */
  plusUntil: number
  /** Buys so many days of Plus's features, if the points are there: whether it did. */
  buyPlus: (days: number) => boolean
  /** A first message of feedback's two weeks of Plus's features: until when they're open, or null if they've been given before. */
  giftPlus: () => number | null
}

/** What the stamps' hook holds, for the market to read and to keep its trades in. */
type Holding = {
  today: string
  plus: boolean
  received: Received
  trades: Trade[]
  setTrades: (trades: Trade[]) => void
  waiting: boolean
  behind: string | null
  behindNow: () => boolean
}

export function marketOf({ today, plus, received, trades, setTrades, waiting, behind, behindNow }: Holding): StampMarket {
  /** A trade kept, here and for sync. */
  function record(all: Trade[], trade: Trade): Trade[] {
    const next = [...all, trade]
    keepStamps({ trades: next })
    setTrades(next)
    return next
  }

  /** A pack bought or a re-roll, kept, and what it held, as a pack opens: new to the book or not, and how many there are now. `given`: what it gave back first. */
  function bought(all: Trade[], trade: Trade, nos: number[], given: Map<number, number>): Pack {
    const book = readBook()
    const before = copiesOf(book, all)
    for (const [no, change] of given) before.set(no, (before.get(no) ?? 0) + change)
    const after = copiesOf(book, record(all, trade))
    const seen = new Set<number>()
    return {
      day: today,
      dayStamp: null,
      caughtUp: null,
      stamps: nos.map((no) => {
        const fresh = !before.get(no) && !seen.has(no)
        seen.add(no)
        return { ...bookStamp(no, today), fresh, copies: after.get(no) ?? 1 }
      }),
      prompt: '',
    }
  }

  return {
    received,
    trades,
    canReroll: !waiting,
    subscribed: plus,
    today,
    behind,
    sell: (nos) => {
      // Never the last of any: what's spare now, read afresh, as another window may have sold some.
      const all = readTrades()
      const copies = copiesOf(readBook(), all)
      const sold = nos.filter((no) => {
        const left = copies.get(no) ?? 0
        if (left < 2) return false
        copies.set(no, left - 1)
        return true
      })
      if (sold.length) record(all, { id: crypto.randomUUID(), day: today, sold })
    },
    points: pointsOf(received, trades),
    login: behind || trades.some((trade) => trade.kind === 'login' && trade.day === today) ? null : loginFor(trades, today, plus),
    collect: () => {
      if (behindNow()) return null
      // Read afresh: collected already in another window, or on another device, is collected.
      const all = readTrades()
      if (all.some((trade) => trade.kind === 'login' && trade.day === today)) {
        setTrades(all)
        return null
      }
      const { step, coins } = loginFor(all, today, plus)
      record(all, { id: `login:${today}`, day: today, sold: [], kind: 'login', earned: coins, step })
      return coins
    },
    redeem: async (code) => {
      if (!normalCode(code)) return 'unknown'
      const fingerprint = fingerprintOf(code)
      const id = `code:${fingerprint}`
      if (readTrades().some((trade) => trade.id === id)) return 'used'
      // This attempt's claim, kept till its coins are: asked again after an answer lost on the way, the server counts it once.
      const claims = readJson<Record<string, string>>(CLAIMS_KEY, {})
      const claim = claims[fingerprint] ?? newClaim()
      writeJson(CLAIMS_KEY, { ...claims, [fingerprint]: claim })
      const answer = await askForCoins(fingerprint, claim)
      if (answer === 'offline') return answer
      // Read afresh: collected meanwhile in another window, or brought from another device, is used.
      const all = readTrades()
      let result: Redeemed
      if (typeof answer === 'string') result = answer
      else if (all.some((trade) => trade.id === id)) result = 'used'
      else {
        record(all, { id, day: today, sold: [], kind: 'code', earned: answer.coins, claim, sig: answer.sig })
        result = answer.coins
      }
      // Only then is the claim done with: its coins kept, or the code no use.
      const left = readJson<Record<string, string>>(CLAIMS_KEY, {})
      delete left[fingerprint]
      writeJson(CLAIMS_KEY, left)
      return result
    },
    buyPack: (size) => {
      const all = readTrades()
      const pack = PACKS.find((one) => one.size === size)
      if (!pack || behindNow() || pointsOf(readBook(), all) < pack.price || thisWeek(all, 'pack', today) >= PACKS_A_WEEK) return null
      const id = crypto.randomUUID()
      // The rarest last, to come out face down.
      const rank = (no: number) => RARITIES.indexOf(BOOK[no - 1].rarity)
      const nos = Array.from({ length: size }, (_, i) => drawStamp(`${id}:${i}`)).sort((a, b) => rank(a) - rank(b) || a - b)
      return bought(all, { id, day: today, sold: [], kind: 'pack', spent: pack.price, bought: nos }, nos, new Map())
    },
    plusUntil: plusUntil(counted(received, trades), Date.now()),
    buyPlus: (days) => {
      const all = readTrades()
      const length = PLUS_DAYS.find((one) => one.days === days)
      if (!length || behindNow() || plusCoinsOf(readBook(), all) < length.price) return false
      record(all, { id: crypto.randomUUID(), day: today, sold: [], kind: 'plus', spent: length.price, days, at: Date.now() })
      return true
    },
    giftPlus: () => {
      const all = readTrades()
      if (all.some((trade) => trade.id === FEEDBACK_GIFT.id)) return null
      const at = Date.now()
      return plusUntil(counted(readBook(), record(all, { id: FEEDBACK_GIFT.id, day: today, sold: [], kind: 'plus', days: FEEDBACK_GIFT.days, at })), at)
    },
    reroll: () => {
      const all = readTrades()
      const book = readBook()
      const daily = dailyOf(book, all)
      const old = daily.filter(([day]) => day === today).at(-1)?.[1]
      // Never the one of a stamp had before today that's always kept: its spares sold, today's is it.
      if (!old || behindNow() || lastOne(book, all, old, today) || pointsOf(book, all) < REROLL || thisWeek(all, 'reroll', today) >= REROLLS_A_WEEK) return null
      const id = crypto.randomUUID()
      // At the day's odds, as the pack it stands in for.
      const no = drawStamp(`${today}:${id}`)
      return bought(all, { id, day: today, sold: [], kind: 'reroll', spent: REROLL, gave: [old], bought: [no] }, [no], new Map([[old, -1]]))
    },
  }
}
