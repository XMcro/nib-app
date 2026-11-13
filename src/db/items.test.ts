import 'fake-indexeddb/auto'
import { liveQuery } from 'dexie'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { db, type Item } from './db'
import * as items from './items'
import * as revisions from './revisions'
import { titleOf } from '../lib/text'
import * as vault from '../lib/vault'

const body = (value: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
})

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
})

describe('amending a document that isn’t being written', () => {
  it('saves the new body as an edit, which syncs, with no version of its own in the history', async () => {
    const id = await items.create('note', body('Old'))
    const before = (await db.items.get(id))!
    const kept = await db.revisions.count()
    await items.amend(id, () => body('New'))
    const after = (await db.items.get(id))!
    expect(after.body).toEqual(body('New'))
    expect(after.version).toBe(before.version + 1)
    expect(after.rev).toBe(items.nextRev(before))
    expect(await db.revisions.count()).toBe(kept)
  })

  it.each([['locked', { vault: 'sealed' }], ['read-only', { readOnly: true }], ['in the trash', { deletedAt: 1 }]])('leaves one %s as it was', async (_kind, state) => {
    const id = await items.create('note', body('Old'))
    await db.items.update(id, state as Partial<Item>)
    const before = await db.items.get(id)
    await items.amend(id, () => body('New'))
    expect(await db.items.get(id)).toEqual(before)
  })

  it('leaves it as it was when there is nothing to change', async () => {
    const id = await items.create('note', body('Old'))
    const before = await db.items.get(id)
    await items.amend(id, () => null)
    expect(await db.items.get(id)).toEqual(before)
  })
})

describe('changing several at once', () => {
  const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }

  it('does each with one write, moving `rev` and leaving when it was edited alone', async () => {
    const ids = [await items.create('note', body), await items.create('note', body), await items.create('note', body)]
    const inOrder = async () => (await db.items.bulkGet(ids)) as Item[]
    const before = await inOrder()
    const each = vi.spyOn(db.items, 'where')
    await items.setPinned(ids.slice(0, 2), true)
    expect(each).toHaveBeenCalledTimes(1)
    each.mockRestore()
    const after = await inOrder()
    expect(after.map((item) => typeof item.pinnedAt)).toEqual(['number', 'number', 'undefined'])
    expect(after[0].rev).not.toBe(before[0].rev)
    expect(after[2].rev).toBe(before[2].rev)
    expect(after.map((item) => [item.version, item.updatedAt])).toEqual(before.map((item) => [item.version, item.updatedAt]))
  })

  it('files, archives and trashes them all', async () => {
    const ids = [await items.create('note', body), await items.create('page', body)]
    await items.setFolder(ids, 'Novel')
    await items.setArchived(ids, true)
    await items.remove(ids)
    for (const item of await db.items.toArray()) {
      expect(item.folder).toBe('Novel')
      expect(typeof item.archivedAt).toBe('number')
      expect(typeof item.deletedAt).toBe('number')
    }
  })

  it('still takes one id, and nothing is an empty write', async () => {
    const id = await items.create('note', body)
    await items.setPinned(id, true)
    await items.setPinned([], false)
    expect(typeof (await db.items.get(id))!.pinnedAt).toBe('number')
  })

  it('puts them in a category once, by any case of its name, and takes them out by any case', async () => {
    const draft = { name: 'Draft', color: 'blue' as const }
    const other = { name: 'Other', color: 'pink' as const }
    const ids = [await items.create('note', body, { categories: [other, { name: 'DRAFT', color: 'green' }] }), await items.create('note', body)]
    await items.fileInCategory(ids, draft, true)
    expect((await db.items.bulkGet(ids)).map((item) => item!.categories)).toEqual([[other, draft], [draft]])
    await items.fileInCategory(ids, { name: 'draft', color: 'blue' }, false)
    expect((await db.items.bulkGet(ids)).map((item) => item!.categories)).toEqual([[other], []])
  })
})

