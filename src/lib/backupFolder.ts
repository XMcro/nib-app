import { registerPlugin } from '@capacitor/core'
import type { Item } from '../db/db'
import { listAll } from '../db/items'
import { takeBackup } from './backup'
import { fileNamed } from './documentExport'
import { filingOf, split, under } from './folders'
import { withoutAboutIn } from './image'
import { readJson, writeJson } from './jsonStorage'
import { whichFolders } from './backupChoice'
import { toMarkdown } from './markdown'
import { isScreenplay, nameOf, toFountain } from './fountain'
import { mirrorRestoreFailed } from './mirror'
import { localDay } from './time'
import { isLocked } from './vault'

/**
 * Backup to a folder (Nib Plus, in the app): the library written, once a day
 * while Nib is open, to a folder the writer chose in the system's picker, on
 * iCloud Drive, Dropbox, a drive or this device. The folder is kept on this
 * device alone, as the system's bookmark to it, and Nib touches only the
 * files it wrote there (ios/App/App/NibFolderPlugin.swift).
 *
 * One copy, kept up to date: a Markdown file for each note and page, under
 * Notes or Pages and its folders as Nib has them, written again when it
 * changes and taken away when it goes; and, for the whole library, Nib's own
 * backup file beside them, to restore from (lib/backup). Locked notes aren't
 * written, nor those kept on this device only, which never leave it.
 */
export const folderPlugin = registerPlugin<{
  /** The system's folder picker, keeping the folder chosen in place of any before. Its name, or nothing if none was chosen. */
  choose(): Promise<{ name?: string }>
  /** The folder kept on this device, by its name: nothing if there's none, `lost` if it can't be found (moved off, deleted, a drive taken away). */
  folder(): Promise<{ name?: string; lost?: boolean }>
  /** A text file under it, by its path there: nothing if there's none. */
  read(options: { path: string }): Promise<{ data?: string }>
  /**
   * Text files written under it, their folders made, then `remove` removed. One `fresh` is written only if nothing
   * is at its path, and answered as `taken` if something was. Rejected `none`, `lost` or `refused`.
   */
  write(options: { files: { path: string; data: string; fresh?: boolean }[]; remove?: string[] }): Promise<{ taken?: string[] }>
  forget(): Promise<void>
}>('NibFolder')

/** In the folder, beside the writing: the list of Nib's own files there, and the library's backup. */
export const LIST = 'Nib files.json'
export const BACKUP = 'Nib backup.json'

/** What Nib wrote for a document: where, and what was in it, by its fingerprint. */
type Written = { path: string; hash: string }
type List = { kind: typeof LIST_KIND; version: 1; library?: string; documents: Record<string, Written>; backup: string | null }
const LIST_KIND = 'nib-backup-folder'

/** How the last backup went, on this device: when, and what it did or why it didn't. */
export type Last = { at: number; day: string; written: number; removed: number } | { at: number; day: string; failed: 'lost' | 'refused' | 'doubt' | 'other' | 'error' }

const LAST_KEY = 'nib-backup-folder-last'
/** This library's name for itself in a folder's list: made here the first time, or taken from a folder this library's writing is already in. */
const LIBRARY_KEY = 'nib-backup-folder-library'

export { setWhichFolders, whichFolders } from './backupChoice'

export const lastBackup = (): Last | null => readJson<Last | null>(LAST_KEY, null)

/** A folder's or a file's name as the folder takes it (lib/documentExport fileNamed): nothing it can't hold, and never hidden. */
const safe = (name: string) => fileNamed(name, 'md').slice(0, -3)

/** Where a document goes: Notes or Pages, then its folder, and the folder it's inside, then its title. */
export function pathOf(item: Item): string {
  const folder = filingOf(item).folder
  const { parent, name } = folder ? split(folder) : { parent: null, name: '' }
  const folders = [...(parent ? [parent] : []), ...(name ? [name] : [])].map(safe)
  // A screenplay as its Fountain (lib/fountain), named for its title.
  const file = fileNamed(nameOf(item), isScreenplay(item) ? 'fountain' : 'md')
  return [item.kind === 'note' ? 'Notes' : 'Pages', ...folders, file].join('/')
}

/** What goes: the notes and pages there are, in the folders chosen if they're chosen. Not those in the trash, templates, locked notes, or those kept on this device only. */
export function documentsFor(all: Item[], which: string[] | null): Item[] {
  return all.filter((item) => {
    if (item.deletedAt !== undefined || item.template || item.deviceOnly || isLocked(item)) return false
    if (which === null) return true
    const folder = filingOf(item).folder
    return Boolean(folder) && which.some((chosen) => under(folder!, chosen))
  })
}

