import Dexie, { type Table } from 'dexie'
import type { JSONContent } from '@tiptap/react'
import { BATCH_BYTES, BATCH_RECORDS } from '../../worker/wire.mjs'
import { db, type Item, type Kind, type Revision, type SyncRecord } from '../db/db'
import * as items from '../db/items'
import * as revisions from '../db/revisions'
import { COALESCE_MS } from '../db/revisions'
import { forSync, keepMissing, readFields, readRevision } from '../lib/documentFields'
import { isTime } from '../lib/time'
import { asCollection, emptyCollection, mergedWith, takeIn } from '../lib/collection'
import { asFolderSettings, mergeFolderSettings, readFolderSettings, takeInFolderSettings } from '../lib/folderSettings'
import { asSavedLooks, mergeSavedLooks, readSavedLooks, takeInSavedLooks } from '../lib/look'
import { sendFiles } from '../lib/fileQueue'
import { letGo } from '../lib/fileUse'
import { filesIn, filterBodyImages, originalsIn, wellFormed } from '../lib/image'
import { countWords } from '../lib/stats'
import { plainText } from '../lib/text'
import { isLocked, LOCKED_BODY } from '../lib/vault'
import { SyncHttpError, type Api, type Wire } from './api'
import { open, recordKey, seal, type SyncKeys } from './crypto'

/**
 * One sync pass: pull what other devices changed, apply it, push what this
 * device changed. The server only compares-and-sets opaque records, so every
 * merge decision is made here, and the rule is the one Nib already uses for
 * two tabs: the newer edit stays current, and the other is kept in history.
 * Nothing is ever dropped.
 */

type ItemPayload = Omit<Item, 'version' | 'rev'>
/**
 * `gone`: a delete's seal, which only a device holding the sync code can make.
 * `n`: a document's versions, and its delete, count up (see `next`); a Nib
 * from before counts sends none. `b`: the count of the version it was made
 * over, if any, which a Nib from before sends none of either.
 */
type Payload = { t: 'item'; v: ItemPayload; n?: number; b?: number } | { t: 'revision'; v: Revision } | { t: 'gone'; n?: number; b?: number } | { t: 'stamps'; v: unknown } | { t: 'folders'; v: unknown } | { t: 'looks'; v: unknown }

/**
 * The stamps (lib/collection), all in one record of their own. A Nib from
 * before stamps synced takes no notice of it: it applies only items and
 * revisions, and never sends a record it doesn't know.
 */
const STAMPS = 'collection'

/** The folders' settings (lib/folderSettings), all in one record of their own, as the stamps are, and as unknown to a Nib from before them. */
const FOLDERS = 'folders'
/** The saved looks (lib/look), the same way. */
const LOOKS = 'looks'

// A revision still inside its coalesce window may be rewritten in place, so it
// is only sent once the window has closed. The live text travels with its item.
const SETTLE_MS = COALESCE_MS + 60_000
const DAY_MS = 86_400_000
/**
 * How far back the server keeps a document's history: past this, a version
 * is on the devices that have it and nowhere else (expireHistory), so a sync
 * code found later opens no more of it than this.
 */
export const SERVER_HISTORY_MS = 90 * DAY_MS
const MAX_ROUNDS = 3

/**
 * `tooLarge`: how many documents are too big to send at all. They stay on this
 * device. `copies`: how many edits a lock beat were kept as copies (see copy).
 * `moved`: the words each document gained (or lost) by what was applied, for
 * the daily goal to leave out (lib/writtenHere `notWrittenHere`).
 */
export type PassResult = { changed: string[]; full: boolean; tooLarge: number; copies: number; moved: Map<string, number> }
/** `left`: the originals named by documents here that a lock arriving has sealed without them (lib/fileUse). */
type Made = { copies: number; moved: Map<string, number>; left: string[] }

const wordsIn = (body: JSONContent) => countWords(plainText(body))

const pairKey = (type: SyncRecord['type'], id: string) => `${type}:${id}`

/**
 * The count for a document's next version: on from the last one this device
 * has had, and from the clock at least, so a device that has lost what it
 * knew (a backup restored, sync turned off and on) still counts past the
 * versions it no longer knows of.
 */
const next = (n: number | undefined, now: number) => Math.max((n ?? 0) + 1, now)

async function cursor(): Promise<number> {
  return (await db.syncMeta.get('cursor'))?.v ?? 0
}

