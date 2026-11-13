import Dexie from 'dexie'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { db, type Item, type Revision } from '../db/db'
import * as revisions from '../db/revisions'
import { BackupError, buildBackup, folderPreferences, parseBackup, savedLookPreferences, putBack, serializeBackup, type BackupFile, type BackupPreferences } from './backup'
import { createSaveQueue } from './saveQueue'
import { readSort } from './sort'
import { readTheme } from './theme'

/**
 * The iOS app's copy of everything, kept where iOS will not clear it.
 *
 * In the app, IndexedDB lives in the web view's storage, which iOS may clear to
 * free space — and it holds the only copy of the writing. So every change is
 * also written, as lossless backups, to files in the app's Documents folder:
 * never cleared by the system, and included in device backups. IndexedDB stays
 * the working copy. The files are read back only when that copy comes up empty.
 *
 * One backup file (lib/backup) for each document with its latest versions, one
 * more for each PACK of its older versions, and an index that says which files
 * are the library. A change writes only the files it changed, so a pause in
 * writing costs one document's work however long the library is.
 *
 * What makes a crash at any moment safe: the index is the only thing that
 * names files. A file is written under a number nothing names yet, the index
 * then names it, and only after that are the files it replaced deleted. A file
 * the index doesn't name is never read, so half a file, or one left of a
 * document since deleted, can't come back.
 */

/** Holds the library's files and their index. */
export const MIRROR_DIR = 'nib-library'
export const MIRROR_INDEX = `${MIRROR_DIR}/index.json`
// Written first, then renamed over MIRROR_INDEX. Capacitor's writeFile is not
// atomic, and its rename deletes the destination before moving — so a crash
// can leave either file torn or missing, but never both.
const INDEX_TEMP = `${MIRROR_INDEX}.tmp`
/**
 * Through 1.10.09 everything was one file, rewritten whole. Still read for what
 * isn't in MIRROR_DIR yet, and deleted once all of it is, and has been checked.
 */
export const MIRROR_FILE = 'nib-library.json'
export const MIRROR_TEMP = 'nib-library.json.tmp'
const DELAY = 1000
const documents = { directory: Directory.Documents }
// The Filesystem plugin's code for a file that isn't there, or its web stand-in's words for it.
const NOT_FOUND = 'OS-PLUG-FILE-0008'
const missing = (error: unknown) => (error as { code?: unknown }).code === NOT_FOUND || /does not exist/.test((error as { message?: string }).message ?? '')

/** Versions in one file: enough that most documents are one file, few enough that a long document's save is one small write. */
const PACK = 16
/** Documents written between one naming of them in the index and the next. */
const COMMIT_EVERY = 64
/** Files read at once, to bring a library back. */
const READ_AT_ONCE = 32
/** Between one of the old file's documents and the next, or one file checked and the next (ms): typing comes first. */
const BREATHER = 8
const breather = () => new Promise((resolve) => setTimeout(resolve, BREATHER))

/** A document's files, the first its text and latest versions. `keys` says what each held, from the database's keys alone (`partKeys`): none, for one to be written again, whose files are still the best copy until it is. `files` is null for one only the old file has yet. */
type Entry = { keys: string[]; files: number[] | null }

type Index = {
  kind: typeof INDEX_KIND
  version: 1
  /** The number the next file is written under. */
  next: number
  /** Sync's epoch, which a restore moves: every document may then be something else under the same `rev`. */
  epoch: number
  /** The old file may still be there. */
  old: boolean
  preferences: BackupPreferences
  documents: Record<string, Entry>
}

const INDEX_KIND = 'nib-mirror'
const partPath = (file: number) => `${MIRROR_DIR}/${file}.json`

function asIndex(text: string): Index | null {
  let raw: Partial<Index> | null
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || raw.kind !== INDEX_KIND || raw.version !== 1 || typeof raw.next !== 'number' || typeof raw.documents !== 'object' || raw.documents === null) return null
  const whole = Object.values(raw.documents).every((entry) => Array.isArray(entry?.keys) && (entry.files === null || (Array.isArray(entry.files) && (entry.keys.length === 0 || entry.files.length === entry.keys.length))))
  return whole ? (raw as Index) : null
}

