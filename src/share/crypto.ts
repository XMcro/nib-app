import { base64url, fromBase64url } from '../../worker/base64'
import { KEY_BYTES, KEY_SHAPE, SLUG_BYTES, SLUG_SHAPE } from '../../worker/wire.mjs'
import type { ShareRef } from '../db/db'

/**
 * Share a draft: everything secret about a share is made here, on the device,
 * and shared by the app and the reader page (src/reader).
 *
 *   - the slug names the share on the server;
 *   - the key encrypts the document and every reader's note, and travels
 *     only in the link's fragment, which browsers never send anywhere;
 *   - the owner token proves the writer to the server, which keeps a hash.
 *
 * Each ciphertext is bound to its share and to what it is (the document, or
 * a note), so the server can't move one between shares or pass a note off as
 * the document. Layout as in sync/crypto.ts: a 12-byte IV, then AES-GCM.
 *
 * A share can also need a password, which never leaves the writer's devices
 * or the reader's page: see `withPassword`.
 */

export type ShareSecrets = { slug: string; key: string; owner: string }
export type Role = 'doc' | 'note'

/** What a note may hold, in characters. The reader enforces these; the server only sees the size. */
export const NOTE_LIMITS = { quote: 300, text: 1000, name: 60 }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const random = (bytes: number) => base64url(crypto.getRandomValues(new Uint8Array(bytes)))

/** 128 bits of slug, 256 of key and of owner token. */
export function newShare(): ShareSecrets {
  return { slug: random(SLUG_BYTES), key: random(KEY_BYTES), owner: random(KEY_BYTES) }
}

export const validSlug = (slug: string) => new RegExp(`^${SLUG_SHAPE}$`).test(slug)
export const validKey = (key: string) => new RegExp(`^${KEY_SHAPE}$`).test(key)

/** Long enough for a passphrase; a password is a thing to type, not to paste a file into. */
export const MAX_PASSWORD = 200

/**
 * The one check on share records arriving from outside. `undefined` means
 * nothing usable, which callers treat as saying nothing, as with `asGoal`.
 */
export function asShares(raw: unknown): ShareRef[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.flatMap((entry) => {
    const share = entry as Partial<ShareRef> | null
    if (!share || typeof share.slug !== 'string' || !validSlug(share.slug)) return []
    if (typeof share.key !== 'string' || !validKey(share.key) || typeof share.owner !== 'string' || !validKey(share.owner)) return []
    if (typeof share.createdAt !== 'number' || typeof share.expiresAt !== 'number') return []
    const kept: ShareRef = { slug: share.slug, key: share.key, owner: share.owner, createdAt: share.createdAt, expiresAt: share.expiresAt }
    if (typeof share.password === 'string' && share.password && share.password.length <= MAX_PASSWORD) kept.password = share.password
    if (share.free === true) kept.free = true
    if (share.once === true) kept.once = true
    return [kept]
  })
}

function importKey(key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64url(key), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

const bound = (role: Role, slug: string) => encoder.encode(`nib-share/${role}/${slug}`)

/** Encrypts `value` as JSON for one share and role. Base64url, so it travels in JSON as is. */
export async function seal(key: string, slug: string, role: Role, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = encoder.encode(JSON.stringify(value))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bound(role, slug) }, await importKey(key), plain)
  const out = new Uint8Array(iv.length + cipher.byteLength)
  out.set(iv)
  out.set(new Uint8Array(cipher), iv.length)
  return base64url(out)
}

/** The other way. Throws on a wrong key, a wrong share or role, or any tampering. */
export async function open(key: string, slug: string, role: Role, sealed: string): Promise<unknown> {
  const bytes = fromBase64url(sealed)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: bound(role, slug) },
    await importKey(key),
    bytes.slice(12),
  )
  return JSON.parse(decoder.decode(plain))
}

/**
 * What a reader shows the server to have a draft to be read once handed over,
 * worked out from the link's key, which the server never sees; the server
 * keeps its hash (`revealCheck`). So the slug alone, which a proxy's log or a
 * mail scanner may keep, can't use one up (the security review of 2026-11-13).
 */
export async function revealToken(key: string, slug: string): Promise<string> {
  const linkKey = await crypto.subtle.importKey('raw', fromBase64url(key), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(`nib-share/reveal/${slug}`), info: encoder.encode('nib-share/reveal') }, linkKey, 256)
  return base64url(new Uint8Array(bits))
}

/** The hash of a reveal token, as the server keeps it and checks it (worker/share): hex SHA-256. */
export async function revealCheck(token: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)))
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Ciphertext bytes for a sealed string, as the server counts them. */
export const sealedBytes = (sealed: string) => Math.floor((sealed.length * 3) / 4)

/** On the end of a link's key: this draft also needs a password, so the page asks for it. */
export const PASSWORD_MARK = '.p'

/** OWASP's recommended count for PBKDF2-SHA256; about half a second on a phone. */
const PASSWORD_ROUNDS = 600_000

/**
 * The key that seals a share with a password: the link's key and the password,
 * both needed. Anyone with the link can fetch the ciphertext and guess at the
 * password offline, so PBKDF2 makes every guess cost; HKDF then mixes in the
 * link's key, so the password alone opens nothing either. The result is a key
 * like any other, and `seal` and `open` use it unchanged.
 */
export async function withPassword(key: string, slug: string, password: string): Promise<string> {
  const secret = await crypto.subtle.importKey('raw', encoder.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits'])
  const stretched = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(`nib-share/password/${slug}`), iterations: PASSWORD_ROUNDS },
    secret,
    256,
  )
  const linkKey = await crypto.subtle.importKey('raw', fromBase64url(key), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(stretched), info: encoder.encode('nib-share/key') },
    linkKey,
    256,
  )
  return base64url(new Uint8Array(bits))
}