/**
 * Thrown when this device's sync state was reset (sync turned off or on, a
 * backup restored) while a pass was under way. The pass stops there, having
 * written nothing since: no old cursor, no records of what the server held
 * before, nothing pulled over a restored note.
 */
export class SyncReset extends Error {}

const epoch = async () => (await db.syncMeta.get('epoch'))?.v ?? 0

/** First in every transaction that writes what sync knows (db/items `clearSyncState` moves the epoch). */
async function fence(started: number) {
  if ((await epoch()) !== started) throw new SyncReset('This device’s sync state was reset during a pass.')
}

/** A transaction that writes what sync knows, fenced. */
function fenced(started: number, tables: Table[], work: () => Promise<void>) {
  return db.transaction('rw', tables, async () => {
    await fence(started)
    await work()
  })
}

/**
 * A document from another device, its pictures checked; null for anything
 * that isn't one. `typeof null` is 'object', and a body that threw here used
 * to stop every pull after it, so a record without one is skipped instead.
 */
function asBody(value: unknown): JSONContent | null {
  // Odd inside is dropped node by node (filterBodyImages); odd as a whole is no document.
  if (!wellFormed(value)) return null
  try {
    return filterBodyImages(value as JSONContent)
  } catch {
    return null // a shape no Nib writes
  }
}

/**
 * As a backup takes them (lib/backup): a record it would refuse, taken here,
 * would make every later backup, and the app's file, fail to restore.
 */

function asItem(value: unknown): ItemPayload | null {
  const v = value as Partial<ItemPayload> | null
  if (!v || typeof v.id !== 'string' || !v.id || (v.kind !== 'note' && v.kind !== 'page')) return null
  if (!isTime(v.createdAt) || !isTime(v.updatedAt)) return null
  const body = asBody(v.body)
  if (!body) return null
  return {
    id: v.id,
    kind: v.kind as Kind,
    body,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    ...readFields(v, 'sync'),
  }
}

const sameBody = (a: JSONContent, b: JSONContent) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Both sides of a conflict, kept as items.update keeps them: the losing text,
 * then the winning text a millisecond later, both forced and stamped after
 * every revision already stored. Without the winner, the loser would be the
 * newest revision: History would call it "Current", and the next save here
 * would fold into it and replace it. The winner is stamped now where it can
 * be, not a millisecond ahead: a save in that millisecond would take it for a
 * fast clock's and fold into the loser instead. A locked winner keeps no history.
 */
async function recordConflict(id: string, loser: JSONContent, winner: JSONContent, winnerLocked: boolean) {
  await revisions.recordPair(id, loser, winnerLocked ? null : winner, 1)
}

/** An edit a lock beat, kept as a locked document of its own (db/items `addCopy`). */
async function copy(kind: Kind, unsealed: NonNullable<Item['unsealed']>, made: Made) {
  await items.addCopy(kind, unsealed)
  made.copies += 1
}

/** The same, of an edit to a document kept on this device only: the copy is this device's only too. */
async function copyHere(kind: Kind, unsealed: NonNullable<Item['unsealed']>, made: Made) {
  await items.addCopy(kind, unsealed, true)
  made.copies += 1
}

/** Pull every page of changes and apply them. Returns the ids of items that changed. */
async function pull(keys: SyncKeys, api: Api, made: Made, started: number): Promise<string[]> {
  const changed = new Set<string>()
  const strays: Stray[] = []
  for (let more = true; more; ) {
    const page = await api.changes(await cursor())
    more = page.more
    // Decrypt first: a Dexie transaction commits the moment it awaits
    // anything that is not Dexie, and WebCrypto is not.
    const decoded = await Promise.all(
      page.records.map(async (record) => {
        if (!record.p) return { record, payload: null }
        try {
          return { record, payload: (await open(keys, record.k, record.p)) as Payload }
        } catch (error) {
          console.error('Nib: a synced record could not be opened, skipping it', error)
          return { record, payload: null }
        }
      }),
    )
    await fenced(started, [db.items, db.revisions, db.syncRecords, db.syncMeta], async () => {
      for (const { record, payload } of decoded) {
        const id = await apply(record, payload, made, strays)
        if (id) changed.add(id)
      }
      await db.syncMeta.put({ k: 'cursor', v: page.seq })
    })
    // Copies are kept as text inside the transaction, which boxing would end.
    if (made.copies) await items.boxCopies()
    // Nor are files deleted inside it. A locked document keeps no originals, on any device.
    await letGo(made.left.splice(0))
  }
  if (strays.length) {
    await fenced(started, [db.items, db.revisions, db.syncRecords, db.syncMeta], async () => {
      for (const { k, seq, revision } of strays) await takeRevision(k, seq, revision)
    })
  }
  return [...changed]
}

