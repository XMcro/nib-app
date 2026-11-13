import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import Dexie from 'dexie'
import { db, type Item, type Revision } from '../db/db'
import * as items from '../db/items'
import * as revisions from '../db/revisions'
import { restoreBackup, buildBackup, serializeBackup } from '../lib/backup'
import { LOCKED_BODY, unbox } from '../lib/vault'
import { plainText } from '../lib/text'
import { SyncHttpError, type Api, type Wire } from './api'
import { fakeServer } from './fakeServer'
import { deriveKeys, newCode, open, recordKey, seal, type SyncKeys } from './crypto'
import { expireHistory, fill, resetSyncState, SERVER_HISTORY_MS, syncOnce } from './engine'
import { BATCH_RECORDS } from '../../worker/wire.mjs'

const doc = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const MINUTE = 60_000
const HOUR = 3_600_000

let keys: SyncKeys
let server: ReturnType<typeof fakeServer>

/**
 * Another device with the same code, writing straight to the server; without
 * `n`, a Nib from before counts. `over`: the count of the version it edited.
 */
async function otherDevice(item: Omit<Item, 'version' | 'rev'>, n?: number, over?: number) {
  const k = await recordKey(keys, 'item', item.id)
  const base = server.records.get(k)?.s ?? 0
  const counts = { ...(n === undefined ? {} : { n }), ...(over === undefined ? {} : { b: over }) }
  const [result] = (await server.api.push([{ k, b: base, p: await seal(keys, k, { t: 'item', v: item, ...counts }) }])).results
  expect(result).toHaveProperty('s')
}

/**
 * Purged there: sealed, as Nib seals a delete, and counted on from the
 * version it replaces; `sealed: false` is a Nib from before that, or the
 * server making one up, and `n: null` a Nib from before counts.
 */
async function otherDeviceDeletes(
  id: string,
  { sealed = true, type = 'item' as 'item' | 'revision', n = undefined as number | null | undefined, over = undefined as number | undefined } = {},
) {
  const k = await recordKey(keys, type, id)
  const current = server.records.get(k)!
  const counted = type === 'item' && current.p ? ((await open(keys, k, current.p)) as { n?: number }).n : undefined
  n = n === undefined ? (counted === undefined ? undefined : Math.max(counted + 1, Date.now())) : n
  const counts = { ...(n === null || n === undefined ? {} : { n }), ...(over === undefined ? {} : { b: over }) }
  await server.api.push([{ k, b: current.s, d: 1, ...(sealed ? { p: await seal(keys, k, { t: 'gone', ...counts }) } : {}) }])
}

/** Counts what each pass sends, from now on. */
function countSent() {
  const pushes = server.api.push
  const sent = { records: 0 }
  server.api.push = async (batch) => ((sent.records += batch.length), pushes(batch))
  return sent
}

async function serverItem(id: string) {
  const k = await recordKey(keys, 'item', id)
  const record = server.records.get(k)
  if (!record || record.d) return record ? 'deleted' : undefined
  return ((await open(keys, k, record.p!)) as { v: Item }).v
}

async function otherDeviceRevision(revision: Revision) {
  const k = await recordKey(keys, 'revision', revision.id)
  await server.api.push([{ k, b: 0, p: await seal(keys, k, { t: 'revision', v: revision }) }])
}

const SEALED = { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) }
const SEALED_ELSEWHERE = { salt: 'A'.repeat(22), sealed: 'C'.repeat(40) }

/** Locked here, as items.lock leaves it: sealed, an empty body, no history. */
async function lockHere(id: string, sealed = SEALED, updatedAt = Date.now()) {
  const item = (await items.get(id))!
  await db.items.update(id, { vault: sealed, body: LOCKED_BODY, version: item.version + 1, rev: (item.rev ?? 0) + 1, updatedAt })
  await revisions.removeFor(id)
}

const copiesHere = async () => (await db.items.toArray()).filter((item) => item.unsealed)
/** A copy's text, kept boxed and never in the clear (vault `box`). */
const textOfCopy = async (copy: Item) => {
  expect(JSON.stringify(copy)).not.toMatch(/edit|Typed/)
  return copy.unsealed && 'box' in copy.unsealed ? unbox(copy.id, copy.unsealed.box) : null
}
const liveOnServer = () => [...server.records.values()].filter((record) => !record.d).length

