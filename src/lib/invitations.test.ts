// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { ahead, inviteTime, keepSent, linkFor, LINES, pick, tellInvitations, usualHours, type Day } from './invitations'
import { replaceFolderSettings } from './folderSettings'

const base: Day = { day: '2026-11-23', written: 0, goal: 0, streak: 0, away: 0, plus: false, inkwell: false, locked: false, last: null }
const book = { folder: 'Novel/The Long Night', title: 'The Long Night', words: 41_000, goal: 100_000 }
const prompt = (d: Partial<Day>) => LINES.find((line) => line.id === pick({ ...base, ...d })?.id)?.prompt

describe('pick', () => {
  it('sends nothing on a day already written on', () => {
    expect(pick({ ...base, written: 12, goal: 500, streak: 6 })).toBeNull()
  })

  it('takes the most pressing prompt with something to say', () => {
    expect(prompt({ goal: 500, streak: 6, plus: true, book, away: 4 })).toBe('streak')
    expect(prompt({ goal: 500, streak: 1, plus: true, book: { ...book, deadline: '2026-12-01' } })).toBe('deadline')
    expect(prompt({ plus: true, book })).toBe('book')
    expect(prompt({ day: '2026-12-12', away: 4 })).toBe('door')
    expect(prompt({ away: 5, goal: 500 })).toBe('away')
    expect(prompt({ goal: 500, away: 2 })).toBe('goal')
    // A book's goal is Nib Plus: without it, its book isn't spoken of.
    expect(prompt({ book })).not.toMatch(/book|deadline/)
  })

  it('on a day with nothing pressing, takes turns between the pack, sounds, Inkwell and any day', () => {
    const days = Array.from({ length: 8 }, (_, i) => `2026-11-${String(20 + i).padStart(2, '0')}`)
    const prompts = days.map((day) => prompt({ day, inkwell: true }))
    expect(new Set(prompts)).toEqual(new Set(['pack', 'sounds', 'inkwell', 'any']))
    expect(days.map((day) => prompt({ day })).includes('inkwell')).toBe(false)
  })

  it('fills in its numbers and titles', () => {
    const streak = pick({ ...base, goal: 500, streak: 6 })!
    expect(streak.text).toMatch(/\b(6|7)\b/)
    expect(pick({ ...base, plus: true, book, last: null, day: '2026-11-24' })!.text).toContain('The Long Night')
    expect(pick({ ...base, goal: 1250, away: 1 })!.text).toContain('1,250 words')
    expect(pick({ ...base, plus: true, book: { ...book, deadline: '2026-11-24' }, day: '2026-11-23' })!.text).not.toMatch(/\b1 days\b/)
  })

  it('never sends the same line twice in a row', () => {
    for (let i = 0; i < 40; i++) {
      const day = new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10)
      const first = pick({ ...base, day, goal: 500, streak: 3 })!
      expect(pick({ ...base, day, goal: 500, streak: 3, last: first.id })!.id).not.toBe(first.id)
    }
  })

  it('names no book while Lock Nib is on, and says something else', () => {
    const locked = pick({ ...base, plus: true, book: { ...book, deadline: '2026-11-30' }, locked: true })!
    expect(locked.text).not.toContain('The Long Night')
    expect(locked.link).toBeNull()
  })

  it('opens its book, the Plus screen for a Plus feature without Plus, or Nib as it was', () => {
    expect(pick({ ...base, plus: true, book })!.link).toBe('nib://book/Novel%2FThe%20Long%20Night')
    const sounds = Array.from({ length: 8 }, (_, i) => pick({ ...base, day: `2026-11-${20 + i}` })!).find((one) => one.id.startsWith('sounds'))!
    expect(sounds.link).toBe('nib://plus')
    const withPlus = Array.from({ length: 8 }, (_, i) => pick({ ...base, plus: true, day: `2026-11-${20 + i}` })!).find((one) => one.id.startsWith('sounds'))!
    expect(withPlus.link).toBeNull()
    expect(pick({ ...base, goal: 500, streak: 4 })!.link).toBeNull()
  })
})

describe('LINES', () => {
  it('each have an id of their own, and read whole for every day they could be sent', () => {
    expect(new Set(LINES.map((line) => line.id)).size).toBe(LINES.length)
    const full: Day = { ...base, day: '2026-12-05', goal: 750, streak: 4, away: 5, plus: true, inkwell: true, book: { ...book, deadline: '2026-12-15' } }
    for (const line of LINES) {
      const text = line.text(full)
      expect(text, line.id).not.toMatch(/undefined|NaN|null|\{|\}/)
      // A banner's line: short enough to read whole.
      expect(text.length, line.id).toBeLessThanOrEqual(90)
      // Written as Nib writes: curly apostrophes, never straight ones.
      expect(text, line.id).not.toMatch(/'/)
    }
  })
})

describe('inviteTime', () => {
  const hours = (busiest: number) => Array.from({ length: 24 }, (_, hour) => (hour === busiest ? 900 : hour === 10 ? 200 : 0))

  it('is a quarter of an hour before the hour written in most', () => {
    expect(inviteTime(hours(21))).toBe('20:45')
    expect(inviteTime(hours(9))).toBe('08:45')
  })

  it('keeps out of quiet hours, and is early evening with nothing to go on', () => {
    expect(inviteTime(hours(6))).toBe('08:00')
    expect(inviteTime(hours(23))).toBe('21:30')
    expect(inviteTime(undefined)).toBe('18:45')
    expect(inviteTime(Array(24).fill(0))).toBe('18:45')
  })
})

describe('usualHours', () => {
  it('are this year’s and last year’s together, so New Year’s Day keeps the time the writer had', () => {
    const nine = Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 900 : 0))
    const newYear = new Date(2027, 0, 1, 10).getTime()
    expect(inviteTime(usualHours({ 2026: nine }, newYear))).toBe('08:45')
    // A first evening of the year doesn't outweigh a year of mornings.
    expect(inviteTime(usualHours({ 2026: nine, 2027: Array.from({ length: 24 }, (_, hour) => (hour === 22 ? 300 : 0)) }, newYear))).toBe('08:45')
    expect(inviteTime(usualHours({}, newYear))).toBe('18:45')
  })
})

