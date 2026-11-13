// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import * as items from '../db/items'
import * as revisions from '../db/revisions'
import { plainText } from './text'
import * as vault from './vault'

// Capacitor's Filesystem, reduced to a map of path to text, with the same
// rename semantics (the destination is deleted, then the source moved) and the
// same error for a missing file. `killAt`, a number of operations: the app dies
// in that one (a write leaves half its text, a rename only its delete) and
// nothing after it happens.
const fileSystem = vi.hoisted(() => ({ files: new Map<string, string>(), calls: [] as string[], killAt: Infinity, ops: 0, killPath: '' }))
const { files, calls } = fileSystem
vi.mock('@capacitor/filesystem', () => {
  const missing = (what: string) => Object.assign(new Error(`'${what}' failed because file does not exist.`), { code: 'OS-PLUG-FILE-0008' })
  const killed = () => new Error('killed')
  // Whether this operation is the one the app dies in, or after. `killPath`: dies in the first write of that file.
  const step = (path?: string) => {
    const now = fileSystem.ops++
    if (path && path === fileSystem.killPath) fileSystem.killAt = now
    return now < fileSystem.killAt ? 'whole' : now === fileSystem.killAt ? 'torn' : 'dead'
  }
  return {
    Directory: { Documents: 'DOCUMENTS' },
    Encoding: { UTF8: 'utf8' },
    Filesystem: {
      readFile: async ({ path }: { path: string }) => {
        if (!fileSystem.files.has(path)) throw missing('readFile')
        return { data: fileSystem.files.get(path)! }
      },
      stat: async ({ path }: { path: string }) => {
        if (!fileSystem.files.has(path)) throw missing('stat')
        return { size: fileSystem.files.get(path)!.length }
      },
      readdir: async ({ path }: { path: string }) => ({ files: [...fileSystem.files.keys()].filter((name) => name.startsWith(`${path}/`)).map((name) => ({ name: name.slice(path.length + 1) })) }),
      writeFile: async ({ path, data }: { path: string; data: string }) => {
        const state = step(path)
        if (state === 'dead') throw killed()
        if (state === 'torn') {
          fileSystem.files.set(path, data.slice(0, Math.floor(data.length / 2)))
          throw killed()
        }
        fileSystem.calls.push(`write ${path}`)
        fileSystem.files.set(path, data)
        return { uri: path }
      },
      rename: async ({ from, to }: { from: string; to: string }) => {
        const state = step()
        if (state === 'dead') throw killed()
        const inside = [...fileSystem.files.keys()].filter((path) => path.startsWith(`${from}/`))
        if (inside.length) {
          for (const path of inside) {
            fileSystem.files.set(`${to}${path.slice(from.length)}`, fileSystem.files.get(path)!)
            fileSystem.files.delete(path)
          }
          return
        }
        if (!fileSystem.files.has(from)) throw missing('rename')
        fileSystem.files.delete(to)
        if (state === 'torn') throw killed()
        fileSystem.calls.push(`rename ${from} -> ${to}`)
        fileSystem.files.set(to, fileSystem.files.get(from)!)
        fileSystem.files.delete(from)
      },
      deleteFile: async ({ path }: { path: string }) => {
        const state = step()
        if (state === 'dead') throw killed()
        if (!fileSystem.files.delete(path)) throw missing('deleteFile')
        fileSystem.calls.push(`delete ${path}`)
        if (state === 'torn') throw killed()
      },
    },
  }
})

const { MIRROR_DIR, MIRROR_FILE, MIRROR_INDEX, MIRROR_TEMP, restoreFromMirror, startMirror } = await import('./mirror')
const { serializeBackup, buildBackup } = await import('./backup')
const { readSavedLooks, replaceSavedLooks, saveLook } = await import('./look')

