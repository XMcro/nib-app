// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Item } from '../db/db'
import { bookOf, KEEP_DAYS, readFolders, readHours, recordFolders, recordHour, summarize } from './writingStats'

// Local times: the stats keep the writer's own days and hours.
const at = (month: number, day: number, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime()
const DAY = 86_400_000
const doc = (id: string, folder?: string): Item => ({ id, folder: folder ?? null }) as unknown as Item

beforeEach(() => localStorage.clear())

describe('the hours words come in', () => {
  it('go to the hour they were counted in, only past the day’s highest count', () => {
    recordHour(100, at(11, 20, 9, 15))
    recordHour(250, at(11, 20, 9, 40))
    recordHour(240, at(11, 20, 13, 0)) // cut back: nothing taken off
    recordHour(300, at(11, 20, 14, 5))
    const hours = readHours()['2026']
    expect(hours[9]).toBe(250)
    expect(hours[13]).toBe(0)
    expect(hours[14]).toBe(50)
  })

  it('aren’t counted twice when Nib opens again and counts nothing till the library loads', () => {
    recordHour(48, at(11, 20, 8, 10))
    recordHour(0, at(11, 20, 8, 30))
    recordHour(48, at(11, 20, 8, 30))
    expect(readHours()['2026'][8]).toBe(48)
  })

  it('start again from nothing each day', () => {
    recordHour(500, at(11, 20, 22))
    recordHour(80, at(11, 21, 7))
    const hours = readHours()['2026']
    expect(hours[22]).toBe(500)
    expect(hours[7]).toBe(80)
  })

  it('are kept by year', () => {
    recordHour(10, new Date(2026, 11, 31, 23).getTime())
    recordHour(20, new Date(2027, 0, 1, 8).getTime())
    expect(readHours()['2026'][23]).toBe(10)
    expect(readHours()['2027'][8]).toBe(20)
  })

  it('pass over what isn’t theirs in storage', () => {
    localStorage.setItem('nib-goal-hours', JSON.stringify({ day: 3, last: 'x', years: { 2026: [1, 2], 2025: 'no' } }))
    expect(readHours()).toEqual({})
    recordHour(5, at(11, 20, 10))
    expect(readHours()['2026'][10]).toBe(5)
  })
})

describe('the books and folders words go into', () => {
  const novel = doc('a', 'Novel')
  const part = doc('b', 'Novel/Part 1')
  const loose = doc('c')

  it('are a document’s top folder, a subfolder being part of its book', () => {
    expect(bookOf(novel)).toBe('Novel')
    expect(bookOf(part)).toBe('Novel')
    expect(bookOf(loose)).toBe('')
  })

  it('are kept by day, today’s replaced as it grows', () => {
    recordFolders(new Map([['a', 100], ['b', 50], ['c', 7]]), [novel, part, loose], at(11, 20))
    expect(readFolders()).toEqual({ '2026-11-20': { Novel: 150, '': 7 } })
    recordFolders(new Map([['a', 120], ['b', 50], ['c', 7]]), [novel, part, loose], at(11, 20, 15))
    expect(readFolders()['2026-11-20']).toEqual({ Novel: 170, '': 7 })
  })

  it('keep nothing for a day with nothing written, and let go of days past KEEP_DAYS', () => {
    recordFolders(new Map(), [novel], at(11, 20))
    expect(readFolders()).toEqual({})
    recordFolders(new Map([['a', 10]]), [novel], at(1, 1))
    recordFolders(new Map([['a', 20]]), [novel], at(1, 1) + KEEP_DAYS * DAY)
    expect(Object.keys(readFolders())).toEqual([new Date(at(1, 1) + KEEP_DAYS * DAY).toLocaleDateString('sv')])
  })
})

describe('the sums', () => {
  // Friday 20 November 2026; the week from Monday the 16th.
  const now = at(11, 20, 18)

  it('add up the year so far, the week, the month and the best day', () => {
    const calendar = { '2025-12-31': 9000, '2026-10-02': 400, '2026-11-03': 1200, '2026-11-16': 300, '2026-11-17': 500, '2026-11-20': 250 }
    const sums = summarize(calendar, {}, {}, now)
    expect(sums).toMatchObject({ year: '2026', since: '2026-10-02', total: 2650, days: 5, thisWeek: 1050, thisMonth: 2250, best: { day: '2026-11-03', words: 1200 } })
  })

  it('count a week begun in the year before', () => {
    // Saturday 2 January 2027; the week from Monday 28 December.
    const calendar = { '2026-12-27': 50, '2026-12-28': 100, '2026-12-31': 200, '2027-01-02': 300 }
    expect(summarize(calendar, {}, {}, new Date(2027, 0, 2, 12).getTime())).toMatchObject({ year: '2027', total: 300, thisWeek: 600 })
  })

  it('find the longest run of writing days, and the one going on', () => {
    const calendar = { '2026-11-01': 10, '2026-11-02': 10, '2026-11-03': 10, '2026-11-04': 10, '2026-11-10': 10, '2026-11-18': 10, '2026-11-19': 10 }
    expect(summarize(calendar, {}, {}, now)).toMatchObject({ longestRun: 4, currentRun: 2 })
    // Not since yesterday: no run going on.
    expect(summarize({ '2026-11-17': 10 }, {}, {}, now)).toMatchObject({ longestRun: 1, currentRun: 0 })
  })

  it('list this year’s books and folders, most first, and the busiest hour', () => {
    const folders = { '2025-12-30': { Old: 999 }, '2026-11-19': { Novel: 300, '': 40 }, '2026-11-20': { Novel: 100, Journal: 200 } }
    const hours = { '2025': Array<number>(24).fill(50), '2026': Array.from({ length: 24 }, (_, hour) => (hour === 6 ? 900 : hour)) }
    const sums = summarize({}, folders, hours, now)
    expect(sums.books).toEqual([
      { name: 'Novel', words: 400 },
      { name: 'Journal', words: 200 },
      { name: '', words: 40 },
    ])
    expect(sums.busiestHour).toBe(6)
  })

  it('say nothing in particular with nothing written', () => {
    const sums = summarize({}, {}, {}, now)
    expect(sums).toEqual({ year: '2026', total: 0, days: 0, thisWeek: 0, thisMonth: 0, longestRun: 0, currentRun: 0, books: [] })
  })
})
