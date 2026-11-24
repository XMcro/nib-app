import type { JSONContent } from '@tiptap/react'
import type { Item, Revision } from '../db/db'
import { listAll, replaceAll } from '../db/items'
import * as revisions from '../db/revisions'
import { forBackup, readFields, readRevision } from './documentFields'
import { asVault, isCiphertext } from './vault'
import { asFolderSettings, readFolderSettings, replaceFolderSettings, type FolderSettings } from './folderSettings'
import { asSavedLooks, readSavedLooks, replaceSavedLooks, type SavedLooks } from './look'
import { isTime } from './time'
import { allowedImageSrc, filterBodyImages, mapImageSrcs } from './image'
import { readSort, SORTS, writeSort, type Sort } from './sort'
import { asSubmissions, readSubmissions, replaceSubmissions, type Submissions } from './submissions'
import { isTheme, readTheme, writeTheme, type Theme } from './theme'

/**
 * Lossless copy of the Dexie database. Markdown export stays the portable,
 * lossy path; this file is the one that keeps ids, pins, trash and history.
 *
 * Images are stored once in an `images` table and every note/revision body
 * points at that entry. Dumping each data URI into a hundred revisions would copy
 * the same picture a hundred times; restoring must not. The key is a counter, not
 * a content hash: nothing ever verifies it, so it only has to be unique within
 * one file — and a hash would put the dump behind `crypto.subtle`, which is
 * undefined on a `file://` or plain-http origin.
 *
 * Policy lives in `src/lib/image.ts`. Dump and restore call
 * `filterBodyImages` / `allowedImageSrc` / `mapImageSrcs` from that file.
 * This module does not walk HTML or JSON with its own src policy.
 */

export const BACKUP_KIND = 'nib-backup'
export const BACKUP_VERSION = 1

const IMAGE_REF_PREFIX = 'nib-image:'

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

export type BackupPreferences = {
  theme?: Theme
  sort?: Sort
  /** The folders' settings (lib/folderSettings), when there are any. */
  folders?: FolderSettings
  /** The saved looks (lib/look), when there are any, the deleted with them; not the look in use, which stays each device's. */
  looks?: SavedLooks
  /** The submission tracker's (lib/submissions), when there are any, the deleted with them. */
  submissions?: Submissions
}

/** The folders' settings, for a backup's preferences: none at all is left out, as it was before there were any. */
export function folderPreferences(): Pick<BackupPreferences, 'folders'> {
  const folders = readFolderSettings()
  return Object.keys(folders).length > 0 ? { folders } : {}
}

/** The saved looks, for a backup's preferences, the same way. */
export function savedLookPreferences(): Pick<BackupPreferences, 'looks'> {
  const looks = readSavedLooks()
  return Object.keys(looks).length > 0 ? { looks } : {}
}

/** The submissions, for a backup's preferences, the same way. */
export function submissionPreferences(): Pick<BackupPreferences, 'submissions'> {
  const submissions = readSubmissions()
  return Object.keys(submissions).length > 0 ? { submissions } : {}
}

export type BackupFile = {
  kind: typeof BACKUP_KIND
  version: number
  exportedAt: number
  preferences: BackupPreferences
  images: Record<string, string>
  items: Item[]
  revisions: Revision[]
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function backupFilename(exportedAt: number): string {
  return `nib-backup-${isoDay(exportedAt)}.json`
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup)
}

/** A number JSON can write back: Infinity, from 1e400, comes back as null. */
const finite = (value: unknown): value is number => Number.isFinite(value)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveRef(src: string, images: Record<string, string>): string {
  return src.startsWith(IMAGE_REF_PREFIX) ? (images[src.slice(IMAGE_REF_PREFIX.length)] ?? '') : src
}

function dumpBody(body: JSONContent, srcToKey: Record<string, string>): JSONContent {
  // Filter first, while srcs are still real image URIs. Mapping to
  // `nib-image:` refs before filterBodyImages would drop every picture —
  // those refs fail the allowlist, which is correct for the editor.
  return mapImageSrcs(filterBodyImages(body), (src) => {
    const key = srcToKey[src]
    return key === undefined ? src : `${IMAGE_REF_PREFIX}${key}`
  })
}

function restoreBody(body: JSONContent, images: Record<string, string>): JSONContent {
  return filterBodyImages(mapImageSrcs(body, (src) => resolveRef(src, images)))
}

function collectSrcs(body: JSONContent, into: Set<string>): void {
  mapImageSrcs(filterBodyImages(body), (src) => {
    into.add(src)
    return src
  })
}

export function buildBackup(
  records: Item[],
  history: Revision[],
  preferences: BackupPreferences,
  exportedAt: number,
): BackupFile {
  const srcs = new Set<string>()
  for (const record of records) {
    collectSrcs(record.body, srcs)
    if (record.unsealed && 'body' in record.unsealed) collectSrcs(record.unsealed.body, srcs)
  }
  for (const entry of history) collectSrcs(entry.body, srcs)

  const srcToKey: Record<string, string> = {}
  const images: Record<string, string> = {}
  let next = 0
  for (const src of srcs) {
    const key = String(next++)
    srcToKey[src] = key
    images[key] = src
  }

  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt,
    preferences,
    images,
    items: records.map((record) => {
      const item = { ...forBackup(record), body: dumpBody(record.body, srcToKey) }
      if (item.unsealed && 'body' in item.unsealed) item.unsealed = { body: dumpBody(item.unsealed.body, srcToKey) }
      return item
    }),
    revisions: history.map((entry) => ({
      ...entry,
      body: dumpBody(entry.body, srcToKey),
    })),
  }
}

