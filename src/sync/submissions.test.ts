// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { readSubmissions, replaceSubmissions, type Submissions } from '../lib/submissions'
import { deriveKeys, newCode, open, recordKey, type SyncKeys } from './crypto'
import { resetSyncState, syncOnce } from './engine'
import { fakeServer } from './fakeServer'

/**
 * The submissions between devices (lib/submissions), through the sync
 * engine: one sealed record, merged submission by submission, the one
 * changed or deleted last kept. Two devices take turns with the one storage
 * and database, as in sync/looks.test.
 */

let keys: SyncKeys
let server: ReturnType<typeof fakeServer>

async function device(submissions: Submissions) {
  replaceSubmissions(submissions)
  await resetSyncState()
}

async function onServer(): Promise<Submissions | undefined> {
  const k = await recordKey(keys, 'submissions', 'submissions')
  const record = server.records.get(k)
  return record?.p ? ((await open(keys, k, record.p)) as { v: Submissions }).v : undefined
}

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.revisions.clear(), db.syncRecords.clear(), db.syncMeta.clear()])
  keys = await deriveKeys(newCode())
  server = fakeServer()
})

describe('the submissions through sync', () => {
  const iphone: Submissions = {
    a: { at: 5, piece: { document: 'p' }, where: 'Granta', sent: '2026-11-01', answer: 'more' },
    b: { at: 2, piece: { book: 'Novel' }, where: 'An agent' },
  }
  const mac: Submissions = { a: { at: 3, piece: { document: 'p' }, where: 'Granta' }, b: { at: 4, gone: true }, c: { at: 6, piece: { document: 'q' }, where: 'Ploughshares' } }
  const both: Submissions = { a: iphone.a, b: { at: 4, gone: true }, c: mac.c }

  it('brings the iPhone’s to the Mac, submission by submission, a deleted one staying deleted, sealed', async () => {
    await device(iphone)
    await syncOnce(keys, server.api)
    expect([...server.records.values()].map((record) => record.p).join('')).not.toContain('Granta')

    await device(mac)
    await syncOnce(keys, server.api)
    expect(readSubmissions()).toEqual(both)
    expect(await onServer()).toEqual(both)

    await device(iphone)
    await syncOnce(keys, server.api)
    expect(readSubmissions()).toEqual(both)
  })

  it('sends nothing with none, and nothing again while nothing changes', async () => {
    await device({})
    await syncOnce(keys, server.api)
    expect(await onServer()).toBeUndefined()
    await device(iphone)
    await syncOnce(keys, server.api)
    const before = [...server.records.values()].map((record) => record.s)
    await syncOnce(keys, server.api)
    expect([...server.records.values()].map((record) => record.s)).toEqual(before)
  })
})
