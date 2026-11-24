import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { db, type Item, type Revision } from '../db/db'
import * as items from '../db/items'
import * as revisions from '../db/revisions'
import { plainText } from '../lib/text'
import { sha256 } from '../../worker/http'
import { sealPost } from '../../worker/inbox-seal'
import { bodyHash } from '../../worker/signing'
import { handleSync, type Deps } from '../../worker/sync'
import { Library, libraryRequests, type Region } from '../../worker/library'
import { Subscriber, subscriberRequests } from '../../worker/subscriber'
import { memoryFiles, sqlite } from '../../worker/testing'
import { httpApi, type Api } from './api'
import { deriveKeys, newCode, open, parseCode, recordKey, seal, type SyncKeys } from './crypto'
import { syncOnce } from './engine'
import { changeLibrary, UNSURE } from './changeLibrary'
import { newInboxAddress } from './inbox'

/**
 * Changing the sync code, against the sync server itself (worker/sync, its
 * libraries on real SQLite), as the app reaches it: signed, enrolled, and
 * made in the EU or wherever, as it would be.
 */

const DAY = 86_400_000
const doc = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

let regions: Record<Region, Map<string, Library>>
/** Requests on their way: one that throws here never reaches the server. */
let failing: (path: string, library: string) => boolean
let stored: Map<string, string>
let code: string
let before: SyncKeys

function serve() {
  regions = { eu: new Map(), before: new Map() }
  const subscribers = new Map<string, Subscriber>()
  const library = (region: Region, id: string) => regions[region].get(id) ?? regions[region].set(id, new Library(sqlite())).get(id)!
  const deps: Deps = {
    verify: async () => ({ productId: 'p', originalTransactionId: 'o', expiresAt: Date.now() + DAY, purchasedAt: Date.UTC(2026, 0, 1), environment: 'Production' }),
    library: (id, region) => libraryRequests(library(region, id)),
    subscriber: (key) => subscriberRequests(subscribers.get(key) ?? subscribers.set(key, new Subscriber(sqlite())).get(key)!),
    files: memoryFiles(),
  }
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const id = /^(?:Bearer|Signed) ([0-9a-f]{32})/.exec((init.headers as Record<string, string>).Authorization)![1]
    if (failing(path, id)) throw new TypeError('Load failed')
    return handleSync(new Request(`https://sync.nib.test${path}`, init), deps)
  })
}

/** Counts what each push sends. */
function counted(api: Api) {
  const push = api.push
  const sent = { records: 0 }
  api.push = async (records) => ((sent.records += records.length), push(records))
  return Object.assign(api, { sent })
}

/** Everything a library holds, opened with its code's keys. */
async function holdings(keys: SyncKeys) {
  const api = httpApi('', keys)
  const found: { items: string[]; revisions: string[] } = { items: [], revisions: [] }
  for (let since = 0, more = true; more; ) {
    const page = await api.changes(since)
    for (const record of page.records) {
      const payload = (await open(keys, record.k, record.p!)) as { t: 'item'; v: Item } | { t: 'revision'; v: Revision }
      if (payload.t === 'item') found.items.push(payload.v.id)
      else found.revisions.push(payload.v.id)
    }
    ;({ seq: since, more } = page)
  }
  return { items: found.items.sort(), revisions: found.revisions.sort() }
}

