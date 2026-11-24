import { describe, expect, it } from 'vitest'
import { CLAIM_AGAIN_MS, CoinCodes, coinRequests, handleCoins, USES_PER_NETWORK, USES_PER_WIDE, type CoinDeps } from './coins'
import { frontDoor, type Routes } from './door'
import { COINS_PUBLIC_KEY } from './signing'
import { MAX_COINS } from './wire.mjs'
import { sqlite } from './testing'

const CODE = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const ADMIN = { Authorization: 'Bearer the-secret' }
const NETS: [string, string] = ['here', 'wide']

/** A pair's public half as the Worker is told it: the raw key, in base64url. */
const publicHalf = async (pair: CryptoKeyPair) => Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url')

/** handleCoins(), wired to a real CoinCodes in memory, as index.ts wires the Durable Object; the clock is the test's. */
/** `local`: as under wrangler dev, where coins may go unsigned; by default that's so when no key to sign with is given. */
/** `checkedWith`: the public half the key to sign with must be the pair of; the app's own if none is given. */
function server(admin: string | undefined = 'the-secret', signingKey?: string, local = signingKey === undefined, checkedWith?: string) {
  const clock = { now: Date.UTC(2026, 10, 10, 12) }
  const codes = new CoinCodes(sqlite())
  const ask = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    handleCoins(new Request(`https://sync.nibprivacy.com${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), {
      coins: coinRequests(codes, { alarm: async () => {} }, () => clock.now),
      admin,
      signingKey,
      checkedWith,
      local,
    }).then(async (response) => ({ status: response!.status, body: await response!.json() }))
  const redeem = (claim: string, code = CODE, ip = '198.51.100.7') => ask('POST', '/v1/coins/redeem', { code, claim }, { 'CF-Connecting-IP': ip })
  return { clock, ask, redeem, codes }
}

describe('codes for coins, on the server', () => {
  // Security finding 11 of the 8 November audit: nothing stood between a flood of made-up codes and the one object that holds them all.
  describe('with a rate limit per network', () => {
    const IP = '198.51.100.7'
    function route(limiter: CoinDeps['limiter']) {
      const asked: string[] = []
      const codes = new CoinCodes(sqlite())
      codes.set(CODE, { coins: 10 })
      const real = coinRequests(codes, { alarm: async () => {} }, () => 0)
      // As under wrangler dev, with no key to sign with.
      const deps: CoinDeps = { coins: { ...real, redeem: async (code, claim, networks) => (asked.push(claim), real.redeem(code, claim, networks)) }, admin: 'the-secret', limiter, local: true }
      const redeem = (claim: string) => handleCoins(new Request('https://sync.nibprivacy.com/v1/coins/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': IP }, body: JSON.stringify({ code: CODE, claim }) }), deps)
      return { asked, redeem }
    }

    it('refuses past it, as too many, and never reaches the object', async () => {
      const { asked, redeem } = route({ limit: async () => ({ success: false }) })
      const refused = await redeem('claim-one-1')
      expect(refused.status).toBe(429)
      expect(await refused.json()).toEqual({ error: 'too many' })
      expect(asked).toEqual([])
    })

    it('asks by a keyed hash of the network, and of the wider one round it, never the address', async () => {
      const keys: string[] = []
      const { redeem } = route({ limit: async ({ key }) => (keys.push(key), { success: true }) })
      expect((await redeem('claim-one-1')).status).toBe(200)
      expect(keys).toHaveLength(2)
      expect(new Set(keys).size).toBe(2)
      for (const key of keys) expect(key).toMatch(/^[0-9a-f]{64}$/)
    })

    // Limited by the address or its /64 alone, a block of addresses had as many goes as it had addresses.
    it('refuses past the wider network’s limit too, and never reaches the object', async () => {
      const keys: string[] = []
      const { asked, redeem } = route({ limit: async ({ key }) => ({ success: keys.push(key) === 1 }) })
      expect((await redeem('claim-one-1')).status).toBe(429)
      expect(asked).toEqual([])
    })

    it('works without the binding, as in tests and wrangler dev, and when the limiter fails', async () => {
      expect((await route(undefined).redeem('claim-one-1')).status).toBe(200)
      expect((await route({ limit: async () => Promise.reject(new Error('down')) }).redeem('claim-two-2')).status).toBe(200)
    })
  })

  // Security finding 4 of the 8 November audit: a page's visitors each counted as a new network.
  it('can’t be used from a page on another site, which can only post text/plain unasked', async () => {
    const { ask, redeem } = server()
    await ask('POST', '/v1/coins/codes', { code: CODE, coins: 10, uses: 1 }, ADMIN)
    const pasted = await ask('POST', '/v1/coins/redeem', { code: CODE, claim: 'claim-one-1' }, { 'Content-Type': 'text/plain', Origin: 'https://evil.example', 'CF-Connecting-IP': '203.0.113.9' })
    expect(pasted.status).toBe(415)
    expect((await ask('GET', `/v1/coins/codes/${CODE}`, undefined, ADMIN)).body.used).toBe(0)
    expect((await redeem('claim-two-2')).status).toBe(200)
    expect((await ask('POST', '/v1/coins/redeem', { code: CODE, claim: 'claim-three' }, { 'Content-Type': 'application/json; charset=utf-8' })).status).toBe(409)
  })

  it('give their coins for as many uses as they have, each claim counted once', async () => {
    const { ask, redeem } = server()
    expect((await ask('POST', '/v1/coins/codes', { code: CODE, coins: 500, uses: 2 }, ADMIN)).body).toEqual({ coins: 500, uses: 2, used: 0, until: null, ended: false })
    expect(await redeem('claim-one-1')).toEqual({ status: 200, body: { coins: 500 } })
    // The same claim again, as after the app lost the answer: the same coins, not another use.
    expect(await redeem('claim-one-1')).toEqual({ status: 200, body: { coins: 500 } })
    expect(await redeem('claim-two-2')).toEqual({ status: 200, body: { coins: 500 } })
    expect(await redeem('claim-three')).toEqual({ status: 409, body: { error: 'used up' } })
    expect((await ask('GET', `/v1/coins/codes/${CODE}`, undefined, ADMIN)).body).toMatchObject({ uses: 2, used: 2 })
    // Given more uses, it opens again, its uses so far still counted.
    await ask('POST', '/v1/coins/codes', { code: CODE, coins: 500, uses: 3 }, ADMIN)
    expect(await redeem('claim-three')).toEqual({ status: 200, body: { coins: 500 } })
  })

  // Any 200 with coins was believed, so a proxy on the phone turned any string into coins.
  it('sign the coins they give, for the fingerprint and the claim, so the app believes only coins from here', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const { ask, redeem } = server('the-secret', Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64'), false, await publicHalf(pair))
    await ask('POST', '/v1/coins/codes', { code: CODE, coins: 500 }, ADMIN)
    const { status, body } = await redeem('claim-one-1')
    expect(status).toBe(200)
    expect(body.coins).toBe(500)
    expect(body.sig).toMatch(/^[A-Za-z0-9_-]{86}$/)
    const checks = (message: string) => crypto.subtle.verify({ name: 'Ed25519' }, pair.publicKey, Buffer.from(body.sig, 'base64url'), new TextEncoder().encode(message))
    expect(await checks(`nib-coins|${CODE}|claim-one-1|500`)).toBe(true)
    expect(await checks(`nib-coins|${CODE}|claim-one-1|5000`)).toBe(false)
    expect(await checks(`nib-coins|${CODE}|claim-two-2|500`)).toBe(false)
    // Without the key set, as under wrangler dev, they go unsigned.
    expect((await server().redeem('claim-one-1')).body).not.toHaveProperty('sig')
  })

  // A claim the server knew was answered with coins for ever, even after its code was used up or ended.
  it('answer a claim again for a day, as after an answer lost on the way, and after that it’s used up', async () => {
    const { clock, ask, redeem } = server()
    await ask('POST', '/v1/coins/codes', { code: CODE, coins: 500, uses: 1 }, ADMIN)
    expect(await redeem('claim-one-1')).toEqual({ status: 200, body: { coins: 500 } })
    clock.now += CLAIM_AGAIN_MS - 1
    expect(await redeem('claim-one-1')).toEqual({ status: 200, body: { coins: 500 } })
    clock.now += 1
    expect(await redeem('claim-one-1')).toEqual({ status: 409, body: { error: 'used up' } })
  })

  it('run without a count, till their last day (UTC), or till they’re ended', async () => {
    const { clock, ask, redeem } = server()
    await ask('POST', '/v1/coins/codes', { code: CODE, coins: 10, until: '2026-11-11' }, ADMIN)
    for (let i = 0; i < 5; i++) expect((await redeem(`many-claim-${i}`)).status).toBe(200)
    clock.now = Date.UTC(2026, 10, 12, 0, 30)
    expect(await redeem('late-claim')).toEqual({ status: 410, body: { error: 'ended' } })
    await ask('POST', '/v1/coins/codes', { code: OTHER, coins: 10 }, ADMIN)
    expect((await ask('DELETE', `/v1/coins/codes/${OTHER}`, undefined, ADMIN)).body).toMatchObject({ ended: true })
    expect(await redeem('ended-claim', OTHER)).toEqual({ status: 410, body: { error: 'ended' } })
  })

  // Making a code that was there replaced it whole: adding uses dropped its last day.
  it('change only what they’re given when made again, and open again if they’d ended', async () => {
    const { ask } = server()
    const make = (body: Record<string, unknown>) => ask('POST', '/v1/coins/codes', { code: CODE, ...body }, ADMIN).then((answer) => answer.body)
    expect(await make({ coins: 500, until: '2026-11-30' })).toEqual({ coins: 500, uses: null, used: 0, until: '2026-11-30', ended: false })
    expect(await make({ coins: 500, uses: 200 })).toEqual({ coins: 500, uses: 200, used: 0, until: '2026-11-30', ended: false })
    await ask('DELETE', `/v1/coins/codes/${CODE}`, undefined, ADMIN)
    expect(await make({ coins: 600 })).toEqual({ coins: 600, uses: 200, used: 0, until: '2026-11-30', ended: false })
    // Null, and only null, takes them away.
    expect(await make({ coins: 600, until: null })).toEqual({ coins: 600, uses: 200, used: 0, until: null, ended: false })
    expect(await make({ coins: 600, uses: null })).toEqual({ coins: 600, uses: null, used: 0, until: null, ended: false })
  })

  it('give a claim answered again the coins it was given, not what the code gives now', async () => {
    const { ask, redeem } = server()
    await ask('POST', '/v1/coins/codes', { code: CODE, coins: 500 }, ADMIN)
    expect(await redeem('claim-one-1')).toEqual({ status: 200, body: { coins: 500 } })
    await ask('POST', '/v1/coins/codes', { code: CODE, coins: 50_000 }, ADMIN)
    expect(await redeem('claim-one-1')).toEqual({ status: 200, body: { coins: 500 } })
    expect(await redeem('claim-two-2')).toEqual({ status: 200, body: { coins: 50_000 } })
  })

  it('keep their uses counted on the code, read in one row however many claims there are', async () => {
    const sql = sqlite()
    // As codes were kept before: their uses counted from their claims.
    sql.run('CREATE TABLE codes (code TEXT PRIMARY KEY, coins INTEGER NOT NULL, uses INTEGER, until TEXT, ended INTEGER NOT NULL DEFAULT 0)')
    sql.run('CREATE TABLE claims (code TEXT NOT NULL, claim TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (code, claim))')
    sql.run('INSERT INTO codes (code, coins, uses) VALUES (?, 500, 3), (?, 10, NULL)', CODE, OTHER)
    for (const claim of ['claim-one-1', 'claim-two-2']) sql.run('INSERT INTO claims (code, claim, at) VALUES (?, ?, 0)', CODE, claim)
    const codes = new CoinCodes(sql)
    expect(codes.show(CODE)).toMatchObject({ uses: 3, used: 2 })
    expect(codes.show(OTHER)).toMatchObject({ uses: null, used: 0 })
    // A claim from before, kept without its coins, takes the code's.
    expect(codes.redeem(CODE, 'claim-one-1', NETS, '2026-11-10', 1)).toEqual({ coins: 500 })
    expect(codes.redeem(CODE, 'claim-three', NETS, '2026-11-10', 1)).toEqual({ coins: 500 })
    expect(codes.redeem(CODE, 'claim-three', NETS, '2026-11-10', 2)).toEqual({ coins: 500 })
    expect(codes.redeem(CODE, 'claim-four-4', NETS, '2026-11-10', 3)).toBe('used up')
    expect(codes.show(CODE)).toMatchObject({ used: 3 })
    // Opened again later, the same table is read as it is.
    expect(new CoinCodes(sql).show(CODE)).toMatchObject({ used: 3 })
    // A use reads the code's row and looks for its claim: never all of a code's claims.
    const asked: string[] = []
    const watched = { ...sql, all: (query: string, ...args: (string | number | null)[]) => (asked.push(query), sql.all(query, ...args)) }
    new CoinCodes(watched).redeem(OTHER, 'claim-five-5', NETS, '2026-11-10', 4)
    expect(asked.filter((query) => /COUNT/i.test(query))).toEqual([])
  })

  it('take so many new uses a day from one network, and from the wider one it’s in, so one person can’t use up a code given to many', async () => {
    const { clock, ask, redeem } = server()
    await ask('POST', '/v1/coins/codes', { code: CODE, coins: 100, uses: 500 }, ADMIN)
    for (let i = 0; i < USES_PER_NETWORK; i++) expect((await redeem(`one-place-${i}`)).status).toBe(200)
    expect(await redeem('one-place-more')).toEqual({ status: 429, body: { error: 'too many' } })
    // A claim already counted is still answered, and the next address over is a network of its own.
    expect(await redeem('one-place-0')).toEqual({ status: 200, body: { coins: 100 } })
    expect((await redeem('next-door-0', CODE, '198.51.100.8')).status).toBe(200)
    // Stepping through the /24, or an IPv6 /48's /64s, is counted as the wider network.
    for (let i = 1; i < USES_PER_WIDE - USES_PER_NETWORK; i++) expect((await redeem(`next-door-${i}`, CODE, `198.51.100.${8 + Math.ceil(i / 9)}`)).status).toBe(200)
    expect((await redeem('one-too-wide', CODE, '198.51.100.200')).status).toBe(429)
    expect((await redeem('another-place', CODE, '203.0.113.5')).status).toBe(200)
    for (let i = 0; i < USES_PER_NETWORK; i++) expect((await redeem(`six-four-${i}`, CODE, `2001:db8:1:2::${i + 1}`)).status).toBe(200)
    expect((await redeem('six-four-more', CODE, '2001:db8:1:2:ffff::1')).status).toBe(429)
    // A new day (UTC), they start again.
    clock.now = Date.UTC(2026, 10, 11, 0, 1)
    expect((await redeem('one-place-tomorrow')).status).toBe(200)
  })

  it('keep a network as a hash keyed with the secret, and forget it after its day', () => {
    const sql = sqlite()
    const codes = new CoinCodes(sql)
    codes.set(CODE, { coins: 10 })
    codes.redeem(CODE, 'claim-one-1', NETS, '2026-11-10', 1)
    codes.redeem(CODE, 'claim-two-2', ['there', 'wide'], '2026-11-11', 2)
    codes.forget('2026-11-11')
    expect(sql.all('SELECT network, n FROM networks ORDER BY network')).toEqual([
      { network: 'there', n: 1 },
      { network: 'wide', n: 1 },
    ])
  })

  it('never keep the address, only a hash of the network keyed with the secret', async () => {
    const asked: unknown[][] = []
    const codes = new CoinCodes(sqlite())
    codes.set(CODE, { coins: 10 })
    const real = coinRequests(codes, { alarm: async () => {} }, () => 0)
    const ask = (admin: string) =>
      handleCoins(new Request('https://sync.nibprivacy.com/v1/coins/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' }, body: JSON.stringify({ code: CODE, claim: `claim-${admin}` }) }), {
        coins: { ...real, redeem: async (code, claim, networks) => (asked.push([code, claim, networks]), real.redeem(code, claim, networks)) },
        admin,
        local: true,
      })
    await ask('one-secret')
    await ask('another-secret')
    const [first, second] = asked.map((args) => args[2] as string[])
    expect(JSON.stringify(asked)).not.toContain('198.51.100')
    expect(first.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true)
    expect(first[0]).not.toBe(second[0])
  })

  it('know nothing of a code that isn’t one, and take only a fingerprint and a claim', async () => {
    const { redeem, ask } = server()
    expect(await redeem('guess-claim')).toEqual({ status: 404, body: { error: 'unknown' } })
    expect((await ask('POST', '/v1/coins/redeem', { code: 'NIB-YPHA-9QVF', claim: 'guess-claim' })).status).toBe(400)
    expect((await ask('POST', '/v1/coins/redeem', { code: CODE, claim: 'x' })).status).toBe(400)
  })

  it('are made, read and ended only with the secret, and not at all without one set', async () => {
    const { ask } = server()
    expect((await ask('POST', '/v1/coins/codes', { code: CODE, coins: 500 })).status).toBe(404)
    expect((await ask('POST', '/v1/coins/codes', { code: CODE, coins: 500 }, { Authorization: 'Bearer wrong' })).status).toBe(404)
    expect((await ask('GET', `/v1/coins/codes/${CODE}`, undefined, { Authorization: 'Bearer wrong' })).status).toBe(404)
    expect((await ask('POST', '/v1/coins/codes', { code: CODE, coins: 0 }, ADMIN)).status).toBe(400)
    expect((await ask('POST', '/v1/coins/codes', { code: CODE, coins: 5, until: 'soon' }, ADMIN)).status).toBe(400)
    for (const until of ['2026-99-99', '2026-00-10', '2026-02-31', '2026-11-32']) expect((await ask('POST', '/v1/coins/codes', { code: CODE, coins: 5, until }, ADMIN)).status).toBe(400)
    for (const coins of [MAX_COINS + 1, 1e300]) expect((await ask('POST', '/v1/coins/codes', { code: CODE, coins }, ADMIN)).status).toBe(400)
    expect((await ask('POST', '/v1/coins/codes', { code: CODE, coins: MAX_COINS, until: '2028-02-29' }, ADMIN)).status).toBe(200)
    // The secret alone, without its Bearer, isn't it.
    expect((await ask('GET', `/v1/coins/codes/${CODE}`, undefined, { Authorization: 'the-secret' })).status).toBe(404)
    // As a Worker without COINS_ADMIN, which reads as nothing.
    const unset = server('')
    expect((await unset.ask('POST', '/v1/coins/codes', { code: CODE, coins: 500 }, ADMIN)).status).toBe(404)
  })

  it('let the app’s own origin ask', async () => {
    const response = await frontDoor(new Request('https://sync.nibprivacy.com/v1/coins/redeem', { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost' } }), {} as Routes)
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
  })

  // The use was counted first and the answer signed after: with the key to sign with malformed (pasted wrong at a
  // rotation, say) every redemption spent a use and failed, and a day on its claim was "used up", the coins never
  // given; with none set, they went unsigned, which the app doesn't believe (the server audit of 2026-11-23).
  it('count no use when there’s no good key to sign the coins with, and give them once there is', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const good = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')
    for (const key of ['bm90IGEga2V5', 'not base64 at all!', undefined]) {
      const { ask, redeem, codes } = server('the-secret', key, false)
      await ask('POST', '/v1/coins/codes', { code: CODE, coins: 100, uses: 1 }, ADMIN)
      expect((await redeem('claim-one-1')).status, String(key)).toBe(503)
      expect(codes.show(CODE)!.used, String(key)).toBe(0)
    }
    const { ask, redeem, codes } = server('the-secret', good, false, await publicHalf(pair))
    await ask('POST', '/v1/coins/codes', { code: CODE, coins: 100, uses: 1 }, ADMIN)
    expect((await redeem('claim-one-1')).body).toMatchObject({ coins: 100, sig: expect.any(String) })
    expect(codes.show(CODE)!.used).toBe(1)
  })

  // A key that signs and isn't the one the app checks with (another pasted at a rotation) passed as good: every
  // answer was signed, refused by the app, and its use counted (found checking the fix, 2026-11-23).
  it('count no use when the key to sign with isn’t the pair of the one the app checks with', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const another = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')
    // Against the app's own key, which is what the Worker holds it to when nothing else is said.
    const { ask, redeem, codes } = server('the-secret', another, false)
    await ask('POST', '/v1/coins/codes', { code: CODE, coins: 100, uses: 1 }, ADMIN)
    expect((await redeem('claim-one-1')).status).toBe(503)
    expect(codes.show(CODE)!.used).toBe(0)
    // And the app's own is the one it has always checked with.
    expect(Buffer.from(COINS_PUBLIC_KEY, 'base64url').toString('hex')).toBe('d1f297a2eb39a454f2831e99d692c2590c87b4eb15eaa5742306e76f9f553e8f')
  })

  it('leave other routes to theirs', async () => {
    const response = await frontDoor(new Request('https://sync.nibprivacy.com/v1/status'), { sync: async () => new Response('sync') } as unknown as Routes)
    expect(await response.text()).toBe('sync')
  })
})
