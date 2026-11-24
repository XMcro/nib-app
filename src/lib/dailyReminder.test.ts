// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DAILY, DAILY_TITLE, DAYS_AHEAD, dailyTimes, slots } from './dailyReminder'

const at = (date: string, time: string) => new Date(`${date}T${time}`).getTime()

describe('dailyTimes', () => {
  it('rings each day for a fortnight at the time chosen, from today while it’s still to come', () => {
    const times = dailyTimes('19:00', at('2026-11-04', '10:00'), false)
    expect(times).toHaveLength(DAYS_AHEAD)
    expect(times[0]).toEqual({ id: `${DAILY}2026-11-04`, at: at('2026-11-04', '19:00') })
    expect(times.at(-1)!.id).toBe(`${DAILY}2026-11-17`)
  })

  it('starts tomorrow once today is written on, or its time has gone by', () => {
    expect(dailyTimes('19:00', at('2026-11-04', '10:00'), true)[0].id).toBe(`${DAILY}2026-11-05`)
    expect(dailyTimes('08:30', at('2026-11-04', '10:00'), false)[0]).toEqual({ id: `${DAILY}2026-11-05`, at: at('2026-11-05', '08:30') })
    expect(dailyTimes('08:30', at('2026-11-04', '10:00'), false)).toHaveLength(DAYS_AHEAD - 1)
  })

  it('keeps to the writer’s clock across a month’s end and a change of the clocks', () => {
    const times = dailyTimes('07:15', at('2026-03-25', '09:00'), false)
    expect(times.map((time) => [new Date(time.at).getHours(), new Date(time.at).getMinutes()])).toEqual(times.map(() => [7, 15]))
    expect(new Set(times.map((time) => time.id)).size).toBe(times.length)
    expect(times.map((time) => time.id)).toContain(`${DAILY}2026-04-01`)
  })
})

describe('slots: a day’s one notification', () => {
  const now = at('2026-11-23', '10:00')
  const invite = (day: string, text: string) => ({ day, invitation: { id: text, text, link: null } })

  it('holds the day’s invitation in place of the pack’s line, at the reminder’s time; the pack’s on the days without one', () => {
    const got = slots('19:00', false, now, [invite('2026-11-23', 'Day 6 of your streak is waiting.'), invite('2026-11-24', 'Got a sentence in you today?')], '20:45')
    expect(got).toHaveLength(DAYS_AHEAD)
    expect(got[0]).toEqual({ id: `${DAILY}2026-11-23`, at: at('2026-11-23', '19:00'), title: 'Day 6 of your streak is waiting.' })
    expect(got[1].title).toBe('Got a sentence in you today?')
    expect(got.slice(2).every((one) => one.title === DAILY_TITLE)).toBe(true)
    expect(new Set(got.map((one) => one.id)).size).toBe(got.length)
  })

  it('with the reminder off, holds only the invitations, at the writing hour’s time', () => {
    const got = slots(null, false, now, [invite('2026-11-24', 'A blank page and ten quiet minutes.')], '20:45')
    expect(got).toEqual([{ id: `${DAILY}2026-11-24`, at: at('2026-11-24', '20:45'), title: 'A blank page and ten quiet minutes.' }])
  })

  it('leaves out one whose time has gone, and today’s pack once it’s opened', () => {
    expect(slots(null, false, now, [invite('2026-11-23', 'x')], '08:45')).toEqual([])
    expect(slots('19:00', true, now, [], '20:45')[0].id).toBe(`${DAILY}2026-11-24`)
    // No invitation for today: the pack's line, while the pack's unopened. (With invitations on, a day written on has neither: `reschedule`.)
    expect(slots('19:00', false, now, [], '20:45')[0]).toEqual({ id: `${DAILY}2026-11-23`, at: at('2026-11-23', '19:00'), title: DAILY_TITLE })
  })
})