type Stray = { k: string; seq: number; revision: Revision }

/** Another device's past version of a document here. A locked document keeps no history, not even another device's. */
async function takeRevision(k: string, seq: number, revision: Revision) {
  const owner = await db.items.get(revision.itemId)
  if (!owner) return
  if (!owner.vault && !(await db.revisions.get(revision.id))) await db.revisions.put(revision)
  await db.syncRecords.put({ k, type: 'revision', id: revision.id, seq })
}

/** How a record from the server stands against what this device has had under its key (apply). */
type Standing = { k: string; seq: number; known: SyncRecord | undefined; count: number | undefined; uncounted: boolean; forked: boolean; n: number }

/**
 * A version, or a delete, counted no higher than one this device has
 * already had: the server handing back the past. It is refused, and what
 * this device has goes back up over it (no `rev` a document has, so
 * outgoing sends it; or, if gone here, its delete), unless it is held.
 */
async function refuse(known: SyncRecord, seq: number) {
  await db.syncRecords.put(known.held ? { ...known, seq } : { ...known, seq, rev: undefined, deleted: false })
  return null
}

/** Applies one remote record inside the pull transaction. Returns an item id if its document changed. */
async function apply(record: Wire, payload: Payload | null, made: Made, strays: Stray[]): Promise<string | null> {
  const seq = record.s!
  const known = await db.syncRecords.get(record.k)
  if (known && known.seq >= seq) return null // our own push, coming back

  const count = payload?.t === 'item' || payload?.t === 'gone' ? payload.n : undefined
  if (known?.type === 'item' && Number.isFinite(count) && count! <= (known.n ?? 0)) return refuse(known, seq)
  // One with no count is from a Nib before counts, still taken until every
  // device counts. But once this device has had a counted version, it could
  // be the server playing back one from before counts: a version no newer
  // than this device's is taken as a conflict (below), and a delete only
  // moves the document to the Trash.
  const uncounted = known?.type === 'item' && (known.n ?? 0) > 0 && !Number.isFinite(count)
  // Made over a version older than one this device has had: the server kept
  // this device's from the device that made it, which an honest one, there
  // being a newer version, refuses. Taken as a conflict (below), and as a
  // delete, the edit here wins. A device that knows nothing of a document
  // yet, new, rejoined or restored, has nothing to check against, and takes
  // what the server gives it.
  const over = payload?.t === 'item' || payload?.t === 'gone' ? payload.b : undefined
  const forked = known?.type === 'item' && Number.isFinite(over) && over! < (known.n ?? 0)
  const n = Math.max(known?.n ?? 0, Number.isFinite(count) ? count! : 0)
  const standing: Standing = { k: record.k, seq, known, count, uncounted, forked, n }

  if (record.d) return applyDelete(standing, payload?.t === 'gone')
  if (payload?.t === 'revision') return applyRevision(standing, payload.v, strays)
  if (payload?.t === 'stamps') return applyStamps(standing, payload.v)
  if (payload?.t === 'folders') return applyFolders(standing, payload.v)
  if (payload?.t === 'looks') return applyLooks(standing, payload.v)
  if (payload?.t === 'item') return applyItem(standing, payload.v, made)
  return null
}

