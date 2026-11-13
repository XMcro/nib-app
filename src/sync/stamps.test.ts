// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import * as items from '../db/items'
import { readCollection, STAMPS_SYNCED, type Collection } from '../lib/collection'
import { deriveKeys, newCode, open, recordKey, type SyncKeys } from './crypto'
import { resetSyncState, syncOnce } from './engine'
import { fakeServer } from './fakeServer'

/**
 * The stamps between devices (lib/collection), through the sync engine: one
 * sealed record, merged by keeping all that either device has. Two devices
 * here take turns with the one storage and database, as a device does that
 * joins a library: its own stamps, and nothing yet known of the server's.
 */

let keys: SyncKeys
let server: ReturnType<typeof fakeServer>

/** A device with these stamps, knowing nothing of the server yet. */
async function device(stamps: Partial<Collection>) {
  localStorage.clear()
  const keys: Record<keyof Collection, string> = { stamps: 'nib-stamps', book: 'nib-book', late: 'nib-doors-late', christmas: 'nib-christmas', birthday: 'nib-birthday', trades: 'nib-trades' }
  for (const [part, value] of Object.entries(stamps)) localStorage.setItem(keys[part as keyof Collection], JSON.stringify(value))
  await resetSyncState()
}

/** What the server holds, opened with the code. */
async function onServer(): Promise<Collection | undefined> {
  const k = await recordKey(keys, 'stamps', 'collection')
  const record = server.records.get(k)
  return record?.p ? ((await open(keys, k, record.p)) as { v: Collection }).v : undefined
}

const iphone: Partial<Collection> = {
  stamps: ['2026-11-03', '2026-11-04'],
  book: [
    ['2026-11-03', 1],
    ['2026-11-03', 2],
    ['2026-11-03', 130],
    ['2026-11-04', 3],
    ['2026-11-04', 4],
    ['2026-11-04', 170],
  ],
  birthday: [2026],
}
const mac: Partial<Collection> = {
  stamps: ['2026-11-01'],
  book: [
    ['2026-11-01', 9],
    ['2026-11-01', 10],
    ['2026-11-01', 191],
  ],
  late: { '2025-12-02': '2025-12-04' },
  christmas: [2025],
}

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.revisions.clear(), db.syncRecords.clear(), db.syncMeta.clear()])
  keys = await deriveKeys(newCode())
  server = fakeServer()
})

describe('stamps through sync', () => {
  it('opens today’s pack on the Mac once the iPhone has opened it, and keeps what each found, sealed', async () => {
    await device(iphone)
    await syncOnce(keys, server.api)
    const sealed = [...server.records.values()][0].p!
    expect(sealed).not.toContain('2026-11-04')

    await device(mac)
    const told = vi.fn()
    window.addEventListener(STAMPS_SYNCED, told)
    await syncOnce(keys, server.api)
    window.removeEventListener(STAMPS_SYNCED, told)
    expect(told).toHaveBeenCalled()
    const both = readCollection()
    expect(both.book.filter(([day]) => day === '2026-11-04')).toEqual(iphone.book!.slice(3))
    expect(both.stamps).toEqual(['2026-11-01', '2026-11-03', '2026-11-04'])
    expect(both.late).toEqual(mac.late)
    expect(both).toMatchObject({ christmas: [2025], birthday: [2026] })
    // The Mac's own went up with it.
    expect(await onServer()).toEqual(both)

    // And the iPhone has the Mac's next time.
    await device(iphone)
    await syncOnce(keys, server.api)
    expect(readCollection()).toEqual(both)
  })

  it('keeps the trades made on each device, so the points are the same on both', async () => {
    await device({ ...iphone, trades: [{ id: 'one', day: '2026-11-04', sold: [3] }] })
    await syncOnce(keys, server.api)
    await device({ ...iphone, trades: [{ id: 'two', day: '2026-11-04', sold: [130] }] })
    await syncOnce(keys, server.api)
    expect(readCollection().trades.map(({ id }) => id)).toEqual(['one', 'two'])
    expect((await onServer())!.trades).toHaveLength(2)
  })

  it('keeps both packs for a day opened on two devices before they synced', async () => {
    await device({ stamps: ['2026-11-04'], book: [['2026-11-04', 3], ['2026-11-04', 4], ['2026-11-04', 170]] })
    await syncOnce(keys, server.api)
    await device({ stamps: ['2026-11-04'], book: [['2026-11-04', 5], ['2026-11-04', 3], ['2026-11-04', 140]] })
    await syncOnce(keys, server.api)
    expect(readCollection().book.map(([, no]) => no)).toEqual([3, 4, 5, 140, 170])
  })

  it('sends nothing again while nothing new is found, and nothing at all with no stamps', async () => {
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

  it('never sends fewer than the server has, though this device has lost some', async () => {
    await device(iphone)
    await syncOnce(keys, server.api)
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-11-05']))
    localStorage.setItem('nib-book', JSON.stringify([['2026-11-05', 7]]))
    await syncOnce(keys, server.api)
    const held = (await onServer())!
    expect(held.stamps).toEqual(['2026-11-03', '2026-11-04', '2026-11-05'])
    expect(held.book).toHaveLength(7)
  })

  it('is never sent as deleted, and comes back up if the server says it is', async () => {
    await device(iphone)
    await syncOnce(keys, server.api)
    const k = await recordKey(keys, 'stamps', 'collection')
    const { s } = (await server.api.push([{ k, b: server.records.get(k)!.s, d: 1 }])).results[0] as { s: number }
    expect(s).toBeGreaterThan(0)
    await syncOnce(keys, server.api)
    expect(server.records.get(k)!.d).toBeUndefined()
    expect(await onServer()).toEqual(readCollection())
  })
})
