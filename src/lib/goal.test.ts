// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { JSONContent } from '@tiptap/react'
import { db, type Item } from '../db/db'
import * as items from '../db/items'
import { asGoal, describeGoal, perDay } from './documentGoal'
import { readCalendar, recordDay, streakAfter, useDailyGoal } from './goal'
import { useSprint } from './sprint'
import { notWrittenHere, startedHere, wordsToday } from './writtenHere'
import { localDay } from './time'

const words = (n: number): JSONContent => ({
  type: 'doc',
  content: n ? [{ type: 'paragraph', content: [{ type: 'text', text: Array.from({ length: n }, () => 'word').join(' ') }] }] : [],
})
const doc = (id: string, n: number, createdAt: number): Item => ({ id, kind: 'page', body: words(n), createdAt, updatedAt: createdAt, version: 1 })

// Local noon, so a day either side is a calendar day either side.
const MONDAY = new Date(2026, 8, 21, 12).getTime()
const DAY = 86_400_000
const LAST_WEEK = MONDAY - 7 * DAY

beforeEach(async () => {
  localStorage.clear()
  await db.items.clear()
})

describe('wordsToday', () => {
  it('counts what was added to older documents today, from where each stood when the day began', () => {
    expect(wordsToday([doc('a', 100, LAST_WEEK), doc('b', 40, LAST_WEEK)], MONDAY)).toBe(0)
    expect(wordsToday([doc('a', 130, LAST_WEEK), doc('b', 60, LAST_WEEK)], MONDAY + 1000)).toBe(50)
  })

  it('counts everything typed into a document started in the editor, including what was typed before its first save', () => {
    wordsToday([], MONDAY)
    startedHere('new', MONDAY)
    expect(wordsToday([doc('new', 12, MONDAY)], MONDAY + 1000)).toBe(12)
    expect(wordsToday([doc('new', 75, MONDAY)], MONDAY + 2000)).toBe(75)
  })

  it('still counts it when the count happened to run before the editor said so', () => {
    expect(wordsToday([doc('new', 12, MONDAY)], MONDAY)).toBe(0)
    startedHere('new', MONDAY)
    expect(wordsToday([doc('new', 12, MONDAY)], MONDAY + 1000)).toBe(12)
  })

  it('does not count a document that arrives already written: imported, duplicated or synced', () => {
    wordsToday([], MONDAY)
    expect(wordsToday([doc('imported', 1600, MONDAY), doc('synced', 2000, LAST_WEEK)], MONDAY + 1000)).toBe(0)
    expect(wordsToday([doc('imported', 1610, MONDAY), doc('synced', 2000, LAST_WEEK)], MONDAY + 2000)).toBe(10)
  })

  it('never goes below zero for a document cut down, so cutting does not undo writing elsewhere', () => {
    wordsToday([doc('a', 100, LAST_WEEK), doc('b', 100, LAST_WEEK)], MONDAY)
    expect(wordsToday([doc('a', 20, LAST_WEEK), doc('b', 130, LAST_WEEK)], MONDAY + 1000)).toBe(30)
  })

  // Synced in, they were counted as written here; hidden by a lock, they
  // took the day's writing in that note away.
  it('counts neither words synced in from another device nor words a lock hides', () => {
    wordsToday([doc('a', 100, LAST_WEEK)], MONDAY)
    expect(wordsToday([doc('a', 130, LAST_WEEK)], MONDAY + 1000)).toBe(30)
    notWrittenHere('a', 200, MONDAY + 2000)
    expect(wordsToday([doc('a', 330, LAST_WEEK)], MONDAY + 2000)).toBe(30)
    notWrittenHere('a', -330, MONDAY + 3000)
    expect(wordsToday([doc('a', 0, LAST_WEEK)], MONDAY + 3000)).toBe(30)
  })

  it('starts again the next day', () => {
    wordsToday([doc('a', 100, LAST_WEEK)], MONDAY)
    expect(wordsToday([doc('a', 300, LAST_WEEK)], MONDAY + 1000)).toBe(200)
    expect(wordsToday([doc('a', 300, LAST_WEEK)], MONDAY + DAY)).toBe(0)
    expect(wordsToday([doc('a', 310, LAST_WEEK)], MONDAY + DAY + 1000)).toBe(10)
  })
})