const text = async (id: string) => plainText((await items.get(id))!.body)
const history = async (id: string) => (await revisions.list(id)).map((revision) => plainText(revision.body))

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.revisions.clear(), db.syncRecords.clear(), db.syncMeta.clear()])
  keys = await deriveKeys(newCode())
  server = fakeServer()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('syncOnce', () => {
  it('sends local writing up encrypted, where the server cannot read it', async () => {
    const id = await items.create('note', doc('Only on this phone'))
    await syncOnce(keys, server.api)
    expect(plainText((await serverItem(id) as Item).body)).toBe('Only on this phone')
    for (const record of server.records.values()) expect(record.p ?? '').not.toContain('phone')
  })

  it('brings down writing from another device', async () => {
    await otherDevice({ id: 'ipad-note', kind: 'page', body: doc('Written on the iPad'), createdAt: 1, updatedAt: 2 })
    const { changed } = await syncOnce(keys, server.api)
    expect(changed).toEqual(['ipad-note'])
    expect(await text('ipad-note')).toBe('Written on the iPad')
  })

  it('settles: a second pass has nothing to send or apply', async () => {
    await items.create('note', doc('Settled'))
    await otherDevice({ id: 'x', kind: 'note', body: doc('From elsewhere'), createdAt: 1, updatedAt: 2 })
    await syncOnce(keys, server.api)
    const before = [...server.records.values()].map((record) => record.s)
    expect((await syncOnce(keys, server.api)).changed).toEqual([])
    expect([...server.records.values()].map((record) => record.s)).toEqual(before)
  })

  // So the daily goal can leave them out: they weren't written here.
  it('says how many words each document gained or lost by sync', async () => {
    const id = await items.create('note', doc('one two'))
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: doc('one two three four five'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })
    await otherDevice({ id: 'new', kind: 'note', body: doc('arrives whole'), createdAt: 1, updatedAt: 2 })
    const { moved } = await syncOnce(keys, server.api)
    expect(moved).toEqual(new Map([[id, 3]]))
  })

  it('takes another device’s edit when this one has not changed since', async () => {
    const id = await items.create('note', doc('First draft'))
    await syncOnce(keys, server.api)
    const local = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: doc('Edited on the iPad'), createdAt: local.createdAt, updatedAt: local.updatedAt + 1000 })
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('Edited on the iPad')
    // And the editor holding the old text will notice on its next save.
    expect((await items.get(id))!.version).toBeGreaterThan(local.version)
  })

  it('on a real conflict, keeps the newer edit current and the other in history', async () => {
    const id = await items.create('note', doc('Original'))
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    // Saved without a history entry, so only the merge can put it there.
    await items.update(id, doc('Phone edit'), { record: false })
    await otherDevice({ id, kind: 'note', body: doc('iPad edit, later'), createdAt: created.createdAt, updatedAt: Date.now() + HOUR })
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('iPad edit, later')
    expect(await history(id)).toContain('Phone edit')
  })

  it('on a real conflict where this device is newer, keeps its edit and sends it up', async () => {
    const id = await items.create('note', doc('Original'))
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: doc('iPad edit, earlier'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })
    await items.update(id, doc('Phone edit, later'))
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('Phone edit, later')
    expect(await history(id)).toContain('iPad edit, earlier')
    expect(plainText((await serverItem(id) as Item).body)).toBe('Phone edit, later')
  })

  // The kept edit used to be the newest revision, so History called it
  // "Current", and the next save here within the coalesce window replaced it.
  it('on a conflict, keeps the other edit in history past the next save here', async () => {
    const id = await items.create('note', doc('Original'))
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await items.update(id, doc('Phone edit'), { record: false })
    await otherDevice({ id, kind: 'note', body: doc('iPad edit, later'), createdAt: created.createdAt, updatedAt: Date.now() + HOUR })
    // A minute on, the pass and the next save land in the same millisecond.
    vi.spyOn(Date, 'now').mockReturnValue(created.createdAt + MINUTE)
    await syncOnce(keys, server.api)
    expect((await history(id))[0]).toBe('iPad edit, later')

    await items.update(id, doc('iPad edit, later, then more'))
    expect(await history(id)).toEqual(['iPad edit, later, then more', 'Phone edit', 'Original'])
  })

  it('on a conflict where this device is newer, keeps the other edit in history past the next save here', async () => {
    const id = await items.create('note', doc('Original'))
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: doc('iPad edit, earlier'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })
    await items.update(id, doc('Phone edit, later'))
    // A minute on, the pass and the next save land in the same millisecond.
    vi.spyOn(Date, 'now').mockReturnValue(created.createdAt + MINUTE)
    await syncOnce(keys, server.api)
    expect((await history(id))[0]).toBe('Phone edit, later')

    await items.update(id, doc('Phone edit, later, then more'))
    expect(await history(id)).toEqual(['Phone edit, later, then more', 'iPad edit, earlier', 'Phone edit, later'])
  })

  it('on a conflict a locked document wins, keeps no history of its placeholder', async () => {
    const id = await items.create('note', doc('Original'))
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: doc('iPad edit, earlier'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })
    // Locked here since, as items.lock leaves it: sealed, and no past versions.
    const sealed = { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) }
    await db.items.update(id, { vault: sealed, body: LOCKED_BODY, rev: (created.rev ?? 0) + 1, updatedAt: Date.now() + HOUR })
    await revisions.removeFor(id)
    await syncOnce(keys, server.api)
    expect(await history(id)).not.toContain('')
  })

  it('syncs pins and the trash, not just text', async () => {
    const id = await items.create('note', doc('Pin me'))
    await syncOnce(keys, server.api)
    await items.setPinned(id, true)
    await items.remove(id)
    await syncOnce(keys, server.api)
    const remote = (await serverItem(id)) as Item
    expect(remote.pinnedAt).toBeTypeOf('number')
    expect(remote.deletedAt).toBeTypeOf('number')
  })

  it('syncs a document’s goal, and its removal', async () => {
    const id = await items.create('page', doc('Chapter one'))
    await items.setGoal(id, { words: 5000, deadline: '2026-11-30' })
    await syncOnce(keys, server.api)
    expect(((await serverItem(id)) as Item).goal).toEqual({ words: 5000, deadline: '2026-11-30' })

    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'page', body: doc('Chapter one'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1, goal: null })
    await syncOnce(keys, server.api)
    expect((await items.get(id))?.goal).toBeNull()
  })

  it('syncs a locked document sealed, keeps its lock when an older Nib sends it without, and clears it when unlocked', async () => {
    const id = await items.create('note', doc('Plain'))
    const sealed = { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) }
    await db.items.update(id, { vault: sealed, rev: 99 })
    await syncOnce(keys, server.api)
    expect(((await serverItem(id)) as Item).vault).toEqual(sealed)

    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: LOCKED_BODY, createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })
    await syncOnce(keys, server.api)
    expect((await items.get(id))?.vault).toEqual(sealed)
    expect(await copiesHere()).toEqual([])

    await otherDevice({ id, kind: 'note', body: doc('Plain again'), createdAt: created.createdAt, updatedAt: created.updatedAt + 2, vault: null })
    await syncOnce(keys, server.api)
    expect((await items.get(id))?.vault).toBeNull()
  })

  it('keeps the goal when a Nib from before goals sends the document without one', async () => {
    const id = await items.create('page', doc('Chapter one'))
    await items.setGoal(id, { words: 5000 })
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    // Edited on a device still on 1.0, which drops fields it doesn't know.
    await otherDevice({ id, kind: 'page', body: doc('Chapter one, edited on 1.0'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('Chapter one, edited on 1.0')
    expect((await items.get(id))?.goal).toEqual({ words: 5000 })
  })

  it('syncs a document’s shared drafts, and keeps them when a Nib from before sharing sends it without', async () => {
    const share = { slug: 'S'.repeat(22), key: 'K'.repeat(43), owner: 'O'.repeat(43), createdAt: 1, expiresAt: 2 }
    const id = await items.create('page', doc('Chapter one'))
    await items.setShares(id, [share])
    await syncOnce(keys, server.api)
    expect(((await serverItem(id)) as Item).shares).toEqual([share])

    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'page', body: doc('Edited on 1.0'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })
    await syncOnce(keys, server.api)
    expect((await items.get(id))?.shares).toEqual([share])

    await otherDevice({ id, kind: 'page', body: doc('Revoked elsewhere'), createdAt: created.createdAt, updatedAt: created.updatedAt + 2, shares: [] })
    await syncOnce(keys, server.api)
    expect((await items.get(id))?.shares).toEqual([])
  })

  it('syncs a document’s folder and categories, keeps them when an older Nib sends it without, and takes them out', async () => {
    const id = await items.create('page', doc('Chapter one'))
    await items.setFolder(id, 'Novel')
    await items.setCategories(id, [{ name: 'Draft', color: 'blue' }])
    await syncOnce(keys, server.api)
    const sent = (await serverItem(id)) as Item
    expect([sent.folder, sent.categories]).toEqual(['Novel', [{ name: 'Draft', color: 'blue' }]])

    // Edited on a device from before folders, which drops fields it doesn't know.
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'page', body: doc('Edited on 1.10'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('Edited on 1.10')
    expect((await items.get(id))?.folder).toBe('Novel')
    expect((await items.get(id))?.categories).toEqual([{ name: 'Draft', color: 'blue' }])

    await otherDevice({ id, kind: 'page', body: doc('Filed elsewhere'), createdAt: created.createdAt, updatedAt: created.updatedAt + 2, folder: null, categories: [] })
    await syncOnce(keys, server.api)
    expect((await items.get(id))?.folder).toBeNull()
    expect((await items.get(id))?.categories).toEqual([])
  })

  it('syncs a page’s place in its manuscript, keeps it when an older Nib sends the page without, and takes it away', async () => {
    const id = await items.create('page', doc('Chapter one'), { folder: 'Novel' })
    await items.setPositions([{ id, position: 2 }])
    await syncOnce(keys, server.api)
    expect(((await serverItem(id)) as Item).position).toBe(2)

    // Edited on a device from before manuscripts, which drops fields it doesn't know.
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'page', body: doc('Edited on 1.10'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1, folder: 'Novel' })
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('Edited on 1.10')
    expect((await items.get(id))?.position).toBe(2)

    await otherDevice({ id, kind: 'page', body: doc('Moved elsewhere'), createdAt: created.createdAt, updatedAt: created.updatedAt + 2, folder: 'Poems', position: null })
    await syncOnce(keys, server.api)
    expect((await items.get(id))?.position).toBeNull()
  })

  it('syncs the stamps put on a document, keeps them when an older Nib sends it without, and takes them off', async () => {
    const id = await items.create('note', doc('Stamped'))
    await items.setStamps(id, [{ day: '2026-11-04', no: 127 }])
    await syncOnce(keys, server.api)
    expect(((await serverItem(id)) as Item).stamps).toEqual([{ day: '2026-11-04', no: 127 }])

    // Edited on a device from before stamps, which drops fields it doesn't know.
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: doc('Edited on 1.10'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('Edited on 1.10')
    expect((await items.get(id))?.stamps).toEqual([{ day: '2026-11-04', no: 127 }])

    await otherDevice({ id, kind: 'note', body: doc('Taken off'), createdAt: created.createdAt, updatedAt: created.updatedAt + 2, stamps: [] })
    await syncOnce(keys, server.api)
    expect((await items.get(id))?.stamps).toEqual([])
  })

  it('ignores a place it can’t make sense of, rather than taking it as taken away', async () => {
    const id = await items.create('page', doc('Chapter one'), { folder: 'Novel' })
    await items.setPositions([{ id, position: 2 }])
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'page', body: doc('Chapter one'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1, folder: 'Novel', position: 'first' as unknown as number })
    await syncOnce(keys, server.api)
    expect((await items.get(id))?.position).toBe(2)
  })

  it('ignores a folder or categories it can’t make sense of, rather than taking them as removed', async () => {
    const id = await items.create('page', doc('Chapter one'))
    await items.setFolder(id, 'Novel')
    await items.setCategories(id, [{ name: 'Draft', color: 'blue' }])
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({
      id,
      kind: 'page',
      body: doc('Chapter one'),
      createdAt: created.createdAt,
      updatedAt: created.updatedAt + 1,
      folder: 42 as unknown as string,
      categories: 'Draft' as unknown as Item['categories'],
    })
    await syncOnce(keys, server.api)
    expect((await items.get(id))?.folder).toBe('Novel')
    expect((await items.get(id))?.categories).toEqual([{ name: 'Draft', color: 'blue' }])
  })

  it('ignores a goal it can’t make sense of, rather than taking it as removed', async () => {
    const id = await items.create('page', doc('Chapter one'))
    await items.setGoal(id, { words: 5000 })
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    const nonsense = { words: -3 } as unknown as Item['goal']
    await otherDevice({ id, kind: 'page', body: doc('Chapter one'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1, goal: nonsense })
    await syncOnce(keys, server.api)
    expect((await items.get(id))?.goal).toEqual({ words: 5000 })
  })

  it('deletes for good everywhere once purged, history included', async () => {
    const id = await items.create('note', doc('Purge me'))
    await syncOnce(keys, server.api)
    await items.purge(id)
    await syncOnce(keys, server.api)
    expect(await serverItem(id)).toBe('deleted')
    // Sealed, so other devices can tell it from one the server made up.
    const k = await recordKey(keys, 'item', id)
    expect(await open(keys, k, server.records.get(k)!.p!)).toMatchObject({ t: 'gone' })

    const other = await items.create('note', doc('Purged on the iPad'))
    await syncOnce(keys, server.api)
    await otherDeviceDeletes(other)
    await syncOnce(keys, server.api)
    expect(await items.get(other)).toBeUndefined()
    expect(await revisions.list(other)).toEqual([])
  })

  it('keeps an edit made here after another device purged it, and sends it back', async () => {
    const id = await items.create('note', doc('Doomed'))
    await syncOnce(keys, server.api)
    await otherDeviceDeletes(id)
    await items.update(id, doc('Rescued by a later edit'))
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('Rescued by a later edit')
    expect(plainText((await serverItem(id) as Item).body)).toBe('Rescued by a later edit')
  })

  it('sends history once it has settled, not while it is still being written', async () => {
    const id = await items.create('note', doc('With history'))
    await syncOnce(keys, server.api)
    const revisionKeys = async () => {
      const found = await Promise.all((await revisions.list(id)).map((revision) => recordKey(keys, 'revision', revision.id)))
      expect(found.length).toBeGreaterThan(0)
      return found
    }
    for (const k of await revisionKeys()) expect(server.records.has(k)).toBe(false)
    await syncOnce(keys, server.api, Date.now() + HOUR)
    for (const k of await revisionKeys()) expect(server.records.has(k)).toBe(true)
  })

  it('merges a restored backup instead of deleting what the backup lacks', async () => {
    const kept = await items.create('note', doc('In the backup'))
    const backup = serializeBackup(buildBackup(await items.listAll(), await revisions.listAll(), {}, Date.now()))
    const later = await items.create('note', doc('Written after the backup'))
    await syncOnce(keys, server.api)

    await restoreBackup(backup)
    await syncOnce(keys, server.api)
    expect(await text(kept)).toBe('In the backup')
    expect(await text(later)).toBe('Written after the backup')
    expect(await serverItem(later)).not.toBe('deleted')
  })

  it('sends back a note restored from a backup after another device purged it, instead of conflicting forever', async () => {
    const id = await items.create('note', doc('Worth keeping'))
    const backup = serializeBackup(buildBackup(await items.listAll(), await revisions.listAll(), {}, Date.now()))
    await syncOnce(keys, server.api)
    await otherDeviceDeletes(id)
    await syncOnce(keys, server.api)
    expect(await items.get(id)).toBeUndefined()

    await restoreBackup(backup) // clears sync state: the tombstone is now one this device never knew
    await syncOnce(keys, server.api)
    expect(await serverItem(id)).toMatchObject({ body: doc('Worth keeping') })
    const sent = countSent()
    await syncOnce(keys, server.api)
    expect(sent.records).toBe(0) // settled, not retrying every pass
  })

  it('skips a document too big to send, sends everything after it, and says so', async () => {
    await items.create('page', doc('x'.repeat(5_000_000)))
    const small = await items.create('note', doc('Small enough'))
    const pushes = server.api.push
    server.api.push = async (batch) => {
      if (batch.some((record) => (record.p?.length ?? 0) > 6_000_000)) throw new SyncHttpError(413, 'Too large.')
      return pushes(batch)
    }
    const result = await syncOnce(keys, server.api)
    expect(result.tooLarge).toBe(1)
    expect(await serverItem(small)).toMatchObject({ body: doc('Small enough') })
  })

  it('keeps a full history when it arrives, instead of trimming it and deleting it everywhere', async () => {
    const id = await items.create('note', doc('Draft'))
    await syncOnce(keys, server.api)
    for (let i = 0; i < 25; i++) {
      const revision = { id: `r${i}`, itemId: id, body: doc(`v${i}`), createdAt: i * HOUR }
      const k = await recordKey(keys, 'revision', revision.id)
      await server.api.push([{ k, b: 0, p: await seal(keys, k, { t: 'revision', v: revision }) }])
    }
    await syncOnce(keys, server.api, 100 * HOUR)
    expect(await revisions.list(id)).toHaveLength(26) // the 25 that arrived, and the note’s own first version
    expect([...server.records.values()].filter((record) => record.d)).toHaveLength(0)
  })

  it('skips a record it cannot open rather than stopping', async () => {
    const k = await recordKey(keys, 'item', 'broken')
    await server.api.push([{ k, p: 'bm90IGVuY3J5cHRlZA==' }])
    await otherDevice({ id: 'fine', kind: 'note', body: doc('Still arrives'), createdAt: 1, updatedAt: 2 })
    await syncOnce(keys, server.api)
    expect(await text('fine')).toBe('Still arrives')
  })

  // `typeof null` is 'object', so it got through, and threw while being
  // applied: every pass after failed the same way, shown as "Offline".
  it('skips a record whose text isn’t a document, and goes on syncing', async () => {
    await otherDevice({ id: 'empty', kind: 'note', body: null as never, createdAt: 1, updatedAt: 2 })
    await otherDeviceRevision({ id: 'empty-history', itemId: 'fine', body: null as never, createdAt: 1 })
    await otherDevice({ id: 'odd', kind: 'note', body: { type: 'doc', content: 5 } as never, createdAt: 1, updatedAt: 2 })
    await otherDevice({ id: 'fine', kind: 'note', body: doc('Still arrives'), createdAt: 1, updatedAt: 2 })
    await syncOnce(keys, server.api)
    expect(await text('fine')).toBe('Still arrives')
    expect(await items.get('empty')).toBeUndefined()
    expect(await items.get('odd')).toBeUndefined()
    expect(await db.revisions.count()).toBe(0)
  })

  // Taken, either made every later backup, and the app's file, fail to
  // restore: a backup refuses an empty id, and JSON writes such a time as null.
  it('skips a record with an empty id or a time that isn’t one', async () => {
    const far = (JSON as unknown as { rawJSON(text: string): number }).rawJSON('1e400')
    await otherDevice({ id: '', kind: 'note', body: doc('No id'), createdAt: 1, updatedAt: 2 })
    await otherDevice({ id: 'far', kind: 'note', body: doc('Far off'), createdAt: 1, updatedAt: far })
    // Finite, but past what a Date holds: shown, it threw on every launch.
    await otherDevice({ id: 'past-dates', kind: 'note', body: doc('Before time'), createdAt: 1, updatedAt: -1e16 })
    await otherDeviceRevision({ id: '', itemId: 'fine', body: doc('No id'), createdAt: 1 })
    await otherDeviceRevision({ id: 'far-history', itemId: 'fine', body: doc('Far off'), createdAt: far })
    await otherDevice({ id: 'fine', kind: 'note', body: doc('Still arrives'), createdAt: 1, updatedAt: 2, pinnedAt: far })
    await syncOnce(keys, server.api)
    expect((await items.listAll()).map((item) => item.id)).toEqual(['fine'])
    expect(await items.get('fine')).not.toHaveProperty('pinnedAt')
    expect(await db.revisions.count()).toBe(0)
    await restoreBackup(serializeBackup(buildBackup(await items.listAll(), await revisions.listAll(), {}, Date.now())))
  })
})

// A delete was only a record's name, so the server could make one up for
// every record and purge every device. Only a sealed one purges now. One
// without a seal, from a Nib before sealed deletes or from the server, only
// moves the document to the Trash here, where it stays this device's alone.
describe('a delete without a seal', () => {
  /** A document and its history on the server, then purged by a Nib that doesn't seal deletes. */
  async function purgedByOlderNib(words: string) {
    const id = await items.create('note', doc(words))
    await syncOnce(keys, server.api, Date.now() + HOUR) // history settled, and sent
    const [revision] = await revisions.list(id)
    expect(server.records.has(await recordKey(keys, 'revision', revision.id))).toBe(true)
    await otherDeviceDeletes(id, { sealed: false })
    await otherDeviceDeletes(revision.id, { sealed: false, type: 'revision' })
    return id
  }

  it('moves the document to the Trash here, history and all, instead of purging it', async () => {
    const id = await purgedByOlderNib('Not the server’s to purge')
    const { changed } = await syncOnce(keys, server.api, Date.now() + HOUR)
    expect(changed).toEqual([id])
    expect(await text(id)).toBe('Not the server’s to purge')
    expect((await items.get(id))!.deletedAt).toBeDefined()
    expect(await history(id)).toEqual(['Not the server’s to purge'])
  })

  it('takes one whose seal won’t open as having none', async () => {
    const id = await items.create('note', doc('Kept'))
    await syncOnce(keys, server.api)
    const k = await recordKey(keys, 'item', id)
    // The server's own: noise passed off as a seal.
    await server.api.push([{ k, b: server.records.get(k)!.s, d: 1, p: 'bm90IGVuY3J5cHRlZA==' }])
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('Kept')
    expect((await items.get(id))!.deletedAt).toBeDefined()
  })

  // Moving to the Trash changes the document, and a document changed here
  // goes up: it would have come back on the device that purged it.
  it('sends nothing back up, the document or its history', async () => {
    const id = await purgedByOlderNib('Purged on an older Nib')
    const sent = countSent()
    await syncOnce(keys, server.api, Date.now() + HOUR)
    await syncOnce(keys, server.api, Date.now() + 2 * HOUR)
    expect(sent.records).toBe(0)
    expect(await serverItem(id)).toBe('deleted')
  })

  it('sends the document back to every device once restored from the Trash here', async () => {
    const id = await purgedByOlderNib('Wanted after all')
    await syncOnce(keys, server.api, Date.now() + HOUR)
    await items.restore(id)
    await syncOnce(keys, server.api, Date.now() + HOUR)
    const back = (await serverItem(id)) as Item
    expect(plainText(back.body)).toBe('Wanted after all')
    expect(back.deletedAt).toBeUndefined()
  })

  it('sends nothing once purged from the Trash here too', async () => {
    const id = await purgedByOlderNib('Gone for good')
    await syncOnce(keys, server.api, Date.now() + HOUR)
    await items.purge(id)
    const sent = countSent()
    await syncOnce(keys, server.api, Date.now() + HOUR)
    expect(sent.records).toBe(0)
  })
})

// A seal ties a payload to its record, not to when it was written, so the
// server could hand back an older version as if it were new, and devices
// took it as an edit: worst for a locked note, which keeps no history. Each
// version now carries a count, sealed in, that only ever rises.
describe('a version older than one this device has had', () => {
  /** What the server holds for a document now, to play back later. */
  const snapshot = async (id: string) => ({ ...server.records.get(await recordKey(keys, 'item', id))! })
  /** The server putting an old version back, as if it had just been written. */
  const playBack = (old: Wire) =>
    server.api.push([{ k: old.k, b: server.records.get(old.k)!.s, ...(old.d ? { d: 1 as const } : {}), ...(old.p === undefined ? {} : { p: old.p }) }])
  const countOf = async (id: string) => {
    const k = await recordKey(keys, 'item', id)
    return ((await open(keys, k, server.records.get(k)!.p!)) as { n: number }).n
  }

  // After a restore the delete was one this device never knew, so the note
  // went back up counted from this clock alone. A delete counted on a clock
  // running fast was higher, and the device that made it took the restored
  // note for the past, and deleted it again.
  it('sends a restored note back counted past a delete from a fast clock', async () => {
    const id = await items.create('note', doc('Worth keeping'))
    const backup = serializeBackup(buildBackup(await items.listAll(), await revisions.listAll(), {}, Date.now()))
    await syncOnce(keys, server.api)
    const fast = Date.now() + HOUR
    await otherDeviceDeletes(id, { n: fast })
    await syncOnce(keys, server.api)
    await restoreBackup(backup)
    await syncOnce(keys, server.api)
    expect(await serverItem(id)).toMatchObject({ body: doc('Worth keeping') })
    expect(await countOf(id)).toBeGreaterThan(fast)
  })

  it('counts on from the last version it has had, and from the clock at least', async () => {
    const id = await items.create('note', doc('One'))
    await syncOnce(keys, server.api, 5_000)
    expect(await countOf(id)).toBe(5_000)
    await items.update(id, doc('Two'))
    await syncOnce(keys, server.api, 10) // a clock gone back
    expect(await countOf(id)).toBe(5_001)
  })

  it('is refused, and this device’s version goes back up over it', async () => {
    const id = await items.create('note', doc('First draft'))
    await syncOnce(keys, server.api)
    const old = await snapshot(id)
    await items.update(id, doc('Second draft'))
    await syncOnce(keys, server.api)
    await playBack(old)
    expect((await syncOnce(keys, server.api)).changed).toEqual([])
    expect(await text(id)).toBe('Second draft')
    expect(plainText(((await serverItem(id)) as Item).body)).toBe('Second draft')
  })

  it('can’t take a locked note back to before its last change', async () => {
    const id = await items.create('note', doc('Secret'))
    await lockHere(id, SEALED)
    await syncOnce(keys, server.api)
    const old = await snapshot(id)
    await lockHere(id, SEALED_ELSEWHERE)
    await syncOnce(keys, server.api)
    await playBack(old)
    await syncOnce(keys, server.api)
    expect((await items.get(id))!.vault).toEqual(SEALED_ELSEWHERE)
    expect(((await serverItem(id)) as Item).vault).toEqual(SEALED_ELSEWHERE)
  })

  it('can’t bring back a document purged here', async () => {
    const id = await items.create('note', doc('Purged'))
    await syncOnce(keys, server.api)
    const old = await snapshot(id)
    await items.purge(id)
    await syncOnce(keys, server.api)
    await playBack(old)
    await syncOnce(keys, server.api)
    expect(await items.get(id)).toBeUndefined()
    expect(await serverItem(id)).toBe('deleted')
  })

  // A past version carries no count, and one of a document no longer here
  // was stored all the same: the server could put a purged diary's history
  // back, into the library, every backup and the app's file.
  it('can’t bring back the history of a document purged here', async () => {
    const id = await items.create('note', doc('Private diary'))
    await syncOnce(keys, server.api, Date.now() + HOUR) // history settled, and sent
    const [revision] = await revisions.list(id)
    const old = { ...server.records.get(await recordKey(keys, 'revision', revision.id))! }
    await items.purge(id)
    await syncOnce(keys, server.api, Date.now() + HOUR)
    await playBack(old)
    await syncOnce(keys, server.api, Date.now() + HOUR)
    expect(await db.revisions.count()).toBe(0)
  })

  // Its history went up before its latest version, so it comes down first.
  it('still takes the history of a document that arrives after it', async () => {
    const createdAt = Date.now() - HOUR
    await otherDevice({ id: 'later', kind: 'note', body: doc('First'), createdAt, updatedAt: createdAt }, 1)
    await otherDeviceRevision({ id: 'first', itemId: 'later', body: doc('First'), createdAt })
    await otherDevice({ id: 'later', kind: 'note', body: doc('Second'), createdAt, updatedAt: Date.now() }, 2)
    await syncOnce(keys, server.api)
    expect(await text('later')).toBe('Second')
    expect((await revisions.list('later')).map((entry) => entry.id)).toEqual(['first'])
  })

  it('can’t purge a document again with an old delete once it is back', async () => {
    const id = await items.create('note', doc('Back again'))
    const { createdAt, updatedAt } = (await items.get(id))!
    await syncOnce(keys, server.api)
    await items.purge(id)
    await syncOnce(keys, server.api)
    const purge = await snapshot(id)
    // Another device that still had it sends it back, counting on from the delete.
    await otherDevice({ id, kind: 'note', body: doc('Back again'), createdAt, updatedAt: updatedAt + 1 }, (await countOf(id)) + 1)
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('Back again')
    await playBack(purge)
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('Back again')
    expect(await serverItem(id)).not.toBe('deleted')
  })

  // A count orders versions, but didn't say which an edit was made over. So
  // the server could keep this device's version from another, and take that
  // device's edit, made over the version before: a newer count, taken over
  // this device's, which, locked, kept no history and was lost.
  describe('made over a version older than one this device has had', () => {
    it('is taken as a conflict, and a locked edit here is kept as a copy', async () => {
      const id = await items.create('note', doc('Original'))
      await lockHere(id, SEALED)
      await syncOnce(keys, server.api)
      const before = await countOf(id)
      await lockHere(id, SEALED_ELSEWHERE)
      await syncOnce(keys, server.api)
      const { createdAt } = (await items.get(id))!
      const theirs = { ...SEALED, sealed: 'D'.repeat(40) }
      await otherDevice({ id, kind: 'note', body: LOCKED_BODY, vault: theirs, createdAt, updatedAt: Date.now() + MINUTE }, (await countOf(id)) + MINUTE, before)
      await syncOnce(keys, server.api)
      expect((await items.get(id))!.vault).toEqual(theirs)
      expect((await copiesHere()).map((copy) => copy.unsealed)).toEqual([{ vault: SEALED_ELSEWHERE, from: id }])
    })

    it('is no delete of an edit here', async () => {
      const id = await items.create('note', doc('Original'))
      await syncOnce(keys, server.api)
      const before = await countOf(id)
      await items.update(id, doc('Edited here'))
      await syncOnce(keys, server.api)
      await otherDeviceDeletes(id, { over: before })
      await syncOnce(keys, server.api)
      expect(await text(id)).toBe('Edited here')
      expect(plainText(((await serverItem(id)) as Item).body)).toBe('Edited here')
    })
  })

  // A Nib from before counts sends none, so the server could play back any
  // version written before them, and it was taken: a document's text, or a
  // purged one, back as it was. Once this device has had a counted version,
  // one without is taken as a conflict.
  describe('without a count', () => {
    /** Written by a Nib from before counts, taken here, then counted over: what the server could play back. */
    async function writtenBeforeCounts(text: string) {
      const createdAt = Date.now() - HOUR
      await otherDevice({ id: 'old', kind: 'note', body: doc(text), createdAt, updatedAt: createdAt })
      await syncOnce(keys, server.api)
      const old = await snapshot('old')
      await items.update('old', doc('Counted since'))
      await syncOnce(keys, server.api)
      return old
    }

    it('is kept as a conflict, and this device’s newer version goes back up over it', async () => {
      const old = await writtenBeforeCounts('Before counts')
      await playBack(old)
      await syncOnce(keys, server.api)
      expect(await text('old')).toBe('Counted since')
      expect(await history('old')).toContain('Before counts')
      expect(plainText(((await serverItem('old')) as Item).body)).toBe('Counted since')
    })

    it('can’t bring back a document purged here', async () => {
      const old = await writtenBeforeCounts('Before counts')
      await items.purge('old')
      await syncOnce(keys, server.api)
      await playBack(old)
      await syncOnce(keys, server.api)
      expect(await items.get('old')).toBeUndefined()
      expect(await serverItem('old')).toBe('deleted')
    })

    it('only moves the document to the Trash, as a delete', async () => {
      await writtenBeforeCounts('Before counts')
      await otherDeviceDeletes('old', { n: null })
      await syncOnce(keys, server.api)
      expect(await text('old')).toBe('Counted since')
      expect((await items.get('old'))!.deletedAt).toBeDefined()
    })
  })

  // Until every device counts: a later release stops taking them.
  it('still takes an edit from a Nib from before counts', async () => {
    const id = await items.create('note', doc('Counted'))
    const { createdAt, updatedAt } = (await items.get(id))!
    await syncOnce(keys, server.api)
    await otherDevice({ id, kind: 'note', body: doc('From an older Nib'), createdAt, updatedAt: updatedAt + 1 })
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('From an older Nib')
  })
})

// The writer's rule: the lock always wins. The edit it beats is kept as a
// separate locked note, made here and sealed when the vault next opens here.
describe('a lock against an edit', () => {
  it('takes a lock from another device over an edit here, and keeps the edit as a copy', async () => {
    const id = await items.create('note', doc('Original'))
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: LOCKED_BODY, vault: SEALED, createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })
    await items.update(id, doc('Phone edit, later'))

    const { copies } = await syncOnce(keys, server.api)
    const item = (await items.get(id))!
    expect(item.vault).toEqual(SEALED)
    expect(item.body).toEqual(LOCKED_BODY)
    expect(await history(id)).toEqual([])
    const [copy] = await copiesHere()
    expect(await textOfCopy(copy)).toEqual(doc('Phone edit, later'))
    expect(copy.body).toEqual(LOCKED_BODY)
    expect(copy.vault).toBeUndefined()
    expect(copies).toBe(1)
    // Not sent until it is sealed.
    expect(await serverItem(copy.id)).toBeUndefined()
    expect(((await serverItem(id)) as Item).vault).toEqual(SEALED)
  })

  it('takes a lock from another device, and deletes this device’s history of the note everywhere', async () => {
    const id = await items.create('note', doc('Original'))
    await syncOnce(keys, server.api, Date.now() + HOUR) // history settled and sent
    expect(liveOnServer()).toBe(2)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: LOCKED_BODY, vault: SEALED, createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })

    await syncOnce(keys, server.api)
    expect((await items.get(id))!.vault).toEqual(SEALED)
    expect(await history(id)).toEqual([])
    expect(await copiesHere()).toEqual([])
    expect(liveOnServer()).toBe(1)
  })

  it('keeps a lock made here over an edit from another device, and keeps that edit as a copy, not history', async () => {
    const id = await items.create('note', doc('Original'))
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: doc('iPad edit, later'), vault: null, createdAt: created.createdAt, updatedAt: Date.now() + HOUR })
    await lockHere(id)

    const { copies } = await syncOnce(keys, server.api)
    expect((await items.get(id))!.vault).toEqual(SEALED)
    expect(await history(id)).toEqual([])
    const [copy] = await copiesHere()
    expect(await textOfCopy(copy)).toEqual(doc('iPad edit, later'))
    expect(copies).toBe(1)
    expect(((await serverItem(id)) as Item).vault).toEqual(SEALED)
  })

  it('applies an unlock from another device when nothing changed here', async () => {
    const id = await items.create('note', doc('Original'))
    await lockHere(id)
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: doc('Unlocked there'), vault: null, createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })

    await syncOnce(keys, server.api)
    expect((await items.get(id))!.vault).toBeNull()
    expect(await text(id)).toBe('Unlocked there')
    expect(await copiesHere()).toEqual([])
  })

  it('never puts text from a Nib that sends no lock under the lock here', async () => {
    const id = await items.create('note', doc('Original'))
    await lockHere(id)
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: doc('Typed on an older Nib'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })

    await syncOnce(keys, server.api)
    const item = (await items.get(id))!
    expect(item.vault).toEqual(SEALED)
    expect(item.body).toEqual(LOCKED_BODY)
    const [copy] = await copiesHere()
    expect(await textOfCopy(copy)).toEqual(doc('Typed on an older Nib'))
    // And the lock goes back up.
    expect(((await serverItem(id)) as Item).vault).toEqual(SEALED)
  })

  it('keeps the newer of two locked edits, and the other as a copy of its seal', async () => {
    const id = await items.create('note', doc('Original'))
    await lockHere(id)
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: LOCKED_BODY, vault: SEALED_ELSEWHERE, createdAt: created.createdAt, updatedAt: Date.now() + HOUR })
    await db.items.update(id, { vault: { ...SEALED, sealed: 'D'.repeat(40) }, rev: created.rev! + 1 })

    const { copies } = await syncOnce(keys, server.api)
    expect((await items.get(id))!.vault).toEqual(SEALED_ELSEWHERE)
    const [copy] = await copiesHere()
    expect(copy.unsealed).toEqual({ vault: { ...SEALED, sealed: 'D'.repeat(40) }, from: id })
    expect(copies).toBe(1)
  })

  it('keeps this device’s newer locked edit, and the other device’s as a copy of its seal', async () => {
    const id = await items.create('note', doc('Original'))
    await lockHere(id)
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: LOCKED_BODY, vault: SEALED_ELSEWHERE, createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })
    await db.items.update(id, { vault: { ...SEALED, sealed: 'D'.repeat(40) }, rev: created.rev! + 1, updatedAt: Date.now() + HOUR })

    await syncOnce(keys, server.api)
    expect((await items.get(id))!.vault).toEqual({ ...SEALED, sealed: 'D'.repeat(40) })
    const [copy] = await copiesHere()
    expect(copy.unsealed).toEqual({ vault: SEALED_ELSEWHERE, from: id })
    expect(((await serverItem(id)) as Item).vault).toEqual({ ...SEALED, sealed: 'D'.repeat(40) })
  })

  it('keeps this device’s newer change to a locked note when the seal is the same on both', async () => {
    const id = await items.create('note', doc('Original'))
    await lockHere(id)
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: LOCKED_BODY, vault: SEALED, createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })
    await db.items.update(id, { pinnedAt: 5, rev: created.rev! + 1, updatedAt: Date.now() + HOUR })

    await syncOnce(keys, server.api)
    expect((await items.get(id))!.pinnedAt).toBe(5)
    expect(await copiesHere()).toEqual([])
  })

  it('keeps no history of a locked note, in either direction', async () => {
    const id = await items.create('note', doc('Original')) // records a revision here
    await db.items.update(id, { vault: SEALED, body: LOCKED_BODY }) // as a Nib from before this left it
    await otherDeviceRevision({ id: 'from-ipad', itemId: id, body: doc('iPad history'), createdAt: 1 })

    await syncOnce(keys, server.api, Date.now() + HOUR)
    expect(await db.revisions.get('from-ipad')).toBeUndefined()
    const sent = await Promise.all(
      (await revisions.list(id)).map(async (revision) => server.records.get(await recordKey(keys, 'revision', revision.id))),
    )
    expect(sent.filter(Boolean)).toEqual([])
  })

  it('sends an unlocked document as unlocked, not without a lock', async () => {
    const id = await items.create('note', doc('Never locked'))
    await syncOnce(keys, server.api)
    expect(((await serverItem(id)) as Item).vault).toBeNull()
  })
})

