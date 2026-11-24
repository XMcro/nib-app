import { db } from '../db/db'
import { filesGone, filesWaiting, fileRemoved, fileSettled, removals, sendFiles } from '../lib/fileQueue'
import { filesUsed } from '../lib/fileUse'
import { MAX_RECORDS } from '../../worker/wire.mjs'
import { hasFile, keepFile, readFile } from '../lib/files'
import type { Full } from '../lib/image'
import { readJson, writeJson } from '../lib/jsonStorage'
import { SyncHttpError, type Api } from './api'
import { recordKey, type SyncKeys } from './crypto'
import { SERVER_HISTORY_MS } from './engine'

/**
 * A library's files between its devices (worker/files): a picture's
 * original, sealed on the device under the sync code's key as a record is,
 * and named there by a key the server can't turn back into the id a document
 * knows it by. Sent after the documents that name them (sync/engine
 * `outgoing` says which, lib/fileQueue keeps the list); fetched when a
 * device that hasn't one comes to show or export it (lib/originals).
 */

/** A file is padded to the next of these before it's sealed, so the server sees roughly how big it is and not exactly. */
const PAD = 64 * 1024
/** Before the file itself: how long it is, in four bytes. */
const HEAD = 4
/** Files sent in one pass: more wait for the next, so writing isn't kept from syncing while a long list goes. */
const AT_ONCE = 4

const fileKey = (keys: SyncKeys, id: string) => recordKey(keys, 'file', id)

/** Sealed with its key as associated data, as a record is (sync/crypto `seal`), so the server can't hand one file back as another. */
export async function sealFile(keys: SyncKeys, key: string, file: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = new Uint8Array(Math.ceil((HEAD + file.length) / PAD) * PAD)
  new DataView(plain.buffer).setUint32(0, file.length)
  plain.set(file, HEAD)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(key) }, keys.encrypt, plain)
  const out = new Uint8Array(iv.length + cipher.byteLength)
  out.set(iv)
  out.set(new Uint8Array(cipher), iv.length)
  return out
}

/** The file inside; null for anything that doesn't open under this key and code, or isn't whole. */
export async function openFile(keys: SyncKeys, key: string, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12), additionalData: new TextEncoder().encode(key) }, keys.encrypt, sealed.subarray(12)))
    const length = new DataView(plain.buffer).getUint32(0)
    return length <= plain.length - HEAD ? plain.slice(HEAD, HEAD + length) : null
  } catch {
    return null
  }
}

/** The originals this device knows the server has, by a library's id: sent from here, or fetched from there. */
const sentKey = (keys: SyncKeys) => `nib-files-sent-${keys.libraryId}`
const sentTo = (keys: SyncKeys) => new Set(readJson<string[]>(sentKey(keys), []))
function mark(keys: SyncKeys, id: string, there: boolean) {
  const sent = sentTo(keys)
  if (there) sent.add(id)
  else sent.delete(id)
  writeJson(sentKey(keys), [...sent])
}

/** Libraries found full since Nib was opened: nothing more is sent to one till something is taken off it, or Nib is opened again. */
const full = new Set<string>()

/**
 * One pass over the files, after the documents': those to be taken off the
 * server go first, then those waiting are sent, a few at a time. `full`:
 * the library has no room for more. `more`: some still wait for the next pass.
 */
export async function syncFiles(keys: SyncKeys, api: Api): Promise<{ full: boolean; more: boolean }> {
  for (const id of filesGone()) {
    await api.deleteFile(await fileKey(keys, id))
    mark(keys, id, false)
    fileRemoved(id)
    full.delete(keys.libraryId)
  }
  if (full.has(keys.libraryId)) return { full: true, more: false }
  const sent = sentTo(keys)
  let count = 0
  for (const id of filesWaiting()) {
    // One the server has, or that isn't on this device to send (named by a document that came from another): nothing to do.
    const file = sent.has(id) ? null : await readFile(id)
    if (file) {
      if (count === AT_ONCE) return { full: false, more: true }
      const key = await fileKey(keys, id)
      try {
        await api.putFile(key, await sealFile(keys, key, new Uint8Array(await file.arrayBuffer())))
      } catch (error) {
        // The server is clearing an old copy of it just now (worker/library `unlisted`): left waiting for the next
        // look, and the others go on.
        if (error instanceof SyncHttpError && error.status === 409) continue
        if (!(error instanceof SyncHttpError) || error.status !== 507) throw error
        full.add(keys.libraryId)
        return { full: true, more: false }
      }
      mark(keys, id, true)
      count++
    }
    fileSettled(id)
  }
  return { full: false, more: false }
}

const DAY_MS = 86_400_000
/** The most keys in one word of which files are used (worker/files): as many as the server takes. */
const NAMED_AT_ONCE = MAX_RECORDS