describe('streakAfter', () => {
  it('counts days in a row the goal was met, and holds through the next day until it is missed', () => {
    expect(streakAfter(100, 500, MONDAY)).toBe(0)
    expect(streakAfter(500, 500, MONDAY)).toBe(1)
    expect(streakAfter(900, 500, MONDAY)).toBe(1) // once per day
    expect(streakAfter(0, 500, MONDAY + DAY)).toBe(1) // Tuesday, not written yet: the run is still alive
    expect(streakAfter(600, 500, MONDAY + DAY)).toBe(2)
    expect(streakAfter(0, 500, MONDAY + 3 * DAY)).toBe(0) // Wednesday was missed
    expect(streakAfter(500, 500, MONDAY + 3 * DAY)).toBe(1)
  })

  it('uses the writer’s own calendar day', () => {
    expect(localDay(new Date(2026, 8, 21, 23, 59).getTime())).toBe('2026-09-21')
    expect(localDay(new Date(2026, 8, 22, 0, 1).getTime())).toBe('2026-09-22')
  })
})

describe('useDailyGoal', () => {
  it('recounts when a new document is marked after its save was already counted', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') }) // noon: the test's days can't change under it
    onTestFinished(() => void vi.useRealTimers())
    localStorage.setItem('nib-goal', '20')
    const typed = doc('new', 12, Date.now())
    const { result } = renderHook(() => useDailyGoal([typed], [], true))
    expect(result.current[0]!.written).toBe(0) // first seen with its words already in
    act(() => startedHere('new'))
    expect(result.current[0]!.written).toBe(12)
  })

  it('shows nothing without Plus, or with no goal set', () => {
    localStorage.setItem('nib-goal', '20')
    expect(renderHook(() => useDailyGoal([], [], false)).result.current[0]).toBeNull()
    localStorage.setItem('nib-goal', '0')
    expect(renderHook(() => useDailyGoal([], [], true)).result.current[0]).toBeNull()
  })
})

describe('a document’s goal', () => {
  it('spreads what is left over the days to the deadline, counting today', () => {
    expect(perDay({ words: 5000, deadline: '2026-09-24' }, 1240, MONDAY)).toBe(940) // 3,760 over Mon–Thu
    expect(perDay({ words: 5000, deadline: '2026-09-21' }, 1240, MONDAY)).toBe(3760) // due today: all of it
    expect(perDay({ words: 5000, deadline: '2026-09-20' }, 1240, MONDAY)).toBeNull() // passed
    expect(perDay({ words: 5000 }, 1240, MONDAY)).toBeNull()
    expect(perDay({ words: 5000, deadline: '2026-09-24' }, 5000, MONDAY)).toBeNull()
  })

  it('reads as progress and pace in the status line', () => {
    expect(describeGoal({ words: 5000, deadline: '2026-09-24' }, 1240, MONDAY)).toBe('1,240 of 5,000 · 940/day to make Sep 24')
    expect(describeGoal({ words: 5000, deadline: '2027-01-15' }, 1240, MONDAY)).toMatch(/to make Jan 15, 2027$/)
    expect(describeGoal({ words: 5000, deadline: '2026-09-20' }, 1240, MONDAY)).toBe('1,240 of 5,000 · Sep 20 has passed')
    expect(describeGoal({ words: 5000 }, 1240, MONDAY)).toBe('1,240 of 5,000')
    expect(describeGoal({ words: 5000, deadline: '2026-09-20' }, 5012, MONDAY)).toBe('5,012 of 5,000 · Goal met')
  })

  it('takes only a whole number of words and a real day from outside, and null as removed', () => {
    expect(asGoal(null)).toBeNull()
    expect(asGoal(undefined)).toBeUndefined()
    expect(asGoal({ words: 1.5 })).toBeUndefined()
    expect(asGoal([5000])).toBeUndefined()
    expect(asGoal({ words: 10, deadline: 'soon' })).toEqual({ words: 10 })
    expect(asGoal({ words: 10, deadline: '2026-11-30', extra: 1 })).toEqual({ words: 10, deadline: '2026-11-30' })
  })
})