// Set by a restore that fails: the files may then hold writing the database
// doesn't, so nothing is written over them for the rest of the session.
let restoreFailed = false
// The same, kept across launches: left by a failed restore, gone once a
// restore brings the file back, or once it is kept aside under its own name.
// Only this session's flag, the next launch found writing typed since in the
// database, restored nothing, and the mirror wrote that over the library.
const HELD = 'nib-library.held'

async function readText(path: string): Promise<string | null> {
  try {
    const { data } = await Filesystem.readFile({ path, ...documents, encoding: Encoding.UTF8 })
    return typeof data === 'string' ? data : null
  } catch (error) {
    if (missing(error)) return null // not written yet
    throw error
  }
}

function deleteIfThere(path: string) {
  return Filesystem.deleteFile({ path, ...documents }).catch((error: unknown) => {
    if (!missing(error)) throw error
  })
}

const there = (path: string) =>
  Filesystem.stat({ path, ...documents }).then(
    () => true,
    (error: unknown) => {
      if (missing(error)) return false
      throw error
    },
  )

/**
 * Before anything renders: if the web view's database is empty and the files
 * are not, the database was cleared under us. Put it back.
 *
 * Empty means no items *and* no revisions. A writer who emptied their trash
 * still has an empty database, but the mirror caught up a second later (it
 * writes an empty library once it has seen the session's writing), so there is
 * nothing to restore — unless the app died inside that second, when the purged
 * notes come back. Resurrecting is the right way to be wrong.
 *
 * Throws if there is a file it can't read or restore, and the mirror is then
 * not written for the rest of the session. At the next launch it tries again
 * if the database is still empty; if there is writing in it by then, the files
 * are first kept aside, under `.unrestored-<time>` names.
 */
export async function restoreFromMirror(): Promise<boolean> {
  restoreFailed = true // until it has finished
  let restored: boolean
  try {
    restored = await restoreIfCleared()
  } catch (error) {
    await Filesystem.writeFile({ path: HELD, data: '', ...documents, encoding: Encoding.UTF8 }).catch(() => {})
    throw error
  }
  if ((await readText(HELD)) !== null) {
    if (!restored) await keepAside()
    await Filesystem.deleteFile({ path: HELD, ...documents })
  }
  restoreFailed = false
  return restored
}

/** Renamed, not copied: nothing of it has to be read, which is what failed. */
async function keepAside() {
  const at = Date.now()
  for (const path of [MIRROR_FILE, MIRROR_TEMP, MIRROR_DIR]) {
    await Filesystem.rename({ from: path, to: `${path}.unrestored-${at}`, directory: Directory.Documents, toDirectory: Directory.Documents }).catch(
      (error: unknown) => {
        if (!missing(error)) throw error
      },
    )
  }
}

async function restoreIfCleared(): Promise<boolean> {
  const [itemCount, revisionCount] = await Promise.all([db.items.count(), db.revisions.count()])
  if (itemCount > 0 || revisionCount > 0) return false

  let damaged: BackupError | undefined
  try {
    const index = await readIndex()
    if (index) return await restoreFromFiles(index)
  } catch (error) {
    if (!(error instanceof BackupError)) throw error
    damaged = error
  }
  // Nothing a crash leaves. The old file, while it's still there, then.
  const old = await readOldFile()
  if (old) {
    await putBack(old)
    return true
  }
  if (damaged) throw damaged
  return false
}

/** The index, from its temp file if a crash left only that (see above). Null if there has never been one. */
async function readIndex(): Promise<Index | null> {
  let torn = false
  for (const path of [MIRROR_INDEX, INDEX_TEMP]) {
    const text = await readText(path)
    if (text === null) continue
    const index = asIndex(text)
    if (index) return index
    torn = true
  }
  if (torn) throw new BackupError('This backup is damaged.')
  return null
}

