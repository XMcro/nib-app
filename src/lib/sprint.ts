import { useEffect, useReducer, useRef } from 'react'
import type { Item } from '../db/db'
import * as items from '../db/items'
import { count } from './counts'
import { readJson, writeJson } from './jsonStorage'
import { recount, SPRINT_KEY, tally, type Running } from './writtenHere'

const SPRINT_DONE_KEY = 'nib-sprint-done'

export const SPRINT_LENGTHS = [15, 25, 45]
export const SPRINTS_PLUS = 'Sprints are part of Nib Plus, with a calendar of your writing days.'
export const MAX_SPRINT_MINUTES = 240

function forget(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing to forget.
  }
}

export type Sprint = { endsAt: number; written: number }
export type SprintDone = { minutes: number; written: number }

/**
 * Sprints: a set length of writing, then a quiet summary. Counted by the same
 * rules as the day, across every document. Kept in storage so a relaunch
 * picks one up where it was, and a sprint that ends while Nib is in the
 * background shows its summary on return.
 */
export function useSprint(documents: Item[], flush: () => Promise<void>) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    recount.add(rerender)
    return () => {
      recount.delete(rerender)
    }
  }, [])

  // Read on every render, like the day: `startedHere` writes to it directly.
  const running = readJson<Running | null>(SPRINT_KEY, null)
  const done = readJson<SprintDone | null>(SPRINT_DONE_KEY, null)
  let sprint: Sprint | null = null
  if (running) {
    const { total, grew } = tally(documents, running.base)
    if (grew) writeJson(SPRINT_KEY, running)
    sprint = { endsAt: running.endsAt, written: total }
  }

  // What's on screen may be up to a save behind, so both ends of a sprint
  // save first and count from the database.
  async function saved(): Promise<Item[]> {
    await flush()
    const { notes, pages } = items.sortOut(await items.listAll())
    return [...notes, ...pages]
  }

  async function start(minutes: number) {
    count('sprint_started')
    const length = Math.max(1, Math.min(MAX_SPRINT_MINUTES, Math.round(minutes)))
    const base: Record<string, number> = {}
    tally(await saved(), base)
    const now = Date.now()
    writeJson(SPRINT_KEY, { startedAt: now, endsAt: now + length * 60_000, base })
    forget(SPRINT_DONE_KEY)
    rerender()
  }

  async function finish() {
    const ending = readJson<Running | null>(SPRINT_KEY, null)
    if (!ending) return
    const documents = await saved()
    // Ended by the other caller while this one was saving.
    if (readJson<Running | null>(SPRINT_KEY, null)?.startedAt !== ending.startedAt) return
    const minutes = Math.max(1, Math.round((Math.min(Date.now(), ending.endsAt) - ending.startedAt) / 60_000))
    writeJson(SPRINT_DONE_KEY, { minutes, written: tally(documents, ending.base).total })
    forget(SPRINT_KEY)
    rerender()
  }

  function dismiss() {
    forget(SPRINT_DONE_KEY)
    rerender()
  }

  // A timer that comes due while Nib is in the background fires on return.
  // The latest `finish` through a ref: the timer belongs to the sprint, not
  // to whichever render set it.
  const finishing = useRef(finish)
  finishing.current = finish
  const endsAt = running?.endsAt
  useEffect(() => {
    if (endsAt === undefined) return
    const timer = setTimeout(() => void finishing.current(), Math.max(0, endsAt - Date.now()))
    return () => clearTimeout(timer)
  }, [endsAt])

  return { sprint, done, start, stop: finish, dismiss }
}
