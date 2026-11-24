// @ts-check

/**
 * What the app, the Worker and scripts/coin-code.mjs must agree on, each said
 * once: the limits, the shapes of ids and keys, what a code's refusals are
 * called, and the records that go between them. Plain JavaScript, with its
 * types in comments, so Node can run the script with it as it is; it imports
 * nothing, so all of them can take it. (worker/signing is the same for what
 * gets signed.)
 *
 * Some of this is out in the world and can't change: codes given out, the
 * slugs and keys in share links, the records on the server.
 */

/** So many bytes in base64url, unpadded, as part of a pattern: what worker/base64 `base64url` makes of them. */
const base64urlOf = (/** @type {number} */ bytes) => `[A-Za-z0-9_-]{${Math.ceil((bytes * 4) / 3)}}`

/** A share's slug: 128 bits. */
export const SLUG_BYTES = 16
export const SLUG_SHAPE = base64urlOf(SLUG_BYTES)
/** 256 bits: a link's key, a share's owner token, a sync request's secret, an Ed25519 public key, a record's name (an HMAC-SHA256, src/sync/crypto.ts `recordKey`). */
export const KEY_BYTES = 32
export const KEY_SHAPE = base64urlOf(KEY_BYTES)
/** A sync library's id, in hex: 128 bits. */
export const LIBRARY_ID_BYTES = 16
export const LIBRARY_ID_SHAPE = `[0-9a-f]{${LIBRARY_ID_BYTES * 2}}`

export const SHARE_DAYS = [7, 30, 90]
export const DEFAULT_DAYS = 30
/** Without Nib Plus: one live link across the library, read-only, for this long. */
export const FREE_DAYS = 7

/** What the server says of a draft that was to be read once, and has been (worker/share): the reader's page knows it by these words. */
export const READ_ONCE_GONE = 'This draft could be read once, and has been.'

/** Ciphertext bytes per note, which the server enforces: 2 KB. */
export const MAX_NOTE_BYTES = 2048
/** Base64url of 2 KB, the most a note may be. */
export const MAX_NOTE_LENGTH = Math.ceil((MAX_NOTE_BYTES * 4) / 3)
/** Refuse once a document's images would pass this, so one note cannot eat the origin's quota. */
export const DOC_BUDGET = 2 * 1024 * 1024
/** A 2 MB document (DOC_BUDGET), images and all, sealed and in base64url, with room to spare. */
export const MAX_DOC_LENGTH = 4_000_000

/** The most a push may carry, the one route that takes this much (worker/sync). */
export const MAX_BODY = 16_000_000
/** Records in one push, or keys in one expire (worker/sync). */
export const MAX_RECORDS = 1000
/**
 * The most a record can be padded to and still go up in one request: the
 * server takes 16 MB a push (`MAX_BODY`), and base64 is 4/3 of
 * this, plus the IV, the tag and the request around it.
 */
export const MAX_PADDED = 11_900_000
/** One request from the app (src/sync/engine.ts): well under MAX_BODY and MAX_RECORDS. */
export const BATCH_BYTES = 4_000_000
export const BATCH_RECORDS = 200

/** The most one file may be, as it is on a device (src/lib/files). */
export const MAX_FILE = 25 * 1024 * 1024
/** And the most it may be as it's sent, sealed: its IV, its tag, and room to pad it (worker/files). */
export const MAX_SEALED_FILE = MAX_FILE + 1024 * 1024
/** The most one library's files may come to on the server, sealed: 2 GB, beside the 1 GB its records get. */
export const FILES_LIMIT = 2_000_000_000
/** The header a file is sent with: the SHA-256 of what's sent, in hex. A signed request signs it in place of the body's own, so the file is never read whole to check it. */
export const FILE_HASH_HEADER = 'X-Nib-File-Sha256'

/**
 * A record on the wire: key, server sequence, client base, deleted, payload (a delete's is its seal).
 * @typedef {{ k: string; s?: number; b?: number; d?: 1; p?: string }} Wire
 */

/** @typedef {{ k: string; s: number } | { k: string; conflict: number } | { k: string; error: 'full' }} PushResult */

