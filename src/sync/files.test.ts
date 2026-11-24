import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { db } from '../db/db'
import * as items from '../db/items'
import * as revisions from '../db/revisions'
import { filesGone, filesWaiting, removeFiles, sendFiles } from '../lib/fileQueue'
import { keepFile } from '../lib/files'
import { filesIn, type Full } from '../lib/image'
import * as vault from '../lib/vault'
import { handleSync, type Deps } from '../../worker/sync'
import { Library, libraryRequests, type Region } from '../../worker/library'
import { Subscriber, subscriberRequests } from '../../worker/subscriber'
import { memoryFiles, sqlite } from '../../worker/testing'
import { httpApi } from './api'
import { changeLibrary } from './changeLibrary'
import { deriveKeys, newCode, recordKey, seal, type SyncKeys } from './crypto'
import { SERVER_HISTORY_MS, syncOnce } from './engine'
import { fetchFile, nameFiles, openFile, sealFile, syncFiles } from './files'

/**
 * A library's files between its devices (sync/files), against the sync
 * server itself as the app reaches it (worker/sync and worker/files, signed
 * requests, a file store that checks hashes as R2 does). What's on this
 * device is a Map standing in for the file store (lib/files), which has its
 * own tests in a browser.
 */

const device = vi.hoisted(() => ({ files: new Map<string, Blob>(), full: false }))
vi.mock('../lib/files', () => ({
  // `full`: this device has no room, and keeps nothing (lib/files).
  keepFile: async (blob: Blob, id: string = crypto.randomUUID()) => (device.full ? null : (device.files.set(id, blob), id)),
  readFile: async (id: string) => device.files.get(id) ?? null,
  hasFile: async (id: string) => device.files.has(id),
  forgetFile: async (id: string) => void device.files.delete(id),
  fileUrl: async (id: string) => (device.files.has(id) ? `file:${id}` : null),
}))

const DAY = 86_400_000
const SMALL = `data:image/png;base64,${btoa('the small picture a note holds')}`
const pictured = (text: string, ...fulls: Full[]): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }, ...fulls.map((full) => ({ type: 'image', attrs: { src: SMALL, full } }))] }],
})
const bytesOf = (size: number, fill = 1) => new Uint8Array(size).map((_, at) => (at * 7 + fill) % 251)
/** An original kept on this device, as lib/originals keeps one. */
async function original(size = 100_000, fill = 1): Promise<Full> {
  const id = (await keepFile(new Blob([bytesOf(size, fill)], { type: 'image/png' })))!
  return { id, type: 'image/png', size }
}

let stored: Map<string, string>
let server: ReturnType<typeof memoryFiles>
let filesLimit: number | undefined
let sent: string[]
let code: string
let keys: SyncKeys
let regions: Record<Region, Map<string, Library>>

function serve() {
  regions = { eu: new Map(), before: new Map() }
  const subscribers = new Map<string, Subscriber>()
  server = memoryFiles()
  sent = []
  const requests = (id: string, region: Region) => {
    const library = regions[region].get(id) ?? regions[region].set(id, new Library(sqlite(), undefined, filesLimit)).get(id)!
    const home = `${region}-${id}`
    return libraryRequests(library, Date.now, { alarm: async () => {}, home, deleteFiles: async () => void [...server.kept.keys()].filter((name) => name.startsWith(`${home}/`)).forEach((name) => server.kept.delete(name)) })
  }
  const deps: Deps = {
    verify: async () => ({ productId: 'p', originalTransactionId: 'o', expiresAt: Date.now() + DAY, purchasedAt: Date.UTC(2026, 0, 1), environment: 'Production' }),
    library: (id, region) => requests(id, region),
    subscriber: (key) => subscriberRequests(subscribers.get(key) ?? subscribers.set(key, new Subscriber(sqlite())).get(key)!),
    files: server,
  }
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    if (init.method === 'PUT') sent.push(path)
    const headers = { ...(init.headers as Record<string, string>) }
    // As a browser says it of a body of bytes.
    if (init.body instanceof Uint8Array) headers['Content-Length'] = String(init.body.length)
    return handleSync(new Request(`https://sync.nib.test${path}`, { ...init, headers }), deps)
  })
}

/** One look, as a session makes it: the documents, then their files. */
const pass = async () => {
  await syncOnce(keys, httpApi('', keys))
  return syncFiles(keys, httpApi('', keys))
}
const onServer = () => [...server.kept.values()]

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.revisions.clear(), db.syncRecords.clear(), db.syncMeta.clear()])
  device.files.clear()
  device.full = false
  filesLimit = undefined
  serve()
  stored = new Map()
  vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v), removeItem: (k: string) => stored.delete(k) })
  code = newCode()
  stored.set('nib-sync-code', code)
  keys = await deriveKeys(code)
  await httpApi('', keys).create('receipt')
})

afterEach(() => {
  vault.closeVault()
  vi.unstubAllGlobals()
})