/** A record deleted on the server. `withSeal`: its delete came sealed. */
async function applyDelete({ k, seq, known, count, uncounted, forked, n }: Standing, withSeal: boolean): Promise<string | null> {
  if (known?.type === 'stamps' || known?.type === 'folders' || known?.type === 'looks') {
    // Never deleted by a device: sent up again, merged as ever (outgoing).
    await db.syncRecords.put({ ...known, seq, deleted: true })
    return null
  }

  // A delete of a document this device never knew under this key, since a
  // backup was restored, say. Its count is kept: a document here under the
  // key counts past it (outgoing), or the device that made it, its clock
  // running fast, could take that document for the past and delete it again.
  if (!known && Number.isFinite(count)) await db.syncMeta.put({ k: `gone ${k}`, v: count! })
  if (!known || known.deleted) return null
  // Sealed, it is another device's purge, carried out. Without a seal it
  // could be a Nib from before sealed deletes, or the server making one up,
  // which mustn't be able to destroy anything: the document only moves to
  // the Trash here, history and all, and is held, sent nowhere (outgoing).
  const sealed = withSeal && !uncounted
  if (known.type === 'revision') {
    if (sealed) await db.revisions.delete(known.id)
    await db.syncRecords.put({ ...known, seq, deleted: true, held: !sealed })
    return null
  }
  const local = await db.items.get(known.id)
  if (local && (local.rev !== known.rev || forked)) {
    // Deleted there, edited here since: the edit wins and goes back up.
    await db.syncRecords.put({ ...known, seq, n, ...(forked ? { rev: undefined } : {}) })
    return null
  }
  if (local && !sealed) {
    const rev = items.nextRev(local)
    await db.items.put({ ...local, deletedAt: local.deletedAt ?? Date.now(), version: local.version + 1, rev })
    await db.syncRecords.put({ ...known, seq, deleted: true, held: true, rev, n })
    return known.id
  }
  await items.purge(known.id)
  await db.syncRecords.put({ ...known, seq, deleted: true, n })
  return known.id
}

/** A past version from another device. */
async function applyRevision({ k, seq }: Standing, value: Revision, strays: Stray[]): Promise<null> {
  const revision = readRevision(value, asBody)
  if (!revision) return null
  // Of no document here: one arriving later in this pull, its history having
  // gone up before its latest version, or one purged, put back by the
  // server. Taken only if its document is here by the pull's end (pull).
  if (!(await db.items.get(revision.itemId))) {
    strays.push({ k, seq, revision })
    return null
  }
  await takeRevision(k, seq, revision)
  return null
}

/** The stamps (lib/collection) from another device. */
async function applyStamps({ k, seq }: Standing, value: unknown): Promise<null> {
  // Another device's, taken in with this one's; what's here and not there goes up (outgoing).
  const there = asCollection(value)
  if (!there) return null
  takeIn(there)
  await db.syncRecords.put({ k, type: 'stamps', id: STAMPS, seq, sum: JSON.stringify(there) })
  return null
}

/** The folders' settings (lib/folderSettings) from another device. */
async function applyFolders({ k, seq }: Standing, value: unknown): Promise<null> {
  // Merged with this device's, folder by folder; what's newer here goes up (outgoing).
  const there = asFolderSettings(value)
  if (!there) return null
  takeInFolderSettings(there)
  await db.syncRecords.put({ k, type: 'folders', id: FOLDERS, seq, sum: JSON.stringify(there) })
  return null
}

/** The saved looks (lib/look) from another device. */
async function applyLooks({ k, seq }: Standing, value: unknown): Promise<null> {
  // Merged with this device's, look by look; what's newer here goes up (outgoing).
  const there = asSavedLooks(value)
  if (!there) return null
  takeInSavedLooks(there)
  await db.syncRecords.put({ k, type: 'looks', id: LOOKS, seq, sum: JSON.stringify(there) })
  return null
}