/** The `code` on a 401 to a signed request when a library has no key yet: the one word that gets a signing device's key to the server (src/sync/api). */
export const UNENROLLED = 'unenrolled'

/**
 * `signedOnly`: nothing but signed requests is taken (requireSigned).
 * @typedef {{ entitled: boolean; expiresAt: number | null; bytes: number; signedOnly: boolean }} Status
 */

/**
 * What the server holds of a library's files: each by its key and its sealed size, and how much room they take of how much.
 * @typedef {{ files: { k: string; size: number }[]; bytes: number; limit: number }} FileList
 */

/** An inbox's public key (worker/inbox-seal): a P-256 point as it's written out whole, 65 bytes, in base64url. */
export const INBOX_KEY_SHAPE = base64urlOf(65)
/** The most a post to an inbox may be, as it's sent (worker/inbox): 100 KB. */
export const MAX_POST = 100_000
/** Posts an inbox holds until a device takes them, and posts it takes in a day (UTC). */
export const INBOX_WAITING = 200
export const INBOX_DAILY = 200
/**
 * A clip from Nib's browser extension comes sealed already (worker/inbox-seal), in the browser it was clipped in, and says so by its type.
 * The most one may be as it's sent, in base64: room for a long page's text, and still one row of the library's database.
 */
export const SEALED_TYPE = 'application/nib-sealed'
export const MAX_SEALED_POST = 1_000_000
/** What an inbox's waiting posts may come to in all, sealed and in base64. */
export const INBOX_BYTES = 20_000_000
/** How long a post no device has taken is kept, sealed, before the server deletes it (site/privacy.html). */
export const INBOX_DAYS = 30
/** The most what an inbox's devices keep with it may be, sealed and in base64: a key and a secret, padded to 1 KB, with room to spare. */
export const MAX_INBOX_KEPT = 4096

/**
 * What a device is told of its inbox: whether there is one, what its devices keep with it (`kept`: the key that opens its posts and
 * its address's secret, sealed by a device as its records are, src/sync/inbox), and the posts waiting, oldest first, each sealed
 * (worker/inbox-seal) with when it came.
 * @typedef {{ on: boolean; kept?: string; key?: string; check?: string; posts: { id: number; at: number; p: string }[]; more: boolean }} Inbox
 */

/** Why a code gives no coins, and the status the server says it with. 'too many': as many codes as the server takes from one network in a day. */
export const COIN_REFUSED = /** @type {const} */ ({ unknown: 404, ended: 410, 'used up': 409, 'too many': 429 })

/** @typedef {keyof typeof COIN_REFUSED} CoinRefusal */

/** The refusal a status means, if it means one. */
export function coinRefusal(/** @type {number} */ status) {
  return /** @type {CoinRefusal[]} */ (Object.keys(COIN_REFUSED)).find((word) => COIN_REFUSED[word] === status)
}

/** A code as it's checked: capitals, and nothing but letters and digits, so spaces and dashes don't matter. */
export const normalCode = (/** @type {string} */ code) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** What's hashed for a code's fingerprint, all the server knows of it. Every code given out depends on this. */
export const fingerprintInput = (/** @type {string} */ code) => `nib-coins:${normalCode(code)}`

/** The most coins a code can give. */
export const MAX_COINS = 1_000_000

/** The app's own id for one attempt at a code, as the server takes it. */
export const CLAIM = /^[A-Za-z0-9-]{8,64}$/
export const newClaim = () => crypto.randomUUID()

/** The day (UTC) a moment is in, as YYYY-MM-DD: what a code's last day and a day's counts are counted by. */
export const utcDay = (/** @type {number} */ now) => new Date(now).toISOString().slice(0, 10)

/** Midnight UTC after `now`, when a day's count goes. */
export const endOfDay = (/** @type {number} */ now) => Math.floor(now / 86_400_000 + 1) * 86_400_000

const DAY = /^\d{4}-\d{2}-\d{2}$/
/** A day as YYYY-MM-DD that the calendar has: not 2026-99-99, nor 31 February. */
export const realDay = (/** @type {string} */ day) => DAY.test(day) && !Number.isNaN(Date.parse(day)) && utcDay(Date.parse(day)) === day
