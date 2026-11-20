import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asCollection, keepStamps, merge, STAMPS_CHANGED, type Collection } from './collection'

const a: Collection = {
  stamps: ['2026-11-04', '2026-11-01'],
  book: [
    ['2026-11-04', 170],
    ['2026-11-04', 3],
    ['2026-11-01', 9],
  ],
  late: { '2026-12-02': '2026-12-04' },
  christmas: [2026],
  birthday: [],
  trades: [{ id: 'a', day: '2026-11-04', sold: [3] }],
}
const b: Collection = {
  stamps: ['2026-11-02', '2026-11-04'],
  book: [
    ['2026-11-04', 3],
    ['2026-11-02', 22],
  ],
  late: { '2026-12-02': '2026-12-05', '2026-12-03': '2026-12-05' },
  christmas: [],
  birthday: [2027, 2026],
  trades: [
    { id: 'b', day: '2026-11-03', sold: [22] },
    { id: 'a', day: '2026-11-04', sold: [3] },
  ],
}

const empty: Collection = { stamps: [], book: [], late: {}, christmas: [], birthday: [], trades: [] }

describe('merge', () => {
  it('keeps all that either has, once, in one order, whichever way round', () => {
    const both = merge(a, b)
    expect(both).toEqual({
      stamps: ['2026-11-01', '2026-11-02', '2026-11-04'],
      book: [
        ['2026-11-01', 9],
        ['2026-11-02', 22],
        ['2026-11-04', 3],
        ['2026-11-04', 170],
      ],
      // A door opened late on both keeps the earlier day, whichever way round.
      late: { '2026-12-02': '2026-12-04', '2026-12-03': '2026-12-05' },
      christmas: [2026],
      birthday: [2026, 2027],
      // Every trade either made, once.
      trades: [
        { id: 'b', day: '2026-11-03', sold: [22] },
        { id: 'a', day: '2026-11-04', sold: [3] },
      ],
    })
    expect(JSON.stringify(merge(merge(a, b), a))).toBe(JSON.stringify(both))
    expect(merge(b, a).book).toEqual(both.book)
    expect(merge(b, a).late).toEqual(both.late)
  })

  // Merged with a copy from Nib 1.10.09 (32) to (35), which didn't know stamps past 200 or a pack's buy, the stripped one won.
  it('keeps the copy of a trade that holds more, and fields this Nib doesn’t know', () => {
    const full = { id: 'p', day: '2026-11-04', sold: [], kind: 'pack' as const, spent: 50, bought: [250], later: { kept: true } }
    const stripped = { id: 'p', day: '2026-11-04', sold: [] }
    for (const [x, y] of [
      [full, stripped],
      [stripped, full],
    ]) {
      expect(merge({ ...empty, trades: [x] }, { ...empty, trades: [y] }).trades).toEqual([full])
    }
  })

  it('keeps one of a day’s coins collected on two devices, the more, whichever way round', () => {
    const here = { ...empty, trades: [{ id: 'login:2026-11-04', day: '2026-11-04', sold: [], kind: 'login' as const, earned: 20, step: 2 }] }
    const there = { ...empty, trades: [{ id: 'login:2026-11-04', day: '2026-11-04', sold: [], kind: 'login' as const, earned: 10, step: 1 }] }
    expect(merge(here, there).trades).toEqual(here.trades)
    expect(merge(there, here).trades).toEqual(here.trades)
    // As a Nib that doesn't know the day's coins keeps them: the whole one wins.
    const bare = { ...empty, trades: [{ id: 'login:2026-11-04', day: '2026-11-04', sold: [] }] }
    expect(merge(bare, there).trades).toEqual(there.trades)
  })

  it('passes over what isn’t stamps', () => {
    expect(asCollection(null)).toBeNull()
    expect(asCollection([])).toBeNull()
    expect(
      asCollection({
        stamps: [3, '2026-11-04'],
        book: [['2026-11-04', 999], ['2026-11-04', 2], 'x'],
        late: { d: 1 },
        christmas: ['2026'],
        birthday: 'no',
        trades: [{ id: '', day: 'x', sold: [] }, { id: 'c', day: '2026-11-04', sold: [2, 999] }, 'y'],
      }),
    ).toEqual({
      stamps: ['2026-11-04'],
      book: [['2026-11-04', 2]],
      late: {},
      christmas: [],
      birthday: [],
      trades: [{ id: 'c', day: '2026-11-04', sold: [2] }],
    })
  })
})

// Said within the tap, iCloud's merge and a whole look by sync ran before the coins could spring or the pack tear.
describe('saying this device’s stamps have changed, for iCloud and sync to send them', () => {
  let page: EventTarget & { visibilityState: string }
  let said: number
  const putAway = () => {
    page.visibilityState = 'hidden'
    page.dispatchEvent(new Event('visibilitychange'))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) })
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    vi.stubGlobal('document', page)
    const win = new EventTarget()
    vi.stubGlobal('window', win)
    said = 0
    win.addEventListener(STAMPS_CHANGED, () => said++)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('is a few seconds after the change, not within the tap that made it', () => {
    keepStamps({ stamps: ['2026-11-17'] })
    expect(localStorage.getItem('nib-stamps')).toBe('["2026-11-17"]')
    expect(said).toBe(0)
    vi.advanceTimersByTime(3999)
    expect(said).toBe(0)
    vi.advanceTimersByTime(1)
    expect(said).toBe(1)
  })

  it('is once for changes that follow one another: the day’s coins, then its pack', () => {
    keepStamps({ trades: [] })
    vi.advanceTimersByTime(3000)
    keepStamps({ stamps: ['2026-11-17'] })
    keepStamps({ book: [['2026-11-17', 9]] })
    vi.advanceTimersByTime(3999)
    expect(said).toBe(0)
    vi.advanceTimersByTime(1)
    expect(said).toBe(1)
    vi.advanceTimersByTime(60_000)
    expect(said).toBe(1)
  })

  it('is at once as Nib is put away, while they can still be sent, and not again after', () => {
    keepStamps({ stamps: ['2026-11-17'] })
    putAway()
    expect(said).toBe(1)
    vi.advanceTimersByTime(60_000)
    expect(said).toBe(1)
  })

  it('says nothing as Nib is put away with nothing changed', () => {
    keepStamps({ stamps: ['2026-11-17'] })
    vi.advanceTimersByTime(4000)
    putAway()
    expect(said).toBe(1)
  })
})