describe('ahead: the week’s invitations', () => {
  const at = (date: string, time: string) => new Date(`${date}T${time}`).getTime()
  beforeEach(() => {
    localStorage.clear()
    tellInvitations({ documents: [], plus: false, inkwell: false, wrote: false })
  })

  it('has one for each of the next INVITE_DAYS days, none for today once it’s written on', () => {
    const known = { now: at('2026-11-23', '10:00'), calendar: { '2026-11-20': 300 }, streak: { last: '', count: 0 }, goal: 0, locked: false }
    const week = ahead(known)
    expect(week.map((one) => one.day)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'])
    expect(ahead({ ...known, calendar: { '2026-11-23': 40 } }).map((one) => one.day)).not.toContain('2026-11-23')
  })

  it('keeps a run of days only for the day after its last, and counts the days away', () => {
    const known = { now: at('2026-11-23', '10:00'), calendar: { '2026-11-22': 600 }, streak: { last: '2026-11-22', count: 5 }, goal: 500, locked: false }
    const [today, tomorrow] = ahead(known)
    expect(LINES.find((line) => line.id === today.invitation.id)!.prompt).toBe('streak')
    expect(LINES.find((line) => line.id === tomorrow.invitation.id)!.prompt).toBe('goal')
    const later = ahead({ ...known, streak: { last: '', count: 0 }, goal: 0 }).find((one) => one.day === '2026-11-26')!
    expect(LINES.find((line) => line.id === later.invitation.id)!.prompt).toBe('away')
  })

  it('counts no days with sync on: this device knows only its own, and the writer may have written on another', () => {
    const known = { now: at('2026-11-23', '10:00'), calendar: { '2026-11-15': 600 }, streak: { last: '2026-11-22', count: 5 }, goal: 500, locked: false }
    const prompts = (week: ReturnType<typeof ahead>) => week.map((one) => LINES.find((line) => line.id === one.invitation.id)!.prompt)
    expect(prompts(ahead(known))).toContain('streak')
    expect(prompts(ahead({ ...known, streak: { last: '', count: 0 }, goal: 0 }))).toContain('away')
    tellInvitations({ documents: [], plus: false, inkwell: false, wrote: false, synced: true })
    for (const week of [ahead(known), ahead({ ...known, streak: { last: '', count: 0 }, goal: 0 })]) {
      expect(prompts(week)).not.toContain('streak')
      expect(prompts(week)).not.toContain('away')
      expect(week).toHaveLength(7)
    }
  })

  it('never has the same line two days running, and starts from the one set for yesterday', () => {
    const known = { now: at('2026-11-23', '10:00'), calendar: {}, streak: { last: '', count: 0 }, goal: 500, locked: false }
    const week = ahead(known)
    for (let i = 1; i < week.length; i++) expect(week[i].invitation.id).not.toBe(week[i - 1].invitation.id)
    keepSent([{ day: '2026-11-22', invitation: week[0].invitation }], known.now)
    expect(ahead(known)[0].invitation.id).not.toBe(week[0].invitation.id)
  })

  it('remembers what each day’s opens, for a tap, a fortnight back', () => {
    const now = at('2026-11-23', '10:00')
    keepSent([{ day: '2026-11-01', invitation: { id: 'book-1', text: 'x', link: 'nib://book/Old' } }], at('2026-11-01', '10:00'))
    keepSent([{ day: '2026-11-24', invitation: { id: 'book-2', text: 'y', link: 'nib://book/Novel' } }], now)
    expect(linkFor('2026-11-24')).toBe('nib://book/Novel')
    expect(linkFor('2026-11-01')).toBeNull()
  })

  it('names the book written in last with a goal, with Plus, and none under Lock Nib', () => {
    const page = { id: 'p', kind: 'page' as const, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Some words here.' }] }] }, version: 1, createdAt: 1, updatedAt: 5, folder: 'Night' }
    replaceFolderSettings({ night: { at: 1, goal: { words: 1000 } } })
    tellInvitations({ documents: [page], plus: true, inkwell: false, wrote: false })
    const known = { now: at('2026-11-23', '10:00'), calendar: {}, streak: { last: '', count: 0 }, goal: 0, locked: false }
    expect(ahead(known)[0].invitation.text).toContain('Night')
    expect(ahead({ ...known, locked: true }).some((one) => one.invitation.text.includes('Night'))).toBe(false)
  })
})
