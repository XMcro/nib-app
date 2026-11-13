import { describe, expect, it } from 'vitest'
import { base64url } from './base64'
import { frontDoor, type Routes } from './door'
import { emptyFiles } from './files'
import { FILE_FLOOR, Library, libraryRequests, type Region } from './library'
import { signedMessage } from './signing'
import { Subscriber, subscriberRequests } from './subscriber'
import { handleSync, type Deps } from './sync'
import { memoryFiles, sqlite } from './testing'
import { FILE_HASH_HEADER, FILES_LIMIT, MAX_FILE, MAX_SEALED_FILE } from './wire.mjs'

/** A library's files through the front door (worker/files), with real Library objects and a file store in memory that checks hashes as R2 does. */

const ID = '0123456789abcdef0123456789abcdef'
const OTHER = 'fedcba9876543210fedcba9876543210'
const auth = (id = ID, secret = 'A'.repeat(43)) => ({ Authorization: `Bearer ${id}.${secret}` })
const KEY = 'K'.repeat(43)
const KEY2 = 'L'.repeat(43)
const DAY = 86_400_000

const hex = async (bytes: Uint8Array<ArrayBuffer>) => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')
/** `size` bytes that stand for a sealed file: nothing the server could read anything from. */
const sealed = (size: number, fill = 7) => new Uint8Array(size).map((_, at) => (at * 31 + fill) % 251)

function server({ filesLimit = FILES_LIMIT, expiresIn = DAY } = {}) {
  const libraries = new Map<string, { library: Library; sql: ReturnType<typeof sqlite> }>()
  const subscribers = new Map<string, Subscriber>()
  const files = memoryFiles()
  const clock = { now: Date.now() }
  const open = (region: Region, id: string) => {
    const home = `${region}-${id}`
    const known = libraries.get(home) ?? libraries.set(home, (() => {
      const sql = sqlite()
      return { library: new Library(sql, undefined, filesLimit), sql }
    })()).get(home)!
    return libraryRequests(known.library, () => clock.now, { alarm: async () => {}, home, deleteFiles: () => emptyFiles(files, home) })
  }
  const kept: Promise<unknown>[] = []
  const deps: Deps = {
    verify: async () => ({ productId: 'p', originalTransactionId: 'o', expiresAt: clock.now + expiresIn, purchasedAt: Date.UTC(2026, 0, 1), environment: 'Production' }),
    library: (id, region) => open(region, id),
    subscriber: (key) => subscriberRequests(subscribers.get(key) ?? subscribers.set(key, new Subscriber(sqlite())).get(key)!),
    files,
    waitUntil: (work) => void kept.push(work),
  }
  const call = (path: string, init: RequestInit = {}) =>
    frontDoor(new Request(`https://nib.test${path}`, { ...init, headers: { ...auth(), ...init.headers } }), { sync: (asked) => handleSync(asked, deps) } as Routes)
  const create = (id = ID) => call('/v1/library', { method: 'POST', body: JSON.stringify({ jws: 'receipt' }), headers: { ...auth(id), 'Content-Type': 'application/json' } })
  const tables = (region: Region, id: string) => libraries.get(`${region}-${id}`)?.sql.all("SELECT name FROM sqlite_master WHERE type = 'table'").length ?? 0
  return Object.assign(call, { files, clock, create, tables, kept, library: (id = ID) => libraries.get(`eu-${id}`)!.library })
}

/** A file as the app sends one: its bytes, their length and their hash. */
async function put(bytes: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}): Promise<RequestInit> {
  return { method: 'PUT', body: bytes, headers: { 'Content-Length': String(bytes.length), [FILE_HASH_HEADER]: await hex(bytes), ...headers } }
}
/** A body that says how much of it was read (a stream takes its first piece as it's made; read whole, this one gives twenty), sent as `size` bytes with a hash that could be some file's. */
function watched(size: number) {
  const read = { n: 0 }
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (read.n++ < 20) controller.enqueue(new Uint8Array(1_000_000))
      else controller.close()
    },
  })
  const init = { method: 'PUT', body, duplex: 'half', headers: { 'Content-Length': String(size), [FILE_HASH_HEADER]: 'a'.repeat(64) } } as RequestInit
  return { read, init }
}
const listed = async (call: ReturnType<typeof server>, headers: Record<string, string> = {}) => (await call('/v1/files', { headers })).json() as Promise<{ files: { k: string; size: number }[]; bytes: number; limit: number }>