const INDEX_TEMP = `${MIRROR_INDEX}.tmp`
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const stored = async () => (await db.items.toArray()).map((item) => plainText(item.body)).sort()
const index = () => JSON.parse(files.get(MIRROR_INDEX)!) as { documents: Record<string, { keys: string[]; files: number[] | null }>; old: boolean }
const partsOf = (id: string) => (index().documents[id].files ?? []).map((file) => JSON.parse(files.get(`${MIRROR_DIR}/${file}.json`)!))
/** What the mirror holds: what its index names, and only that. */
const mirrored = () =>
  files.has(MIRROR_INDEX)
    ? Object.keys(index().documents)
        .flatMap((id) => partsOf(id).flatMap((part) => part.items.map((item: { body: never }) => plainText(item.body))))
        .sort()
    : []
const inFolder = () => [...files.keys()].filter((path) => path.startsWith(`${MIRROR_DIR}/`) && /\/\d+\.json$/.test(path))
// Long enough for a write the mirror shouldn't make to have landed.
const settle = () => new Promise((resolve) => setTimeout(resolve, 100))
const clearDatabase = async () => {
  await db.items.clear()
  await db.revisions.clear()
}

// Files holding these notes, and a database iOS has since cleared.
async function mirrorOf(...texts: string[]) {
  for (const text of texts) await items.create('note', doc(text))
  stop = startMirror(vi.fn(), 20)
  await vi.waitFor(() => expect(mirrored()).toEqual([...texts].sort()))
  await settle()
  stop()
  stop = undefined
  await clearDatabase()
}

/** The whole library as 1.10.09 wrote it, in one file. */
async function oldFileOf(...texts: string[]) {
  for (const text of texts) await items.create('note', doc(text), { id: text })
  const all = await items.listAll()
  files.set(MIRROR_FILE, serializeBackup(buildBackup(all, await revisions.listAll(), {}, Date.now())))
}

let stop: (() => void) | undefined

beforeEach(async () => {
  await clearDatabase()
  await db.syncMeta.clear()
  files.clear()
  calls.length = 0
  fileSystem.killAt = Infinity
  fileSystem.killPath = ''
  fileSystem.ops = 0
  // A restore that failed in an earlier test leaves the mirror off; a clean one
  // turns it back on.
  await restoreFromMirror()
})

afterEach(() => {
  stop?.()
  stop = undefined
})

