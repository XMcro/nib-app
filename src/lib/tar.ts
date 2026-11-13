/**
 * A tar read: the files in it, each by name with where its bytes lie in the
 * archive. Nothing is copied or unpacked, a tar being its files one after
 * another as they are, so reading one costs no more than walking its headers.
 * It is untrusted: every header must add up, every file must end inside the
 * archive, and the walk stops at `most` records.
 *
 * Read: plain ustar (Joplin's export), the name a pax record or a GNU long
 * name gives the file after it (Google Takeout writes a pax record before
 * every file), and ustar's split names. Folders, links and the rest of what a
 * tar can hold are passed over.
 */
export type TarEntry = { name: string; start: number; size: number }

const BLOCK = 512
const decoder = new TextDecoder()

/** A header's text field: up to its first NUL. */
function field(header: Uint8Array, at: number, length: number): string {
  const part = header.subarray(at, at + length)
  const end = part.indexOf(0)
  return decoder.decode(end < 0 ? part : part.subarray(0, end))
}

/** A number as tar writes one: octal digits. One written in binary (a file past 8 GB) is none Nib reads. */
function octal(header: Uint8Array, at: number, length: number): number {
  const digits = field(header, at, length).trim()
  if (!/^[0-7]*$/.test(digits)) throw new Error('Not a tar')
  return digits ? parseInt(digits, 8) : 0
}

/** A header's sum of its own bytes, the eight of the sum itself counted as spaces: what tells a tar from anything else. */
function adds(header: Uint8Array): boolean {
  let sum = 8 * 32
  for (let i = 0; i < BLOCK; i++) if (i < 148 || i >= 156) sum += header[i]
  return sum === octal(header, 148, 8)
}

/** The path a pax record gives the next file, if it gives one: its records are `<length> <key>=<value>\n`. */
function paxPath(data: Uint8Array): string | undefined {
  let path: string | undefined
  for (let at = 0; at < data.length; ) {
    const space = data.indexOf(32, at)
    const length = space < 0 ? NaN : Number(decoder.decode(data.subarray(at, space)))
    // Each must say a length that takes it forward, and end where it says, at its new line (which a length that is no number never does): else it is no record, and the rest aren't read.
    if (length <= space - at || data[at + length - 1] !== 10) break
    const record = decoder.decode(data.subarray(space + 1, at + length - 1))
    if (record.startsWith('path=')) path = record.slice(5)
    at += length
  }
  return path
}

/** Throws RangeError for more than `most` records, and Error for a tar that isn't one. */
export function tarEntries(bytes: Uint8Array, most: number): TarEntry[] {
  const entries: TarEntry[] = []
  /** The name the record before gave the file that follows. */
  let named: string | undefined
  let records = 0
  for (let at = 0; at + BLOCK <= bytes.length; ) {
    const header = bytes.subarray(at, at + BLOCK)
    // The end is two blocks of nothing; one is enough to stop at.
    if (header.every((byte) => byte === 0)) break
    if (!adds(header)) throw new Error('Not a tar')
    if (++records > most) throw new RangeError('Too many files')
    const size = octal(header, 124, 12)
    const start = at + BLOCK
    if (start + size > bytes.length) throw new Error('Not a tar')
    const type = String.fromCharCode(header[156])
    const data = () => bytes.subarray(start, start + size)
    if (type === 'x') named = paxPath(data()) ?? named
    else if (type === 'L') named = field(data(), 0, size)
    else {
      if (type === '0' || type === '\0') {
        const prefix = field(header, 257, 5) === 'ustar' ? field(header, 345, 155) : ''
        entries.push({ name: named ?? (prefix ? `${prefix}/` : '') + field(header, 0, 100), start, size })
      }
      named = undefined
    }
    at = start + Math.ceil(size / BLOCK) * BLOCK
  }
  if (!records) throw new Error('Not a tar')
  return entries
}
