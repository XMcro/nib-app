import type { JSONContent } from '@tiptap/core'
import { db } from '../db/db'
import { read, removeFiles } from './fileQueue'
import { forgetFile, listFiles } from './files'
import { filesIn } from './image'
import { readJson, writeJson } from './jsonStorage'

/** How many documents, or past versions, are read at a time (`unnamed`). */
const AT_A_TIME = 20

/**
 * Those of `ids` that no document names now: none that syncs (`synced`), or none at all, in what it holds or in its history.
 * Read a few at a time, with the page given its turn between, and no further than the last of `ids` to be named: read in
 * one go, the whole history, every version with its pictures, held every save and what sync brought waiting till its end.
 */
async function unnamed(ids: string[], synced: boolean): Promise<string[]> {
  const left = new Set(ids)
  async function look<T extends { id: string; body: JSONContent }>(next: (after: string) => Promise<T[]>, counts: (row: T) => boolean) {
    let after = ''
    while (left.size > 0) {
      const rows = await next(after)
      for (const row of rows) if (counts(row)) for (const file of filesIn(row.body)) left.delete(file.id)
      if (rows.length < AT_A_TIME) return
      after = rows[rows.length - 1].id
      await new Promise((turn) => setTimeout(turn))
    }
  }
  await look(
    (after) => db.items.where(':id').above(after).limit(AT_A_TIME).toArray(),
    (item) => !synced || !item.deviceOnly,
  )
  if (!synced) {
    await look(
      (after) => db.revisions.where(':id').above(after).limit(AT_A_TIME).toArray(),
      () => true,
    )
  }
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
/** How long Nib has been on the screen before it looks (`keepFilesSwept`). */
const SETTLED_MS = 2 * 60_000
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

/**
 * Looks (`sweepFiles`) from now till the returned stop, once Nib has been on the screen a couple of minutes, and
 * each couple of minutes it stays there: a Nib left open, as on a Mac, has its day come round too. Not as Nib
 * opens, nor the moment it's back, which is when the library is read, sync looks and the day's coins and pack come.
 */
export function keepFilesSwept(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wait = () => {
    clearTimeout(timer)
    if (document.visibilityState !== 'visible') return
    timer = setTimeout(() => {
      void sweepFiles().catch((error: unknown) => console.warn('Nib: could not clear unused files', error))
      wait()
    }, SETTLED_MS)
  }
  document.addEventListener('visibilitychange', wait)
  wait()
  return () => {
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', wait)
  }
}
