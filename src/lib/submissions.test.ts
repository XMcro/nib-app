// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addSubmission,
  answerOf,
  followUpAfter,
  inOrder,
  asSubmissions,
  changeSubmission,
  mergeSubmissions,
  readSubmissions,
  removeSubmission,
  replaceSubmissions,
  SUBMISSIONS_CHANGED,
  submissionsOf,
  type Submissions,
} from './submissions'

beforeEach(() => {
  localStorage.clear()
  replaceSubmissions({})
})

describe('a submission as it arrives', () => {
  it('keeps what it can be, in one order, and lets the rest go', () => {
    const read = asSubmissions({
      b: { at: 2, piece: { book: '  The   Lighthouse ' }, where: ' Granta ', sent: '2026-11-01', answer: 'shortlisted', followUp: '2026-02-30', note: 'Sent the first three chapters.' },
      a: { at: 1, piece: { document: 'abc-123' }, where: 'The Paris Review', sent: 'November', answer: 'declined', answered: '2026-11-20' },
      'no piece': { at: 3, where: 'Nowhere' },
      'bad id!': { at: 3, piece: { document: 'x' } },
      gone: { at: 4, gone: true, piece: { document: 'x' } },
      odd: 'not one',
    })
    expect(Object.keys(read!)).toEqual(['a', 'b', 'gone'])
    // A day that isn't one, and words where a day goes, are as none; an answer from a later Nib is kept.
    expect(read!.a).toEqual({ at: 1, piece: { document: 'abc-123' }, where: 'The Paris Review', answer: 'declined', answered: '2026-11-20' })
    expect(read!.b).toEqual({ at: 2, piece: { book: 'The Lighthouse' }, where: 'Granta', sent: '2026-11-01', answer: 'shortlisted', note: 'Sent the first three chapters.' })
    expect(read!.gone).toEqual({ at: 4, gone: true })
    expect(answerOf(read!.b as never)).toBe('waiting')
    expect(asSubmissions([])).toBeUndefined()
  })
})

describe('two devices’ submissions', () => {
  it('keep, for each, the one changed last, a deleted one staying deleted', () => {
    const here: Submissions = { a: { at: 5, piece: { document: 'p' }, where: 'Granta', answer: 'more' }, b: { at: 2, piece: { document: 'p' }, where: 'Ploughshares' } }
    const there: Submissions = { a: { at: 3, piece: { document: 'p' }, where: 'Granta' }, b: { at: 4, gone: true }, c: { at: 1, piece: { book: 'Novel' }, where: 'An agent' } }
    expect(mergeSubmissions(here, there)).toEqual({ a: here.a, b: { at: 4, gone: true }, c: there.c })
  })
})

describe('this device’s', () => {
  it('are added, changed and taken off, said for sync each time, and listed newest sent first', () => {
    const said = vi.fn()
    window.addEventListener(SUBMISSIONS_CHANGED, said)
    const first = addSubmission({ document: 'p' }, { where: 'Granta', sent: '2026-09-01' })
    const second = addSubmission({ document: 'p' }, { where: 'Ploughshares', sent: '2026-11-01', followUp: '2027-02-01' })
    addSubmission({ book: 'Novel' }, { where: 'An agent', sent: '2026-10-01' })
    changeSubmission(first, { answer: 'declined', answered: '2026-11-10', where: null })
    expect(submissionsOf(readSubmissions(), { document: 'p' }).map((one) => one.id)).toEqual([second, first])
    expect(submissionsOf(readSubmissions(), { book: 'novel' })).toHaveLength(1)
    expect(readSubmissions()[first]).toMatchObject({ answer: 'declined', answered: '2026-11-10' })
    expect(readSubmissions()[first]).not.toHaveProperty('where')
    removeSubmission(second)
    expect(readSubmissions()[second]).toMatchObject({ gone: true })
    expect(submissionsOf(readSubmissions())).toHaveLength(2)
    expect(said).toHaveBeenCalledTimes(5)
    window.removeEventListener(SUBMISSIONS_CHANGED, said)
  })
})

describe('the days and the order', () => {
  it('suggests a follow-up 90 days on, across months and years', () => {
    expect(followUpAfter('2026-11-21')).toBe('2027-02-19')
    expect(followUpAfter('2028-01-01')).toBe('2028-03-31')
  })

  it('puts those still waiting first, soonest follow-up first, then the rest, newest sent first', () => {
    const list = [
      { at: 1, piece: { document: 'p' }, where: 'a', sent: '2026-01-01', answer: 'declined' },
      { at: 1, piece: { document: 'p' }, where: 'b', sent: '2026-03-01', answer: 'accepted' },
      { at: 1, piece: { document: 'p' }, where: 'c', followUp: '2026-12-01' },
      { at: 1, piece: { document: 'p' }, where: 'd', followUp: '2026-11-25', answer: 'more' },
      { at: 1, piece: { document: 'p' }, where: 'e' },
    ]
    expect(inOrder(list).map((one) => one.where)).toEqual(['d', 'c', 'e', 'b', 'a'])
  })
})