/** The old file, or its temp if that's the whole one. A crash leaves at most one copy torn: both unreadable is something else, and may be the only copy of the writing. */
async function readOldFile(): Promise<BackupFile | null> {
  let damaged: BackupError | undefined
  for (const path of [MIRROR_FILE, MIRROR_TEMP]) {
    const text = await readText(path)
    if (text === null) continue
    try {
      return parseBackup(text)
    } catch (error) {
      // A torn file: try the other one. Anything else is the file system failing.
      if (!(error instanceof BackupError)) throw error
      damaged = error
    }
  }
  if (damaged) throw damaged
  return null
}

/** Exactly what the index names, and from the old file only what it says isn't anywhere else yet: a document deleted since stays deleted. */
async function restoreFromFiles(index: Index): Promise<boolean> {
  const entries = Object.entries(index.documents)
  const waiting = new Set(entries.filter(([, entry]) => !entry.files).map(([id]) => id))
  const old = waiting.size > 0 ? await readOldFile() : null
  const items: Item[] = old ? old.items.filter((item) => waiting.has(item.id)) : []
  const history: Revision[] = old ? old.revisions.filter((revision) => waiting.has(revision.itemId)) : []
  const files = entries.flatMap(([, entry]) => entry.files ?? [])
  for (let at = 0; at < files.length; at += READ_AT_ONCE) {
    await Promise.all(
      files.slice(at, at + READ_AT_ONCE).map(async (file) => {
        const text = await readText(partPath(file))
        if (text === null) throw new BackupError('This backup is damaged.')
        const part = parseBackup(text)
        items.push(...part.items)
        history.push(...part.revisions)
      }),
    )
  }
  if (items.length === 0 && history.length === 0) return false
  await putBack({ items, revisions: history, preferences: index.preferences })
  return true
}

/** How many of a document's versions are in full packs: all but the last few, the newest always with the document. */
const packsOf = (versions: number) => Math.floor(Math.max(0, versions - 1) / PACK)

/** What each of a document's files holds, from its `rev` and its versions' times, oldest first. A save moves `rev`, so only the first file is rewritten. */
function partKeys(rev: number | undefined, times: number[]): string[] {
  const keys = [`${rev}/${times.length}/${times.at(-1)}`]
  for (let pack = 0; pack < packsOf(times.length); pack++) keys.push(`${times[pack * PACK]}/${times[(pack + 1) * PACK - 1]}`)
  return keys
}

