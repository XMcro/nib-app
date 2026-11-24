import { useSyncExternalStore } from 'react'
import { readJson, writeJson } from './jsonStorage'

/**
 * The submission tracker (Nib Plus): where a piece of writing was sent and
 * when, what came back and when, and a day to follow up. A piece is a note
 * or a page, by its id, or a book, by its folder's whole name (lib/manuscript).
 *
 * Kept on this device, carried by sync in a sealed record of its own
 * (sync/engine) and in backups, as the folders' settings are
 * (lib/folderSettings): two devices' are merged submission by submission, the
 * one changed last kept, and one deleted is kept gone, so another device's
 * older copy can't bring it back. A Nib from before this takes no notice of it.
 */

/** What can come back: `more` is a request for more (a partial, or the full manuscript); `silent`, no answer ever. */
export const ANSWERS = ['waiting', 'more', 'accepted', 'declined', 'withdrawn', 'silent'] as const
export type Answer = (typeof ANSWERS)[number]

/** A note or page, or a book. */
export type Piece = { document: string } | { book: string }

/**
 * `at`: when it was last changed, here or on another device. Dates are days,
 * `YYYY-MM-DD`. `answer` is kept as any word a Nib might give, so one from a
 * later Nib with more isn't lost here; one not known is shown as waiting.
 */
export type Submission = { at: number; piece: Piece; where?: string; sent?: string; answer?: string; answered?: string; followUp?: string; note?: string }
type Kept = Submission | { at: number; gone: true }
export type Submissions = Record<string, Kept>

/** More than anyone sends, the deleted included, and few enough that a copy from outside can't hold the app up. */
const MAX_ENTRIES = 5000

const asId = (raw: unknown) => (typeof raw === 'string' && /^[\w-]{1,100}$/.test(raw) ? raw : undefined)
/** Words the writer gave it, a line of them. */
const asLine = (raw: unknown) => {
  const line = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  return line && line.length <= 200 ? line : undefined
}
/** A few lines, as the writer wrote them. */
const asNote = (raw: unknown) => {
  const note = typeof raw === 'string' ? raw.trim() : ''
  return note && note.length <= 2000 ? note : undefined
}
/** A day that is one. */
export const asDay = (raw: unknown) => {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined
  const [y, m, d] = raw.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d))
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d ? raw : undefined
}
const asAnswer = (raw: unknown) => (typeof raw === 'string' && /^[a-z-]{1,40}$/.test(raw) ? raw : undefined)
function asPiece(raw: unknown): Piece | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { document, book } = raw as Record<string, unknown>
  const id = asId(document)
  if (id) return { document: id }
  const folder = asLine(book)
  return folder ? { book: folder } : undefined
}

/** How each of a submission's own is checked, arriving from storage, a backup or another device. */
const OWN = { where: asLine, sent: asDay, answer: asAnswer, answered: asDay, followUp: asDay, note: asNote }
type Own = keyof typeof OWN

function asKept(raw: unknown): Kept | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const { at, gone, piece } = raw as Record<string, unknown>
  if (!Number.isFinite(at) || (at as number) < 0) return undefined
  if (gone === true) return { at: at as number, gone }
  const of = asPiece(piece)
  if (!of) return undefined
  const submission: Submission = { at: at as number, piece: of }
  for (const own of Object.keys(OWN) as Own[]) {
    const value = OWN[own]((raw as Record<string, unknown>)[own])
    if (value) submission[own] = value
  }
  return submission
}

/** Whichever of two was changed last; if at once, the same one on every device. */
const later = (a: Kept | undefined, b: Kept) => (!a || b.at > a.at || (b.at === a.at && JSON.stringify(b) > JSON.stringify(a)) ? b : a)

/**
 * Taken from storage, a backup or another device: each submission once, in
 * one order, so the same read the same on every device and nothing goes back
 * and forth for nothing. Anything but an object says nothing. Past
 * MAX_ENTRIES, the deleted are let go first, oldest first.
 */