describe('a library’s files on the server', () => {
  it('keeps one as it was sent, lists it by its key and size, and gives it back byte for byte', async () => {
    const call = server()
    await call.create()
    expect(await listed(call)).toEqual({ files: [], bytes: 0, limit: 2_000_000_000 })
    const file = sealed(300_000)
    const sent = await call(`/v1/files/${KEY}`, await put(file))
    expect([sent.status, await sent.json()]).toEqual([200, { stored: true }])
    expect(await listed(call)).toEqual({ files: [{ k: KEY, size: 300_000 }], bytes: 300_000, limit: 2_000_000_000 })

    const got = await call(`/v1/files/${KEY}`)
    expect(got.status).toBe(200)
    expect(got.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(got.headers.get('Content-Length')).toBe('300000')
    expect(got.headers.get('Cache-Control')).toBe('no-store')
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(file)
    // In the store under the library's own object's name, which no request says.
    expect([...call.files.kept.keys()]).toEqual([`eu-${ID}/${KEY}`])
    expect((await call(`/v1/files/${KEY2}`)).status).toBe(404)
  })

  it('takes a file as large as one may be sealed, and none larger, which it doesn’t read', async () => {
    expect([MAX_FILE, MAX_SEALED_FILE]).toEqual([25 * 1024 * 1024, 26 * 1024 * 1024])
    const call = server()
    await call.create()
    expect((await call(`/v1/files/${KEY}`, await put(sealed(MAX_SEALED_FILE)))).status).toBe(200)
    const { read, init } = watched(MAX_SEALED_FILE + 1)
    expect((await call(`/v1/files/${KEY2}`, init)).status).toBe(413)
    expect(read.n).toBeLessThan(3)
    expect((await listed(call)).files.map((file) => file.k)).toEqual([KEY])
  })

  it('wants a key that is one, the file’s length and its hash', async () => {
    const call = server()
    await call.create()
    const file = sealed(1000)
    const good = await put(file)
    expect((await call('/v1/files/short', good)).status).toBe(404)
    expect((await call(`/v1/files/${KEY}/more`, good)).status).toBe(404)
    expect((await call(`/v1/files/${'K'.repeat(42)}.`, good)).status).toBe(404)
    const lacking: Record<string, string>[] = [{ 'Content-Length': '' }, { 'Content-Length': '0' }, { 'Content-Length': '12.5' }, { [FILE_HASH_HEADER]: '' }, { [FILE_HASH_HEADER]: 'A'.repeat(64) }, { [FILE_HASH_HEADER]: 'a'.repeat(63) }]
    for (const headers of lacking) expect((await call(`/v1/files/${KEY}`, await put(file, headers))).status).toBe(400)
    expect((await call(`/v1/files/${KEY}`, { method: 'PUT', headers: { 'Content-Length': '10', [FILE_HASH_HEADER]: 'a'.repeat(64) } })).status).toBe(400)
    expect((await call(`/v1/files/${KEY}`, { method: 'POST', body: 'x' })).status).toBe(404)
    expect((await call('/v1/files', { method: 'DELETE' })).status).toBe(404)
    expect(call.files.kept.size).toBe(0)
  })

  it('keeps nothing that doesn’t hash to what was said of it', async () => {
    const call = server()
    await call.create()
    const file = sealed(5000)
    await call(`/v1/files/${KEY}`, await put(file))
    const other = sealed(5000, 9)
    const wrong = await call(`/v1/files/${KEY}`, await put(other, { [FILE_HASH_HEADER]: await hex(sealed(5000, 11)) }))
    expect(wrong.status).toBe(422)
    expect((await call(`/v1/files/${KEY2}`, await put(other, { [FILE_HASH_HEADER]: await hex(file) }))).status).toBe(422)
    // What was there before is as it was, and the one refused was never counted.
    expect(new Uint8Array(await (await call(`/v1/files/${KEY}`)).arrayBuffer())).toEqual(file)
    expect(await listed(call)).toMatchObject({ files: [{ k: KEY, size: 5000 }], bytes: 5000 })
  })

  it('is the library’s alone: not a stranger’s, not a wrong code’s, not another library’s by the same key', async () => {
    const call = server()
    const stranger = watched(1000)
    expect((await call(`/v1/files/${KEY}`, stranger.init)).status).toBe(404)
    expect(stranger.read.n).toBeLessThan(3)
    // Asking made nothing: no library, and no table for one.
    expect([call.tables('eu', ID), call.tables('before', ID)]).toEqual([0, 0])

    await call.create()
    await call.create(OTHER)
    const mine = sealed(2000)
    await call(`/v1/files/${KEY}`, await put(mine))
    const wrongCode = watched(1000)
    expect((await call(`/v1/files/${KEY}`, { ...wrongCode.init, headers: { ...wrongCode.init.headers, ...auth(ID, 'B'.repeat(43)) } })).status).toBe(401)
    expect(wrongCode.read.n).toBeLessThan(3)
    for (const init of [{}, { method: 'DELETE' }]) expect((await call(`/v1/files/${KEY}`, { ...init, headers: auth(ID, 'B'.repeat(43)) })).status).toBe(401)
    expect((await call('/v1/files', { headers: auth(ID, 'B'.repeat(43)) })).status).toBe(401)
    // Nor does a wrong code's try at deleting the library take its files on the way to being refused.
    expect((await call('/v1/library', { method: 'DELETE', headers: auth(ID, 'B'.repeat(43)) })).status).toBe(401)
    expect(await listed(call)).toMatchObject({ files: [{ k: KEY, size: 2000 }] })
    expect(call.files.kept.size).toBe(1)
    expect((await call(`/v1/files/${KEY}`, { headers: { Authorization: 'Bearer nope' } })).status).toBe(401)

    // The other library has none by that key, can keep its own under it, and deleting its own leaves mine.
    expect((await call(`/v1/files/${KEY}`, { headers: auth(OTHER) })).status).toBe(404)
    expect((await listed(call, auth(OTHER))).files).toEqual([])
    const theirs = sealed(700, 3)
    await call(`/v1/files/${KEY}`, await put(theirs, auth(OTHER)))
    expect(new Uint8Array(await (await call(`/v1/files/${KEY}`)).arrayBuffer())).toEqual(mine)
    expect((await call(`/v1/files/${KEY}`, { method: 'DELETE', headers: auth(OTHER) })).status).toBe(200)
    expect(new Uint8Array(await (await call(`/v1/files/${KEY}`)).arrayBuffer())).toEqual(mine)
  })

  it('needs Nib Plus to send, list and fetch, and not to delete', async () => {
    const call = server({ expiresIn: DAY })
    await call.create()
    await call(`/v1/files/${KEY}`, await put(sealed(1000)))
    call.clock.now += 40 * DAY
    const late = watched(1000)
    expect((await call(`/v1/files/${KEY2}`, late.init)).status).toBe(402)
    expect(late.read.n).toBeLessThan(3)
    expect((await call('/v1/files')).status).toBe(402)
    expect((await call(`/v1/files/${KEY}`)).status).toBe(402)
    expect((await call(`/v1/files/${KEY}`, { method: 'DELETE' })).status).toBe(200)
    expect(call.files.kept.size).toBe(0)
  })

  it('refuses a file there’s no room for before reading any of it, and counts one sent again once', async () => {
    const call = server({ filesLimit: 10_000 })
    await call.create()
    expect((await call(`/v1/files/${KEY}`, await put(sealed(5000)))).status).toBe(200)
    const full = watched(5001)
    const refused = await call(`/v1/files/${KEY2}`, full.init)
    expect([refused.status, await refused.json()]).toEqual([507, { error: 'This library’s files are full.' }])
    expect(full.read.n).toBeLessThan(3)
    // To the byte.
    expect((await call(`/v1/files/${KEY2}`, await put(sealed(5000)))).status).toBe(200)
    // The same key again takes the room of what it replaces, not more.
    expect((await call(`/v1/files/${KEY}`, await put(sealed(5000, 5)))).status).toBe(200)
    expect((await call(`/v1/files/${KEY}`, await put(sealed(5001)))).status).toBe(507)
    expect(await listed(call)).toEqual({ files: [{ k: KEY, size: 5000 }, { k: KEY2, size: 5000 }], bytes: 10_000, limit: 10_000 })
  })

  // The security review of 2026-11-13: room is booked as a file is asked for, so a second sent at once is refused before either is stored.
  it('keeps only one of two sent at once that each fit and together don’t, refusing the other before any of it is stored', async () => {
    const call = server({ filesLimit: 10_000 })
    await call.create()
    const real = call.files.put
    let stored = 0
    call.files.put = async (...args) => {
      stored++
      await new Promise((go) => setTimeout(go, 10))
      return real(...args)
    }
    const answers = await Promise.all([call(`/v1/files/${KEY}`, await put(sealed(6000))), call(`/v1/files/${KEY2}`, await put(sealed(6000, 3)))])
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 507])
    expect(stored).toBe(1)
    const { files, bytes } = await listed(call)
    expect([files.length, bytes]).toEqual([1, 6000])
    expect([...call.files.kept.keys()]).toEqual([`eu-${ID}/${files[0].k}`])
  })

  // The security review of 2026-11-13: a file the library didn't count, for whatever reason, is never left in the store.
  it('deletes a file from the store when counting it fails, and goes on after its sender has gone', async () => {
    const call = server()
    await call.create()
    const library = call.library()
    const real = library.storedFile.bind(library)
    library.storedFile = () => {
      throw new Error('The library is away')
    }
    await expect(call(`/v1/files/${KEY}`, await put(sealed(1000)))).rejects.toThrow('The library is away')
    expect(call.files.kept.size).toBe(0)
    library.storedFile = real
    // Given to the Worker's waitUntil, so a sender cut off doesn't stop the store and the count.
    expect(call.kept.length).toBeGreaterThan(0)
  })

  it('lets a booking go when the store doesn’t take the file, so its room is free again', async () => {
    const call = server({ filesLimit: 10_000 })
    await call.create()
    const bad = await put(sealed(6000))
    const refused = await call(`/v1/files/${KEY}`, { ...bad, headers: { ...bad.headers, [FILE_HASH_HEADER]: '0'.repeat(64) } })
    expect(refused.status).toBe(422)
    expect((await listed(call)).bytes).toBe(0)
    expect((await call(`/v1/files/${KEY2}`, await put(sealed(6000)))).status).toBe(200)
  })

  it('deletes one from the list and from the store, and again is nothing', async () => {
    const call = server()
    await call.create()
    await call(`/v1/files/${KEY}`, await put(sealed(1000)))
    await call(`/v1/files/${KEY2}`, await put(sealed(2000)))
    const gone = await call(`/v1/files/${KEY}`, { method: 'DELETE' })
    expect([gone.status, await gone.json()]).toEqual([200, { deleted: true }])
    // Counted at FILE_FLOOR at the least (the security review of 2026-11-13).
    expect(await listed(call)).toMatchObject({ files: [{ k: KEY2, size: 2000 }], bytes: FILE_FLOOR })
    expect([...call.files.kept.keys()]).toEqual([`eu-${ID}/${KEY2}`])
    expect((await call(`/v1/files/${KEY}`)).status).toBe(404)
    expect((await call(`/v1/files/${KEY}`, { method: 'DELETE' })).status).toBe(200)
  })

  it('goes on to the store when asked again after the store failed to delete', async () => {
    const call = server()
    await call.create()
    await call(`/v1/files/${KEY}`, await put(sealed(1000)))
    const real = call.files.delete
    call.files.delete = async () => {
      throw new Error('The store is away')
    }
    await expect(call(`/v1/files/${KEY}`, { method: 'DELETE' })).rejects.toThrow('The store is away')
    call.files.delete = real
    expect(call.files.kept.size).toBe(1)
    expect((await call(`/v1/files/${KEY}`, { method: 'DELETE' })).status).toBe(200)
    expect(call.files.kept.size).toBe(0)
  })

  it('deletes every file of a library deleted from the server, and no other library’s', async () => {
    const call = server()
    await call.create()
    await call.create(OTHER)
    await call(`/v1/files/${KEY}`, await put(sealed(1000)))
    await call(`/v1/files/${KEY2}`, await put(sealed(1000)))
    await call(`/v1/files/${KEY}`, await put(sealed(1000), auth(OTHER)))
    expect((await call('/v1/library', { method: 'DELETE' })).status).toBe(200)
    expect([...call.files.kept.keys()]).toEqual([`eu-${OTHER}/${KEY}`])
    expect((await call('/v1/files')).status).toBe(404)
  })

  it('leaves the library to be deleted again when the store fails part-way, listing none of the files that may be gone', async () => {
    const call = server()
    await call.create()
    await call(`/v1/files/${KEY}`, await put(sealed(1000)))
    const real = call.files.delete
    call.files.delete = async () => {
      throw new Error('The store is away')
    }
    await expect(call('/v1/library', { method: 'DELETE' })).rejects.toThrow('The store is away')
    call.files.delete = real
    expect((await listed(call)).files).toEqual([])
    // And goes on taking files once that's over.
    expect((await call(`/v1/files/${KEY2}`, await put(sealed(500)))).status).toBe(200)
    expect((await call('/v1/library', { method: 'DELETE' })).status).toBe(200)
    expect(call.files.kept.size).toBe(0)
  })

  it('takes no file that arrives while the library’s files are being deleted, and none once it’s gone', async () => {
    const call = server()
    await call.create()
    const library = call.library()
    let during: unknown
    await library.emptied(async () => {
      try {
        library.storedFile(KEY, 1000)
      } catch (error) {
        during = error
      }
    })
    expect(during).toMatchObject({ status: 404 })
    expect((await listed(call)).files).toEqual([])

    // One sent as the library is deleted, and stored after its files were: found to have nowhere to be counted, and deleted from the store.
    const file = sealed(1000)
    const real = call.files.put
    call.files.put = async (...args) => {
      await call('/v1/library', { method: 'DELETE' })
      return real(...args)
    }
    expect((await call(`/v1/files/${KEY}`, await put(file))).status).toBe(404)
    expect(call.files.kept.size).toBe(0)
    expect(call.tables('eu', ID)).toBeGreaterThan(0)
    expect((await call('/v1/files')).status).toBe(404)
  })

  it('empties a home of more files than the store lists at once, and only that home', async () => {
    const files = memoryFiles()
    for (let n = 0; n < 2500; n++) files.kept.set(`home-a/${String(n).padStart(5, '0')}`, new Uint8Array(1))
    files.kept.set('home-ab/x', new Uint8Array(1))
    files.kept.set('home-b/x', new Uint8Array(1))
    await emptyFiles(files, 'home-a')
    expect([...files.kept.keys()]).toEqual(['home-ab/x', 'home-b/x'])
  })

  describe('signed', () => {
    async function device(call: ReturnType<typeof server>) {
      const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
      const publicKey = base64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
      const headers = async (method: string, path: string, bodyHash: string) => {
        const time = Date.now()
        const message = signedMessage({ id: ID, method, path, time, bodyHash })
        const signature = base64url(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(message))))
        return { Authorization: `Signed ${ID}`, 'X-Nib-Time': String(time), 'X-Nib-Signature': signature }
      }
      await call.create()
      const body = JSON.stringify({ key: publicKey })
      const enroll = await headers('POST', '/v1/key', await hex(new TextEncoder().encode(body)))
      expect((await call('/v1/key', { method: 'POST', body, headers: { ...enroll, ...auth(), 'Content-Type': 'application/json' } })).status).toBe(200)
      return headers
    }
    const NOTHING = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

    it('sends, fetches and deletes a file by signed requests, the file’s hash signed in place of its bytes', async () => {
      const call = server()
      const signed = await device(call)
      const file = sealed(4000)
      const path = `/v1/files/${KEY}`
      expect((await call(path, await put(file, await signed('PUT', path, await hex(file))))).status).toBe(200)
      const got = await call(path, { headers: await signed('GET', path, NOTHING) })
      expect(new Uint8Array(await got.arrayBuffer())).toEqual(file)
      expect((await call('/v1/files', { headers: await signed('GET', '/v1/files', NOTHING) })).status).toBe(200)
      expect((await call(path, { method: 'DELETE', headers: await signed('DELETE', path, NOTHING) })).status).toBe(200)
      expect(call.files.kept.size).toBe(0)
    })

    it('refuses a file under a signature made for another file, another key or another request, and reads none of it', async () => {
      const call = server()
      const signed = await device(call)
      const file = sealed(4000)
      const path = `/v1/files/${KEY}`
      const forOther = await signed('PUT', path, await hex(sealed(4000, 9)))
      // The header says the file's own hash, which isn't what was signed.
      expect((await call(path, await put(file, forOther))).status).toBe(401)
      // The header says what was signed, which isn't the file's hash: let in, and then not kept.
      expect((await call(path, await put(file, { ...forOther, [FILE_HASH_HEADER]: await hex(sealed(4000, 9)) }))).status).toBe(422)
      expect((await call(`/v1/files/${KEY2}`, await put(file, await signed('PUT', path, await hex(file))))).status).toBe(401)
      expect((await call(path, { method: 'DELETE', headers: await signed('GET', path, NOTHING) })).status).toBe(401)
      const unread = watched(4000)
      expect((await call(path, { ...unread.init, headers: { ...unread.init.headers, ...(await signed('PUT', path, 'b'.repeat(64))) } })).status).toBe(401)
      expect(unread.read.n).toBeLessThan(3)
      expect(call.files.kept.size).toBe(0)
    })
  })

  it('lets the app’s own origin send a file and read one back, and no other', async () => {
    const call = server()
    await call.create()
    const asks = await call(`/v1/files/${KEY}`, { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost' } })
    expect(asks.headers.get('Access-Control-Allow-Methods')).toContain('PUT')
    expect(asks.headers.get('Access-Control-Allow-Headers')).toContain(FILE_HASH_HEADER)
    await call(`/v1/files/${KEY}`, await put(sealed(100)))
    expect((await call(`/v1/files/${KEY}`, { headers: { Origin: 'capacitor://localhost' } })).headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost')
    expect((await call(`/v1/files/${KEY}`, { headers: { Origin: 'https://evil.example' } })).headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