describe('items', () => {
  it('sorts one read of everything: newest first, of two at once the later id, and the trash as listTrash has it', async () => {
    // Ties on purpose: two written at once, two trashed at once.
    for (const [id, kind, updatedAt] of [['b', 'note', 5], ['a', 'note', 5], ['c', 'note', 9], ['p', 'page', 5], ['q', 'page', 7]] as const) {
      await items.create(kind, body(id), { id, updatedAt, createdAt: 1 })
    }
    await db.items.bulkPut([
      { id: 't2', kind: 'note', body: body('t2'), version: 1, createdAt: 1, updatedAt: 1, deletedAt: 3 },
      { id: 't1', kind: 'page', body: body('t1'), version: 1, createdAt: 1, updatedAt: 1, deletedAt: 3 },
      { id: 't3', kind: 'note', body: body('t3'), version: 1, createdAt: 1, updatedAt: 1, deletedAt: 8 },
    ])
    const { notes, trash } = items.sortOut(await items.listAll())
    expect(trash).toEqual(await items.listTrash())
    expect(notes.map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })

  it('starts a document in a folder and a category when it’s written there', async () => {
    const id = await items.create('note', body('Notes on chapter one'), { folder: 'Novel', categories: [{ name: 'Draft', color: 'blue' }] })
    expect(await items.get(id)).toMatchObject({ folder: 'Novel', categories: [{ name: 'Draft', color: 'blue' }] })
    // Written with nothing shown: neither field at all.
    const plain = (await items.get(await items.create('note', body('Plain'), { folder: undefined, categories: [] })))!
    expect(plain).not.toHaveProperty('folder')
    expect(plain).not.toHaveProperty('categories')
  })

  it('puts a document in a folder and gives it categories without it looking edited, and takes them away', async () => {
    const id = await items.create('page', body('Chapter one'))
    const before = (await items.get(id))!
    await items.setFolder(id, 'Novel')
    await items.setCategories(id, [{ name: 'Draft', color: 'blue' }])
    let after = (await items.get(id))!
    expect(after.folder).toBe('Novel')
    expect(after.categories).toEqual([{ name: 'Draft', color: 'blue' }])
    // Sync sends it; the list doesn't move it up as if it were written in.
    expect(after.rev).toBe((before.rev ?? 0) + 2)
    expect([after.version, after.updatedAt]).toEqual([before.version, before.updatedAt])

    // Taken out: stored, so an older Nib leaving the fields out can't undo it.
    await items.setFolder(id, null)
    await items.setCategories(id, [])
    after = (await items.get(id))!
    expect(after.folder).toBeNull()
    expect(after.categories).toEqual([])
  })

  it('keeps a document on this device only without it looking edited, and a copy of it likewise', async () => {
    const id = await items.create('note', body('Not for the other devices'))
    const before = (await items.get(id))!
    await items.setDeviceOnly(id, true)
    let after = (await items.get(id))!
    expect(after.deviceOnly).toBe(true)
    // `rev` moves: that's how sync comes to take it off the server.
    expect(after.rev).toBe((before.rev ?? 0) + 1)
    expect([after.version, after.updatedAt]).toEqual([before.version, before.updatedAt])
    // A copy that synced would send its words where the original was kept from.
    expect((await items.get((await items.duplicate(id))!))!.deviceOnly).toBe(true)

    await items.setDeviceOnly(id, false)
    after = (await items.get(id))!
    expect(after.deviceOnly).toBeNull()
    expect((await items.get((await items.duplicate(id))!))!.deviceOnly).toBeUndefined()
  })

  it('gives a document a reminder without it looking edited, and takes it off; a copy has none', async () => {
    const id = await items.create('note', body('Ferry at 07:40'))
    const before = (await items.get(id))!
    await items.setReminder(id, { at: 1794000000000 })
    let after = (await items.get(id))!
    expect(after.reminder).toEqual({ at: 1794000000000 })
    // Sync sends it, for the other devices to ring.
    expect(after.rev).toBe((before.rev ?? 0) + 1)
    expect([after.version, after.updatedAt]).toEqual([before.version, before.updatedAt])
    expect((await items.get((await items.duplicate(id))!))!.reminder).toBeUndefined()

    await items.setReminder(id, null)
    after = (await items.get(id))!
    expect(after.reminder).toBeNull()
  })

  it('gives a document an expiry date without it looking edited, and takes it off; a copy has none', async () => {
    const id = await items.create('note', body('Gone by the new year'))
    const before = (await items.get(id))!
    await items.setExpiry(id, '2026-12-31')
    let after = (await items.get(id))!
    expect(after.expires).toBe('2026-12-31')
    expect(after.rev).toBe((before.rev ?? 0) + 1)
    expect([after.version, after.updatedAt, after.deletedAt]).toEqual([before.version, before.updatedAt, undefined])
    // A copy is a new document: it stays until it's given a date of its own.
    const copy = (await items.get((await items.duplicate(id))!))!
    expect(copy.expires).toBeUndefined()

    await items.setExpiry(id, null)
    after = (await items.get(id))!
    expect(after.expires).toBeNull()
    expect(after.rev).toBe((before.rev ?? 0) + 2)
  })

  it('puts a document back from the trash without the date that sent it there, and with one still to come', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-10T12:00:00') })
    onTestFinished(() => void vi.useRealTimers())
    const due = await items.create('note', body('Went today'))
    const gone = await items.create('note', body('Went last week'))
    const later = await items.create('note', body('Thrown out by hand'))
    await items.setExpiry(due, '2026-11-10')
    await items.setExpiry(gone, '2026-11-03')
    await items.setExpiry(later, '2026-11-11')
    await items.remove([due, gone, later])
    for (const id of [due, gone, later]) await items.restore(id)
    // Or it would go straight back.
    expect((await items.get(due))!.expires).toBeNull()
    expect((await items.get(gone))!.expires).toBeNull()
    expect((await items.get(later))!.expires).toBe('2026-11-11')
    for (const id of [due, gone, later]) expect((await items.get(id))!.deletedAt).toBeUndefined()
  })

  it('files a document in the archive without it looking edited, apart from the lists, and back', async () => {
    const id = await items.create('note', body('Put this away'))
    const before = (await items.get(id))!
    await items.setArchived(id, true)
    let after = (await items.get(id))!
    expect(typeof after.archivedAt).toBe('number')
    expect(after.rev).toBe((before.rev ?? 0) + 1)
    expect([after.version, after.updatedAt]).toEqual([before.version, before.updatedAt])
    let sorted = items.sortOut(await items.listAll())
    expect(sorted.archived.map((item) => item.id)).toEqual([id])
    expect(sorted.notes.map((item) => item.id)).not.toContain(id)

    await items.setArchived(id, false)
    after = (await items.get(id))!
    expect(after.archivedAt).toBeNull()
    sorted = items.sortOut(await items.listAll())
    expect(sorted.archived).toEqual([])
    expect(sorted.notes.map((item) => item.id)).toContain(id)
  })

  it('counts an archived document as trash once it’s trashed', async () => {
    const id = await items.create('note', body('Put this away'))
    await items.setArchived(id, true)
    await items.remove(id)
    const sorted = items.sortOut(await items.listAll())
    expect(sorted.archived).toEqual([])
    expect(sorted.trash.map((item) => item.id)).toEqual([id])
  })

  it('makes a document read-only without it looking edited, and a copy of it isn’t', async () => {
    const id = await items.create('note', body('Keep this as it is'))
    const before = (await items.get(id))!
    await items.setReadOnly(id, true)
    let after = (await items.get(id))!
    expect(after.readOnly).toBe(true)
    expect(after.rev).toBe((before.rev ?? 0) + 1)
    expect([after.version, after.updatedAt]).toEqual([before.version, before.updatedAt])

    const copy = (await items.get((await items.duplicate(id))!))!
    expect(copy.readOnly).toBeUndefined()

    // Stored as null, so a document arriving without the field says nothing about it.
    await items.setReadOnly(id, false)
    after = (await items.get(id))!
    expect(after.readOnly).toBeNull()
  })

  it('gives pages their places in a manuscript without them looking edited', async () => {
    const one = await items.create('page', body('Chapter one'), { folder: 'Novel' })
    const two = await items.create('page', body('Chapter two'), { folder: 'Novel' })
    const before = (await items.get(one))!
    await items.setPositions([
      { id: one, position: 2 },
      { id: two, position: 1 },
    ])
    const after = (await items.get(one))!
    expect(after.position).toBe(2)
    expect((await items.get(two))?.position).toBe(1)
    expect(after.rev).toBe((before.rev ?? 0) + 1)
    expect([after.version, after.updatedAt]).toEqual([before.version, before.updatedAt])
  })

  it('takes a page’s place away when it moves to another folder, and keeps it when it doesn’t', async () => {
    const id = await items.create('page', body('Chapter one'), { folder: 'Novel' })
    await items.setPositions([{ id, position: 3 }])
    await items.setFolder(id, 'novel')
    expect((await items.get(id))?.position).toBe(3)
    // In another folder it goes in at the end, not at its old place there.
    await items.setFolder(id, 'Poems')
    expect((await items.get(id))?.position).toBeNull()

    const never = await items.create('page', body('Never placed'), { folder: 'Novel' })
    await items.setFolder(never, 'Poems')
    expect(await items.get(never)).not.toHaveProperty('position')
  })

  it('creates a record with a client-generated id and version 1', async () => {
    const id = await items.create('note', body('one'))
    const saved = await items.get(id)
    expect(saved?.id).toBe(id)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(saved?.kind).toBe('note')
    expect(saved?.version).toBe(1)
    expect(saved?.createdAt).toBe(saved?.updatedAt)
  })

  it('lists newest first', async () => {
    // Times of their own: created and edited now, all three can land on one millisecond.
    const first = await items.create('note', body('first'), { updatedAt: 1 })
    const second = await items.create('note', body('second'), { updatedAt: 2 })
    await items.update(first, body('first, edited'))

    const listed = await items.list('note')
    expect(listed.map((item) => item.id)).toEqual([first, second])
  })

  it('separates the two kinds', async () => {
    await items.create('note', body('a note'))
    const pageId = await items.create('page', body('a page'))

    expect(await items.list('note')).toHaveLength(1)
    const pages = await items.list('page')
    expect(pages.map((item) => item.id)).toEqual([pageId])
  })

  it('bumps the revision counter on every update', async () => {
    const id = await items.create('note', body('one'))
    await items.update(id, body('two'))
    await items.update(id, body('three'))

    const saved = await items.get(id)
    expect(saved?.version).toBe(3)
    expect(saved?.body).toEqual(body('three'))
  })

  it('moves updatedAt forward but leaves createdAt alone', async () => {
    const id = await items.create('note', body('one'))
    const before = await items.get(id)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await items.update(id, body('two'))

    const after = await items.get(id)
    expect(after!.createdAt).toBe(before!.createdAt)
    expect(after!.updatedAt).toBeGreaterThan(before!.updatedAt)
  })

  it('trashes rather than destroys', async () => {
    const id = await items.create('note', body('one'))
    await items.remove(id)

    expect(await items.list('note')).toHaveLength(0)
    const trashed = await items.get(id)
    expect(trashed).toBeDefined()
    expect(trashed?.deletedAt).toBeTypeOf('number')
    expect(trashed?.body).toEqual(body('one'))
  })

  it('lists the trash newest-trashed first, across both kinds', async () => {
    const note = await items.create('note', body('a note'))
    const page = await items.create('page', body('a page'))
    await items.remove(note)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await items.remove(page)

    const trash = await items.listTrash()
    expect(trash.map((item) => item.id)).toEqual([page, note])
  })

  it('restores a trashed record back into its list', async () => {
    const id = await items.create('note', body('one'))
    await items.remove(id)
    await items.restore(id)

    expect(await items.list('note')).toHaveLength(1)
    expect((await items.get(id))?.deletedAt).toBeUndefined()
    expect(await items.listTrash()).toHaveLength(0)
  })

  it('purges for real', async () => {
    const id = await items.create('note', body('one'))
    await items.remove(id)
    await items.purge(id)
    expect(await items.get(id)).toBeUndefined()
  })

  it('purgeAll empties the trash but spares live records', async () => {
    const kept = await items.create('note', body('kept'))
    const gone = await items.create('note', body('gone'))
    await items.remove(gone)
    await items.purgeAll()

    expect(await items.get(gone)).toBeUndefined()
    expect(await items.get(kept)).toBeDefined()
  })

  it('files a copy where its original is', async () => {
    const id = await items.create('page', body('Chapter one'), { folder: 'Novel', categories: [{ name: 'Draft', color: 'blue' }] })
    const copy = (await items.get((await items.duplicate(id))!))!
    expect(copy).toMatchObject({ folder: 'Novel', categories: [{ name: 'Draft', color: 'blue' }] })
  })

  it('duplicates a record as a new independent copy', async () => {
    const id = await items.create('note', body('original'))
    const copy = await items.duplicate(id)

    expect(copy).not.toBe(id)
    expect((await items.get(copy!))?.body).toEqual(body('original'))
    await items.update(copy!, body('changed'))
    expect((await items.get(id))?.body).toEqual(body('original'))
  })

  it('records a revision on create and on update', async () => {
    const id = await items.create('note', body('one'))
    expect(await revisions.list(id)).toHaveLength(1)

    // Same coalescing window, so this replaces rather than appends.
    await items.update(id, body('two'))
    const all = await revisions.list(id)
    expect(all).toHaveLength(1)
    expect(all[0].body).toEqual(body('two'))
  })

  it('can skip recording, so a restore cannot clobber its own snapshot', async () => {
    const id = await items.create('note', body('draft'))
    // What restore does: snapshot the draft, then write without recording.
    await revisions.record(id, body('draft'), { force: true })
    await items.update(id, body('restored'), { record: false })

    const all = await revisions.list(id)
    expect(all.some((entry) => entry.body.content?.[0].content?.[0].text === 'draft')).toBe(true)
    expect((await items.get(id))?.body).toEqual(body('restored'))
  })

  it('purging a record takes its history with it', async () => {
    const id = await items.create('note', body('one'))
    await items.remove(id)
    await items.purge(id)
    expect(await revisions.list(id)).toHaveLength(0)
  })

  // Two tabs on one document still overwrite each other — which text the user
  // wants is not the database's call. What must not happen is the losing text
  // disappearing: the coalesce window would otherwise fold this save into the
  // other tab's revision and destroy the last copy of it.
  it('keeps the text it overwrites when another writer got there first', async () => {
    const id = await items.create('note', body('mine, first draft'))
    // The other tab saves while this editor is still holding version 1.
    await items.update(id, body('theirs'))

    const version = await items.update(id, body('mine, second draft'), { expectedVersion: 1 })

    expect((await items.get(id))?.body).toEqual(body('mine, second draft'))
    expect(version).toBe(3)
    const history = (await revisions.list(id)).map(
      (entry) => entry.body.content?.[0].content?.[0].text,
    )
    expect(history).toContain('theirs')
    expect(history[0]).toBe('mine, second draft')
  })

  // The history panel calls row 0 "Current" and withholds "Restore this
  // version" from it. When both forced records land in the same millisecond
  // they tie in the index, and the panel offers to restore the text already on
  // screen while presenting the other tab's as current.
  it('puts the surviving text ahead of the text it overwrote, every time', async () => {
    const orderings = new Set<string>()
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await db.items.clear()
      await db.revisions.clear()
      const id = await items.create('note', body('mine'))
      // `record: false` so the dedupe cannot absorb the first forced record.
      await items.update(id, body('theirs'), { record: false })
      await items.update(id, body('mine again'), { expectedVersion: 1 })

      const history = await revisions.list(id)
      orderings.add(history.map((entry) => entry.body.content?.[0].content?.[0].text).join(','))
    }
    expect([...orderings]).toEqual(['mine again,theirs,mine'])
  })

  // The tripwire under the conflict notice: detection is `next !== expected + 1`,
  // so an update that ever stopped incrementing by exactly one would silently
  // switch it off, and only this assertion would notice.
  it('increments the version by exactly one when nobody raced', async () => {
    const id = await items.create('note', body('one'))
    expect(await items.update(id, body('two'), { expectedVersion: 1 })).toBe(2)
    expect(await items.update(id, body('three'), { expectedVersion: 2 })).toBe(3)
  })

  it('does not snapshot anything when no one else has written', async () => {
    const id = await items.create('note', body('one'))
    await items.update(id, body('two'), { expectedVersion: 1 })
    // Coalesced into the single revision the create opened, as before.
    expect(await revisions.list(id)).toHaveLength(1)
  })

  // Resolving quietly here would tell the editor the save succeeded, so it
  // would go on reporting "Stored on this device" with nothing being written.
  // Another tab can trash a document this editor still holds. The write has
  // to land — otherwise the keystrokes after the trash exist only in memory
  // and vanish if the tab closes before anyone restores. The item stays in
  // the trash; App is what tells the writer.
  it('still writes a record that has been moved to the trash', async () => {
    const id = await items.create('note', body('live'))
    await items.remove(id)
    const version = await items.update(id, body('written after trash'))

    const saved = await items.get(id)
    expect(saved?.deletedAt).toBeTypeOf('number')
    expect(saved?.body).toEqual(body('written after trash'))
    expect(version).toBe(2)
    expect(await items.list('note')).toHaveLength(0)
    expect(await items.listTrash()).toHaveLength(1)
  })

  it('reports an update to a record that was purged', async () => {
    const id = await items.create('note', body('one'))
    await items.purge(id)
    await expect(items.update(id, body('two'))).rejects.toThrow(/no longer exists/)
    expect(await items.get(id)).toBeUndefined()
    // ...and records no revision against the record that is gone.
    expect(await revisions.list(id)).toHaveLength(0)
  })

  it('lists every record, including trash, for a lossless dump', async () => {
    const live = await items.create('note', body('live'))
    const trashed = await items.create('page', body('trashed'))
    await items.remove(trashed)

    const all = await items.listAll()
    expect(all.map((record) => record.id).sort()).toEqual([live, trashed].sort())
    expect(all.find((record) => record.id === trashed)?.deletedAt).toBeTypeOf('number')
  })

  it('replaces the database in one shot, keeping ids', async () => {
    await items.create('note', body('old'))
    await items.replaceAll(
      [
        {
          id: 'kept-id',
          kind: 'note',
          body: body('from backup'),
          version: 7,
          createdAt: 1,
          updatedAt: 2,
          pinnedAt: 3,
        },
      ],
      [{ id: 'rev-1', itemId: 'kept-id', body: body('older'), createdAt: 1 }],
    )

    expect(await items.list('note')).toHaveLength(1)
    const saved = await items.get('kept-id')
    expect(saved?.version).toBe(7)
    expect(saved?.pinnedAt).toBe(3)
    expect(await revisions.list('kept-id')).toHaveLength(1)
  })
})

