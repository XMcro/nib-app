import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import Dexie, { type Table } from 'dexie'
import { isFileId, MAX_FILE } from './fileRef'
import { nativeApp } from './platform'

/**
 * Files kept on this device, beside the library and outside its documents: a
 * picture's original (lib/originals), and whatever else is too big to live
 * inside a note. A document names a file by its id and nothing else; the
 * address a file is shown from is made here, from that id, and never comes
 * from a document.
 *
 * In the app a file is a file, in the app's own Library folder: iOS doesn't
 * clear it to free space, as it can the web view's storage, and it's in the
 * device's backups. It's written under another name and renamed when whole,
 * so one cut short is never shown. In a browser, where Nib is only run to be
 * worked on, it's a row in a database of its own, shown from a `data:`
 * address made of it each time.
 */

type Store = {
  put(id: string, blob: Blob): Promise<void>
  /** Where the page can show it from, or null if it isn't on this device. */
  url(id: string): Promise<string | null>
  /** The file itself, or null if it isn't on this device. */
  get(id: string): Promise<Blob | null>
  /** Every file here, and how big each is. */
  list(): Promise<{ id: string; size: number }[]>
  /** Whether it's on this device, without reading it. */
  has(id: string): Promise<boolean>
  /** The file under `name`, for what tells a file's kind by its name: where the page can play it from, and, in the app, where the system's viewer can open it from. Null if it isn't here. */
  named(id: string, name: string): Promise<Named | null>
  remove(id: string): Promise<void>
}

/** `url`: for the page. `uri`: the file itself, for the system's viewer (lib/preview); none in a browser. */
export type Named = { url: string; uri: string | null }

const FOLDER = 'files'
const library = { directory: Directory.Library }
/**
 * Copies made to open: a file is kept under its id alone, and the system's
 * viewer and the web view's player each go by a file's name to know what it
 * is. One is made when a file is opened, in Caches, which iOS may clear, and
 * goes when its file does. On an iPhone's disk a copy takes no room of its
 * own until one of the two is changed, and neither ever is.
 */
const OPENED = 'opened'
const caches = { directory: Directory.Cache }
/** Sent to the app a piece at a time: the whole of a large file as one string is more than the bridge should carry. */
const PIECE = 512 * 1024

/**
 * A file as a `data:` address. In a browser it's shown from one: a browser's
 * own address for a blob (`blob:`) is one the page's policy doesn't let a
 * picture be shown from (lib/csp `img-src`), and the policy is the app's too,
 * so it stays as it is.
 */
const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

const base64 = async (blob: Blob) => {
  const url = await dataUrl(blob)
  return url.slice(url.indexOf(',') + 1)
}

const inApp: Store = {
  async put(id, blob) {
    const part = `${FOLDER}/${id}.part`
    try {
      await Filesystem.writeFile({ path: part, data: await base64(blob.slice(0, PIECE)), ...library, recursive: true })
      for (let at = PIECE; at < blob.size; at += PIECE) {
        await Filesystem.appendFile({ path: part, data: await base64(blob.slice(at, at + PIECE)), ...library })
      }
      await Filesystem.rename({ from: part, to: `${FOLDER}/${id}`, ...library, toDirectory: library.directory })
    } catch (error) {
      // What was written of it goes: nothing names it, so nothing else would ever clear it.
      await Filesystem.deleteFile({ path: part, ...library }).catch(() => {})
      throw error
    }
  },
  async url(id) {
    try {
      await Filesystem.stat({ path: `${FOLDER}/${id}`, ...library })
      return Capacitor.convertFileSrc((await Filesystem.getUri({ path: `${FOLDER}/${id}`, ...library })).uri)
    } catch {
      return null
    }
  },
  // Read from the address it's shown from, as the page reads it: whole through the bridge it would come as one string.
  async get(id) {
    const url = await inApp.url(id)
    const answer = url ? await fetch(url) : null
    return answer?.ok ? answer.blob() : null
  },
  has: (id) =>
    Filesystem.stat({ path: `${FOLDER}/${id}`, ...library }).then(
      () => true,
      () => false,
    ),
  async named(id, name) {
    const path = `${OPENED}/${id}/${name}`
    const made = await Filesystem.stat({ path, ...caches }).then(
      () => true,
      () => false,
    )
    if (!made) {
      await Filesystem.mkdir({ path: `${OPENED}/${id}`, ...caches, recursive: true }).catch(() => {}) // there already
      await Filesystem.copy({ from: `${FOLDER}/${id}`, ...library, to: path, toDirectory: caches.directory })
    }
    const { uri } = await Filesystem.getUri({ path, ...caches })
    return { url: Capacitor.convertFileSrc(uri), uri }
  },
  // None before the first is kept: there's no folder yet.
  list: () =>
    Filesystem.readdir({ path: FOLDER, ...library }).then(
      ({ files }) => files.map((file) => ({ id: file.name, size: file.size })),
      () => [],
    ),
  // And the copy it was opened from, if it was.
  remove: (id) =>
    Promise.all([Filesystem.deleteFile({ path: `${FOLDER}/${id}`, ...library }), Filesystem.rmdir({ path: `${OPENED}/${id}`, ...caches, recursive: true })].map((gone) => gone.catch(() => {}))).then(() => {}),
}

