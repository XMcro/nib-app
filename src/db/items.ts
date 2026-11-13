import Dexie from 'dexie'
import type { JSONContent } from '@tiptap/react'
import { db, type Category, type Goal, type Item, type Kind, type Placed, type Reminder, type Revision, type ShareRef, type Vault } from './db'
import * as revisions from './revisions'
import { attachedIn, hasAttachment, keptApart } from '../lib/attachment'
import { letGo } from '../lib/fileUse'
import { filesIn } from '../lib/image'
import { localDay } from '../lib/time'
import * as vault from '../lib/vault'

/**
 * The only module that touches the database. If records ever carry ciphertext,
 * the encrypt/decrypt boundary goes here and nowhere else.
 */

/**
 * History is a recovery convenience; the body is the user's actual data and is
 * already committed by the time any of these run. Letting a revision write fail
 * the save would report a loss that did not happen — and would leave the
 * caller's tracked version stale, so the next save would force a spurious
 * "overwritten" snapshot and spend more of the quota that just ran out.
 */
async function tryRecord(...args: Parameters<typeof revisions.record>): Promise<void> {
  try {
    await revisions.record(...args)
  } catch (error) {
    console.error('Nib: could not record a revision', error)
  }
}

/** Bumped by every write of any kind, or sync never sends it. */
export const nextRev = (item?: Item) => (item?.rev ?? 0) + 1

const bumping = (change: (item: Item) => void) => (item: Item) => {
  change(item)
  item.rev = nextRev(item)
}

/** Writes to one record, and returns how many it matched. */
function touch(id: string, change: (item: Item) => void): Promise<number> {
  return db.items.where('id').equals(id).modify(bumping(change))
}

/** One record, or several in a single write, so the lists redraw once and not once each. */
function each(ids: string | string[], change: (item: Item) => void): Promise<number> {
  return typeof ids === 'string' ? touch(ids, change) : db.items.where('id').anyOf(ids).modify(bumping(change))
}

/** Newest first, trashed records excluded. Both kinds at once: `sortOut`, or this reads the whole library for each. */
export async function list(kind: Kind): Promise<Item[]> {
  return sortOut(await listAll())[kind === 'note' ? 'notes' : 'pages']
}

/** Trashed records of both kinds, most recently trashed first. */
export async function listTrash(): Promise<Item[]> {
  const found = await db.items.filter((item) => item.deletedAt !== undefined).toArray()
  return found.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
}

/**
 * What `list('note')`, `list('page')` and `listTrash` give, in their orders,
 * from one read of every record (`listAll`). For App's live lists: as three
 * queries, they read the whole library twice over after every save. The
 * archive and the templates (lib/templates) are apart from the lists.
 */
export function sortOut(all: Item[]): { notes: Item[]; pages: Item[]; trash: Item[]; archived: Item[]; templates: Item[] } {
  const notes: Item[] = []
  const pages: Item[] = []
  const trash: Item[] = []
  const archived: Item[] = []
  const templates: Item[] = []
  for (const item of all) {
    if (item.deletedAt !== undefined) trash.push(item)
    // Left out as the [kind+updatedAt] index leaves them out: no time, no place in the list.
    else if (typeof item.updatedAt !== 'number' || Number.isNaN(item.updatedAt)) continue
    else if (item.template === true) templates.push(item)
    else if (typeof item.archivedAt === 'number') archived.push(item)
    else if (item.kind === 'note') notes.push(item)
    else if (item.kind === 'page') pages.push(item)
  }
  // The index, reversed: newest first, and of two at once, the later id.
  const newest = (a: Item, b: Item) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  notes.sort(newest)
  pages.sort(newest)
  archived.sort(newest)
  templates.sort(newest)
  trash.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
  return { notes, pages, trash, archived, templates }
}

export function get(id: string): Promise<Item | undefined> {
  return db.items.get(id)
}

/**
 * `id` and `createdAt` are for a capture from the inbox (lib/inbox): it keeps
 * the id it was given there, so saving it twice after a crash finds it saved,
 * and the time it was written rather than the time it was opened.
 */
/**
 * `updatedAt` and `pinnedAt` are for imports, which bring their own; a new
 * document has neither. `folder` and `categories`: what the library was
 * showing when it was written (lib/folders).
 */
