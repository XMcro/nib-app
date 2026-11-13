import { describe, expect, it, vi } from 'vitest'

/**
 * A reminder that repeats, through a change of the clocks. Its own file: the
 * zone is set for it, as the tests may run in one whose clocks never change
 * (they were written in one), where this would pass whatever was done.
 */
vi.hoisted(() => void (process.env.TZ = 'Europe/London'))
vi.mock('@capacitor/core', async (importOriginal) => ({ ...(await importOriginal<typeof import('@capacitor/core')>()), registerPlugin: () => ({}) }))

const { nextAt } = await import('./reminders')

const on = (year: number, month: number, day: number, hour = 9) => new Date(year, month - 1, day, hour, 0).getTime()

describe('a reminder that repeats, where the clocks change', () => {
  it('is in a zone whose clocks do', () => {
    expect(new Date(2026, 6, 1).getTimezoneOffset()).not.toBe(new Date(2026, 0, 1).getTimezoneOffset())
  })

  it('keeps its hour by the day and by the week, through the hour put back in October and the one taken in March', () => {
    for (const [start, repeat] of [[on(2026, 10, 20), 'day'], [on(2027, 3, 20), 'day'], [on(2026, 10, 6), 'week'], [on(2027, 3, 9), 'week']] as const) {
      let at = start
      for (let turn = 0; turn < 12; turn++) {
        at = nextAt({ at: start, repeat }, at)!
        expect(new Date(at).getHours(), new Date(at).toString()).toBe(9)
      }
    }
  })

  it('comes next on the right day for one begun long ago, either side of a change', () => {
    expect(nextAt({ at: on(2026, 7, 1), repeat: 'day' }, on(2026, 12, 24, 10))).toBe(on(2026, 12, 25))
    expect(nextAt({ at: on(2026, 12, 1), repeat: 'day' }, on(2027, 6, 24, 8))).toBe(on(2027, 6, 24))
    expect(nextAt({ at: on(2026, 12, 1), repeat: 'week' }, on(2027, 6, 24, 8))).toBe(on(2027, 6, 29))
  })
})
