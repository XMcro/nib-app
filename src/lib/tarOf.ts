/**
 * Writes a tar, for the tests of what reads one (lib/tar): plain ustar
 * entries, as Joplin's export has, and before one, where asked, the pax
 * record or GNU long name that Google Takeout and other writers put there.
 */
export type TarFile = { name: string; data?: string | Uint8Array; type?: string; pax?: Record<string, string>; longName?: string; prefix?: string }

const encoder = new TextEncoder()

function header(name: string, size: number, type: string, prefix = ''): Uint8Array {
  const block = new Uint8Array(512)
  const put = (text: string, at: number) => block.set(encoder.encode(text), at)
  put(name, 0)
  put('0000644\0', 100)
  put('0000000\0', 108)
  put('0000000\0', 116)
  put(`${size.toString(8).padStart(11, '0')}\0`, 124)
  put('00000000000\0', 136)
  put('        ', 148)
  put(type, 156)
  put('ustar\x0000', 257)
  put(prefix, 345)
  put(`${block.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `, 148)
  return block
}

function entry(name: string, data: Uint8Array, type: string, prefix?: string): Uint8Array[] {
  return [header(name, data.length, type, prefix), data, new Uint8Array((512 - (data.length % 512)) % 512)]
}

export function tarOf(files: TarFile[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = []
  for (const file of files) {
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : (file.data ?? new Uint8Array(0))
    if (file.pax) {
      // Each record says its own length, the digits of that length counted in it.
      const records = Object.entries(file.pax).map(([key, value]) => {
        const rest = ` ${key}=${value}\n`
        let length = encoder.encode(rest).length + 1
        while (String(length).length + encoder.encode(rest).length !== length) length = String(length).length + encoder.encode(rest).length
        return `${length}${rest}`
      })
      parts.push(...entry('./PaxHeaders.X/entry', encoder.encode(records.join('')), 'x'))
    }
    if (file.longName) parts.push(...entry('././@LongLink', encoder.encode(`${file.longName}\0`), 'L'))
    parts.push(...entry(file.name, data, file.type ?? '0', file.prefix))
  }
  parts.push(new Uint8Array(1024))
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