export async function create(
  kind: Kind,
  body: JSONContent,
  {
    id = crypto.randomUUID(),
    createdAt,
    updatedAt,
    pinnedAt,
    folder,
    categories,
    deviceOnly,
    template,
  }: { id?: string; createdAt?: number; updatedAt?: number; pinnedAt?: number; folder?: string; categories?: Category[]; deviceOnly?: boolean; template?: boolean } = {},
): Promise<string> {
  const now = createdAt ?? Date.now()
  await db.items.add({
    id,
    kind,
    body,
    version: 1,
    rev: 1,
    createdAt: now,
    updatedAt: updatedAt ?? now,
    ...(pinnedAt ? { pinnedAt } : {}),
    ...(folder ? { folder } : {}),
    ...(categories?.length ? { categories } : {}),
    ...(deviceOnly ? { deviceOnly: true as const } : {}),
    ...(template ? { template: true as const } : {}),
  })
  await tryRecord(id, body, { now: updatedAt ?? now })
  return id
}

/**
 * Many documents at once, an import's, each with its first version, as `create`
 * makes them: in one transaction, so the library is read and drawn once for
 * them all rather than again for each.
 */
export async function createMany(documents: { kind: Kind; body: JSONContent; id: string; createdAt?: number; updatedAt?: number; pinnedAt?: number; archivedAt?: number; folder?: string; categories?: Category[] }[]): Promise<void> {
  const at = Date.now()
  const rows: Item[] = documents.map(({ kind, body, id, createdAt = at, updatedAt, pinnedAt, archivedAt, folder, categories }) => ({
    id,
    kind,
    body,
    version: 1,
    rev: 1,
    createdAt,
    updatedAt: updatedAt ?? createdAt,
    ...(pinnedAt ? { pinnedAt } : {}),
    ...(archivedAt ? { archivedAt } : {}),
    ...(folder ? { folder } : {}),
    ...(categories?.length ? { categories } : {}),
  }))
  await db.transaction('rw', db.items, db.revisions, async () => {
    await db.items.bulkAdd(rows)
    await db.revisions.bulkAdd(rows.map(({ id, body, updatedAt }) => ({ id: crypto.randomUUID(), itemId: id, body, createdAt: updatedAt })))
  })
}

/** Thrown by `update` for text opened unlocked, saved after its document was locked elsewhere. */
export class LockedElsewhere extends Error {
  constructor() {
    super('This document was locked elsewhere.')
    this.name = 'LockedElsewhere'
  }
}

/**
 * Thrown by `lock`, `unlock` and `reseal` for a document changed since its
 * text was read, by sync most often, before anything is written. Read it
 * again and retry: written, the text read would replace the change.
 */
export class ChangedSince extends Error {
  constructor() {
    super('This document changed while it was being sealed.')
    this.name = 'ChangedSince'
  }
}

/**
 * History is a property of saving, so recording lives here rather than in the
 * UI. Restoring passes `record: false` because it manages both sides of the
 * history itself — otherwise this write would coalesce into, and destroy, the
 * snapshot taken of the draft being replaced.
 *
 * `wasLocked`: whether the text was opened from a locked document. Opened
 * unlocked, into a document locked since, the save is refused with
 * LockedElsewhere, as the lock wins (sync/engine), and the caller keeps the
 * text as a copy (`addCopy`).
 */
export async function update(
  id: string,
  body: JSONContent,
  { record = true, expectedVersion, wasLocked }: { record?: boolean; expectedVersion?: number; wasLocked?: boolean } = {},
): Promise<number> {
  let version = 0
  let overwritten: JSONContent | undefined
  // The same, locked: no history to keep it in, so it becomes a locked copy.
  let overwrittenSeal: Vault | undefined

  // A locked document is sealed before it is stored, and keeps no history:
  // a version kept in the clear would undo the lock.
  const current = await db.items.get(id)
  if (current?.vault && wasLocked === false) throw new LockedElsewhere()
  const locked = current?.vault ? await vault.seal(id, body, current.vault.salt) : null
  if (locked) record = false

  // `modify` reports how many records it matched. Discarding that count would
  // let a write to a record deleted in another tab resolve as a success, and
  // the library would keep claiming "Stored on this device" while every
  // keystroke went nowhere.
  const touched = await touch(id, (item) => {
    // Someone else wrote since this editor was seeded — most often the same
    // document open in a second tab. Which text the user wants is not ours
    // to decide, but the copy about to be replaced must not simply vanish.
    if (expectedVersion !== undefined && item.version !== expectedVersion) {
      if (!locked) overwritten = item.body
      else if (item.vault) overwrittenSeal = item.vault
    }
    if (locked) {
      item.vault = locked
      item.body = vault.LOCKED_BODY
    } else item.body = body
    item.updatedAt = Date.now()
    item.version += 1
    version = item.version
  })
  if (touched === 0) throw new Error(`Nib: cannot save, item ${id} no longer exists`)

  if (overwrittenSeal) await addCopy(current!.kind, { vault: overwrittenSeal, from: id })
  if (overwritten) {
    await revisions.recordPair(id, overwritten, record ? body : null, 0, tryRecord)
  } else if (record) {
    await tryRecord(id, body)
  }
  return version
}