/**
 * Once a day: tells the server which files this device's documents use, in what they hold or in their history
 * (lib/fileUse `filesUsed`), and that that's all of them. Only a device can say: a document is sealed, and the
 * server can't see which files it uses. What no device names for a long while, the server takes for unused and
 * deletes (worker/library `namedFiles`); a file no device's documents used any more stayed there till the library
 * was deleted (the server audit of 2026-11-23, L13). Run after a look has fetched everything (sync/session), so
 * that what this device says is what it has when it has it all.
 *
 * Then, of those it uses and holds, any the server no longer has and would have been sent are sent again: cleared there as unused while this
 * device was away, or lost with a library that lapsed and was paid for again. Their mark as sent goes, and they
 * wait with the rest (lib/fileQueue). Returns how many.
 *
 * Failing, it's tried again tomorrow: said in part, nothing is taken for unused on the strength of it.
 */
export async function nameFiles(keys: SyncKeys, api: Api, now = Date.now()): Promise<number> {
  // A day since it was last said; or the last is in the future, written while this device's clock ran ahead, which
  // stopped it being said till the clock caught up.
  const last = (await db.syncMeta.get('named'))?.v ?? 0
  if (last <= now && now - last < DAY_MS) return 0
  await db.syncMeta.put({ k: 'named', v: now })
  const removed = removals()
  const { used, sent } = await filesUsed(now - SERVER_HISTORY_MS)
  const names: string[] = []
  for (const file of used) names.push(await fileKey(keys, file.id))
  // A thousand at a go; with none at all, still said: that's all of them.
  for (let at = 0; at < names.length || at === 0; at += NAMED_AT_ONCE) await api.nameFiles(names.slice(at, at + NAMED_AT_ONCE), at + NAMED_AT_ONCE >= names.length)
  const there = new Set((await api.files()).files.map((file) => file.k))
  // Sent again: only what's ever sent (not one that only a version older than the server keeps names, which
  // would go up for the first time, to be kept for good).
  const again: string[] = []
  for (const [at, file] of used.entries()) if (!there.has(names[at]) && sent.has(file.id) && (await hasFile(file.id))) again.push(file.id)
  // Files were given to be taken off the server since this began (a document locked, or made this device's only,
  // while the rest were read): one of these may be among them, and sent again it was put back there. Which, can't
  // be told once a look has taken them off, so none is sent, and it's all said again at the next look. With
  // nothing awaited from here to the sending: one taken off after it is taken from those waiting as well (lib/fileQueue).
  if (again.length > 0 && removals() !== removed) {
    await db.syncMeta.delete('named')
    return 0
  }
  for (const id of again) mark(keys, id, false)
  sendFiles(again)
  return again.length
}

/**
 * How fetching an original went: `kept` here under its id; `absent`, the server hasn't it; `wrong`, what came
 * isn't it (it doesn't open under this library's keys, or isn't the size its document says, to the byte); `full`,
 * this device couldn't keep it. A download that fails throws.
 */
export type Fetched = 'kept' | 'absent' | 'wrong' | 'full'

export async function fetchOriginal(keys: SyncKeys, api: Api, original: Full): Promise<Fetched> {
  const key = await fileKey(keys, original.id)
  const sealed = await api.getFile(key)
  if (!sealed) return 'absent'
  const file = await openFile(keys, key, sealed)
  if (!file || file.length !== original.size) return 'wrong'
  if (!(await keepFile(new Blob([file], { type: original.type }), original.id))) return 'full'
  mark(keys, original.id, true)
  return 'kept'
}

/** Fetches an original this device hasn't, and keeps it under its id; false if the server hasn't it, or what came isn't it. */
export async function fetchFile(keys: SyncKeys, api: Api, original: Full): Promise<boolean> {
  return (await fetchOriginal(keys, api, original)) === 'kept'
}

/**
 * Every one of `originals` that this device hasn't and the server has, fetched and kept, so that nothing is only
 * on the server any more. Returns those that are there to be had and weren't: the download failed, or this device
 * had no room.
 *
 * Not one the server hasn't: it was never sent, or is gone already. Nor one it lists and then hasn't, or that came
 * and isn't what its document names, each asked for twice: it's lost already, to every device that hasn't it, and
 * nothing here can fetch it.
 * Counted with those that failed, one such file, which whoever had the code could put there, refused every change
 * of the code made to be rid of them (found checking the fix of the server audit of 2026-11-23).
 */
export async function fetchMissing(keys: SyncKeys, api: Api, originals: Full[]): Promise<Full[]> {
  const missing: Full[] = []
  for (const original of originals) if (!(await hasFile(original.id))) missing.push(original)
  if (missing.length === 0) return []
  const there = new Set((await api.files()).files.map((file) => file.k))
  const failed: Full[] = []
  for (const original of missing) {
    if (!there.has(await fileKey(keys, original.id))) continue
    const fetching = () => fetchOriginal(keys, api, original).catch(() => 'failed' as const)
    let fetched = await fetching()
    // Twice, before it's given up as lost: once could be a download cut short, or an answer from the wrong place.
    if (fetched === 'wrong' || fetched === 'absent') fetched = await fetching()
    if (fetched === 'failed' || fetched === 'full') failed.push(original)
    else if (fetched !== 'kept') console.warn(`Nib: a file the server lists ${fetched === 'absent' ? 'isn’t there' : 'isn’t what its document names'}, and is left`)
  }
  return failed
}