/** Another device with the old code, writing straight to the old library. */
async function otherDevice(id: string, text: string) {
  const k = await recordKey(before, 'item', id)
  const v = { id, kind: 'note', body: doc(text), createdAt: Date.now(), updatedAt: Date.now(), vault: null }
  await httpApi('', before).push([{ k, b: 0, p: await seal(before, k, { t: 'item', v, n: Date.now() }) }])
}

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.revisions.clear(), db.syncRecords.clear(), db.syncMeta.clear()])
  failing = () => false
  serve()
  stored = new Map()
  vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v), removeItem: (k: string) => stored.delete(k) })
  // A library from before they were kept in the EU, requiring signed sync, holding what's here.
  code = newCode()
  stored.set('nib-sync-code', code)
  before = await deriveKeys(code)
  regions.before.set(before.libraryId, new Library(sqlite()))
  regions.before.get(before.libraryId)!.create(await sha256(before.secret), Date.now() + DAY, Date.now())
  await httpApi('', before).requireSigned(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('changing the sync code', () => {
  it('moves everything to a new library in the EU, signed only as the old one was, switches over, and deletes the old one', async () => {
    const draft = await items.create('note', doc('A draft'))
    await items.create('page', doc('A page'))
    await revisions.record(draft, doc('Last month’s draft'), { force: true, now: Date.now() - 30 * DAY })
    await revisions.record(draft, doc('Last spring’s draft'), { force: true, now: Date.now() - 120 * DAY })
    await syncOnce(before, httpApi('', before))
    // Not yet here: the move brings it first.
    await otherDevice('ipad-note', 'Written on the iPad')
    // As the server keeps it; the last few minutes' goes up once settled, as from any pass.
    const kept = (await revisions.list(draft)).filter((revision) => revision.createdAt > Date.now() - 90 * DAY && revision.createdAt < Date.now() - DAY).map((revision) => revision.id)

    const fresh = await changeLibrary(code, 'receipt')

    expect(fresh).not.toBe(code)
    expect(parseCode(fresh)).toBe(fresh)
    expect(stored.get('nib-sync-code')).toBe(fresh)
    const keys = await deriveKeys(fresh)
    expect(regions.eu.get(keys.libraryId)?.exists()).toBe(true)
    expect(regions.before.get(keys.libraryId)?.exists()).toBeFalsy()
    // The new code's key enrolled, and nothing else taken.
    expect(await httpApi('', keys).status()).toMatchObject({ signedOnly: true })
    // Every document, and the history the server keeps, sealed under the new code.
    const held = await holdings(keys)
    expect(held.items).toEqual((await db.items.toArray()).map((item) => item.id).sort())
    expect(held.items).toContain('ipad-note')
    expect(held.revisions).toEqual(kept.sort())
    // The old code opens nothing.
    expect(regions.before.get(before.libraryId)!.exists()).toBe(false)
    await expect(httpApi('', before).status()).rejects.toMatchObject({ status: 404 })

    // What sync knows here is the new library's: nothing goes up again, but an edit does.
    const api = counted(httpApi('', keys))
    await syncOnce(keys, api)
    expect(api.sent.records).toBe(0)
    await items.update(draft, doc('Edited after the move'))
    await syncOnce(keys, api)
    expect(api.sent.records).toBe(1)
  })

  // Posts are taken in only at a look (sync/session), never while a change holds sync: any that had come since the
  // last one were deleted with the old library, unread (the server audit of 2026-11-23).
  it('takes in the posts waiting in the old library’s inbox first, as notes that go to the new one', async () => {
    // The address is this page's (sync/inbox): none here, in a test without a page.
    vi.stubGlobal('location', { origin: 'https://sync.nib.test' })
    const { address } = await newInboxAddress(before, httpApi('', before))
    const library = regions.before.get(before.libraryId)!
    const hashed = await bodyHash(new TextEncoder().encode(address.split('.').at(-1)!))
    library.addPost(hashed, await sealPost(library.inboxFor(hashed, Date.now()), { title: 'Sent while the code was changing' }), Date.now())
    expect((await httpApi('', before).inbox()).posts).toHaveLength(1)

    const keys = await deriveKeys(await changeLibrary(code, 'receipt', 'Inbox'))
    const here = await db.items.toArray()
    expect(here.map((item) => [plainText(item.body), item.folder])).toEqual([['Sent while the code was changing', 'Inbox']])
    expect((await holdings(keys)).items).toEqual(here.map((item) => item.id))
  })

  // Taken once, at the start, a post that came while the files were fetched and the new library filled was answered
  // as received and deleted with the old library (found checking the fix, 2026-11-23).
  it('takes in a post that comes while the new library is being filled, too', async () => {
    vi.stubGlobal('location', { origin: 'https://sync.nib.test' })
    const { address } = await newInboxAddress(before, httpApi('', before))
    const library = regions.before.get(before.libraryId)!
    const hashed = await bodyHash(new TextEncoder().encode(address.split('.').at(-1)!))
    const sealed = await sealPost(library.inboxFor(hashed, Date.now()), { title: 'Sent while the new library was filled' })
    await items.create('note', doc('A draft'))
    let posted = false
    failing = (path, id) => {
      // As the first push to the new library goes out.
      if (!posted && id !== before.libraryId && path === '/v1/changes') {
        library.addPost(hashed, sealed, Date.now())
        posted = true
      }
      return false
    }

    const keys = await deriveKeys(await changeLibrary(code, 'receipt', 'Inbox'))
    expect(posted).toBe(true)
    const here = await db.items.toArray()
    expect(here.map((item) => plainText(item.body)).sort()).toEqual(['A draft', 'Sent while the new library was filled'])
    // Made after the new library was filled, it goes there with this device's next pass.
    await syncOnce(keys, httpApi('', keys))
    expect((await holdings(keys)).items).toEqual(here.map((item) => item.id).sort())
  })

  // The old library deleted and only its answer lost, that was taken for a failure: the new library was deleted
  // too, both were gone, and the writer was told that nothing had changed (found checking the fix, 2026-11-23).
  it('keeps the new library and moves to it when the old one was deleted and only its answer was lost', async () => {
    await items.create('note', doc('A draft'))
    await syncOnce(before, httpApi('', before))
    const real = fetch
    let lost = 0
    vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
      const response = await real(path, init)
      const id = /^(?:Bearer|Signed) ([0-9a-f]{32})/.exec((init.headers as Record<string, string>).Authorization)![1]
      if (init.method === 'DELETE' && path === '/v1/library' && id === before.libraryId && lost++ === 0) throw new TypeError('Load failed')
      return response
    })

    const fresh = await changeLibrary(code, 'receipt')
    // Asked again to go, it said there was none: once lost, once answered.
    expect(lost).toBe(2)
    expect(stored.get('nib-sync-code')).toBe(fresh)
    const keys = await deriveKeys(fresh)
    expect(regions.eu.get(keys.libraryId)?.exists()).toBe(true)
    expect(regions.before.get(before.libraryId)!.exists()).toBe(false)
    expect((await holdings(keys)).items).toHaveLength(1)
  })

  // Every answer lost, and the last word that it was gone: asked once whether it was still there, a library in
  // the middle of being deleted said yes, the new one was deleted, and then the old one finished going.
  it('moves to the new library when every try at deleting the old one lost its answer, and it’s gone', async () => {
    await items.create('note', doc('A draft'))
    await syncOnce(before, httpApi('', before))
    const real = fetch
    let tries = 0
    vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
      const response = await real(path, init)
      const id = /^(?:Bearer|Signed) ([0-9a-f]{32})/.exec((init.headers as Record<string, string>).Authorization)![1]
      if (init.method === 'DELETE' && path === '/v1/library' && id === before.libraryId) {
        tries++
        throw new TypeError('Load failed')
      }
      return response
    })
    const fresh = await changeLibrary(code, 'receipt')
    expect(tries).toBe(3)
    expect(stored.get('nib-sync-code')).toBe(fresh)
    expect(regions.eu.get((await deriveKeys(fresh)).libraryId)?.exists()).toBe(true)
  })

  /** The old library's own deletion answered as `answer` says, after it's done (`reached`) or in its place. */
  function deleting(answer: (tries: number) => Response | null, reached = false) {
    const real = fetch
    const state = { tries: 0 }
    vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
      const id = /^(?:Bearer|Signed) ([0-9a-f]{32})/.exec((init.headers as Record<string, string>).Authorization)![1]
      if (init.method !== 'DELETE' || path !== '/v1/library' || id !== before.libraryId) return real(path, init)
      const instead = answer(++state.tries)
      if (!instead) return real(path, init)
      if (reached) await real(path, init)
      return instead
    })
    return state
  }
  const failure = (status: number) => new Response(JSON.stringify({ error: 'Sync failed.' }), { status, headers: { 'Content-Type': 'application/json' } })

  // A refusal was taken for "still there". One that came after the library went (the same request sent twice by
  // the network, the second refused as taken already; a refusal from in front of the server) deleted both, with
  // "Nothing has changed" (found checking the fix, 2026-11-23).
  it.each([401, 403, 429])('moves to the new library when the old one was deleted and its answer was a %i', async (status) => {
    await items.create('note', doc('A draft'))
    await syncOnce(before, httpApi('', before))
    const state = deleting((tries) => (tries === 1 ? failure(status) : null), true)
    const fresh = await changeLibrary(code, 'receipt')
    expect(state.tries).toBe(2)
    expect(stored.get('nib-sync-code')).toBe(fresh)
    expect(regions.before.get(before.libraryId)!.exists()).toBe(false)
  })

  it('refused each time, says it can’t tell: the old library is still there, and the new one is deleted', async () => {
    await items.create('note', doc('A draft'))
    await syncOnce(before, httpApi('', before))
    const state = deleting(() => failure(403))
    await expect(changeLibrary(code, 'receipt')).rejects.toThrow(UNSURE)
    expect(state.tries).toBe(3)
    expect(stored.get('nib-sync-code')).toBe(code)
    expect([...regions.eu.values()].some((library) => library.exists())).toBe(false)
    expect(regions.before.get(before.libraryId)!.exists()).toBe(true)
  })

  // The old library deleted, and the server failing after (telling a subscription of it, say): its 500 was taken for
  // a refusal, the new library was deleted too, and the writer was told nothing had changed (found checking the fix, 2026-11-23).
  it('moves to the new library when the old one was deleted and the server then failed', async () => {
    await items.create('note', doc('A draft'))
    await syncOnce(before, httpApi('', before))
    const state = deleting((tries) => (tries === 1 ? failure(500) : null), true)
    const fresh = await changeLibrary(code, 'receipt')
    // Asked again, it said there was none.
    expect(state.tries).toBe(2)
    expect(stored.get('nib-sync-code')).toBe(fresh)
    expect(regions.eu.get((await deriveKeys(fresh)).libraryId)?.exists()).toBe(true)
    expect(regions.before.get(before.libraryId)!.exists()).toBe(false)
  })

  it('says it can’t tell when the server goes on failing, and doesn’t say nothing has changed', async () => {
    await items.create('note', doc('A draft'))
    await syncOnce(before, httpApi('', before))
    const state = deleting(() => failure(503))
    await expect(changeLibrary(code, 'receipt')).rejects.toThrow(UNSURE)
    expect(state.tries).toBe(3)
    expect(stored.get('nib-sync-code')).toBe(code)
    expect(regions.before.get(before.libraryId)!.exists()).toBe(true)
  })

  // Said to have changed nothing, when it couldn't be told: the old library, or both, might be gone.
  it('says it can’t tell, when no answer comes back at all as to whether the old library went', async () => {
    await items.create('note', doc('A draft'))
    await syncOnce(before, httpApi('', before))
    let tries = 0
    failing = (path, id) => id === before.libraryId && path === '/v1/library' && ++tries > 0

    await expect(changeLibrary(code, 'receipt')).rejects.toThrow(UNSURE)
    expect(tries).toBe(3)
    // As the panel shows a message of its own (SyncPanel `run`): by a word it knows.
    expect(UNSURE).toMatch(/code|library|Plus/)
    expect(UNSURE).not.toMatch(/[Nn]othing has changed/)
    expect(stored.get('nib-sync-code')).toBe(code)
    failing = () => false
    expect(await httpApi('', before).status()).toMatchObject({ signedOnly: true })
  })

  it('fails halfway with nothing changed: the old library goes on syncing, and the new one is deleted', async () => {
    // Two pushes' worth, so the new library is half filled when it fails.
    await db.items.bulkPut(Array.from({ length: 250 }, (_, i) => ({ id: `note-${i}`, kind: 'note', body: doc(`Note ${i}`), createdAt: i, updatedAt: i, version: 1, rev: 1 }) as Item))
    await syncOnce(before, httpApi('', before))
    await syncOnce(before, httpApi('', before))
    const known = { records: await db.syncRecords.toArray(), meta: await db.syncMeta.toArray() }
    let pushes = 0
    failing = (path, library) => library !== before.libraryId && path === '/v1/changes' && ++pushes === 2

    await expect(changeLibrary(code, 'receipt')).rejects.toThrow('Load failed')

    expect(pushes).toBe(2)
    expect(stored.get('nib-sync-code')).toBe(code)
    expect({ records: await db.syncRecords.toArray(), meta: await db.syncMeta.toArray() }).toEqual(known)
    expect([...regions.eu.values()].some((library) => library.exists())).toBe(false)
    // The old library, as it was: still signed only, and syncing both ways.
    expect(await httpApi('', before).status()).toMatchObject({ signedOnly: true })
    await otherDevice('ipad-note', 'Written on the iPad')
    await items.update('note-0', doc('Edited after the failure'))
    const old = counted(httpApi('', before))
    expect((await syncOnce(before, old)).changed).toEqual(['ipad-note'])
    expect(old.sent.records).toBe(1)
    expect(plainText((await items.get('ipad-note'))!.body)).toBe('Written on the iPad')
    expect((await holdings(before)).items).toHaveLength(251)
  })
})
