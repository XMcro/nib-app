import { useEffect, useReducer } from 'react'
import Dexie, { type EntityTable } from 'dexie'
import type { JSONContent } from '@tiptap/react'
import { argon2idAsync } from '@noble/hashes/argon2.js'
import type { Item, Vault } from '../db/db'
import { base64url, fromBase64url } from '../../worker/base64'
import { withoutOriginals } from './image'
import { titleOf } from './text'
import { nameOf } from './fountain'

/**
 * The vault (Nib Plus): chosen notes and pages, encrypted with a passcode of
 * their own, apart from Lock Nib. A locked document's text is sealed, and what
 * is stored, synced and backed up is that ciphertext beside an empty body. So
 * everything that reads bodies (search, exports, word counts, a shared draft)
 * finds nothing to give away, without having to know the vault exists.
 *
 * One passcode for the vault. Its key is made from the passcode and a salt
 * that every locked document carries, so another device with the same
 * passcode opens them all. The key is held in memory only while the vault is
 * open, and forgotten when Nib goes to the background. Nib can't recover a
 * forgotten passcode, and nor can anyone else.
 */

/** What the passcode dialog is asked for. */
export type VaultMode = 'create' | 'open' | 'change'

/** What a locked document's body is: nothing, as far as anything else can tell. */
export const LOCKED_BODY: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

/** Sealed in the vault, or a copy from sync waiting for the vault to seal it (Item `unsealed`). */
export const isLocked = (item: { vault?: Vault | null; unsealed?: unknown }) => Boolean(item.vault || item.unsealed)

// For a new passcode only. A copy of the library (a backup, the app's file, a
// Mac's storage) can be guessed against offline, and four digits fall in under
// a second. A vault made before this still opens with the passcode it has,
// and each time asks for a longer one (App `answerVault`).
export const MIN_PASSCODE = 8
export const MAX_PASSCODE = 200
/** As for a share's password: OWASP's count for PBKDF2-SHA256. A vault from before Argon2id. */
const ROUNDS = 600_000
/**
 * Argon2id, for a vault from now on: each guess at a passcode, against a copy
 * of the library, costs 46 MiB as well as time, which a GPU can't spread
 * across thousands at once as it can PBKDF2. OWASP's first recommendation;
 * about half a second on a phone, in JavaScript (no WebAssembly, which the
 * page's policy would have to allow, and iOS 15 can't).
 */
const ARGON = { m: 47_104, t: 1, p: 1, dkLen: 32 }
/**
 * The first byte of a salt made for Argon2id (newSalt): the vault is stored
 * and synced as it was, so a Nib from before keeps it as it is. A salt from
 * before is PBKDF2's, and starts with it 1 time in 256: that one is tried
 * with PBKDF2 too (openVault).
 */
const ARGON_MARK = 0xa2
const marked = (salt: string) => fromBase64url(salt)[0] === ARGON_MARK

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const bound = (id: string) => encoder.encode(`nib-vault/${id}`)

export class VaultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultError'
  }
}

/** What `seal` and `box` write, by its shape. */
export const isCiphertext = (text: string) => /^[A-Za-z0-9_-]{24,}$/.test(text)

/** A vault record from storage, a backup or another device: well formed, or nothing. */
export function asVault(raw: unknown): Vault | null | undefined {
  if (raw === null) return null
  const vault = raw as Partial<Vault> | undefined
  if (!vault || typeof vault.salt !== 'string' || typeof vault.sealed !== 'string') return undefined
  if (!/^[A-Za-z0-9_-]{22}$/.test(vault.salt) || !isCiphertext(vault.sealed)) return undefined
  return { salt: vault.salt, sealed: vault.sealed }
}

// The open vault: one key per salt, which is one per passcode set.
const keys = new Map<string, CryptoKey>()
// Titles of locked documents, known only while the vault is open.
const titles = new Map<string, string>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())
// Counted at each shutting, so a key that was still being made through one isn't taken up after it.
let shuttings = 0

export const vaultOpen = () => keys.size > 0
export const lockedTitle = (id: string) => titles.get(id)
/** What a list calls a document: a locked note's title is known only while the vault is open. */
export const shownTitle = (item: Item) => (isLocked(item) ? (lockedTitle(item.id) ?? 'Locked') : nameOf(item))