describe('startMirror', () => {
  it('copies the library at start: a file for the document, then the index, by way of its temp file', async () => {
    await items.create('note', doc('Before the mirror existed'))
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(files.has(MIRROR_INDEX)).toBe(true))
    expect(mirrored()).toEqual(['Before the mirror existed'])
    expect(files.has(INDEX_TEMP)).toBe(false)
    expect(calls.slice(-3)).toEqual([`write ${MIRROR_DIR}/1.json`, `write ${INDEX_TEMP}`, `rename ${INDEX_TEMP} -> ${MIRROR_INDEX}`])
  })

  it('writes again shortly after the database changes', async () => {
    stop = startMirror(vi.fn(), 20)
    const id = await items.create('note', doc('First'))
    await vi.waitFor(() => expect(mirrored()).toEqual(['First']))
    await items.update(id, doc('First, edited'))
    await vi.waitFor(() => expect(mirrored()).toEqual(['First, edited']))
  })

  // A pause in writing rewrote the whole library, every version of every document.
  it('writes only the document that changed', async () => {
    await items.create('note', doc('Left alone'))
    const id = await items.create('note', doc('Being written'))
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(mirrored()).toHaveLength(2))
    await settle()
    calls.length = 0
    await items.update(id, doc('Being written, more'))
    await vi.waitFor(() => expect(mirrored()).toEqual(['Being written, more', 'Left alone']))
    expect(calls.filter((call) => call.startsWith('write') && !call.includes('index'))).toHaveLength(1)
  })

  it('at start writes nothing that has not changed', async () => {
    await items.create('note', doc('Up to date'))
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(mirrored()).toEqual(['Up to date']))
    await settle()
    stop()
    calls.length = 0
    stop = startMirror(vi.fn(), 20)
    await settle()
    await settle()
    expect(calls).toEqual([])
  })

  // A few hundred versions of a long page were read and written on each pause.
  it('keeps a long history in packs, and writes only the newest again', async () => {
    const id = await items.create('page', doc('A long page'))
    for (let i = 1; i <= 40; i++) await db.revisions.add({ id: `r${i}`, itemId: id, body: doc(`Version ${i}`), createdAt: i })
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(mirrored()).toEqual(['A long page']))
    await settle()
    expect(partsOf(id).flatMap((part) => part.revisions)).toHaveLength(41)
    expect(partsOf(id).length).toBeGreaterThan(2)
    calls.length = 0
    await items.update(id, doc('A long page, longer'), { record: false })
    await vi.waitFor(() => expect(mirrored()).toEqual(['A long page, longer']))
    expect(calls.filter((call) => call.startsWith('write') && !call.includes('index'))).toHaveLength(1)
  })

  // A synced device polls for hours with nothing written: every poll moved the
  // sync cursor, and each one rewrote the whole library file.
  it('takes no notice of sync’s own bookkeeping', async () => {
    stop = startMirror(vi.fn(), 20)
    await items.create('note', doc('Mirrored once'))
    await vi.waitFor(() => expect(mirrored()).toEqual(['Mirrored once']))
    await settle()
    calls.length = 0
    await db.syncMeta.put({ k: 'cursor', v: 7 })
    await db.syncRecords.put({ k: 'x', type: 'item', id: 'x', seq: 1 })
    await settle()
    expect(calls).toEqual([])
  })

  it('writes at once when the app goes to the background', async () => {
    stop = startMirror(vi.fn(), 60_000)
    await items.create('note', doc('Written just before leaving'))

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(mirrored()).toEqual(['Written just before leaving']))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  // The editor's last save lands just after Nib has gone: the words the writer
  // typed last, and the second's wait may be more than iOS gives.
  it('writes what lands while it’s away at once too', async () => {
    stop = startMirror(vi.fn(), 60_000)
    await settle()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    await items.create('note', doc('Saved on the way out'))
    await vi.waitFor(() => expect(mirrored()).toEqual(['Saved on the way out']))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('reports a failed write rather than throwing', async () => {
    const { Filesystem } = await import('@capacitor/filesystem')
    const spy = vi.spyOn(Filesystem, 'writeFile').mockRejectedValueOnce(new Error('disk full'))
    await items.create('note', doc('Not copied'))
    const onError = vi.fn()
    stop = startMirror(onError, 20)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
    spy.mockRestore()
  })

  // Otherwise a writer who deleted everything got it all back at the next
  // launch, restored from the file into the empty database.
  it('writes an empty library once this session has had writing in it', async () => {
    const id = await items.create('note', doc('Deleted for good'))
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(mirrored()).toEqual(['Deleted for good']))

    await items.remove(id)
    await items.purge(id)
    await vi.waitFor(() => expect(mirrored()).toEqual([]))
    await vi.waitFor(() => expect(inFolder()).toEqual([]))
    expect(index().documents).toEqual({})
  })

  it('never writes an empty library over the files', async () => {
    await mirrorOf('Only in the files')
    stop = startMirror(vi.fn(), 20)
    await settle()
    expect(mirrored()).toEqual(['Only in the files'])
  })

  it('holds a locked document as sealed as the database does', async () => {
    const id = await items.create('note', doc('A secret line'))
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(mirrored()).toEqual(['A secret line']))
    await vault.openVault('harbour lights', [])
    await items.lock(id, doc('A secret line'))
    await vi.waitFor(() => expect([...files.values()].some((text) => text.includes('A secret line'))).toBe(false))
    const [head] = partsOf(id)
    expect(head.items[0].vault).toBeTruthy()
    expect(head.revisions).toEqual([])
  })

  it('after a restore from a file, writes every document again, whatever its rev says', async () => {
    const id = await items.create('note', doc('Before the restore'), { id: 'same' })
    await items.update(id, doc('Before the restore, edited'))
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(mirrored()).toEqual(['Before the restore, edited']))
    await settle()
    const backup = serializeBackup(buildBackup([{ ...(await items.get(id))!, body: doc('From the backup'), version: 2, rev: 2 }], await revisions.listAll(), {}, Date.now()))
    const { restoreBackup } = await import('./backup')
    await restoreBackup(backup)
    await vi.waitFor(() => expect(mirrored()).toEqual(['From the backup']))
  })
})