describe('a file, sealed', () => {
  it('opens to what it was, under its own key and code and no other, and only whole', async () => {
    const file = bytesOf(70_000)
    const sealed = await sealFile(keys, 'its-key', file)
    expect(await openFile(keys, 'its-key', sealed)).toEqual(file)
    expect(await openFile(keys, 'another-key', sealed)).toBeNull()
    expect(await openFile(await deriveKeys(newCode()), 'its-key', sealed)).toBeNull()
    expect(await openFile(keys, 'its-key', sealed.slice(0, -1))).toBeNull()
    const changed = sealed.slice()
    changed[5000] ^= 1
    expect(await openFile(keys, 'its-key', changed)).toBeNull()
    expect(await openFile(keys, 'its-key', new Uint8Array(4))).toBeNull()
    // Sealed by someone with the code, and saying it's longer than what's there: not a file.
    const lying = new Uint8Array(65_536)
    new DataView(lying.buffer).setUint32(0, 70_000)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('its-key') }, keys.encrypt, lying))
    expect(await openFile(keys, 'its-key', new Uint8Array([...iv, ...cipher]))).toBeNull()
  })

  it('shows the server roughly how big it is, and nothing of what it is', async () => {
    // To the next 64 KB, with its own length inside; then the IV and the tag.
    for (const [size, padded] of [[1, 65_536], [65_532, 65_536], [65_533, 131_072], [70_000, 131_072]]) {
      expect((await sealFile(keys, 'k', bytesOf(size))).length).toBe(padded + 28)
    }
    // The most a file may be still fits what the server takes.
    expect(Math.ceil((4 + 25 * 1024 * 1024) / 65_536) * 65_536 + 28).toBeLessThanOrEqual(26 * 1024 * 1024)
    const twice = [await sealFile(keys, 'k', bytesOf(1000)), await sealFile(keys, 'k', bytesOf(1000))]
    expect(Buffer.from(twice[0]).equals(Buffer.from(twice[1]))).toBe(false)
    expect(Buffer.from(twice[0]).includes(Buffer.from(bytesOf(1000).subarray(0, 64)))).toBe(false)
  })
})