/** A document from another device, merged with this device's. Returns its id if that changed here. */
async function applyItem({ k, seq, known, uncounted, forked, n }: Standing, value: ItemPayload, made: Made): Promise<string | null> {
  const remote = asItem(value)
  if (!remote) return null
  const local = await db.items.get(remote.id)
  // Kept on this device only: not taken back in. Another device had it, and
  // changed it before its removal reached it; an honest one then sends that
  // up over the removal. Its text is kept here, in this document's history,
  // or as a copy that is this device's only too where a lock is in the way;
  // and it's on the server again, so outgoing takes it off again.
  if (local?.deviceOnly) {
    if (remote.vault) {
      if (remote.vault.sealed !== local.vault?.sealed) await copyHere(local.kind, { vault: remote.vault, from: remote.id }, made)
    } else if (local.vault) {
      if (!sameBody(remote.body, LOCKED_BODY)) await copyHere(local.kind, { body: remote.body }, made)
    } else if (!sameBody(remote.body, local.body)) await recordConflict(local.id, remote.body, local.body, false)
    await db.syncRecords.put({ k, type: 'item', id: remote.id, seq, rev: known?.rev, n })
    return null
  }
  // Without a count: not to bring back a document purged here. Made over a
  // version older than this device's, or without a count and no newer, it
  // is taken as a conflict with this device's version, which is sent back up
  // whichever stays: kept, but kept out, whether an edit made meanwhile or
  // one the server is playing back.
  if (uncounted && !local) return refuse(known!, seq)
  const contested = local !== undefined && (forked || (uncounted && remote.updatedAt <= local.updatedAt))
  const dirty = local !== undefined && (local.rev !== known?.rev || contested)
  const base = contested ? undefined : known?.rev

  // The lock always wins, whichever edit is newer, and an edit it beats is
  // kept as a copy. A Nib from before `vault: null` sends no lock at all for
  // an unlocked document, so against a lock here its text is such an edit;
  // only the empty placeholder is an echo of the lock.
  const unlockedThere = remote.vault === null || (remote.vault === undefined && !sameBody(remote.body, LOCKED_BODY))
  if (local?.vault && unlockedThere && (dirty || remote.vault === undefined)) {
    if (!sameBody(remote.body, LOCKED_BODY)) await copy(local.kind, { body: remote.body }, made)
    // Sent back up, changed here or not, so the lock wins everywhere.
    await db.syncRecords.put({ k, type: 'item', id: remote.id, seq, n })
    return null
  }
  if (remote.vault && local && dirty && !local.vault) {
    if (!sameBody(local.body, LOCKED_BODY)) await copy(local.kind, { body: local.body }, made)
  } else if (remote.vault && local?.vault && dirty && remote.vault.sealed !== local.vault.sealed) {
    // Locked and changed on both: the newer stays, and the other is kept
    // sealed as it came, bound to this document's id until resealed.
    if (remote.updatedAt <= local.updatedAt) {
      await copy(local.kind, { vault: remote.vault, from: remote.id }, made)
      await db.syncRecords.put({ k, type: 'item', id: remote.id, seq, rev: base, n })
      return null
    }
    await copy(local.kind, { vault: local.vault, from: local.id }, made)
  } else if (local && dirty && remote.updatedAt <= local.updatedAt) {
    // Both changed, and this device's edit is newer: it stays, the other
    // device's text goes into history, and this device's version goes up
    // against the sequence it now knows about.
    if (!sameBody(remote.body, local.body)) {
      await recordConflict(remote.id, remote.body, local.body, Boolean(local.vault))
    }
    await db.syncRecords.put({ k, type: 'item', id: remote.id, seq, rev: base, n })
    return null
  }
  const rev = items.nextRev(local)
  // `version` moves too, so an editor holding the old text notices on its next save.
  const item: Item = { ...remote, version: (local?.version ?? 0) + 1, rev }
  // A Nib from before goals, shares, folders, manuscripts and stamps drops those fields when it
  // saves, so their absence leaves this device's alone. Removing a goal or a
  // folder sends null, and the last share, category or stamp an empty list.
  keepMissing(item, local)
  if (local && dirty && !item.vault && !sameBody(remote.body, local.body)) {
    // Both changed, and the other device's edit is newer: keep this one in history.
    await recordConflict(local.id, local.body, remote.body, false)
  }
  // A lock arriving takes this device's history of the document with it, and its pictures' originals. Not
  // what was attached to it here: a locked document was sealed without any, so those are an edit the lock
  // beat, on this device or another, and kept in a note of their own (db/items `addCopy`) which may not
  // have reached this one yet. Named by nothing in the end, they're cleared as any unused file is (lib/fileUse).
  if (item.vault) await revisions.removeFor(remote.id)
  if (item.vault && local) made.left.push(...originalsIn(local.body).map((file) => file.id))
  if (local) made.moved.set(remote.id, (made.moved.get(remote.id) ?? 0) + wordsIn(item.body) - wordsIn(local.body))
  await db.items.put(item)
  await db.syncRecords.put({ k, type: 'item', id: remote.id, seq, rev, n })
  return remote.id
}

type Outgoing = { wire: Wire; record: SyncRecord }

/**
 * Everything that differs from what the server last acknowledged; `known`, what it has (none: a library just made, fill).
 * One at a time, sealed as it's asked for: a first sync's whole backlog, sealed
 * and padded, was too much to hold in memory on an older iPhone.
 */
