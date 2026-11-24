import { describe, expect, it } from 'vitest'
import { base64url } from './base64'
import { frontDoor, type Routes } from './door'
import { emptyFiles } from './files'
import { sha256 } from './http'
import { handlePost } from './inbox'
import { clipperCode, inboxKey, newInboxKeys, openPost, readClipperCode, sealedShape, sealPost } from './inbox-seal'
import { KEPT_MONTHS, Library, libraryRequests, retireLibrary, type LibraryEffects, type Region } from './library'
import { GRACE_MS } from './paid'
import { inboxCheck, signedMessage } from './signing'
import { Subscriber, subscriberRequests } from './subscriber'
import { handleSync, type Deps } from './sync'
import { memoryFiles, sqlite } from './testing'
import { INBOX_BYTES, INBOX_DAILY, INBOX_DAYS, INBOX_WAITING, MAX_POST, MAX_SEALED_POST, SEALED_TYPE, type Inbox } from './wire.mjs'

/** A library's inbox through the front door (worker/inbox), with real Library objects, their alarms and clock the test's. */

const ID = '0123456789abcdef0123456789abcdef'
const OTHER = 'fedcba9876543210fedcba9876543210'
const SECRET = 'S'.repeat(43)
const DAY = 86_400_000
const NOW = Date.UTC(2027, 0, 1, 12)
const auth = (id = ID, secret = 'A'.repeat(43)) => ({ Authorization: `Bearer ${id}.${secret}` })
const JSON_TYPE = { 'Content-Type': 'application/json' }
/** What a device keeps with its inbox: sealed there, so nothing here could read it. */
const KEPT = 'c2VhbGVkIGJ5IGEgZGV2aWNl'
const hex = async (text: string) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex')