// Turning sync off and on, and restoring a backup, reset this device's sync
// state. A pass already under way used to write its cursor and records back
// over the reset, and its pull over the restored notes.
describe('a reset during a pass', () => {
  /** The server's API, held inside its first pull until `release`. */
  function heldServer() {
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const inside = new Promise<void>((resolve) => (entered = resolve))
    const api: Api = {
      ...server.api,
      changes: async (since) => {
        entered()
        await held
        return server.api.changes(since)
      },
    }
    return { api, inside, release }
  }

  it('leaves nothing of a pass under way when sync is turned off', async () => {
    await otherDevice({ id: 'ipad-note', kind: 'note', body: doc('From the iPad'), createdAt: 1, updatedAt: 2 })
    const { api, inside, release } = heldServer()
    const pass = syncOnce(keys, api).catch((error: unknown) => error)
    await inside
    await resetSyncState()
    release()
    await pass

    expect(await db.syncMeta.get('cursor')).toBeUndefined()
    expect(await db.syncRecords.count()).toBe(0)
    expect(await items.get('ipad-note')).toBeUndefined()
  })

  it('leaves a restored backup as restored', async () => {
    const id = await items.create('note', doc('Before'))
    await syncOnce(keys, server.api)
    const created = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: doc('Edited on the iPad'), createdAt: created.createdAt, updatedAt: created.updatedAt + 1 })
    const backup = serializeBackup(buildBackup([{ ...created, body: doc('From the backup') }], [], {}, Date.now()))
    const { api, inside, release } = heldServer()
    const pass = syncOnce(keys, api).catch((error: unknown) => error)
    await inside
    await restoreBackup(backup)
    release()
    await pass

    expect(await text(id)).toBe('From the backup')
    expect(await db.syncRecords.count()).toBe(0)
  })

  // Landing after the pull, while a pass worked out what to send, a restore
  // mixed what sync knew from before it with the documents from after it:
  // a document written since the backup read as deleted, and its sealed
  // delete went to every device, and the backup's older text went up over
  // the newer copy.
  it('sends nothing worked out from both sides of a restore', async () => {
    const kept = await items.create('note', doc('Before'))
    const backup = serializeBackup(buildBackup([(await items.get(kept))!], [], {}, Date.now()))
    const since = await items.create('note', doc('Written after the backup'))
    await items.update(kept, doc('Edited after the backup'))
    await syncOnce(keys, server.api)

    // The restore starts just as the next pass reads what sync knows.
    const toArray = db.syncRecords.toArray.bind(db.syncRecords)
    let restoring: Promise<void> | undefined
    vi.spyOn(db.syncRecords, 'toArray').mockImplementation(() =>
      toArray().then((known) => {
        restoring ??= Dexie.ignoreTransaction(() => restoreBackup(backup))
        return known
      }),
    )
    await syncOnce(keys, server.api).catch((error: unknown) => error)
    await restoring

    expect(await serverItem(since)).toMatchObject({ body: doc('Written after the backup') })
    expect(await serverItem(kept)).toMatchObject({ body: doc('Edited after the backup') })
  })
})