/**
 * The library as stored now, as a backup's file. `preferences`: App's own,
 * which it holds through a session even with storage off; for anyone else,
 * what is in storage. `keep`: the documents it holds, with their history, if
 * not all (lib/backupFolder leaves out those kept on this device only).
 */
export async function takeBackup(preferences: BackupPreferences = { theme: readTheme(), sort: readSort() }, keep?: (item: Item) => boolean) {
  const at = Date.now()
  const [all, everyRevision] = await Promise.all([listAll(), revisions.listAll()])
  const records = keep ? all.filter(keep) : all
  const kept = new Set(records.map((record) => record.id))
  const history = keep ? everyRevision.filter((entry) => kept.has(entry.itemId)) : everyRevision
  return {
    empty: records.length === 0 && history.length === 0,
    content: serializeBackup(buildBackup(records, history, { ...preferences, ...folderPreferences(), ...savedLookPreferences(), ...submissionPreferences() }, at)),
    filename: backupFilename(at),
    type: 'application/json;charset=utf-8',
  }
}

function asItem(raw: unknown, images: Record<string, string>): Item {
  if (!isRecord(raw)) throw new BackupError('This backup is damaged.')
  if (typeof raw.id !== 'string' || !raw.id) throw new BackupError('This backup is damaged.')
  if (raw.kind !== 'note' && raw.kind !== 'page') throw new BackupError('This backup is damaged.')
  if (!isRecord(raw.body)) throw new BackupError('This backup is damaged.')
  if (!finite(raw.version) || !isTime(raw.createdAt) || !isTime(raw.updatedAt)) {
    throw new BackupError('This backup is damaged.')
  }
  const item: Item = {
    id: raw.id,
    kind: raw.kind,
    body: restoreBody(raw.body as JSONContent, images),
    version: raw.version,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    ...readFields(raw, 'backup'),
  }
  const unsealed = asUnsealed(raw.unsealed, images)
  if (unsealed) item.unsealed = unsealed
  return item
}

/** A copy from sync not sealed yet (Item `unsealed`): its text, boxed or not, or a well-formed seal and the id it is bound to. */
function asUnsealed(raw: unknown, images: Record<string, string>): Item['unsealed'] {
  if (!isRecord(raw)) return undefined
  if (typeof raw.box === 'string') return isCiphertext(raw.box) ? { box: raw.box } : undefined
  if (isRecord(raw.body)) return { body: restoreBody(raw.body as JSONContent, images) }
  const vault = asVault(raw.vault)
  return vault && typeof raw.from === 'string' && raw.from ? { vault, from: raw.from } : undefined
}

function asRevision(raw: unknown, images: Record<string, string>): Revision {
  const revision = readRevision(raw, (body) => (isRecord(body) ? restoreBody(body as JSONContent, images) : null))
  if (!revision) throw new BackupError('This backup is damaged.')
  return revision
}

function asImages(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {}
  const images: Record<string, string> = {}
  for (const [key, src] of Object.entries(raw)) {
    if (allowedImageSrc(src)) images[key] = src
  }
  return images
}

function asPreferences(raw: unknown): BackupPreferences {
  if (!isRecord(raw)) return {}
  const preferences: BackupPreferences = {}
  if (isTheme(raw.theme)) preferences.theme = raw.theme
  if (SORTS.includes(raw.sort as Sort)) preferences.sort = raw.sort as Sort
  const folders = asFolderSettings(raw.folders)
  if (folders) preferences.folders = folders
  const looks = asSavedLooks(raw.looks)
  if (looks) preferences.looks = looks
  const submissions = asSubmissions(raw.submissions)
  if (submissions) preferences.submissions = submissions
  return preferences
}

/**
 * Import boundary. Bodies are already passed through `filterBodyImages`;
 * image bytes through `allowedImageSrc`. A caller that writes `items` cannot
 * skip the shared allowlist.
 */
export function parseBackup(text: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupError('This is not a Nib backup.')
  }
  if (!isRecord(raw) || raw.kind !== BACKUP_KIND) {
    throw new BackupError('This is not a Nib backup.')
  }
  if (raw.version !== BACKUP_VERSION) {
    throw new BackupError('This backup is from a newer Nib.')
  }
  if (!Array.isArray(raw.items) || !Array.isArray(raw.revisions)) {
    throw new BackupError('This backup is damaged.')
  }
  const images = asImages(raw.images)
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
    preferences: asPreferences(raw.preferences),
    images,
    items: raw.items.map((entry) => asItem(entry, images)),
    revisions: raw.revisions.map((entry) => asRevision(entry, images)),
  }
}

export async function restoreBackup(text: string): Promise<void> {
  await putBack(parseBackup(text))
}

/** A backup read and checked (parseBackup), into the database, with its preferences. */
export async function putBack(backup: Pick<BackupFile, 'items' | 'revisions' | 'preferences'>): Promise<void> {
  await replaceAll(backup.items, backup.revisions)
  if (backup.preferences.theme) writeTheme(backup.preferences.theme)
  if (backup.preferences.sort) writeSort(backup.preferences.sort)
  // A backup from before there were any leaves this device's as they are.
  const folders = asFolderSettings(backup.preferences.folders)
  if (folders) replaceFolderSettings(folders)
  const looks = asSavedLooks(backup.preferences.looks)
  if (looks) replaceSavedLooks(looks)
  const submissions = asSubmissions(backup.preferences.submissions)
  if (submissions) replaceSubmissions(submissions)
}