/** What the database holds, by its keys alone: no document's text is read. */
async function shelf(): Promise<{ wanted: Map<string, string[]>; epoch: number }> {
  const [ids, pairs, versions, epoch] = await Promise.all([
    db.items.toCollection().primaryKeys(),
    db.items.orderBy('[id+rev]').keys() as unknown as Promise<[string, number][]>,
    db.revisions.orderBy('[itemId+createdAt]').keys() as unknown as Promise<[string, number][]>,
    db.syncMeta.get('epoch'),
  ])
  const rev = new Map(pairs)
  const times = new Map<string, number[]>(ids.map((id) => [id, []]))
  for (const [id, at] of versions) {
    const list = times.get(id)
    if (list) list.push(at)
    else times.set(id, [at])
  }
  return { wanted: new Map([...times].map(([id, at]) => [id, partKeys(rev.get(id), at)])), epoch: epoch?.v ?? 0 }
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((key, i) => key === b[i])

/**
 * Write the mirror a second after the database last changed, and at once when
 * the app goes to the background — iOS may end it there without warning.
 * Returns a stop function.
 */
export function startMirror(onError: (error: unknown) => void, delay = DELAY): () => void {
  if (restoreFailed) return () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  // Chained, so two writes never share a file.
  const enqueue = createSaveQueue(onError)
  // Whether this session's library has had anything in it.
  let seen = false
  // A write under way gives way to one asked for since, which starts with what has just changed.
  let newer = false
  let index: Index | null = null
  // Changed since the index on disk: to be written, whatever else happens.
  let unsaved = false

  async function saveIndex() {
    await Filesystem.writeFile({ path: INDEX_TEMP, data: JSON.stringify(index), ...documents, encoding: Encoding.UTF8, recursive: true })
    await Filesystem.rename({ from: INDEX_TEMP, to: MIRROR_INDEX, directory: Directory.Documents, toDirectory: Directory.Documents })
    unsaved = false
  }

  /** The index on disk or, the first time, one saying the old file has everything. Then any file it doesn't name, left by a crash, goes. */
  async function openIndex(wanted: Map<string, string[]>, epoch: number): Promise<Index> {
    let found: Index | null = null
    try {
      found = await readIndex()
    } catch (error) {
      if (!(error instanceof BackupError)) throw error
    }
    // A crash inside the rename left only the temp: made the index again, before the next write has to overwrite it.
    if (found && !(await there(MIRROR_INDEX))) await Filesystem.rename({ from: INDEX_TEMP, to: MIRROR_INDEX, directory: Directory.Documents, toDirectory: Directory.Documents })
    const made: Index = found ?? {
      kind: INDEX_KIND,
      version: 1,
      next: 1,
      epoch,
      old: (await there(MIRROR_FILE)) || (await there(MIRROR_TEMP)),
      preferences: {},
      documents: Object.fromEntries([...wanted].map(([id, keys]) => [id, { keys, files: null }])),
    }
    unsaved = !found
    const named = new Set(Object.values(made.documents).flatMap((entry) => (entry.files ?? []).map((file) => `${file}.json`)))
    const { files } = await Filesystem.readdir({ path: MIRROR_DIR, ...documents }).catch(() => ({ files: [] }))
    for (const { name } of files) if (/^\d+\.json$/.test(name) && !named.has(name)) await deleteIfThere(`${MIRROR_DIR}/${name}`)
    return made
  }

  /** One document's files that changed, each under a new number. `dropped`: those it replaced, for after the index no longer names them. */
  async function writeDocument(id: string, current: Index, dropped: number[]) {
    const [item, versions] = await db.transaction('r', db.items, db.revisions, () => Promise.all([db.items.get(id), revisions.list(id)]))
    if (!item && versions.length === 0) return
    versions.reverse()
    const entry = current.documents[id] as Entry | undefined
    const keys = partKeys(item?.rev, versions.map((version) => version.createdAt))
    const packs = packsOf(versions.length)
    const at = Date.now()
    const files: number[] = []
    for (const [part, key] of keys.entries()) {
      if (entry?.files && entry.keys[part] === key) {
        files.push(entry.files[part])
        continue
      }
      const held = part === 0 ? versions.slice(packs * PACK) : versions.slice((part - 1) * PACK, part * PACK)
      const file = current.next++
      await Filesystem.writeFile({ path: partPath(file), data: serializeBackup(buildBackup(part === 0 && item ? [item] : [], held, {}, at)), ...documents, encoding: Encoding.UTF8, recursive: true })
      files.push(file)
    }
    dropped.push(...(entry?.files ?? []).filter((file) => !files.includes(file)))
    current.documents[id] = { keys, files }
    unsaved = true
  }

  /** Every file read back and found whole before the old file goes. False if one isn't: it's written again next time. */
  async function checked(current: Index): Promise<boolean> {
    for (const [id, entry] of Object.entries(current.documents)) {
      for (const file of entry.files ?? []) {
        if (newer) return false
        await breather()
        const text = await readText(partPath(file))
        let whole = false
        try {
          const part = text === null ? null : parseBackup(text)
          whole = part !== null && part.items.every((item) => item.id === id) && part.revisions.every((revision) => revision.itemId === id)
        } catch (error) {
          if (!(error instanceof BackupError)) throw error
        }
        if (!whole) {
          entry.keys = []
          unsaved = true
          return false
        }
      }
    }
    return true
  }

  async function bringUpToDate() {
    newer = false
    const { wanted, epoch } = await shelf()
    // An empty library only once there was writing to empty: then the
    // writer emptied it here. Otherwise something else emptied the
    // database, and the files may be the only copy left.
    if (wanted.size === 0 && !seen) return
    seen = true
    index ??= await openIndex(wanted, epoch)
    const current = index
    if (current.epoch !== epoch) {
      for (const entry of Object.values(current.documents)) entry.keys = []
      current.epoch = epoch
      unsaved = true
    }
    const preferences = { theme: readTheme(), sort: readSort(), ...folderPreferences(), ...savedLookPreferences() }
    if (JSON.stringify(current.preferences) !== JSON.stringify(preferences)) {
      current.preferences = preferences
      unsaved = true
    }

    const dropped: number[] = []
    for (const [id, entry] of Object.entries(current.documents)) {
      if (wanted.has(id)) continue
      dropped.push(...(entry.files ?? []))
      delete current.documents[id]
      unsaved = true
    }
    // What was just written first, then what only the old file has.
    const fresh: string[] = []
    const later: string[] = []
    for (const [id, keys] of wanted) {
      const entry = current.documents[id] as Entry | undefined
      if (!entry || (entry.keys.length > 0 && !same(entry.keys, keys))) fresh.push(id)
      else if (!entry.files || entry.keys.length === 0) later.push(id)
    }

    const commit = async () => {
      if (unsaved) await saveIndex()
      for (const file of dropped.splice(0)) await deleteIfThere(partPath(file))
    }
    const writeAll = async (ids: string[], gently: boolean) => {
      for (const [at, id] of ids.entries()) {
        if (newer) return
        await writeDocument(id, current, dropped)
        if (gently) await breather()
        if ((at + 1) % COMMIT_EVERY === 0 || document.visibilityState === 'hidden') await commit()
      }
    }
    // Named at once, before the rest of a long first run: the app may be on its way out.
    await writeAll(fresh, false)
    await commit()
    // The rest newest first: the writing most likely to be missed is the first to be safe.
    if (later.length > 1) {
      const byTime = () => db.items.orderBy('[kind+updatedAt]')
      // One read of both: a document added between two would put them out of step.
      const [times, ids] = await db.transaction('r', db.items, () => Promise.all([byTime().keys() as unknown as Promise<[string, number][]>, byTime().primaryKeys()]))
      const newest = new Map(ids.map((id, at) => [id, times[at][1]]))
      later.sort((a, b) => (newest.get(b) ?? 0) - (newest.get(a) ?? 0))
    }
    await writeAll(later, true)
    await commit()
    if (newer || !current.old || Object.values(current.documents).some((entry) => !entry.files)) return

    if (await checked(current)) {
      await deleteIfThere(MIRROR_FILE)
      await deleteIfThere(MIRROR_TEMP)
      current.old = false
      unsaved = true
    }
    if (unsaved) await saveIndex()
  }

  function write() {
    clearTimeout(timer)
    timer = undefined
    newer = true
    return enqueue(bringUpToDate)
  }

  function onMutated(parts: Record<string, unknown>) {
    // The writing, not sync's own bookkeeping, which moves on every poll.
    if (!Object.keys(parts).some((part) => part.startsWith(`idb://${db.name}/items/`) || part.startsWith(`idb://${db.name}/revisions/`))) return
    clearTimeout(timer)
    // On its way off screen, while iOS is still letting it run.
    timer = setTimeout(write, document.visibilityState === 'hidden' ? 0 : delay)
  }

  function onHide() {
    if (document.visibilityState === 'hidden' && timer !== undefined) void write()
  }

  Dexie.on('storagemutated', onMutated)
  document.addEventListener('visibilitychange', onHide)
  // Once at start, so a library written before the mirror existed gets a copy
  // without waiting for its next edit, and what the last session didn't get
  // written does. A moment on: the first cards come first.
  timer = setTimeout(write, delay)

  return () => {
    clearTimeout(timer)
    Dexie.on('storagemutated').unsubscribe(onMutated)
    document.removeEventListener('visibilitychange', onHide)
  }
}