describe('sketches', () => {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const sketch = (drawing: string): JSONContent => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: PNG, alt: 'Sketch', drawing } }] }],
  })

  it('travel with their drawing, so another device can open them to draw on again', async () => {
    const id = await items.create('page', sketch('QUJD'))
    await syncOnce(keys, server.api)
    const sent = (await serverItem(id)) as Item
    expect(sent.body.content?.[0].content?.[0].attrs?.drawing).toBe('QUJD')

    await otherDevice({ id: 'ipad-sketch', kind: 'page', body: sketch('REVG'), createdAt: 1, updatedAt: 2 })
    await syncOnce(keys, server.api)
    expect((await items.get('ipad-sketch'))?.body.content?.[0].content?.[0].attrs?.drawing).toBe('REVG')
  })
})

// The server keeps 90 days of history; each device keeps all of its own.
describe('a first sync of a long library', () => {
  it('seals a batch at a time, and sends each before sealing the next', async () => {
    const total = BATCH_RECORDS + 40
    for (let i = 0; i < total; i++) await items.create('note', doc(`Note ${i}`), { id: `n${i}` })
    const seal = vi.spyOn(crypto.subtle, 'encrypt')
    const sealedBeforeEach: number[] = []
    const pushing = server.api.push
    server.api.push = async (batch) => {
      sealedBeforeEach.push(seal.mock.calls.length)
      return pushing(batch)
    }
    await syncOnce(keys, server.api)
    const all = seal.mock.calls.length
    seal.mockRestore()
    expect(sealedBeforeEach).toHaveLength(2)
    expect(sealedBeforeEach[0]).toBeLessThan(all)
    expect([...server.records.keys()].length).toBeGreaterThanOrEqual(total)
  })
})

