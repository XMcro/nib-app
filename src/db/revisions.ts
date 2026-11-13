import Dexie from 'dexie'
import type { JSONContent } from '@tiptap/react'
import { db, type Revision } from './db'

/**
 * How far back History reaches without Nib Plus. Older versions are kept, not
 * deleted, and show again with Plus: nothing here is ever trimmed.
 */
export const FREE_DAYS = 30

/** Edits within this window fold into the revision that opened it. */
export const COALESCE_MS = 5 * 60_000

function forItem(itemId: string) {
  return db.revisions
    .where('[itemId+createdAt]')
    .between([itemId, Dexie.minKey], [itemId, Dexie.maxKey])
}

/** Newest first. */
export async function list(itemId: string): Promise<Revision[]> {
  return forItem(itemId).reverse().toArray()
}

/** Newest first and `limit` of them: History's, a page at a time. */
export function latest(itemId: string, limit: number): Promise<Revision[]> {
  return forItem(itemId).reverse().limit(limit).toArray()
}

/** When each version was made, newest first. From the index, reading no text. */
export async function times(itemId: string): Promise<number[]> {
  return ((await forItem(itemId).reverse().keys()) as unknown as [string, number][]).map(([, at]) => at)
}

export async function newest(itemId: string): Promise<Revision | undefined> {
  return forItem(itemId).reverse().first()
}

/**
 * Saves fire every few hundred milliseconds, so a revision per save would be
 * useless noise. Edits made close together update the revision that opened the
 * window — keeping its original timestamp, so the window really does expire.
 */
export async function record(
  itemId: string,
  body: JSONContent,
  { now = Date.now(), force = false }: { now?: number; force?: boolean } = {},
): Promise<void> {
  const latest = await newest(itemId)
  // Never store the same text twice in a row.
  if (latest && JSON.stringify(latest.body) === JSON.stringify(body)) return
  // The one to fold into is the newest stamped no later than now. One stamped
  // later, by a device whose clock runs fast, would otherwise take in every
  // save here until that time came.
  const open = latest && latest.createdAt > now ? await forItem(itemId).and((one) => one.createdAt <= now).last() : latest
  // `force` starts a fresh revision regardless — used before restoring, so the
  // draft being replaced is always recoverable.
  if (!force && open && now - open.createdAt < COALESCE_MS) {
    await db.revisions.update(open.id, { body })
    return
  }
  await db.revisions.add({ id: crypto.randomUUID(), itemId, body, createdAt: now })
}

/**
 * Both sides of a text replaced, each a version of its own: the `loser`, then
 * the `winner`, if it is to be kept, a millisecond later. `earlier`: how far
 * behind the clock they may be stamped. `write`: how each is stored.
 */
export async function recordPair(itemId: string, loser: JSONContent, winner: JSONContent | null, earlier = 0, write = record): Promise<void> {
  // Stamped strictly after every revision already stored. Records written in
  // the same millisecond tie in the [itemId+createdAt] index and come back in
  // random-uuid order, which lets the history panel label the other tab's
  // text "Current" and offer to restore the text already in the document. Only the forced pair needs this; an ordinary save either
  // coalesces or appends, so it cannot tie.
  const last = await newest(itemId)
  const at = Math.max(Date.now() - earlier, (last?.createdAt ?? 0) + 1)
  await write(itemId, loser, { force: true, now: at })
  // Forced too, or the coalesce window would fold this straight into the
  // snapshot just taken and destroy the very text it preserved.
  if (winner) await write(itemId, winner, { force: true, now: at + 1 })
}

export async function removeFor(itemId: string): Promise<void> {
  await db.revisions.bulkDelete(await forItem(itemId).primaryKeys())
}

/** Every revision, across every document. Used by the lossless backup. */
export function listAll(): Promise<Revision[]> {
  return db.revisions.toArray()
}
