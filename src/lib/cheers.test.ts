// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { cheer, daysAway, hush, lineFor, passed, spoke, useCheer, useCheers, type Open } from './cheers'
import type { DailyGoal } from './goal'
import type { SprintDone } from './sprint'
import { localDay } from './time'

const DAY = 86_400_000
const NOON = new Date(2026, 10, 12, 12).getTime()
const daysAgo = (n: number) => localDay(NOON - n * DAY)
// As the app counts them, from now.
const daysBack = (n: number) => localDay(Date.now() - n * DAY)

beforeEach(() => localStorage.clear())
afterEach(() => hush())

describe('what the buddy says', () => {
  it('names the piece it welcomes you back to, cut short if it’s long, or says hello without one', () => {
    expect(lineFor({ kind: 'back', title: 'The Lighthouse' }, () => 0)).toBe('Welcome back. “The Lighthouse” is where you left off.')
    expect(lineFor({ kind: 'back', title: 'A'.repeat(60) }, () => 0)).toBe(`Welcome back. “${'A'.repeat(39)}…” is where you left off.`)
    expect(lineFor({ kind: 'back' }, () => 0.99)).toBe('Good to see you again.')
  })

  it('counts the milestone and the sprint as a writer reads them', () => {
    expect(lineFor({ kind: 'milestone', words: 1_000 })).toBe('1,000 words in this one. A real start.')
    expect(lineFor({ kind: 'milestone', words: 100_000 })).toBe('100,000 words in this one. Remarkable.')
    expect(lineFor({ kind: 'sprint', minutes: 25, written: 1_204 }, () => 0)).toBe('1,204 words in 25 minutes. Good sprint.')
    expect(lineFor({ kind: 'sprint', minutes: 15, written: 1 }, () => 0)).toBe('1 word in 15 minutes. Good sprint.')
    expect(lineFor({ kind: 'goal' }, () => 0)).toBe('That’s today’s goal met. Nicely done.')
  })
})

describe('when the buddy speaks', () => {
  it('counts the days since you last wrote, not today, nor days with nothing', () => {
    expect(daysAway({}, NOON)).toBeNull()
    expect(daysAway({ [daysAgo(5)]: 300, [daysAgo(0)]: 50 }, NOON)).toBe(5)
    expect(daysAway({ [daysAgo(5)]: 300, [daysAgo(2)]: 0 }, NOON)).toBe(5)
    expect(daysAway({ [daysAgo(1)]: 10 }, NOON)).toBe(1)
  })

  it('sees a piece pass the largest milestone it went by, once', () => {
    expect(passed(900, 1_100)).toBe(1_000)
    expect(passed(999, 1_000)).toBe(1_000)
    expect(passed(900, 6_000)).toBe(5_000)
    expect(passed(1_000, 1_200)).toBeNull()
    expect(passed(1_200, 900)).toBeNull()
  })

  it('says one thing a day, keeping the first that comes till it’s said', () => {
    const { result } = renderHook(() => useCheer())
    act(() => cheer({ kind: 'goal' }, NOON))
    const first = result.current
    expect(first).toMatch(/goal|words/i)
    act(() => cheer({ kind: 'milestone', words: 1_000 }, NOON))
    expect(result.current).toBe(first)
    act(() => spoke(NOON))
    expect(result.current).toBeNull()
    act(() => cheer({ kind: 'milestone', words: 1_000 }, NOON + DAY / 4))
    expect(result.current).toBeNull()
    act(() => cheer({ kind: 'milestone', words: 1_000 }, NOON + DAY))
    expect(result.current).toBe('1,000 words in this one. A real start.')
  })
})

describe('what the buddy watches for', () => {
  type Seen = { on: boolean; ready: boolean; goal: DailyGoal | null; sprint: SprintDone | null; open: Open | null }
  const start: Seen = { on: true, ready: true, goal: null, sprint: null, open: null }
  function watch(first: Partial<Seen>, title?: string) {
    const said = renderHook(() => useCheer())
    const watched = renderHook((seen: Seen) => useCheers({ ...seen, last: () => title }), { initialProps: { ...start, ...first } })
    return { said: () => said.result.current, then: (next: Partial<Seen>) => act(() => watched.rerender({ ...start, ...first, ...next })) }
  }

  it('welcomes you back after three days away, with the piece last written in', () => {
    localStorage.setItem('nib-goal-calendar', JSON.stringify({ [daysBack(3)]: 400 }))
    expect(watch({}, 'The Lighthouse').said()).toMatch(/“The Lighthouse”/)
  })

  it('doesn’t, after two days, nor before the library is in', () => {
    localStorage.setItem('nib-goal-calendar', JSON.stringify({ [daysBack(2)]: 400 }))
    expect(watch({}).said()).toBeNull()
    localStorage.setItem('nib-goal-calendar', JSON.stringify({ [daysBack(9)]: 400 }))
    const later = watch({ ready: false })
    expect(later.said()).toBeNull()
    later.then({ ready: true })
    expect(later.said()).toMatch(/Welcome back|Good to see you/)
  })

  it('cheers the goal as it’s met, not one met already', () => {
    const met = watch({ goal: { goal: 500, written: 520, streak: 1 } })
    met.then({ goal: { goal: 500, written: 600, streak: 1 } })
    expect(met.said()).toBeNull()
    const meeting = watch({ goal: { goal: 500, written: 480, streak: 0 } })
    meeting.then({ goal: { goal: 500, written: 510, streak: 1 } })
    expect(meeting.said()).toMatch(/goal|words are in/i)
  })

  it('cheers a sprint as it ends with words in it, not one ended before', () => {
    const before = watch({ sprint: { minutes: 25, written: 300 } })
    before.then({ sprint: { minutes: 25, written: 300 } })
    expect(before.said()).toBeNull()
    const empty = watch({})
    empty.then({ sprint: { minutes: 15, written: 0 } })
    expect(empty.said()).toBeNull()
    const ending = watch({})
    ending.then({ sprint: { minutes: 25, written: 640 } })
    expect(ending.said()).toMatch(/640 words/)
  })

  it('cheers a piece passing a milestone as you write, not one opened past it', () => {
    const opening = watch({ open: { id: 'a', words: 200 } })
    opening.then({ open: { id: 'b', words: 12_000 } })
    expect(opening.said()).toBeNull()
    const writing = watch({ open: { id: 'b', words: 9_950 } })
    writing.then({ open: { id: 'b', words: 10_020 } })
    expect(writing.said()).toBe('10,000 words in this one. That’s a proper body of work.')
  })

  it('says nothing while it’s off, and forgets what it had to say when turned off', () => {
    const off = watch({ on: false, goal: { goal: 500, written: 480, streak: 0 } })
    off.then({ on: false, goal: { goal: 500, written: 510, streak: 1 } })
    expect(off.said()).toBeNull()
    const turned = watch({ goal: { goal: 500, written: 480, streak: 0 } })
    turned.then({ goal: { goal: 500, written: 510, streak: 1 } })
    expect(turned.said()).not.toBeNull()
    turned.then({ on: false, goal: { goal: 500, written: 510, streak: 1 } })
    expect(turned.said()).toBeNull()
  })
})
