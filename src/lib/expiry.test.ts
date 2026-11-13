import { describe, expect, it } from 'vitest'
import type { Item } from '../db/db'
import { asExpiry, describeExpiry, dueOn, expiredNotice, expiryChoices, firstExpiry } from './expiry'

const noon = (day: string) => new Date(`${day}T12:00:00`).getTime()

describe('an expiry date arriving from outside', () => {
  it('is a real day, or null for taken off, and anything else says nothing', () => {
    expect(asExpiry('2026-11-17')).toBe('2026-11-17')
    expect(asExpiry(null)).toBeNull()
    for (const odd of [undefined, '', 'soon', '2026-02-30', '2026-13-01', '17/11/2026', '2026-11-17T09:00', 1794000000000, true, {}, ['2026-11-17']]) {
      expect(asExpiry(odd), String(odd)).toBeUndefined()
    }
  })
})

describe('the quick choices', () => {
  it('are a week, a month and a year on, by the calendar', () => {
    expect(expiryChoices(noon('2026-11-10'))).toEqual([
      { label: 'In a week', day: '2026-11-17' },
      { label: 'In a month', day: '2026-12-10' },
      { label: 'In a year', day: '2027-11-10' },
    ])
  })

  it('stop at a month’s last day, where the next has no such date', () => {
    expect(expiryChoices(noon('2027-01-31')).map((choice) => choice.day)).toEqual(['2027-02-07', '2027-02-28', '2028-01-31'])
    expect(expiryChoices(noon('2028-02-29')).map((choice) => choice.day)).toEqual(['2028-03-07', '2028-03-29', '2029-02-28'])
  })

  it('and the first day that can be picked is tomorrow', () => {
    expect(firstExpiry(noon('2026-12-31'))).toBe('2027-01-01')
  })
})

describe('an expiry date, in words', () => {
  const now = noon('2026-11-10')
  const short = (day: string, year?: 'numeric') => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year })

  it('is today for today or a day gone by, tomorrow, or the date, with its year only when that isn’t this one', () => {
    expect(describeExpiry('2026-11-10', now)).toBe('today')
    expect(describeExpiry('2026-11-02', now)).toBe('today')
    expect(describeExpiry('2026-11-11', now)).toBe('tomorrow')
    expect(describeExpiry('2026-11-17', now)).toBe(short('2026-11-17'))
    expect(describeExpiry('2027-11-10', now)).toBe(short('2027-11-10', 'numeric'))
  })
})

const item = (id: string, fields: Partial<Item> = {}): Item => ({ id, kind: 'note', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Note ${id}` }] }] }, version: 1, createdAt: 1, updatedAt: 1, ...fields })

describe('what is due', () => {
  it('is what has a date of today or a day gone by, and nothing else', () => {
    const all = [item('a', { expires: '2026-11-10' }), item('b', { expires: '2026-11-09' }), item('c', { expires: '2026-11-11' }), item('d', { expires: null }), item('e')]
    expect(dueOn(all, '2026-11-10').map((one) => one.id)).toEqual(['a', 'b'])
    expect(dueOn(all, '2026-11-08')).toEqual([])
  })
})

describe('what is said when notes expire', () => {
  it('names the one, shortly, and never a locked one', () => {
    expect(expiredNotice([item('a')])).toBe('“Note a” expired and is in the trash.')
    const long = item('b', { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A very long first line that goes on and on past any sensible title' }] }] } })
    expect(expiredNotice([long])).toBe('“A very long first line that goes on and on…” expired and is in the trash.')
    expect(expiredNotice([item('c', { vault: { salt: 's', sealed: 'x' } })])).toBe('A locked note expired and is in the trash.')
    expect(expiredNotice([item('d', { kind: 'page', vault: { salt: 's', sealed: 'x' } })])).toBe('A locked page expired and is in the trash.')
  })

  it('counts several, by what they are', () => {
    expect(expiredNotice([item('a'), item('b')])).toBe('2 notes expired and are in the trash.')
    expect(expiredNotice([item('a', { kind: 'page' }), item('b', { kind: 'page' }), item('c', { kind: 'page' })])).toBe('3 pages expired and are in the trash.')
    expect(expiredNotice([item('a'), item('b', { kind: 'page' })])).toBe('2 notes and pages expired and are in the trash.')
  })
})

