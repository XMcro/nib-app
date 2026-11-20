import { ok, type Call } from './answer'
import { base64url } from './base64'
import { isAdmin, isJson, json, networksOf, readJson } from './http'
import type { Sql } from './library'
import { coinsMessage } from './signing'
import { CLAIM, COIN_REFUSED, endOfDay, MAX_COINS, realDay, utcDay, type CoinRefusal } from './wire.mjs'

/**
 * Codes for coins (the app's src/lib/codes), counted here: each worth so many
 * coins, for so many uses or any number, until its last day if it has one,
 * and ended early if need be. The server knows a code only by its
 * fingerprint, never the code. All of them live in one Durable Object, so
 * counting a use is never raced; a guess at a code that isn't one stores
 * nothing.
 *
 *   POST   /v1/coins/redeem              { code, claim }          the app: a code's coins
 *   POST   /v1/coins/codes               { code, coins, uses?, until? }   make or change one: what's left out stays as it was
 *   GET    /v1/coins/codes/:code                                  how it stands
 *   DELETE /v1/coins/codes/:code                                  end it
 *
 * `code` is a fingerprint, 64 hex digits. `claim` is the app's own id for
 * one attempt, kept until its coins are: the same claim again is answered
 * the same, and counted once, for a day (CLAIM_AGAIN_MS); after that it's
 * used up. The coins come signed (`sig`, with COINS_SIGNING_KEY), so the app
 * believes only coins from here. New uses are counted by network too, for the
 * day (UTC), so one person can't use up a code given to many. Making, reading and ending need
 * `Authorization: Bearer <COINS_ADMIN>`, a secret on the Worker and on the
 * maker's Mac (scripts/coin-code.mjs); without it set, they're not there.
 */

const FINGERPRINT = /^[0-9a-f]{64}$/
const ROUTE = /^\/v1\/coins\/codes\/([0-9a-f]{64})$/

/** New uses a day from one network (an IPv4 address, an IPv6 /64), and from the wider one it's in (a /24, a /48), which a home, office or school may share. */
export const USES_PER_NETWORK = 10
export const USES_PER_WIDE = 50
/** How long a claim is answered again, as after an answer lost on the way: a claim id kept or passed round can't take coins for ever. */
export const CLAIM_AGAIN_MS = 86_400_000

export type CoinCodeState = { coins: number; uses: number | null; used: number; until: string | null; ended: boolean }

export class CoinCodes {
  private sql: Sql

  constructor(sql: Sql) {
    this.sql = sql
    sql.run('CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, coins INTEGER NOT NULL, uses INTEGER, until TEXT, ended INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0)')
    sql.run('CREATE TABLE IF NOT EXISTS claims (code TEXT NOT NULL, claim TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (code, claim))')
    // A network by a keyed hash of it, never the address: its new uses on `day`.
    sql.run('CREATE TABLE IF NOT EXISTS networks (network TEXT PRIMARY KEY, day TEXT NOT NULL, n INTEGER NOT NULL)')
    // Uses kept on the code, counted as they come, rather than counted from its claims at every use: once, from them, for the codes made before.
    if (!sql.all('PRAGMA table_info(codes)').some((column) => column.name === 'used')) {
      sql.run('ALTER TABLE codes ADD COLUMN used INTEGER NOT NULL DEFAULT 0')
      sql.run('UPDATE codes SET used = (SELECT COUNT(*) FROM claims WHERE claims.code = codes.code)')
    }
    // The coins each claim was given, for it to be given the same again; null on those from before, which take the code's.
    if (!sql.all('PRAGMA table_info(claims)').some((column) => column.name === 'coins')) sql.run('ALTER TABLE claims ADD COLUMN coins INTEGER')
  }