describe('the writing calendar', () => {
  it('keeps each day’s words whenever Plus is on, with or without a daily goal', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') }) // noon: the test's days can't change under it
    onTestFinished(() => void vi.useRealTimers())
    const page = doc('a', 100, LAST_WEEK)
    const { rerender } = renderHook(({ pages }) => useDailyGoal([], pages, true), { initialProps: { pages: [page] } })
    rerender({ pages: [{ ...page, body: words(160) }] })
    expect(readCalendar()[localDay(Date.now())]).toBe(60)
  })

  it('keeps nothing without Plus', () => {
    const page = doc('a', 100, LAST_WEEK)
    const { rerender } = renderHook(({ pages }) => useDailyGoal([], pages, false), { initialProps: { pages: [page] } })
    rerender({ pages: [{ ...page, body: words(160) }] })
    expect(readCalendar()).toEqual({})
  })

  it('lets go of days older than about 26 weeks, and skips days with nothing written', () => {
    recordDay(300, MONDAY)
    recordDay(0, MONDAY + DAY)
    recordDay(40, MONDAY + 181 * DAY)
    expect(Object.keys(readCalendar())).toEqual(['2026-09-21', localDay(MONDAY + 181 * DAY)])
    recordDay(50, MONDAY + 182 * DAY)
    expect(readCalendar()).not.toHaveProperty('2026-09-21')
  })
})

describe('useSprint', () => {
  const flush = async () => {}
  const all = async () => [...(await items.list('note')), ...(await items.list('page'))]

  it('counts only what is written during the sprint, by the day’s rules', async () => {
    const older = await items.create('page', words(100))
    const { result, rerender } = renderHook(({ documents }) => useSprint(documents, flush), { initialProps: { documents: await all() } })
    await act(() => result.current.start(25))
    expect(result.current.sprint?.written).toBe(0)

    await items.update(older, words(130))
    await items.create('note', words(2000)) // arrives already written, so counts nothing
    const started = await items.create('note', words(12))
    act(() => startedHere(started))
    rerender({ documents: await all() })
    expect(result.current.sprint?.written).toBe(42)
  })

  it('ends with a quiet summary that stays until dismissed', async () => {
    const older = await items.create('page', words(100))
    const { result } = renderHook(() => useSprint([], flush))
    await act(() => result.current.start(15))
    await items.update(older, words(150))
    await act(() => result.current.stop())
    expect(result.current.sprint).toBeNull()
    expect(result.current.done).toEqual({ minutes: 1, written: 50 })
    expect(renderHook(() => useSprint([], flush)).result.current.done).toEqual({ minutes: 1, written: 50 })
    act(() => result.current.dismiss())
    expect(result.current.done).toBeNull()
  })

  it('carries on after a relaunch, and finishes one that ended while Nib was away', async () => {
    const older = await items.create('page', words(100))
    const first = renderHook(() => useSprint([], flush))
    await act(() => first.result.current.start(45))
    first.unmount()

    const { result } = renderHook(() => useSprint([], flush))
    expect(result.current.sprint?.endsAt).toBeGreaterThan(Date.now())

    await items.update(older, words(400))
    const stored = JSON.parse(localStorage.getItem('nib-sprint')!)
    const ended = Date.now() - 60_000
    localStorage.setItem('nib-sprint', JSON.stringify({ ...stored, startedAt: ended - 45 * 60_000, endsAt: ended }))
    act(() => startedHere('nothing')) // any recount: the new end is due at once
    await waitFor(() => expect(result.current.done).toEqual({ minutes: 45, written: 300 }))
  })
})