describe('the vault', () => {
  const shut = () => vault.closeVault()

  it('locks: seals the text, empties the body, and deletes every past version', async () => {
    const id = await items.create('note', body('first'), { createdAt: 1 })
    await items.update(id, body('the secret'))
    expect((await revisions.list(id)).length).toBeGreaterThan(0)

    await vault.openVault('harbour lights', [])
    await items.lock(id, body('the secret'))
    const locked = (await items.get(id))!
    expect(locked.body).toEqual(vault.LOCKED_BODY)
    expect(JSON.stringify(locked)).not.toContain('secret')
    expect(await revisions.list(id)).toEqual([])
    expect(await vault.unseal(id, locked.vault!)).toEqual(body('the secret'))
    shut()
  })

  it('seals each save of a locked document, and keeps no history of it', async () => {
    const id = await items.create('page', body('draft'))
    await vault.openVault('harbour lights', [])
    await items.lock(id, body('draft'))
    await items.update(id, body('rewritten in private'))
    const saved = (await items.get(id))!
    expect(saved.body).toEqual(vault.LOCKED_BODY)
    expect(await vault.unseal(id, saved.vault!)).toEqual(body('rewritten in private'))
    expect(await revisions.list(id)).toEqual([])

    // With the vault shut there is no key to seal with, so nothing is written in the clear.
    shut()
    await expect(items.update(id, body('typed after it shut'))).rejects.toThrow('The vault is locked.')
    expect((await items.get(id))!.body).toEqual(vault.LOCKED_BODY)
  })

  it('unlocks: the text is stored in the clear again, and the vault field says so', async () => {
    const id = await items.create('note', body('soon public'))
    await vault.openVault('harbour lights', [])
    await items.lock(id, body('soon public'))
    await items.unlock(id, body('soon public'))
    const open = (await items.get(id))!
    expect(open.vault).toBeNull()
    expect(open.body).toEqual(body('soon public'))
    shut()
  })

  // An unlocked document keeps the text a stale save writes over in its
  // history. A locked one keeps no history, so that edit was simply gone.
  it('keeps the edit a stale save of a locked document writes over, as a locked copy', async () => {
    const id = await items.create('note', body('draft'))
    await vault.openVault('harbour lights', [])
    await items.lock(id, body('draft'))
    const seeded = (await items.get(id))!.version
    await items.update(id, body('edited on the iPhone')) // synced in, or another tab
    await items.update(id, body('typed on the Mac'), { expectedVersion: seeded, wasLocked: true })

    expect(await vault.unseal(id, (await items.get(id))!.vault!)).toEqual(body('typed on the Mac'))
    const [copy] = (await db.items.toArray()).filter((item) => item.id !== id)
    expect(copy?.unsealed).toMatchObject({ from: id })
    await items.sealCopies()
    expect(await vault.unseal(copy.id, (await items.get(copy.id))!.vault!)).toEqual(body('edited on the iPhone'))
    shut()
  })

  it('won’t duplicate a locked document', async () => {
    const id = await items.create('note', body('one of a kind'))
    await vault.openVault('harbour lights', [])
    await items.lock(id, body('one of a kind'))
    expect(await items.duplicate(id)).toBeUndefined()
    shut()
  })

  // So a passcode changed on one device counts as a change against an edit on another.
  it('reseals with a newer edit time', async () => {
    const id = await items.create('note', body('kept close'))
    await vault.openVault('harbour lights', [])
    await items.lock(id, body('kept close'))
    const before = (await items.get(id))!
    await new Promise((resolve) => setTimeout(resolve, 2))
    const { sealed, adopt } = await vault.changePasscode('new harbour', [{ id, vault: before.vault! }])
    await items.reseal(sealed)
    adopt()
    expect((await items.get(id))!.updatedAt).toBeGreaterThan(before.updatedAt)
    shut()
  })

  // Sealing and opening take a moment, in which sync can land another
  // device's edit. Written from the text read before it, that edit was lost.
  it('won’t lock or unlock over a version newer than the one read', async () => {
    const id = await items.create('note', body('read here'))
    await vault.openVault('harbour lights', [])
    const read = (await items.get(id))!.version
    await items.update(id, body('synced in meanwhile'))
    await expect(items.lock(id, body('read here'), read)).rejects.toBeInstanceOf(items.ChangedSince)
    expect((await items.get(id))!.body).toEqual(body('synced in meanwhile'))
    expect((await revisions.list(id)).length).toBeGreaterThan(0)

    await items.lock(id, body('synced in meanwhile'), read + 1)
    const locked = (await items.get(id))!.version
    await items.update(id, body('a locked edit synced in'))
    await expect(items.unlock(id, body('synced in meanwhile'), locked)).rejects.toBeInstanceOf(items.ChangedSince)
    expect(await vault.unseal(id, (await items.get(id))!.vault!)).toEqual(body('a locked edit synced in'))
    shut()
  })

  // A new passcode takes a second to make. A locked edit synced in meanwhile
  // was resealed from the text before it; one newly locked was left under the
  // old passcode, which the vault then no longer opened.
  it('won’t reseal a document changed, or miss one locked, since the seals were made', async () => {
    const id = await items.create('note', body('kept close'))
    await vault.openVault('harbour lights', [])
    await items.lock(id, body('kept close'))
    const from = [{ id, vault: (await items.get(id))!.vault! }]
    const { sealed } = await vault.changePasscode('new harbour', from)
    await items.update(id, body('a locked edit synced in'))
    await expect(items.reseal(sealed, from)).rejects.toBeInstanceOf(items.ChangedSince)
    expect(await vault.unseal(id, (await items.get(id))!.vault!)).toEqual(body('a locked edit synced in'))

    const again = [{ id, vault: (await items.get(id))!.vault! }]
    const next = await vault.changePasscode('new harbour', again)
    const other = await items.create('note', body('locked elsewhere'))
    await items.lock(other, body('locked elsewhere'))
    await expect(items.reseal(next.sealed, again)).rejects.toBeInstanceOf(items.ChangedSince)
    expect((await items.get(id))!.vault).toEqual(again[0].vault)
    shut()
  })
})

