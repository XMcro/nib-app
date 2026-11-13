import { GRACE_MS } from './paid'

/**
 * Verifies an App Store transaction: a JWS signed by a key whose certificate
 * chains to Apple Root CA - G3. This is what stops anyone from posting
 * "I subscribed" and getting sync for free, so nothing in it trusts the
 * payload until the chain and the signature both check out.
 *
 * WebCrypto only (no node:crypto), so it runs unchanged in the Worker and in
 * the tests. X.509 is parsed by hand, just far enough to verify a chain.
 */

export const PRODUCT_IDS = ['app.nib.plus.monthly', 'app.nib.plus.yearly']
/** The most a Sandbox or TestFlight purchase pays for, from when it is shown. */
const SANDBOX_MS = 86_400_000
export const BUNDLE_ID = 'app.nib.ios'

export type Claims = {
  productId: string
  originalTransactionId: string
  expiresAt: number
  /** When this purchase or renewal was made: what tells it from one a refund took back. */
  purchasedAt: number
  environment: string
}

export class JwsError extends Error {}

// Apple's marker extensions: 1.2.840.113635.100.6.2.1 on the WWDR intermediate,
// 1.2.840.113635.100.6.11.1 on the App Store signing leaf; and basicConstraints,
// 2.5.29.19. Each a DER-encoded OID, in hex, as an extension's id.
const MARK_INTERMEDIATE = '060a2a864886f76364060201'
const MARK_LEAF = '060a2a864886f76364060b01'
const BASIC_CONSTRAINTS = '0603551d13'
const OID_P256 = hex('06082a8648ce3d030107')
const OID_P384 = hex('06052b81040022')
const OID_SHA256 = hex('06082a8648ce3d040302')
const OID_SHA384 = hex('06082a8648ce3d040303')

type Node = { tag: number; start: number; header: number; end: number }
/** Backed by a plain ArrayBuffer, which is what WebCrypto accepts. */
type Bytes = Uint8Array<ArrayBuffer>

function hex(text: string): Bytes {
  return Uint8Array.from(text.match(/../g)!.map((byte) => parseInt(byte, 16)))
}

function read(bytes: Bytes, offset: number): Node {
  if (offset + 2 > bytes.length) throw new JwsError('truncated certificate')
  let length = bytes[offset + 1]
  let header = 2
  if (length & 0x80) {
    const count = length & 0x7f
    if (count > 4) throw new JwsError('certificate length out of range')
    length = 0
    for (let i = 0; i < count; i++) length = length * 256 + bytes[offset + 2 + i]
    header += count
  }
  const end = offset + header + length
  if (end > bytes.length) throw new JwsError('truncated certificate')
  return { tag: bytes[offset], start: offset, header, end }
}

function children(bytes: Bytes, node: Node): Node[] {
  const out: Node[] = []
  for (let at = node.start + node.header; at < node.end; ) {
    const child = read(bytes, at)
    out.push(child)
    at = child.end
  }
  return out
}

const slice = (bytes: Bytes, node: Node) => bytes.subarray(node.start, node.end)
const body = (bytes: Bytes, node: Node) => bytes.subarray(node.start + node.header, node.end)
const toHex = (bytes: Bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

function contains(haystack: Bytes, needle: Bytes): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

const same = (a: Bytes, b: Bytes) => a.length === b.length && contains(a, b)

type Certificate = {
  der: Bytes
  tbs: Bytes
  issuer: Bytes
  subject: Bytes
  spki: Bytes
  curve: 'P-256' | 'P-384'
  hash: 'SHA-256' | 'SHA-384'
  signature: Bytes // DER SEQUENCE { r, s }
  notBefore: number
  notAfter: number
  /** By id (a DER OID, in hex): each extension's value, the contents of its OCTET STRING. */
  extensions: Map<string, Bytes>
}

function time(bytes: Bytes, node: Node): number {
  const text = new TextDecoder().decode(body(bytes, node))
  const digits = node.tag === 0x17 ? (Number(text.slice(0, 2)) >= 50 ? '19' : '20') + text : text
  const [y, mo, d, h, mi, s] = [0, 4, 6, 8, 10, 12].map((at, i) => Number(digits.slice(at, at + (i ? 2 : 4))))
  return Date.UTC(y, mo - 1, d, h, mi, s)
}

/**
 * The certificate's extensions, read as extensions: an id found only as bytes
 * somewhere else in the certificate, inside another extension's value say,
 * doesn't count.
 */
function extensionsOf(der: Bytes, parts: Node[]): Map<string, Bytes> {
  const found = new Map<string, Bytes>()
  const wrapper = parts.find((part) => part.tag === 0xa3) // [3] EXPLICIT Extensions
  if (!wrapper) return found
  const [list] = children(der, wrapper)
  if (list?.tag !== 0x30) fail('malformed certificate extensions')
  for (const extension of children(der, list)) {
    const fields = children(der, extension) // extnID, critical (optional), extnValue
    const [id, value] = [fields[0], fields.at(-1)]
    if (id?.tag !== 0x06 || value?.tag !== 0x04) fail('malformed certificate extension')
    found.set(toHex(slice(der, id)), body(der, value))
  }
  return found
}

/** Whether basicConstraints says it may sign other certificates: cA TRUE. */
function isAuthority(certificate: Certificate): boolean {
  const value = certificate.extensions.get(BASIC_CONSTRAINTS)
  if (!value) return false
  const [first] = children(value, read(value, 0))
  return first?.tag === 0x01 && body(value, first)[0] !== 0
}

function parse(der: Bytes): Certificate {
  const root = read(der, 0)
  const [tbs, algorithm, signature] = children(der, root)
  const parts = children(der, tbs)
  const at = parts[0].tag === 0xa0 ? 1 : 0 // explicit version
  const [, , issuer, validity, subject, spki] = parts.slice(at)
  const [notBefore, notAfter] = children(der, validity)
  const spkiBytes = slice(der, spki)
  const algorithmBytes = slice(der, algorithm)
  return {
    der,
    tbs: slice(der, tbs),
    issuer: slice(der, issuer),
    subject: slice(der, subject),
    spki: spkiBytes,
    curve: contains(spkiBytes, OID_P384) ? 'P-384' : contains(spkiBytes, OID_P256) ? 'P-256' : fail('unsupported key'),
    hash: contains(algorithmBytes, OID_SHA384) ? 'SHA-384' : contains(algorithmBytes, OID_SHA256) ? 'SHA-256' : fail('unsupported signature'),
    signature: body(der, signature).subarray(1), // skip the unused-bits byte
    notBefore: time(der, notBefore),
    notAfter: time(der, notAfter),
    extensions: extensionsOf(der, parts.slice(at + 6)),
  }
}

function fail(message: string): never {
  throw new JwsError(message)
}

/** DER ECDSA signature to the fixed-width r‖s WebCrypto expects. */
function rawSignature(der: Bytes, size: number): Bytes {
  const sequence = read(der, 0)
  const [r, s] = children(der, sequence)
  const out = new Uint8Array(size * 2)
  for (const [index, part] of [r, s].entries()) {
    let value = body(der, part)
    while (value.length > size && value[0] === 0) value = value.subarray(1)
    if (value.length > size) fail('signature out of range')
    out.set(value, index * size + size - value.length)
  }
  return out
}

function importKey(certificate: Certificate): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', certificate.spki, { name: 'ECDSA', namedCurve: certificate.curve }, false, ['verify'])
}

