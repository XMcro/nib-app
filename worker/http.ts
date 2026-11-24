import { FILE_HASH_HEADER } from './wire.mjs'

/** What every route needs: its CORS headers, a JSON answer, a body read up to a limit, and hashes to count a network by. */

// The iOS app's own origin. The website is the same origin as the API and
// needs no entry.
const ORIGINS = new Set(['capacitor://localhost'])
/** An App Store JWS, a receipt or a notification, is a few KB; this is room to spare, and no more. */
export const MAX_RECEIPT = 64_000

export function cors(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin')
  if (!origin || !ORIGINS.has(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': `Authorization, Content-Type, X-Nib-Time, X-Nib-Signature, ${FILE_HASH_HEADER}`,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/** Whether the body was sent as JSON. A page on another site can't send that without the browser asking first (`cors` answers no), where text/plain goes straight through. */
export const isJson = (request: Request) => (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase() === 'application/json'

export function json(request: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(request) },
  })
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Equal in time whatever they hold: the admin secret is checked by its hash. */
async function same(given: string, secret: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(secret)])
  let differ = 0
  for (let i = 0; i < a.length; i++) differ |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return differ === 0
}

/** Whether a request comes with this secret of the Worker's (COINS_ADMIN, FEEDBACK_KEY). Without one set, none does. */
export async function isAdmin(request: Request, secret: string | undefined): Promise<boolean> {
  const admin = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1]
  return !!secret && !!admin && (await same(admin, secret))
}

/**
 * A hash keyed with the Worker's secret (COINS_ADMIN), for counting by
 * network: a plain hash of an IPv4 address is turned back into it in
 * seconds, a keyed one can't be without the secret. `purpose` keeps one
 * count's names apart from another's.
 */
export const keyedHash = (purpose: string, secret: string | undefined, text: string) => sha256(`${purpose}:${secret ?? ''}:${text}`)

/**
 * Where a request comes from, for counting: an IPv4 address as it is, an
 * IPv6 one by its /64, which one connection usually has to itself, so that
 * stepping through its addresses counts once. `wide`, the network around
 * it: an IPv6 /48, an IPv4 /24.
 */
export function networkOf(ip: string, wide = false): string {
  if (!ip.includes(':')) return wide ? `${ip.split('.').slice(0, 3).join('.')}.0/24` : ip
  const [head, tail = ''] = ip.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = ip.includes('::') && tail ? tail.split(':') : []
  const groups = [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
  return `${groups
    .slice(0, wide ? 3 : 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/${wide ? 48 : 64}`
}

/** The network a request came from and the wider one it's in, each by a hash keyed with `secret`, under the name `named` gives it. */
export function networksOf(request: Request, secret: string | undefined, purpose: string, named: (network: string, wide: boolean) => string = (network) => network): Promise<[string, string]> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  return Promise.all([keyedHash(purpose, secret, named(networkOf(ip), false)), keyedHash(purpose, secret, named(networkOf(ip, true), true))])
}

/**
 * Whether a request came from the developer's own machine or network, as under `wrangler dev`: Cloudflare says
 * where each one really came from (CF-Connecting-IP), and from an address like these none does. Not told by the
 * request's host, which under `wrangler dev` is the route's own (measured, wrangler 4.137).
 */
export const fromHere = (request: Request) => /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/.test(request.headers.get('CF-Connecting-IP') ?? '')

/** A body past its route's limit: answered 413. */
export class TooLarge extends Error {}

/**
 * The body as a JSON object, or null if it isn't one. Read as a stream and
 * given up past `max` bytes, whatever Content-Length says, or if it says
 * nothing: a chunked body used to skip the check and be read whole.
 */
export async function readJson(request: Request, max: number): Promise<Record<string, unknown> | null> {
  return parseJson(await readBytes(request, max))
}

/** The body's bytes, past `max` given up on as readJson says; none if it has none. */
export async function readBytes(request: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const said = Number(request.headers.get('Content-Length') ?? 0)
  if (said > max) throw new TooLarge()
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  // Into one buffer, grown by doubling as more comes: each piece kept as it came till the end, a body sent a byte
  // at a time was held at some 250 times its size (the server audit of 2026-11-23). Never of the length said before
  // any of it has come: a request that said 16 MB and sent nothing was given 16 MB to wait in.
  let bytes = new Uint8Array(Math.min(max, 64 * 1024))
  let size = 0
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    const end = size + part.value.byteLength
    if (end > max) {
      await reader.cancel()
      throw new TooLarge()
    }
    if (end > bytes.length) {
      const grown = new Uint8Array(Math.min(max, Math.max(end, bytes.length * 2)))
      grown.set(bytes.subarray(0, size))
      bytes = grown
    }
    bytes.set(part.value, size)
    size = end
  }
  return size === bytes.length ? bytes : bytes.slice(0, size)
}

/**
 * The most objects and lists a body may open and still be parsed: a push of the most records there can be is one
 * of each and an object a record (worker/wire MAX_RECORDS); every other body opens one or two. Past it, it's not
 * a body Nib sends: 4 MB of brackets, which anyone could send to make a free link, took fifteen to thirty times
 * that in memory to parse (the server audit of 2026-11-23).
 */
const MAX_OPENED = 4096

/** Whether a body opens more objects and lists than MAX_OPENED, outside its strings: a note of code is brackets someone wrote. */
function opensTooMany(bytes: Uint8Array): boolean {
  let opened = 0
  let quoted = false
  for (let at = 0; at < bytes.length; at++) {
    const byte = bytes[at]
    if (quoted) {
      // A backslash takes the next byte with it, a quote among them.
      if (byte === 0x5c) at++
      else if (byte === 0x22) quoted = false
    } else if (byte === 0x22) quoted = true
    else if ((byte === 0x7b || byte === 0x5b) && ++opened > MAX_OPENED) return true
  }
  return false
}

export function parseJson(bytes: Uint8Array<ArrayBuffer>): Record<string, unknown> | null {
  if (opensTooMany(bytes)) return null
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes))
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}