/** Puts every one of them in a category, or takes them all out of it, by any case of its name. Like a folder: `rev` moves, `version` and `updatedAt` don't. */
export async function fileInCategory(ids: string[], category: Category, on: boolean): Promise<void> {
  await each(ids, (item) => {
    const others = (item.categories ?? []).filter((had) => had.name.toLocaleLowerCase() !== category.name.toLocaleLowerCase())
    item.categories = on ? [...others, category] : others
  })
}

/** Moves to the trash. Nothing is destroyed until it is purged. */
export async function remove(ids: string | string[]): Promise<void> {
  await each(ids, (item) => {
    item.deletedAt = Date.now()
  })
}

export async function setPinned(ids: string | string[], pinned: boolean): Promise<void> {
  await each(ids, (item) => {
    if (pinned) item.pinnedAt = Date.now()
    else delete item.pinnedAt
  })
}

/** Into the archive, or back out of it. Like a goal: `rev` moves, `version` and `updatedAt` don't. */
export async function setArchived(ids: string | string[], on: boolean): Promise<void> {
  await each(ids, (item) => {
    item.archivedAt = on ? Date.now() : null
  })
}

/**
 * Changes the body of a document that isn't the one being written, in one
 * write: `change` is given the body as it's stored and gives the new one, or
 * null to leave it. An edit like any other (`version`, `updatedAt`, `rev`),
 * with no version of its own kept in the history. Never a locked, a read-only
 * or a trashed one. Open in another window, that window's next save finds the
 * version moved on and keeps this body in its history, as for any two edits.
 */
export async function amend(id: string, change: (body: JSONContent) => JSONContent | null): Promise<void> {
  await db.items.where('id').equals(id).modify((item) => {
    if (item.vault || item.readOnly || item.deletedAt) return
    const body = change(item.body)
    if (!body) return
    item.body = body
    item.updatedAt = Date.now()
    item.version += 1
    item.rev = nextRev(item)
  })
}

/**
 * Its words can't be changed until this is taken off. Like a goal: `rev`
 * moves, `version` and `updatedAt` don't. A copy (`duplicate`) is free of it.
 */
export async function setReadOnly(id: string, on: boolean): Promise<void> {
  await touch(id, (item) => {
    item.readOnly = on ? true : null
  })
}

/**
 * Like a pin: `rev` moves so sync sends it, `version` and `updatedAt` don't,
 * so it can't look like an edit. Removing stores null; see `Item.goal`.
 */
export async function setGoal(id: string, goal: Goal | null): Promise<void> {
  await touch(id, (item) => {
    item.goal = goal
  })
}

/** Kept on this device only, or synced again (db Item.deviceOnly). `rev` moves, so the next pass takes it off the server or sends it out; `version` and `updatedAt` don't. */
export async function setDeviceOnly(id: string, on: boolean): Promise<void> {
  await touch(id, (item) => {
    item.deviceOnly = on ? true : null
  })
  // Its pictures' originals come off the server with it, and stay here.
  const item = on ? await db.items.get(id) : undefined
  if (item) await letGo(filesIn(item.body).map((file) => file.id))
}

/** Its reminder (lib/reminders), or null for none. Like a goal: `rev` moves, so sync sends it to the other devices to ring; `version` and `updatedAt` don't. */
export async function setReminder(id: string, reminder: Reminder | null): Promise<void> {
  await touch(id, (item) => {
    item.reminder = reminder
  })
}

/** The day it moves itself to the trash (lib/expiry), or null for none. Like a goal: `rev` moves, `version` and `updatedAt` don't. */
export async function setExpiry(id: string, day: string | null): Promise<void> {
  await touch(id, (item) => {
    item.expires = day
  })
}

