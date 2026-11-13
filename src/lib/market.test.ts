import { describe, expect, it } from 'vitest'
import { asCollection, merge, type Collection } from './collection'
import { asTrades, CHECKED_FROM, counted, FEEDBACK_GIFT, copiesOf, dailyOf, gotOf, lastOne, LEDGER_FROM, loginFor, PLUS_DAYS, plusCoinsOf, plusUntil, pointsOf, repeatsOf, thisWeek, VALUE, weekOf, type Trade } from './market'
import { BOOK } from './stampbook'

const received: [string, number][] = [
  ['2026-11-01', 7],
  ['2026-11-02', 7],
  ['2026-11-03', 7],
  ['2026-11-03', 150],
  ['2026-11-04', 150],
  ['2026-11-04', 191],
]

describe('the market', () => {
  it('prices repeats as asked: common 1, rare 5, unique 25, legendary 100, mythic 500', () => {
    expect(VALUE).toEqual({ common: 1, rare: 5, unique: 25, legendary: 100, mythic: 500 })
    expect([7, 150, 191].map((no) => BOOK[no - 1].rarity)).toEqual(['common', 'rare', 'legendary'])
  })

  it('counts copies less those traded in, and points from every trade', () => {
    const trades: Trade[] = [
      { id: 'a', day: '2026-11-04', sold: [7] },
      { id: 'b', day: '2026-11-04', sold: [150] },
    ]
    expect(copiesOf(received, trades)).toEqual(new Map([[7, 2], [150, 1], [191, 1]]))
    expect(pointsOf(received, trades)).toBe(1 + 5)
    expect(pointsOf(received, [])).toBe(0)
  })

  // Two devices, before they caught up with each other, each sold the one spare: it was counted twice, a copy below none.
  it('counts a sale only while it leaves one, and none of a stamp never got', () => {
    const twice: Trade[] = [
      { id: 'a', day: '2026-11-10', sold: [150] },
      { id: 'b', day: '2026-11-10', sold: [150] },
      { id: 'c', day: '2026-11-10', sold: [300] },
    ]
    expect(copiesOf(received, twice).get(150)).toBe(1)
    expect(copiesOf(received, twice).has(300)).toBe(false)
    expect(pointsOf(received, twice)).toBe(5)
  })

  // The checks took coins already earned and spent: 1.10.09 build 40 showed -1,768 for a log from builds 33 to 39.
  it('counts a log from before its checks as it was counted then', () => {
    const before: Trade[] = [
      // The one spare sold twice, on two devices before they caught up, and a stamp never got.
      { id: 'a', day: '2026-11-04', sold: [150] },
      { id: 'b', day: '2026-11-05', sold: [150, 300] },
      // A code taken before the server signed; a day's coins off its day of the week; days of Plus at their old price.
      { id: 'code:x', day: '2026-11-05', sold: [], kind: 'code', earned: 500 },
      { id: 'login:2026-11-06', day: '2026-11-06', sold: [], kind: 'login', earned: 30, step: 1 },
      { id: 'p', day: '2026-11-05', sold: [], kind: 'plus', spent: 750, days: 7, at: 1 },
    ]
    const read = asTrades(before)
    expect(read.map((trade) => trade.earned ?? trade.days)).toEqual([undefined, undefined, 500, 30, 7])
    expect(pointsOf(received, read)).toBe(5 + 5 + VALUE[BOOK[299].rarity] + 500 + 30 - 750)
    // A sale since is checked, after them: no spare is left of 150.
    expect(pointsOf(received, [...read, { id: 'c', day: '2026-11-10', sold: [150] }])).toBe(pointsOf(received, read))
  })

  it('keeps today’s stamp from a re-roll when it’s the one kept of a stamp had before', () => {
    // 150, had on the 3rd and today, its spare sold: today's is the one kept. 191, first had today, can go.
    const sold: Trade[] = [{ id: 'a', day: '2026-11-04', sold: [150] }]
    expect(lastOne(received, sold, 150, '2026-11-04')).toBe(true)
    expect(lastOne(received, [], 150, '2026-11-04')).toBe(false)
    expect(lastOne(received, sold, 191, '2026-11-04')).toBe(false)
  })

  it('offers all but one of each as spare', () => {
    expect(repeatsOf(received, [])).toEqual([
      { no: 7, spare: 2 },
      { no: 150, spare: 1 },
    ])
    expect(repeatsOf(received, [{ id: 'a', day: '2026-11-04', sold: [150] }])).toEqual([{ no: 7, spare: 2 }])
  })

  it('prices days of Plus as asked: a day 500, a week 3,000, two weeks 6,500, a month 13,000', () => {
    expect(PLUS_DAYS.map(({ days, price }) => [days, price])).toEqual([
      [1, 500],
      [7, 3000],
      [14, 6500],
      [30, 13000],
    ])
  })

  it('counts what the market brought, and spent, and a re-roll in place of the stamp it gave back', () => {
    const trades: Trade[] = [
      { id: 'a', day: '2026-11-04', sold: [7, 7], spent: 0 },
      { id: 'b', day: '2026-11-04', sold: [], kind: 'stamp', spent: 2, bought: [8] },
      { id: 'c', day: '2026-11-04', sold: [], kind: 'pack', spent: 50, bought: [9] },
      { id: 'd', day: '2026-11-04', sold: [], kind: 'reroll', spent: 50, gave: [191], bought: [10] },
    ]
    expect(dailyOf(received, trades).filter(([day]) => day === '2026-11-04')).toEqual([
      ['2026-11-04', 150],
      ['2026-11-04', 10],
    ])
    expect(gotOf(received, trades).filter(([day]) => day === '2026-11-04').map(([, no]) => no)).toEqual([150, 10, 8, 9])
    expect(copiesOf(received, trades)).toEqual(new Map([[7, 1], [150, 2], [10, 1], [8, 1], [9, 1]]))
    expect(pointsOf(received, trades)).toBe(2 - 2 - 50 - 50)
  })

  // Merged, trades are put in order by day and then by id, which is random: X for Y, then Y for Z, came back as Y.
  it('chains a day’s re-rolls whatever order the log has them in, and keeps one with nothing to give back', () => {
    const first: Trade = { id: 'f', day: '2026-11-04', sold: [], kind: 'reroll', spent: 50, gave: [191], bought: [10] }
    const second: Trade = { id: 'e', day: '2026-11-04', sold: [], kind: 'reroll', spent: 50, gave: [10], bought: [11] }
    const third: Trade = { id: 'd', day: '2026-11-04', sold: [], kind: 'reroll', spent: 50, gave: [11], bought: [191] }
    const today = (trades: Trade[]) => dailyOf(received, trades).filter(([day]) => day === '2026-11-04')
    expect(today([first, second])).toEqual([['2026-11-04', 150], ['2026-11-04', 11]])
    expect(today([second, first])).toEqual([['2026-11-04', 150], ['2026-11-04', 11]])
    expect(today([third, second, first])).toEqual([['2026-11-04', 150], ['2026-11-04', 191]])
    // Its day's pack not here yet, as when the market's log comes before the stampbook: its draw is kept.
    expect(dailyOf([], [second])).toEqual([['2026-11-04', 11]])
  })

  it('counts a kind of trade by the week, Monday to Sunday', () => {
    expect(weekOf('2026-11-04')).toBe('2026-11-02')
    expect(weekOf('2026-11-08')).toBe('2026-11-02')
    expect(weekOf('2026-11-09')).toBe('2026-11-09')
    const packs: Trade[] = ['2026-11-01', '2026-11-02', '2026-11-08', '2026-11-09'].map((day, i) => ({ id: String(i), day, sold: [], kind: 'pack' }))
    expect(thisWeek(packs, 'pack', '2026-11-04')).toBe(2)
    expect(thisWeek(packs, 'reroll', '2026-11-04')).toBe(0)
  })

  // App Review's 3.1.1: what's sold in the App Store isn't to be had from a code.
  it('keeps coins from codes from buying Plus, packs and re-rolls spending them first', () => {
    const code = (earned: number): Trade => ({ id: 'code:x', day: '2026-11-04', sold: [], kind: 'code', earned })
    const login: Trade = { id: 'login:2026-11-04', day: '2026-11-04', sold: [], kind: 'login', earned: 640, step: 7 }
    expect(plusCoinsOf([], [code(1000), login])).toBe(640)
    expect(plusCoinsOf([], [code(1000), login, { id: 'p', day: '2026-11-04', sold: [], kind: 'pack', spent: 500, bought: [1] }])).toBe(640)
    expect(plusCoinsOf([], [code(300), login, { id: 'p', day: '2026-11-04', sold: [], kind: 'pack', spent: 500, bought: [1] }])).toBe(440)
  })

  it('runs days of Plus on from the last, or from when they were bought', () => {
    const DAY = 86_400_000
    const at = Date.UTC(2026, 10, 4, 10)
    const plus = (id: string, days: number, when: number): Trade => ({ id, day: '2026-11-04', sold: [], kind: 'plus', spent: 1, days, at: when })
    const now = at + 6 * DAY
    expect(plusUntil([], now)).toBe(0)
    expect(plusUntil([plus('a', 1, at)], now)).toBe(at + DAY)
    // A week bought an hour in runs on from the day's end.
    expect(plusUntil([plus('b', 7, at + 3_600_000), plus('a', 1, at)], now)).toBe(at + 8 * DAY)
    // One bought after the last ran out starts afresh.
    expect(plusUntil([plus('a', 1, at), plus('c', 14, at + 5 * DAY)], now)).toBe(at + 19 * DAY)
    // A day bought with the clock set to 2099, and the clock set back: nothing open till then.
    const ahead = Date.UTC(2099, 0, 1)
    expect(plusUntil([plus('d', 1, ahead)], now)).toBe(0)
    expect(plusUntil([plus('a', 1, at), plus('d', 1, ahead)], now)).toBe(at + DAY)
    expect(plusUntil([plus('d', 1, ahead)], ahead + 1)).toBe(ahead + DAY)
  })

  it('takes days of Plus, the day’s coins and a code’s, only as the market gives them', () => {
    const read = asTrades([
      { id: 'plus-a', day: '2026-11-14', sold: [], kind: 'plus', spent: 500, days: 1, at: 1 },
      { id: 'plus-b', day: '2026-11-14', sold: [], kind: 'plus', spent: 500, days: 100000, at: 1 },
      { id: 'plus-c', day: '2026-11-14', sold: [], kind: 'plus', days: 30, at: 1 },
      { id: 'login:2026-11-11', day: '2026-11-11', sold: [], kind: 'login', earned: 80, step: 4 },
      { id: 'login:2026-11-12', day: '2026-11-12', sold: [], kind: 'login', earned: 200, step: 4 },
      { id: 'login:2026-11-13', day: '2026-11-13', sold: [], kind: 'login', earned: 1_000_000, step: 1 },
      { id: 'login:2026-11-14', day: '2026-11-14', sold: [], kind: 'login', earned: 10 },
      { id: 'code:x', day: '2026-11-14', sold: [], kind: 'code', earned: 300 },
    ])
    expect(read.map((trade) => trade.days)).toEqual([1, undefined, undefined, undefined, undefined, undefined, undefined, undefined])
    // A code's coins unsigned by the server are written in by hand (lib/codes has the signed ones).
    expect(read.map((trade) => trade.earned)).toEqual([undefined, undefined, undefined, 80, 200, undefined, undefined, undefined])
  })

  // Kept, a trade on day 'x' threw as the market counted the week, on every device it reached.
  it('passes over a trade on a day that isn’t one, and a time that isn’t one', () => {
    const read = asTrades([
      { id: 'a', day: 'x', sold: [] },
      { id: 'b', day: '2026-99-99', sold: [] },
      { id: 'c', day: '2026-11-04', sold: [], kind: 'plus', spent: 500, days: 1, at: -1e16 },
    ])
    expect(read).toEqual([{ id: 'c', day: '2026-11-04', sold: [], kind: 'plus', spent: 500, days: 1 }])
    expect(() => thisWeek(read, 'pack', '2026-11-04')).not.toThrow()
  })

  describe('the day’s coins for coming back', () => {
    /** Days on from the 1st of November, collected one after another as `loginFor` says, and what each was. */
    function comeBack(days: number[], plus = false) {
      const trades: Trade[] = []
      for (const on of days) {
        const day = new Date(Date.UTC(2026, 10, on)).toISOString().slice(0, 10)
        const { step, coins } = loginFor(trades, day, plus)
        trades.push({ id: `login:${day}`, day, sold: [], kind: 'login', earned: coins, step })
      }
      return trades
    }
    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

    // Collected on a Mac that hadn't yet heard of the six days before: kept as a week's first.
    it('go on from the days collected, not the day of the week each was kept as', () => {
      const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
      const trades: Trade[] = days.map((day, i) => ({ id: `login:${day}`, day, sold: [], kind: 'login', earned: 10 * 2 ** i, step: i + 1 }))
      trades.push({ id: 'login:2026-11-07', day: '2026-11-07', sold: [], kind: 'login', earned: 10, step: 1 })
      expect(loginFor(trades, '2026-11-08', false)).toEqual({ step: 0, coins: 10, rest: 30 })
    })

    it('doubles from 10 for a week running, to 640 on the seventh day, and counts to the coins there are', () => {
      const week = comeBack(range(1, 7))
      expect(week.map((trade) => trade.earned)).toEqual([10, 20, 40, 80, 160, 320, 640])
      expect(pointsOf([], week)).toBe(1270)
    })

    it('starts over at 10 after a day missed', () => {
      expect(comeBack([1, 2, 3, 5, 6]).map((trade) => trade.earned)).toEqual([10, 20, 40, 10, 20])
    })

    it('after a whole week, is 10 a day, with no doubling, for 31 days, and then a new week', () => {
      const trades = comeBack(range(1, 7 + 33))
      expect(trades.slice(7, 7 + 31).every((trade) => trade.earned === 10)).toBe(true)
      expect(trades.slice(7, 7 + 30).every((trade) => trade.step === 0)).toBe(true)
      // The 31st day after the seventh starts the new week, at 10, and the next doubles.
      expect(trades.slice(37).map((trade) => [trade.step, trade.earned])).toEqual([
        [1, 10],
        [2, 20],
        [3, 40],
      ])
      // Days off in between don't shorten the wait.
      expect(loginFor(comeBack([...range(1, 7), 20]), '2026-11-21', false)).toEqual({ step: 0, coins: 10, rest: 17 })
      expect(loginFor(comeBack(range(1, 7)), '2026-11-08', false).rest).toBe(30)
    })

    it('is two and a half times as many with Nib Plus', () => {
      expect(comeBack(range(1, 8), true).map((trade) => trade.earned)).toEqual([25, 50, 100, 200, 400, 800, 1600, 25])
    })
  })
})