describe('history on the server', () => {
  const DAY = 86_400_000
  const version = async (itemId: string, text: string, createdAt: number) => {
    const revision: Revision = { id: crypto.randomUUID(), itemId, body: doc(text), createdAt }
    await db.revisions.add(revision)
    return revision
  }
  const sentRevisions = async () => {
    const sent = await Promise.all([...server.records.values()].filter((record) => record.p && !record.d).map((record) => open(keys, record.k, record.p!)))
    return sent.flatMap((payload) => ((payload as { t: string }).t === 'revision' ? [plainText((payload as { v: Revision }).v.body)] : [])).sort()
  }

  it('doesn’t send a version already past what the server keeps', async () => {
    const now = Date.now()
    const id = await items.create('note', doc('Now'))
    await version(id, 'Long ago', now - SERVER_HISTORY_MS - DAY)
    await version(id, 'Last week', now - 7 * DAY)
    await syncOnce(keys, server.api, now)
    expect(await sentRevisions()).toEqual(['Last week'])
  })

  it('asks the server, once a day, to let go of versions that age past it, and keeps them here', async () => {
    const now = Date.now()
    const id = await items.create('note', doc('Now'))
    const aging = await version(id, 'Nearly old', now - SERVER_HISTORY_MS + DAY)
    await version(id, 'Recent', now - DAY)
    await syncOnce(keys, server.api, now)
    expect(await sentRevisions()).toEqual(['Nearly old', 'Recent'])

    const asked = vi.spyOn(server.api, 'expire')
    const reading = vi.spyOn(db.revisions, 'get')
    await expireHistory(server.api, now + 2 * DAY)
    expect(reading).not.toHaveBeenCalled()
    reading.mockRestore()
    expect(await sentRevisions()).toEqual(['Recent'])
    expect(server.expired.size).toBe(1)
    expect(await db.revisions.get(aging.id)).toBeTruthy()
    // Not again the same day, nor for one already let go of.
    await expireHistory(server.api, now + 2 * DAY + HOUR)
    await expireHistory(server.api, now + 4 * DAY)
    expect(asked).toHaveBeenCalledTimes(1)
  })
})