async function* outgoing(keys: SyncKeys, now: number, known: SyncRecord[]): AsyncGenerator<Outgoing> {
  const byPair = new Map(known.map((record) => [pairKey(record.type, record.id), record]))

  // Keys, not bodies: the [id+rev] index answers "what changed" on its own.
  const itemKeys = (await db.items.orderBy('[id+rev]').keys()) as unknown as [string, number][]
  const localItems = new Set<string>()
  // Kept on this device only (Item.deviceOnly): never sent, and what the
  // server has of them, their history too, is taken off it as a document
  // purged here is, sealed. Every one is met below: marking one moves its
  // `rev`, so it differs from what the server was last sent; and once it's
  // off the server its record is a deleted one, read each time.
  const deviceOnly = new Set<string>()
  // Sealed, so other devices can tell it from a delete the server made up.
  const gone = async (record: SyncRecord): Promise<Outgoing> => {
    const n = next(record.n, now)
    const over = record.n === undefined ? {} : { b: record.n }
    return { wire: { k: record.k, b: record.seq, d: 1, p: await seal(keys, record.k, { t: 'gone', n, ...over }) }, record: { ...record, deleted: true, n } }
  }
  for (const [id, rev] of itemKeys) {
    localItems.add(id)
    const synced = byPair.get(pairKey('item', id))
    if (synced && !synced.deleted && synced.rev === rev) continue
    // In the Trash after a delete without a seal, and untouched since: this
    // device's alone. Restored (or changed), it goes back up over the delete.
    if (synced?.held && synced.rev === rev) continue
    const item = await db.items.get(id)
    if (item?.deviceOnly) {
      deviceOnly.add(id)
      if (synced && !synced.deleted) yield gone(synced)
      continue
    }
    // A copy is sent once it is sealed (see copy).
    if (!item || item.unsealed) continue
    const k = synced?.k ?? (await recordKey(keys, 'item', id))
    // `null` rather than missing when unlocked: missing reads as a Nib from
    // before locks, which apply() can't take as an unlock.
    const v = { ...forSync(item), vault: item.vault ?? null }
    const over = synced?.n ?? (await db.syncMeta.get(`gone ${k}`))?.v
    const n = next(over, now)
    // Its pictures' originals follow it (sync/files): a locked one names none.
    sendFiles(filesIn(item.body).map((file) => file.id))
    yield {
      wire: { k, b: synced?.seq ?? 0, p: await seal(keys, k, { t: 'item', v, n, ...(over === undefined ? {} : { b: over }) }) },
      record: { k, type: 'item', id, seq: 0, rev: item.rev, n },
    }
  }

  const localRevisions = new Set<string>()
  const settled: string[] = []
  await db.revisions.orderBy('[itemId+createdAt]').eachKey((key, cursor) => {
    const id = cursor.primaryKey as string
    // The history of one kept on this device only: as if it weren't here, so not sent, and taken off the server (below).
    if (deviceOnly.has((key as [string, number])[0])) return
    localRevisions.add(id)
    const createdAt = (key as [string, number])[1]
    const synced = byPair.get(pairKey('revision', id))
    // History held after a delete without a seal stays on this device.
    // Past what the server keeps, it isn't sent at all (after a restore, say).
    if ((!synced || (synced.deleted && !synced.held)) && createdAt < now - SETTLE_MS && createdAt >= now - SERVER_HISTORY_MS) settled.push(id)
  })
  for (const id of settled) {
    const revision = await db.revisions.get(id)
    if (!revision) continue
    // Never the history of a locked document.
    const owner = await db.items.get(revision.itemId)
    if (owner && isLocked(owner)) continue
    const synced = byPair.get(pairKey('revision', id))
    const k = synced?.k ?? (await recordKey(keys, 'revision', id))
    yield {
      wire: { k, b: synced?.seq ?? 0, p: await seal(keys, k, { t: 'revision', v: revision }) },
      record: { k, type: 'revision', id, seq: 0 },
    }
  }

  // The stamps, whenever this device has any the server's copy hasn't. With
  // that copy, always: storage off here, it would otherwise go up with less.
  const sent = byPair.get(pairKey('stamps', STAMPS))
  const stamps = mergedWith(sent?.sum ? asCollection(JSON.parse(sent.sum)) : null)
  const sum = JSON.stringify(stamps)
  if (!emptyCollection(stamps) && (!sent || sent.deleted || sent.sum !== sum)) {
    const k = sent?.k ?? (await recordKey(keys, 'stamps', STAMPS))
    yield { wire: { k, b: sent?.seq ?? 0, p: await seal(keys, k, { t: 'stamps', v: stamps }) }, record: { k, type: 'stamps', id: STAMPS, seq: 0, sum } }
  }

  // The folders' settings, the same way: whenever this device has any newer than the server's copy.
  const sentFolders = byPair.get(pairKey('folders', FOLDERS))
  const onServer = sentFolders?.sum ? asFolderSettings(JSON.parse(sentFolders.sum)) : undefined
  const folders = onServer ? mergeFolderSettings(readFolderSettings(), onServer) : readFolderSettings()
  const foldersSum = JSON.stringify(folders)
  if (Object.keys(folders).length > 0 && (!sentFolders || sentFolders.deleted || sentFolders.sum !== foldersSum)) {
    const k = sentFolders?.k ?? (await recordKey(keys, 'folders', FOLDERS))
    yield { wire: { k, b: sentFolders?.seq ?? 0, p: await seal(keys, k, { t: 'folders', v: folders }) }, record: { k, type: 'folders', id: FOLDERS, seq: 0, sum: foldersSum } }
  }

  // The saved looks, the same way.
  const sentLooks = byPair.get(pairKey('looks', LOOKS))
  const looksOnServer = sentLooks?.sum ? asSavedLooks(JSON.parse(sentLooks.sum)) : undefined
  const looks = looksOnServer ? mergeSavedLooks(readSavedLooks(), looksOnServer) : readSavedLooks()
  const looksSum = JSON.stringify(looks)
  if (Object.keys(looks).length > 0 && (!sentLooks || sentLooks.deleted || sentLooks.sum !== looksSum)) {
    const k = sentLooks?.k ?? (await recordKey(keys, 'looks', LOOKS))
    yield { wire: { k, b: sentLooks?.seq ?? 0, p: await seal(keys, k, { t: 'looks', v: looks }) }, record: { k, type: 'looks', id: LOOKS, seq: 0, sum: looksSum } }
  }

  for (const record of known) {
    if (record.deleted || record.type === 'stamps' || record.type === 'folders' || record.type === 'looks') continue
    if (record.type === 'item' ? localItems.has(record.id) : localRevisions.has(record.id)) continue
    yield gone(record)
  }
}