describe('the two weeks of Plus a first message of feedback earns', () => {
  const at = Date.UTC(2026, 10, 10, 12)
  const gift = { id: FEEDBACK_GIFT.id, day: '2026-11-10', sold: [], kind: 'plus', days: FEEDBACK_GIFT.days, at }
  const DAY = 86_400_000

  it('are read back as fourteen days from the moment they were given', () => {
    expect(FEEDBACK_GIFT.days).toBe(14)
    expect(plusUntil(asTrades([gift]), at + DAY)).toBe(at + 14 * DAY)
  })

  it('cost no coins', () => {
    expect(pointsOf(received, asTrades([gift]))).toBe(pointsOf(received, []))
  })

  it('are held once however many devices’ logs bring them', () => {
    expect(new Set(asTrades([gift, gift]).map((trade) => trade.id)).size).toBe(1)
  })

  it('open nothing under another id, for another length, or with coins spent', () => {
    for (const forged of [{ ...gift, id: 'someone' }, { ...gift, days: 30 }, { ...gift, spent: 1 }]) {
      expect(plusUntil(asTrades([forged]), at + DAY)).toBe(0)
    }
  })
})

// Security finding 2 of the 8 November audit: hand-written trades gave a million coins and 150 days of Plus.
describe('trades from LEDGER_FROM on', () => {
  const DAY = '2027-02-01'
  const AT = Date.UTC(2027, 1, 1)
  const NOW = AT + 86_400_000
  const empty: Collection = { stamps: [], book: [], late: {}, christmas: [], birthday: [], trades: [] }
  /** Coins as a real log comes by them, a week's first day. */
  const login = (day = DAY, earned = 10): Trade => ({ id: `login:${day}`, day, sold: [], kind: 'login', earned, step: 1 })
  /** A week's coins in one go: 10 doubling to 640, on seven days running. */
  const week = (start = 1) => Array.from({ length: 7 }, (_, i): Trade => {
    const day = `2027-02-${String(start + i).padStart(2, '0')}`
    return { id: `login:${day}`, day, sold: [], kind: 'login', earned: 10 * 2 ** i, step: i + 1 }
  })
  const COINS = 1270
  const plus = (id: string, days: number, price: number, at = AT, day = DAY): Trade => ({ id, day, sold: [], kind: 'plus', spent: price, days, at })
  const pack = (id: string, price: number, bought: number[], day = DAY): Trade => ({ id, day, sold: [], kind: 'pack', spent: price, bought })

  it('is later than the next release can reach anyone', () => {
    expect(LEDGER_FROM > '2026-12-15').toBe(true)
    expect(LEDGER_FROM > CHECKED_FROM).toBe(true)
  })

  it('gives coins only to the kinds with a rule for them', () => {
    const read = asTrades([
      { id: 'x', day: DAY, sold: [], earned: 1_000_000 },
      { id: 'y', day: DAY, sold: [], kind: 'pack', spent: 50, bought: [], earned: 1_000_000 },
      { id: 'z', day: DAY, sold: [], kind: 'plus', spent: 500, days: 1, at: AT, earned: 1_000_000 },
    ])
    expect(read.map((trade) => trade.earned)).toEqual([undefined, undefined, undefined])
    expect(pointsOf([], read)).toBe(0)
  })

  it('gives a day’s coins only under that day’s own id, however many are made up', () => {
    const made = (i: number) => ({ id: `made-up-${i}`, day: DAY, sold: [], kind: 'login', earned: 640, step: 7 })
    expect(pointsOf([], asTrades([made(1), made(2), made(3)]))).toBe(0)
    expect(pointsOf([], asTrades([{ ...login(DAY), id: 'login:2027-02-02' }]))).toBe(0)
    expect(pointsOf([], asTrades([login()]))).toBe(10)
  })

  it('counts an id once, a signed code’s and a day’s coins too, in whatever log holds it twice', () => {
    expect(pointsOf([], [login(), login()])).toBe(10)
  })

  it('leaves a spend out if the coins were never there: nothing opens, nothing comes, and no debt', () => {
    const forged = asTrades([plus('a', 30, 13000), plus('b', 30, 13000), pack('c', 500, [BOOK.length, BOOK.length])])
    expect(plusUntil(counted([], forged), NOW)).toBe(0)
    expect(pointsOf([], forged)).toBe(0)
    expect(copiesOf([], forged).size).toBe(0)
    expect(gotOf([], forged)).toEqual([])
    // Every trade is still in the log: only the reading leaves it out.
    expect(forged).toHaveLength(3)
  })

  it('counts the coins that are there, and leaves out only what’s past them', () => {
    const trades = [...week(), plus('a', 1, 500), plus('b', 1, 500), plus('c', 7, 3000)]
    const until = plusUntil(counted([], trades), NOW)
    expect(until).toBe(AT + 2 * 86_400_000)
    expect(pointsOf([], trades)).toBe(COINS - 1000)
  })

  // A forged pack's stamps, sold, paying for the pack that made them.
  it('doesn’t take a spend’s own stamps as what paid for it', () => {
    const mythic = BOOK.findIndex(({ rarity }) => rarity === 'mythic') + 1
    const circular = [pack('a', 50, [mythic, mythic, mythic]), { id: 's', day: DAY, sold: [mythic, mythic] } as Trade]
    expect(pointsOf([], circular)).toBe(0)
    expect(copiesOf([], circular).size).toBe(0)
  })

  it('takes what a pack’s spares sold for as paying for the next, whichever the log has first', () => {
    const mythic = BOOK.findIndex(({ rarity }) => rarity === 'mythic') + 1
    const coins = [login(DAY, 10), ...Array.from({ length: 4 }, (_, i) => login(`2027-01-${String(10 + i).padStart(2, '0')}`, [20, 40, 80, 50][i]))]
    expect(pointsOf([], coins)).toBe(200)
    const first = pack('z', 150, [mythic, mythic, 7])
    const sold: Trade = { id: 's', day: DAY, sold: [mythic] }
    const second = pack('a', 500, [7])
    expect(pointsOf([], [...coins, first, sold, second])).toBe(200 - 150 + 500 - 500)
    expect(copiesOf([], [...coins, first, sold, second]).get(7)).toBe(2)
  })

  describe('with two devices that hadn’t caught up with each other', () => {
    const shared = week()
    const here: Collection = { ...empty, trades: [...shared, plus('phone', 1, 500, AT), pack('phone-pack', 500, [7])] }
    const there: Collection = { ...empty, trades: [...shared, plus('pad', 1, 500, AT + 1000), plus('pad-more', 1, 500, AT + 2000)] }

    it('loses no coins and no days of Plus, each having spent the same coins', () => {
      const both = merge(here, there).trades
      expect(both).toHaveLength(shared.length + 4)
      expect(counted([], both)).toHaveLength(shared.length + 4)
      expect(pointsOf([], both)).toBe(COINS - 500 - 500 - 500 - 500)
      expect(plusUntil(counted([], both), NOW)).toBe(AT + 3 * 86_400_000)
      expect(copiesOf([], both).get(7)).toBe(1)
    })

    it('reads the same on either device, whichever merged first', () => {
      expect(pointsOf([], merge(there, here).trades)).toBe(pointsOf([], merge(here, there).trades))
    })

    it('counts the spare they both sold once, and what each bought with it', () => {
      const mythic = BOOK.findIndex(({ rarity }) => rarity === 'mythic') + 1
      const received: [string, number][] = [['2027-01-10', mythic], ['2027-01-11', mythic]]
      const a: Collection = { ...empty, book: received, trades: [{ id: 'sale-a', day: DAY, sold: [mythic] }, pack('pack-a', 500, [7])] }
      const b: Collection = { ...empty, book: received, trades: [{ id: 'sale-b', day: DAY, sold: [mythic] }, pack('pack-b', 500, [8])] }
      const both = merge(a, b).trades
      expect(counted(received, both)).toHaveLength(both.length)
      expect(copiesOf(received, both)).toEqual(new Map([[mythic, 1], [7, 1], [8, 1]]))
      expect(pointsOf(received, both)).toBe(500 - 1000)
    })

    it('stands for three, an iPhone, an iPad and a Mac', () => {
      const device = (name: string): Collection => ({ ...empty, trades: [...shared, plus(`${name}-1`, 1, 500), plus(`${name}-2`, 1, 500)] })
      const all = merge(merge(device('phone'), device('pad')), device('mac')).trades
      expect(all.filter(({ kind }) => kind === 'plus')).toHaveLength(6)
      expect(counted([], all)).toHaveLength(all.length)
      expect(pointsOf([], all)).toBe(COINS - 3000)
    })
  })

  it('still gives a first message of feedback its two weeks, with no coins at all, and once', () => {
    const gift: Trade = { id: FEEDBACK_GIFT.id, day: DAY, sold: [], kind: 'plus', days: FEEDBACK_GIFT.days, at: AT }
    const read = asTrades([gift, { ...gift, at: AT + 1 }])
    expect(plusUntil(counted([], read), NOW)).toBe(AT + 14 * 86_400_000)
    expect(pointsOf([], read)).toBe(0)
  })

  // The trap that took 1,768 coins on 6 November: a new check run over a log already written.
  describe('before it, a log already written', () => {
    const OLD = '2026-12-20'
    const OLD_AT = Date.UTC(2026, 11, 20)
    const old = (id: string, days: number, price: number, at = OLD_AT): Trade => plus(id, days, price, at, OLD)
    const log: Trade[] = [
      // None of these meets a check from LEDGER_FROM on, and every one counts.
      { id: 'no-kind', day: OLD, sold: [], earned: 700 },
      { id: 'made-up', day: OLD, sold: [], kind: 'login', earned: 80, step: 4 },
      { id: 'same', day: OLD, sold: [], kind: 'login', earned: 20, step: 2 },
      { id: 'same', day: OLD, sold: [], kind: 'login', earned: 20, step: 2 },
      // More spent than was ever earned, as two devices can.
      old('p1', 30, 13000),
      pack('p2', 500, [7, 7], OLD),
      old('p3', 1, 500),
    ]

    it('loses nothing: not a coin, a stamp or a day', () => {
      const read = asTrades(log)
      expect(read.map((trade) => trade.earned)).toEqual([700, 80, 20, 20, undefined, undefined, undefined])
      expect(counted([], read)).toBe(read)
      expect(pointsOf([], read)).toBe(700 + 80 + 20 + 20 - 13000 - 500 - 500)
      expect(copiesOf([], read).get(7)).toBe(2)
      expect(plusUntil(counted([], read), OLD_AT)).toBe(OLD_AT + 31 * 86_400_000)
    })

    it('loses nothing merged from two devices', () => {
      const left: Collection = { ...empty, trades: [...log, old('left-p', 7, 3000)] }
      const right: Collection = { ...empty, trades: [...log, old('right-p', 7, 3000)] }
      const both = merge(left, right).trades
      // `same` is one trade on every device, as a merge has always made it.
      expect(both.map(({ id }) => id).sort()).toEqual(['left-p', 'made-up', 'no-kind', 'p1', 'p2', 'p3', 'right-p', 'same'])
      expect(counted([], both)).toBe(both)
      expect(pointsOf([], both)).toBe(700 + 80 + 20 - 13000 - 500 - 500 - 3000 - 3000)
      expect(plusUntil(counted([], both), OLD_AT)).toBe(OLD_AT + 45 * 86_400_000)
    })

    it('still counts, and in full, once trades from after it join the log', () => {
      const read = asCollection({ ...empty, trades: [...log, login()] })!.trades
      expect(pointsOf([], read)).toBe(700 + 80 + 20 - 13000 - 500 - 500 + 10)
      expect(copiesOf([], read).get(7)).toBe(2)
    })

    it('pays for spends after it from coins earned before it', () => {
      const trades = [...asTrades([{ id: 'x', day: OLD, sold: [], earned: 500 }]), plus('new', 1, 500)]
      expect(plusUntil(counted([], trades), NOW)).toBe(AT + 86_400_000)
    })
  })
})
