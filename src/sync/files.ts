import { filesGone, filesWaiting, fileRemoved, fileSettled } from '../lib/fileQueue'
import { keepFile, readFile } from '../lib/files'
import type { Full } from '../lib/image'
import { readJson, writeJson } from '../lib/jsonStorage'
import { SyncHttpError, type Api } from './api'
import { recordKey, type SyncKeys } from './crypto'

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

/** Fetches an original this device hasn't, and keeps it under its id; false if the server hasn't it, or what came isn't it. */
export async function fetchFile(keys: SyncKeys, api: Api, original: Full): Promise<boolean> {
  const key = await fileKey(keys, original.id)
  const sealed = await api.getFile(key)
  const file = sealed && (await openFile(keys, key, sealed))
  // What its document said it was, to the byte.
  if (!file || file.length !== original.size) return false
  if (!(await keepFile(new Blob([file], { type: original.type }), original.id))) return false
  mark(keys, original.id, true)
  return true
}