/** A copy from sync, as sync/engine makes one: locked, empty, waiting for the vault. */
async function copyOf(unsealed: NonNullable<Item['unsealed']>) {
  await db.items.add({ id: 'copy', kind: 'note', body: vault.LOCKED_BODY, version: 1, rev: 1, createdAt: 1, updatedAt: 1, unsealed })
  return 'copy'
}

describe('boxing at launch', () => {
  const kept = new Map<string, string>()
  beforeEach(() => {
    kept.clear()
    vi.stubGlobal('localStorage', { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => kept.set(key, value), removeItem: (key: string) => kept.delete(key) })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('looks through the library once, and not at every launch after', async () => {
    const early = await copyOf({ body: body('the first') })
    await items.boxCopiesOnce()
    expect(JSON.stringify(await items.get(early))).not.toContain('the first')
    // Nothing would put one here now: this one only says whether it looked.
    await db.items.add({ id: 'later', kind: 'note', body: vault.LOCKED_BODY, version: 1, rev: 1, createdAt: 2, updatedAt: 2, unsealed: { body: body('the second') } })
    await items.boxCopiesOnce()
    expect(JSON.stringify(await items.get('later'))).toContain('the second')
  })

  it('looks again next launch if a copy couldn’t be boxed', async () => {
    const copy = await copyOf({ body: body('the third') })
    const refused = vi.spyOn(vault, 'box').mockRejectedValueOnce(new Error('no key'))
    await items.boxCopiesOnce()
    refused.mockRestore()
    expect(JSON.stringify(await items.get(copy))).toContain('the third')
    await items.boxCopiesOnce()
    expect(JSON.stringify(await items.get(copy))).not.toContain('the third')
  })
})

describe('copies from sync', () => {
  afterEach(() => vault.closeVault())

  it('seals a copy’s text under its own id once the vault is open', async () => {
    const id = await copyOf({ body: body('the other edit') })
    await vault.openVault('harbour lights', [])
    await items.sealCopies()
    const sealed = (await items.get(id))!
    expect(sealed.unsealed).toBeUndefined()
    expect(sealed.body).toEqual(vault.LOCKED_BODY)
    expect(await vault.unseal(id, sealed.vault!)).toEqual(body('the other edit'))
    expect(sealed.rev).toBe(2)
  })

  it('reseals a copy of another note’s seal under its own id', async () => {
    const original = await items.create('note', body('the losing edit'))
    await vault.openVault('harbour lights', [])
    await items.lock(original, body('the losing edit'))
    const id = await copyOf({ vault: (await items.get(original))!.vault!, from: original })
    await items.sealCopies()
    expect(await vault.unseal(id, (await items.get(id))!.vault!)).toEqual(body('the losing edit'))
  })

  it('leaves a copy whose seal this vault can’t open', async () => {
    await vault.openVault('another passcode', [])
    const elsewhere = await vault.seal('original', body('not ours'))
    vault.closeVault()
    const id = await copyOf({ vault: elsewhere, from: 'original' })
    await vault.openVault('harbour lights', [])
    await items.sealCopies()
    expect((await items.get(id))!.unsealed).toEqual({ vault: elsewhere, from: 'original' })
  })

  // Kept in the clear until the vault next opened here: in the library,
  // every backup and the app's file.
  it('keeps an edit a lock beat boxed, not in the clear, until the vault seals it', async () => {
    const id = await items.addCopy('note', { body: body('the losing edit') })
    const kept = (await items.get(id))!
    expect(JSON.stringify(kept)).not.toContain('losing')
    expect(kept.unsealed).toHaveProperty('box')
    await vault.openVault('harbour lights', [])
    await items.sealCopies()
    expect(await vault.unseal(id, (await items.get(id))!.vault!)).toEqual(body('the losing edit'))
  })

  it('keeps what a beaten edit had attached in an unlocked note of its own, since the locked copy can’t hold it', async () => {
    const file = { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'application/pdf', size: 2000 }
    const edit: JSONContent = { type: 'doc', content: [...body('the losing edit').content!, { type: 'attachment', attrs: { file, name: 'report.pdf' } }, { type: 'attachment', attrs: { file: null, name: 'gone.pdf' } }] }
    const id = await items.addCopy('page', { body: edit })
    const [files, ...others] = (await db.items.toArray()).filter((item) => item.id !== id)
    expect(others).toEqual([])
    expect(files).toMatchObject({ kind: 'note', version: 1, rev: 1 })
    expect(files.vault ?? files.unsealed ?? files.deviceOnly).toBeUndefined()
    expect(files.body.content!.filter((block) => block.type === 'attachment')).toEqual([{ type: 'attachment', attrs: { file, name: 'report.pdf' } }])
    expect(titleOf(files.body)).toBe('Files from a locked note')
    // The copy itself is sealed with their names alone, as any locked note would be.
    await vault.openVault('harbour lights', [])
    await items.sealCopies()
    const sealed = (await vault.unseal(id, (await items.get(id))!.vault!))!
    expect(sealed.content!.slice(-2)).toEqual([{ type: 'attachment', attrs: { file: null, name: 'report.pdf' } }, { type: 'attachment', attrs: { file: null, name: 'gone.pdf' } }])
  })

  it('makes no such note for an edit with nothing attached, or with names alone, or for a copy of a seal; and one that’s this device’s only with its copy', async () => {
    await items.addCopy('note', { body: body('the losing edit') })
    await items.addCopy('note', { body: { type: 'doc', content: [{ type: 'attachment', attrs: { file: null, name: 'gone.pdf' } }] } })
    await items.addCopy('note', { vault: { salt: 'S'.repeat(22), sealed: 'A'.repeat(40) }, from: 'original' })
    expect((await db.items.toArray()).filter((item) => !item.unsealed)).toEqual([])
    expect((await db.items.toArray()).some((item) => item.deviceOnly)).toBe(false)

    await db.items.clear()
    const file = { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'application/pdf', size: 2000 }
    await items.addCopy('note', { body: { type: 'doc', content: [{ type: 'attachment', attrs: { file, name: 'report.pdf' } }] } }, true)
    expect((await db.items.toArray()).map((item) => [Boolean(item.unsealed), item.deviceOnly])).toEqual(expect.arrayContaining([[true, true], [false, true]]))
    expect(await db.items.count()).toBe(2)
  })

  it('boxes a copy an earlier Nib left in the clear', async () => {
    const id = await copyOf({ body: body('left in the clear') })
    await items.boxCopies()
    expect(JSON.stringify(await items.get(id))).not.toContain('left in the clear')
    await vault.openVault('harbour lights', [])
    await items.sealCopies()
    expect(await vault.unseal(id, (await items.get(id))!.vault!)).toEqual(body('left in the clear'))
  })

  it('leaves a box this device can’t open', async () => {
    const id = await copyOf({ box: 'C'.repeat(40) })
    await vault.openVault('harbour lights', [])
    await items.sealCopies()
    expect((await items.get(id))!.unsealed).toEqual({ box: 'C'.repeat(40) })
  })

  it('won’t duplicate a copy', async () => {
    const id = await copyOf({ body: body('the other edit') })
    expect(await items.duplicate(id)).toBeUndefined()
  })
})

describe('a live query', () => {
  it('hands a live query the same objects for the rows a save left alone', async () => {
    await items.create('note', body('Left alone'), { id: 'left', updatedAt: 1, createdAt: 1 })
    await items.create('note', body('Edited'), { id: 'edited', updatedAt: 2, createdAt: 2 })
    const seen: Item[][] = []
    const watching = liveQuery(() => items.listAll()).subscribe((rows) => seen.push(rows))
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))
    await items.update('edited', body('Edited again'))
    await vi.waitFor(() => expect(seen.at(-1)!.find((row) => row.id === 'edited')!.version).toBe(2))
    watching.unsubscribe()

    const [before, after] = [seen[0], seen.at(-1)!].map((rows) => rows.find((row) => row.id === 'left')!)
    expect(after).toBe(before)
    expect(after.body).toBe(before.body)
  })
})