  /**
   * Made, or changed: uses or a last day left out stay as they were (none,
   * for a new code), its uses so far stay counted, and a code ended is open
   * again.
   */
  set(code: string, change: { coins: number; uses?: number | null; until?: string | null }) {
    const stored = this.show(code)
    this.sql.run(
      'INSERT INTO codes (code, coins, uses, until, ended) VALUES (?, ?, ?, ?, 0) ON CONFLICT (code) DO UPDATE SET coins = excluded.coins, uses = excluded.uses, until = excluded.until, ended = 0',
      code,
      change.coins,
      change.uses !== undefined ? change.uses : (stored?.uses ?? null),
      change.until !== undefined ? change.until : (stored?.until ?? null),
    )
  }

  end(code: string): boolean {
    if (!this.show(code)) return false
    this.sql.run('UPDATE codes SET ended = 1 WHERE code = ?', code)
    return true
  }

  show(code: string): CoinCodeState | null {
    const row = this.sql.all('SELECT coins, uses, used, until, ended FROM codes WHERE code = ?', code)[0]
    if (!row) return null
    return { coins: Number(row.coins), uses: row.uses === null ? null : Number(row.uses), used: Number(row.used), until: (row.until as string | null) ?? null, ended: row.ended === 1 }
  }

  /** A use, counted once for `claim`, and for `networks`, the one it came from and the wider one: its coins, or why not. `today` is UTC's, for the last day. */
  redeem(code: string, claim: string, networks: [string, string], today: string, now: number): { coins: number } | CoinRefusal {
    return this.sql.transaction(() => {
      const state = this.show(code)
      if (!state) return 'unknown'
      const claimed = this.sql.all('SELECT at, coins FROM claims WHERE code = ? AND claim = ?', code, claim)[0]
      if (claimed) return now - Number(claimed.at) < CLAIM_AGAIN_MS ? { coins: claimed.coins === null ? state.coins : Number(claimed.coins) } : 'used up'
      if (state.ended || (state.until && today > state.until)) return 'ended'
      if (state.uses !== null && state.used >= state.uses) return 'used up'
      const [here, wide] = networks.map((network) => Number(this.sql.all('SELECT n FROM networks WHERE network = ? AND day = ?', network, today)[0]?.n ?? 0))
      if (here >= USES_PER_NETWORK || wide >= USES_PER_WIDE) return 'too many'
      this.sql.run('INSERT INTO claims (code, claim, at, coins) VALUES (?, ?, ?, ?)', code, claim, now, state.coins)
      this.sql.run('UPDATE codes SET used = used + 1 WHERE code = ?', code)
      for (const network of networks) {
        this.sql.run('INSERT INTO networks (network, day, n) VALUES (?, ?, 1) ON CONFLICT (network) DO UPDATE SET n = CASE WHEN day = excluded.day THEN n + 1 ELSE 1 END, day = excluded.day', network, today)
      }
      return { coins: state.coins }
    })
  }

  /** The networks counted before `today`, forgotten. */
  forget(today: string) {
    this.sql.run('DELETE FROM networks WHERE day < ?', today)
  }
}

const NO_SUCH_CODE: Call = { status: 404, body: { error: 'unknown' } }

/** The codes' requests, for their Durable Object. `alarm` is when the networks counted today are forgotten. */
export function coinRequests(codes: CoinCodes, effects: { alarm(at: number): Promise<void> }, clock: () => number = Date.now) {
  return {
    async redeem(code: string, claim: string, networks: [string, string]): Promise<Call> {
      const now = clock()
      const result = codes.redeem(code, claim, networks, utcDay(now), now)
      if (typeof result === 'string') return { status: COIN_REFUSED[result], body: { error: result } }
      // The networks counted today, forgotten at its end.
      await effects.alarm(endOfDay(now))
      return ok(result)
    },
    async set(code: string, change: Parameters<CoinCodes['set']>[1]): Promise<Call> {
      codes.set(code, change)
      return ok(codes.show(code))
    },
    async show(code: string): Promise<Call> {
      const state = codes.show(code)
      return state ? ok(state) : NO_SUCH_CODE
    },
    end: async (code: string): Promise<Call> => (codes.end(code) ? ok(codes.show(code)) : NO_SUCH_CODE),
  }
}

export type CoinRequests = ReturnType<typeof coinRequests>