/** The document's shared drafts. Like a goal: `rev` moves, `version` and `updatedAt` don't. */
export async function setShares(id: string, shares: ShareRef[]): Promise<void> {
  await touch(id, (item) => {
    item.shares = shares
  })
}

/** Into a folder, or out of one with null. Like a goal: `rev` moves, `version` and `updatedAt` don't. */
export async function setFolder(ids: string | string[], folder: string | null): Promise<void> {
  await each(ids, (item) => {
    // A place in one manuscript means nothing in another: it goes in at the end.
    const moved = item.folder?.toLocaleLowerCase() !== folder?.toLocaleLowerCase()
    if (moved && typeof item.position === 'number') item.position = null
    item.folder = folder
  })
}

/** Pages' places in their manuscript (lib/manuscript), all at once. Like a folder: `rev` moves, `version` and `updatedAt` don't. */
export async function setPositions(places: { id: string; position: number }[]): Promise<void> {
  const at = new Map(places.map(({ id, position }) => [id, position]))
  await db.items
    .where('id')
    .anyOf([...at.keys()])
    .modify(
      bumping((item) => {
        item.position = at.get(item.id)
      }),
    )
}

/**
 * A folder or category renamed, recoloured or removed: `change` made to every
 * document `applies` to, the trash included, so one put back is filed as
 * the rest. Like a goal: `rev` moves, `version` and `updatedAt` don't.
 */
export async function refile(applies: (item: Item) => boolean, change: (item: Item) => void): Promise<void> {
  await db.items.filter(applies).modify(bumping(change))
}

/** The stamps put on the document (lib/placed); an empty list for none. Like its categories: `rev` moves, `version` and `updatedAt` don't. */
export async function setStamps(id: string, stamps: Placed[]): Promise<void> {
  await touch(id, (item) => {
    item.stamps = stamps
  })
}

/** The document's categories; an empty list for none. Like a goal: `rev` moves, `version` and `updatedAt` don't. */
export async function setCategories(id: string, categories: Category[]): Promise<void> {
  await touch(id, (item) => {
    item.categories = categories
  })
}

export async function restore(id: string): Promise<void> {
  await touch(id, (item) => {
    delete item.deletedAt
    // Back without an expiry date that has come (lib/expiry), or it would go straight back. One still to come stays.
    if (item.expires && item.expires <= localDay(Date.now())) item.expires = null
  })
}

/** Irreversible, and takes the document's history with it. */
export async function purge(id: string): Promise<void> {
  await db.items.delete(id)
  await revisions.removeFor(id)
}

export async function purgeAll(): Promise<void> {
  const trashed = await listTrash()
  await Promise.all(trashed.map((item) => purge(item.id)))
}

export async function duplicate(id: string): Promise<string | undefined> {
  const source = await get(id)
  // A locked document's text is sealed to its own id, so a copy can't share it.
  if (!source || vault.isLocked(source)) return undefined
  // Filed where the original is, or it would leave the folder being shown. Without its expiry date or its reminder: a copy has neither until it's given one.
  // And only on this device, if the original is: a copy that synced would send its words where it was kept from.
  return create(source.kind, source.body, { folder: source.folder ?? undefined, categories: source.categories, deviceOnly: source.deviceOnly === true })
}

/**
 * A copy of the document `id` kept as a template (lib/templates): its words,
 * and none of its folder, categories, reminder, expiry date or shares. Only on
 * this device if the original is, as a duplicate is. Not of a locked one,
 * whose text is sealed to its own id.
 */
export async function saveAsTemplate(id: string): Promise<string | undefined> {
  const source = await get(id)
  if (!source || vault.isLocked(source)) return undefined
  return create(source.kind, source.body, { template: true, deviceOnly: source.deviceOnly === true })
}

/**
 * A new document from the template `id` (lib/templates): its words and kind,
 * filed as `filed` says, and only on this device if the template is. None
 * from a locked template, whose words are sealed, or from what isn't one.
 */
export async function fromTemplate(id: string, filed: { folder?: string; categories?: Category[] } = {}): Promise<string | undefined> {
  const source = await get(id)
  if (!source || source.template !== true || vault.isLocked(source)) return undefined
  return create(source.kind, source.body, { ...filed, deviceOnly: source.deviceOnly === true })
}

/**
 * Into the vault: the text sealed with the open vault's key, the body left
 * empty, and every past version deleted, here and, by sync, everywhere.
 * `expectedVersion`: the version `body` was read at (ChangedSince).
 */
