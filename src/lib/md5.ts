/**
 * MD5 (RFC 1321), for one job: an Evernote export names each picture by the
 * MD5 of its bytes (`<en-media hash>`), and carries no other link between a
 * note and its resources. Web Crypto leaves MD5 out because it is broken for
 * security, so it is written out here. Use it for nothing that needs to resist
 * an attacker.
 */

/** Rotation amounts, four per round, repeated across that round's sixteen steps. */
const SHIFTS = [
  [7, 12, 17, 22],
  [5, 9, 14, 20],
  [4, 11, 16, 23],
  [6, 10, 15, 21],
]

/** The RFC's table: the integer part of 2^32 × |sin(i + 1)|. */
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32))

/** Lowercase hex, as Evernote writes it. */
export function md5(bytes: Uint8Array): string {
  // A 1 bit, zeros up to 8 bytes short of a 64-byte block, then the length in
  // bits as a little-endian 64-bit number.
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, (bytes.length * 8) >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(bytes.length / 2 ** 29), true)

  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]
  const words = new Array<number>(16)
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getInt32(block + i * 4, true)
    let [a, b, c, d] = state
    for (let i = 0; i < 64; i++) {
      const round = i >> 4
      let mix: number
      let word: number
      if (round === 0) {
        mix = (b & c) | (~b & d)
        word = i
      } else if (round === 1) {
        mix = (d & b) | (~d & c)
        word = (5 * i + 1) % 16
      } else if (round === 2) {
        mix = b ^ c ^ d
        word = (3 * i + 5) % 16
      } else {
        mix = c ^ (b | ~d)
        word = (7 * i) % 16
      }
      const sum = (a + mix + K[i] + words[word]) | 0
      const shift = SHIFTS[round][i & 3]
      a = d
      d = c
      c = b
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0
    }
    state[0] = (state[0] + a) | 0
    state[1] = (state[1] + b) | 0
    state[2] = (state[2] + c) | 0
    state[3] = (state[3] + d) | 0
  }

  const out = new DataView(new ArrayBuffer(16))
  state.forEach((word, i) => out.setInt32(i * 4, word, true))
  return Array.from(new Uint8Array(out.buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
