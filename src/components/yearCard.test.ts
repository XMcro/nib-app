import { describe, expect, it } from 'vitest'
import { cardDue } from '../lib/yearCard'
import { cardTitle } from './yearCard'

describe('the year’s card', () => {
  it('is offered in December', () => {
    expect(cardDue(new Date(2026, 11, 1, 0, 1).getTime())).toBe(true)
    expect(cardDue(new Date(2026, 11, 31, 23, 59).getTime())).toBe(true)
    expect(cardDue(new Date(2026, 10, 30, 23, 59).getTime())).toBe(false)
    expect(cardDue(new Date(2027, 0, 1).getTime())).toBe(false)
  })

  it('is the year in writing once the calendar holds the whole year, and the writing so far till then', () => {
    expect(cardTitle({ '2026-10-02': 400 }, '2026')).toBe('Your writing so far')
    expect(cardTitle({ '2026-11-30': 10, '2027-03-01': 400 }, '2027')).toBe('Your year in writing')
    expect(cardTitle({ '2027-03-01': 400 }, '2027')).toBe('Your writing so far')
  })
})