/** Under the server's limits; a record past them alone in its batch. */
async function* batches(records: AsyncIterable<Outgoing>) {
  let batch: Outgoing[] = []
  let bytes = 0
  for await (const record of records) {
    const size = record.wire.p?.length ?? 0
    if (batch.length > 0 && (batch.length >= BATCH_RECORDS || bytes + size > BATCH_BYTES)) {
      yield batch
      batch = []
      bytes = 0
    }
    batch.push(record)
    bytes += size
  }
  if (batch.length > 0) yield batch
}

/** One batch to the server: what it said of each record, and each record by its key. Null for a record too big to send. */
async function sendBatch(api: Api, batch: Outgoing[]) {
  let results
  try {
    ;({ results } = await api.push(batch.map((entry) => entry.wire)))
  } catch (error) {
    // A batch over the server's size limit is always a single record
    // (batches): one document too big to send. Skip it rather than let it hold
    // back everything queued behind it.
    if (error instanceof SyncHttpError && error.status === 413 && batch.length === 1) return null
    throw error
  }
  return { results, byKey: new Map(batch.map((entry) => [entry.wire.k, entry.record])) }
}

/** Push in batches. Returns whether anything conflicted, whether the library is full, and what was too big to send. */
async function push(api: Api, records: AsyncIterable<Outgoing>, started: number): Promise<{ conflicts: boolean; full: boolean; tooLarge: number }> {
  let conflicts = false
  let full = false
  let tooLarge = 0
  const pulled = await cursor()
  for await (const batch of batches(records)) {
    // Before sending, too: a restore landing while `outgoing` read mixed what
    // sync knew from before it with documents from after it, and everything
    // written since the backup went out as deleted. Any read that saw the
    // restore came after it, so this one, after them all, sees it as well.
    await fence(started)
    const sent = await sendBatch(api, batch)
    if (!sent) {
      tooLarge++
      continue
    }
    const { results, byKey } = sent
    await fenced(started, [db.syncRecords, db.syncMeta], async () => {
      for (const result of results) {
        if ('s' in result) await db.syncRecords.put({ ...byKey.get(result.k)!, seq: result.s })
        else if ('conflict' in result) {
          conflicts = true
          // A conflict at a sequence this device has already pulled past is a
          // record it never learned about: deleted on the server before this
          // device's sync state began (a restored backup, a rejoin), or one it
          // could not open. There is nothing newer to merge, so write over it
          // next round rather than conflicting on it forever.
          if (result.conflict <= pulled) await db.syncRecords.put({ ...byKey.get(result.k)!, seq: result.conflict, deleted: true })
        } else full = true
      }
    })
  }
  return { conflicts, full, tooLarge }
}

