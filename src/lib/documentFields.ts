import type { JSONContent } from '@tiptap/react'
import type { Item, Revision } from '../db/db'
import { asShares } from '../share/crypto'
import { asCategories, asFolder } from './folders'
import { asGoal } from './documentGoal'
import { asExpiry } from './expiry'
import { asPosition } from './manuscript'
import { asPlaced } from './placed'
import { asReminder } from './reminders'
import { isTime } from './time'
import { asVault } from './vault'

/**
 * What a document carries, and how each field travels: through sync
 * (sync/engine) and in a backup (lib/backup). Keyed by Item, so a new field
 * doesn't compile until it says. Whether a copy keeps it (db/items
 * `duplicate`) is picked by hand there: decide that too.
 *
 * `read` checks the field arriving from outside, and every one means the same
 * by what it returns: `undefined` says nothing about the field (it isn't
 * there, or isn't one), `null` that it was removed, and `[]` that there are
 * none. `kept`: a document arriving without the field leaves this device's
 * alone, as it may be from a Nib from before it.
 */
type Field<T> = { sync: boolean; backup: boolean; read?: (raw: unknown) => T | undefined; kept?: true }

const BOTH = { sync: true, backup: true }
const BACKUP_ONLY = { sync: false, backup: true }
const THIS_DEVICE = { sync: false, backup: false }

const time = (raw: unknown) => (isTime(raw) ? raw : undefined)
const kept = <T>(read: (raw: unknown) => T | undefined): Field<T> => ({ ...BOTH, read, kept: true })
const asReadOnly = (raw: unknown) => (raw === true || raw === null ? raw : undefined)
const timeOrNull = (raw: unknown) => (raw === null ? null : time(raw))

/** In the order they are written: a backup's fields, and those read from outside, come out in it. */
const FIELDS: { [K in keyof Item]-?: Field<Item[K]> } = {
  // Every document has these, and sync and a backup each hold them to its own
  // rules (their `asItem`), which differ: a body of `{}` sync skips, and a
  // backup brings back as an empty document.
  id: BOTH,
  kind: BOTH,
  body: BOTH,
  // Each device counts its own.
  version: BACKUP_ONLY,
  createdAt: BOTH,
  updatedAt: BOTH,
  // Missing says it isn't trashed, or pinned: that is taken as it comes.
  deletedAt: { ...BOTH, read: time },
  pinnedAt: { ...BOTH, read: time },
  readOnly: kept(asReadOnly),
  archivedAt: kept(timeOrNull),
  template: kept(asReadOnly),
  expires: kept(asExpiry),
  reminder: kept(asReminder),
  // This device's to say (db Item.deviceOnly): in a backup of it, and never from another device.
  deviceOnly: { ...BACKUP_ONLY, read: asReadOnly },
  goal: kept(asGoal),
  shares: kept(asShares),
  vault: kept(asVault),
  folder: kept(asFolder),
  categories: kept(asCategories),
  position: kept(asPosition),
  stamps: kept(asPlaced),
  // Sent only once it is sealed, and then it's gone. A backup checks its own, whose text may hold pictures.
  unsealed: BACKUP_ONLY,
  rev: THIS_DEVICE,
}

const NAMES = Object.keys(FIELDS) as (keyof Item)[]

/**
 * The fields of a document arriving from outside, `by` sync or from a backup,
 * that have a `read` and travel that way: those it says anything about. One
 * that doesn't travel by sync isn't read from another device, whatever it sent.
 */
export function readFields(raw: object, by: 'sync' | 'backup'): Partial<Item> {
  const fields: Record<string, unknown> = {}
  for (const name of NAMES) {
    const value = FIELDS[name][by] ? FIELDS[name].read?.((raw as Record<string, unknown>)[name]) : undefined
    if (value !== undefined) fields[name] = value
  }
  return fields as Partial<Item>
}

/** Onto a document from another device: this device's own, of what it says nothing about. */
export function keepMissing(arrived: Item, local: Item | undefined) {
  for (const name of NAMES) {
    if (FIELDS[name].kept && arrived[name] === undefined && local?.[name] !== undefined) Object.assign(arrived, { [name]: local[name] })
  }
}

/** A document as sync sends it. */
export function forSync(item: Item): Partial<Item> {
  const sent: Partial<Item> = { ...item }
  for (const name of NAMES) if (!FIELDS[name].sync) delete sent[name]
  return sent
}

/** A document as a backup holds it. */
export function forBackup(item: Item): Item {
  const held: Record<string, unknown> = {}
  for (const name of NAMES) if (FIELDS[name].backup && item[name] !== undefined) held[name] = item[name]
  return held as unknown as Item
}

/** A past version arriving from outside, its body by the caller's own rules (`readBody`), as a document's is; null for anything that isn't one. */
export function readRevision(raw: unknown, readBody: (body: unknown) => JSONContent | null): Revision | null {
  const v = raw as Partial<Revision> | null
  if (!v || typeof v.id !== 'string' || !v.id || typeof v.itemId !== 'string' || !v.itemId || !isTime(v.createdAt)) return null
  const body = readBody(v.body)
  return body && { id: v.id, itemId: v.itemId, body, createdAt: v.createdAt }
}