export function asSubmissions(raw: unknown): Submissions | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const kept = new Map<string, Kept>()
  for (const [id, value] of Object.entries(raw)) {
    const one = asKept(value)
    if (one && asId(id)) kept.set(id, later(kept.get(id), one))
  }
  const entries = [...kept]
  const alive = entries.filter(([, one]) => !('gone' in one))
  const gone = entries.filter(([, one]) => 'gone' in one).sort(([, a], [, b]) => b.at - a.at)
  const chosen = [...alive.slice(0, MAX_ENTRIES), ...gone.slice(0, Math.max(0, MAX_ENTRIES - alive.length))]
  return Object.fromEntries(chosen.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** Both devices' together: for each submission, the one changed last. */
export function mergeSubmissions(here: Submissions, there: Submissions): Submissions {
  const both: Submissions = { ...here }
  for (const [id, one] of Object.entries(there)) both[id] = later(both[id], one)
  return asSubmissions(both)!
}

const live = (one: Kept | undefined): Submission | undefined => (one && !('gone' in one) ? one : undefined)
const samePiece = (a: Piece, b: Piece) => ('document' in a ? 'document' in b && a.document === b.document : 'book' in b && a.book.toLocaleLowerCase() === b.book.toLocaleLowerCase())

/** The submissions there are, with their ids, newest sent first; of one piece, if it's given. */
export function submissionsOf(all: Submissions, piece?: Piece): (Submission & { id: string })[] {
  return Object.entries(all)
    .flatMap(([id, one]) => {
      const submission = live(one)
      return submission && (!piece || samePiece(submission.piece, piece)) ? [{ ...submission, id }] : []
    })
    .sort((a, b) => (b.sent ?? '').localeCompare(a.sent ?? '') || b.at - a.at)
}

/** What came back, as the tracker knows it: one it doesn't is still waiting. */
export const answerOf = (submission: Submission): Answer => (ANSWERS as readonly string[]).includes(submission.answer ?? '') ? (submission.answer as Answer) : 'waiting'

/** Each answer in words. */
export const ANSWER_WORDS: Record<Answer, string> = { waiting: 'Waiting', more: 'Asked for more', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', silent: 'No answer' }

/** Still to hear back on: waiting, or asked for more. */
export const pending = (submission: Submission) => answerOf(submission) === 'waiting' || answerOf(submission) === 'more'

/** The day to follow up on, suggested: 90 days after `sent`. */
export function followUpAfter(sent: string): string {
  const [year, month, day] = sent.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 90)).toISOString().slice(0, 10)
}

/** As the whole list has them: those still waiting first, the soonest follow-up first, then the rest, newest sent first. */
export function inOrder<T extends Submission>(list: T[]): T[] {
  const due = (one: T) => one.followUp ?? '9999'
  return [...list].sort((a, b) => Number(pending(b)) - Number(pending(a)) || (pending(a) ? due(a).localeCompare(due(b)) : 0) || (b.sent ?? '').localeCompare(a.sent ?? ''))
}

/** Why the Plus sheet opened, when the tracker was asked for without it. */
export const SUBMISSIONS_PLUS = 'Keeping track of where your writing has been sent, and when to follow up, is part of Nib Plus.'

// ---------------------------------------------------------------------------
// This device's.

const KEY = 'nib-submissions'

/** Sent on the window when they're changed here, for sync to send them soon (sync/session). */
export const SUBMISSIONS_CHANGED = 'nib-submissions-changed'

let submissions: Submissions = asSubmissions(readJson<unknown>(KEY, null)) ?? {}
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useSubmissions = () => useSyncExternalStore(subscribe, () => submissions)
export const readSubmissions = () => submissions

/** Kept, in their one order, and with storage off, kept for this session. `here`: changed on this device, so said for sync. */
function keep(next: Submissions, here: boolean) {
  submissions = asSubmissions(next)!
  writeJson(KEY, submissions)
  listeners.forEach((listener) => listener())
  if (here) window.dispatchEvent(new Event(SUBMISSIONS_CHANGED))
}

/** A backup's, in place of this device's (lib/backup putBack). */
export function replaceSubmissions(next: Submissions) {
  keep(next, false)
}

/** Another device's, merged with this one's, as sync brings them. */
export function takeInSubmissions(there: Submissions) {
  const both = mergeSubmissions(submissions, there)
  if (JSON.stringify(both) !== JSON.stringify(submissions)) keep(both, false)
}

type Changes = { [K in Own]?: string | null }

/** Each of `changes` set, or taken off for null; one left out stays as it is. Anything that isn't one is as none. */
function changed(submission: Submission, changes: Changes): Submission {
  const next: Submission = { ...submission, at: Date.now() }
  for (const own of Object.keys(OWN) as Own[]) {
    const value = changes[own] === undefined || changes[own] === null ? changes[own] : (OWN[own](changes[own]) ?? null)
    if (value === null) delete next[own]
    else if (value !== undefined) next[own] = value
  }
  return next
}

/** A new submission of `piece`. Answers its id. */
export function addSubmission(piece: Piece, changes: Changes): string {
  const id = crypto.randomUUID()
  keep({ ...submissions, [id]: changed({ at: 0, piece }, changes) }, true)
  return id
}

/** One's own changed: nothing if it's gone. */
export function changeSubmission(id: string, changes: Changes) {
  const was = live(submissions[id])
  if (was) keep({ ...submissions, [id]: changed(was, changes) }, true)
}

/**
 * A book's go with its folder when that's renamed or moved (lib/folders): each
 * is of the book by its folder's name, and left under the old one it would be
 * of no book, its follow-up naming one that's gone, till another folder took
 * the name. `named`: what a folder is called now, itself if it's unchanged,
 * null if it's removed, which leaves its book's as they are.
 */
export function rebook(named: (folder: string) => string | null) {
  const next = { ...submissions }
  for (const [id, one] of Object.entries(submissions)) {
    const was = live(one)
    const now = was && 'book' in was.piece ? named(was.piece.book) : null
    if (was && 'book' in was.piece && now !== null && now !== was.piece.book) next[id] = { ...was, at: Date.now(), piece: { book: now } }
  }
  if (Object.keys(next).some((id) => next[id] !== submissions[id])) keep(next, true)
}

/** One taken off, kept gone. */
export function removeSubmission(id: string) {
  if (live(submissions[id])) keep({ ...submissions, [id]: { at: Date.now(), gone: true } }, true)
}