function server({ expiresIn = 30 * DAY } = {}) {
  const libraries = new Map<string, { library: Library; sql: ReturnType<typeof sqlite>; effects: LibraryEffects; alarm: number | null }>()
  const subscribers = new Map<string, Subscriber>()
  const files = memoryFiles()
  const clock = { now: NOW }
  const open = (region: Region, id: string) => {
    const home = `${region}-${id}`
    const known = libraries.get(home) ?? libraries.set(home, (() => {
      const sql = sqlite()
      const kept = { library: new Library(sql), sql, alarm: null as number | null, effects: undefined as unknown as LibraryEffects }
      kept.effects = { alarm: async (at) => void (kept.alarm = at), home, deleteFiles: () => emptyFiles(files, home) }
      return kept
    })()).get(home)!
    return libraryRequests(known.library, () => clock.now, known.effects)
  }
  const deps: Deps = {
    verify: async () => ({ productId: 'p', originalTransactionId: 'o', expiresAt: NOW + expiresIn, purchasedAt: Date.UTC(2026, 0, 1), environment: 'Production' }),
    library: (id, region) => open(region, id),
    subscriber: (key) => subscriberRequests(subscribers.get(key) ?? subscribers.set(key, new Subscriber(sqlite())).get(key)!),
    files,
  }
  const routes = { sync: (asked) => handleSync(asked, deps), inbox: (asked) => handlePost(asked, { library: deps.library }) } as Routes
  /** A request from a device, with the library's code. */
  const call = (path: string, init: RequestInit = {}) => frontDoor(new Request(`https://nib.test${path}`, { ...init, headers: { ...auth(), ...init.headers } }), routes)
  /** A request from a service: no credentials but the address it's sent to. */
  const post = (body: BodyInit | null, headers: Record<string, string> = JSON_TYPE, address = `${ID}.${SECRET}`, method = 'POST') =>
    frontDoor(new Request(`https://nib.test/v1/in/${address}`, { method, body, headers, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit), routes)
  const create = (id = ID) => call('/v1/library', { method: 'POST', body: JSON.stringify({ jws: 'receipt' }), headers: { ...auth(id), ...JSON_TYPE } })
  const kept = (id = ID) => libraries.get(`eu-${id}`)!
  /** A library with an inbox, as a device makes one: its keys, and the address's secret sent as its hash. */
  async function inbox(secret = SECRET) {
    await create()
    const keys = await newInboxKeys()
    const set = await call('/v1/inbox', { method: 'PUT', body: JSON.stringify({ key: keys.publicKey, address: await hex(secret), kept: KEPT }), headers: JSON_TYPE })
    expect(set.status).toBe(200)
    return keys
  }
  const waiting = async (headers: Record<string, string> = {}) => (await call('/v1/inbox', { headers })).json() as Promise<Inbox>
  const taken = (ids: unknown) => call('/v1/inbox/taken', { method: 'POST', body: JSON.stringify({ ids }), headers: JSON_TYPE })
  return Object.assign(call, { post, create, inbox, waiting, taken, clock, kept, libraries, retire: () => retireLibrary(kept().library, clock.now, kept().effects) })
}

const said = async (response: Response) => [response.status, ((await response.json()) as { error?: string }).error]

describe('a library’s inbox', () => {
  it('takes a post from whoever holds the address, and keeps it sealed for a device to open', async () => {
    const call = server()
    const keys = await call.inbox()
    // With the key it seals with and a check of its address, for a device to see they're its own. Not the hash of
    // the address's secret: setting an inbox asks for that, so told here it let whoever had caught a request change
    // the key and keep the writer's address. The check is a hash of that hash, which sets nothing.
    const waiting = await call.waiting()
    expect(waiting).toEqual({ on: true, kept: KEPT, key: keys.publicKey, check: await inboxCheck(await sha256(SECRET)), posts: [], more: false })
    expect(JSON.stringify(waiting)).not.toContain(await sha256(SECRET))
    expect(waiting.check).toMatch(/^[0-9a-f]{64}$/)

    const sent = await call.post(JSON.stringify({ title: 'Tide times', text: 'High water at **06:12**.', url: 'https://example.com/tides' }))
    expect(sent.status).toBe(200)
    expect(await sent.json()).toEqual({ received: true })

    const { posts } = await call.waiting()
    expect(posts).toEqual([{ id: 1, at: NOW, p: expect.any(String) }])
    expect(await openPost(keys.privateKey, keys.publicKey, posts[0].p)).toEqual({ title: 'Tide times', text: 'High water at **06:12**.', url: 'https://example.com/tides' })
  })

  it('keeps nothing of a post that can be read: not its words, and the address’s secret only as its hash', async () => {
    const call = server()
    await call.inbox()
    await call.post(JSON.stringify({ title: 'Harbour ledger', text: 'Seventeen crates of herring', url: 'https://example.com/ledger' }))
    const { sql } = call.kept()
    const held = JSON.stringify([sql.all('SELECT * FROM inbox'), sql.all('SELECT * FROM meta'), sql.all('SELECT * FROM records')])
    const raw = Buffer.from(String(sql.all('SELECT p FROM inbox')[0].p), 'base64').toString('latin1')
    for (const words of ['Harbour', 'herring', 'example.com', SECRET]) {
      expect(held).not.toContain(words)
      expect(raw).not.toContain(words)
    }
    expect(held).toContain(await hex(SECRET))
  })

  it('takes JSON, a form, or the text alone; trims; and ignores what it has no place for', async () => {
    const call = server()
    const keys = await call.inbox()
    await call.post(JSON.stringify({ title: '  Spaced  ', text: '\n', url: null, folder: 'Work', extra: { deep: true } }))
    await call.post('title=From+a+form&text=Two%0Alines&url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1', { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' })
    await call.post('Just the words, as they came.\n', { 'Content-Type': 'text/plain' })
    await call.post('{"title":"sent without saying it was JSON"}', {})
    // As `curl -d 'words'` sends them: called a form, and no field named.
    await call.post('Bought milk & eggs = done', { 'Content-Type': 'application/x-www-form-urlencoded' })
    const opened = await Promise.all((await call.waiting()).posts.map((post) => openPost(keys.privateKey, keys.publicKey, post.p)))
    expect(opened).toEqual([
      { title: 'Spaced' },
      { title: 'From a form', text: 'Two\nlines', url: 'https://example.com/a?b=1' },
      { text: 'Just the words, as they came.' },
      { text: '{"title":"sent without saying it was JSON"}' },
      { text: 'Bought milk & eggs = done' },
    ])
  })

  it('refuses a post with nothing to keep, or with a field that isn’t text, and keeps none of it', async () => {
    const call = server()
    await call.inbox()
    for (const body of ['{}', '[]', 'not json', '{"title":"  ","text":""}', '{"title":7}', '{"text":["a"]}', '{"url":{"href":"x"}}', '{"title":"ok","text":false}']) {
      expect(await said(await call.post(body)), body).toEqual([400, expect.stringContaining('Nothing to keep')])
    }
    expect(await said(await call.post('   ', { 'Content-Type': 'text/plain' }))).toEqual([400, expect.stringContaining('Nothing to keep')])
    expect(await said(await call.post(null, {}))).toEqual([400, expect.stringContaining('Nothing to keep')])
    expect((await call.waiting()).posts).toEqual([])
  })

  it('says the same of a wrong secret, a library with no inbox and no library at all, and reads none of what was sent', async () => {
    const call = server()
    await call.inbox()
    await call.create(OTHER)
    const read = { n: 0 }
    const watched = () => new ReadableStream<Uint8Array>({
      pull(controller) {
        if (read.n++ < 20) controller.enqueue(new TextEncoder().encode('{"text":"x"}'))
        else controller.close()
      },
    })
    const none = [404, 'No inbox at that address.']
    expect(await said(await call.post(watched(), JSON_TYPE, `${ID}.${'T'.repeat(43)}`))).toEqual(none)
    expect(await said(await call.post(watched(), JSON_TYPE, `${OTHER}.${SECRET}`))).toEqual(none)
    expect(await said(await call.post(watched(), JSON_TYPE, `${'9'.repeat(32)}.${SECRET}`))).toEqual(none)
    // A stream takes its first piece as it's made, and no more.
    expect(read.n).toBeLessThanOrEqual(3)
    // Nor is an address that isn't shaped like one asked of any library.
    const before = call.libraries.size
    for (const address of ['nonsense', `${ID}`, `${ID}.short`, `${ID.toUpperCase()}.${SECRET}`, `${ID}.${SECRET}/more`]) expect(await said(await call.post('{"text":"x"}', JSON_TYPE, address)), address).toEqual(none)
    expect(call.libraries.size).toBe(before)
    expect((await call.waiting()).posts).toEqual([])
  })

  // The security review of 2026-11-13: the secret in a header, where nothing on the way notes it with the address.
  it('takes the secret in an Authorization header, sent to the id alone, as it does in the address', async () => {
    const call = server()
    await call.inbox()
    const sent = await call.post(JSON.stringify({ text: 'By header' }), { ...JSON_TYPE, Authorization: `Bearer ${SECRET}` }, ID)
    expect([sent.status, await sent.json()]).toEqual([200, { received: true }])
    expect((await call.waiting()).posts).toHaveLength(1)
    const none = [404, 'No inbox at that address.']
    expect(await said(await call.post('{"text":"x"}', { ...JSON_TYPE, Authorization: `Bearer ${'T'.repeat(43)}` }, ID))).toEqual(none)
    expect(await said(await call.post('{"text":"x"}', { ...JSON_TYPE, Authorization: `Basic ${SECRET}` }, ID))).toEqual(none)
    expect((await call.waiting()).posts).toHaveLength(1)
  })

  it('makes no library, and no table, for an address no one has', async () => {
    const call = server()
    await call.post('{"text":"x"}', JSON_TYPE, `${OTHER}.${SECRET}`)
    for (const { sql, alarm } of call.libraries.values()) {
      expect(sql.all("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([])
      expect(alarm).toBe(null)
    }
  })

  it('takes posts only: anything else sent to the address is told so', async () => {
    const call = server()
    await call.inbox()
    for (const method of ['GET', 'PUT', 'DELETE']) expect(await said(await call.post(null, {}, `${ID}.${SECRET}`, method)), method).toEqual([405, 'Send a POST to this address.'])
  })

  it('takes a post up to 100 KB, and none past it', async () => {
    expect(MAX_POST).toBe(100_000)
    const call = server()
    const keys = await call.inbox()
    const most = 'x'.repeat(MAX_POST)
    expect((await call.post(most, { 'Content-Type': 'text/plain' })).status).toBe(200)
    expect((await call.post(most + 'x', { 'Content-Type': 'text/plain' })).status).toBe(413)
    // Whatever it says of its length, or if it says nothing.
    const stream = new Blob([most + 'x']).stream()
    expect((await call.post(stream, { 'Content-Type': 'text/plain' })).status).toBe(413)
    const { posts } = await call.waiting()
    expect(posts).toHaveLength(1)
    expect((await openPost(keys.privateKey, keys.publicKey, posts[0].p)).text).toHaveLength(MAX_POST)
  })

  describe('a clip that comes sealed already, from Nib’s browser extension', () => {
    const SEALED = { 'Content-Type': SEALED_TYPE }

    it('is kept as it came, unread and not sealed again, and opens on a device', async () => {
      expect(SEALED_TYPE).toBe('application/nib-sealed')
      const call = server()
      const keys = await call.inbox()
      const clip = { title: 'Tides of the north harbour', url: 'https://example.com/tides', page: '<h2>Spring tides</h2><p>High water comes twice a day.</p>', part: 'article' }
      const sealed = await sealPost(keys.publicKey, clip)
      const sent = await call.post(`${sealed}\n`, { 'Content-Type': 'application/nib-sealed; charset=utf-8' })
      expect(sent.status).toBe(200)
      expect(await sent.json()).toEqual({ received: true })
      const { posts } = await call.waiting()
      expect(posts).toEqual([{ id: 1, at: NOW, p: sealed }])
      expect(await openPost(keys.privateKey, keys.publicKey, posts[0].p)).toEqual(clip)
    })

    it('is taken only shaped as a sealed post is: all the server can tell of one', async () => {
      const call = server()
      const keys = await call.inbox()
      const sealed = await sealPost(keys.publicKey, { title: 'A clip' })
      expect(sealedShape(sealed)).toBe(true)
      const later = Buffer.from(sealed, 'base64')
      later[0] = 2
      for (const body of ['', 'not sealed at all', '{"title":"plain, and called sealed"}', sealed.slice(0, 100), sealed.replace(/=*$/, '').slice(0, -1) + '!', later.toString('base64'), Buffer.from(sealed, 'base64').toString('base64url') + '-_']) {
        expect(sealedShape(body), body.slice(0, 24)).toBe(false)
        expect(await said(await call.post(body, SEALED)), body.slice(0, 24)).toEqual([400, 'Expected a sealed clip.'])
      }
      expect((await call.waiting()).posts).toEqual([])
      // Called anything else, a sealed clip is words like any others: sealed again, and no clip to a device.
      expect((await call.post(sealed, { 'Content-Type': 'text/plain' })).status).toBe(200)
      expect(await openPost(keys.privateKey, keys.publicKey, (await call.waiting()).posts[0].p)).toEqual({ text: sealed })
    })

    it('may be up to 1 MB as it’s sent, and no more; goes to the same address, with Plus, as any post', async () => {
      expect(MAX_SEALED_POST).toBe(1_000_000)
      const call = server({ expiresIn: DAY })
      const keys = await call.inbox()
      // As long a page as fits: its seal is the page and a little.
      const long = await sealPost(keys.publicKey, { page: 'x'.repeat(740_000), part: 'whole' })
      expect(long.length).toBeLessThanOrEqual(MAX_SEALED_POST)
      expect((await call.post(long, SEALED)).status).toBe(200)
      expect((await call.post(await sealPost(keys.publicKey, { page: 'x'.repeat(760_000) }), SEALED)).status).toBe(413)
      expect(await said(await call.post(long, SEALED, `${ID}.${'T'.repeat(43)}`))).toEqual([404, 'No inbox at that address.'])
      call.clock.now = NOW + DAY + GRACE_MS + 1
      expect((await call.post(long, SEALED)).status).toBe(402)
      call.clock.now = NOW
      expect((await call.waiting()).posts).toHaveLength(1)
    })

    it('fills the inbox by what waits in it as well as by how many: 20 MB in all', async () => {
      expect(INBOX_BYTES).toBe(20_000_000)
      const call = server()
      const keys = await call.inbox()
      const address = await hex(SECRET)
      const sealed = await sealPost(keys.publicKey, { title: 'A clip' })
      const { library } = call.kept()
      for (let n = 0; n < 19; n++) library.addPost(address, 'x'.repeat(1_000_000), NOW)
      library.addPost(address, 'x'.repeat(1_000_000 - sealed.length + 1), NOW)
      // Room for one more while it's under, whatever that one takes it to.
      expect((await call.post(sealed, SEALED)).status).toBe(200)
      expect(await said(await call.post(sealed, SEALED))).toEqual([507, 'This inbox is full. Open Nib to take in what’s waiting.'])
      expect(await said(await call.post('{"text":"nor a plain post"}'))).toEqual([507, 'This inbox is full. Open Nib to take in what’s waiting.'])
      await call.taken([1])
      expect((await call.post(sealed, SEALED)).status).toBe(200)
    })
  })

  it('needs Nib Plus: a lapsed library’s inbox takes nothing, and gives a device nothing', async () => {
    const call = server({ expiresIn: DAY })
    await call.inbox()
    expect((await call.post('{"text":"while paid"}')).status).toBe(200)
    call.clock.now = NOW + DAY + GRACE_MS + 1
    expect(await said(await call.post('{"text":"after"}'))).toEqual([402, 'Nib Plus is not active for this library.'])
    expect((await call('/v1/inbox')).status).toBe(402)
    expect((await call.taken([1])).status).toBe(402)
    // And none is made without it.
    expect((await call('/v1/inbox', { method: 'PUT', body: JSON.stringify({ key: (await newInboxKeys()).publicKey, address: await hex('new'), kept: KEPT }), headers: JSON_TYPE })).status).toBe(402)
  })

  it('is a device’s to make, read and clear only with the library’s code', async () => {
    const call = server()
    const keys = await call.inbox()
    await call.post('{"text":"kept"}')
    const wrong = auth(ID, 'B'.repeat(43))
    const body = JSON.stringify({ key: keys.publicKey, address: await hex('theirs'), kept: KEPT })
    expect((await call('/v1/inbox', { headers: wrong })).status).toBe(401)
    expect((await call('/v1/inbox', { method: 'PUT', body, headers: { ...wrong, ...JSON_TYPE } })).status).toBe(401)
    expect((await call('/v1/inbox', { method: 'DELETE', headers: wrong })).status).toBe(401)
    expect((await call('/v1/inbox/taken', { method: 'POST', body: '{"ids":[1]}', headers: { ...wrong, ...JSON_TYPE } })).status).toBe(401)
    expect((await call('/v1/inbox', { headers: { Authorization: '' } })).status).toBe(401)
    expect((await call.waiting()).posts).toHaveLength(1)
    expect((await call.post('{"text":"still the first address"}')).status).toBe(200)
  })

  it('is made only with a key that is one, and the hash of a secret', async () => {
    const call = server()
    await call.create()
    const { publicKey } = await newInboxKeys()
    const address = await hex(SECRET)
    const put = (body: unknown) => call('/v1/inbox', { method: 'PUT', body: JSON.stringify(body), headers: JSON_TYPE })
    // 65 bytes that are no point on the curve; a key of another kind; too short; not text.
    const off = base64url(Uint8Array.of(4, ...new Uint8Array(64).fill(1)))
    // The same key written short, as some runtimes also read one: what a post is sealed to is the key as written, so only one way of writing it will do.
    const whole = Buffer.from(publicKey, 'base64url')
    const short = base64url(Uint8Array.of(2 + (whole[64] & 1), ...whole.subarray(1, 33)))
    expect(await crypto.subtle.importKey('raw', Buffer.from(short, 'base64url'), { name: 'ECDH', namedCurve: 'P-256' }, false, [])).toBeTruthy()
    const kept = KEPT
    for (const body of [{ key: short, address, kept }, { key: off, address, kept }, { key: 'K'.repeat(43), address, kept }, { key: publicKey.slice(1), address, kept }, { key: 7, address, kept }, { address, kept }, { key: publicKey, kept }, { key: publicKey, address: SECRET, kept }, { key: publicKey, address: address.toUpperCase(), kept }, []]) {
      expect(await said(await put(body)), JSON.stringify(body)).toEqual([400, 'Expected { key, address, kept }.'])
    }
    // What the devices keep with it: there, sealed as a device seals (base64), and no more than a key and a secret take.
    for (const kept of [undefined, '', 7, 'not base64!', 'abc', 'A'.repeat(4100)]) {
      expect(await said(await put({ key: publicKey, address, kept })), String(kept).slice(0, 12)).toEqual([400, 'Expected { key, address, kept }.'])
    }
    expect((await call.waiting()).on).toBe(false)
    expect(await said(await call.post('{"text":"x"}'))).toEqual([404, 'No inbox at that address.'])
    expect((await put({ key: publicKey, address, kept: 'A'.repeat(4096) })).status).toBe(200)
    expect((await call.waiting()).on).toBe(true)
  })

  it('clears what a device took by its id, and never gives an id again', async () => {
    const call = server()
    await call.inbox()
    for (const text of ['one', 'two', 'three']) await call.post(JSON.stringify({ text }))
    expect((await call.waiting()).posts.map((post) => post.id)).toEqual([1, 2, 3])
    expect(await (await call.taken([1, 3, 99])).json()).toEqual({ taken: true })
    expect((await call.waiting()).posts.map((post) => post.id)).toEqual([2])
    await call.taken([2])
    await call.post('{"text":"four"}')
    // Cleared again by a device that was slow to say so: what came since is not what it took.
    await call.taken([1, 2, 3])
    expect((await call.waiting()).posts.map((post) => post.id)).toEqual([4])
    for (const ids of [undefined, 'all', [1.5], [0], [-1], ['1'], [Number.MAX_SAFE_INTEGER + 2], Array(1001).fill(1)]) {
      expect(await said(await call.taken(ids)), JSON.stringify(ids)?.slice(0, 20)).toEqual([400, 'Expected { ids }.'])
    }
    expect((await call.waiting()).posts).toHaveLength(1)
  })

  it('holds 200 posts for a device, then says it’s full until some are taken', async () => {
    expect(INBOX_WAITING).toBe(200)
    const call = server()
    await call.inbox()
    const { library } = call.kept()
    const address = await hex(SECRET)
    for (let n = 0; n < INBOX_WAITING - 1; n++) library.addPost(address, 'sealed', NOW - DAY)
    expect((await call.post('{"text":"the last there’s room for"}')).status).toBe(200)
    expect(await said(await call.post('{"text":"one too many"}'))).toEqual([507, 'This inbox is full. Open Nib to take in what’s waiting.'])
    expect(() => library.addPost(address, 'sealed', NOW)).toThrow('full')
    // A device sees them fifty at a time, oldest first, and is told there are more.
    const first = await call.waiting()
    expect(first.posts.map((post) => post.id)).toEqual(Array.from({ length: 50 }, (_, n) => n + 1))
    expect(first.more).toBe(true)
    await call.taken(first.posts.map((post) => post.id))
    expect((await call.post('{"text":"room again"}')).status).toBe(200)
    const all = call.kept().sql.all('SELECT COUNT(*) AS n FROM inbox')[0].n
    expect(all).toBe(INBOX_WAITING - 50 + 1)
  })

  it('gives a device what fits one answer when posts are large', async () => {
    const call = server()
    await call.inbox()
    const address = await hex(SECRET)
    for (let n = 0; n < 12; n++) call.kept().library.addPost(address, 'x'.repeat(1_000_000), NOW)
    const first = await call.waiting()
    expect(first.posts.length).toBeGreaterThan(0)
    expect(first.posts.length).toBeLessThan(12)
    expect(first.more).toBe(true)
  })

  it('takes 200 posts in a day (UTC), however fast they’re taken in, and starts again the next', async () => {
    expect(INBOX_DAILY).toBe(200)
    const call = server()
    await call.inbox()
    const { library, sql } = call.kept()
    const address = await hex(SECRET)
    for (let n = 0; n < INBOX_DAILY - 1; n++) library.addPost(address, 'sealed', NOW)
    sql.run('DELETE FROM inbox')
    expect((await call.post('{"text":"the day’s last"}')).status).toBe(200)
    expect(await said(await call.post('{"text":"one more"}'))).toEqual([429, 'This inbox has taken all it takes in a day.'])
    call.clock.now = Date.UTC(2027, 0, 1, 23, 59, 59)
    expect((await call.post('{"text":"still today"}')).status).toBe(429)
    call.clock.now = Date.UTC(2027, 0, 2, 0, 0, 1)
    expect((await call.post('{"text":"tomorrow"}')).status).toBe(200)
    expect((await call.waiting()).posts).toHaveLength(2)
  })

  it('stops the old address at once when a device sets a new one, and keeps what was waiting', async () => {
    const call = server()
    const keys = await call.inbox()
    await call.post('{"text":"before"}')
    const put = await call('/v1/inbox', { method: 'PUT', body: JSON.stringify({ key: keys.publicKey, address: await hex('N'.repeat(43)), kept: 'bmV3ZXI=' }), headers: JSON_TYPE })
    expect(await put.json()).toEqual({ on: true })
    expect(await said(await call.post('{"text":"to the old address"}'))).toEqual([404, 'No inbox at that address.'])
    expect((await call.post('{"text":"to the new"}', JSON_TYPE, `${ID}.${'N'.repeat(43)}`)).status).toBe(200)
    const opened = await Promise.all((await call.waiting()).posts.map((post) => openPost(keys.privateKey, keys.publicKey, post.p)))
    expect(opened).toEqual([{ text: 'before' }, { text: 'to the new' }])
    // And what the devices keep with it is what came with the new address.
    expect((await call.waiting()).kept).toBe('bmV3ZXI=')
  })

  it('tells a device as it syncs how many posts wait, and says nothing of an inbox with none', async () => {
    const call = server()
    await call.inbox()
    const changes = async () => (await call('/v1/changes?since=0')).json() as Promise<Record<string, unknown>>
    expect(await changes()).toEqual({ records: [], seq: 0, more: false })
    await call.post('{"text":"one"}')
    await call.post('{"text":"two"}')
    expect(await changes()).toEqual({ records: [], seq: 0, more: false, inbox: 2 })
    await call.taken([1, 2])
    expect(await changes()).toEqual({ records: [], seq: 0, more: false })
  })

  it('is ended by a device: its address stops, and what was waiting is deleted', async () => {
    const call = server({ expiresIn: DAY })
    await call.inbox()
    await call.post('{"text":"waiting"}')
    // Without Plus too.
    call.clock.now = NOW + DAY + GRACE_MS + 1
    const ended = await call('/v1/inbox', { method: 'DELETE' })
    expect(await ended.json()).toEqual({ on: false })
    const { sql } = call.kept()
    expect(sql.all('SELECT * FROM inbox')).toEqual([])
    // All that's left says how many posts there have been, so one made again never gives an id twice.
    expect(sql.all("SELECT k FROM meta WHERE k LIKE 'inbox%'")).toEqual([{ k: 'inboxSeq' }])
    call.clock.now = NOW
    expect(await call.waiting()).toEqual({ on: false, posts: [], more: false })
    expect(await said(await call.post('{"text":"after"}'))).toEqual([404, 'No inbox at that address.'])
    await call('/v1/inbox', { method: 'PUT', body: JSON.stringify({ key: (await newInboxKeys()).publicKey, address: await hex(SECRET), kept: KEPT }), headers: JSON_TYPE })
    await call.post('{"text":"to the inbox made again"}')
    expect((await call.waiting()).posts.map((post) => post.id)).toEqual([2])
  })

  it('goes with the library when that’s deleted from a device', async () => {
    const call = server()
    await call.inbox()
    await call.post('{"text":"waiting"}')
    expect((await call('/v1/library', { method: 'DELETE' })).status).toBe(200)
    expect(call.kept().sql.all("SELECT name FROM sqlite_master WHERE name = 'inbox'")).toEqual([])
    expect(await said(await call.post('{"text":"after"}'))).toEqual([404, 'No inbox at that address.'])
  })

  describe('after 30 days', () => {
    const yearOn = (ended: number) => {
      const date = new Date(ended + GRACE_MS)
      date.setUTCMonth(date.getUTCMonth() + KEPT_MONTHS)
      return date.getTime()
    }
    const LONG = 400 * DAY

    it('wakes the library when its oldest post is due, deletes that one alone, and waits for the next', async () => {
      expect(INBOX_DAYS).toBe(30)
      const call = server({ expiresIn: LONG })
      await call.inbox()
      const end = yearOn(NOW + LONG)
      expect(call.kept().alarm).toBe(end)
      await call.post('{"text":"first"}')
      expect(call.kept().alarm).toBe(NOW + 30 * DAY)
      call.clock.now = NOW + 10 * DAY
      await call.post('{"text":"second"}')
      expect(call.kept().alarm).toBe(NOW + 30 * DAY)

      // A moment early, nothing goes.
      call.clock.now = NOW + 30 * DAY - 1
      await call.retire()
      expect(call.kept().sql.all('SELECT id FROM inbox')).toEqual([{ id: 1 }, { id: 2 }])
      call.clock.now = NOW + 30 * DAY
      await call.retire()
      expect(call.kept().sql.all('SELECT id FROM inbox')).toEqual([{ id: 2 }])
      expect(call.kept().alarm).toBe(NOW + 40 * DAY)
      call.clock.now = NOW + 40 * DAY
      await call.retire()
      expect(call.kept().sql.all('SELECT id FROM inbox')).toEqual([])
      // And then for the library's own end, which it hasn't come to.
      expect(call.kept().alarm).toBe(end)
      expect((await call.waiting()).on).toBe(true)
    })

    it('goes back to waiting for the library’s end once a device has taken what was there', async () => {
      const call = server({ expiresIn: LONG })
      await call.inbox()
      await call.post('{"text":"first"}')
      await call.taken([1])
      expect(call.kept().alarm).toBe(yearOn(NOW + LONG))
    })

    it('gives a device none that’s past its time, even before the alarm has come', async () => {
      const call = server({ expiresIn: LONG })
      await call.inbox()
      await call.post('{"text":"old"}')
      call.clock.now = NOW + 30 * DAY
      expect((await call.waiting()).posts).toEqual([])
      expect(call.kept().sql.all('SELECT * FROM inbox')).toEqual([])
    })
  })

  describe('signed', () => {
    it('is made, read and cleared by signed requests, what they send signed with them', async () => {
      const call = server()
      await call.create()
      const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
      const signing = base64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
      const signed = async (method: string, path: string, body = '', signedBody = body) => {
        const time = Date.now()
        const message = signedMessage({ id: ID, method, path, time, bodyHash: await hex(signedBody) })
        const signature = base64url(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(message))))
        return call(path, { method, ...(body ? { body } : {}), headers: { Authorization: `Signed ${ID}`, 'X-Nib-Time': String(time), 'X-Nib-Signature': signature, ...JSON_TYPE } })
      }
      call.clock.now = Date.now()
      await call.create()
      const enrol = JSON.stringify({ key: signing })
      const time = Date.now()
      const proof = base64url(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(signedMessage({ id: ID, method: 'POST', path: '/v1/key', time, bodyHash: await hex(enrol) })))))
      expect((await call('/v1/key', { method: 'POST', body: enrol, headers: { 'X-Nib-Time': String(time), 'X-Nib-Signature': proof, ...JSON_TYPE } })).status).toBe(200)

      const keys = await newInboxKeys()
      const set = JSON.stringify({ key: keys.publicKey, address: await hex(SECRET), kept: KEPT })
      // Signed for another address than the one sent: not taken.
      expect((await signed('PUT', '/v1/inbox', set, JSON.stringify({ key: keys.publicKey, address: await hex('theirs'), kept: KEPT }))).status).toBe(401)
      expect((await signed('PUT', '/v1/inbox', set)).status).toBe(200)
      expect((await call.post('{"text":"x"}')).status).toBe(200)
      expect(((await (await signed('GET', '/v1/inbox')).json()) as Inbox).posts).toHaveLength(1)
      expect((await signed('POST', '/v1/inbox/taken', '{"ids":[1]}', '{"ids":[2]}')).status).toBe(401)
      expect((await signed('POST', '/v1/inbox/taken', '{"ids":[1]}')).status).toBe(200)
      expect(((await (await signed('GET', '/v1/inbox')).json()) as Inbox).posts).toEqual([])
      expect((await signed('DELETE', '/v1/inbox')).status).toBe(200)
    })
  })
})

describe('a sealed post', () => {
  it('opens only with the inbox’s own key, and not once changed', async () => {
    const [mine, theirs] = [await newInboxKeys(), await newInboxKeys()]
    const sealed = await sealPost(mine.publicKey, { title: 'Tide times', text: 'élan — 潮' })
    expect(await openPost(mine.privateKey, mine.publicKey, sealed)).toEqual({ title: 'Tide times', text: 'élan — 潮' })
    await expect(openPost(theirs.privateKey, theirs.publicKey, sealed)).rejects.toThrow()
    // The right key, said to be another inbox's: what it was sealed to is part of the seal.
    await expect(openPost(mine.privateKey, theirs.publicKey, sealed)).rejects.toThrow()
    const bytes = Buffer.from(sealed, 'base64')
    for (const at of [1, 40, 70, 80, bytes.length - 1]) {
      const changed = Buffer.from(bytes)
      changed[at] ^= 1
      await expect(openPost(mine.privateKey, mine.publicKey, changed.toString('base64')), `byte ${at}`).rejects.toThrow()
    }
    const later = Buffer.from(bytes)
    later[0] = 2
    await expect(openPost(mine.privateKey, mine.publicKey, later.toString('base64'))).rejects.toThrow('doesn’t know')
  })

  it('is sealed as the app and the server have agreed, which posts already waiting hold them to', async () => {
    // Opened here by the format alone, with nothing of worker/inbox-seal: a version, the post's own key, an IV, then AES-256-GCM
    // under HKDF-SHA256 of what the keys agree on, salted with the post's key and then the inbox's, as "nib inbox v1".
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    const inbox = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey))
    const bytes = Buffer.from(await sealPost(inbox.toString('base64url'), { title: 'Tide times' }), 'base64')
    expect(bytes[0]).toBe(1)
    const [once, iv, rest] = [bytes.subarray(1, 66), bytes.subarray(66, 78), bytes.subarray(78)]
    const theirs = await crypto.subtle.importKey('raw', once, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, pair.privateKey, 256)
    const drawn = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
    const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: Buffer.concat([once, inbox]), info: new TextEncoder().encode('nib inbox v1') }, drawn, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
    expect(JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, rest)))).toEqual({ title: 'Tide times' })
  })

  it('is sealed afresh each time: the same post twice is nothing alike', async () => {
    const { publicKey } = await newInboxKeys()
    const [a, b] = [await sealPost(publicKey, { text: 'same' }), await sealPost(publicKey, { text: 'same' })]
    expect(a).not.toBe(b)
    // Not the key made for it, nor the IV, nor what follows.
    expect(a.slice(0, 40)).not.toBe(b.slice(0, 40))
    expect(a.slice(-20)).not.toBe(b.slice(-20))
  })

  it('is never sealed with what isn’t an inbox’s key', async () => {
    expect(await inboxKey('K'.repeat(87))).toBe(null)
    expect(await inboxKey('')).toBe(null)
    await expect(sealPost('K'.repeat(87), { text: 'x' })).rejects.toThrow('Not an inbox’s key')
    expect(await inboxKey((await newInboxKeys()).publicKey)).not.toBe(null)
  })
})

