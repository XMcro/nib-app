import { describe, expect, it } from 'vitest'
import { frontDoor, type Routes } from './door'
import { sha256 } from './http'
import { Library, libraryRequests, type Region } from './library'
import { bodyHash, signedMessage } from './signing'
import { FreeQuota, quotaRequests } from './quota'
import { MAX_LIBRARIES, Subscriber, subscriberRequests } from './subscriber'
import { BAD_PUSHES_PER_NETWORK, handleSync, type Deps } from './sync'
import { memoryFiles, sqlite } from './testing'

const ID = '0123456789abcdef0123456789abcdef'
const SECRET = 'A'.repeat(43)
const AUTH = { Authorization: `Bearer ${ID}.${SECRET}` }
const PURCHASED = Date.UTC(2026, 0, 1)

/** The sync API through the front door, wired to real Library and Subscriber objects in memory, as index.ts wires Durable Objects. */
function server(verify: Deps['verify'] = async () => ({ productId: 'p', originalTransactionId: 'o', expiresAt: Date.now() + 86_400_000, purchasedAt: PURCHASED, environment: 'Production' })) {
  // Each region's libraries, and each one's SQLite, to see what a library stores where.
  const regions = { eu: new Map<string, { library: Library; sql: ReturnType<typeof sqlite> }>(), before: new Map<string, { library: Library; sql: ReturnType<typeof sqlite> }>() }
  const subscribers = new Map<string, Subscriber>()
  const open = (region: Region, id: string) => {
    const known = regions[region].get(id)
    if (known) return known.library
    const sql = sqlite()
    const library = new Library(sql)
    regions[region].set(id, { library, sql })
    return library
  }
  const quotas = new Map<string, FreeQuota>()
  const deps: Deps = {
    verify,
    library: (id, region) => libraryRequests(open(region, id)),
    subscriber: (key) => subscriberRequests(subscribers.get(key) ?? subscribers.set(key, new Subscriber(sqlite())).get(key)!),
    files: memoryFiles(),
    quota: (key) => quotaRequests(quotas.get(key) ?? quotas.set(key, new FreeQuota(sqlite())).get(key)!, { alarm: async () => {} }),
    secret: 'test-secret',
  }
  const call = (path: string, init: RequestInit = {}) =>
    frontDoor(new Request(`https://nib.test${path}`, { ...init, headers: { ...AUTH, 'Content-Type': 'application/json', ...init.headers } }), { sync: (asked) => handleSync(asked, deps) } as Routes)
  const tables = (region: Region, id: string) => regions[region].get(id)?.sql.all("SELECT name FROM sqlite_master WHERE type = 'table'").length ?? 0
  return Object.assign(call, { subscribers, open, tables })
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
/** A record's name as the app makes one: an HMAC, in base64url. */
const KEY = 'K'.repeat(43)

describe('sync API', () => {
  it('needs well-formed credentials', async () => {
    const call = server()
    expect((await call('/v1/status', { headers: { Authorization: 'Bearer nope' } })).status).toBe(401)
  })

  it('creates a library from a verified receipt, then syncs through it', async () => {
    const call = server()
    expect((await call('/v1/changes')).status).toBe(404)
    expect((await call('/v1/library', post({ jws: 'signed' }))).status).toBe(200)
    const pushed = await call('/v1/changes', post({ records: [{ k: KEY, p: 'Y2lwaGVydGV4dA==' }] }))
    expect(await pushed.json()).toEqual({ results: [{ k: KEY, s: 1 }] })
    expect(await (await call('/v1/changes?since=0')).json()).toEqual({ records: [{ k: KEY, s: 1, p: 'Y2lwaGVydGV4dA==' }], seq: 1, more: false })
  })

  it('refuses a receipt the App Store check rejects, and creates nothing', async () => {
    const call = server(async () => {
      throw new Error('not signed by Apple')
    })
    const response = await call('/v1/library', post({ jws: 'forged' }))
    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: string }).error).toMatch(/not signed by Apple/)
    expect((await call('/v1/status')).status).toBe(404)
  })

  it('renews only a library that exists: a mistyped code is a 404, not a new library', async () => {
    const call = server()
    expect((await call('/v1/entitlement', post({ jws: 'signed' }))).status).toBe(404)
    expect((await call('/v1/status')).status).toBe(404)
    await call('/v1/library', post({ jws: 'signed' }))
    expect((await call('/v1/entitlement', post({ jws: 'signed' }))).status).toBe(200)
  })

  it('rejects malformed pushes', async () => {
    const call = server()
    await call('/v1/library', post({ jws: 'signed' }))
    expect((await call('/v1/changes', post({ records: [{ k: '', p: 'eA==' }] }))).status).toBe(400)
    expect((await call('/v1/changes', post({ records: [{ k: KEY }] }))).status).toBe(400)
    // Only what the app sends: an HMAC for a name, and base64 ciphertext.
    expect((await call('/v1/changes', post({ records: [{ k: 'k'.repeat(64), p: 'eA==' }] }))).status).toBe(400)
    expect((await call('/v1/changes', post({ records: [{ k: KEY, p: 'not base64, and wide: \u00e9\u00e9\u00e9' }] }))).status).toBe(400)
    expect((await call('/v1/changes', post({ records: [{ k: KEY, p: 'eA==' }] }))).status).toBe(200)
    // A delete's seal is ciphertext like any other.
    expect((await call('/v1/changes', post({ records: [{ k: KEY, b: 1, d: 1, p: 'not base64 \u00e9' }] }))).status).toBe(400)
    expect((await call('/v1/changes', post({ records: [{ k: KEY, b: 1, d: 1, p: 'eA==' }] }))).status).toBe(200)
    expect((await call('/v1/changes', post({ nope: true }))).status).toBe(400)
  })

  it('deletes everything on request, and another device renewing does not bring it back', async () => {
    const call = server()
    await call('/v1/library', post({ jws: 'signed' }))
    expect((await call('/v1/library', { method: 'DELETE' })).status).toBe(200)
    expect((await call('/v1/status')).status).toBe(404)
    expect((await call('/v1/entitlement', post({ jws: 'signed' }))).status).toBe(404)
    expect((await call('/v1/status')).status).toBe(404)
  })

  // One receipt paid for any number of libraries.
  // The receipt took the idle library's place afresh, the wrong code was refused, and the refusal gave the place
  // back by deleting it: the library stayed paid for, on no subscription's list.
  it('leaves a library gone idle its place when a receipt comes for it with the wrong code', async () => {
    const call = server()
    expect((await call('/v1/library', post({ jws: 'signed' }))).status).toBe(200)
    const subscriber = call.subscribers.get(await sha256('o'))!
    // Not renewed in more than 60 days.
    subscriber.releaseLibrary(ID)
    subscriber.claimLibrary(ID, Date.now() - 61 * 86_400_000, PURCHASED)
    const wrong = { Authorization: `Bearer ${ID}.${'B'.repeat(43)}` }
    expect((await call('/v1/entitlement', { ...post({ jws: 'signed' }), headers: wrong })).status).toBe(401)
    expect(subscriber.paidTo(Date.now() + 86_400_000, PURCHASED)).toEqual([ID])
  })

  it(`syncs at most ${MAX_LIBRARIES} libraries on one subscription, and deleting one frees its place`, async () => {
    const call = server()
    const as = (i: number) => ({ Authorization: `Bearer ${String(i).padStart(32, '0')}.${SECRET}` })
    const create = (i: number) => call('/v1/library', { ...post({ jws: 'signed' }), headers: as(i) })
    for (let i = 0; i < MAX_LIBRARIES; i++) expect((await create(i)).status).toBe(200)
    const refused = await create(9)
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { error: string }).error).toMatch(/Nib Plus/)
    expect((await call('/v1/status', { headers: as(9) })).status).toBe(404)
    expect((await call('/v1/entitlement', { ...post({ jws: 'signed' }), headers: as(0) })).status).toBe(200)
    expect((await call('/v1/library', { method: 'DELETE', headers: as(0) })).status).toBe(200)
    expect((await create(9)).status).toBe(200)
  })

  // A refunded purchase's receipt, from before the refund, still verifies.
  it('takes nothing from a receipt whose purchase was refunded', async () => {
    const call = server()
    await call('/v1/library', post({ jws: 'signed' }))
    await subscriberRequests(call.subscribers.get(await sha256('o'))!).revoke(PURCHASED)
    const renewed = await call('/v1/entitlement', post({ jws: 'signed' }))
    expect(renewed.status).toBe(403)
    expect(((await renewed.json()) as { error: string }).error).toMatch(/refunded/)
  })

  // Apple keeps the original transaction id when a subscription renews or is
  // bought again, so one refund shut its buyer out of sync for good.
  it('takes a purchase made after the refund', async () => {
    let purchasedAt = PURCHASED
    const call = server(async () => ({ productId: 'p', originalTransactionId: 'o', expiresAt: Date.now() + 86_400_000, purchasedAt, environment: 'Production' }))
    await call('/v1/library', post({ jws: 'signed' }))
    await subscriberRequests(call.subscribers.get(await sha256('o'))!).revoke(PURCHASED)
    expect((await call('/v1/entitlement', post({ jws: 'signed' }))).status).toBe(403)
    purchasedAt = PURCHASED + 1
    expect((await call('/v1/entitlement', post({ jws: 'signed' }))).status).toBe(200)
  })

  // Without a Content-Length the size limit was skipped: a 20 MB chunked push got through.
  it('refuses a body past the limit, however it is sent', async () => {
    const call = server()
    await call('/v1/library', post({ jws: 'signed' }))
    const chunk = new TextEncoder().encode('x'.repeat(1_000_000))
    let sent = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 20) controller.enqueue(chunk)
        else controller.close()
      },
    })
    const response = await call('/v1/changes', { method: 'POST', body: endless, duplex: 'half' } as RequestInit)
    expect(response.status).toBe(413)
  })

  // Parsed first, a body cost the server its work before it knew who was asking.
  it('checks the library’s code before reading what is pushed', async () => {
    const call = server()
    await call('/v1/library', post({ jws: 'signed' }))
    const response = await call('/v1/changes', { ...post({ nope: true }), headers: { Authorization: `Bearer ${ID}.${'B'.repeat(43)}` } })
    expect(response.status).toBe(401)
  })

  // Cancelled, the unread body could take the answer with it: against wrangler dev, pushes of 200 KB or more refused this way came back as a lost connection about one time in three.
  it('leaves the body of a push it refuses unread, and doesn’t cancel it', async () => {
    const call = server()
    const push = async (headers: Record<string, string>) => {
      const body = { pulled: 0, cancelled: false }
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (body.pulled++ < 20) controller.enqueue(new Uint8Array(1_000_000))
          else controller.close()
        },
        cancel() {
          body.cancelled = true
        },
      })
      const response = await call('/v1/changes', { method: 'POST', body: stream, duplex: 'half', headers } as RequestInit)
      return { status: response.status, ...body }
    }
    const signed = { Authorization: `Signed ${ID}`, 'X-Nib-Time': String(Date.now()), 'X-Nib-Signature': 'A'.repeat(86) }
    const unread = (status: number) => ({ status, pulled: expect.toSatisfy((n: number) => n < 3), cancelled: false })
    // No library by that id, asked by its code and by a signature.
    expect(await push({})).toEqual(unread(404))
    expect(await push(signed)).toEqual(unread(404))
    await call('/v1/library', post({ jws: 'signed' }))
    // The wrong code, and a signature where no device has a key yet.
    expect(await push({ Authorization: `Bearer ${ID}.${'B'.repeat(43)}` })).toEqual(unread(401))
    expect(await push(signed)).toEqual(unread(401))
  })

  // Versions past the 90 days the server keeps (sync/engine expireHistory).
  it('lets go of the records a device names, and refuses anything but keys', async () => {
    const call = server()
    await call('/v1/library', post({ jws: 'receipt' }))
    await call('/v1/changes', post({ records: [{ k: KEY, p: 'AAAA' }] }))
    expect(await (await call('/v1/expire', post({ keys: [KEY] }))).json()).toEqual({ expired: [KEY] })
    expect(await (await call('/v1/changes?since=0')).json()).toMatchObject({ records: [] })
    for (const body of [{}, { keys: 'nope' }, { keys: ['not a key'] }, { keys: Array.from({ length: 1001 }, () => KEY) }]) {
      expect((await call('/v1/expire', post(body))).status).toBe(400)
    }
    expect((await call('/v1/expire', { ...post({ keys: [KEY] }), headers: { Authorization: `Bearer ${ID}.${'B'.repeat(43)}` } })).status).toBe(401)
  })

  // Kept where Cloudflare runs and stores them in the EU, from now on.
  it('makes a new library in the EU, and syncs it there', async () => {
    const call = server()
    expect((await call('/v1/library', post({ jws: 'receipt' }))).status).toBe(200)
    expect((await call('/v1/changes', post({ records: [{ k: KEY, p: 'AAAA' }] }))).status).toBe(200)
    expect(call.tables('eu', ID)).toBeGreaterThan(0)
    expect(call.tables('before', ID)).toBe(0)
  })

  it('goes on syncing a library made before, where it was made, and makes nothing in the EU for it', async () => {
    const call = server()
    call.open('before', ID).create(await sha256(SECRET), Date.now() + 86_400_000, Date.now())
    expect((await call('/v1/changes', post({ records: [{ k: KEY, p: 'AAAA' }] }))).status).toBe(200)
    expect(await (await call('/v1/changes?since=0')).json()).toMatchObject({ records: [{ k: KEY, p: 'AAAA' }] })
    // Made again from its code, it's the same library, not a second in the EU.
    expect((await call('/v1/library', post({ jws: 'receipt' }))).status).toBe(200)
    expect(call.tables('eu', ID)).toBe(0)
  })

  // The security review of 2026-11-13: a library's id is in its inbox's address, so one deleted is never made again, there or in the EU.
  it('makes no library again under the id of one deleted, where it was made or in the EU', async () => {
    const call = server()
    call.open('before', ID).create(await sha256(SECRET), Date.now() + 86_400_000, Date.now())
    expect((await call('/v1/library', { method: 'DELETE' })).status).toBe(200)
    const again = await call('/v1/library', { ...post({ jws: 'receipt' }), headers: { Authorization: `Bearer ${ID}.${'B'.repeat(43)}` } })
    expect([again.status, await again.json()]).toEqual([410, { error: 'That code’s library was deleted from the server. Turn sync on again for a new code.' }])
    expect(call.tables('eu', ID)).toBe(0)

    const eu = server()
    expect((await eu('/v1/library', post({ jws: 'receipt' }))).status).toBe(200)
    expect((await eu('/v1/library', { method: 'DELETE' })).status).toBe(200)
    expect((await eu('/v1/library', post({ jws: 'receipt' }))).status).toBe(410)
  })

  describe('signed', () => {
    const base64url = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64url')
    async function device(id = ID) {
      const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
      const publicKey = base64url(await crypto.subtle.exportKey('raw', pair.publicKey))
      /** A request as the app signs it; `as` sends it somewhere else than it was signed for. */
      const signed = async (method: string, path: string, body?: unknown, { authorization = `Signed ${id}`, as = path } = {}): Promise<[string, RequestInit]> => {
        const text = body === undefined ? undefined : JSON.stringify(body)
        const time = Date.now()
        const message = signedMessage({ id, method, path, time, bodyHash: await bodyHash(new TextEncoder().encode(text ?? '')) })
        const signature = base64url(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(message)))
        return [as, { method, body: text, headers: { Authorization: authorization, 'X-Nib-Time': String(time), 'X-Nib-Signature': signature } }]
      }
      return { publicKey, signed }
    }
    async function enrolled(call: ReturnType<typeof server>) {
      const me = await device()
      await call('/v1/library', post({ jws: 'receipt' }))
      const enroll = await me.signed('POST', '/v1/key', { key: me.publicKey }, { authorization: AUTH.Authorization })
      expect((await call(...enroll)).status).toBe(200)
      return me
    }

    it('reaches the library with nothing in the request that could be sent again later', async () => {
      const call = server()
      const me = await enrolled(call)
      expect(await (await call(...(await me.signed('GET', '/v1/status')))).json()).toMatchObject({ signedOnly: false })
      expect((await call(...(await me.signed('POST', '/v1/changes', { records: [{ k: KEY, p: 'AAAA' }] })))).status).toBe(200)
      expect(await (await call(...(await me.signed('GET', '/v1/changes?since=0')))).json()).toMatchObject({ records: [{ k: KEY, p: 'AAAA' }] })
    })

    // A stranger's signed push, naming any id, was read whole (up to 16 MB, buffered twice) and hashed before anything found no such library.
    it('reads no signed push till there’s a library by that id taking signed requests', async () => {
      const call = server()
      const push = () => {
        const pulled = { n: 0 }
        const endless = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pulled.n++ < 20) controller.enqueue(new Uint8Array(1_000_000))
            else controller.close()
          },
        })
        const headers = { Authorization: `Signed ${ID}`, 'X-Nib-Time': String(Date.now()), 'X-Nib-Signature': 'A'.repeat(86) }
        return Promise.all([call('/v1/changes', { method: 'POST', body: endless, duplex: 'half', headers } as RequestInit), pulled])
      }
      const [none, read] = await push()
      expect(none.status).toBe(404)
      expect(read.n).toBeLessThan(3)
      await call('/v1/library', post({ jws: 'receipt' }))
      const [unenrolled, readToo] = await push()
      expect(await unenrolled.json()).toMatchObject({ code: 'unenrolled' })
      expect(readToo.n).toBeLessThan(3)
    })

    // The security review of 2026-11-13: anyone given an inbox's address knows its library's id, and a signed push is read before its signature can be checked.
    it(`reads no more signed pushes from a network once ${BAD_PUSHES_PER_NETWORK} that didn’t check out have come from it today, and never counts a device’s own`, async () => {
      const call = server()
      const me = await enrolled(call)
      for (let n = 0; n < 5; n++) expect((await call(...(await me.signed('POST', '/v1/changes', { records: [{ k: KEY, p: 'AAAA' }] })))).status).toBe(200)
      const stranger = await device()
      for (let n = 0; n < BAD_PUSHES_PER_NETWORK; n++) expect((await call(...(await stranger.signed('POST', '/v1/changes', { records: [{ k: KEY, p: 'AAAA' }] })))).status).toBe(401)
      const pulled = { n: 0 }
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled.n++ < 20) controller.enqueue(new Uint8Array(1_000_000))
          else controller.close()
        },
      })
      const headers = { Authorization: `Signed ${ID}`, 'X-Nib-Time': String(Date.now()), 'X-Nib-Signature': 'A'.repeat(86) }
      const refused = await call('/v1/changes', { method: 'POST', body: endless, duplex: 'half', headers } as RequestInit)
      expect(refused.status).toBe(429)
      expect(pulled.n).toBeLessThan(3)
    })

    // One count for a network's bad pushes, whichever library they named: twenty to a stranger's own library, and
    // no one sharing the address (an office, a café, a carrier) could send a signed push to theirs till the day was out.
    it('refuses none to another library for the bad pushes sent to one from the same network', async () => {
      const call = server()
      const me = await enrolled(call)
      const OTHER = 'fedcba9876543210fedcba9876543210'
      const bearer = { Authorization: `Bearer ${OTHER}.${SECRET}` }
      const theirs = await device(OTHER)
      expect((await call('/v1/library', { ...post({ jws: 'receipt' }), headers: bearer })).status).toBe(200)
      expect((await call(...(await theirs.signed('POST', '/v1/key', { key: theirs.publicKey }, { authorization: bearer.Authorization })))).status).toBe(200)
      const push = { records: [{ k: KEY, p: 'AAAA' }] }
      const stranger = await device(OTHER)
      for (let n = 0; n < BAD_PUSHES_PER_NETWORK; n++) expect((await call(...(await stranger.signed('POST', '/v1/changes', push)))).status).toBe(401)
      // That library's own are refused now, as before; mine aren't.
      expect((await call(...(await theirs.signed('POST', '/v1/changes', push)))).status).toBe(429)
      expect((await call(...(await me.signed('POST', '/v1/changes', push)))).status).toBe(200)
    })

    // Good for the minutes its time allowed, with nothing to say it had been used: caught in passing, one could
    // be sent again, to end an inbox made anew since, or turn signed-only back off (the red-team review of 2026-11-17).
    it('takes a signed request that changes something once, and one that only reads as often as it’s sent', async () => {
      const call = server()
      const me = await enrolled(call)
      const on = await me.signed('POST', '/v1/signed-only', { on: true })
      expect((await call(...on)).status).toBe(200)
      expect((await call(...(await me.signed('POST', '/v1/signed-only', { on: false })))).status).toBe(200)
      // Sent again, the first is refused, and signed-only stays off.
      const again = await call(...on)
      expect(again.status).toBe(401)
      expect(await (await call(...(await me.signed('GET', '/v1/status')))).json()).toMatchObject({ signedOnly: false })
      // A push asks the library twice over, as one request: taken. The same again isn't.
      const push = await me.signed('POST', '/v1/changes', { records: [{ k: KEY, p: 'AAAA' }] })
      expect((await call(...push)).status).toBe(200)
      expect((await call(...push)).status).toBe(401)
      const read = await me.signed('GET', '/v1/changes?since=0')
      expect((await call(...read)).status).toBe(200)
      expect((await call(...read)).status).toBe(200)
    })

    // The code's hash, which a request caught in passing carries, could put another key in the library's place and
    // then require signed requests: every device of the writer's refused from then on, with nothing in the app to
    // undo it. Every device derives the one key from the code, so a different one is never a device's.
    it('keeps the key it has against another sent by the code’s hash alone', async () => {
      const call = server()
      const me = await enrolled(call)
      const someone = await device()
      const taken = await call(...(await someone.signed('POST', '/v1/key', { key: someone.publicKey }, { authorization: AUTH.Authorization })))
      expect(taken.status).toBe(409)
      // Theirs opens nothing, mine goes on working, and a second device with the same key enrols as ever.
      expect((await call(...(await someone.signed('POST', '/v1/signed-only', { on: true })))).status).toBe(401)
      expect((await call(...(await me.signed('GET', '/v1/status')))).status).toBe(200)
      expect((await call(...(await me.signed('POST', '/v1/key', { key: me.publicKey }, { authorization: AUTH.Authorization })))).status).toBe(200)
    })

    it('takes a key only from a device that proves it holds it', async () => {
      const call = server()
      const me = await device()
      const someone = await device()
      await call('/v1/library', post({ jws: 'receipt' }))
      const [path, init] = await someone.signed('POST', '/v1/key', { key: me.publicKey }, { authorization: AUTH.Authorization })
      expect((await call(path, init)).status).toBe(401)
    })

    it('refuses a signature made for another request', async () => {
      const call = server()
      const me = await enrolled(call)
      expect((await call(...(await me.signed('GET', '/v1/status', undefined, { as: '/v1/changes?since=0' })))).status).toBe(401)
      const [, init] = await me.signed('POST', '/v1/changes', { records: [{ k: KEY, p: 'AAAA' }] })
      expect((await call('/v1/changes', { ...init, body: JSON.stringify({ records: [{ k: KEY, p: 'BBBB' }] }) })).status).toBe(401)
    })

    it('once required, refuses the code alone, even to delete, and only a signed request can say so', async () => {
      const call = server()
      const me = await enrolled(call)
      expect((await call('/v1/signed-only', post({ on: true }))).status).toBe(403)
      expect((await call(...(await me.signed('POST', '/v1/signed-only', { on: true })))).status).toBe(200)
      expect(await (await call('/v1/changes?since=0')).json()).toMatchObject({ error: expect.stringContaining('signed requests only') })
      expect((await call('/v1/library', { method: 'DELETE' })).status).toBe(401)
      expect((await call(...(await me.signed('GET', '/v1/changes?since=0')))).status).toBe(200)
    })
  })

  it('answers the iOS app’s CORS preflight, and nobody else’s', async () => {
    const call = server()
    const app = await call('/v1/changes', { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost' } })
    expect(app.status).toBe(204)
    expect(app.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost')
    const other = await call('/v1/changes', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
