import type { Call } from './answer'
import { handleFiles, sendsFile, type FileStore } from './files'
import { handleInbox } from './inbox'
import { json, MAX_RECEIPT, networksOf, parseJson, readBytes, sha256 } from './http'
import type { Claims } from './jws'
import { findLibrary, type Asker, type Libraries, type LibraryRequests, type Proof } from './library'
import { bodyHash, inSignedWindow, PUBLIC_KEY, signedMessage, verifySignature } from './signing'
import type { QuotaRequests } from './quota'
import type { SubscriberRequests } from './subscriber'
import { FILE_HASH_HEADER, KEY_SHAPE, LIBRARY_ID_SHAPE, MAX_BODY, MAX_RECORDS, type Wire } from './wire.mjs'

/**
 * The sync API, as a plain function over its dependencies, so it can be
 * tested without a Worker runtime. index.ts supplies the real ones.
 *
 *   POST   /v1/entitlement  { jws }      an App Store subscription, verified here
 *   GET    /v1/status
 *   GET    /v1/changes?since=N           pull
 *   POST   /v1/changes      { records }  push
 *   POST   /v1/expire       { keys }     let go of versions past the history kept
 *   DELETE /v1/library                   delete everything on the server
 *   POST   /v1/key          { key }      the public key signed requests are checked against
 *   POST   /v1/signed-only  { on }       signed requests only, or not
 *   …      /v1/files, /v1/files/<key>    its files (worker/files)
 *   …      /v1/inbox, /v1/inbox/taken    its inbox, from a device's side (worker/inbox)
 *
 * A call carries `Authorization: Bearer <library id>.<secret>`, both derived
 * from the sync code on the device; the server keeps a hash of the secret.
 * Or it's signed (worker/signing): `Authorization: Signed <library id>`, with
 * X-Nib-Time and X-Nib-Signature, by a key derived from the code, whose public
 * half the server keeps, so nothing in it can be sent again to act as the
 * device. Either way the server never sees the code, the encryption key, or
 * any writing.
 */

export type Deps = {
  library: Libraries
  /** The subscription a receipt belongs to, by its original transaction id's hash (worker/subscriber `Subscriber`). */
  subscriber(key: string): SubscriberRequests
  verify(jws: string): Promise<Claims>
  /** Where a library's files are kept (worker/files). */
  files: FileStore
  /** Lets work go on after the sender has gone (the Worker's `ctx.waitUntil`). */
  waitUntil?(work: Promise<unknown>): void
  /** Counts by network (worker/quota), named by a hash keyed with `secret`: signed pushes that didn't check out. */
  quota?(key: string): QuotaRequests
  secret?: string
}

/**
 * Signed pushes to one library that didn't check out, from one network in a
 * day, before the next one's body, to that library, is refused unread. A signed push is read, up to 16 MB, before
 * its signature can be checked, and a library's id is in its inbox's address,
 * which services hold (the security review of 2026-11-13). A device signs
 * every push it sends, so its own never count.
 */
export const BAD_PUSHES_PER_NETWORK = 20
export const BAD_PUSHES_PER_WIDE = 100
const TOO_MANY_BAD = 'Too many pushes that weren’t signed for their library have come from this network today. Try again tomorrow.'

/** A record's name: an HMAC-SHA256, in base64url (src/sync/crypto.ts `recordKey`). */
const KEY = new RegExp(`^${KEY_SHAPE}$`)
/**
 * A sealed payload: standard base64, as every Nib has sent it (`seal`), so its
 * length is the bytes it takes, and nothing wider gets in to be counted short.
 */
const PAYLOAD = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function validRecords(value: unknown): value is Wire[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_RECORDS &&
    value.every(
      (record) =>
        typeof record === 'object' &&
        record !== null &&
        typeof record.k === 'string' &&
        KEY.test(record.k) &&
        (record.b === undefined || Number.isInteger(record.b)) &&
        (record.d === undefined || record.d === 1) &&
        // A delete may come without its seal: a Nib from before sealed deletes.
        (record.p === undefined ? record.d === 1 : typeof record.p === 'string' && PAYLOAD.test(record.p)),
    )
  )
}

const BEARER = new RegExp(`^Bearer (${LIBRARY_ID_SHAPE})\\.(${KEY_SHAPE})$`)
const SIGNED = new RegExp(`^Signed (${LIBRARY_ID_SHAPE})$`)

