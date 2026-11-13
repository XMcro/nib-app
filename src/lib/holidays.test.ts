import { describe, expect, it } from 'vitest'
import { easter, HOLIDAYS, holidayOn, holidaysFound } from './holidays'
import { MOTIFS } from './stampWords'

describe('the holidays', () => {
  it('are the eleven federal holidays and six more, on their days in 2026, in the order of the year', () => {
    expect(HOLIDAYS.map((holiday) => [holiday.name, holiday.date(2026)])).toEqual([
      ['New Year’s Day', '01-01'],
      ['Martin Luther King Jr. Day', '01-19'],
      ['Valentine’s Day', '02-14'],
      ['Presidents’ Day', '02-16'],
      ['St Patrick’s Day', '03-17'],
      ['Easter', '04-05'],
      ['Mother’s Day', '05-10'],
      ['Memorial Day', '05-25'],
      ['Juneteenth', '06-19'],
      ['Father’s Day', '06-21'],
      ['Independence Day', '07-04'],
      ['Labor Day', '09-07'],
      ['Indigenous Peoples’ Day and Columbus Day', '10-12'],
      ['Halloween', '10-31'],
      ['Veterans Day', '11-11'],
      ['Thanksgiving', '11-26'],
      ['Christmas Day', '12-25'],
    ])
  })

  it('move with the weekdays from year to year', () => {
    const on = (name: string, year: number) => HOLIDAYS.find((holiday) => holiday.name === name)!.date(year)
    expect(on('Martin Luther King Jr. Day', 2027)).toBe('01-18')
    expect(on('Memorial Day', 2027)).toBe('05-31')
    expect(on('Memorial Day', 2028)).toBe('05-29')
    expect(on('Thanksgiving', 2027)).toBe('11-25')
    expect(on('Labor Day', 2030)).toBe('09-02')
    expect(on('Mother’s Day', 2027)).toBe('05-09')
  })

  it('keep Easter as Western churches do', () => {
    expect([2024, 2025, 2026, 2027, 2038, 2285].map(easter)).toEqual(['03-31', '04-20', '04-05', '03-28', '04-25', '03-22'])
  })

  it('each have a drawing, a story and a prompt of their own', () => {
    for (const holiday of HOLIDAYS) expect(MOTIFS, holiday.name).toContain(holiday.motif)
    for (const key of ['motif', 'story', 'prompt'] as const) expect(new Set(HOLIDAYS.map((holiday) => holiday[key])).size).toBe(17)
  })
})

describe('holidayOn', () => {
  it('finds the holiday a day is, any year, and none on other days', () => {
    expect(holidayOn('2026-10-31')?.name).toBe('Halloween')
    expect(holidayOn('2031-04-13')?.name).toBe('Easter')
    expect(holidayOn('2026-11-04')).toBeNull()
    expect(holidayOn('2026-04-06')).toBeNull()
  })

  it('gives Juneteenth the day when Father’s Day falls on it too', () => {
    expect(holidayOn('2033-06-19')?.name).toBe('Juneteenth')
    expect(HOLIDAYS.find((holiday) => holiday.name === 'Father’s Day')!.date(2033)).toBe('06-19')
  })
})

describe('holidaysFound', () => {
  it('gives each holiday written on its days, oldest first, and passes over the rest', () => {
    const found = holidaysFound(['2027-10-31', '2026-11-04', '2026-10-31', '2026-12-25'])
    expect([...found]).toEqual([
      ['Halloween', ['2026-10-31', '2027-10-31']],
      ['Christmas Day', ['2026-12-25']],
    ])
  })
})