// Kept on this device only (Item.deviceOnly): off the server and the other devices, and here as it was.
describe('a document kept on this device only', () => {
  const HISTORY = 'ferry-history'
  /** A note with a version old enough to have been sent, synced, then kept on this device only. */
  async function syncedThenKept() {
    const id = await items.create('note', doc('Ferry at 07:40'), { id: 'ferry' })
    await db.revisions.put({ id: HISTORY, itemId: id, body: doc('Ferry at 07:10'), createdAt: Date.now() - HOUR })
    await syncOnce(keys, server.api)
    expect(await serverItem(id)).toMatchObject({ id })
    await items.setDeviceOnly(id, true)
    return id
  }
  const serverHistory = async () => server.records.get(await recordKey(keys, 'revision', HISTORY))

  it('is never sent, nor its history', async () => {
    const id = await items.create('note', doc('Ferry at 07:40'), { id: 'ferry' })
    await db.revisions.put({ id: HISTORY, itemId: id, body: doc('Ferry at 07:10'), createdAt: Date.now() - HOUR })
    await items.setDeviceOnly(id, true)
    await items.create('note', doc('For every device'), { id: 'open' })
    await syncOnce(keys, server.api)
    expect(await serverItem(id)).toBeUndefined()
    expect(await serverHistory()).toBeUndefined()
    expect(await serverItem('open')).toMatchObject({ id: 'open' })
  })

  it('is taken off the server once it has been synced, history and all, by a delete the other devices can trust, and stays here', async () => {
    const id = await syncedThenKept()
    expect((await serverHistory())?.d).toBeFalsy()
    const { changed } = await syncOnce(keys, server.api)
    expect(await serverItem(id)).toBe('deleted')
    expect((await serverHistory())?.d).toBeTruthy()
    // Sealed, as a purge is: another device carries it out rather than only moving the note to its Trash.
    const k = await recordKey(keys, 'item', id)
    expect(await open(keys, k, server.records.get(k)!.p!)).toMatchObject({ t: 'gone' })
    expect(changed).toEqual([])
    expect(await text(id)).toBe('Ferry at 07:40')
    expect(await history(id)).toContain('Ferry at 07:10')
  })

  it('sends nothing more for it afterwards, and its own removal coming back changes nothing here', async () => {
    const id = await syncedThenKept()
    await syncOnce(keys, server.api)
    const sent = countSent()
    for (let pass = 0; pass < 3; pass++) expect((await syncOnce(keys, server.api)).changed).toEqual([])
    expect(sent.records).toBe(0)
    expect((await items.get(id))!.deviceOnly).toBe(true)
    // Written in since, it's still only here.
    await items.update(id, doc('Ferry at 08:10'))
    await syncOnce(keys, server.api)
    expect(sent.records).toBe(0)
    expect(await serverItem(id)).toBe('deleted')
  })

  it('goes out again, with its history, once it’s synced again', async () => {
    const id = await syncedThenKept()
    await syncOnce(keys, server.api)
    await items.setDeviceOnly(id, false)
    await syncOnce(keys, server.api)
    expect(await serverItem(id)).toMatchObject({ id })
    expect(JSON.stringify(await serverItem(id))).not.toContain('deviceOnly')
    expect((await serverHistory())?.d).toBeFalsy()
  })

  // Another device had it, and edited it before the removal reached it: an honest one sends its edit back up.
  it('isn’t taken back in when another device sends it up again: that text is kept in its history here, and it comes off the server again', async () => {
    const id = await syncedThenKept()
    await syncOnce(keys, server.api)
    const here = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: doc('Edited on the other device'), createdAt: here.createdAt, updatedAt: Date.now() + MINUTE }, Date.now() + MINUTE)
    const { changed } = await syncOnce(keys, server.api)
    expect(changed).toEqual([])
    expect(await text(id)).toBe('Ferry at 07:40')
    expect((await items.get(id))!.deviceOnly).toBe(true)
    expect(await history(id)).toContain('Edited on the other device')
    expect(await serverItem(id)).toBe('deleted')
  })

  it('stays when another device purges it before learning it was kept here', async () => {
    const id = await syncedThenKept()
    await otherDeviceDeletes(id)
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('Ferry at 07:40')
    expect((await items.get(id))!.deviceOnly).toBe(true)
  })

  it('is this device’s to say: another device’s version can’t make a document one', async () => {
    await otherDevice({ id: 'theirs', kind: 'note', body: doc('From elsewhere'), createdAt: 1, updatedAt: 2, deviceOnly: true } as never, 5)
    await syncOnce(keys, server.api)
    expect((await items.get('theirs'))!.deviceOnly).toBeUndefined()
    await syncOnce(keys, server.api)
    expect(await serverItem('theirs')).toMatchObject({ id: 'theirs' })
  })

  it('is left out of a library filled from this device', async () => {
    await items.create('note', doc('Kept here'), { id: 'kept' })
    await items.setDeviceOnly('kept', true)
    await items.create('note', doc('For every device'), { id: 'open' })
    await fill(keys, server.api)
    expect(await serverItem('kept')).toBeUndefined()
    expect(await serverItem('open')).toMatchObject({ id: 'open' })
  })

  // A restore clears what sync knew: everything here is then sent as if new. Not this.
  it('is still this device’s only after a backup of it is restored, and isn’t sent', async () => {
    const id = await syncedThenKept()
    await syncOnce(keys, server.api)
    await restoreBackup(serializeBackup(buildBackup(await items.listAll(), await revisions.listAll(), {}, Date.now())))
    expect((await items.get(id))!.deviceOnly).toBe(true)
    await syncOnce(keys, server.api)
    expect(await serverItem(id)).toBe('deleted')
    expect(await text(id)).toBe('Ferry at 07:40')
  })

  it('locked, keeps another device’s edit as a copy that is this device’s only too', async () => {
    const id = await syncedThenKept()
    await syncOnce(keys, server.api)
    await lockHere(id)
    const here = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: doc('Typed on the other device'), createdAt: here.createdAt, updatedAt: Date.now() + MINUTE, vault: null } as never, Date.now() + MINUTE)
    await syncOnce(keys, server.api)
    const [copy] = await copiesHere()
    expect(await textOfCopy(copy)).toEqual(doc('Typed on the other device'))
    expect(copy.deviceOnly).toBe(true)
    expect(await serverItem(id)).toBe('deleted')
  })
})