export function onVaultChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The key `passcode` makes with `salt`: by Argon2id if the salt is marked for it, unless `pbkdf2` says otherwise. */
async function makeKey(passcode: string, salt: string, pbkdf2 = !marked(salt)): Promise<CryptoKey> {
  if (!pbkdf2) {
    const bits = await argon2idAsync(passcode.normalize('NFC'), fromBase64url(salt), { ...ARGON, asyncTick: 10 })
    return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt'])
  }
  const secret = await crypto.subtle.importKey('raw', encoder.encode(passcode.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64url(salt), iterations: ROUNDS },
    secret,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Why a new passcode won't do, or null. Digits alone, or a few characters
 * over and over, are guessed against a copy of the library in hours, however
 * long they are. A vault set before these were asked for still opens with its
 * passcode, and each time asks for a better one (App `answerVault`).
 */
export function checkPasscode(passcode: string): string | null {
  if (passcode.length < MIN_PASSCODE) return `At least ${MIN_PASSCODE} characters.`
  if (passcode.length > MAX_PASSCODE) return 'That’s longer than a passcode needs to be.'
  if (/^\d+$/.test(passcode)) return 'Use letters or symbols too, not digits alone.'
  if (new Set(passcode).size < 4) return 'Use more different characters.'
  return null
}

/** A salt for a new vault, the first passcode set or a changed one: marked for Argon2id. */
export function newSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[0] = ARGON_MARK
  return base64url(bytes)
}

async function encrypt(key: CryptoKey, id: string, body: JSONContent): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bound(id) }, key, encoder.encode(JSON.stringify(body)))
  const out = new Uint8Array(12 + cipher.byteLength)
  out.set(iv)
  out.set(new Uint8Array(cipher), 12)
  return base64url(out)
}

async function decrypt(key: CryptoKey, id: string, sealed: string): Promise<JSONContent> {
  const bytes = fromBase64url(sealed)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: bound(id) }, key, bytes.slice(12))
  return JSON.parse(decoder.decode(plain)) as JSONContent
}

/**
 * Where this device keeps its key for copies (`box`): a database of its own,
 * apart from the library, so nothing the library is copied into (a backup,
 * the app's file, sync) carries it. The key can't be read out, and WebKit,
 * in the app and Safari, seals a stored key under one of its own in the
 * Keychain.
 */
const device = new Dexie('nib-device') as Dexie & { keys: EntityTable<{ k: string; key: CryptoKey }, 'k'> }
device.version(1).stores({ keys: 'k' })
let copiesKey: Promise<CryptoKey> | undefined

async function makeCopiesKey(): Promise<CryptoKey> {
  // Made outside the transaction, which an await on anything but the
  // database would end. Inside it, a second tab's key, if first, is kept.
  const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return device.transaction('rw', device.keys, async () => {
    const stored = await device.keys.get('copies')
    if (stored) return stored.key
    await device.keys.add({ k: 'copies', key: fresh })
    return fresh
  })
}

const deviceKey = () =>
  (copiesKey ??= makeCopiesKey().catch((error: unknown) => {
    copiesKey = undefined
    throw error
  }))

/**
 * An edit a lock beat, kept while the vault is shut (Item `unsealed`): sealed
 * under this device's key until the vault opens here and seals it as its own
 * (db/items `sealCopies`). So it is never in the clear, in the library, a
 * backup or the app's file, though the vault's passcode isn't known.
 */
export async function box(id: string, body: JSONContent): Promise<string> {
  return encrypt(await deviceKey(), id, body)
}

/** A boxed copy's text; null where this device's key can't open it, as after a restore on another device. */
export async function unbox(id: string, boxed: string): Promise<JSONContent | null> {
  return decrypt(await deviceKey(), id, boxed).catch(() => null)
}

type Locked = { id: string; vault: Vault }

/**
 * Opens the vault with `passcode`, proved against the locked documents there
 * are (any one will do; all that share its salt then open). With none locked
 * yet, it starts a new vault with this passcode. Learns every title it can.
 */
