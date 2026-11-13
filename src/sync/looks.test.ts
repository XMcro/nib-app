// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import * as items from '../db/items'
import { parseLook, readSavedLooks, replaceSavedLooks, type SavedLooks } from '../lib/look'
import { deriveKeys, newCode, open, recordKey, type SyncKeys } from './crypto'
import { resetSyncState, syncOnce } from './engine'
import { fakeServer } from './fakeServer'

/**
 * The saved looks between devices (lib/look), through the sync engine: one
 * sealed record, merged look by look, the one saved or deleted last kept. Two
 * devices here take turns with the one storage and database, as a device does
 * that joins a library: its own looks, and nothing yet known of the server's.
 */

let keys: SyncKeys
let server: ReturnType<typeof fakeServer>

/** A device with these saved looks, knowing nothing of the server yet. */
async function device(looks: SavedLooks) {
  replaceSavedLooks(looks)
  await resetSyncState()
}

/** What the server holds, opened with the code. */
async function onServer(): Promise<SavedLooks | undefined> {
  const k = await recordKey(keys, 'looks', 'looks')
  const record = server.records.get(k)
  return record?.p ? ((await open(keys, k, record.p)) as { v: SavedLooks }).v : undefined
}

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.revisions.clear(), db.syncRecords.clear(), db.syncMeta.clear()])
  keys = await deriveKeys(newCode())
  server = fakeServer()
})

describe('the saved looks through sync', () => {
  const look = (size: string) => parseLook({ size })
  const iphone: SavedLooks = { Drafting: { at: 5, look: look('large'), theme: 'light' }, Editing: { at: 2, look: look('small'), theme: 'dark' } }
  const mac: SavedLooks = { Drafting: { at: 3, look: look('small'), theme: 'dark' }, Editing: { at: 4, gone: true }, Night: { at: 6, look: look('standard'), theme: 'midnight-blue' } }
  const both: SavedLooks = { Drafting: iphone.Drafting, Editing: { at: 4, gone: true }, Night: mac.Night }

  it('brings the iPhone’s to the Mac, look by look, the one saved last kept, a deleted one staying deleted, sealed', async () => {
    await device(iphone)
    await syncOnce(keys, server.api)
    expect([...server.records.values()].map((record) => record.p).join('')).not.toContain('Drafting')

    await device(mac)
    await syncOnce(keys, server.api)
    expect(readSavedLooks()).toEqual(both)
    // The Mac's newer ones went up with it.
    expect(await onServer()).toEqual(both)

    // And the iPhone has them next time: Editing gone, Night there to choose.
    await device(iphone)
    await syncOnce(keys, server.api)
    expect(readSavedLooks()).toEqual(both)
  })

  it('sends nothing again while nothing changes, and nothing at all with none', async () => {
    await device({})
    await items.create('note', { type: 'doc', content: [] })
    await syncOnce(keys, server.api)
    expect(await onServer()).toBeUndefined()

    await device(iphone)
    await syncOnce(keys, server.api)
    const before = [...server.records.values()].map((record) => record.s)
    await syncOnce(keys, server.api)
    expect([...server.records.values()].map((record) => record.s)).toEqual(before)
  })

  it('sends one saved here since, over the server’s', async () => {
    await device(iphone)
    await syncOnce(keys, server.api)
    replaceSavedLooks({ ...readSavedLooks(), Editing: { at: 9, look: look('larger'), theme: 'light' } })
    await syncOnce(keys, server.api)
    expect((await onServer())!.Editing).toEqual({ at: 9, look: look('larger'), theme: 'light' })
  })
})
