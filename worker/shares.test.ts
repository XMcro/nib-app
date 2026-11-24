import { describe, expect, it } from 'vitest'
import { frontDoor, type Routes } from './door'
import { networkOf, sha256 } from './http'
import type { Claims } from './jws'
import type { LibraryRequests } from './library'
import { GRACE_MS } from './paid'
import { EVERYONE, FreeQuota, quotaRequests } from './quota'
import {
  expireShare,
  FREE_PER_DAY,
  FREE_PER_DAY_EVERYONE,
  FREE_PER_DAY_WIDE,
  NOTES_PER_READER_PER_DAY,
  NOTES_PER_MINUTE,
  NOTES_PER_WIDE_PER_DAY,
  OPENS_PER_WIDE_PER_DAY,
  REVEALED_KEPT_MS,
  REVEALS_PER_NETWORK_PER_DAY,
  REVEALS_PER_WIDE_PER_DAY,
  Share,
  shareRequests,
} from './share'
import { handleShares, READER_HEADERS, type ShareDeps } from './shares'
import { MAX_LIVE_SHARES, NEW_SHARES_PER_DAY, Subscriber, subscriberRequests, type SubscriberRequests } from './subscriber'
import { handleSync } from './sync'
import { memoryFiles, sqlite } from './testing'
import { endOfDay, MAX_NOTE_LENGTH } from './wire.mjs'

const DAY = 86_400_000
const SLUG = 'S'.repeat(22)
const OWNER = 'O'.repeat(43)
const OWNED = { Authorization: `Owner ${OWNER}` }

/** When test receipts were bought, unless they say "-bought-<ms>". */
const PURCHASED = Date.UTC(2026, 11, 1)

/**
 * The share routes through the front door, wired to real Share and Subscriber objects in memory, as
 * index.ts wires Durable Objects. Receipts are "valid-until-<ms>" or
 * "lapsed"; the clock is the test's.
 */
