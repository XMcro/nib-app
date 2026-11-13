import { describe, expect, it } from 'vitest'
import { KEEPSAKE_DAYS, keepsakeDayOn, keepsakeDaysFound } from './holidays'
import { inkwellStamp, KEEPSAKES, keepsOf, keptOf, rarityOf, yearOf } from './keepsakes'
import { drawnOn, stampFor } from './rewards'
import { MOTIFS } from './stampWords'
import { BOOK } from './stampbook'

describe('the keepsake days', () => {
  it('are World Book Day, leap day and New Year’s Eve, each a stamp of its own in the day’s pack', () => {
    expect(KEEPSAKE_DAYS.map((keepsake) => keepsake.name)).toEqual(['World Book Day', 'Leap day', 'New Year’s Eve'])
    for (const [day, motif] of [
      ['2027-04-23', 'A book with a bookmark'],
      ['2028-02-29', 'A leaping frog'],
      ['2026-12-31', 'A clock at midnight'],
    ]) {
      expect(keepsakeDayOn(day)?.motif).toBe(motif)
      expect(drawnOn(day)).toBe(false)
      expect(stampFor(day).motif).toBe(MOTIFS.indexOf(motif))
      expect(stampFor(day).no).toBeUndefined()
    }
    expect(keepsakeDayOn('2027-04-24')).toBeNull()
    expect(keepsakeDaysFound(['2026-12-31', '2026-11-04', '2027-12-31'])).toEqual(new Map([['New Year’s Eve', ['2026-12-31', '2027-12-31']]]))
  })
})

describe('a year with Nib', () => {
  it('comes a year from the first day stamped', () => {
    expect(yearOf([])).toBeNull()
    expect(yearOf(['2026-11-05', '2026-11-04', '2026-12-01'])).toBe('2027-11-04')
    // From 29 February, on 1 March.
    expect(yearOf(['2028-02-29'])).toBe('2029-03-01')
    // A writer from before the stamps: from the oldest document, if it came first; none counted from before Nib's first day.
    expect(yearOf(['2026-11-04'], '2026-09-12')).toBe('2027-09-12')
    expect(yearOf(['2026-11-04'], '2026-12-01')).toBe('2027-11-04')
    expect(yearOf([], '2026-10-01')).toBe('2027-10-01')
    expect(yearOf(['2026-11-04'], '2019-03-02')).toBe('2027-08-06')
  })
})

describe('a rarity completed', () => {
  const mythic = BOOK.filter((entry) => entry.rarity === 'mythic').map((entry) => entry.no)
  const legendary = BOOK.filter((entry) => entry.rarity === 'legendary').map((entry) => entry.no)
  const found = (nos: number[], from: number) => new Map(nos.map((no, i) => [no, [`2027-01-${String(from + i).padStart(2, '0')}`]]))

  it('is kept on the day the last stamp of a rarity is found, the first rarity done', () => {
    expect(rarityOf(new Map())).toBeNull()
    // One mythic short.
    expect(rarityOf(found(mythic.slice(1), 1))).toBeNull()
    expect(rarityOf(found(mythic, 1))).toEqual({ rarity: 'mythic', day: '2027-01-06' })
    // Legendary done first, on the 10th; mythic after, on the 16th.
    expect(rarityOf(new Map([...found(legendary, 1), ...found(mythic, 11)]))).toEqual({ rarity: 'legendary', day: '2027-01-10' })
  })
})

// Asked 2026-11-13: a stamp of Inkwell's own, for hearing its story.
describe('Inkwell’s keepsake', () => {
  it('is kept on the day Inkwell first told its story, counted with the rest, drawn as Inkwell', () => {
    const keeps = keepsOf({ stamps: [], found: new Map(), firstSteps: null, birthday: null, inkwell: '2026-11-13', written: null, today: '2026-11-13' })
    expect(keeps.inkwell).toBe('2026-11-13')
    expect(keptOf(keeps)).toBe(1)
    expect(keptOf(keepsOf({ stamps: [], found: new Map(), firstSteps: null, birthday: null, written: null, today: '2026-11-13' }))).toBe(0)
    expect(KEEPSAKES).toBe(32)
    const stamp = inkwellStamp('2026-11-13')
    expect(MOTIFS[stamp.motif]).toBe('Inkwell, the nib with a face')
    expect(stamp.rarity).toBe('unique')
  })
})
