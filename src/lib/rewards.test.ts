// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { readBook, readStamps } from './collection'
import { calendarDoors, catchUp, christmasWaiting, decemberLookBack, doorOf, drawnOn, stampFor, WINTER_INKS } from './rewards'
import { CHRISTMAS, EVERYDAY, MOTIFS, PROMPTS, WINTER_PROMPTS } from './stampWords'
import { HOLIDAYS } from './holidays'
import { BOOK, packFor, STAMP_INKS } from './stampbook'

const after = (day: string, days: number) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10)
}

describe('stampFor', () => {
  it('gives a day the same stamp every time', () => {
    expect(stampFor('2026-11-04')).toEqual(stampFor('2026-11-04'))
  })

  it('is the rarest stamp in the day’s pack, as the stampbook has it', () => {
    const received: [string, number][] = [
      ['2026-11-03', 192],
      ['2026-11-04', 3],
      ['2026-11-04', 130],
      ['2026-11-04', 9],
    ]
    const stamp = stampFor('2026-11-04', received)
    const entry = BOOK[129]
    expect(stamp).toMatchObject({ day: '2026-11-04', no: 130, motif: MOTIFS.indexOf(entry.motif), ink: entry.ink, ground: entry.ground, rarity: 'rare' })
  })

  it('shows the day’s pack’s stamp, when no pack was opened that day', () => {
    expect(stampFor('2026-11-04').no).toBe(packFor('2026-11-04')[0])
    expect(stampFor('2026-11-04', [['2026-11-05', 3]]).no).toBe(packFor('2026-11-04')[0])
  })

  it('is a holiday’s own on its day, with its prompt, and nothing drawn', () => {
    const halloween = HOLIDAYS.find((holiday) => holiday.name === 'Halloween')!
    expect(drawnOn('2026-10-31')).toBe(false)
    expect(stampFor('2026-10-31', [['2026-10-31', 7]])).toEqual({
      day: '2026-10-31',
      motif: MOTIFS.indexOf(halloween.motif),
      ink: halloween.ink,
      prompt: halloween.prompt,
      rarity: 'unique',
      ground: halloween.ground,
    })
  })

  it('gives days side by side a different prompt', () => {
    expect(stampFor('2026-11-05').prompt).not.toBe(stampFor('2026-11-04').prompt)
  })

  it('goes through every prompt before any comes round again', () => {
    const prompts = new Set(Array.from({ length: PROMPTS.length }, (_, i) => stampFor(after('2027-01-05', i)).prompt))
    expect(prompts.size).toBe(PROMPTS.length)
  })
})

describe('the Christmas calendar’s doors', () => {
  it('are 1 to 24 December, every year', () => {
    expect(['2026-11-30', '2026-12-01', '2026-12-24', '2026-12-25', '2027-12-03'].map(doorOf)).toEqual([null, 1, 24, null, 3])
  })

  it('each have a winter stamp of their own, and a winter prompt', () => {
    const doors = Array.from({ length: 24 }, (_, i) => stampFor(`2026-12-${String(i + 1).padStart(2, '0')}`))
    expect(new Set(doors.map((door) => door.motif)).size).toBe(24)
    expect(doors.every((door) => door.motif >= EVERYDAY && door.motif < MOTIFS.length)).toBe(true)
    expect(doors.map((door) => door.prompt)).toEqual(WINTER_PROMPTS)
    expect(doors.every((door) => WINTER_INKS.includes(door.ink))).toBe(true)
    expect(doors.slice(0, 7).map((door) => door.ground)).toEqual(['dots', 'lines', 'waves', 'checks', 'hatch', 'stars', 'dots'])
    // The same door, the same stamp, whatever the year.
    expect(stampFor('2027-12-04')).toMatchObject({ motif: doors[3].motif, ink: doors[3].ink, prompt: doors[3].prompt })
  })

  it('give way to the stampbook’s packs either side of them, and Christmas Day’s', () => {
    for (const day of ['2026-11-30', '2026-12-26', '2026-12-30']) {
      expect(drawnOn(day)).toBe(true)
      expect(stampFor(day).no).toBeGreaterThan(0)
    }
    for (const day of ['2026-12-01', '2026-12-24', '2026-12-25']) {
      expect(drawnOn(day)).toBe(false)
      expect(stampFor(day).no).toBeUndefined()
    }
  })
})