/** What's in a file, as a name for it: the first half of its SHA-256, in hex. */
async function hashOf(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The list as the folder has it, if it's Nib's: anything else is as none, so nothing in the folder is taken for Nib's. */
function asList(text: string | undefined): List {
  const none: List = { kind: LIST_KIND, version: 1, documents: {}, backup: null }
  try {
    const raw = JSON.parse(text ?? 'null') as Partial<List> | null
    if (!raw || raw.kind !== LIST_KIND || !raw.documents || typeof raw.documents !== 'object') return none
    const documents: Record<string, Written> = {}
    for (const [id, written] of Object.entries(raw.documents)) {
      if (typeof written?.path === 'string' && typeof written.hash === 'string') documents[id] = { path: written.path, hash: written.hash }
    }
    return { ...none, ...(typeof raw.library === 'string' && { library: raw.library }), documents, backup: typeof raw.backup === 'string' ? raw.backup : null }
  } catch {
    return none
  }
}

/** `path` numbered, before its extension: "Ideas.md" as "Ideas 2.md". */
const numbered = (path: string, n: number) => path.replace(/(\.[^./]+)?$/, (extension) => ` ${n}${extension}`)
const key = (path: string) => path.toLocaleLowerCase()

/** As much as goes over to the app at once: a library's first backup is many files. */
const BATCH = 4_000_000

/**
 * Writes `files` in batches, each where it asked to go or, if it's `fresh` and
 * someone else's file is there, at the next number free beside it, as
 * someone else's file is never written over. Answers where each went, by
 * where it asked to go. `used`: the names already given out this time.
 * `after`: called as each batch lands, with all that has gone so far.
 */
async function writeAll(files: { path: string; data: string; fresh: boolean }[], used: Set<string>, after?: (went: Map<string, string>) => Promise<void>): Promise<Map<string, string>> {
  const went = new Map<string, string>()
  let waiting = files.map((file) => ({ ...file, asked: file.path }))
  for (let n = 2; waiting.length > 0; n++) {
    if (n > 100) throw Object.assign(new Error('No name free in the folder.'), { code: 'refused' })
    const taken: typeof waiting = []
    for (let at = 0; at < waiting.length; ) {
      const batch: typeof waiting = []
      for (let size = 0; at < waiting.length && (batch.length === 0 || size + waiting[at].data.length <= BATCH); at++) {
        size += waiting[at].data.length
        batch.push(waiting[at])
      }
      const { taken: refused = [] } = await folderPlugin.write({ files: batch.map(({ path, data, fresh }) => ({ path, data, fresh })) })
      for (const file of batch) {
        if (refused.includes(file.path)) taken.push(file)
        else went.set(file.asked, file.path)
      }
      await after?.(went)
    }
    waiting = taken.map((file) => {
      used.add(key(file.path))
      let to = numbered(file.asked, n)
      for (let m = n + 1; used.has(key(to)); m++) to = numbered(file.asked, m)
      used.add(key(to))
      return { ...file, path: to, fresh: true }
    })
  }
  return went
}

let running: Promise<Last> | null = null

/**
 * The library written to the folder now: each document that's new or
 * changed since the last time, those gone taken away, the backup file if
 * it's the whole library, then the list. One at a time. How it went is kept
 * for Settings (lastBackup).
 */
export function backUp(now = Date.now()): Promise<Last> {
  running ??= write(now).finally(() => (running = null))
  return running
}

async function write(now: number): Promise<Last> {
  const day = localDay(now)
  const done = (last: Last) => {
    writeJson(LAST_KEY, last)
    return last
  }
  try {
    const kept = await folderPlugin.folder()
    if (!kept.name) return done({ at: now, day, failed: 'lost' })
    const list = asList((await folderPlugin.read({ path: LIST })).data)
    const which = whichFolders()
    const library = await listAll()
    // A library that may not all be here takes nothing away: as when the app's own copy couldn't be brought back
    // (lib/mirror), or one that comes up empty while the folder has writing. It waits for another day. Folders
    // chosen with nothing in them are the writer's choice, not that.
    if (mirrorRestoreFailed() || (library.length === 0 && Object.keys(list.documents).length > 0)) return done({ at: now, day, failed: 'doubt' })
    // Whose folder it is. The list is all that says which files are Nib's, and it's in the folder, where another
    // library's Nib may have left it: a new phone, or a second device that doesn't sync with this one. Taken for
    // this library's only if it carries this library's name, or names mostly documents this library has (the same
    // library through sync or a restore), whose name is then taken. Otherwise nothing there is touched.
    const listed = Object.keys(list.documents)
    let mine = readJson<string | null>(LIBRARY_KEY, null)
    if (listed.length > 0 && (!mine || list.library !== mine)) {
      const here = new Set(library.map((item) => item.id))
      if (!list.library || listed.filter((id) => here.has(id)).length * 2 < listed.length) return done({ at: now, day, failed: 'other' })
      mine = list.library
    }
    mine ??= crypto.randomUUID()
    writeJson(LIBRARY_KEY, mine)
    const going = documentsFor(library, which)

    // Each document's place, a name each whatever its capitals: those already there keep theirs.
    const nibs = new Set([...Object.values(list.documents).map((written) => key(written.path)), ...(list.backup ? [key(list.backup)] : [])])
    const used = new Set<string>([key(LIST), key(BACKUP)])
    const placed = new Map<string, string>()
    const wanted = going.map((item) => ({ item, path: pathOf(item) }))
    for (const { item, path } of wanted) {
      const before = list.documents[item.id]?.path
      if (before && key(before) === key(path) && !used.has(key(before))) {
        placed.set(item.id, before)
        used.add(key(before))
      }
    }
    for (const { item, path } of wanted) {
      if (placed.has(item.id)) continue
      let to = path
      for (let n = 2; used.has(key(to)); n++) to = numbered(path, n)
      placed.set(item.id, to)
      used.add(key(to))
    }

    const documents: Record<string, Written> = {}
    const changed: { id: string; path: string; data: string; fresh: boolean }[] = []
    for (const item of going) {
      const data = isScreenplay(item) ? toFountain(item.body) : toMarkdown(withoutAboutIn(item.body))
      const hash = await hashOf(data)
      const path = placed.get(item.id)!
      documents[item.id] = { path, hash }
      const before = list.documents[item.id]
      if (before?.path === path && before.hash === hash) continue
      changed.push({ id: item.id, path, data, fresh: !nibs.has(key(path)) })
    }
    // The list kept as the files land: a backup cut short leaves none of its files unnamed, to be taken for
    // someone else's the next day and written again beside themselves.
    const keepList = (documents: Record<string, Written>, backup: string | null) =>
      folderPlugin.write({ files: [{ path: LIST, data: JSON.stringify({ kind: LIST_KIND, version: 1, library: mine, documents, backup } satisfies List) }] })
    const went = await writeAll(changed, used, async (went) => {
      const landed = { ...list.documents }
      for (const { id, path } of changed) if (went.has(path)) landed[id] = { path: went.get(path)!, hash: documents[id].hash }
      await keepList(landed, list.backup)
    })
    for (const { id, path } of changed) documents[id] = { ...documents[id], path: went.get(path) ?? path }

    // The whole library, to restore from: only when it's all going, and never what's kept on this device only.
    let backup: string | null = null
    if (which === null) {
      const { content } = await takeBackup(undefined, (item) => !item.deviceOnly)
      const asked = list.backup ?? BACKUP
      backup = (await writeAll([{ path: asked, data: content, fresh: !list.backup }], used)).get(asked) ?? asked
      await keepList({ ...list.documents, ...documents }, backup)
    }

    // Nib's files no longer wanted: those of documents gone, moved or renamed, and the backup when it's no longer all.
    const keeping = new Set([...Object.values(documents).map((written) => key(written.path)), ...(backup ? [key(backup)] : [])])
    const remove = [...Object.values(list.documents).map((written) => written.path), ...(list.backup ? [list.backup] : [])].filter((path) => !keeping.has(key(path)))
    if (remove.length > 0) await folderPlugin.write({ files: [], remove })

    await keepList(documents, backup)
    return done({ at: now, day, written: changed.length, removed: remove.length })
  } catch (error) {
    const code = (error as { code?: unknown }).code
    console.warn('Nib: could not back up to the folder', error)
    return done({ at: now, day, failed: code === 'lost' || code === 'none' ? 'lost' : code === 'refused' ? 'refused' : 'error' })
  }
}

/** Once a day, the first time Nib is open: if a folder's been chosen, and it hasn't been tried today. */
export async function backUpIfDue(now = Date.now()): Promise<Last | null> {
  if (lastBackup()?.day === localDay(now)) return null
  const kept = await folderPlugin.folder().catch(() => ({}) as { name?: string; lost?: boolean })
  if (!kept.name && !kept.lost) return null
  return backUp(now)
}
