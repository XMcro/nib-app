import { describe, expect, it } from 'vitest'
import { MAX_BODY } from '../../worker/wire.mjs'
import { deriveKeys, newCode, open, padded, parseCode, recordKey, seal, type SyncKeys } from './crypto'

const encoder = new TextEncoder()
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0))

/** `seal` as every Nib before padding had it: the record at its exact size. */
async function sealUnpadded(keys: SyncKeys, key: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = encoder.encode(JSON.stringify(value))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(key) }, keys.encrypt, plain))
  return btoa(String.fromCharCode(...iv, ...cipher))
}

/** `open` as every Nib before padding had it, which those still out there will use. */
async function openUnpadded(keys: SyncKeys, key: string, payload: string): Promise<unknown> {
  const bytes = fromBase64(payload)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: encoder.encode(key) }, keys.encrypt, bytes.subarray(12))
  return JSON.parse(new TextDecoder().decode(plain))
}

/** What the server sees of a record's plaintext: the payload, less the IV and the tag. */
const sealedLength = (payload: string) => fromBase64(payload).length - 12 - 16

describe('sync codes', () => {
  it('are six groups of four, and read back as themselves', () => {
    const code = newCode()
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(parseCode(code)).toBe(code)
  })

  it('forgive the mistakes people make copying them', () => {
    const code = '0123-4567-89AB-CDEF-GHJK-MNPQ'
    expect(parseCode(' 0123 4567 89ab cdef ghjk mnpq ')).toBe(code)
    expect(parseCode('O123-4567-89AB-CDEF-GHJK-MNPQ')).toBe(code)
    expect(parseCode('0123-4567-89AB')).toBeNull()
    expect(parseCode('0123-4567-89AB-CDEF-GHJK-MNPU')).toBeNull()
  })

  it('derive the same library on every device, and a different one for a different code', async () => {
    const code = newCode()
    const [a, b, other] = await Promise.all([deriveKeys(code), deriveKeys(code), deriveKeys(newCode())])
    expect(a.libraryId).toMatch(/^[0-9a-f]{32}$/)
    expect(a.secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(b.libraryId).toBe(a.libraryId)
    expect(b.secret).toBe(a.secret)
    expect(other.libraryId).not.toBe(a.libraryId)
    expect(await recordKey(a, 'item', 'x')).toBe(await recordKey(b, 'item', 'x'))
    expect(await recordKey(a, 'item', 'x')).not.toBe(await recordKey(a, 'revision', 'x'))
  })
})

describe('sealed records', () => {
  it('open on another device with the same code', async () => {
    const code = newCode()
    const [phone, iPad] = await Promise.all([deriveKeys(code), deriveKeys(code)])
    const payload = await seal(phone, 'k1', { hello: 'world' })
    expect(payload).not.toContain('world')
    expect(await open(iPad, 'k1', payload)).toEqual({ hello: 'world' })
  })

  it('do not open with a different code, or under a different record name', async () => {
    const keys = await deriveKeys(newCode())
    const payload = await seal(keys, 'k1', { secret: true })
    await expect(open(await deriveKeys(newCode()), 'k1', payload)).rejects.toThrow()
    await expect(open(keys, 'k2', payload)).rejects.toThrow()
  })

  it('carry a 2 MB document', async () => {
    const keys = await deriveKeys(newCode())
    const big = { body: 'x'.repeat(2_000_000) }
    expect(await open(keys, 'big', await seal(keys, 'big', big))).toEqual(big)
  })
})

describe('padded records', () => {
  it('round up to the next KiB, then from 16 KiB to the next power of two', () => {
    expect(padded(0)).toBe(1024)
    expect(padded(1)).toBe(1024)
    expect(padded(1024)).toBe(1024)
    expect(padded(1025)).toBe(2048)
    expect(padded(5000)).toBe(5120)
    expect(padded(16 * 1024)).toBe(16 * 1024)
    expect(padded(16 * 1024 + 1)).toBe(32 * 1024)
    expect(padded(32 * 1024)).toBe(32 * 1024)
    expect(padded(32 * 1024 + 1)).toBe(64 * 1024)
    expect(padded(200_000)).toBe(256 * 1024)
    expect(padded(5_000_000)).toBe(8 * 1024 * 1024)
    expect(padded(8 * 1024 * 1024)).toBe(8 * 1024 * 1024)
  })

  it('stop where a record could no longer be sent, and leave one past it as it is', async () => {
    const top = padded(8 * 1024 * 1024 + 1)
    expect(top).toBeLessThan(16 * 1024 * 1024)
    expect(padded(top - 1)).toBe(top)
    expect(padded(top + 1)).toBe(top + 1)
    const keys = await deriveKeys(newCode())
    const k = await recordKey(keys, 'item', 'x')
    const p = await seal(keys, k, { body: 'x'.repeat(top - 20) })
    expect(sealedLength(p)).toBe(top)
    // The biggest padded record, alone in a push, fits under what the server takes.
    expect(JSON.stringify({ records: [{ k, b: Number.MAX_SAFE_INTEGER, d: 1, p }] }).length).toBeLessThanOrEqual(MAX_BODY)
  })

  it('show the server only the bucket, whatever the length inside it', async () => {
    const keys = await deriveKeys(newCode())
    const sizes = await Promise.all([10, 900, 1100, 2000, 20_000, 30_000].map(async (n) => sealedLength(await seal(keys, 'k', { body: 'x'.repeat(n) }))))
    expect(sizes).toEqual([1024, 1024, 2048, 2048, 32 * 1024, 32 * 1024])
  })

  it('open as they were sealed, the text and every character in it', async () => {
    const keys = await deriveKeys(newCode())
    const value = { t: 'item', v: { body: 'Ünïcödé ✍️ and "quotes"\n', trailing: '   ' }, n: 3 }
    expect(await open(keys, 'k', await seal(keys, 'k', value))).toEqual(value)
  })

  it('open in a Nib from before padding', async () => {
    const keys = await deriveKeys(newCode())
    const value = { t: 'revision', v: { body: 'y'.repeat(20_000) } }
    expect(await openUnpadded(keys, 'k', await seal(keys, 'k', value))).toEqual(value)
  })

  it('leave records sealed before padding opening as they did', async () => {
    const keys = await deriveKeys(newCode())
    const value = { t: 'gone', n: 7 }
    const old = await sealUnpadded(keys, 'k', value)
    expect(sealedLength(old)).toBe(JSON.stringify(value).length)
    expect(await open(keys, 'k', old)).toEqual(value)
  })
})
