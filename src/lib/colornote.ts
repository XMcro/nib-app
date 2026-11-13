import { md5 } from './md5'

/**
 * A ColorNote backup, opened. ColorNote has no export but its backup: one
 * file, the notes in it encrypted with a password. The backups it makes by
 * itself all have the same one (`COLORNOTE_AUTOMATIC`); one its owner makes
 * has their master password.
 *
 * ColorNote doesn't document the file. This starts from what others worked
 * out and published (the open-source converters that read it), and was
 * checked against real backups of 2024 and 2026: 28 bytes that say what it
 * is, then AES-128 in CBC mode, the key made by MD5 from the password and a
 * fixed salt, and the first block's vector all zeros. (The converters make a
 * vector from the password too, which leaves the first block unreadable, and
 * look for the first note after it. With zeros the whole of it reads.) Inside
 * are sections, each a kind and a count and then that many records, a record
 * being JSON after its length: first the account, where there is one, then
 * the notes. If ColorNote changes the file, this stops opening it, and says
 * so.
 *
 * It is untrusted, as every import is: nothing is read past the end of what
 * was decrypted, and what doesn't add up ends the reading. Only the notes are
 * taken: the account's record, which holds what signs it in, is passed over.
 */

/** The password of the backups ColorNote makes by itself. */
export const COLORNOTE_AUTOMATIC = '0000'

/** "NOTE", two bytes a letter: how every backup opens. */
const MAGIC = [0, 0x4e, 0, 0x4f, 0, 0x54, 0, 0x45]
/** What comes before the encrypted part: the magic, a version, when it was made and how many notes. */
const HEADER = 28
const SALT = 'ColorNote Fixed Salt'
/** The kind of the section that holds the notes. */
const NOTES = 2

const encoder = new TextEncoder()
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16))
function joined(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export const isColornote = (bytes: Uint8Array) => bytes.length > HEADER && MAGIC.every((byte, at) => bytes[at] === byte)

/**
 * The notes of a backup, as ColorNote keeps them; or null where `password`
 * doesn't open it. MD5 is what ColorNote uses, and is all it is used for
 * here: nothing of Nib's is kept safe by it.
 */
export async function openColornote(bytes: Uint8Array, password: string): Promise<Record<string, unknown>[] | null> {
  const key = fromHex(md5(joined(encoder.encode(password), encoder.encode(SALT))))
  let plain: Uint8Array
  try {
    const aes = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['decrypt'])
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, aes, joined(bytes.subarray(HEADER))))
  } catch {
    // The wrong password leaves an end that doesn't add up.
    return null
  }
  const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength)
  const decoder = new TextDecoder()
  // One time in a few hundred a wrong password adds up by chance: then no section of notes is reached, and that says the same.
  let notes: Record<string, unknown>[] | null = null
  try {
    for (let at = 0; at < plain.length; ) {
      const [kind, count] = [view.getUint32(at), view.getUint32(at + 4)]
      at += 8
      if (kind === NOTES) notes ??= []
      for (let read = 0; read < count; read++) {
        const end = at + 4 + view.getUint32(at)
        if (end > plain.length) throw new RangeError('Past the end')
        const record: unknown = JSON.parse(decoder.decode(plain.subarray(at + 4, end)))
        if (typeof record !== 'object' || record === null || Array.isArray(record)) throw new TypeError('No record')
        if (kind === NOTES) notes!.push(record as Record<string, unknown>)
        at = end
      }
    }
  } catch {
    // A backup cut short or damaged: what was read of its notes before that is what there is.
  }
  return notes
}
