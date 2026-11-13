import type { JSONContent } from '@tiptap/core'
import { db } from '../db/db'
import { read, removeFiles } from './fileQueue'
import { forgetFile, listFiles } from './files'
import { filesIn } from './image'
import { readJson, writeJson } from './jsonStorage'

/** Those of `ids` that no document names now: none that syncs (`synced`), or none at all, in what it holds or in its history. */
async function unnamed(ids: string[], synced: boolean): Promise<string[]> {
  const left = new Set(ids)
  const seen = (body: JSONContent) => {
    for (const file of filesIn(body)) left.delete(file.id)
  }
  await db.items.each((item) => {
    if (!synced || !item.deviceOnly) seen(item.body)
  })
  if (!synced) await db.revisions.each((revision) => seen(revision.body))
  return [...left]
}

/**
 * The originals a document named, once it was locked, or is kept on this
 * device only: taken off the server (by sync, when it next runs), unless a
 * document that syncs still names them; and deleted from this device, unless
 * any document or its history still does. One kept on this device still names
 * its own, which stay. A locked one names none: a lock that left the picture
 * in the clear beside the library would not be one.
 */
export async function letGo(ids: string[]) {
  if (ids.length === 0) return
  removeFiles(await unnamed(ids, true))
  for (const id of await unnamed(ids, false)) await forgetFile(id)
}

const DAY_MS = 86_400_000
/** When this device last looked for files nothing uses, and those it found then. */
const SWEPT = 'nib-files-swept'
const UNUSED = 'nib-files-unused'

/**
 * Once a day: the files here that no document names, in what it holds or in
 * its history (a picture taken out of a note, a note deleted for good), are
 * deleted from this device and, by sync, from the server. Not the first time
 * one is found unused, but the next, a day or more later: a picture cut from
 * one note and not yet pasted into another, or one whose new home another
 * device has sent and this one hasn't fetched yet, is still wanted.
 */
export async function sweepFiles(now = Date.now()) {
  if (now - readJson(SWEPT, 0) < DAY_MS) return
  writeJson(SWEPT, now)
  const here = (await listFiles()).map((file) => file.id)
  const unused = here.length > 0 ? await unnamed(here, false) : []
  const before = new Set(read(UNUSED))
  const due = unused.filter((id) => before.has(id))
  removeFiles(due)
  for (const id of due) await forgetFile(id)
  writeJson(UNUSED, unused)
}
