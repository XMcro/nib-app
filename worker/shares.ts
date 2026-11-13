import type { Call } from './answer'
import { isJson, json, MAX_RECEIPT, networksOf, readJson as readCapped, sha256 } from './http'
import type { Claims } from './jws'
import { paidThrough } from './paid'
import { EVERYONE, spendEach, type QuotaRequests } from './quota'
import { FREE_PER_DAY, FREE_PER_DAY_EVERYONE, FREE_PER_DAY_WIDE, NOTES_PER_READER_PER_DAY, NOTES_PER_WIDE_PER_DAY, type ShareRequests } from './share'
import type { SubscriberRequests } from './subscriber'
import { DEFAULT_DAYS, FREE_DAYS, KEY_SHAPE, MAX_DOC_LENGTH, SHARE_DAYS, SLUG_SHAPE } from './wire.mjs'

/**
 * Share a draft, over HTTP. A plain function over its dependencies, like
 * sync.ts, so it can be tested without a Worker runtime.
 *
 *   POST   /v1/shares                  { slug, jws, days, doc, once?, reveal? }  owner: create; to be read once, with its reveal token's hash
 *   POST   /v1/shares                  { slug, doc }             owner: create a free one
 *   POST   /v1/shares/entitlement      { jws }                   a renewal, for every share
 *   GET    /v1/shares/:slug                                      reader: the sealed document, or that it's one to be read once; counted, with Nib Plus, once a day a network
 *   POST   /v1/shares/:slug/reveal     { token }                 reader: one to be read once, for its token, handed over and deleted
 *   POST   /v1/shares/:slug/notes      { note }                  reader: a sealed note
 *   GET    /v1/shares/:slug/notes                                owner: every note
 *   DELETE /v1/shares/:slug/notes/:id                            owner
 *   PATCH  /v1/shares/:slug           { days?, notes? }         owner
 *   DELETE /v1/shares/:slug                                      owner: revoke
 *   GET    /d/:slug                                              the reader page
 *
 * The owner sends `Authorization: Owner <token>`; the server keeps a hash.
 * Readers send nothing at all. Neither ever sends the key.
 */

export type ShareDeps = {
  share(slug: string): ShareRequests
  subscriber(key: string): SubscriberRequests
  /** Free shares started from one IP address, or notes left from one, by a hash of it keyed with `secret`. */
  quota(key: string): QuotaRequests
  /** COINS_ADMIN, the Worker's secret: the key a quota's name is hashed with, so the names can't be turned back into addresses. */
  secret: string | undefined
  verify(jws: string): Promise<Claims>
  /** The kill switch: no reading and no notes anywhere. Owners can still revoke. */
  off: boolean
  /** Slugs, or subscribers, whose shares no longer serve. */
  blocked: string[]
  now(): number
}

const ROUTE = new RegExp(`^/v1/shares/(${SLUG_SHAPE})(?:(/notes(?:/(\\d+))?)|(/reveal))?$`)
export const PAGE = new RegExp(`^/d/${SLUG_SHAPE}$`)
const OWNER = new RegExp(`^Owner (${KEY_SHAPE})$`)
const TOKEN = new RegExp(`^${KEY_SHAPE}$`)
/** The hash of a reveal token, as the app sends it at creation (src/share/crypto `revealCheck`). */
const REVEAL_HASH = /^[0-9a-f]{64}$/
/** All a reveal carries: `{ token }`. */
const REVEAL_BODY = 1_000
/** The most a request to leave a note, a sealed one of up to MAX_NOTE_LENGTH and the JSON around it, or to change a share, `{ days, notes }`, can need. */
const NOTE_BODY = 4_000
const PATCH_BODY = 256

/**
 * The reader page's headers. The page itself is fixed; the draft arrives as
 * ciphertext and is drawn without ever handing markup to the browser.
 */
export const READER_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Robots-Tag': 'noindex',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-cache',
}

