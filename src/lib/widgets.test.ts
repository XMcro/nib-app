// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Item } from '../db/db'
import { streakAfter } from './goal'
import { localDay } from './time'
import { booksOf, notesOf, plusEnds, snapshotOf } from './widgets'

let made = 0
function doc(id: string, text: string[], fields: Partial<Item> = {}): Item {
  made += 1
  return {
    id,
    kind: 'page',
    body: { type: 'doc', content: text.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })) },
    version: 1,
    createdAt: made,
    updatedAt: made,
    ...fields,
  }
}
const LOCKED = { vault: { salt: 's', sealed: 'x' } } as Partial<Item>

beforeEach(() => localStorage.clear())

describe('booksOf', () => {
  it('is each folder with pages, and each folder those are in, the one written in last first, with its words and goal', () => {
    const documents = [
      doc('a', ['One two three'], { folder: 'Novel', updatedAt: 10 }),
      doc('b', ['Four five'], { folder: 'Novel/Part 2', updatedAt: 30 }),
      doc('c', ['Six'], { folder: 'Poems', updatedAt: 20 }),
      doc('note', ['Seven eight'], { kind: 'note', folder: 'Notes', updatedAt: 40 }),
      doc('trashed', ['Nine'], { folder: 'Gone', updatedAt: 50, deletedAt: 50 }),
      doc('secret', ['Ten eleven'], { folder: 'Novel', updatedAt: 60, ...LOCKED }),
      doc('diary', ['Twelve'], { folder: 'Diary', updatedAt: 70, ...LOCKED }),
    ]
    expect(booksOf(documents, { novel: { at: 1, title: 'The Long Night', goal: { words: 80_000, deadline: '2027-03-01' } } })).toEqual([
      { folder: 'Novel', title: 'The Long Night', words: 5, goal: 80_000, deadline: '2027-03-01' },
      { folder: 'Novel/Part 2', title: 'Novel: Part 2', words: 2 },
      { folder: 'Poems', title: 'Poems', words: 1 },
    ])
  })
})

describe('notesOf', () => {
  it('is the pinned ones, then the ten edited last, each with its first lines, never a locked one or one with no title', () => {
    const documents = [
      doc('old-pin', ['Shopping', 'Eggs', '', 'Milk'], { kind: 'note', pinnedAt: 1, updatedAt: 1 }),
      doc('new-pin', ['Poem', 'A line'], { pinnedAt: 2, updatedAt: 2, readOnly: true }),
      ...Array.from({ length: 12 }, (_, i) => doc(`recent-${i}`, [`Recent ${i}`], { kind: 'note', updatedAt: 100 + i })),
      doc('locked', ['Diary'], { kind: 'note', pinnedAt: 3, updatedAt: 500, ...LOCKED }),
      doc('untitled', [], { kind: 'note', updatedAt: 600 }),
      doc('archived', ['Put away'], { kind: 'note', updatedAt: 700, archivedAt: 700 }),
      doc('template', ['Template'], { kind: 'note', updatedAt: 800, template: true }),
    ]
    const notes = notesOf(documents)
    expect(notes.map((note) => note.id)).toEqual(['new-pin', 'old-pin', ...Array.from({ length: 10 }, (_, i) => `recent-${11 - i}`)])
    expect(notes[0]).toEqual({ id: 'new-pin', kind: 'page', title: 'Poem', lines: 'A line', pinned: true, readOnly: true })
    expect(notes[1]).toEqual({ id: 'old-pin', kind: 'note', title: 'Shopping', lines: 'Eggs\nMilk', pinned: true, readOnly: false })
    expect(notes[2].pinned).toBe(false)
  })

  it('keeps a long note to its first lines', () => {
    const [note] = notesOf([doc('long', ['Title', 'x'.repeat(1000)])])
    expect(note.lines).toHaveLength(280)
  })
})

describe('snapshotOf', () => {
  it('has today’s words with the day they were on, the goal, and the run as kept', () => {
    const now = Date.parse('2026-11-22T15:00:00')
    streakAfter(600, 500, now)
    expect(snapshotOf([], 600, 500, now, {})).toEqual({ day: localDay(now), words: 600, goal: 500, streakDay: localDay(now), streak: 1, books: [], notes: [], locked: false })
  })
})

describe('a long title', () => {
  it('is cut between characters, never through one: half an emoji makes a file the app can’t read, and then there’s no snapshot at all', () => {
    // The 120th and 121st units are the two halves of one emoji.
    const [note] = notesOf([doc('emoji', [`${'x'.repeat(119)}📖 and the rest`, 'A line.'])])
    expect([...note.title]).toHaveLength(120)
    expect(note.title.endsWith('📖')).toBe(true)
    // As Swift reads it: every surrogate with its pair.
    expect(JSON.stringify(note)).not.toMatch(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i)
  })
})

describe('when Nib Plus ends, for the snapshot', () => {
  const DAY = 86_400_000
  it('is the end of Plus days from coins exactly, and of a subscription’s period with time to renew, unless it’s cancelled', () => {
    expect(plusEnds({ active: false }, 5000)).toBe(5000)
    expect(plusEnds({ active: false }, null)).toBeNull()
    expect(plusEnds({ active: true, expiresAt: 1000, willRenew: true }, null)).toBe(1000 + 35 * DAY)
    expect(plusEnds({ active: true, expiresAt: 1000 }, 9)).toBe(1000 + 35 * DAY)
    expect(plusEnds({ active: true, expiresAt: 1000, willRenew: false }, null)).toBe(1000)
    // Not said by the App Store: not known, and the snapshot has no end.
    expect(plusEnds({ active: true }, null)).toBeNull()
  })
})
