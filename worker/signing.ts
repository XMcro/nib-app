import { fromBase64url } from './base64'
import { KEY_SHAPE } from './wire.mjs'

/**
 * Signed sync requests: what's signed, and how it's checked. The app signs
 * (src/sync/api.ts) with a key it derives from the sync code; the server
 * keeps only the public half (worker/library `enroll`) and checks each
 * request against it, so no request carries anything that could be sent
 * again to read or change the library, past SIGNED_WINDOW_MS. Shared by both,
 * so they can't come to sign different things.
 */

/** How far a request's time may be from the server's: a clock off by a little, not a request kept to send later. */
const SIGNED_WINDOW_MS = 5 * 60_000

/** Whether a signed request's time, as sent, is that close to `now`. */
export const inSignedWindow = (time: number, now: number) => Number.isFinite(time) && Math.abs(now - time) <= SIGNED_WINDOW_MS

/** A public key or a signature, in base64url: Ed25519's are 32 and 64 bytes. */
export const PUBLIC_KEY = new RegExp(`^${KEY_SHAPE}$`)
// A signature's last character carries two of its bits and four that decoding drops, so sixteen spellings decode
// to one signature. Only the one `base64url` writes is taken: any other verified too, and was new to the library's
// record of signatures already used (worker/library `taken`), so one caught request went through fifteen times more.
export const SIGNATURE = /^[A-Za-z0-9_-]{85}[AQgw]$/

/** Everything a request is: whose library, what it does to it, when, and what it sends. */
export function signedMessage(request: { id: string; method: string; path: string; time: number; bodyHash: string }): string {
  return ['nib-sync-signed/1', request.id, request.method.toUpperCase(), request.path, String(request.time), request.bodyHash].join('\n')
}

/**
 * The public half of the key a code's coins are signed with, in base64url: the one the app checks them with
 * (src/lib/codes), and the one the server holds its own key to before it counts a code's use (worker/coins).
 */
export const COINS_PUBLIC_KEY = '0fKXous5pFTygx6Z1pLCWQyHtOsV6qV0Iwbnb59VPo8'

/** What the server signs for a code's coins (worker/coins), and the app checks (src/lib/codes). Coins already kept were signed as this says. */
export const coinsMessage = (fingerprint: string, claim: string, coins: number) => `nib-coins|${fingerprint}|${claim}|${coins}`

/**
 * What a library says of its inbox's address, for a device to see it is its own (src/sync/inbox `own`): a hash of
 * the hash of the address's secret. Not that hash itself, which is what setting an inbox asks for (worker/library
 * `setInbox`): told it, whoever had caught a request could keep the writer's address and change the key.
 */
export const inboxCheck = (addressHash: string) => bodyHash(new Uint8Array(new TextEncoder().encode(`nib-inbox-address|${addressHash}`)))

export async function bodyHash(body: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', body))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifySignature(publicKey: string, signature: string, message: string): Promise<boolean> {
  if (!PUBLIC_KEY.test(publicKey) || !SIGNATURE.test(signature)) return false
  try {
    const key = await crypto.subtle.importKey('raw', fromBase64url(publicKey), { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, fromBase64url(signature), new TextEncoder().encode(message))
  } catch {
    return false
  }
}