describe('the old single file', () => {
  it('still brings a library back when there is no index', async () => {
    await oldFileOf('Mirrored by 1.10.09', 'And another')
    await clearDatabase()
    expect(await restoreFromMirror()).toBe(true)
    expect(await stored()).toEqual(['And another', 'Mirrored by 1.10.09'])
  })

  it('takes its temp copy when the file itself is torn', async () => {
    await oldFileOf('In the temp copy')
    files.set(MIRROR_TEMP, files.get(MIRROR_FILE)!)
    files.set(MIRROR_FILE, '{"kind":"nib-backup","ver') // cut off mid-write
    await clearDatabase()
    expect(await restoreFromMirror()).toBe(true)
    expect(await stored()).toEqual(['In the temp copy'])
  })

  it('goes once every document is in its own file and has been read back whole', async () => {
    await oldFileOf('Mirrored by 1.10.09')
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(mirrored()).toEqual(['Mirrored by 1.10.09']))
    await vi.waitFor(() => expect(files.has(MIRROR_FILE)).toBe(false))
    expect(index().old).toBe(false)
  })

  it('stays if a file reads back torn, and that file is written again', async () => {
    await oldFileOf('Mirrored by 1.10.09')
    const { Filesystem } = await import('@capacitor/filesystem')
    const reading = Filesystem.readFile
    const spy = vi.spyOn(Filesystem, 'readFile').mockImplementation(async (options) => (/\/\d+\.json$/.test(options.path) ? { data: '{"kind":"nib-backup"' } : reading(options)))
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(index().documents['Mirrored by 1.10.09'].keys).toEqual([]))
    expect(files.has(MIRROR_FILE)).toBe(true)
    spy.mockRestore()
  })

  it('stays if a file reads back as another document’s', async () => {
    await oldFileOf('Mirrored by 1.10.09')
    const stray = serializeBackup(buildBackup([{ id: 'somebody else', kind: 'note', body: doc('Not this one'), version: 1, rev: 1, createdAt: 1, updatedAt: 1 }], [], {}, 1))
    const { Filesystem } = await import('@capacitor/filesystem')
    const reading = Filesystem.readFile
    const spy = vi.spyOn(Filesystem, 'readFile').mockImplementation(async (options) => (/\/\d+\.json$/.test(options.path) ? { data: stray } : reading(options)))
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(index().documents['Mirrored by 1.10.09'].keys).toEqual([]))
    expect(files.has(MIRROR_FILE)).toBe(true)
    spy.mockRestore()
  })

  it('fills in what isn’t in its own file yet, and leaves out what has gone since', async () => {
    await oldFileOf('Not reached yet', 'Edited since', 'Deleted since', 'Trashed since')
    const { Filesystem } = await import('@capacitor/filesystem')
    const realRename = Filesystem.rename
    let renames = 1
    const dying = vi.spyOn(Filesystem, 'rename').mockImplementation(async (options) => {
      await realRename(options)
      if (--renames === 0) fileSystem.killAt = 0
    })
    // The first launch after updating, killed as soon as everything is named as the old file's.
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(files.has(MIRROR_INDEX)).toBe(true))
    await settle()
    stop()
    stop = undefined
    expect(index().documents['Not reached yet'].files).toBeNull()

    // The next launch: writing in it, and away, killed again once that is named.
    fileSystem.killAt = Infinity
    fileSystem.ops = 0
    renames = 2
    stop = startMirror(vi.fn(), 60_000)
    await items.update('Edited since', doc('Edited since, and newer'))
    await items.purge('Deleted since')
    await items.remove('Trashed since')
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(index().documents['Edited since'].files).not.toBeNull())
    await settle()
    dying.mockRestore()
    stop()
    stop = undefined
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })

    expect(index().documents['Not reached yet'].files).toBeNull()
    expect(index().documents['Trashed since'].files).not.toBeNull()
    expect(files.has(MIRROR_FILE)).toBe(true)
    fileSystem.killAt = Infinity
    await clearDatabase()
    expect(await restoreFromMirror()).toBe(true)
    expect(await stored()).toEqual(['Edited since, and newer', 'Not reached yet', 'Trashed since'])
    expect((await db.items.get('Trashed since'))!.deletedAt).toBeDefined()
    expect(await db.items.get('Deleted since')).toBeUndefined()
  })

  it('names what was just written before it starts on the rest of a long first run', async () => {
    const texts = Array.from({ length: 12 }, (_, i) => `Old ${i}`)
    await oldFileOf(...texts)
    const { Filesystem } = await import('@capacitor/filesystem')
    const realRename = Filesystem.rename
    const dying = vi.spyOn(Filesystem, 'rename').mockImplementation(async (options) => {
      await realRename(options)
      fileSystem.killAt = 0
    })
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(files.has(MIRROR_INDEX)).toBe(true))
    await settle()
    stop()
    stop = undefined
    dying.mockRestore()
    fileSystem.killAt = Infinity
    fileSystem.ops = 0
    calls.length = 0

    stop = startMirror(vi.fn(), 60_000)
    await items.update('Old 5', doc('Old 5, just typed'))
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(calls.some((call) => call.startsWith(`rename ${INDEX_TEMP}`))).toBe(true))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    const named = calls.findIndex((call) => call.startsWith(`rename ${INDEX_TEMP}`))
    expect(calls.slice(0, named).filter((call) => call.startsWith('write') && !call.includes('index'))).toHaveLength(1)
    expect(partsOf('Old 5')[0].items[0].body).toEqual(doc('Old 5, just typed'))
    await vi.waitFor(() => expect(files.has(MIRROR_FILE)).toBe(false), { timeout: 4000 })
  })
})

