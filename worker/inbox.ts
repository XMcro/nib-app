import type { Call } from './answer'
import { isBase64 } from './base64'
import { isJson, json, parseJson, readBytes, sha256 } from './http'
import { inboxKey, sealedShape, sealPost, type Post } from './inbox-seal'
import { findLibrary, type Asker, type Libraries, type LibraryRequests } from './library'
import { KEY_SHAPE, LIBRARY_ID_SHAPE, MAX_INBOX_KEPT, MAX_POST, MAX_RECORDS, MAX_SEALED_POST, SEALED_TYPE } from './wire.mjs'

/**
 * A library's inbox: an address any service can post a note to, for the
 * library's devices to take in.
 *
 *   POST   /v1/in/<library id>.<secret>   a post, from anyone who holds the address
 *
 * and, with the library's credentials (worker/sync sends these here):
 *
 *   GET    /v1/inbox           whether there is one, and what's waiting
 *   PUT    /v1/inbox           { key, address, kept }  an inbox, or a new address for it
 *   DELETE /v1/inbox           no inbox, and nothing waiting
 *   POST   /v1/inbox/taken     { ids }           posts a device has made notes of
 *
 * A service that posts can't encrypt, so this is the one place the server
 * sees writing: for as long as it takes to seal it (worker/inbox-seal) with a
 * key only the library's devices can open. Nothing of a post is logged or
 * kept unsealed, and the address's secret is kept as its hash alone.
 *
 * Nib's browser extension can: a clip comes sealed already, in the browser
 * it was clipped in, as `application/nib-sealed`, and is kept as it came,
 * unread. The server can't open one, so all it checks is its shape and size.
 */

/**
 * An inbox's address: its library's id and the secret, `/v1/in/<id>.<secret>`,
 * or the id alone with the secret in `Authorization: Bearer <secret>`, which
 * keeps it out of the address wherever addresses are noted on the way, as a
 * network's own logs may (the security review of 2026-11-13). Nib's browser
 * extension sends it so; a service that can't set a header has the whole address.
 */
const ADDRESS = new RegExp(`^/v1/in/(${LIBRARY_ID_SHAPE})(?:\\.(${KEY_SHAPE}))?$`)
const BEARER = new RegExp(`^Bearer (${KEY_SHAPE})$`)
const HASH = /^[0-9a-f]{64}$/
const FIELDS = ['title', 'text', 'url'] as const

/**
 * What a service sent, as a post: JSON or a form with `title`, `text` and
 * `url`, any of them, or anything else as the text itself, a form with none
 * of them too. Null for nothing
 * to keep, or a field that isn't text.
 */
function postOf(request: Request, bytes: Uint8Array<ArrayBuffer>): Post | null {
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
  const sent = new TextDecoder().decode(bytes)
  let given: Record<string, unknown> | null
  if (isJson(request)) given = parseJson(bytes)
  else if (type === 'application/x-www-form-urlencoded') {
    // What `curl -d` calls whatever it sends: a form that names none of the fields is the text alone.
    const form = Object.fromEntries(new URLSearchParams(sent))
    given = FIELDS.some((field) => field in form) ? form : { text: sent }
  } else given = { text: sent }
  if (!given) return null
  const post: Post = {}
  for (const field of FIELDS) {
    const value = given[field]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') return null
    if (value.trim()) post[field] = value.trim()
  }
  return Object.keys(post).length > 0 ? post : null
}

/** A post from a service, to the address in its path. */
export async function handlePost(request: Request, deps: { library: Libraries }): Promise<Response> {
  const [, id, inAddress] = ADDRESS.exec(new URL(request.url).pathname) ?? []
  const reply = ({ status, body }: Call) => json(request, status, body)
  if (!id) return json(request, 404, { error: 'No inbox at that address.' })
  if (request.method !== 'POST') return json(request, 405, { error: 'Send a POST to this address.' })
  const secret = inAddress ?? BEARER.exec(request.headers.get('Authorization') ?? '')?.[1]
  if (!secret) return json(request, 404, { error: 'No inbox at that address.' })
  const library = findLibrary(deps.library, id)
  const address = await sha256(secret)
  // The address first, and room for a post: a stranger's is never read.
  const known = await library.reach((stub) => stub.inboxFor(address))
  if (known.status !== 200) {
    await request.body?.cancel()
    return reply(known)
  }
  if ((request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase() === SEALED_TYPE) {
    const clip = new TextDecoder().decode(await readBytes(request, MAX_SEALED_POST)).trim()
    if (!sealedShape(clip)) return json(request, 400, { error: 'Expected a sealed clip.' })
    return reply(await library.reach((stub) => stub.addPost(address, clip)))
  }
  const post = postOf(request, await readBytes(request, MAX_POST))
  if (!post) return json(request, 400, { error: 'Nothing to keep. Send title, text or url, as JSON, as a form, or the text alone.' })
  const sealed = await sealPost((known.body as { key: string }).key, post)
  return reply(await library.reach((stub) => stub.addPost(address, sealed)))
}

export type InboxDeps = {
  /** Asks the library, as whoever sent the request. */
  asked(ask: (stub: LibraryRequests, asker: Asker) => Promise<Call>): Promise<Call>
  /** The request's body, read once (worker/sync). */
  body(): Promise<Uint8Array<ArrayBuffer>>
}

/** A device's side of its library's inbox. */
export async function handleInbox(request: Request, { asked, body }: InboxDeps): Promise<Response> {
  const path = new URL(request.url).pathname
  const reply = ({ status, body }: Call) => json(request, status, body)
  if (path === '/v1/inbox' && request.method === 'GET') return reply(await asked((stub, asker) => stub.inbox(asker)))
  if (path === '/v1/inbox' && request.method === 'DELETE') return reply(await asked((stub, asker) => stub.endInbox(asker)))
  if (path === '/v1/inbox' && request.method === 'PUT') {
    const { key, address, kept } = parseJson(await body()) ?? {}
    // The key is tried as one, so a post is never sealed with what isn't; the secret in the address comes as its hash; and what the devices keep, sealed and small.
    const sealed = typeof kept === 'string' && kept.length > 0 && kept.length <= MAX_INBOX_KEPT && isBase64(kept)
    if (typeof key !== 'string' || typeof address !== 'string' || !HASH.test(address) || !sealed || !(await inboxKey(key))) {
      return json(request, 400, { error: 'Expected { key, address, kept }.' })
    }
    return reply(await asked((stub, asker) => stub.setInbox(asker, key, address, kept as string)))
  }
  if (path === '/v1/inbox/taken' && request.method === 'POST') {
    const ids = parseJson(await body())?.ids
    if (!Array.isArray(ids) || ids.length > MAX_RECORDS || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
      return json(request, 400, { error: 'Expected { ids }.' })
    }
    return reply(await asked((stub, asker) => stub.tookPosts(asker, ids)))
  }
  return json(request, 404, { error: 'Not found.' })
}
