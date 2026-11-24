import type { JSONContent } from '@tiptap/core'
import { db } from '../db/db'
import { read, removeFiles } from './fileQueue'
import { forgetFile, listFiles } from './files'
import { filesIn, type Full } from './image'
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
 * Every file the documents that sync name, in what they hold or in their history, once each: what this device
 * tells the server it uses (sync/files `nameFiles`). Not those of a document kept on this device only, whose files
 * are taken off the server (`letGo`), nor its history's. `sent`: those a document itself names, or a version made
 * since `sentFrom`, which are the ones the server is ever sent (sync/engine `outgoing` sends no older version).
 * Read a few at a time, as `unnamed` reads.
 */
export async function filesUsed(sentFrom: number): Promise<{ used: Full[]; sent: Set<string> }> {
  const used = new Map<string, Full>()
  const sent = new Set<string>()
  const local = new Set<string>()
  const pages = async <T extends { id: string }>(next: (after: string) => Promise<T[]>, each: (row: T) => void) => {
    for (let after = ''; ; ) {
      const rows = await next(after)
      rows.forEach(each)
      if (rows.length < AT_A_TIME) return
      after = rows[rows.length - 1].id
      await new Promise((turn) => setTimeout(turn))
    }
  }
  const names = (body: JSONContent, goes: boolean) => {
    for (const file of filesIn(body)) {
      used.set(file.id, file)
      if (goes) sent.add(file.id)
    }
  }
  await pages(
    (after) => db.items.where(':id').above(after).limit(AT_A_TIME).toArray(),
    (item) => {
      if (item.deviceOnly) local.add(item.id)
      else names(item.body, true)
    },
  )
  await pages(
    (after) => db.revisions.where(':id').above(after).limit(AT_A_TIME).toArray(),
    (revision) => {
      if (!local.has(revision.itemId)) names(revision.body, revision.createdAt >= sentFrom)
    },
  )
  return { used: [...used.values()], sent }
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
