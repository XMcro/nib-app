import type { Item } from '../db/db'
import { readJson, writeJson } from './jsonStorage'
import { countWords } from './stats'
import { plainText } from './text'
import { localDay } from './time'

/** What counts as written here, for the day and for a sprint under way. */

const DAY_KEY = 'nib-goal-day'
export const SPRINT_KEY = 'nib-sprint'

/** What each document held when the day began, keyed by id. */
type Day = { day: string; base: Record<string, number> }
/** A sprint under way: what each document held when it began, as for a day. */
export type Running = { startedAt: number; endsAt: number; base: Record<string, number> }

// Counted once a body, as its text is (lib/text): the day's count runs on
// every render, over every document.
const counted = new WeakMap<object, number>()
function wordsIn(body: Item['body']): number {
  if (typeof body !== 'object' || body === null) return 0
  let words = counted.get(body)
  if (words === undefined) counted.set(body, (words = countWords(plainText(body))))
  return words
}

/**
 * Words beyond where each document stood in `base`, never below zero —
 * cutting a paragraph is editing, not unwriting. A document not in `base` yet
 * joins it as it stands, so one imported, duplicated or arriving by sync
 * counts nothing. Says whether `base` grew, for the caller to store; and,
 * given `each`, puts in it each document's words that count, by id.
 */
export function tally(documents: Item[], base: Record<string, number>, each?: Map<string, number>): { total: number; grew: boolean } {
  let total = 0
  let grew = false
  for (const item of documents) {
    const words = wordsIn(item.body)
    if (!(item.id in base)) {
      base[item.id] = words
      grew = true
    }
    const written = Math.max(0, words - base[item.id])
    total += written
    if (written > 0) each?.set(item.id, written)
  }
  return { total, grew }
}

/**
 * Words written today: each document's words now, less what it held when Nib
 * first saw it today. "First saw" rather than "was created": a document first
 * seen already written is not a day's writing. One started in the editor
 * counts from nothing (see `startedHere`). `each`, if given, gets each
 * document's share, by id (lib/writingStats recordFolders).
 */
export function wordsToday(documents: Item[], now: number, each?: Map<string, number>): number {
  const today = localDay(now)
  const stored = readJson<Day>(DAY_KEY, { day: '', base: {} })
  const day: Day = stored.day === today ? stored : { day: today, base: {} }
  const { total, grew } = tally(documents, day.base, each)
  if (grew || day !== stored) writeJson(DAY_KEY, day)
  return total
}

/**
 * A document the writer has just started in the editor. It is first saved
 * only when they pause, so it would otherwise be first seen with its opening
 * words already in it; this counts it from nothing, for the day and for a
 * sprint under way. Overwrites, in case the count ran first.
 */
export function startedHere(id: string, now = Date.now()) {
  const today = localDay(now)
  const stored = readJson<Day>(DAY_KEY, { day: '', base: {} })
  const day: Day = stored.day === today ? stored : { day: today, base: {} }
  day.base[id] = 0
  writeJson(DAY_KEY, day)
  const sprint = readJson<Running | null>(SPRINT_KEY, null)
  if (sprint) {
    sprint.base[id] = 0
    writeJson(SPRINT_KEY, sprint)
  }
  // The count usually runs the moment the save lands, before this does.
  recount.forEach((listener) => listener())
}

/**
 * Words a document gained or lost without being written here: synced in from
 * another device, or hidden and shown again by a lock. Where today counts from
 * (and a sprint under way) moves by as much, so neither count moves. A
 * document not counted yet needs nothing: it joins at whatever it holds.
 */
export function notWrittenHere(id: string, words: number, now = Date.now()) {
  const day = readJson<Day>(DAY_KEY, { day: '', base: {} })
  if (day.day === localDay(now) && id in day.base) {
    day.base[id] += words
    writeJson(DAY_KEY, day)
  }
  const sprint = readJson<Running | null>(SPRINT_KEY, null)
  if (sprint && id in sprint.base) {
    sprint.base[id] += words
    writeJson(SPRINT_KEY, sprint)
  }
  recount.forEach((listener) => listener())
}

/** Who's told when the count moves without the documents changing. */
export const recount = new Set<() => void>()
