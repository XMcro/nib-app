import { useEffect, useRef } from 'react'
import type { Item } from '../db/db'
import { readFolderSettings, settingOf, type FolderSettings } from './folderSettings'
import { filingOf, split } from './folders'
import { streakRecord } from './goal'
import { inbox } from './inbox'
import { bookOf, partsOf } from './manuscript'
import { touchApp } from './platform'
import { countWords } from './stats'
import { plainText } from './text'
import { localDay } from './time'
import { isLocked } from './vault'
import { nameOf } from './fountain'
import type { Entitlement } from './plus'

/**
 * What the widgets and Shortcuts read (Nib Plus, iPhone and iPad). They
 * can't read the library, so the app leaves them a snapshot in the App Group
 * (ios/App/App/NibSnapshot.swift) each time it leaves the front, which is
 * when a widget can be seen. It holds today's words and the daily goal, the
 * goal's run of days, the books with their words and goals, and the pinned
 * and recent notes with their first lines.
 *
 * The words are the day's as the app last saw them, with the day they were
 * on: a widget shows none once that day is over, so it starts afresh at
 * midnight without Nib.
 *
 * Never a locked document, nor its words in a book's count. While Lock Nib is
 * on, no books or notes at all (NibInboxPlugin.swift), only the day's
 * numbers: a title on the Home Screen would be one shown past the lock.
 * Without Plus there's no snapshot, and the widgets say they're with it.
 */

export const WIDGETS_PLUS = 'Widgets for your daily goal, your streak, a book and a pinned note are part of Nib Plus.'

export type WidgetBook = { folder: string; title: string; words: number; goal?: number; deadline?: string }
export type WidgetNote = { id: string; kind: Item['kind']; title: string; lines: string; pinned: boolean; readOnly: boolean }
export type Snapshot = { day: string; words: number; goal: number; streakDay: string; streak: number; books: WidgetBook[]; notes: WidgetNote[]; locked: false; until?: number }

const BOOKS = 20
const PINNED = 10
const RECENT = 10
const TITLE = 120
const LINES = 280
/** A title at its length, by whole characters: half an emoji is a file Swift won't read, and the app then keeps no snapshot at all. */
const cut = (title: string) => [...title].slice(0, TITLE).join('')

/**
 * The books a widget can show, the one written in last first: each folder
 * with pages in it, and each folder those are in, as its Manuscript has them
 * (lib/manuscript partsOf), with its words, a locked chapter's not counted.
 */
export function booksOf(documents: Item[], settings: FolderSettings): WidgetBook[] {
  const latest = new Map<string, { folder: string; at: number }>()
  const touch = (folder: string, at: number) => {
    const key = folder.toLocaleLowerCase()
    const known = latest.get(key)
    if (!known || at > known.at) latest.set(key, { folder: known?.folder ?? folder, at })
  }
  for (const item of documents) {
    const folder = filingOf(item).folder
    // Not a locked one, even with the vault open: a folder of only those is no book of the widgets'.
    if (item.kind !== 'page' || item.deletedAt !== undefined || isLocked(item) || !folder) continue
    touch(folder, item.updatedAt)
    const { parent } = split(folder)
    if (parent !== null) touch(parent, item.updatedAt)
  }
  return [...latest.values()]
    // A part's page is written in its book too: the book first.
    .sort((a, b) => b.at - a.at || a.folder.length - b.folder.length)
    .slice(0, BOOKS)
    .map(({ folder }) => {
      const words = partsOf(documents, folder)
        .flatMap((part) => part.chapters)
        .filter((item) => !isLocked(item))
        .reduce((sum, item) => sum + countWords(plainText(item.body)), 0)
      const goal = settingOf(settings, folder)?.goal
      return { folder, title: cut(bookOf(folder, settings).title), words, ...(goal && { goal: goal.words, ...(goal.deadline && { deadline: goal.deadline }) }) }
    })
}

/** One the widgets may show: in the lists, not locked, and with a title to be picked by. */
const shown = (item: Item) => !isLocked(item) && typeof item.archivedAt !== 'number' && item.template !== true && item.deletedAt === undefined && nameOf(item) !== 'Untitled'

/** The notes and pages a widget or Shortcuts can pick: the pinned ones, then the ten edited last. */
export function notesOf(documents: Item[]): WidgetNote[] {
  const candidates = documents.filter(shown)
  const pinned = candidates.filter((item) => item.pinnedAt).sort((a, b) => b.pinnedAt! - a.pinnedAt!).slice(0, PINNED)
  const recent = candidates.filter((item) => !pinned.includes(item)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT)
  return [...pinned, ...recent].map((item) => {
    const lines = plainText(item.body).split('\n').map((line) => line.trim()).filter(Boolean).slice(1).join('\n')
    return { id: item.id, kind: item.kind, title: cut(nameOf(item)), lines: [...lines].slice(0, LINES).join(''), pinned: Boolean(item.pinnedAt), readOnly: Boolean(item.readOnly) }
  })
}

export function snapshotOf(documents: Item[], words: number, goal: number, now: number, settings: FolderSettings = readFolderSettings()): Snapshot {
  const streak = streakRecord()
  return { day: localDay(now), words, goal, streakDay: streak.last, streak: streak.count, books: booksOf(documents, settings), notes: notesOf(documents), locked: false }
}

/** A subscription renews with Nib shut as often as open: its snapshot is good this long past the period Nib last saw, and a month's renewal is well inside it. */
const RENEWAL_GRACE = 35 * 86_400_000

/**
 * When Nib Plus ends as far as is known now, for the snapshot's `until`: the
 * end of Plus days from coins, exactly; of a subscription, the end of its
 * period, with time to renew unless it's been cancelled. Null if it isn't
 * known. The widgets show nothing of the library past it (NibSnapshot.swift):
 * Nib can't take the snapshot away while it's shut.
 */
export const plusEnds = (subscription: Pick<Entitlement, 'active' | 'expiresAt' | 'willRenew'>, pointsUntil: number | null): number | null =>
  subscription.active ? (subscription.expiresAt ? subscription.expiresAt + (subscription.willRenew === false ? 0 : RENEWAL_GRACE) : null) : pointsUntil

/**
 * Leaves the widgets their snapshot as Nib leaves the front, and once the
 * library's read; or takes it away once it's known there's no Plus.
 */
export function useWidgets({ documents, words, goal, plus, plusKnown, ready, until }: { documents: Item[]; words: number; goal: number; plus: boolean; plusKnown: boolean; ready: boolean; until: number | null }) {
  const latest = useRef({ documents, words, goal })
  latest.current = { documents, words, goal }
  useEffect(() => {
    if (!touchApp || !ready || !plusKnown) return
    // Asked for inside the promise: where the plugin is missing (tests), that's a warning and not the app down.
    const send = () =>
      void Promise.resolve()
        .then(() => inbox.widgets(plus ? { snapshot: JSON.stringify({ ...snapshotOf(latest.current.documents, latest.current.words, latest.current.goal, Date.now()), ...(until !== null && { until }) }) } : {}))
        .catch((error: unknown) => console.warn('Nib: could not leave the widgets what they show', error))
    send()
    if (!plus) return
    const onHidden = () => document.visibilityState === 'hidden' && send()
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [plus, plusKnown, ready, until])
}