describe('items.createMany', () => {
  it('makes each document as create would, with its first version', async () => {
    await items.createMany([
      { kind: 'note', body: body('one'), id: 'one', createdAt: 5, updatedAt: 9, pinnedAt: 7 },
      { kind: 'page', body: body('two'), id: 'two', createdAt: 6 },
    ])
    const made = (await items.listAll()).sort((a, b) => a.id.localeCompare(b.id))
    expect(made.map(({ id, kind, version, rev, createdAt, updatedAt, pinnedAt }) => ({ id, kind, version, rev, createdAt, updatedAt, pinnedAt }))).toEqual([
      { id: 'one', kind: 'note', version: 1, rev: 1, createdAt: 5, updatedAt: 9, pinnedAt: 7 },
      { id: 'two', kind: 'page', version: 1, rev: 1, createdAt: 6, updatedAt: 6, pinnedAt: undefined },
    ])
    expect((await revisions.list('one')).map((version) => version.createdAt)).toEqual([9])
    expect((await revisions.list('two')).map((version) => version.createdAt)).toEqual([6])
  })

  it('tells a live query once', async () => {
    let emitted = 0
    const watching = liveQuery(() => items.listAll()).subscribe(() => emitted++)
    await vi.waitFor(() => expect(emitted).toBe(1))
    await items.createMany(Array.from({ length: 40 }, (_, i) => ({ kind: 'note' as const, body: body(`n${i}`), id: `n${i}`, createdAt: i })))
    await vi.waitFor(() => expect(emitted).toBeGreaterThan(1))
    await new Promise((resolve) => setTimeout(resolve, 80))
    watching.unsubscribe()
    expect(emitted).toBe(2)
  })
})