describe('a crash at any moment', () => {
  it('restores the last library named whole, at every step of a write', async () => {
    // A library in the mirror, and a session that edits one document, deletes one and adds one.
    const session = async () => {
      await items.update('Edited', doc('Edited, newer'))
      await items.purge('Deleted')
      await items.create('note', doc('Added'), { id: 'Added' })
    }
    const before = ['Deleted', 'Edited', 'Kept']
    const after = ['Added', 'Edited, newer', 'Kept']
    // The session is three saves, and any of them may be the last to get named: never a mix of them.
    const between = [before, ['Deleted', 'Edited, newer', 'Kept'], ['Edited, newer', 'Kept'], after]
    let reachedEnd = false
    for (let killAt = 0; !reachedEnd && killAt < 40; killAt++) {
      await clearDatabase()
      files.clear()
      fileSystem.killAt = Infinity
      for (const text of before) await items.create('note', doc(text), { id: text })
      stop = startMirror(vi.fn(), 10)
      await vi.waitFor(() => expect(mirrored()).toEqual(before))
      await settle()
      stop()
      stop = undefined

      fileSystem.ops = 0
      fileSystem.killAt = killAt
      stop = startMirror(vi.fn(), 10)
      await session()
      await settle()
      await settle()
      stop()
      stop = undefined
      reachedEnd = fileSystem.ops <= killAt

      // iOS clears the web view's storage; the next launch finds what the kill left.
      fileSystem.killAt = Infinity
      await clearDatabase()
      expect(await restoreFromMirror()).toBe(true)
      const now = await stored()
      expect(between, `killed at step ${killAt}: ${now}`).toContainEqual(now)
    }
    expect(reachedEnd).toBe(true)
  })

  // A restore or a change of sync code moves the epoch, and every document is
  // then written again. Stopped partway, the index it left couldn't be read
  // back, and the library it named was given up for lost, or deleted.
  describe('while a moved epoch has every document written again', () => {
    const TEXTS = ['A', 'B', 'C']
    const moveEpoch = () => db.transaction('rw', db.syncRecords, db.syncMeta, () => items.clearSyncState())
    /** A library in the mirror, the epoch moved, and a session that dies having named that and written no document. */
    async function cutShort() {
      for (const text of TEXTS) await items.create('note', doc(text), { id: text })
      stop = startMirror(vi.fn(), 10)
      await vi.waitFor(() => expect(mirrored()).toEqual(TEXTS))
      await settle()
      stop()
      stop = undefined
      await moveEpoch()
      await dies()
    }
    /** Dies in the first write after the index: two steps for that, by way of its temp file. */
    async function dies() {
      fileSystem.ops = 0
      fileSystem.killAt = 2
      stop = startMirror(vi.fn(), 10)
      await settle()
      await settle()
      stop()
      stop = undefined
      fileSystem.killAt = Infinity
    }

    it('brings the library back from the files it still names', async () => {
      await cutShort()
      expect(index().documents.A.keys).toEqual([])
      await clearDatabase()
      expect(await restoreFromMirror()).toBe(true)
      expect(await stored()).toEqual(TEXTS)
    })

    it('leaves those files alone at the next launch, so the library can still come back', async () => {
      await cutShort()
      await dies()
      for (const entry of Object.values(index().documents)) for (const file of entry.files ?? []) expect(files.has(`${MIRROR_DIR}/${file}.json`)).toBe(true)
      await clearDatabase()
      expect(await restoreFromMirror()).toBe(true)
      expect(await stored()).toEqual(TEXTS)
    })

    it('finishes the job at the next launch', async () => {
      await cutShort()
      stop = startMirror(vi.fn(), 10)
      await vi.waitFor(() => expect(Object.values(index().documents).every((entry) => entry.keys.length > 0)).toBe(true))
      await settle()
      expect(mirrored()).toEqual(TEXTS)
    })
  })

  it('never reads a file the index doesn’t name', async () => {
    await mirrorOf('Named')
    files.set(`${MIRROR_DIR}/99.json`, serializeBackup(buildBackup([{ id: 'leftover', kind: 'note', body: doc('A leftover'), version: 1, rev: 1, createdAt: 1, updatedAt: 1 }], [], {}, 1)))
    files.set(`${MIRROR_DIR}/100.json`, '{"kind":"nib-back')
    expect(await restoreFromMirror()).toBe(true)
    expect(await stored()).toEqual(['Named'])
  })

  it('clears up files nothing names', async () => {
    await mirrorOf('Named')
    files.set(`${MIRROR_DIR}/99.json`, 'left by a crash')
    await restoreFromMirror()
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(files.has(`${MIRROR_DIR}/99.json`)).toBe(false))
    await settle()
    expect(mirrored()).toEqual(['Named'])
  })

  it('finishes a rename a crash cut in half, before the next write can overwrite the only index', async () => {
    await mirrorOf('In the index')
    await items.create('note', doc('In the index'), { id: 'written' })
    files.set(INDEX_TEMP, files.get(MIRROR_INDEX)!)
    files.delete(MIRROR_INDEX)
    // And this launch dies in writing the temp, which without the rename finished would hold the only index.
    fileSystem.killPath = INDEX_TEMP
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(fileSystem.killAt).not.toBe(Infinity))
    await settle()
    stop()
    stop = undefined
    fileSystem.killAt = Infinity
    fileSystem.killPath = ''
    await clearDatabase()
    expect(await restoreFromMirror()).toBe(true)
    expect(await stored()).toEqual(['In the index'])
  })
})

