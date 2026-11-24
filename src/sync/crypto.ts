import { base64, base64url } from '../../worker/base64'
import { KEY_BYTES, LIBRARY_ID_BYTES, MAX_PADDED } from '../../worker/wire.mjs'

/**
 * The sync code, and everything derived from it. The code never leaves the
 * device. From it come:
 *   - the library id and an auth secret, which the server sees (it keeps only
 *     a hash of the secret);
 *   - an AES-GCM key that encrypts every record, which it never sees;
 *   - an HMAC key that hides record names, so the server cannot tell which
 *     records are notes, which are history, or which belong together.
 */

// Crockford base32: no I, L, O or U, so a code read aloud or copied by hand
// survives. 15 random bytes = 120 bits = 24 characters.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const BYTES = 15
const LENGTH = 24

export type SyncKeys = {
  libraryId: string
  secret: string
  encrypt: CryptoKey
  names: CryptoKey
  /**
   * Signs sync requests (sync/api, worker/signing), so none carries the
   * secret. Missing where the web view has no Ed25519 (before iOS 17): there
   * requests carry the secret, as before.
   */
  sign?: { key: CryptoKey; publicKey: string }
}

function toBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out
}

function fromBase32(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(BYTES)
  let bits = 0
  let value = 0
  let at = 0
  for (const char of text) {
    value = (value << 5) | ALPHABET.indexOf(char)
    bits += 5
    if (bits >= 8) {
      out[at++] = (value >>> (bits - 8)) & 255
      bits -= 8
    }
  }
  return out
}

export function newCode(): string {
  return formatCode(toBase32(crypto.getRandomValues(new Uint8Array(BYTES))))
}

/** XXXX-XXXX-XXXX-XXXX-XXXX-XXXX */
function formatCode(raw: string): string {
  return raw.match(/.{1,4}/g)!.join('-')
}

/**
 * Whatever was pasted or typed, reduced to the canonical code, or null.
 * Forgiving where Crockford is: O reads as 0, I and L as 1.
 */
export function parseCode(input: string): string | null {
  const raw = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (raw.length !== LENGTH || [...raw].some((char) => !ALPHABET.includes(char))) return null
  return formatCode(raw)
}

const encoder = new TextEncoder()
const SALT = encoder.encode('nib-sync-v1')

export async function deriveKeys(code: string): Promise<SyncKeys> {
  const raw = code.replace(/-/g, '')
  const base = await crypto.subtle.importKey('raw', fromBase32(raw), 'HKDF', false, ['deriveBits', 'deriveKey'])
  const hkdf = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: encoder.encode(info) })
  const id = new Uint8Array(await crypto.subtle.deriveBits(hkdf('library-id'), base, LIBRARY_ID_BYTES * 8))
  const secret = new Uint8Array(await crypto.subtle.deriveBits(hkdf('auth'), base, KEY_BYTES * 8))
  const seed = new Uint8Array(await crypto.subtle.deriveBits(hkdf('sign'), base, 256))
  return {
    libraryId: [...id].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    secret: base64url(secret),
    encrypt: await crypto.subtle.deriveKey(hkdf('encrypt'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
    names: await crypto.subtle.deriveKey(hkdf('names'), base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']),
    sign: await signer(seed),
  }
}

/** PKCS #8's wrapping of an Ed25519 private key: these 16 bytes, then its 32-byte seed. */
const ED25519_PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]

/** The same key pair on every device with the code; undefined where there's no Ed25519. */
async function signer(seed: Uint8Array): Promise<SyncKeys['sign']> {
  try {
    const pkcs8 = new Uint8Array([...ED25519_PKCS8, ...seed])
    // Its public half, read once from a copy that can be read out; the key kept can't be.
    const { x } = await crypto.subtle.exportKey('jwk', await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']))
    const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign'])
    return x ? { key, publicKey: x } : undefined
  } catch {
    return undefined
  }
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}

/** The server-side name of a record: an HMAC it cannot reverse. */
export async function recordKey(keys: SyncKeys, type: 'item' | 'revision' | 'stamps' | 'folders' | 'looks' | 'submissions' | 'file', id: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', keys.names, encoder.encode(`${type}:${id}`))))
}

const KIB = 1024
/**
 * The size a record is padded to before it is sealed, so the server sees a
 * bucket rather than a document's length and every change to it: the next
 * KiB up to 16 KiB, then the next power of two. Never past what can be sent;
 * a record bigger than that goes as it is, as it always did.
 */
export function padded(length: number): number {
  if (length <= 16 * KIB) return Math.max(KIB, Math.ceil(length / KIB) * KIB)
  if (length > MAX_PADDED) return length
  let size = 32 * KIB
  while (size < length) size *= 2
  return Math.min(size, MAX_PADDED)
}

/**
 * Encrypted with the record's key as associated data, so the server cannot
 * move a payload from one record to another without it failing to open.
 */
export async function seal(keys: SyncKeys, key: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const json = encoder.encode(JSON.stringify(value))
  // Padded with spaces after the JSON, which JSON.parse skips: `open`, and
  // every Nib before padding, reads it as if they weren't there.
  const plain = new Uint8Array(padded(json.length)).fill(0x20)
  plain.set(json)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(key) }, keys.encrypt, plain)
  const out = new Uint8Array(iv.length + cipher.byteLength)
  out.set(iv)
  out.set(new Uint8Array(cipher), iv.length)
  return base64(out)
}

export async function open(keys: SyncKeys, key: string, payload: string): Promise<unknown> {
  const bytes = fromBase64(payload)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: encoder.encode(key) },
    keys.encrypt,
    bytes.subarray(12),
  )
  return JSON.parse(new TextDecoder().decode(plain))
}
