import { describe, expect, it } from 'vitest'
import { MOTIFS } from './stampWords'
import { BOOK, drawStamp, foundIn, LUCKY, packFor } from './stampbook'

const after = (day: string, days: number) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10)
}
const numbers = (rarity: string) => BOOK.filter((entry) => entry.rarity === rarity).map((entry) => entry.no)

describe('the stampbook', () => {
  it('has 300 stamps, numbered in order: 187 common, 60 rare, 37 unique, 10 legendary and 6 mythic', () => {
    expect(BOOK.map((entry) => entry.no)).toEqual(Array.from({ length: 300 }, (_, i) => i + 1))
    expect(['common', 'rare', 'unique', 'legendary', 'mythic'].map((rarity) => numbers(rarity).length)).toEqual([187, 60, 37, 10, 6])
    // The first 200 keep their numbers; the hundred after them go on the end, by rarity.
    expect(numbers('rare')[0]).toBe(126)
    expect(numbers('mythic')).toEqual([197, 198, 199, 200, 299, 300])
    expect(['common', 'rare', 'unique', 'legendary', 'mythic'].map((rarity) => numbers(rarity).filter((no) => no > 200)[0])).toEqual([201, 263, 283, 295, 299])
  })

  it('gives each its own name, story and look, drawn from 78 drawings', () => {
    expect(new Set(BOOK.map((entry) => entry.name)).size).toBe(300)
    expect(new Set(BOOK.map((entry) => entry.story)).size).toBe(300)
    expect(new Set(BOOK.map((entry) => `${entry.motif}:${entry.ink}:${entry.ground}:${entry.rarity}`)).size).toBe(300)
    for (const entry of BOOK) expect(MOTIFS, entry.name).toContain(entry.motif)
    expect(new Set(BOOK.map((entry) => entry.motif)).size).toBe(78)
    // Common is plain; the rest are printed on a pattern.
    expect(BOOK.every((entry) => (entry.rarity === 'common') === (entry.ground === 'plain'))).toBe(true)
  })

  it('keeps a drawing of its own for each legendary and mythic stamp', () => {
    const top = BOOK.filter((entry) => entry.rarity === 'legendary' || entry.rarity === 'mythic')
    expect(top.map((entry) => entry.no)).toEqual([191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 295, 296, 297, 298, 299, 300])
    for (const entry of top) expect(BOOK.filter((other) => other.motif === entry.motif)).toEqual([entry])
  })
})

describe('packFor', () => {
  const rarity = (no: number) => BOOK[no - 1].rarity
  const days = (n: number) => Array.from({ length: n }, (_, i) => after('2026-01-01', i))

  it('gives a day the same pack: one stamp', () => {
    expect(packFor('2026-11-04')).toEqual(packFor('2026-11-04'))
    for (const day of days(400)) expect(packFor(day)).toHaveLength(1)
  })

  it('draws each stamp as rarely as the odds say: mythic 0.5%, legendary 1.5%, unique 5%, rare 23%, otherwise common, with nothing to tip them', () => {
    expect(LUCKY).toEqual({ mythic: 0.5, legendary: 1.5, unique: 5, rare: 23, common: 70 })
    const tally = (nos: number[]) => {
      const counts: Record<string, number> = { common: 0, rare: 0, unique: 0, legendary: 0, mythic: 0 }
      for (const no of nos) counts[rarity(no)]++
      // Within four standard deviations of the odds: off by chance less than once in 15,000 runs.
      for (const [name, odds] of Object.entries(LUCKY)) {
        const p = odds / 100
        expect(Math.abs(counts[name] / nos.length - p), name).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / nos.length))
      }
    }
    // The day's packs, and the market's, drawn by ids of their own.
    tally(days(20000).map((day) => packFor(day)[0]))
    tally(Array.from({ length: 20000 }, (_, i) => drawStamp(`pack-${Math.floor(i / 10)}:${i % 10}`)))
  })

  it('draws any stamp of its rarity, so repeats come as in real packs, and in time every one', () => {
    const month = days(60).flatMap((day) => packFor(day))
    expect(new Set(month).size).toBeLessThan(month.length)
    const seen = new Set(days(5000).flatMap((day) => packFor(day)))
    for (const kind of ['common', 'rare', 'unique'] as const) expect(BOOK.filter((entry) => entry.rarity === kind).every((entry) => seen.has(entry.no)), kind).toBe(true)
  })
})

describe('foundIn', () => {
  it('gives each stamp found the days it came, oldest first', () => {
    const found = foundIn([
      ['2026-11-05', 7],
      ['2026-11-04', 130],
      ['2026-11-01', 7],
    ])
    expect([...found]).toEqual([
      [7, ['2026-11-01', '2026-11-05']],
      [130, ['2026-11-04']],
    ])
  })
})