// Fetch everything again (useSync `refetch`): what this device knows of the server is forgotten, and the next pass reads it all.
describe('fetching everything again', () => {
  /** Out of step: this device believes it has the server's latest version of a note, and its text is an older one. */
  async function outOfStep() {
    const id = await items.create('note', doc('As this device has it'), { id: 'ferry' })
    await syncOnce(keys, server.api)
    const here = (await items.get(id))!
    await otherDevice({ id, kind: 'note', body: doc('As the server has it'), createdAt: here.createdAt, updatedAt: Date.now() + MINUTE }, Date.now() + MINUTE)
    const k = await recordKey(keys, 'item', id)
    await db.syncRecords.update(k, { seq: server.records.get(k)!.s, n: Date.now() + MINUTE })
    await db.syncMeta.put({ k: 'cursor', v: server.records.get(k)!.s })
    return id
  }

  it('is what brings in a version a device out of step would never ask for', async () => {
    const id = await outOfStep()
    expect((await syncOnce(keys, server.api)).changed).toEqual([])
    expect(await text(id)).toBe('As this device has it')

    await resetSyncState()
    expect((await syncOnce(keys, server.api)).changed).toEqual([id])
    expect(await text(id)).toBe('As the server has it')
    // Merged, not replaced: what was here is in its history.
    expect(await history(id)).toContain('As this device has it')
  })

  it('keeps what’s newer here, and sends it; nothing here is lost to it, and nothing only here is taken away', async () => {
    const id = await outOfStep()
    await items.update(id, doc('Written here since, and newer'))
    const only = await items.create('note', doc('Only on this device so far'), { id: 'only' })
    vi.setSystemTime(Date.now() + 5 * MINUTE)
    await items.update(id, doc('Written here since, and newest'))
    await resetSyncState()
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('Written here since, and newest')
    expect(await history(id)).toContain('As the server has it')
    expect(await serverItem(id)).toMatchObject({ body: doc('Written here since, and newest') })
    expect(await serverItem(only)).toMatchObject({ id: only })
  })

  it('leaves a note kept on this device only where it is, and off the server', async () => {
    const id = await items.create('note', doc('Kept here'), { id: 'kept' })
    await syncOnce(keys, server.api)
    await items.setDeviceOnly(id, true)
    await syncOnce(keys, server.api)
    await resetSyncState()
    await syncOnce(keys, server.api)
    expect(await text(id)).toBe('Kept here')
    expect(await serverItem(id)).toBe('deleted')
  })
})

