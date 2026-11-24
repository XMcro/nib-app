import { base64, base64url, fromBase64url, isBase64 } from './base64'
import { INBOX_KEY_SHAPE, KEY_SHAPE, LIBRARY_ID_SHAPE } from './wire.mjs'

/**
 * A post to an inbox, sealed so that only the library's devices can open it.
 * A service that posts can't encrypt, so the server does, the moment a post
 * arrives (worker/inbox), with the public half of a key the devices made: it
 * keeps the public half alone, and so can't open what it has sealed. Shared by
 * the server, which seals, and the app, which opens (as worker/signing is).
 *
 * Sealed as: a version byte, a P-256 public key made for this one post, an
 * IV, and the post as JSON under AES-256-GCM, by a key drawn (HKDF-SHA256)
 * from what the two keys agree on (ECDH). The key made for the post is
 * forgotten once it's sealed.
 */

/**
 * What a service sent: all of it text, none of it trusted. From Nib's browser
 * extension, which seals its own, there may be part of a web page too: `page`,
 * as HTML, and `part`, which of it (src/lib/inbox `PARTS`).
 */
export type Post = { title?: string; text?: string; url?: string; page?: string; part?: string }

const VERSION = 1
const POINT = 65
const IV = 12
const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const
const INFO = new TextEncoder().encode('nib inbox v1')
const KEY = new RegExp(`^${INBOX_KEY_SHAPE}$`)

/** An inbox's public key, as a key: null if it isn't one. */
export async function inboxKey(key: string): Promise<CryptoKey | null> {
  if (!KEY.test(key)) return null
  try {
    return await crypto.subtle.importKey('raw', fromBase64url(key), CURVE, false, [])
  } catch {
    return null
  }
}

function joined(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const all = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  parts.reduce((at, part) => (all.set(part, at), at + part.length), 0)
  return all
}

/** The key one post is sealed with: what `mine` and `theirs` agree on, bound to both public keys, the post's first. */
async function agreed(mine: CryptoKey, theirs: CryptoKey, once: Uint8Array, inbox: Uint8Array, use: 'encrypt' | 'decrypt') {
  // `public`, as every runtime takes it: the Workers' types alone call it `$public`.
  const ecdh = { name: 'ECDH', public: theirs } as unknown as Parameters<SubtleCrypto['deriveBits']>[0]
  const shared = await crypto.subtle.deriveBits(ecdh, mine, 256)
  const drawn = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: joined(once, inbox), info: INFO }, drawn, { name: 'AES-GCM', length: 256 }, false, [use])
}

/** `post`, sealed to the inbox whose public key is `to`. Throws if `to` is no key. */
export async function sealPost(to: string, post: Post): Promise<string> {
  const theirs = await inboxKey(to)
  if (!theirs) throw new Error('Not an inbox’s key.')
  const made = (await crypto.subtle.generateKey(CURVE, true, ['deriveBits'])) as CryptoKeyPair
  const once = new Uint8Array((await crypto.subtle.exportKey('raw', made.publicKey)) as ArrayBuffer)
  const iv = crypto.getRandomValues(new Uint8Array(IV))
  const key = await agreed(made.privateKey, theirs, once, fromBase64url(to), 'encrypt')
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(post))))
  return base64(joined(Uint8Array.of(VERSION), once, iv, sealed))
}

/** The least a sealed post can be, in base64: its version, a key, an IV, and the seal's own 16 bytes around nothing. */
const LEAST = Math.ceil(((1 + POINT + IV + 16) * 4) / 3)

/** Whether `sealed` is shaped as `sealPost` makes one. All the server can tell of one that comes sealed already: it can't open it to see. */
export function sealedShape(sealed: string): boolean {
  return sealed.length >= LEAST && isBase64(sealed) && atob(sealed.slice(0, 4)).charCodeAt(0) === VERSION
}

/**
 * The clipper code: what Nib's browser extension is given, once, to send
 * clips to an inbox. The inbox's address and, after a "#", its public key,
 * so the extension can seal a clip before it leaves the browser.
 */
export const clipperCode = (address: string, key: string) => `${address}#${key}`

const INBOX_PATH = new RegExp(`^/v1/in/${LIBRARY_ID_SHAPE}\\.${KEY_SHAPE}$`)

/** A clipper code, read: where to send, and the key to seal with. Null for anything else. Sent only over https, but for a server on this computer. */
export function readClipperCode(code: string): { address: string; key: string } | null {
  const [address, key, ...more] = code.trim().split('#')
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return null
  }
  const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (more.length || !KEY.test(key ?? '') || !(url.protocol === 'https:' || local) || !INBOX_PATH.test(url.pathname) || url.search || url.username || url.password) return null
  return { address, key }
}

/** A new inbox's keys: the private half stays with the library's devices, the public half, as the server takes it, goes to the server. */
export async function newInboxKeys(): Promise<{ privateKey: CryptoKey; publicKey: string }> {
  const made = (await crypto.subtle.generateKey(CURVE, true, ['deriveBits'])) as CryptoKeyPair
  return { privateKey: made.privateKey, publicKey: base64url(new Uint8Array((await crypto.subtle.exportKey('raw', made.publicKey)) as ArrayBuffer)) }
}

/** A sealed post, opened with the inbox's private key (its public half is `inbox`). Throws if it wasn't sealed to this inbox, or has been changed. */
export async function openPost(privateKey: CryptoKey, inbox: string, sealed: string): Promise<Post> {
  const bytes = Uint8Array.from(atob(sealed), (char) => char.charCodeAt(0))
  if (bytes[0] !== VERSION) throw new Error('Sealed in a way this Nib doesn’t know.')
  const once = bytes.subarray(1, 1 + POINT)
  const iv = bytes.subarray(1 + POINT, 1 + POINT + IV)
  const theirs = await crypto.subtle.importKey('raw', once, CURVE, false, [])
  const key = await agreed(privateKey, theirs, once, fromBase64url(inbox), 'decrypt')
  const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.subarray(1 + POINT + IV))
  return JSON.parse(new TextDecoder().decode(opened)) as Post
}