export async function openVault(passcode: string, locked: Locked[]): Promise<void> {
  const problem = checkPasscode(passcode)
  if (problem && !locked.length) throw new VaultError(problem)
  const salts = [...new Set(locked.map((item) => item.vault.salt))]
  // A key takes half a second to make. Shut in that time, as Nib left the screen or Lock Nib covered it, the
  // vault was opened all the same once the key was made, and stayed open: so the keys are taken up only if not.
  const began = shuttings
  const made = new Map<string, CryptoKey>()
  if (!salts.length) {
    const salt = newSalt()
    made.set(salt, await makeKey(passcode, salt))
  }
  for (const salt of salts) {
    const sealed = locked.filter((item) => item.vault.salt === salt)
    // A marked salt is Argon2id's, or 1 time in 256 one from before that's PBKDF2's.
    for (const pbkdf2 of marked(salt) ? [false, true] : [true]) {
      const key = await makeKey(passcode, salt, pbkdf2)
      // Opening none of them, it's another passcode's, from before a change on a device not yet synced.
      if (await opensAny(key, sealed)) {
        made.set(salt, key)
        break
      }
    }
  }
  if (!made.size) throw new VaultError('That passcode doesn’t open the vault.')
  if (began !== shuttings) throw new Error('Nib: the vault was shut while it was being opened')
  for (const [salt, key] of made) keys.set(salt, key)
  await learnTitles(locked)
  changed()
}

/** Whether `key` opens any of them. Any, as one damaged record tried alone kept the right passcode from opening the rest. */
async function opensAny(key: CryptoKey, sealed: Locked[]): Promise<boolean> {
  for (const item of sealed) {
    if (await decrypt(key, item.id, item.vault.sealed).then(() => true, () => false)) return true
  }
  return false
}

async function learnTitles(locked: Locked[]) {
  for (const item of locked) {
    const key = keys.get(item.vault.salt)
    if (!key) continue
    try {
      const title = titleOf(await decrypt(key, item.id, item.vault.sealed))
      // Not if the vault shut while it was read.
      if (keys.get(item.vault.salt) === key) titles.set(item.id, title)
    } catch {
      // Damaged or tampered with: it stays "Locked".
    }
  }
}

/** Forgets the key and every title: the vault is shut until the passcode is given again. */
export function closeVault() {
  shuttings += 1
  if (!keys.size && !titles.size) return
  keys.clear()
  titles.clear()
  changed()
}

/** The salt new locks use: the open vault's newest key. */
function currentSalt(): string {
  const salt = [...keys.keys()].at(-1)
  if (!salt) throw new VaultError('The vault is locked.')
  return salt
}

/** Seals `body` for document `id` with the open vault's key. */
export async function seal(id: string, body: JSONContent, salt = currentSalt()): Promise<Vault> {
  const key = keys.get(salt)
  if (!key) throw new VaultError('The vault is locked.')
  // Without its pictures' originals: they are files kept in the clear, beside the library, which a lock would not cover.
  const vault = { salt, sealed: await encrypt(key, id, withoutOriginals(body)) }
  // Not if the vault shut while it was sealed: its title would be the one still known.
  if (keys.get(salt) === key) {
    titles.set(id, titleOf(body))
    changed()
  }
  return vault
}

/** The text of a locked document, if the vault is open to it. */
export async function unseal(id: string, vault: Vault): Promise<JSONContent | null> {
  const key = keys.get(vault.salt)
  if (!key) return null
  return decrypt(key, id, vault.sealed)
}

/**
 * Re-seals every locked document under a new passcode. The caller writes the
 * new seals back, then calls `adopt`: until then the vault keeps the passcode
 * in use, so seals that fail to save leave everything opening as before.
 * Everything must open with the vault as it is first, or nothing changes: a
 * document left under the old passcode would be lost to the new one.
 */
export async function changePasscode(passcode: string, locked: Locked[]): Promise<{ sealed: Map<string, Vault>; adopt: () => void }> {
  const problem = checkPasscode(passcode)
  if (problem) throw new VaultError(problem)
  const bodies = new Map<string, JSONContent>()
  for (const item of locked) {
    const body = await unseal(item.id, item.vault).catch(() => null)
    if (!body) throw new VaultError('Open the vault first. Every locked note has to open before the passcode can change.')
    bodies.set(item.id, body)
  }
  const salt = newSalt()
  const key = await makeKey(passcode, salt)
  const sealed = new Map<string, Vault>()
  for (const [id, body] of bodies) sealed.set(id, { salt, sealed: await encrypt(key, id, body) })
  const adopt = () => {
    keys.clear()
    keys.set(salt, key)
    changed()
  }
  return { sealed, adopt }
}

/** Re-renders when the vault opens or closes, or a locked title changes. */
export function useVault() {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => onVaultChange(rerender), [])
}