export const READER_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>A draft, shared from Nib</title>
<link rel="stylesheet" href="/reader.css">
<script type="module" src="/reader.js"></script>
</head>
<body>
<main id="reader"><p class="status">Opening the draft…</p></main>
<noscript><p class="status">This draft is encrypted, and opens with JavaScript turned on.</p></noscript>
</body>
</html>
`

/** Handles share routes. */
export async function handleShares(request: Request, deps: ShareDeps): Promise<Response> {
  const path = new URL(request.url).pathname
  const reply = ({ status, body }: Call) => json(request, status, body)
  // A sealed document, and a little around it, for those that carry one; every other body is smaller, and read no further than it can be.
  const readJson = (limit = MAX_DOC_LENGTH + 10_000) => readCapped(request, limit)
  const token = OWNER.exec(request.headers.get('Authorization') ?? '')?.[1]
  const owner = token ? await sha256(token) : null
  const unavailable = () => json(request, 503, { error: 'Shared drafts are turned off for now.' })

  // A verified, current subscription, and the key it's filed under.
  const subscription = async (jws: unknown) => {
    if (typeof jws !== 'string') return json(request, 400, { error: 'Expected an App Store receipt.' })
    let claims: Claims
    try {
      claims = await deps.verify(jws)
    } catch (error) {
      return json(request, 403, { error: `The App Store receipt was not accepted: ${(error as Error).message}.` })
    }
    // A valid signature on a lapsed subscription is still a lapsed subscription.
    if (!paidThrough(claims.expiresAt, deps.now())) return json(request, 403, { error: 'Nib Plus is not active.' })
    return { claims, key: await sha256(claims.originalTransactionId) }
  }

  if (path === '/v1/shares/entitlement' && request.method === 'POST') {
    const paid = await subscription((await readJson(MAX_RECEIPT))?.jws)
    if (paid instanceof Response) return paid
    return reply(await deps.subscriber(paid.key).entitle(paid.claims.expiresAt, paid.claims.purchasedAt))
  }

  if (path === '/v1/shares' && request.method === 'POST') {
    if (deps.off) return unavailable()
    if (!owner) return json(request, 401, { error: 'Expected an owner token.' })
    const body = await readJson()
    const slug = typeof body?.slug === 'string' && new RegExp(`^${SLUG_SHAPE}$`).test(body.slug) ? body.slug : null
    // No receipt is a free share, which lasts FREE_DAYS and no other length.
    const free = body?.jws === undefined
    const days = body?.days ?? (free ? FREE_DAYS : DEFAULT_DAYS)
    const doc = body?.doc
    // To be read once (worker/share): yes or no, and with a receipt.
    const once = body?.once
    if (once !== undefined && typeof once !== 'boolean') return json(request, 400, { error: 'Expected `once` to be true or false.' })
    // What a reader of one to be read once will have to show (worker/share `reveal`).
    const reveal = body?.reveal
    if (reveal !== undefined && (!once || typeof reveal !== 'string' || !REVEAL_HASH.test(reveal))) return json(request, 400, { error: 'Expected `reveal` with `once`, as a hash.' })
    if (!slug || !(free ? days === FREE_DAYS : SHARE_DAYS.includes(days as number)) || typeof doc !== 'string' || !/^[A-Za-z0-9_-]+$/.test(doc) || doc.length > MAX_DOC_LENGTH) {
      return json(request, 400, { error: 'Expected { slug, jws, days, doc }.' })
    }
    if (free) {
      const [here, around] = await networksOf(request, deps.secret, 'nib-quota')
      const fromHere = 'Too many free links from this network today. Try again tomorrow, or share with Nib Plus.'
      const spent = await spendEach([
        [deps.quota(here), FREE_PER_DAY, fromHere],
        [deps.quota(around), FREE_PER_DAY_WIDE, fromHere],
        [deps.quota(EVERYONE), FREE_PER_DAY_EVERYONE, 'Too many free links have been made today. Try again tomorrow, or share with Nib Plus.'],
      ])
      if ('refused' in spent) return reply(spent.refused)
      const created = await deps.share(slug).create({ slug, ownerHash: owner, subscriber: null, days: days as number, doc, ...(once ? { once } : {}) })
      if (created.status !== 201) await spent.refund()
      return reply(created)
    }
    const paid = await subscription(body?.jws)
    if (paid instanceof Response) return paid
    if (deps.blocked.includes(paid.key)) return json(request, 403, { error: 'Sharing is not available to this subscription.' })
    const subscriber = deps.subscriber(paid.key)
    await subscriber.entitle(paid.claims.expiresAt, paid.claims.purchasedAt)
    const expires = deps.now() + (days as number) * 86_400_000
    const admitted = await subscriber.admit(slug, expires, paid.claims.purchasedAt)
    if (admitted.status !== 200) return reply(admitted)
    const created = await deps.share(slug).create({ slug, ownerHash: owner, subscriber: paid.key, days: days as number, entitledUntil: paid.claims.expiresAt, doc, ...(once ? { once } : {}), ...(reveal ? { reveal: reveal as string } : {}) })
    // Only a place it took: a share posted again keeps the one it has.
    if (created.status !== 201 && (admitted.body as { added: boolean }).added) await subscriber.release(slug)
    return reply(created)
  }

  const route = ROUTE.exec(path)
  if (!route) return json(request, 404, { error: 'Not found.' })
  const [, slug, notes, noteId, reveal] = route
  const share = deps.share(slug)
  const method = request.method

  // Readers: no credentials, and nothing works while sharing is off.
  if (reveal) {
    if (method !== 'POST') return json(request, 404, { error: 'Not found.' })
    if (deps.off) return unavailable()
    // The token from the link's key, hashed as the app hashed it at creation; none from a reader that's older than tokens.
    const token = (await readJson(REVEAL_BODY))?.token
    const tokenHash = typeof token === 'string' && TOKEN.test(token) ? await sha256(token) : null
    return reply(await share.reveal(deps.blocked, tokenHash))
  }
  // With its owner's token, it's the app checking its key (src/share `opensDraft`), and isn't counted as an opening.
  if (!notes && method === 'GET') {
    if (deps.off) return unavailable()
    const read = await share.read(deps.blocked)
    // With Nib Plus, counted once a day for each network a reader asks from, so asking again and again counts once and writes nothing more (the security review of 2026-11-13). The owner's own asking is spent too, but never counted.
    if (read.status === 200 && (read.body as { counted?: boolean }).counted) {
      const [here] = await networksOf(request, deps.secret, 'nib-quota', (network) => `${slug} opened ${network}`)
      if ((await deps.quota(here).spend(1, 'Counted already today.')).status === 200) await share.countOpen(owner)
    }
    return reply(read)
  }
  if (notes && !noteId && method === 'POST') {
    if (deps.off) return unavailable()
    if (!isJson(request)) return json(request, 415, { error: 'JSON, please.' })
    // A draft there and taking notes first, so a slug that isn't one is counted against nobody, stores nothing, and has nothing read.
    const taking = await share.takesNotes(deps.blocked)
    if (taking.status !== 200) return reply(taking)
    const note = (await readJson(NOTE_BODY))?.note
    if (typeof note !== 'string' || !/^[A-Za-z0-9_-]+$/.test(note)) return json(request, 400, { error: 'Expected { note }.' })
    // Counted per draft and per network, as free shares are, and never by the address itself, nor a plain hash of it.
    const [here, around] = await networksOf(request, deps.secret, 'nib-quota', (network) => `${slug} ${network}`)
    const allLeft = 'You’ve left all the notes you can on this draft today. Try again tomorrow.'
    const spent = await spendEach([
      [deps.quota(here), NOTES_PER_READER_PER_DAY, allLeft],
      [deps.quota(around), NOTES_PER_WIDE_PER_DAY, allLeft],
    ])
    if ('refused' in spent) return reply(spent.refused)
    const added = await share.addNote(note, deps.blocked)
    if (added.status !== 201) await spent.refund()
    return reply(added)
  }

  // The owner, sharing on or off.
  if (!owner) return json(request, 401, { error: 'Expected an owner token.' })
  if (notes && !noteId && method === 'GET') return reply(await share.notes(owner))
  if (noteId && method === 'DELETE') return reply(await share.deleteNote(owner, Number(noteId)))
  if (!notes && method === 'PATCH') {
    const body = await readJson(PATCH_BODY)
    const change: { days?: number; notes?: boolean } = {}
    if (body?.days !== undefined) {
      if (!SHARE_DAYS.includes(body.days as number)) return json(request, 400, { error: `Expected ${SHARE_DAYS.slice(0, -1).join(', ')} or ${SHARE_DAYS.at(-1)} days.` })
      change.days = body.days as number
    }
    if (typeof body?.notes === 'boolean') change.notes = body.notes
    const updated = await share.update(owner, change)
    return reply(updated)
  }
  if (!notes && method === 'DELETE') return reply(await share.revoke(owner))
  return json(request, 404, { error: 'Not found.' })
}
