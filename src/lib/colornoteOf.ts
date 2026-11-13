import { md5 } from './md5'

/**
 * Writes a ColorNote backup, for the tests of what opens one (lib/colornote),
 * as real backups of 2024 and 2026 are made: the header, then, encrypted as
 * ColorNote encrypts with `password`, a section of the account (`account`,
 * where a newer backup has one) and a section of the notes, each a kind, a
 * count and its records, a record being JSON after its length. Bytes among
 * the notes are written as they are, counted as a record, for a backup that
 * doesn't add up.
 */
const encoder = new TextEncoder()
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16))
const joined = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
const chunk = (value: unknown) => {
  const text = encoder.encode(JSON.stringify(value))
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, text.length)
  return joined(length, text)
}

const section = (kind: number, count: number) => {
  const head = new Uint8Array(8)
  new DataView(head.buffer).setUint32(0, kind)
  new DataView(head.buffer).setUint32(4, count)
  return head
}

export const colornoteOf = (notes: unknown[], password = '0000', account?: unknown) =>
  sealedOf(joined(section(1, account === undefined ? 0 : 1), ...(account === undefined ? [] : [chunk(account)]), section(2, notes.length), ...notes.map((note) => (note instanceof Uint8Array ? note : chunk(note)))), password, notes.length)

/** A backup of whatever `plain` is, encrypted as ColorNote encrypts: for one that opens and isn't what a backup holds. */
export async function sealedOf(plain: Uint8Array<ArrayBuffer>, password = '0000', count = 0): Promise<Uint8Array<ArrayBuffer>> {
  const key = fromHex(md5(joined(encoder.encode(password), encoder.encode('ColorNote Fixed Salt'))))
  const aes = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt'])
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, aes, plain))
  const header = new Uint8Array(28)
  header.set([0, 0x4e, 0, 0x4f, 0, 0x54, 0, 0x45])
  const view = new DataView(header.buffer)
  view.setUint32(8, 7)
  view.setUint32(12, 1)
  view.setBigUint64(16, 1728922218086n)
  view.setUint32(24, count)
  return joined(header, sealed)
}