export async function lock(id: string, body: JSONContent, expectedVersion?: number): Promise<void> {
  // Its text would be sealed, and its attachments left in the clear beside the library: asked for only once they're out (useOpenDocument lockCurrent).
  if (hasAttachment(body)) throw new Error('Nib: a document with attachments is not locked')
  const sealed = await vault.seal(id, body)
  await db.transaction('rw', [db.items, db.revisions], async () => {
    await unchanged(id, expectedVersion)
    const touched = await touch(id, (item) => {
      item.vault = sealed
      item.body = vault.LOCKED_BODY
      item.updatedAt = Date.now()
      item.version += 1
    })
    if (touched === 0) throw new Error(`Nib: cannot lock, item ${id} no longer exists`)
    await revisions.removeFor(id)
  })
  // Sealed without its pictures' originals (vault.seal): their files go too, from here and from the server.
  await letGo(filesIn(body).map((file) => file.id))
}

/** Out of the vault: `body`, already opened at `expectedVersion`, stored in the clear again. */
export async function unlock(id: string, body: JSONContent, expectedVersion?: number): Promise<void> {
  const touched = await db.transaction('rw', db.items, async () => {
    await unchanged(id, expectedVersion)
    return touch(id, (item) => {
      item.vault = null
      item.body = body
      item.updatedAt = Date.now()
      item.version += 1
    })
  })
  if (touched === 0) throw new Error(`Nib: cannot unlock, item ${id} no longer exists`)
  await tryRecord(id, body)
}

async function unchanged(id: string, expectedVersion: number | undefined) {
  if (expectedVersion === undefined) return
  const item = await db.items.get(id)
  if (item && item.version !== expectedVersion) throw new ChangedSince()
}

/** `item` with its text, opened from the vault if it is locked; null while the vault is shut to it. */
export async function opened(item: Item): Promise<Item | null> {
  if (!vault.isLocked(item)) return item
  // A copy from sync opens once the vault has sealed it (answerVault).
  if (!item.vault) return null
  const body = await vault.unseal(item.id, item.vault).catch(() => null)
  return body ? { ...item, body } : null
}

/**
 * A new passcode: each locked document resealed (lib/vault `changePasscode`)
 * from the seals in `from`. `updatedAt` moves, so in sync it counts as a
 * change against an edit elsewhere. Any locked document changed or locked
 * since, and nothing is written (ChangedSince): its new seal would hold the
 * text before the change, or it would be left under the old passcode.
 */
export async function reseal(sealed: Map<string, Vault>, from?: { id: string; vault: Vault }[]): Promise<void> {
  await db.transaction('rw', db.items, async () => {
    if (from) {
      const read = new Map(from.map((item) => [item.id, item.vault.sealed]))
      const now = await db.items.filter((item) => Boolean(item.vault)).toArray()
      if (now.length !== read.size || now.some((item) => read.get(item.id) !== item.vault!.sealed)) throw new ChangedSince()
    }
    for (const [id, next] of sealed) {
      await touch(id, (item) => {
        item.vault = next
        item.updatedAt = Date.now()
      })
    }
  })
}

/**
 * An edit a lock beat (sync/engine, or a save refused with LockedElsewhere),
 * kept as a locked document of its own: made here, and not sent until
 * `sealCopies` seals it under its own id, the next time the vault opens here.
 * Text is boxed (lib/vault `box`), or kept as it is if it can't be: in the
 * clear, but not lost. What the edit had attached, which a locked document
 * can't hold, is kept in an unlocked note of its own (lib/attachment
 * `keptApart`). `here`: both are this device's only.
 */
export async function addCopy(kind: Kind, unsealed: NonNullable<Item['unsealed']>, here = false): Promise<string> {
  const id = crypto.randomUUID()
  const now = Date.now()
  const only = here ? { deviceOnly: true as const } : {}
  const attached = 'body' in unsealed ? attachedIn(unsealed.body) : []
  if (attached.length) await db.items.add({ id: crypto.randomUUID(), kind: 'note', body: keptApart(attached), version: 1, rev: 1, createdAt: now, updatedAt: now, ...only })
  // Not inside a transaction (sync's pull), which an await on WebCrypto
  // would end: the caller boxes once it is done (`boxCopies`).
  if ('body' in unsealed && !Dexie.currentTransaction) unsealed = await boxed(id, unsealed.body)
  await db.items.add({ id, kind, body: vault.LOCKED_BODY, version: 1, rev: 1, createdAt: now, updatedAt: now, unsealed, ...only })
  return id
}