describe('a library’s files between its devices', () => {
  it('sends a document’s originals after it, sealed, under a name that isn’t theirs, and once', async () => {
    const full = await original()
    await items.create('note', pictured('On the hill', full))
    expect(await pass()).toEqual({ full: false, more: false })
    expect(onServer().map((file) => file.length)).toEqual([131_072 + 28])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(/^\/v1\/files\/[A-Za-z0-9_-]{43}$/)
    expect(sent[0]).not.toContain(full.id)
    expect(Buffer.from(onServer()[0]).includes(Buffer.from(bytesOf(64)))).toBe(false)
    expect(filesWaiting()).toEqual([])
    // And the room they take, as the server counts it, for Settings to say.
    expect(await httpApi('', keys).files()).toEqual({ files: [{ k: sent[0].split('/').pop(), size: 131_072 + 28 }], bytes: 131_072 + 28, limit: 2_000_000_000 })

    // Nothing again at the next look, nor when the note is edited and sent again.
    await pass()
    await items.update((await db.items.toArray())[0].id, pictured('On the hill, later', full))
    await pass()
    expect(sent).toHaveLength(1)
  })

  it('gives another device the original the first time it asks, checked against what the note says of it', async () => {
    const full = await original(100_000, 5)
    await items.create('note', pictured('On the hill', full))
    await pass()
    // Another device: the same code, none of the files.
    device.files.clear()
    stored.delete(`nib-files-sent-${keys.libraryId}`)
    const api = httpApi('', await deriveKeys(code))
    expect(await fetchFile(keys, api, { ...full, size: full.size + 1 })).toBe(false)
    expect(device.files.size).toBe(0)
    expect(await fetchFile(keys, api, { id: crypto.randomUUID(), type: 'image/png', size: 5 })).toBe(false)
    expect(await fetchFile(keys, api, full)).toBe(true)
    const here = device.files.get(full.id)!
    expect(here.type).toBe('image/png')
    expect(new Uint8Array(await here.arrayBuffer())).toEqual(bytesOf(100_000, 5))
    // Fetched, it's known to be there: the note edited here doesn't send it back.
    await items.update((await db.items.toArray())[0].id, pictured('Edited on the other device', full))
    await pass()
    expect(sent).toHaveLength(1)
  })

  it('keeps nothing the server hands back that isn’t the file', async () => {
    const full = await original()
    await items.create('note', pictured('On the hill', full))
    await pass()
    device.files.clear()
    const [name, sealed] = [...server.kept.entries()][0]
    const tampered = sealed.slice()
    tampered[40] ^= 1
    server.kept.set(name, tampered)
    expect(await fetchFile(keys, httpApi('', keys), full)).toBe(false)
    expect(device.files.size).toBe(0)
  })

  it('sends a few at a time, and says there are more', async () => {
    for (let n = 0; n < 6; n++) await items.create('note', pictured(`Note ${n}`, await original(1000, n)))
    expect(await pass()).toEqual({ full: false, more: true })
    expect(onServer()).toHaveLength(4)
    expect(await pass()).toEqual({ full: false, more: false })
    expect(onServer()).toHaveLength(6)
    expect(sent).toHaveLength(6)
  })

  it('leaves a file waiting when the server can’t be reached, and sends it at the next look', async () => {
    await items.create('note', pictured('On the hill', await original()))
    await syncOnce(keys, httpApi('', keys))
    const real = fetch
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Load failed')
    })
    await expect(syncFiles(keys, httpApi('', keys))).rejects.toThrow('Load failed')
    expect(filesWaiting()).toHaveLength(1)
    vi.stubGlobal('fetch', real)
    expect(await pass()).toEqual({ full: false, more: false })
    expect(onServer()).toHaveLength(1)
  })

  it('lets a file it hasn’t got go by: another device, which has it, sends it', async () => {
    const elsewhere: Full = { id: crypto.randomUUID(), type: 'image/png', size: 4000 }
    await items.create('note', pictured('Came from the iPad', elsewhere))
    expect(await pass()).toEqual({ full: false, more: false })
    expect(sent).toEqual([])
    expect(filesWaiting()).toEqual([])
  })

  it('says when the library’s files are full, and sends no more till something is taken off', async () => {
    filesLimit = 200_000
    serve()
    await httpApi('', keys).create('receipt')
    const first = await original(1000, 1)
    const one = await items.create('note', pictured('First', first))
    expect(await pass()).toEqual({ full: false, more: false })
    await items.create('note', pictured('Second', await original(150_000, 2)))
    expect(await pass()).toEqual({ full: true, more: false })
    expect(onServer()).toHaveLength(1)
    // Not tried again at every look.
    const tried = sent.length
    expect(await pass()).toEqual({ full: true, more: false })
    expect(sent).toHaveLength(tried)
    // Room made: it goes.
    await items.setDeviceOnly(one, true)
    expect(await pass()).toEqual({ full: false, more: false })
    expect(onServer().map((file) => file.length)).toEqual([196_608 + 28])
  })

  it('sends nothing of a note kept on this device only, takes its files off the server when it becomes one, and sends them when it syncs again', async () => {
    const full = await original()
    const kept = await items.create('note', pictured('For this device', full), { deviceOnly: true })
    await pass()
    expect(sent).toEqual([])

    await items.setDeviceOnly(kept, false)
    await pass()
    expect(onServer()).toHaveLength(1)

    await items.setDeviceOnly(kept, true)
    expect(filesGone()).toEqual([full.id])
    await pass()
    expect(onServer()).toEqual([])
    expect(filesGone()).toEqual([])
    // Still here.
    expect(device.files.has(full.id)).toBe(true)

    await items.setDeviceOnly(kept, false)
    await pass()
    expect(onServer()).toHaveLength(1)
  })

  it('leaves on the server a file that another note that syncs still names', async () => {
    const full = await original()
    const one = await items.create('note', pictured('One', full))
    await items.create('note', pictured('Its copy', full))
    await pass()
    await items.setDeviceOnly(one, true)
    expect(filesGone()).toEqual([])
    await pass()
    expect(onServer()).toHaveLength(1)
  })

  it('keeps no original of a locked note: gone from this device and from the server, and never sent', async () => {
    await vault.openVault('harbour lights', [])
    const full = await original()
    const shared = await original(2000, 9)
    const note = await items.create('note', pictured('To be locked', full, shared))
    await items.create('note', pictured('Not locked', shared))
    await pass()
    expect(onServer()).toHaveLength(2)

    await items.lock(note, pictured('To be locked', full, shared))
    // What's sealed names none.
    const locked = (await db.items.get(note))!
    expect(JSON.stringify(await vault.unseal(note, locked.vault!))).not.toContain(full.id)
    // Its own original is gone from here; the one another note names stays.
    expect([...device.files.keys()]).toEqual([shared.id])
    await pass()
    expect(onServer().map((file) => file.length)).toEqual([65_536 + 28])

    // Edited while locked, with a picture that names an original: sealed without it, and nothing sent.
    const before = sent.length
    const pasted = await original(3000, 4)
    await items.update(note, pictured('Edited, locked', pasted), { wasLocked: true })
    await pass()
    expect(JSON.stringify(await vault.unseal(note, (await db.items.get(note))!.vault!))).not.toContain(pasted.id)
    expect(sent).toHaveLength(before)
  })

  it('lets go of a note’s originals here too when another device locks it', async () => {
    const full = await original()
    const kept = await original(2000, 8)
    const note = await items.create('note', pictured('On the hill', full))
    await items.create('note', pictured('Another', kept))
    await pass()
    // The other device: the note locked there, and sent sealed over the version this one knows.
    const record = (await db.syncRecords.where('[type+id]').equals(['item', note]).first())!
    const v = { id: note, kind: 'note', body: vault.LOCKED_BODY, createdAt: 1, updatedAt: Date.now(), vault: { salt: 'S'.repeat(22), sealed: 'A'.repeat(40) } }
    await httpApi('', keys).push([{ k: record.k, b: record.seq, p: await seal(keys, record.k, { t: 'item', v, n: record.n! + 1, b: record.n }) }])
    await pass()
    expect((await db.items.get(note))!.vault).toMatchObject({ sealed: 'A'.repeat(40) })
    expect([...device.files.keys()]).toEqual([kept.id])
    expect(onServer()).toHaveLength(1)
  })

  /** Another device's lock on `note`, sent sealed over the version this one knows. */
  async function lockedElsewhere(note: string) {
    const record = (await db.syncRecords.where('[type+id]').equals(['item', note]).first())!
    const v = { id: note, kind: 'note', body: vault.LOCKED_BODY, createdAt: 1, updatedAt: Date.now(), vault: { salt: 'S'.repeat(22), sealed: 'A'.repeat(40) } }
    await httpApi('', keys).push([{ k: record.k, b: record.seq, p: await seal(keys, record.k, { t: 'item', v, n: record.n! + 1, b: record.n }) }])
  }
  const attachedTo = (text: string, file: { id: string; type: string; size: number }, ...fulls: Full[]): JSONContent => ({ type: 'doc', content: [...pictured(text, ...fulls).content!, { type: 'attachment', attrs: { file, name: 'report.pdf' } }] })
  async function attachment(size = 50_000, fill = 6) {
    const id = (await keepFile(new Blob([bytesOf(size, fill)], { type: 'application/pdf' })))!
    return { id, type: 'application/pdf', size }
  }

  it('keeps a file attached here as another device locked the note: the edit a locked copy, the file in a note of its own, and sent', async () => {
    const note = await items.create('note', pictured('On the hill'))
    await pass()
    // Attached here, with a picture, and not yet sent when the lock arrives.
    const [file, full] = [await attachment(), await original(3000, 9)]
    await items.update(note, attachedTo('On the hill', file, full))
    await lockedElsewhere(note)
    await pass()
    expect((await db.items.get(note))!.vault).toMatchObject({ sealed: 'A'.repeat(40) })
    const others = (await db.items.toArray()).filter((item) => item.id !== note)
    expect(others.filter((item) => item.unsealed)).toHaveLength(1)
    const [files] = others.filter((item) => !item.unsealed)
    expect(others).toHaveLength(2)
    expect(files.body.content!.at(-2)).toEqual({ type: 'attachment', attrs: { file, name: 'report.pdf' } })
    // The file stays, named by its new note; the picture's original, which the locked copy doesn't name, goes.
    expect([...device.files.keys()]).toEqual([file.id])
    expect(filesGone()).toEqual([])
    // Its note goes up, and the file after it.
    await pass()
    expect(onServer().map((sealed) => sealed.length)).toEqual([65_536 + 28])
    expect(filesWaiting()).toEqual([])
  })

  it('doesn’t let go at once of what was attached when the lock arrives over a note already sent: the note it’s kept in may be on its way', async () => {
    const [file, full] = [await attachment(), await original(3000, 9)]
    const note = await items.create('note', attachedTo('On the hill', file, full))
    await pass()
    expect(onServer()).toHaveLength(2)
    await lockedElsewhere(note)
    await pass()
    expect((await db.items.get(note))!.vault).toMatchObject({ sealed: 'A'.repeat(40) })
    expect(await db.items.count()).toBe(1)
    // The original goes, here and from the server; the attachment's file is left for the daily look (lib/fileUse).
    expect([...device.files.keys()]).toEqual([file.id])
    expect(onServer()).toHaveLength(1)
    expect(filesGone()).toEqual([])
  })

  it('doesn’t take a refusal for a file: a wrong code’s fetch is refused, and says so', async () => {
    const full = await original()
    await items.create('note', pictured('On the hill', full))
    await pass()
    const stranger = httpApi('', { ...keys, secret: 'B'.repeat(43), sign: undefined })
    await expect(stranger.getFile(sent[0].split('/').pop()!)).rejects.toMatchObject({ status: 401 })
    await expect(fetchFile({ ...keys, secret: 'B'.repeat(43), sign: undefined }, stranger, full)).rejects.toMatchObject({ status: 401 })
  })

  it('keeps a locked note’s original here while another note’s history still shows it', async () => {
    await vault.openVault('harbour lights', [])
    const full = await original()
    const note = await items.create('note', pictured('To be locked', full))
    const other = await items.create('note', pictured('Had it once'))
    await revisions.record(other, pictured('Had it once', full), { force: true, now: Date.now() - DAY })
    await items.lock(note, pictured('To be locked', full))
    expect(device.files.has(full.id)).toBe(true)
    // Off the server all the same: no note that syncs names it now.
    expect(filesGone()).toEqual([full.id])
  })

  it('sends an attachment’s file after its note as it does an original, and gives it to another device as what it is', async () => {
    const id = (await keepFile(new Blob([bytesOf(50_000, 6)], { type: 'application/pdf' })))!
    const file = { id, type: 'application/pdf', size: 50_000 }
    await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Minutes' }] }, { type: 'attachment', attrs: { file, name: 'report.pdf' } }] })
    expect(await pass()).toEqual({ full: false, more: false })
    expect(onServer().map((sealed) => sealed.length)).toEqual([65_536 + 28])
    device.files.clear()
    expect(await fetchFile(keys, httpApi('', keys), file)).toBe(true)
    expect(device.files.get(id)!.type).toBe('application/pdf')
    expect(new Uint8Array(await device.files.get(id)!.arrayBuffer())).toEqual(bytesOf(50_000, 6))
  })

  it('doesn’t lock a note that has an attachment: its text would be sealed and the file left beside the library', async () => {
    await vault.openVault('harbour lights', [])
    const id = (await keepFile(new Blob([bytesOf(1000)], { type: 'application/pdf' })))!
    const body: JSONContent = { type: 'doc', content: [{ type: 'attachment', attrs: { file: { id, type: 'application/pdf', size: 1000 }, name: 'report.pdf' } }] }
    const note = await items.create('note', body)
    await expect(items.lock(note, body)).rejects.toThrow('attachments')
    expect((await db.items.get(note))!.vault).toBeFalsy()
    expect(device.files.has(id)).toBe(true)
    expect(filesGone()).toEqual([])
  })

  it('moves to a new code with the library: sealed again under it, and gone with the old one', async () => {
    const full = await original(100_000, 3)
    await items.create('note', pictured('On the hill', full))
    await pass()
    const old = [...server.kept.keys()]
    expect(old).toHaveLength(1)

    const fresh = await deriveKeys(await changeLibrary(code, 'receipt'))
    expect(await syncFiles(fresh, httpApi('', fresh))).toEqual({ full: false, more: false })
    const now = [...server.kept.keys()]
    expect(now).toHaveLength(1)
    expect(now[0]).not.toBe(old[0])
    expect(now[0].startsWith(`eu-${fresh.libraryId}/`)).toBe(true)
    device.files.clear()
    expect(await fetchFile(fresh, httpApi('', fresh), full)).toBe(true)
    expect(new Uint8Array(await device.files.get(full.id)!.arrayBuffer())).toEqual(bytesOf(100_000, 3))
    // The old code's keys open nothing of it.
    expect(await openFile(keys, now[0].split('/')[1], server.kept.get(now[0])!)).toBeNull()
  })

  // The documents were moved and the old library wiped, its files with it; none was fetched first, and the new
  // library is sent only what this device holds. So an attachment made on a phone since lost, never opened here,
  // was gone for good the moment the code was changed for that phone's sake (the server audit of 2026-11-23).
  describe('changing the code, with files this device never fetched', () => {
    /** A note this device has by sync, naming a file another device sent: on the server, not here. */
    async function fromAnotherDevice(fill = 5) {
      const bytes = bytesOf(60_000, fill)
      const full: Full = { id: crypto.randomUUID(), type: 'image/png', size: bytes.length }
      await items.create('note', pictured('From the phone', full))
      await syncOnce(keys, httpApi('', keys))
      const key = await recordKey(keys, 'file', full.id)
      await httpApi('', keys).putFile(key, await sealFile(keys, key, bytes))
      return { full, bytes }
    }

    it('fetches them first, and sends them to the new library', async () => {
      const { full, bytes } = await fromAnotherDevice()
      expect(device.files.has(full.id)).toBe(false)
      expect(onServer()).toHaveLength(1)

      const fresh = await deriveKeys(await changeLibrary(code, 'receipt'))
      expect(new Uint8Array(await device.files.get(full.id)!.arrayBuffer())).toEqual(bytes)
      await syncOnce(fresh, httpApi('', fresh))
      expect(await syncFiles(fresh, httpApi('', fresh))).toEqual({ full: false, more: false })
      const now = [...server.kept.keys()]
      expect(now).toHaveLength(1)
      expect(now[0].startsWith(`eu-${fresh.libraryId}/`)).toBe(true)
      // And from there, a device that hasn't it gets it whole.
      device.files.clear()
      expect(await fetchFile(fresh, httpApi('', fresh), full)).toBe(true)
      expect(new Uint8Array(await device.files.get(full.id)!.arrayBuffer())).toEqual(bytes)
    })

    it('fetches one only a past version names', async () => {
      const { full, bytes } = await fromAnotherDevice()
      const [note] = await db.items.toArray()
      await items.update(note.id, pictured('The picture taken out'))
      // As history keeps the version before: a row of its own, from last month.
      await db.revisions.clear()
      await db.revisions.add({ id: crypto.randomUUID(), itemId: note.id, body: pictured('From the phone', full), createdAt: Date.now() - 30 * DAY })
      expect((await db.items.toArray()).flatMap((item) => filesIn(item.body))).toEqual([])
      // As on a device the note came to by sync: nothing here is waiting to send that file.
      await pass()
      expect(filesWaiting()).toEqual([])
      const fresh = await deriveKeys(await changeLibrary(code, 'receipt'))
      expect(new Uint8Array(await device.files.get(full.id)!.arrayBuffer())).toEqual(bytes)
      // And it goes to the new library with the version that names it: sent only for documents, the new library
      // held the version and not its picture, and this device was the one copy (found checking the fix, 2026-11-23).
      await syncOnce(fresh, httpApi('', fresh))
      expect(await syncFiles(fresh, httpApi('', fresh))).toEqual({ full: false, more: false })
      expect([...server.kept.keys()].map((name) => name.split('/')[0])).toEqual([`eu-${fresh.libraryId}`])
      device.files.clear()
      expect(await fetchFile(fresh, httpApi('', fresh), full)).toBe(true)
    })

    it('changes nothing if this device has no room for one', async () => {
      const { full } = await fromAnotherDevice()
      device.full = true
      await expect(changeLibrary(code, 'receipt')).rejects.toThrow(/couldn’t be downloaded to this device/)
      expect(stored.get('nib-sync-code')).toBe(code)
      expect(device.files.has(full.id)).toBe(false)
      expect(onServer()).toHaveLength(1)
      expect((await httpApi('', keys).status()).entitled).toBe(true)
    })

    // Whoever has the code can put anything under a file's name, and a library can list one its store has lost.
    // Either refused every change of the code, the one made to be rid of them, with words about a connection and
    // free space that helped no one (found checking the fix, 2026-11-23).
    it('isn’t stopped by a file that isn’t what its document names, asked for twice, or by one listed that isn’t there', async () => {
      const planted = await fromAnotherDevice(5)
      const lost = await fromAnotherDevice(6)
      const nameOf = async (full: Full) => `eu-${keys.libraryId}/${await recordKey(keys, 'file', full.id)}`
      // In the first one's place, something else sealed under the same name; and the second gone from the store.
      const key = await recordKey(keys, 'file', planted.full.id)
      expect(server.kept.has(await nameOf(planted.full))).toBe(true)
      server.kept.set(await nameOf(planted.full), await sealFile(keys, key, bytesOf(10, 9)))
      server.kept.delete(await nameOf(lost.full))
      const nameOfLost = (await nameOf(lost.full)).split('/')[1]
      expect(onServer()).toHaveLength(1)
      const asked: string[] = []
      const real = fetch
      vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
        if (init.method === 'GET' && path.startsWith('/v1/files/')) asked.push(path)
        return real(path, init)
      })
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const fresh = await changeLibrary(code, 'receipt')
      expect(stored.get('nib-sync-code')).toBe(fresh)
      expect(asked.filter((path) => path.endsWith(key))).toHaveLength(2)
      expect(asked.filter((path) => path.endsWith(nameOfLost))).toHaveLength(2)
      expect(warned).toHaveBeenCalledWith(expect.stringContaining('isn’t what its document names'))
      expect(warned).toHaveBeenCalledWith(expect.stringContaining('isn’t there'))
      expect(device.files.has(planted.full.id)).toBe(false)
    })

    it('changes nothing if one can’t be fetched: the old library, its file and its code stay', async () => {
      const { full } = await fromAnotherDevice()
      const real = fetch
      vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
        if (init.method === 'GET' && path.startsWith('/v1/files/')) throw new TypeError('Load failed')
        return real(path, init)
      })
      await expect(changeLibrary(code, 'receipt')).rejects.toThrow(/files/)
      expect(stored.get('nib-sync-code')).toBe(code)
      expect(device.files.has(full.id)).toBe(false)
      const kept = [...server.kept.keys()]
      expect(kept).toHaveLength(1)
      expect(kept[0].startsWith(`eu-${keys.libraryId}/`)).toBe(true)
      // No new library was made, and the old one syncs as before.
      expect([...regions.eu.values(), ...regions.before.values()].filter((library) => library.exists())).toHaveLength(1)
      expect((await httpApi('', keys).status()).entitled).toBe(true)
    })

    it('isn’t stopped by a file the server hasn’t either', async () => {
      const full: Full = { id: crypto.randomUUID(), type: 'image/png', size: 60_000 }
      await items.create('note', pictured('Its picture never sent', full))
      const fresh = await changeLibrary(code, 'receipt')
      expect(stored.get('nib-sync-code')).toBe(fresh)
    })
  })

  // The server's own check of its file store holds a file's key for the moment it clears an old copy of it
  // (worker/library `unlisted`), and refuses the file meanwhile.
  it('keeps a file waiting when the server refuses it for the moment, and sends it at the next look', async () => {
    const full = await original()
    await items.create('note', pictured('On the hill', full))
    const real = fetch
    let refused = 0
    // The first time this one is sent, whichever of the two goes first.
    const refusedPath = `/v1/files/${await recordKey(keys, 'file', full.id)}`
    vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
      if (init.method === 'PUT' && path === refusedPath && refused++ === 0) {
        return new Response(JSON.stringify({ error: 'An old copy of that file is being cleared from the server. It can be sent again in a moment.' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
      }
      return real(path, init)
    })
    // Another file waiting behind it goes all the same.
    const other = await original(50_000, 4)
    await items.create('note', pictured('By the sea', other))
    // Not a failure, and nothing to look again at once for: it's left for the next look.
    expect(await pass()).toEqual({ full: false, more: false })
    // Not stored, not taken for sent, and still waiting; the other is sent.
    expect(onServer()).toHaveLength(1)
    expect(filesWaiting()).toEqual([full.id])
    expect(await pass()).toEqual({ full: false, more: false })
    expect(onServer()).toHaveLength(2)
    expect(filesWaiting()).toEqual([])
  })

  // Which files a library's documents use, only a device can say: the server kept every one sent to it till the
  // library was deleted, used or not (the server audit of 2026-11-23, L13).
  describe('telling the server which files this device’s documents use', () => {
    /** What was said to the server, and the pulls made, as the requests went out. */
    function heard() {
      const said: { keys: string[]; done: boolean }[] = []
      const pulls: string[] = []
      const real = fetch
      vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
        if (path === '/v1/files/used') said.push(JSON.parse(String(init.body)))
        if (path.startsWith('/v1/changes?')) pulls.push(path)
        return real(path, init)
      })
      return { said, pulls }
    }
    const keyOf = (full: Full) => recordKey(keys, 'file', full.id)
    const api = () => httpApi('', keys)

    it('names every file its documents that sync use, in what they hold and in their history, and says that’s all', async () => {
      const [inNote, inHistory, onlyHere] = [await original(1000, 1), await original(1000, 2), await original(1000, 3)]
      const note = await items.create('note', pictured('On the hill', inNote, inHistory))
      await items.update(note, pictured('On the hill', inNote))
      await db.revisions.clear()
      await db.revisions.add({ id: crypto.randomUUID(), itemId: note, body: pictured('On the hill', inNote, inHistory), createdAt: Date.now() - 30 * DAY })
      // Kept on this device only, its files are no business of the server's; nor is its history.
      const local = await items.create('note', pictured('Mine alone', onlyHere))
      await items.setDeviceOnly(local, true)
      await db.revisions.add({ id: crypto.randomUUID(), itemId: local, body: pictured('Mine alone, before', onlyHere), createdAt: Date.now() - DAY })
      await pass()
      const { said } = heard()
      expect(await nameFiles(keys, api())).toBe(0)
      expect(said).toEqual([{ keys: [await keyOf(inNote), await keyOf(inHistory)], done: true }])
    })

    it('says so once a day, and with no files at all says that too', async () => {
      await items.create('note', pictured('No pictures'))
      await pass()
      const { said } = heard()
      const now = Date.now()
      await nameFiles(keys, api(), now)
      await nameFiles(keys, api(), now)
      await nameFiles(keys, api(), now + DAY - 1)
      expect(said).toEqual([{ keys: [], done: true }])
      // The same words signed in the same millisecond are the same request, which the server takes once.
      await new Promise((resolve) => setTimeout(resolve, 3))
      await nameFiles(keys, api(), now + DAY)
      expect(said).toHaveLength(2)
    })

    // Written while this device's clock ran ahead, the day it was last said is in the future, and nothing was said
    // till the clock caught up: a year on, for a clock a year ahead (found checking step 4, 2026-11-23).
    it('says so when the last time is in the future: this device’s clock was ahead when it was written', async () => {
      await items.create('note', pictured('No pictures'))
      await pass()
      const { said } = heard()
      const now = Date.now()
      await db.syncMeta.put({ k: 'named', v: now + 400 * DAY })
      await nameFiles(keys, api(), now)
      expect(said).toEqual([{ keys: [], done: true }])
      expect((await db.syncMeta.get('named'))?.v).toBe(now)
    })

    // Read a few at a time (lib/fileUse): every one of more than a few is read.
    it('names the files of every document and every past version, however many', async () => {
      const file = (): Full => ({ id: crypto.randomUUID(), type: 'image/png', size: 10 })
      const [ofNotes, ofVersions] = [Array.from({ length: 45 }, file), Array.from({ length: 45 }, file)]
      for (const [at, full] of ofNotes.entries()) await items.create('note', pictured(`Note ${at}`, full))
      const [first] = await db.items.toArray()
      await db.revisions.clear()
      for (const full of ofVersions) await db.revisions.add({ id: crypto.randomUUID(), itemId: first.id, body: pictured('Before', full), createdAt: Date.now() - DAY })
      const { said } = heard()
      await nameFiles(keys, api())
      expect(said).toHaveLength(1)
      expect([...said[0].keys].sort()).toEqual((await Promise.all([...ofNotes, ...ofVersions].map(keyOf))).sort())
    })

    // Each is still a document of the library's, on the server and on its other devices, and comes back whole.
    it('names the files of documents in the trash, archived, and kept as templates', async () => {
      const file = (): Full => ({ id: crypto.randomUUID(), type: 'image/png', size: 10 })
      const [trashed, archived, template] = [file(), file(), file()]
      await items.remove(await items.create('note', pictured('Thrown out', trashed)))
      await items.setArchived(await items.create('note', pictured('Put by', archived)), true)
      const from = await items.create('note', pictured('A form', template))
      expect(await items.saveAsTemplate(from)).toBeTruthy()
      await db.items.delete(from)
      await db.revisions.clear()
      expect((await db.items.toArray()).map((item) => [Boolean(item.deletedAt), Boolean(item.archivedAt), Boolean(item.template)])).toEqual(
        expect.arrayContaining([
          [true, false, false],
          [false, true, false],
          [false, false, true],
        ]),
      )
      const { said } = heard()
      await nameFiles(keys, api())
      expect([...said[0].keys].sort()).toEqual((await Promise.all([trashed, archived, template].map(keyOf))).sort())
    })

    it('says more than a thousand in parts, and only with the last that that’s all', async () => {
      const fulls: Full[] = Array.from({ length: 1001 }, () => ({ id: crypto.randomUUID(), type: 'image/png', size: 10 }))
      await items.create('note', pictured('An album', ...fulls))
      const { said } = heard()
      await nameFiles(keys, api())
      expect(said.map((part) => [part.keys.length, part.done])).toEqual([
        [1000, false],
        [1, true],
      ])
    })

    // With the last part, and a last part that is exactly full is still the last.
    it('says that’s all with exactly a thousand', async () => {
      const fulls: Full[] = Array.from({ length: 1000 }, () => ({ id: crypto.randomUUID(), type: 'image/png', size: 10 }))
      await items.create('note', pictured('An album', ...fulls))
      const { said } = heard()
      await nameFiles(keys, api())
      expect(said.map((part) => [part.keys.length, part.done])).toEqual([[1000, true]])
    })

    it('says nothing is all of it if a part can’t be said, and tries again the next day', async () => {
      const fulls: Full[] = Array.from({ length: 1001 }, () => ({ id: crypto.randomUUID(), type: 'image/png', size: 10 }))
      await items.create('note', pictured('An album', ...fulls))
      const real = fetch
      const said: boolean[] = []
      let failing = true
      vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
        if (path === '/v1/files/used') {
          if (failing) throw new TypeError('Load failed')
          said.push(JSON.parse(String(init.body)).done)
        }
        return real(path, init)
      })
      const now = Date.now()
      await expect(nameFiles(keys, api(), now)).rejects.toThrow('Load failed')
      failing = false
      // Not again the same day, however many looks; the next day, all of it.
      expect(await nameFiles(keys, api(), now + 1000)).toBe(0)
      expect(said).toEqual([])
      await nameFiles(keys, api(), now + DAY)
      expect(said).toEqual([false, true])
    })

    // A device never sent again a file it had once sent: cleared from the server as unused while this device was
    // away, or lost with a library that lapsed and was paid for again, it was on this device and nowhere a new one could fetch it.
    it('sends again a file it uses and holds that the server no longer has', async () => {
      const [lost, kept] = [await original(100_000, 1), await original(50_000, 2)]
      await items.create('note', pictured('On the hill', lost, kept))
      await pass()
      expect(onServer()).toHaveLength(2)
      // Gone from the server, by no doing of this device's.
      await api().deleteFile(await keyOf(lost))
      expect(await pass()).toEqual({ full: false, more: false })
      expect(onServer()).toHaveLength(1)
      // Named by the document alone, as one that came from another device with no history is.
      await db.revisions.clear()

      expect(await nameFiles(keys, api())).toBe(1)
      expect(filesWaiting()).toEqual([lost.id])
      expect(await pass()).toEqual({ full: false, more: false })
      expect(onServer()).toHaveLength(2)
      device.files.clear()
      expect(await fetchFile(keys, api(), lost)).toBe(true)
    })

    it('doesn’t send one it uses and doesn’t hold, nor one of a document kept on this device only', async () => {
      const elsewhere: Full = { id: crypto.randomUUID(), type: 'image/png', size: 60_000 }
      await items.create('note', pictured('From the phone', elsewhere))
      const mine = await original(1000, 5)
      const local = await items.create('note', pictured('Mine alone', mine))
      await items.setDeviceOnly(local, true)
      await pass()
      expect(await nameFiles(keys, api())).toBe(0)
      expect(filesWaiting()).toEqual([])
      expect(await pass()).toEqual({ full: false, more: false })
      expect(onServer()).toHaveLength(0)
    })

    // A version older than the server keeps is never sent (sync/engine `outgoing`), and neither is its file: sent
    // "again", it went up for the first time, to be named every day after and kept for good (found checking step 4, 2026-11-23).
    it('names a file that only a version older than the server keeps shows, and doesn’t send it; one a newer version shows, it does', async () => {
      const [old, recent] = [await original(1000, 6), await original(1000, 7)]
      const note = await items.create('note', pictured('On the hill'))
      await db.revisions.clear()
      // Said a little from now, when the one is as old as the server keeps to the millisecond, and the other a millisecond older.
      const now = Date.now() + 5000
      await db.revisions.add({ id: crypto.randomUUID(), itemId: note, body: pictured('Long before', old), createdAt: now - SERVER_HISTORY_MS - 1 })
      await db.revisions.add({ id: crypto.randomUUID(), itemId: note, body: pictured('Before', recent), createdAt: now - SERVER_HISTORY_MS })
      // As yet both are new enough to go with a look, and their files after them. Then gone from the server.
      await pass()
      expect(onServer()).toHaveLength(2)
      for (const full of [old, recent]) await api().deleteFile(await keyOf(full))
      expect(onServer()).toHaveLength(0)
      const { said } = heard()
      expect(await nameFiles(keys, api(), now)).toBe(1)
      expect([...said[0].keys].sort()).toEqual([await keyOf(old), await keyOf(recent)].sort())
      expect(filesWaiting()).toEqual([recent.id])
    })

    // Its document made this device's only while this was read: read as one that syncs, its file is by then waiting
    // to be taken off the server, and sent again it was put back there (found checking step 4, 2026-11-23).
    describe('with a document made this device’s only while it’s said', () => {
      let mine: Full
      let other: Full
      let note: string
      /** Two files the server has lost, of two notes; `during` runs as the names go out, after the documents were read. */
      async function lostWhile(during: () => Promise<void>) {
        ;[mine, other] = [await original(1000, 8), await original(1000, 9)]
        note = await items.create('note', pictured('On the hill', mine))
        await items.create('note', pictured('By the sea', other))
        await pass()
        for (const full of [mine, other]) await api().deleteFile(await keyOf(full))
        const real = fetch
        let ran = false
        vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
          if (path === '/v1/files/used' && !ran) {
            ran = true
            await during()
          }
          return real(path, init)
        })
      }
      /** None was sent again; and said again at the next look, the other note's file is, and only that. */
      async function sentRightAfter(now: number) {
        expect(filesWaiting()).toEqual([])
        await new Promise((resolve) => setTimeout(resolve, 3))
        expect(await nameFiles(keys, api(), now + 1000)).toBe(1)
        expect(filesWaiting()).toEqual([other.id])
        await pass()
        expect([...server.kept.keys()].map((name) => name.split('/').pop())).toEqual([await keyOf(other)])
      }

      it('sends none again that time, its file waiting to be taken off the server; and says it all again at the next look', async () => {
        await lostWhile(() => items.setDeviceOnly(note, true))
        const now = Date.now()
        expect(await nameFiles(keys, api(), now)).toBe(0)
        expect(filesGone()).toEqual([mine.id])
        await sentRightAfter(now)
      })

      // Beside the look, a look runs while it's said: the file is taken off the server and off the list of those
      // to go before this reads that list, which then said nothing of it (found checking step 4 again, 2026-11-23).
      it('sends none again though a look has already taken its file off the server', async () => {
        await lostWhile(async () => {
          await items.setDeviceOnly(note, true)
          await pass()
        })
        const now = Date.now()
        expect(await nameFiles(keys, api(), now)).toBe(0)
        expect(filesGone()).toEqual([])
        await sentRightAfter(now)
      })

      // Later still: as this looks at which of the files are here, the last thing it awaits.
      it('sends none again when the file is given to go as the files here are looked at', async () => {
        await lostWhile(async () => {})
        const has = device.files.has.bind(device.files)
        device.files.has = (id) => (removeFiles([mine.id]), has(id))
        const now = Date.now()
        try {
          expect(await nameFiles(keys, api(), now)).toBe(0)
        } finally {
          device.files.has = has
        }
        expect(filesGone()).toEqual([mine.id])
        expect(filesWaiting()).toEqual([])
      })

      it('goes on as ever when files were given to go and none is to be sent again', async () => {
        const full = await original(1000, 8)
        note = await items.create('note', pictured('On the hill', full))
        await pass()
        const real = fetch
        vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
          if (path === '/v1/files/used') await items.setDeviceOnly(note, true)
          return real(path, init)
        })
        const now = Date.now()
        expect(await nameFiles(keys, api(), now)).toBe(0)
        expect((await db.syncMeta.get('named'))?.v).toBe(now)
      })
    })

    it('fetches what’s new saying it’s a Nib that says which files it uses', async () => {
      const { pulls } = heard()
      await syncOnce(keys, api())
      expect(pulls.length).toBeGreaterThan(0)
      expect(pulls.every((path) => /[?&]names=1(&|$)/.test(path))).toBe(true)
    })
  })

  it('takes a file off the server before sending it again, when it’s wanted there once more', async () => {
    const full = await original()
    const note = await items.create('note', pictured('On the hill', full))
    await pass()
    await items.setDeviceOnly(note, true)
    await items.setDeviceOnly(note, false)
    expect(filesGone()).toEqual([full.id])
    await pass()
    expect(onServer()).toHaveLength(1)
    expect(filesGone()).toEqual([])
    sendFiles([full.id])
    await pass()
    expect(sent).toHaveLength(2)
  })
})
