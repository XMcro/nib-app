// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import * as items from '../db/items'
import { readFolderSettings, replaceFolderSettings, type FolderSettings } from '../lib/folderSettings'
import { deriveKeys, newCode, open, recordKey, type SyncKeys } from './crypto'
import { resetSyncState, syncOnce } from './engine'
import { fakeServer } from './fakeServer'

/**
 * The folders' settings between devices (lib/folderSettings), through the
 * sync engine: one sealed record, merged folder by folder, the one changed
 * last kept. Two devices here take turns with the one storage and database,
 * as a device does that joins a library: its own settings, and nothing yet
 * known of the server's.
 */

let keys: SyncKeys
let server: ReturnType<typeof fakeServer>

/** A device with these settings, knowing nothing of the server yet. */
async function device(settings: FolderSettings) {
  replaceFolderSettings(settings)
  await resetSyncState()
}

/** What the server holds, opened with the code. */
async function onServer(): Promise<FolderSettings | undefined> {
  const k = await recordKey(keys, 'folders', 'folders')
  const record = server.records.get(k)
  return record?.p ? ((await open(keys, k, record.p)) as { v: FolderSettings }).v : undefined
}

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.revisions.clear(), db.syncRecords.clear(), db.syncMeta.clear()])
  keys = await deriveKeys(newCode())
  server = fakeServer()
})

describe('the folders’ settings through sync', () => {
  const iphone: FolderSettings = { novel: { at: 5, place: 1 }, blog: { at: 2, place: 2 } }
  const mac: FolderSettings = { novel: { at: 3, place: 2 }, blog: { at: 4, place: 1 }, poems: { at: 6, gone: true } }
  const both: FolderSettings = { blog: { at: 4, place: 1 }, novel: { at: 5, place: 1 }, poems: { at: 6, gone: true } }

  it('brings the iPhone’s to the Mac, folder by folder, the one changed last kept, sealed', async () => {
    await device(iphone)
    await syncOnce(keys, server.api)
    expect([...server.records.values()].map((record) => record.p).join('')).not.toContain('novel')

    await device(mac)
    await syncOnce(keys, server.api)
    expect(readFolderSettings()).toEqual(both)
    // The Mac's newer ones went up with it.
    expect(await onServer()).toEqual(both)

    // And the iPhone has them next time.
    await device(iphone)
    await syncOnce(keys, server.api)
    expect(readFolderSettings()).toEqual(both)
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

  it('sends one changed here since, over the server’s', async () => {
    await device(iphone)
    await syncOnce(keys, server.api)
    replaceFolderSettings({ ...readFolderSettings(), blog: { at: 9, place: 1 } })
    await syncOnce(keys, server.api)
    expect((await onServer())!.blog).toEqual({ at: 9, place: 1 })
  })
})