export async function handleSync(request: Request, deps: Deps): Promise<Response> {
  const header = request.headers.get('Authorization') ?? ''
  const bearer = BEARER.exec(header)
  const signed = SIGNED.exec(header)
  if (!bearer && !signed) return json(request, 401, { error: 'Missing or malformed sync credentials.' })
  const libraryId = (bearer ?? signed)![1]
  const authHash = bearer ? await sha256(bearer[2]) : null
  const library = findLibrary(deps.library, libraryId)
  const url = new URL(request.url)
  const path = url.pathname
  const reply = ({ status, body }: Call) => json(request, status, body)

  // The body, read once, and only when it's needed: a signed request's is
  // part of what it signed, so it's read before its signature is checked.
  let raw: Uint8Array<ArrayBuffer> | undefined
  // A push may be large; a receipt, a key or a list of keys is all any other carries.
  const limit = path === '/v1/changes' && request.method === 'POST' ? MAX_BODY : MAX_RECEIPT
  const bytes = async () => (raw ??= await readBytes(request, limit))
  /** This request, among all that might carry its signature: it may ask the library more than once. */
  const once = crypto.randomUUID()
  // What a signed request signed (worker/signing), as this server sees it.
  const proof = async (): Promise<Proof> => {
    const time = Number(request.headers.get('X-Nib-Time'))
    // A file is never read here: its hash is said in a header, signed with the rest, and checked by the store as it takes the bytes.
    const hash = sendsFile(request) ? (request.headers.get(FILE_HASH_HEADER) ?? '') : await bodyHash(await bytes())
    const message = signedMessage({ id: libraryId, method: request.method, path: path + url.search, time, bodyHash: hash })
    // One that changes something is taken once (worker/library `taken`); reading again changes nothing.
    return { message, time, signature: request.headers.get('X-Nib-Signature') ?? '', ...(request.method === 'GET' ? {} : { once }) }
  }
  // The library, asked by the code's hash or by a signature.
  const who = async (): Promise<Asker> => authHash ?? (await proof())
  const asked = async (ask: (stub: LibraryRequests, asker: Asker) => Promise<Call>): Promise<Call> => {
    const asker = await who()
    return library.reach((stub) => ask(stub, asker))
  }
  const refused = async (): Promise<Response | undefined> => {
    const known = await asked((stub, asker) => stub.authorise(asker))
    // A body not yet read is left unread, not cancelled: cancelling it can
    // lose this answer on its way out, and the sender sees a dropped connection.
    return known.status === 200 ? undefined : reply(known)
  }

  const creating = path === '/v1/library' && request.method === 'POST'
  if (creating || (path === '/v1/entitlement' && request.method === 'POST')) {
    // A receipt is all these carry: a few KB.
    const body = parseJson(await bytes())
    if (typeof body?.jws !== 'string') return json(request, 400, { error: 'Expected { jws }.' })
    let claims: Claims
    try {
      claims = await deps.verify(body.jws)
    } catch (error) {
      return json(request, 403, { error: `The App Store receipt was not accepted: ${(error as Error).message}.` })
    }
    // Counted against the subscription first: at most MAX_LIBRARIES in use
    // each (renewed within LIBRARY_IDLE_MS), and none once refunded. Its own
    // object takes one request at a time, so two libraries can't both take
    // the last place.
    const subscription = await sha256(claims.originalTransactionId)
    const subscriber = deps.subscriber(subscription)
    const claimed = await subscriber.claimLibrary(libraryId, claims.purchasedAt)
    if (claimed.status !== 200) return reply(claimed)
    const result = creating ? await library.create(await who(), claims.expiresAt, subscription) : await asked((stub, asker) => stub.entitle(asker, claims.expiresAt, subscription))
    // Only a place it took, and only as it found it: another request may have counted on it since (worker/subscriber).
    const { added, claim } = claimed.body as { added: boolean; claim: number }
    if (result.status !== 200 && added) await subscriber.releaseLibrary(libraryId, claim)
    return reply(result)
  }
  if (path === '/v1/files' || path.startsWith('/v1/files/')) return handleFiles(request, { store: deps.files, asked, reach: library.reach, waitUntil: deps.waitUntil })
  if (path === '/v1/inbox' || path === '/v1/inbox/taken') return handleInbox(request, { asked, body: bytes })
  if (path === '/v1/status' && request.method === 'GET') return reply(await asked((stub, asker) => stub.status(asker)))
  if (path === '/v1/changes' && request.method === 'GET') {
    const since = Number(url.searchParams.get('since') ?? 0)
    if (!Number.isInteger(since) || since < 0) return json(request, 400, { error: 'Bad cursor.' })
    return reply(await asked((stub, asker) => stub.changes(asker, since)))
  }
  if (path === '/v1/changes' && request.method === 'POST') {
    // The code first, then the body: a stranger's push is never read. A
    // signed one's is part of what was signed, so it's read before its
    // signature is checked, but only once there's a library by that id
    // taking signed requests: any id, made up, had up to 16 MB read and hashed.
    let networks: [QuotaRequests, QuotaRequests] | null = null
    if (signed) {
      const signs = await library.reach((stub) => stub.signs())
      if (signs.status !== 200) return reply(signs)
      if (deps.quota) {
        // Counted by the library they name: a network's bad pushes to one refuse no one's pushes to another.
        const [here, around] = await networksOf(request, deps.secret, 'nib-quota', (network) => `bad push ${libraryId} ${network}`)
        networks = [deps.quota(here), deps.quota(around)]
        const used = await Promise.all(networks.map(async (quota) => ((await quota.used()).body as { used: number }).used))
        if (used[0] >= BAD_PUSHES_PER_NETWORK || used[1] >= BAD_PUSHES_PER_WIDE) return json(request, 429, { error: TOO_MANY_BAD })
      }
    }
    const refusal = await refused()
    if (refusal) {
      // Counted only when its signature or its clock was wrong, not when Plus has lapsed or the library's gone.
      if (networks && refusal.status === 401) await Promise.all(networks.map((quota, at) => quota.spend(at === 0 ? BAD_PUSHES_PER_NETWORK : BAD_PUSHES_PER_WIDE, TOO_MANY_BAD)))
      return refusal
    }
    const records = parseJson(await bytes())?.records
    if (!validRecords(records)) return json(request, 400, { error: 'Expected { records }.' })
    return reply(await asked((stub, asker) => stub.push(asker, records)))
  }
  if (path === '/v1/expire' && request.method === 'POST') {
    const refusal = await refused()
    if (refusal) return refusal
    // Keys alone: a thousand of them is under 64 KB.
    const keys = parseJson(await bytes())?.keys
    if (!Array.isArray(keys) || keys.length > MAX_RECORDS || !keys.every((k) => typeof k === 'string' && KEY.test(k))) {
      return json(request, 400, { error: 'Expected { keys }.' })
    }
    return reply(await asked((stub, asker) => stub.expire(asker, keys)))
  }
  if (path === '/v1/key' && request.method === 'POST') {
    // By the code's hash, with this request signed by the key it gives: proof
    // the device holds it, and that it's a key at all.
    const key = parseJson(await bytes())?.key
    if (typeof key !== 'string' || !PUBLIC_KEY.test(key)) return json(request, 400, { error: 'Expected { key }.' })
    const { message, time, signature } = await proof()
    if (!inSignedWindow(time, Date.now()) || !(await verifySignature(key, signature, message))) {
      return json(request, 401, { error: 'That key isn’t this device’s.' })
    }
    return reply(await asked((stub, asker) => stub.enroll(asker, key)))
  }
  if (path === '/v1/signed-only' && request.method === 'POST') {
    const on = parseJson(await bytes())?.on
    if (typeof on !== 'boolean') return json(request, 400, { error: 'Expected { on }.' })
    return reply(await asked((stub, asker) => stub.requireSigned(asker, on)))
  }
  if (path === '/v1/library' && request.method === 'DELETE') {
    const wiped = await asked((stub, asker) => stub.wipe(asker))
    if (wiped.status !== 200) return reply(wiped)
    // Its place goes back to the subscription that paid for it.
    const { subscription } = wiped.body as { subscription: string | null }
    if (subscription) await deps.subscriber(subscription).releaseLibrary(libraryId)
    return json(request, 200, { wiped: true })
  }
  return json(request, 404, { error: 'Not found.' })
}
