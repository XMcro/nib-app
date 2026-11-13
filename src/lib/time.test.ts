import { describe, expect, it } from 'vitest'
import { isDay, isTime, momentOf, relativeTime } from './time'

// Fixed reference point: a Wednesday, mid-afternoon.
const NOW = new Date('2026-08-05T15:00:00').getTime()
const ago = (ms: number) => NOW - ms
const MINUTE = 60_000
const HOUR = 3_600_000

describe('relativeTime', () => {
  it('calls anything under 45 seconds "now"', () => {
    expect(relativeTime(NOW, NOW)).toBe('now')
    expect(relativeTime(ago(44_000), NOW)).toBe('now')
  })

  // Past "now" is at least a minute: 45 to 59 seconds read as "0m ago".
  it('counts minutes below an hour', () => {
    expect(relativeTime(ago(46_000), NOW)).toBe('1m ago')
    expect(relativeTime(ago(MINUTE + 59_000), NOW)).toBe('1m ago')
    expect(relativeTime(ago(12 * MINUTE), NOW)).toBe('12m ago')
    expect(relativeTime(ago(59 * MINUTE), NOW)).toBe('59m ago')
  })

  it('counts hours within the same calendar day', () => {
    expect(relativeTime(ago(2 * HOUR), NOW)).toBe('2h ago')
    expect(relativeTime(ago(14 * HOUR), NOW)).toBe('14h ago')
  })

  it('says yesterday across a single day boundary', () => {
    expect(relativeTime(new Date('2026-08-04T23:30:00').getTime(), NOW)).toBe('yesterday')
    expect(relativeTime(new Date('2026-08-04T00:05:00').getTime(), NOW)).toBe('yesterday')
  })

  it('prefers minutes over "yesterday" just after midnight', () => {
    const justAfterMidnight = new Date('2026-08-05T00:10:00').getTime()
    const lateYesterday = new Date('2026-08-04T23:55:00').getTime()
    expect(relativeTime(lateYesterday, justAfterMidnight)).toBe('15m ago')
  })

  it('names the weekday within the last week', () => {
    expect(relativeTime(new Date('2026-08-02T10:00:00').getTime(), NOW)).toBe('Sunday')
    expect(relativeTime(new Date('2026-07-31T10:00:00').getTime(), NOW)).toBe('Friday')
  })

  it('says "last week" between 7 and 14 days', () => {
    expect(relativeTime(new Date('2026-07-28T10:00:00').getTime(), NOW)).toBe('last week')
    expect(relativeTime(new Date('2026-07-23T10:00:00').getTime(), NOW)).toBe('last week')
  })

  it('names the month beyond two weeks in the same year', () => {
    expect(relativeTime(new Date('2026-03-14T10:00:00').getTime(), NOW)).toBe('March')
  })

  it('adds the year once it is a different one', () => {
    expect(relativeTime(new Date('2025-03-14T10:00:00').getTime(), NOW)).toBe('Mar 2025')
  })
})

describe('momentOf', () => {
  const at = (when: string) => new Date(when).getTime()
  it('gives the time with the day it was', () => {
    expect(momentOf(at('2026-08-05T09:03:00'), NOW)).toBe('Today, 9:03 AM')
    expect(momentOf(at('2026-08-04T16:12:00'), NOW)).toBe('Yesterday, 4:12 PM')
    expect(momentOf(at('2026-08-02T16:12:00'), NOW)).toBe('Sun, Aug 2, 4:12 PM')
    expect(momentOf(at('2026-07-20T16:12:00'), NOW)).toBe('Jul 20, 4:12 PM')
    expect(momentOf(at('2025-11-02T16:12:00'), NOW)).toBe('Nov 2, 2025, 4:12 PM')
  })
})

// A time from sync, a backup or an import that a Date can't hold threw on
// every launch, wherever it was shown.
describe('a time or a day from outside', () => {
  it('is taken only as Nib could have made it', () => {
    expect([0, NOW, 8.64e15].every(isTime)).toBe(true)
    expect([-1, -1e16, 8.64e15 + 1, NaN, Infinity, '1'].some(isTime)).toBe(false)
    expect(['2026-11-05', '2024-02-29', '2026-12-31'].every(isDay)).toBe(true)
    expect(['x', '2026-11-5', '2026-13-01', '2026-00-10', '2026-11-32', '20261105', 20261105].some(isDay)).toBe(false)
  })

  it('stored before times were checked, is shown blank, not thrown on', () => {
    expect(relativeTime(-1e16, NOW)).toBe('')
    expect(() => momentOf(-1e16, NOW)).not.toThrow()
  })
})
