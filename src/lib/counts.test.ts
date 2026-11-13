// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { count, countsAnswer, sendCounts, setCountsAnswer } from './counts'

vi.mock('./platform', () => ({ nativeApp: true, macApp: false, touchApp: true, deviceKind: () => 'iphone' }))

const NOON = (day: number) => new Date(2026, 10, day, 12).getTime()
const stored = () => JSON.parse(localStorage.getItem('nib-counts') ?? '{}')

function server(status = 204) {
  const calls: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string))
    return new Response(null, { status })
  })
  return calls
}

beforeEach(() => localStorage.clear())

describe('usage counts', () => {
  it('keep nothing until the writer says yes', () => {
    expect(countsAnswer()).toBeNull()
    count('opened', NOON(8))
    expect(stored()).toEqual({})
  })

  it('add up by day once the writer says yes', () => {
    setCountsAnswer(true)
    count('opened', NOON(8))
    count('opened', NOON(8))
    count('export_word', NOON(9))
    expect(stored()).toEqual({ '2026-11-08': { opened: 2 }, '2026-11-09': { export_word: 1 } })
  })

  it('are forgotten when the writer says no, and stop', () => {
    setCountsAnswer(true)
    count('opened', NOON(8))
    setCountsAnswer(false)
    expect(stored()).toEqual({})
    count('opened', NOON(8))
    expect(stored()).toEqual({})
  })

  it('send nothing without a yes', async () => {
    const calls = server()
    localStorage.setItem('nib-counts', JSON.stringify({ '2026-11-08': { opened: 1 } }))
    await sendCounts(NOON(9))
    expect(calls).toEqual([])
  })

  it('send only finished days, each by itself, with the day, device and version and nothing else', async () => {
    const calls = server()
    setCountsAnswer(true)
    count('opened', NOON(7))
    count('pinned', NOON(8))
    count('opened', NOON(9))
    await sendCounts(NOON(9))
    expect(calls.map((call) => Object.keys(call).sort())).toEqual([
      ['counts', 'day', 'device', 'version'],
      ['counts', 'day', 'device', 'version'],
    ])
    expect(calls.map(({ day, counts, device }) => ({ day, counts, device }))).toEqual([
      { day: '2026-11-07', counts: { opened: 1 }, device: 'iphone' },
      { day: '2026-11-08', counts: { pinned: 1 }, device: 'iphone' },
    ])
    expect(stored()).toEqual({ '2026-11-09': { opened: 1 } })
  })

  it('wait for the next launch when the server can’t take them', async () => {
    for (const status of [429, 500]) {
      localStorage.clear()
      server(status)
      setCountsAnswer(true)
      count('opened', NOON(8))
      await sendCounts(NOON(9))
      expect(stored()).toEqual({ '2026-11-08': { opened: 1 } })
    }
  })

  it('wait for the next launch when offline', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline')
    })
    setCountsAnswer(true)
    count('opened', NOON(8))
    await sendCounts(NOON(9))
    expect(stored()).toEqual({ '2026-11-08': { opened: 1 } })
  })

  it('let go of a day the server will never take', async () => {
    server(400)
    setCountsAnswer(true)
    count('opened', NOON(1))
    await sendCounts(NOON(20))
    expect(stored()).toEqual({})
  })

  it('never get in the way when storage holds rubbish', () => {
    setCountsAnswer(true)
    localStorage.setItem('nib-counts', 'not json')
    expect(() => count('opened', NOON(8))).not.toThrow()
    expect(stored()).toEqual({ '2026-11-08': { opened: 1 } })
  })
})