async function signedBy(child: Certificate, parent: Certificate): Promise<boolean> {
  if (!same(child.issuer, parent.subject)) return false
  const size = parent.curve === 'P-384' ? 48 : 32
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: child.hash },
    await importKey(parent),
    rawSignature(child.signature, size),
    child.tbs,
  )
}

function base64(text: string): Bytes {
  const normal = text.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(normal + '='.repeat((4 - (normal.length % 4)) % 4)), (c) => c.charCodeAt(0))
}

function decodeJson(part: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(base64(part)))
  } catch {
    return fail('malformed JWS')
  }
}

type Trust = { roots: Bytes[]; now?: number; allowXcode?: boolean }

/**
 * Anything the App Store signs (a transaction, a server notification),
 * checked through the chain and its signature; returns its payload. `roots`
 * is Apple Root CA - G3 in production; tests pass their own. `allowXcode`
 * accepts Xcode's local StoreKit testing, which signs with a throwaway
 * certificate of its own — never set in production.
 */
export async function verifySigned(jws: string, { roots, now = Date.now(), allowXcode = false }: Trust): Promise<Record<string, unknown>> {
  const parts = jws.split('.')
  if (parts.length !== 3) fail('malformed JWS')
  const header = decodeJson(parts[0])
  const payload = decodeJson(parts[1])
  if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || header.x5c.length === 0) fail('unexpected JWS header')
  const chain = (header.x5c as string[]).map((cert) => parse(base64(cert)))
  const leaf = chain[0]

  const xcode = payload.environment === 'Xcode'
  if (xcode && !allowXcode) fail('Xcode test transactions are not accepted here')
  if (!xcode) {
    if (chain.length !== 3) fail('unexpected certificate chain')
    const [, intermediate, root] = chain
    if (!roots.some((trusted) => same(trusted, root.der))) fail('not signed by Apple')
    if (!intermediate.extensions.has(MARK_INTERMEDIATE) || !isAuthority(intermediate) || !leaf.extensions.has(MARK_LEAF)) {
      fail('not an App Store certificate')
    }
    for (const cert of chain) if (now < cert.notBefore || now > cert.notAfter) fail('certificate expired')
    if (!(await signedBy(intermediate, root)) || !(await signedBy(leaf, intermediate))) fail('broken certificate chain')
  }
  if (leaf.curve !== 'P-256') fail('unexpected signing key')
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    await importKey(leaf),
    base64(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  )
  if (!valid) fail('bad signature')
  return payload
}

/** A transaction from the App Store: verified (`verifySigned`), for this app's subscription, and neither refunded nor revoked. */
export async function verifyTransaction(jws: string, trust: Trust): Promise<Claims> {
  const payload = await verifySigned(jws, trust)
  const now = trust.now ?? Date.now()
  if (payload.bundleId !== BUNDLE_ID) fail('wrong app')
  if (!PRODUCT_IDS.includes(payload.productId as string)) fail('wrong product')
  if (payload.revocationDate !== undefined) fail('refunded or revoked')
  if (typeof payload.expiresDate !== 'number' || typeof payload.purchaseDate !== 'number' || typeof payload.originalTransactionId !== 'string') {
    fail('not a subscription')
  }
  // Sandbox and TestFlight purchases cost nothing, and App Review buys with
  // them: accepted, but for a day at most, and with no grace. Every check
  // adds GRACE_MS to an expiry, so it is taken off here, once. Anything not
  // named Production is paid for the same, a receipt naming none included.
  const sandbox = payload.environment !== 'Production'
  return {
    productId: payload.productId as string,
    originalTransactionId: payload.originalTransactionId,
    expiresAt: sandbox ? Math.min(payload.expiresDate, now + SANDBOX_MS) - GRACE_MS : payload.expiresDate,
    purchasedAt: payload.purchaseDate,
    environment: String(payload.environment),
  }
}