export async function syncOnce(keys: SyncKeys, api: Api, now = Date.now()): Promise<PassResult> {
  const changed = new Set<string>()
  const made: Made = { copies: 0, moved: new Map(), left: [] }
  const started = await epoch()
  let full = false
  let tooLarge = 0
  for (let round = 0; round < MAX_ROUNDS; round++) {
    for (const id of await pull(keys, api, made, started)) changed.add(id)
    const result = await push(api, outgoing(keys, now, await db.syncRecords.toArray()), started)
    full ||= result.full
    tooLarge = result.tooLarge
    // A conflict means someone else wrote first: pull their version, merge,
    // and push again. Bounded, because a device writing flat out could
    // otherwise keep this one chasing it; the next pass carries on.
    if (!result.conflicts) break
  }
  return { changed: [...changed], full, tooLarge, copies: made.copies, moved: made.moved }
}

/**
 * Asks the server, once a day, to let go of the versions here that have aged
 * past SERVER_HISTORY_MS. Not a delete: other devices keep theirs, and a new
 * one just isn't sent them. The server can't tell a version from a document,
 * so it's for a device to say.
 */
export async function expireHistory(api: Api, now = Date.now()): Promise<void> {
  const started = await epoch()
  if (now - ((await db.syncMeta.get('expired'))?.v ?? 0) < DAY_MS) return
  await db.syncMeta.put({ k: 'expired', v: now })
  const known = await db.syncRecords.where('[type+id]').between(['revision', Dexie.minKey], ['revision', Dexie.maxKey]).toArray()
  // From the index: a version's text isn't needed to know its age.
  const madeAt = new Map<string, number>()
  await db.revisions.orderBy('[itemId+createdAt]').eachKey((key, cursor) => madeAt.set(cursor.primaryKey as string, (key as [string, number])[1]))
  const aged: SyncRecord[] = []
  for (const record of known) {
    if (record.deleted || record.expired) continue
    const at = madeAt.get(record.id)
    if (at !== undefined && at < now - SERVER_HISTORY_MS) aged.push(record)
  }
  for (let at = 0; at < aged.length; at += BATCH_RECORDS) {
    const batch = aged.slice(at, at + BATCH_RECORDS)
    await fence(started)
    await api.expire(batch.map((record) => record.k))
    await fenced(started, [db.syncRecords, db.syncMeta], async () => {
      await db.syncRecords.bulkPut(batch.map((record) => ({ ...record, expired: true })))
    })
  }
}

/**
 * A library just made for a new code (sync/changeLibrary), given
 * everything here as a first pass would send it: every document, sealed
 * under the new code's keys, and the history the server keeps. What sync
 * knows here is left the old library's, so a failure on the way changes
 * nothing. Returns what the new library holds, for `adopt`.
 */
export async function fill(keys: SyncKeys, api: Api, now = Date.now()): Promise<SyncRecord[]> {
  const filled: SyncRecord[] = []
  for await (const batch of batches(outgoing(keys, now, []))) {
    const sent = await sendBatch(api, batch)
    // Too big to send at all, as to the old library: it stays here (push).
    if (!sent) continue
    const { results, byKey } = sent
    for (const result of results) {
      if (!('s' in result)) throw new Error('error' in result ? 'Your sync storage is full: the new library can’t hold everything.' : 'The new library already holds something.')
      filled.push({ ...byKey.get(result.k)!, seq: result.s })
    }
  }
  return filled
}

/**
 * What sync knows here, made a filled library's (fill) in one go, so the
 * first pass with it sends only what changed since, not everything again.
 */
export async function adopt(filled: SyncRecord[]): Promise<void> {
  await db.transaction('rw', db.syncRecords, db.syncMeta, async () => {
    await items.clearSyncState()
    await db.syncRecords.bulkPut(filled)
    // Everything it holds came from here: no other device has its code yet.
    await db.syncMeta.put({ k: 'cursor', v: filled.reduce((top, record) => Math.max(top, record.seq), 0) })
  })
}

/** Forget everything sync knew, so the next pass merges afresh. Documents are untouched. */
export async function resetSyncState(): Promise<void> {
  await db.transaction('rw', db.syncRecords, db.syncMeta, () => items.clearSyncState())
}