describe('the clipper code', () => {
  const ADDRESS = `https://sync.nibprivacy.com/v1/in/${ID}.${SECRET}`

  it('is the inbox’s address and its key, and reads back as both', async () => {
    const { publicKey } = await newInboxKeys()
    const code = clipperCode(ADDRESS, publicKey)
    expect(code).toBe(`${ADDRESS}#${publicKey}`)
    expect(readClipperCode(code)).toEqual({ address: ADDRESS, key: publicKey })
    expect(readClipperCode(`  ${code}\n`)).toEqual({ address: ADDRESS, key: publicKey })
    // A server on this computer, for trying the extension out.
    const local = `http://localhost:8799/v1/in/${ID}.${SECRET}`
    expect(readClipperCode(clipperCode(local, publicKey))).toEqual({ address: local, key: publicKey })
    expect(readClipperCode(clipperCode(local.replace('localhost', '127.0.0.1'), publicKey))).not.toBe(null)
  })

  it('reads nothing else as one: not the address alone, a key that isn’t one, another path, or anywhere a clip would go unsealed in passing', async () => {
    const { publicKey } = await newInboxKeys()
    for (const code of [
      '',
      ADDRESS,
      `${ADDRESS}#`,
      `${ADDRESS}#${publicKey.slice(1)}`,
      `${ADDRESS}#${publicKey}#more`,
      `${ADDRESS}/more#${publicKey}`,
      `${ADDRESS}?to=elsewhere#${publicKey}`,
      `https://sync.nibprivacy.com/v1/inbox#${publicKey}`,
      `https://sync.nibprivacy.com/v1/in/${ID}.short#${publicKey}`,
      `http://sync.nibprivacy.com/v1/in/${ID}.${SECRET}#${publicKey}`,
      `http://localhost.example.com/v1/in/${ID}.${SECRET}#${publicKey}`,
      `https://someone@sync.nibprivacy.com/v1/in/${ID}.${SECRET}#${publicKey}`,
      `ftp://sync.nibprivacy.com/v1/in/${ID}.${SECRET}#${publicKey}`,
      `not a link#${publicKey}`,
    ]) {
      expect(readClipperCode(code), code.slice(0, 60)).toBe(null)
    }
  })
})

describe('the front door', () => {
  it('sends a post to the inbox, and a device’s side of it to the sync API', async () => {
    const seen: string[] = []
    const routes = { inbox: async () => (seen.push('inbox'), new Response('')), sync: async () => (seen.push('sync'), new Response('')) } as unknown as Routes
    for (const path of [`/v1/in/${ID}.${SECRET}`, '/v1/in/anything', '/v1/inbox', '/v1/inbox/taken', '/v1/in']) await frontDoor(new Request(`https://nib.test${path}`, { method: 'POST' }), routes)
    expect(seen).toEqual(['inbox', 'inbox', 'sync', 'sync', 'sync'])
  })
})