let rows: Table<{ id: string; blob: Blob }, string> | undefined
function table() {
  if (!rows) {
    const database = new Dexie('nib-files')
    database.version(1).stores({ files: 'id' })
    rows = database.table('files')
  }
  return rows
}
const inBrowser: Store = {
  put: (id, blob) => table().put({ id, blob }).then(() => {}),
  url: async (id) => {
    const row = await table().get(id)
    return row ? dataUrl(row.blob) : null
  },
  get: (id) =>
    table()
      .get(id)
      .then((row) => row?.blob ?? null),
  has: async (id) => (await table().where('id').equals(id).count()) > 0,
  // Under the kind its document has for it: a browser goes by that, and has no use for a name.
  async named(id) {
    const row = await table().get(id)
    return row ? { url: await dataUrl(row.blob), uri: null } : null
  },
  list: async () => (await table().toArray()).map((row) => ({ id: row.id, size: row.blob.size })),
  remove: (id) => table().delete(id),
}

const store = nativeApp ? inApp : inBrowser

/**
 * Keeps `blob` on this device, and gives the id it's found by; null if it's
 * too big, or it couldn't be written. `id`: the one it already has, for a
 * file fetched from the server (sync/files).
 */
export async function keepFile(blob: Blob, id: string = crypto.randomUUID()): Promise<string | null> {
  if (blob.size === 0 || blob.size > MAX_FILE || !isFileId(id)) return null
  try {
    await store.put(id, blob)
    return id
  } catch (error) {
    console.warn('Nib: could not keep a file', error)
    return null
  }
}

/** Where the page can show the file from; null for anything that isn't an id of this store's, or isn't on this device. */
export const fileUrl = (id: unknown): Promise<string | null> => (isFileId(id) ? store.url(id).catch(() => null) : Promise.resolve(null))

/** The file itself, by the same rule. */
export const readFile = (id: unknown): Promise<Blob | null> => (isFileId(id) ? store.get(id).catch(() => null) : Promise.resolve(null))

/** Every file kept on this device, and how big each is: only those under an id of the store's own, so not one half-written. */
export const listFiles = async (): Promise<{ id: string; size: number }[]> => (await store.list()).filter((file) => isFileId(file.id))

/** Whether the file is on this device. */
export const hasFile = (id: unknown): Promise<boolean> => (isFileId(id) ? store.has(id) : Promise.resolve(false))

/** A name a copy can be kept under: no folders (lib/attachment `asFileName` has seen to that already), and not a hidden file. */
const copyName = (name: string) => name.replace(/[\\/]/g, '').replace(/^\.+/, '') || 'file'

/** The file under its own name, to be played in the page or opened by the system's viewer; null if it isn't on this device, or can't be made ready. */
export const namedFile = (id: unknown, name: string): Promise<Named | null> => (isFileId(id) ? store.named(id, copyName(name)).catch(() => null) : Promise.resolve(null))


export const forgetFile = (id: string): Promise<void> => (isFileId(id) ? store.remove(id) : Promise.resolve())