function server({ off = false, blocked = [] as string[], secret = 'the-secret' } = {}) {
  const clock = { now: Date.UTC(2027, 0, 1) }
  const shares = new Map<string, Share>()
  const subscribers = new Map<string, Subscriber>()
  const quotas = new Map<string, FreeQuota>()
  const alarms = new Map<string, number | null>()
  const subscriber: ShareDeps['subscriber'] = (key) => subscriberRequests(subscribers.get(key) ?? subscribers.set(key, new Subscriber(sqlite())).get(key)!, () => clock.now)
  const shareOf = (slug: string) => shares.get(slug) ?? shares.set(slug, new Share(sqlite())).get(slug)!
  const effects = (slug: string) => ({ subscriber, alarm: async (at: number | null) => void alarms.set(slug, at) })
  /** How often the count everyone's free links share was asked to take one more. */
  const everyone = { spends: 0 }
  const quotaOf = (key: string) => quotaRequests(quotas.get(key) ?? quotas.set(key, new FreeQuota(sqlite())).get(key)!, { alarm: async () => {} }, () => clock.now)
  const deps: ShareDeps = {
    share: (slug) => shareRequests(shareOf(slug), effects(slug), () => clock.now),
    subscriber,
    quota: (key) => {
      const quota = quotaOf(key)
      return key === EVERYONE ? { ...quota, spend: (...args: Parameters<typeof quota.spend>) => (everyone.spends++, quota.spend(...args)) } : quota
    },
    secret,
    verify: async (jws): Promise<Claims> => {
      const [, until, bought] = /^valid-until-(\d+)(?:-bought-(\d+))?$/.exec(jws) ?? []
      if (!until) throw new Error('not signed by Apple')
      return { productId: 'p', originalTransactionId: 'subscription-1', expiresAt: Number(until), purchasedAt: Number(bought ?? PURCHASED), environment: 'Production' }
    },
    off,
    blocked,
    now: () => clock.now,
  }
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await frontDoor(new Request(`https://nib.test${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } }), { shares: (asked) => handleShares(asked, deps) } as Routes)
    return { status: response.status, body: response.headers.get('Content-Type')?.includes('json') ? await response.json() : await response.text(), headers: response.headers }
  }
  const paidUntil = (ms: number) => `valid-until-${ms}`
  const create = (overrides: Record<string, unknown> = {}, headers: Record<string, string> = OWNED) =>
    request('/v1/shares', { method: 'POST', headers, body: JSON.stringify({ slug: SLUG, jws: paidUntil(clock.now + 30 * DAY), days: 30, doc: 'c2VhbGVk', ...overrides }) })
  /** Without a receipt, from an IP address. */
  const createFree = (overrides: Record<string, unknown> = {}, ip = '203.0.113.7') =>
    request('/v1/shares', { method: 'POST', headers: { ...OWNED, 'CF-Connecting-IP': ip }, body: JSON.stringify({ slug: SLUG, doc: 'c2VhbGVk', ...overrides }) })
  return { request, create, createFree, clock, alarms, paidUntil, deps, quotas, everyone, shareOf, expire: () => expireShare(shareOf(SLUG), clock.now, effects(SLUG)) }
}

const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({ method: 'POST', headers, body: JSON.stringify(body) })

describe('creating a share', () => {
  it('needs a current subscription, checked by its expiry as well as its signature', async () => {
    const { create, clock, paidUntil } = server()
    expect((await create({ jws: 'forged' })).status).toBe(403)
    expect((await create({ jws: paidUntil(clock.now - GRACE_MS - 1) })).status).toBe(403)
    const created = await create()
    expect(created.status).toBe(201)
    expect(created.body).toEqual({ expiresAt: clock.now + 30 * DAY })
  })

  // Apple keeps the original transaction id when a subscription is bought
  // again, so one refund refused its buyer's shares for good.
  it('takes a subscription bought again after a refund, but not the refunded purchase', async () => {
    const { create, request, clock, deps } = server()
    await deps.subscriber(await sha256('subscription-1')).revoke(PURCHASED)
    const until = clock.now + 30 * DAY
    expect((await create({ jws: `valid-until-${until}` })).status).toBe(403)
    expect((await request('/v1/shares/entitlement', post({ jws: `valid-until-${until}` }))).status).toBe(403)
    expect((await create({ jws: `valid-until-${until}-bought-${PURCHASED + 1}` })).status).toBe(201)
    expect((await request('/v1/shares/entitlement', post({ jws: `valid-until-${until}-bought-${PURCHASED + 1}` }))).status).toBe(200)
  })

  it('needs an owner token, and a slug, a length and a sealed document of the right shapes', async () => {
    const { create } = server()
    expect((await create({}, {})).status).toBe(401)
    expect((await create({ slug: 'short' })).status).toBe(400)
    expect((await create({ days: 365 })).status).toBe(400)
    expect((await create({ doc: '<script>' })).status).toBe(400)
  })

  it('refuses a body past the limit, however it is sent', async () => {
    const { request } = server()
    const chunk = new TextEncoder().encode('x'.repeat(1_000_000))
    let sent = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 20) controller.enqueue(chunk)
        else controller.close()
      },
    })
    expect((await request('/v1/shares', { method: 'POST', headers: OWNED, body: endless, duplex: 'half' } as RequestInit)).status).toBe(413)
  })

  it('schedules its own deletion at expiry, and deletes everything then', async () => {
    const { create, request, clock, alarms, expire } = server()
    await create({ days: 7 })
    expect(alarms.get(SLUG)).toBe(clock.now + 7 * DAY)
    clock.now += 7 * DAY
    await expire()
    expect((await request(`/v1/shares/${SLUG}`)).status).toBe(404)
  })

  it(`counts against ${MAX_LIVE_SHARES} live shares per subscription; revoking frees a place`, async () => {
    const { create, request } = server()
    const slug = (i: number) => String(i).padStart(22, 'x')
    for (let i = 0; i < MAX_LIVE_SHARES; i++) expect((await create({ slug: slug(i) })).status).toBe(201)
    expect((await create({ slug: slug(99) })).status).toBe(429)
    await request(`/v1/shares/${slug(3)}`, { method: 'DELETE', headers: OWNED })
    expect((await create({ slug: slug(99) })).status).toBe(201)
  })

  // Posted again, a share was refused (409), and the refusal took the live
  // share off its subscription's count, or cut its time there short: any
  // number stayed live, and a refund cut none of them off.
  it('keeps a share posted again on the count, for as long as it lasts', async () => {
    const { create, clock, deps } = server()
    const slug = (i: number) => String(i).padStart(22, 'x')
    for (let i = 0; i < MAX_LIVE_SHARES; i++) {
      expect((await create({ slug: slug(i) })).status).toBe(201)
      expect((await create({ slug: slug(i), days: 7 })).status).toBe(409)
    }
    clock.now += 8 * DAY
    expect((await create({ slug: slug(99) })).status).toBe(429)
    const { body } = await deps.subscriber(await sha256('subscription-1')).revoke(PURCHASED)
    expect((body as { shares: string[] }).shares).toHaveLength(MAX_LIVE_SHARES)
  })
})

describe('a free share', () => {
  it('needs no receipt, lasts 7 days and no other length, and reads like any other', async () => {
    const { createFree, request, clock, alarms } = server()
    expect((await createFree({ days: 30 })).status).toBe(400)
    const created = await createFree()
    expect(created).toMatchObject({ status: 201, body: { expiresAt: clock.now + 7 * DAY } })
    expect(alarms.get(SLUG)).toBe(clock.now + 7 * DAY)
    expect((await request(`/v1/shares/${SLUG}`)).body).toEqual({ doc: 'c2VhbGVk', expiresAt: clock.now + 7 * DAY, notesOn: false })
    clock.now += 7 * DAY
    expect((await request(`/v1/shares/${SLUG}`)).status).toBe(410)
  })

  it('is read-only and can’t be extended, but its owner can still stop it', async () => {
    const { createFree, request } = server()
    await createFree()
    expect((await request(`/v1/shares/${SLUG}/notes`, post({ note: 'bm90ZQ' }))).status).toBe(403)
    const patch = (body: unknown) => request(`/v1/shares/${SLUG}`, { method: 'PATCH', headers: OWNED, body: JSON.stringify(body) })
    expect((await patch({ notes: true })).status).toBe(403)
    expect((await patch({ days: 90 })).status).toBe(403)
    expect((await request(`/v1/shares/${SLUG}`, { method: 'DELETE', headers: OWNED })).status).toBe(200)
    expect((await request(`/v1/shares/${SLUG}`)).status).toBe(404)
  })

  it(`is limited to ${FREE_PER_DAY} a day from one IP address, which is kept only as a hash`, async () => {
    const { createFree, clock, quotas } = server()
    const slug = (i: number) => String(i).padStart(22, 'x')
    for (let i = 0; i < FREE_PER_DAY; i++) expect((await createFree({ slug: slug(i) })).status).toBe(201)
    expect((await createFree({ slug: slug(98) })).status).toBe(429)
    expect((await createFree({ slug: slug(98) }, '198.51.100.2')).status).toBe(201)
    expect([...quotas.keys()].join()).not.toMatch(/203\.0\.113\.7|198\.51/)
    clock.now += DAY
    expect((await createFree({ slug: slug(99) })).status).toBe(201)
  })

  // Named by a plain hash of the address, the objects could be turned back into the addresses that made them.
  it('names an address’s count by a hash keyed with the Worker’s secret, never a plain one', async () => {
    const one = server()
    const other = server({ secret: 'another-secret' })
    await one.createFree({}, '203.0.113.7')
    await other.createFree({}, '203.0.113.7')
    const named = (quotas: Map<string, unknown>) => [...quotas.keys()].filter((key) => key !== EVERYONE)
    expect(named(one.quotas)).toHaveLength(2)
    expect(named(one.quotas)).not.toContain(await sha256('203.0.113.7'))
    expect(named(one.quotas).every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true)
    expect(named(one.quotas).some((key) => named(other.quotas).includes(key))).toBe(false)
  })

  // Rotating through the addresses of one /64, which one connection usually
  // has to itself, gave as many links as there were addresses: 50 of 50.
  it('counts an IPv6 network as one address, by its /64', async () => {
    const { createFree } = server()
    const slug = (i: number) => String(i).padStart(22, 'v')
    for (let i = 0; i < FREE_PER_DAY; i++) expect((await createFree({ slug: slug(i) }, `2001:db8:1:2::${i + 1}`)).status).toBe(201)
    expect((await createFree({ slug: slug(98) }, '2001:0DB8:0001:0002:ffff::9')).status).toBe(429)
    expect((await createFree({ slug: slug(99) }, '2001:db8:1:3::1')).status).toBe(201)
    expect(networkOf('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(networkOf('198.51.100.2')).toBe('198.51.100.2')
  })

  // Counted only by /64, one /48 (a tunnel broker hands them out free) made
  // 2,000 in a day from 400 of its /64s, and turned free links off for everyone.
  it(`is limited to ${FREE_PER_DAY_WIDE} a day from one wider network, an IPv6 /48 or an IPv4 /24`, async () => {
    const { createFree } = server()
    let made = 0
    for (let net = 0; net < 20; net++) {
      for (let i = 0; i < FREE_PER_DAY; i++) {
        const created = await createFree({ slug: `${net}-${i}`.padStart(22, 'x') }, `2001:db8:1:${net.toString(16)}::${i + 1}`)
        if (created.status === 201) made++
      }
    }
    expect(made).toBe(FREE_PER_DAY_WIDE)
    expect((await createFree({ slug: 'v4'.padStart(22, 'x') }, '198.51.100.9')).status).toBe(201)
    expect(networkOf('2001:db8:1:2::1', true)).toBe('2001:db8:1::/48')
    expect(networkOf('198.51.100.9', true)).toBe('198.51.100.0/24')
  })

  it(`stops at ${FREE_PER_DAY_EVERYONE} new free links a day from everyone together`, async () => {
    const { createFree, deps, clock } = server()
    for (let i = 0; i < FREE_PER_DAY_EVERYONE; i++) await deps.quota(EVERYONE).spend(FREE_PER_DAY_EVERYONE, 'full')
    const refused = await createFree({}, '192.0.2.44')
    expect(refused).toMatchObject({ status: 429, body: { error: 'Too many free links have been made today. Try again tomorrow, or share with Nib Plus.' } })
    clock.now += DAY
    expect((await createFree({}, '192.0.2.44')).status).toBe(201)
  })

  it('keeps a day’s count no later than midnight UTC', async () => {
    expect(endOfDay(Date.UTC(2027, 0, 1, 23, 59))).toBe(Date.UTC(2027, 0, 2))
    expect(endOfDay(Date.UTC(2027, 0, 2))).toBe(Date.UTC(2027, 0, 3))
    const sql = sqlite()
    const quota = new FreeQuota(sql)
    for (let i = 0; i < FREE_PER_DAY; i++) quota.spend(Date.UTC(2027, 0, 1), FREE_PER_DAY, 'Too many')
    expect(() => quota.spend(Date.UTC(2027, 0, 1), FREE_PER_DAY, 'Too many')).toThrow(/Too many/)
    // Everything in the object deleted at the end of the day (QuotaObject's alarm), the same one counts afresh.
    sql.run('DROP TABLE days')
    quota.refund(Date.UTC(2027, 0, 1))
    expect(() => quota.spend(Date.UTC(2027, 0, 1), FREE_PER_DAY, 'Too many')).not.toThrow()
  })

  // A free link sure to be refused (its slug taken, or asked to be read once) was counted against all three
  // quotas, the one everyone shares among them, and given back each time: a network's five a day never ran out,
  // and nothing stopped its attempts reaching that one object (the server audit of 2026-11-23).
  it('keeps a place spent when the share is refused, so a network’s attempts end with its day’s places', async () => {
    const { createFree, everyone } = server()
    expect((await createFree()).status).toBe(201)
    const statuses = []
    for (let i = 0; i < 2 * FREE_PER_DAY; i++) statuses.push((await createFree()).status) // that slug is taken
    expect(statuses).toEqual([...Array(FREE_PER_DAY - 1).fill(409), ...Array(FREE_PER_DAY + 1).fill(429)])
    // Refused by its own network's count, it reaches the one everyone shares no more.
    expect(everyone.spends).toBe(FREE_PER_DAY)
    expect((await createFree({ slug: 'T'.repeat(22) })).status).toBe(429)
  })

  // Refused by a wider count, the network's own place was given back each time: its few a day never ran out, and
  // every attempt went on reaching the count everyone shares (found checking the fix, 2026-11-23).
  it('keeps a network’s place spent when a wider count refuses it, so its attempts end there too', async () => {
    const { createFree, deps, everyone } = server()
    for (let i = 0; i < FREE_PER_DAY_EVERYONE; i++) await deps.quota(EVERYONE).spend(FREE_PER_DAY_EVERYONE, 'full')
    everyone.spends = 0
    const statuses = []
    for (let i = 0; i < 3 * FREE_PER_DAY; i++) statuses.push((await createFree({ slug: String(i).padStart(22, 'w') }, '192.0.2.44')).status)
    expect(statuses).toEqual(Array(3 * FREE_PER_DAY).fill(429))
    expect(everyone.spends).toBe(FREE_PER_DAY)
  })

  it('refuses one asked to be read once before it’s counted against anyone', async () => {
    const { createFree, everyone, quotas } = server()
    for (let i = 0; i < 3 * FREE_PER_DAY; i++) expect((await createFree({ slug: String(i).padStart(22, 'r'), once: true })).status).toBe(403)
    expect(everyone.spends).toBe(0)
    expect(quotas.size).toBe(0)
    expect((await createFree()).status).toBe(201)
  })

  it('gives the day’s place back when the share couldn’t be made at all', async () => {
    const { createFree, deps } = server()
    const real = deps.share
    deps.share = (slug) => ({ ...real(slug), create: async () => ({ status: 503, body: { error: 'Away.' } }) })
    for (let i = 0; i < 2 * FREE_PER_DAY; i++) expect((await createFree({ slug: String(i).padStart(22, 'u') })).status).toBe(503)
    deps.share = real
    expect((await createFree()).status).toBe(201)
  })

  it('stops with the kill switch, and can be taken down by slug', async () => {
    const off = server()
    off.deps.off = true
    expect((await off.createFree()).status).toBe(503)
    const bySlug = server({ blocked: [SLUG] })
    await bySlug.createFree()
    expect((await bySlug.request(`/v1/shares/${SLUG}`)).status).toBe(410)
  })
})

describe('reading a share', () => {
  it('needs no credentials, and gives back only ciphertext', async () => {
    const { create, request } = server()
    await create()
    const read = await request(`/v1/shares/${SLUG}`)
    expect(read.status).toBe(200)
    expect(read.body.doc).toBe('c2VhbGVk')
  })

  it('stops once the subscription has lapsed past the grace period, and starts again on renewal', async () => {
    const { create, request, clock, paidUntil } = server()
    await create({ jws: paidUntil(clock.now + DAY) })
    clock.now += DAY + GRACE_MS
    expect((await request(`/v1/shares/${SLUG}`)).status).toBe(410)
    // Any device with the renewed receipt reports it once, for every share.
    expect((await request('/v1/shares/entitlement', post({ jws: paidUntil(clock.now + 30 * DAY) }))).status).toBe(200)
    expect((await request(`/v1/shares/${SLUG}`)).status).toBe(200)
  })

  it('serves the reader page with its locked-down headers, whatever the share', async () => {
    const { request } = server()
    const page = await request(`/d/${SLUG}`)
    expect(page.status).toBe(200)
    expect(page.body).toContain('<script type="module" src="/reader.js"></script>')
    for (const [name, value] of Object.entries(READER_HEADERS)) expect(page.headers.get(name)).toBe(value)
    expect(page.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect(page.headers.get('Content-Security-Policy')).toContain("img-src data:")
  })
})

describe('a slug never shared', () => {
  // Each one asked of used to make a Durable Object with tables, kept for good.
  it('stores nothing, read or noted on, and has no note counted against anyone', async () => {
    const sql = sqlite()
    const share = new Share(sql)
    const requests = shareRequests(share, { subscriber: () => ({}) as SubscriberRequests, alarm: async () => {} }, () => 0)
    expect((await requests.read([])).status).toBe(404)
    expect((await requests.takesNotes([])).status).toBe(404)
    expect((await requests.addNote('bm90ZQ', [])).status).toBe(404)
    expect((await requests.notes(OWNER)).status).toBe(404)
    expect((await requests.revoke(OWNER)).status).toBe(404)
    expect(sql.all('SELECT name FROM sqlite_master')).toEqual([])
    const { request, quotas } = server()
    expect((await request(`/v1/shares/${'R'.repeat(22)}`)).status).toBe(404)
    expect((await request(`/v1/shares/${'R'.repeat(22)}/notes`, post({ note: 'bm90ZQ' }, { 'CF-Connecting-IP': '203.0.113.7' }))).status).toBe(404)
    expect(quotas.size).toBe(0)
  })

  it('counts no note against anyone on a draft that takes none', async () => {
    const { create, request, quotas } = server()
    await create()
    await request(`/v1/shares/${SLUG}`, { method: 'PATCH', headers: OWNED, body: JSON.stringify({ notes: false }) })
    expect((await request(`/v1/shares/${SLUG}/notes`, post({ note: 'bm90ZQ' }, { 'CF-Connecting-IP': '203.0.113.7' }))).status).toBe(403)
    expect(quotas.size).toBe(0)
  })
})

// Security finding 3 of the 8 November audit: every route read 4 MB, and held it four times over, before asking anything.
describe('a body is read only as far as its route needs', () => {
  /** A body that says whether it was ever asked for, and how much a note of `size` would take. */
  function watched(size: number) {
    let read = false
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          read = true
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ note: 'a'.repeat(size) })))
          controller.close()
        },
      },
      { highWaterMark: 0 },
    )
    return { init: { method: 'POST', body, duplex: 'half' } as RequestInit, read: () => read }
  }

  it('asks whether a draft is there before reading a note for it', async () => {
    const { request } = server()
    const { init, read } = watched(3_900_000)
    expect((await request(`/v1/shares/${'N'.repeat(22)}/notes`, init)).status).toBe(404)
    expect(read()).toBe(false)
  })

  it('takes the longest note there can be, and no more than a note can take', async () => {
    const { create, request } = server()
    await create()
    expect((await request(`/v1/shares/${SLUG}/notes`, post({ note: 'a'.repeat(MAX_NOTE_LENGTH) }))).status).toBe(201)
    expect((await request(`/v1/shares/${SLUG}/notes`, post({ note: 'a'.repeat(4_000) }))).status).toBe(413)
    // One over, said at the door, before it's counted against the reader.
    expect(await request(`/v1/shares/${SLUG}/notes`, post({ note: 'a'.repeat(MAX_NOTE_LENGTH + 1) }))).toMatchObject({ status: 400, body: { error: 'That note is too long.' } })
  })

  it('reads a renewal only as far as a receipt goes', async () => {
    const { request, paidUntil, clock } = server()
    expect((await request('/v1/shares/entitlement', post({ jws: paidUntil(clock.now + DAY) }))).status).toBe(200)
    expect((await request('/v1/shares/entitlement', post({ jws: 'a'.repeat(64_000) }))).status).toBe(413)
  })

  it('reads a change to a share only as far as a change goes', async () => {
    const { create, request } = server()
    await create()
    const patch = (body: unknown) => request(`/v1/shares/${SLUG}`, { method: 'PATCH', headers: OWNED, body: JSON.stringify(body) })
    expect((await patch({ days: 90, notes: true })).status).toBe(200)
    expect((await patch({ days: 90, padding: 'a'.repeat(256) })).status).toBe(413)
  })

  it('still reads a whole sealed document where a share is made', async () => {
    const { create } = server()
    expect((await create({ doc: 'a'.repeat(3_900_000) })).status).toBe(201)
  })
})

describe('notes', () => {
  it('are left by readers and read only by the owner', async () => {
    const { create, request } = server()
    await create()
    expect((await request(`/v1/shares/${SLUG}/notes`, post({ note: 'bm90ZQ' }))).status).toBe(201)
    expect((await request(`/v1/shares/${SLUG}/notes`)).status).toBe(401)
    expect((await request(`/v1/shares/${SLUG}/notes`, { headers: { Authorization: `Owner ${'X'.repeat(43)}` } })).status).toBe(403)
    const notes = await request(`/v1/shares/${SLUG}/notes`, { headers: OWNED })
    expect(notes.body.notes.map((note: { note: string }) => note.note)).toEqual(['bm90ZQ'])
  })

  // Security finding 4 of the 8 November audit: a page's visitors each spent a note's place, from a network of their own.
  it('can’t be left from a page on another site, which can only post text/plain unasked', async () => {
    const { create, request } = server()
    await create()
    const leave = (type: string) => request(`/v1/shares/${SLUG}/notes`, post({ note: 'bm90ZQ' }, { 'Content-Type': type, Origin: 'https://evil.example' }))
    expect((await leave('text/plain')).status).toBe(415)
    expect((await leave('text/plain; application/json')).status).toBe(415)
    expect((await request(`/v1/shares/${SLUG}/notes`, { headers: OWNED })).body.notes).toEqual([])
    expect((await leave('application/json')).status).toBe(201)
  })

  // Anyone with the link could fill a draft's 200 places with junk.
  it(`are limited to ${NOTES_PER_READER_PER_DAY} a day from one network on one draft`, async () => {
    const { create, request, clock } = server()
    await create()
    const leave = (ip: string) => request(`/v1/shares/${SLUG}/notes`, post({ note: 'bm90ZQ' }, { 'CF-Connecting-IP': ip }))
    for (let i = 0; i < NOTES_PER_READER_PER_DAY; i++) {
      if (i && i % NOTES_PER_MINUTE === 0) clock.now += 60_000
      expect((await leave(`2001:db8:5:6::${i + 1}`)).status).toBe(201)
    }
    clock.now += 60_000
    expect((await leave('2001:db8:5:6::99'))).toMatchObject({ status: 429, body: { error: 'You’ve left all the notes you can on this draft today. Try again tomorrow.' } })
    expect((await leave('198.51.100.9')).status).toBe(201)
    clock.now += DAY
    expect((await leave('2001:db8:5:6::99')).status).toBe(201)
  })

  // Ten /64s from one /48 filled all 200 places in under half an hour.
  it(`are limited to ${NOTES_PER_WIDE_PER_DAY} a day from one wider network on one draft`, async () => {
    const { create, request, clock } = server()
    await create()
    let added = 0
    for (let net = 0; net < 10; net++) {
      for (let i = 0; i < NOTES_PER_READER_PER_DAY; i++) {
        clock.now += 91_000 // under ten a minute, and forty an hour
        const left = await request(`/v1/shares/${SLUG}/notes`, post({ note: 'bm90ZQ' }, { 'CF-Connecting-IP': `2001:db8:5:${net}::${i + 1}` }))
        if (left.status === 201) added++
      }
    }
    expect(added).toBe(NOTES_PER_WIDE_PER_DAY)
  })

  it('can be deleted, or turned off, by the owner', async () => {
    const { create, request } = server()
    await create()
    const { body } = await request(`/v1/shares/${SLUG}/notes`, post({ note: 'bm90ZQ' }))
    await request(`/v1/shares/${SLUG}/notes/${body.id}`, { method: 'DELETE', headers: OWNED })
    await request(`/v1/shares/${SLUG}`, { method: 'PATCH', headers: OWNED, body: JSON.stringify({ notes: false }) })
    expect((await request(`/v1/shares/${SLUG}/notes`, post({ note: 'YWdhaW4' }))).status).toBe(403)
    expect((await request(`/v1/shares/${SLUG}/notes`, { headers: OWNED })).body).toMatchObject({ notes: [], notesOn: false })
  })
})

describe('the owner', () => {
  it('extends from now, and revokes', async () => {
    const { create, request, clock, alarms } = server()
    await create({ days: 7 })
    const extended = await request(`/v1/shares/${SLUG}`, { method: 'PATCH', headers: OWNED, body: JSON.stringify({ days: 90 }) })
    expect(extended.body).toEqual({ expiresAt: clock.now + 90 * DAY })
    expect(alarms.get(SLUG)).toBe(clock.now + 90 * DAY)
    expect((await request(`/v1/shares/${SLUG}`, { method: 'DELETE', headers: OWNED })).status).toBe(200)
    expect(alarms.get(SLUG)).toBeNull()
    expect((await request(`/v1/shares/${SLUG}`)).status).toBe(404)
  })
})

describe('the kill switches', () => {
  it('turn every share off, while owners can still revoke', async () => {
    const { create, request, deps } = server()
    await create()
    deps.off = true
    expect((await create({ slug: 'T'.repeat(22) })).status).toBe(503)
    expect((await request(`/v1/shares/${SLUG}`)).status).toBe(503)
    expect((await request(`/v1/shares/${SLUG}/notes`, post({ note: 'bm90ZQ' }))).status).toBe(503)
    expect((await request(`/v1/shares/${SLUG}`, { method: 'DELETE', headers: OWNED })).status).toBe(200)
    deps.off = false
    expect((await request(`/v1/shares/${SLUG}`)).status).toBe(404)
  })

  it('take down one share by slug, or every share of one subscription', async () => {
    const bySlug = server({ blocked: [SLUG] })
    await bySlug.create()
    expect((await bySlug.request(`/v1/shares/${SLUG}`)).status).toBe(410)
    expect((await bySlug.request(`/v1/shares/${SLUG}/notes`, post({ note: 'bm90ZQ' }))).status).toBe(410)

    const subscription = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('subscription-1'))
    const key = [...new Uint8Array(subscription)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const bySubscriber = server({ blocked: [key] })
    expect((await bySubscriber.create()).status).toBe(403)
  })
})

describe('the library', () => {
  it('is untouched: share routes don’t answer for it, nor it for them', async () => {
    const { request } = server()
    const library = await handleSync(new Request('https://nib.test/v1/status'), {
      library: () => ({}) as LibraryRequests,
      files: memoryFiles(),
      subscriber: () => ({}) as SubscriberRequests,
      verify: async () => ({}) as Claims,
    })
    expect(library.status).toBe(401) // no sync credentials
    expect(await (await frontDoor(new Request('https://nib.test/v1/status'), { sync: async () => new Response('sync') } as unknown as Routes)).text()).toBe('sync')
    expect((await request('/v1/shares/nonsense')).status).toBe(404)
  })
})

describe('a share to be read once, over the wire', () => {
  it('is made with Nib Plus, shown to be there without its text, and handed over to one reveal', async () => {
    const { create, request } = server()
    expect((await create({ once: true })).status).toBe(201)
    const asked = await request(`/v1/shares/${SLUG}`)
    expect(asked.status).toBe(200)
    expect(asked.body).toMatchObject({ once: true })
    expect(asked.body.doc).toBeUndefined()

    const revealed = await request(`/v1/shares/${SLUG}/reveal`, { method: 'POST' })
    expect(revealed.status).toBe(200)
    expect(revealed.body.doc).toBe('c2VhbGVk')
    expect((await request(`/v1/shares/${SLUG}/reveal`, { method: 'POST' })).status).toBe(410)
    expect((await request(`/v1/shares/${SLUG}`)).status).toBe(410)
  })

  // The security review of 2026-11-13: the slug alone was enough to use one up.
  it('is handed over only to a reader who shows the token from the link’s key', async () => {
    const { create, request } = server()
    const token = 'T'.repeat(43)
    expect((await create({ once: true, reveal: await sha256(token) })).status).toBe(201)
    const reveal = (body?: unknown) => request(`/v1/shares/${SLUG}/reveal`, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    expect((await reveal()).status).toBe(404)
    expect((await reveal({ token: 'U'.repeat(43) })).status).toBe(404)
    expect((await reveal({ token: 'not one' })).status).toBe(404)
    expect((await request(`/v1/shares/${SLUG}`)).body).toMatchObject({ once: true })
    const revealed = await reveal({ token })
    expect([revealed.status, revealed.body.doc]).toEqual([200, 'c2VhbGVk'])
  })

  // Its answer lost on the way, the draft was gone unread (the server audit of 2026-11-23).
  it('is handed to the same reader again for ten minutes, then deleted by its alarm, and never to another', async () => {
    const { create, request, clock, alarms, expire, shareOf } = server()
    const token = 'T'.repeat(43)
    await create({ once: true, reveal: await sha256(token) })
    const expires = clock.now + 30 * DAY
    const reveal = (body?: unknown) => request(`/v1/shares/${SLUG}/reveal`, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    expect((await reveal({ token })).status).toBe(200)
    expect(alarms.get(SLUG)).toBe(clock.now + REVEALED_KEPT_MS)
    // The reader's page asked again, and its "try again": still there.
    expect((await request(`/v1/shares/${SLUG}`)).body).toMatchObject({ once: true })
    clock.now += REVEALED_KEPT_MS - 1
    expect((await reveal({ token })).body.doc).toBe('c2VhbGVk')
    // Another token, or none, is answered as before it was read (worker/share `reveal`).
    expect((await reveal({ token: 'U'.repeat(43) })).status).toBe(404)
    expect((await reveal()).status).toBe(404)
    // Extended meanwhile, the alarm is still for the text first.
    await request(`/v1/shares/${SLUG}`, { method: 'PATCH', headers: OWNED, body: JSON.stringify({ days: 90 }) })
    expect(alarms.get(SLUG)).toBeLessThan(expires)
    clock.now += 1
    await expire()
    expect(shareOf(SLUG).revealedDue()).toBeNull()
    expect(alarms.get(SLUG)).toBe(clock.now - REVEALED_KEPT_MS + 90 * DAY + REVEALED_KEPT_MS - 1)
    expect((await reveal({ token })).status).toBe(410)
    expect((await request(`/v1/shares/${SLUG}`)).status).toBe(410)
    expect((await request(`/v1/shares/${SLUG}/notes`, { headers: OWNED })).body).toMatchObject({ once: true, opened: true })
  })

  // The route asks `read` first, which refused it once the hold was over, so the step that deletes the text was
  // never reached: its alarm lost, the text stayed till the share expired (found checking the fix, 2026-11-23).
  it('has its text deleted when it’s next asked for, though its alarm never came', async () => {
    for (const ask of ['page', 'reveal']) {
      const { create, request, clock, shareOf } = server()
      const token = 'T'.repeat(43)
      await create({ once: true, reveal: await sha256(token) })
      expect((await request(`/v1/shares/${SLUG}/reveal`, { method: 'POST', body: JSON.stringify({ token }) })).status).toBe(200)
      clock.now += REVEALED_KEPT_MS + 60_000
      const asked = ask === 'page' ? await request(`/v1/shares/${SLUG}`) : await request(`/v1/shares/${SLUG}/reveal`, { method: 'POST', body: JSON.stringify({ token }) })
      expect(asked.status).toBe(410)
      expect(shareOf(SLUG).revealedDue()).toBeNull()
    }
  })

  // A wrong token was answered as fast as it was asked, uncounted: the password of one could be guessed against
  // the server at its own speed, by anyone the link had reached (the server audit of 2026-11-23).
  it('counts the tries at one that asks for a token, per network, and gives a right one back', async () => {
    const { create, request, quotas, clock } = server()
    const token = 'T'.repeat(43)
    await create({ once: true, reveal: await sha256(token) })
    const reveal = (given: string, ip = '203.0.113.7') => request(`/v1/shares/${SLUG}/reveal`, { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: JSON.stringify({ token: given }) })
    const statuses = []
    for (let i = 0; i < REVEALS_PER_NETWORK_PER_DAY + 5; i++) statuses.push((await reveal('U'.repeat(43))).status)
    expect(statuses).toEqual([...Array(REVEALS_PER_NETWORK_PER_DAY).fill(404), ...Array(5).fill(429)])
    // Even the right one, from there, till tomorrow.
    expect((await reveal(token)).status).toBe(429)
    // From the next address in that wider network, the rest of what it gets, and no more.
    const wider = []
    for (let i = 0; i < REVEALS_PER_WIDE_PER_DAY; i++) wider.push((await reveal('U'.repeat(43), `203.0.113.${8 + (i % 200)}`)).status)
    expect(wider.filter((one) => one === 404)).toHaveLength(REVEALS_PER_WIDE_PER_DAY - REVEALS_PER_NETWORK_PER_DAY)
    expect(wider.at(-1)).toBe(429)
    // The reader, elsewhere, opens it, and is counted for nothing.
    const used = () => [...quotas.values()].reduce((sum, quota) => sum + quota.used(clock.now), 0)
    const before = used()
    expect((await reveal(token, '198.51.100.20')).status).toBe(200)
    expect(used()).toBe(before)
  })

  it('counts nothing against anyone for a slug that isn’t a draft to be read once, or asks for no token', async () => {
    const { create, request, quotas } = server()
    const reveal = (slug: string) => request(`/v1/shares/${slug}/reveal`, { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.7' }, body: JSON.stringify({ token: 'U'.repeat(43) }) })
    expect((await reveal('N'.repeat(22))).status).toBe(404)
    await create()
    expect((await reveal(SLUG)).status).toBe(404)
    await create({ slug: 'P'.repeat(22), once: true })
    expect((await reveal('P'.repeat(22))).status).toBe(200)
    expect(quotas.size).toBe(0)
  })

  it('takes a reveal hash only with `once`, and only as a hash', async () => {
    const { create } = server()
    expect((await create({ reveal: 'a'.repeat(64) })).status).toBe(400)
    expect((await create({ once: true, reveal: 'short' })).status).toBe(400)
  })

  it('tells its owner, and only its owner, that it has been read', async () => {
    const { create, request } = server()
    await create({ once: true })
    expect((await request(`/v1/shares/${SLUG}/notes`, { headers: OWNED })).body).toMatchObject({ once: true, opened: false })
    await request(`/v1/shares/${SLUG}/reveal`, { method: 'POST' })
    expect((await request(`/v1/shares/${SLUG}/notes`, { headers: OWNED })).body).toMatchObject({ once: true, opened: true })
    expect((await request(`/v1/shares/${SLUG}/notes`)).status).toBe(401)
  })

  it('can’t be a free share, and `once` has to be yes or no', async () => {
    const { create, createFree, request } = server()
    expect((await createFree({ once: true })).status).toBe(403)
    expect((await request(`/v1/shares/${SLUG}`)).status).toBe(404)
    expect((await create({ once: 'yes' })).status).toBe(400)
  })

  it('reveals nothing of a share that isn’t one, nor with the kill switch on, nor one taken down', async () => {
    const plain = server()
    await plain.create()
    expect((await plain.request(`/v1/shares/${SLUG}/reveal`, { method: 'POST' })).status).toBe(404)
    expect((await plain.request(`/v1/shares/${SLUG}`)).body.doc).toBe('c2VhbGVk')

    const off = server({ off: true })
    await off.create({ once: true })
    expect((await off.request(`/v1/shares/${SLUG}/reveal`, { method: 'POST' })).status).toBe(503)

    const blocked = server({ blocked: [SLUG] })
    await blocked.create({ once: true })
    expect((await blocked.request(`/v1/shares/${SLUG}/reveal`, { method: 'POST' })).status).toBe(410)
  })

  it('answers a reveal by GET, or of a slug never shared, with nothing', async () => {
    const { create, request } = server()
    await create({ once: true })
    expect((await request(`/v1/shares/${SLUG}/reveal`)).status).toBe(404)
    expect((await request(`/v1/shares/${'T'.repeat(22)}/reveal`, { method: 'POST' })).status).toBe(404)
    // And it's still there to be read.
    expect((await request(`/v1/shares/${SLUG}/reveal`, { method: 'POST' })).body.doc).toBe('c2VhbGVk')
  })
})

describe('how many times a share has been opened, over the wire', () => {
  const opens = async (request: ReturnType<typeof server>['request']) => (await request(`/v1/shares/${SLUG}/notes`, { headers: OWNED })).body.opens

  const from = (ip: string, headers: Record<string, string> = {}) => ({ headers: { 'CF-Connecting-IP': ip, ...headers } })

  it('counts each reader’s asking, tells the reader it’s counted, and tells only the owner how many', async () => {
    const { create, request } = server()
    await create()
    expect(await opens(request)).toBe(0)
    expect((await request(`/v1/shares/${SLUG}`, from('198.51.100.1'))).body).toMatchObject({ doc: 'c2VhbGVk', counted: true })
    await request(`/v1/shares/${SLUG}`, from('198.51.100.2'))
    expect(await opens(request)).toBe(2)
    // A reader is never told the number.
    expect('opens' in (await request(`/v1/shares/${SLUG}`, from('198.51.100.3'))).body).toBe(false)
  })

  // The security review of 2026-11-13: anyone with the link could add to the number, a write each time.
  it('counts a network once a day, however often it asks, and again the next day', async () => {
    const { create, request, clock } = server()
    await create()
    for (let n = 0; n < 5; n++) expect((await request(`/v1/shares/${SLUG}`, from('198.51.100.1'))).status).toBe(200)
    expect(await opens(request)).toBe(1)
    clock.now += DAY
    await request(`/v1/shares/${SLUG}`, from('198.51.100.1'))
    expect(await opens(request)).toBe(2)
  })

  it('doesn’t count the app asking with its owner’s token, nor anything asked while sharing is off or of one taken down', async () => {
    const { create, request } = server()
    await create()
    expect((await request(`/v1/shares/${SLUG}`, from('198.51.100.1', OWNED))).body.doc).toBe('c2VhbGVk')
    expect(await opens(request)).toBe(0)
    // Another share's token counts as any reader does.
    await request(`/v1/shares/${SLUG}`, from('198.51.100.2', { Authorization: `Owner ${'X'.repeat(43)}` }))
    expect(await opens(request)).toBe(1)

    const blocked = server({ blocked: [SLUG] })
    await blocked.create()
    expect((await blocked.request(`/v1/shares/${SLUG}`)).status).toBe(410)
    expect(await opens(blocked.request)).toBe(0)
  })

  // Each network was counted once, and one wider network holds 65,536 of them: anyone with the link and a /48 could
  // make the number mean nothing. And any website could add one for each of its visitors, by having their browsers
  // ask for the draft's address (the server audit of 2026-11-23).
  it('counts a wider network only a few times a day, however many networks in it ask', async () => {
    const { create, request } = server()
    await create()
    for (let n = 0; n < 300; n++) expect((await request(`/v1/shares/${SLUG}`, from(`2001:db8:1:${n.toString(16)}::1`))).status).toBe(200)
    expect(await opens(request)).toBe(OPENS_PER_WIDE_PER_DAY)
    // Another wider network's readers are still counted.
    await request(`/v1/shares/${SLUG}`, from('2001:db8:2:1::1'))
    expect(await opens(request)).toBe(OPENS_PER_WIDE_PER_DAY + 1)
  })

  it('counts the reader page’s own asking, and not another site’s page having its visitors’ browsers ask', async () => {
    const { create, request } = server()
    await create()
    await request(`/v1/shares/${SLUG}`, from('198.51.100.1', { 'Sec-Fetch-Site': 'cross-site' }))
    await request(`/v1/shares/${SLUG}`, from('198.51.100.2', { 'Sec-Fetch-Site': 'same-site' }))
    await request(`/v1/shares/${SLUG}`, from('198.51.100.3', { 'Sec-Fetch-Site': 'none' }))
    expect(await opens(request)).toBe(0)
    await request(`/v1/shares/${SLUG}`, from('198.51.100.1', { 'Sec-Fetch-Site': 'same-origin' }))
    // A browser from before that was said says nothing, and is counted.
    await request(`/v1/shares/${SLUG}`, from('198.51.100.2'))
    expect(await opens(request)).toBe(2)
  })

  it('counts nothing of a free share, and says nothing of counting to its reader', async () => {
    const { createFree, request } = server()
    expect((await createFree()).status).toBe(201)
    const read = await request(`/v1/shares/${SLUG}`)
    expect(read.body.doc).toBe('c2VhbGVk')
    expect('counted' in read.body).toBe(false)
    expect('opens' in (await request(`/v1/shares/${SLUG}/notes`, { headers: OWNED })).body).toBe(false)
  })
})

// Revoking a share frees its place at once, so making one and revoking it could be done for ever, each leaving a
// mark of itself for good (the server audit of 2026-11-23).
describe('how many shares one subscription makes in a day', () => {
  it('is bounded, however many are revoked, and starts again the next day', async () => {
    const { create, request, clock } = server()
    const slugOf = (n: number) => String(n).padStart(22, 'd')
    const made = []
    for (let n = 0; n < NEW_SHARES_PER_DAY + 3; n++) {
      const created = await create({ slug: slugOf(n) })
      made.push(created.status)
      if (created.status === 201) expect((await request(`/v1/shares/${slugOf(n)}`, { method: 'DELETE', headers: OWNED })).status).toBe(200)
    }
    expect(made).toEqual([...Array(NEW_SHARES_PER_DAY).fill(201), 429, 429, 429])
    clock.now += DAY
    expect((await create({ slug: slugOf(9999) })).status).toBe(201)
  })

  it('doesn’t count one posted again, which keeps its place', async () => {
    const { create } = server()
    expect((await create()).status).toBe(201)
    for (let n = 0; n < NEW_SHARES_PER_DAY + 3; n++) expect((await create()).status).toBe(409)
    expect((await create({ slug: 'T'.repeat(22) })).status).toBe(201)
  })
})