async function boxed(id: string, body: JSONContent): Promise<NonNullable<Item['unsealed']>> {
  try {
    return { box: await vault.box(id, body) }
  } catch (error) {
    console.warn('Nib: could not box a copy', error)
    forgetBoxed()
    return { body }
  }
}

/** Left once no copy in the clear is left, so a launch needn't read the whole library to find none. */
const ALL_BOXED = 'nib-copies-boxed'

function forgetBoxed() {
  try {
    localStorage.removeItem(ALL_BOXED)
  } catch {
    /* storage blocked: the launch look just happens again */
  }
}

/** `boxCopies`, at launch: once, and again only if a copy couldn't be boxed since. */
export async function boxCopiesOnce(): Promise<void> {
  let done = false
  try {
    done = localStorage.getItem(ALL_BOXED) !== null
  } catch {
    /* storage blocked: look */
  }
  if (done) return
  if (!(await boxCopies())) return
  try {
    localStorage.setItem(ALL_BOXED, '1')
  } catch {
    /* looked at again next launch */
  }
}

/** Boxes the copies an earlier Nib kept in the clear, or one that couldn't be boxed then. False if one couldn't be boxed. */
export async function boxCopies(): Promise<boolean> {
  for (const copy of await db.items.filter((item) => item.unsealed !== undefined && 'body' in item.unsealed).toArray()) {
    const unsealed = await boxed(copy.id, (copy.unsealed as { body: JSONContent }).body)
    if ('body' in unsealed) return false
    // Bumped: the mirror goes by `rev`, and a copy in the clear must not stay in its file.
    await touch(copy.id, (item) => {
      if (item.unsealed && 'body' in item.unsealed) item.unsealed = unsealed
    })
  }
  return true
}

/**
 * Seals the copies sync made of edits a lock beat (Item `unsealed`), under
 * their own ids, with the open vault's key: from the text, or from a seal
 * still bound to the note it came from. A copy whose seal this vault can't
 * open waits for one that can. Sealed, a copy is an ordinary locked note, and
 * sync sends it.
 */
export async function sealCopies(): Promise<void> {
  for (const copy of await db.items.filter((item) => item.unsealed !== undefined).toArray()) {
    const pending = copy.unsealed!
    const body =
      'box' in pending
        ? await vault.unbox(copy.id, pending.box)
        : 'body' in pending
          ? pending.body
          : await vault.unseal(pending.from, pending.vault).catch(() => null)
    if (!body) continue
    const sealed = await vault.seal(copy.id, body)
    await touch(copy.id, (item) => {
      item.vault = sealed
      delete item.unsealed
      item.version += 1
    })
  }
}

/** `sealCopies`, if the vault is open to do it. */
export async function sealCopiesIfOpen(): Promise<void> {
  if (vault.vaultOpen()) await sealCopies()
}

/**
 * Forgets what sync last sent and received, and moves its epoch, so that a
 * pass under way meanwhile writes nothing more (sync/engine `fence`). Inside
 * the caller's transaction, over syncRecords and syncMeta.
 */
export async function clearSyncState(): Promise<void> {
  const epoch = (await db.syncMeta.get('epoch'))?.v ?? 0
  await db.syncRecords.clear()
  await db.syncMeta.clear()
  await db.syncMeta.put({ k: 'epoch', v: epoch + 1 })
}

/** Every record, including trash. Used by the lossless backup. */
export function listAll(): Promise<Item[]> {
  return db.items.toArray()
}

/**
 * Replaces the database with an already-sanitized snapshot. The backup
 * module is the import boundary: it must run bodies through
 * `filterBodyImages` / `allowedImageSrc` before calling this.
 *
 * Sync's bookkeeping goes too, so a restore on a synced device merges with
 * the server as if joining afresh. Kept, it would read every document missing
 * from an old backup as deleted, and delete it on every other device.
 */
export async function replaceAll(nextItems: Item[], nextRevisions: Revision[]): Promise<void> {
  await db.transaction('rw', [db.items, db.revisions, db.syncRecords, db.syncMeta], async () => {
    await db.items.clear()
    await db.revisions.clear()
    await clearSyncState()
    await db.items.bulkPut(nextItems.map((item) => ({ ...item, rev: item.version })))
    await db.revisions.bulkPut(nextRevisions)
  })
}