export type CoinDeps = {
  /** The one object every code is kept in. */
  coins: CoinRequests
  /** COINS_ADMIN: the secret that makes, reads and ends codes. Unset, they're not served. */
  admin: string | undefined
  /** COINS_SIGNING_KEY: the Ed25519 key a code's coins are signed with, base64 of its PKCS#8. Unset (local development), they go unsigned. */
  signingKey?: string
  /** COINS_LIMIT: Cloudflare's rate limit, by network. Not there (tests, `wrangler dev`), nothing is limited. */
  limiter?: { limit(options: { key: string }): Promise<{ success: boolean }> }
}

/** `message` signed with the coins' key, in base64url: the app checks it with the public half it holds. */
async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(secret), (c) => c.charCodeAt(0)), { name: 'Ed25519' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(message)))
  return base64url(signature)
}

/** A request for the coins' routes, answered. */
export async function handleCoins(request: Request, deps: CoinDeps): Promise<Response> {
  const { pathname } = new URL(request.url)
  const answer = (call: Call) => json(request, call.status, call.body)
  if (pathname === '/v1/coins/redeem' && request.method === 'POST') {
    if (!isJson(request)) return json(request, 415, { error: 'JSON, please.' })
    const body = await readJson(request, 1000)
    if (!body || typeof body.code !== 'string' || !FINGERPRINT.test(body.code) || typeof body.claim !== 'string' || !CLAIM.test(body.claim)) {
      return json(request, 400, { error: 'A code and a claim, please.' })
    }
    // The network by a hash keyed with the Worker's secret, so a list of them can't be turned back into addresses.
    const networks = await networksOf(request, deps.admin, 'nib-coins-network', (network, wide) => (wide ? `wide ${network}` : network))
    // Before the one object every code is kept in, which made-up codes reach as readily as real ones. A limiter that fails stops nobody.
    // By the address or its /64, and by the wider network round it: by the first alone, a block of addresses
    // guessed at as many times over as it had addresses (the red-team review of 2026-11-17).
    const limited = await Promise.all(networks.map((key) => deps.limiter?.limit({ key }).catch(() => null)))
    if (limited.some((one) => one?.success === false)) return answer({ status: COIN_REFUSED['too many'], body: { error: 'too many' } })
    const redeemed = await deps.coins.redeem(body.code, body.claim, networks)
    if (redeemed.status !== 200 || !deps.signingKey) return answer(redeemed)
    // Signed, so coins that didn't come from here (a proxy on the device, say) aren't believed.
    const { coins } = redeemed.body as { coins: number }
    return json(request, 200, { coins, sig: await sign(deps.signingKey, coinsMessage(body.code, body.claim, coins)) })
  }
  if (!(await isAdmin(request, deps.admin))) return json(request, 404, { error: 'Not found.' })
  if (pathname === '/v1/coins/codes' && request.method === 'POST') {
    const body = await readJson(request, 1000)
    // Uses and a last day only if given: null is none, left out is as they were.
    const { uses, until } = body ?? {}
    if (
      !body ||
      typeof body.code !== 'string' ||
      !FINGERPRINT.test(body.code) ||
      !Number.isInteger(body.coins) ||
      (body.coins as number) <= 0 ||
      (body.coins as number) > MAX_COINS ||
      (uses != null && (!Number.isInteger(uses) || (uses as number) <= 0)) ||
      (until != null && (typeof until !== 'string' || !realDay(until)))
    ) {
      return json(request, 400, { error: 'A code, its coins, and uses and a last day if it has them.' })
    }
    const change = { coins: body.coins, ...(uses !== undefined && { uses }), ...(until !== undefined && { until }) }
    return answer(await deps.coins.set(body.code, change as Parameters<CoinCodes['set']>[1]))
  }
  const route = ROUTE.exec(pathname)
  if (route && request.method === 'GET') return answer(await deps.coins.show(route[1]))
  if (route && request.method === 'DELETE') return answer(await deps.coins.end(route[1]))
  return json(request, 404, { error: 'Not found.' })
}