describe('restoreFromMirror', () => {
  it('puts the library back when the database has been cleared', async () => {
    await mirrorOf('Survived', 'Also survived')
    expect(await restoreFromMirror()).toBe(true)
    expect(await stored()).toEqual(['Also survived', 'Survived'])
  })

  it('brings versions and preferences back too', async () => {
    const id = await items.create('note', doc('With a past'))
    await db.revisions.add({ id: 'old', itemId: id, body: doc('Its past'), createdAt: 5 })
    localStorage.setItem('nib-sort', 'title')
    saveLook('Drafting', 'light')
    stop = startMirror(vi.fn(), 20)
    await vi.waitFor(() => expect(mirrored()).toEqual(['With a past']))
    await settle()
    stop()
    stop = undefined
    await clearDatabase()
    localStorage.removeItem('nib-sort')
    replaceSavedLooks({})
    expect(await restoreFromMirror()).toBe(true)
    expect((await revisions.list(id)).map((version) => plainText(version.body))).toContain('Its past')
    expect(localStorage.getItem('nib-sort')).toBe('title')
    expect(Object.keys(readSavedLooks())).toEqual(['Drafting'])
    localStorage.removeItem('nib-sort')
    replaceSavedLooks({})
  })

  it('leaves a database that still has writing in it alone', async () => {
    await mirrorOf('Old copy')
    await items.create('note', doc('Newer, still in the database'))
    expect(await restoreFromMirror()).toBe(false)
    expect(await stored()).toEqual(['Newer, still in the database'])
  })

  it('finds the index in its temp file when a crash left only that', async () => {
    await mirrorOf('In the temp file')
    files.set(INDEX_TEMP, files.get(MIRROR_INDEX)!)
    files.set(MIRROR_INDEX, '{"kind":"nib-mir') // cut off mid-write
    expect(await restoreFromMirror()).toBe(true)
    expect(await stored()).toEqual(['In the temp file'])
  })

  it('does nothing on a first launch with no file', async () => {
    expect(await restoreFromMirror()).toBe(false)
    expect(await stored()).toEqual([])
  })

  it('fails, rather than finding no file, when the file can’t be read', async () => {
    await mirrorOf('Unreadable today')
    const { Filesystem } = await import('@capacitor/filesystem')
    const spy = vi.spyOn(Filesystem, 'readFile').mockRejectedValueOnce(new Error('The file couldn’t be opened.'))
    await expect(restoreFromMirror()).rejects.toThrow('couldn’t be opened')
    spy.mockRestore()
  })

  it('fails when a file is there but can’t be restored', async () => {
    await mirrorOf('One damaged record', 'and a good one')
    const name = `${MIRROR_DIR}/${Object.values(index().documents)[0].files![0]}.json`
    const part = JSON.parse(files.get(name)!)
    part.items[0].body = null
    files.set(name, JSON.stringify(part))
    await expect(restoreFromMirror()).rejects.toThrow('damaged')
    expect(await stored()).toEqual([])
  })

  it('writes nothing to the files for the rest of a session whose restore failed', async () => {
    await mirrorOf('Only in the files')
    const { Filesystem } = await import('@capacitor/filesystem')
    const spy = vi.spyOn(Filesystem, 'readFile').mockRejectedValueOnce(new Error('The file couldn’t be opened.'))
    await restoreFromMirror().catch(() => {})
    spy.mockRestore()

    await items.create('note', doc('Typed after the failed restore'))
    stop = startMirror(vi.fn(), 20)
    await settle()
    expect(mirrored()).toEqual(['Only in the files'])
  })

  // The failed restore held the files for one session only. At the next
  // launch the database had the note typed since, so nothing was restored,
  // and the mirror wrote that one note over the library in them.
  it('keeps a library it couldn’t bring back, under its own name, once there is writing here', async () => {
    await mirrorOf('One', 'Two', 'Three')
    const { Filesystem } = await import('@capacitor/filesystem')
    const spy = vi.spyOn(Filesystem, 'readFile').mockRejectedValueOnce(new Error('The file couldn’t be opened.'))
    await restoreFromMirror().catch(() => {})
    spy.mockRestore()
    await items.create('note', doc('Typed after the failed restore'))

    // The next launch.
    expect(await restoreFromMirror()).toBe(false)
    expect([...files.keys()].some((path) => path.startsWith(`${MIRROR_DIR}.unrestored-`))).toBe(true)
  })

  it('tries again at the next launch if the database is still empty, and keeps nothing aside then', async () => {
    await mirrorOf('Back next time')
    const { Filesystem } = await import('@capacitor/filesystem')
    const spy = vi.spyOn(Filesystem, 'readFile').mockRejectedValueOnce(new Error('The file couldn’t be opened.'))
    await restoreFromMirror().catch(() => {})
    spy.mockRestore()

    expect(await restoreFromMirror()).toBe(true)
    expect(await stored()).toEqual(['Back next time'])
    expect([...files.keys()].filter((path) => path.includes('.unrestored-'))).toEqual([])
  })
})