describe('catchUp', () => {
  it('opens the latest door missed before today, in December', () => {
    expect(catchUp(['2026-12-01', '2026-12-02'], '2026-12-05')).toBe('2026-12-04')
    expect(catchUp(['2026-12-01', '2026-12-04'], '2026-12-05')).toBe('2026-12-03')
  })

  it('opens none when none was missed, on the first, or outside December', () => {
    expect(catchUp(['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'], '2026-12-05')).toBeNull()
    expect(catchUp([], '2026-12-01')).toBeNull()
    expect(catchUp([], '2026-11-30')).toBeNull()
    expect(catchUp([], '2027-01-02')).toBeNull()
  })

  it('reaches back only as far as the 24th from after it, and only into this December', () => {
    const doors = Array.from({ length: 23 }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`)
    expect(catchUp(doors, '2026-12-28')).toBe('2026-12-24')
    expect(catchUp([...doors, '2026-12-24'], '2026-12-28')).toBeNull()
    expect(catchUp([...doors, '2026-12-24'], '2027-12-03')).toBe('2027-12-02')
  })
})

describe('readBook', () => {
  beforeEach(() => localStorage.clear())

  it('keeps only days with one of the 300', () => {
    expect(readBook()).toEqual([])
    localStorage.setItem('nib-book', '{"a":1}')
    expect(readBook()).toEqual([])
    localStorage.setItem('nib-book', JSON.stringify([['2026-11-04', 7], ['2026-11-05', 0], ['2026-11-06', 301], ['2026-11-07', 2.5], [3, 3], 'x', ['2026-11-08', 300]]))
    expect(readBook()).toEqual([
      ['2026-11-04', 7],
      ['2026-11-08', 300],
    ])
  })
})

describe('readStamps', () => {
  beforeEach(() => localStorage.clear())

  it('is empty before any stamp, and after storage that isn’t a list of days', () => {
    expect(readStamps()).toEqual([])
    localStorage.setItem('nib-stamps', '{"2026-11-04":true}')
    expect(readStamps()).toEqual([])
    localStorage.setItem('nib-stamps', 'not json')
    expect(readStamps()).toEqual([])
    localStorage.setItem('nib-stamps', '["2026-11-04", 3]')
    expect(readStamps()).toEqual(['2026-11-04'])
  })
})

describe('calendarDoors', () => {
  it('stands each of the 24 doors as open, today’s, missed or still ahead', () => {
    const doors = calendarDoors(['2026-12-01', '2026-12-02', '2026-12-04', '2026-11-30'], '2026-12-05')
    expect(doors).toHaveLength(24)
    expect(doors.slice(0, 6).map((door) => door.state)).toEqual(['open', 'open', 'missed', 'open', 'today', 'ahead'])
    expect(doors.at(-1)).toEqual({ door: 24, day: '2026-12-24', state: 'ahead' })
  })

  it('has today’s open once written on, and none to come after the 24th', () => {
    expect(calendarDoors(['2026-12-05'], '2026-12-05')[4].state).toBe('open')
    const after = calendarDoors(['2026-12-24'], '2026-12-28')
    expect(new Set(after.map((door) => door.state))).toEqual(new Set(['missed', 'open']))
  })

  it('is this December’s, not last year’s', () => {
    expect(calendarDoors(['2025-12-03'], '2026-12-05')[2].state).toBe('missed')
    expect(calendarDoors([], '2027-12-01')[0].day).toBe('2027-12-01')
  })
})

describe('Christmas Day', () => {
  it('has the gold stamp, every year', () => {
    expect(stampFor('2026-12-25')).toMatchObject({ motif: CHRISTMAS, ink: STAMP_INKS.gold })
    expect(stampFor('2031-12-25')).toMatchObject({ motif: CHRISTMAS, ink: STAMP_INKS.gold })
    expect(stampFor('2026-12-26').motif).not.toBe(CHRISTMAS)
  })

  it('has a present waiting from the 25th to the 31st, for a December with a door opened, until it’s opened', () => {
    const doors = ['2026-12-03']
    expect(['2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01'].map((today) => christmasWaiting(doors, [], today))).toEqual([false, true, true, false])
    expect(christmasWaiting(doors, [2026], '2026-12-26')).toBe(false)
    expect(christmasWaiting(doors, [2025], '2026-12-26')).toBe(true)
  })

  it('has none for a December without a door opened: not last year’s, not November’s, not the 25th’s own', () => {
    expect(christmasWaiting(['2025-12-03', '2026-11-30', '2026-12-25'], [], '2026-12-26')).toBe(false)
  })

  it('looks back at December so far: days and words written, doors opened', () => {
    const calendar = { '2026-11-30': 999, '2026-12-01': 100, '2026-12-03': 250, '2026-12-04': 0, '2026-12-27': 50, '2025-12-05': 70 }
    const stamps = ['2025-12-02', '2026-12-01', '2026-12-03', '2026-12-09', '2026-12-25']
    expect(decemberLookBack(calendar, stamps, '2026-12-26')).toEqual({ days: 2, words: 350, doors: 3 })
  })
})
