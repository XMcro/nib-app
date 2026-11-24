import { afterEach, describe, expect, it, vi } from 'vitest'
import { fromHere, parseJson, readBytes, TooLarge } from './http'
import { MAX_RECORDS } from './wire.mjs'

/**
 * A request's body, read and parsed (worker/http). Anyone could have the Worker parse 4 MB of brackets, which took
 * fifteen to thirty times that in memory, and a body sent in tiny pieces was held piece by piece, at some 250
 * times its size (the server audit of 2026-11-23).
 */
const bytesOf = (text: string) => new TextEncoder().encode(text)
afterEach(() => vi.restoreAllMocks())

describe('parseJson', () => {
  it('gives up on a body of thousands of brackets before it’s parsed', () => {
    const parse = vi.spyOn(JSON, 'parse')
    expect(parseJson(bytesOf(`{"slug":${'['.repeat(100_000)}${']'.repeat(100_000)}}`))).toBeNull()
    expect(parseJson(bytesOf(`[${'{},'.repeat(100_000)}{}]`))).toBeNull()
    expect(parseJson(bytesOf(`{"a":[${'[],'.repeat(100_000)}[]]}`))).toBeNull()
    expect(parse).not.toHaveBeenCalled()
  })

  it('takes the most records a push can carry, and brackets that are only what someone wrote', () => {
    const records = Array.from({ length: MAX_RECORDS }, (_, n) => ({ k: `key-${n}`, b: n, p: 'AAAA' }))
    expect(parseJson(bytesOf(JSON.stringify({ records })))).toEqual({ records })
    // A note sent to the inbox, of code: its brackets are inside a string, quotes and backslashes and all.
    const text = `${'if (a[0]) { b = [{}] } '.repeat(5_000)}"quoted \\" [still] the text\\\\"`
    expect(parseJson(bytesOf(JSON.stringify({ title: '[x]', text })))).toEqual({ title: '[x]', text })
  })

  it('is null for what isn’t an object, as before', () => {
    expect(parseJson(bytesOf('not json'))).toBeNull()
    expect(parseJson(bytesOf('"a string"'))).toBeNull()
    expect(parseJson(bytesOf('7'))).toBeNull()
    expect(parseJson(bytesOf('{"a":1}'))).toEqual({ a: 1 })
  })
})

// Xcode's test purchases are taken only from there (worker/index): told by the request's host, `wrangler dev` itself
// was not there, since it gives a request its route's host.
describe('a request from the developer’s own machine or network', () => {
  const from = (ip?: string) => fromHere(new Request('https://share.nibprivacy.com/v1/library', { headers: ip === undefined ? {} : { 'CF-Connecting-IP': ip } }))
  it('is told by where Cloudflare says it came from, and by nothing a request can say for itself', () => {
    expect(['127.0.0.1', '::1', '10.0.0.7', '192.168.1.20', '172.16.0.1', '172.31.255.255'].map(from)).toEqual(Array(6).fill(true))
    expect([undefined, '', '203.0.113.7', '172.15.0.1', '172.32.0.1', '11.0.0.1', '2001:db8::1', '::10', '1127.0.0.1', '192.169.0.1'].map(from)).toEqual(Array(10).fill(false))
    expect(fromHere(new Request('http://localhost:8787/v1/library', { headers: { Host: 'localhost', 'X-Forwarded-For': '127.0.0.1', 'CF-Connecting-IP': '198.51.100.4' } }))).toBe(false)
  })
})

describe('readBytes', () => {
  /** A body that comes `size` bytes at a time, and how many times it was read. */
  function streamed(bytes: Uint8Array, size: number, headers: Record<string, string> = {}) {
    let at = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= bytes.length) return controller.close()
        controller.enqueue(bytes.slice(at, (at += size)))
      },
    })
    return new Request('https://nib.test/v1/shares', { method: 'POST', body, headers, duplex: 'half' } as RequestInit)
  }
  const pattern = (length: number) => Uint8Array.from({ length }, (_, n) => (n * 31 + 7) % 251)

  it('reads a body whole, however it comes: in one piece, in single bytes, or with no length said', async () => {
    const bytes = pattern(70_000)
    expect(await readBytes(streamed(bytes, 70_000, { 'Content-Length': '70000' }), 100_000)).toEqual(bytes)
    expect(await readBytes(streamed(bytes, 1), 100_000)).toEqual(bytes)
    expect(await readBytes(streamed(bytes, 4_097), 100_000)).toEqual(bytes)
    // A length said short of what comes is no limit, and no harm.
    expect(await readBytes(streamed(bytes, 1_000, { 'Content-Length': '10' }), 100_000)).toEqual(bytes)
    expect(await readBytes(new Request('https://nib.test/v1/shares'), 100)).toEqual(new Uint8Array())
  })

  // Given a buffer of the length it said before any of it came, a request that said 4 MB and sent nothing was
  // given 4 MB to wait in: eight of them, 32 MB, from anyone (found checking the fix, 2026-11-23).
  it('holds nothing for the length a body only says it has', async () => {
    const before = process.memoryUsage().arrayBuffers
    const waiting: Promise<unknown>[] = []
    const bodies: ReadableStreamDefaultController<Uint8Array>[] = []
    for (let n = 0; n < 8; n++) {
      const body = new ReadableStream<Uint8Array>({ start: (controller) => void bodies.push(controller) })
      const request = new Request('https://nib.test/v1/shares', { method: 'POST', body, headers: { 'Content-Length': '4010000' }, duplex: 'half' } as RequestInit)
      waiting.push(readBytes(request, 4_010_000))
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(2_000_000)
    for (const body of bodies) body.close()
    expect(await Promise.all(waiting)).toEqual(Array(8).fill(new Uint8Array()))
  })

  it('reads one that grows its buffer many times over, and the length it said exactly', async () => {
    const bytes = pattern(3_000_000)
    const same = (read: Uint8Array) => Buffer.from(read).equals(Buffer.from(bytes))
    expect(same(await readBytes(streamed(bytes, 65_536, { 'Content-Length': '3000000' }), 16_000_000))).toBe(true)
    expect(same(await readBytes(streamed(bytes, 999_999), 3_000_000))).toBe(true)
  })

  it('takes a body up to its limit and no further, whatever its length is said to be', async () => {
    const bytes = pattern(1_000)
    expect((await readBytes(streamed(bytes, 100), 1_000)).length).toBe(1_000)
    await expect(readBytes(streamed(pattern(1_001), 100), 1_000)).rejects.toBeInstanceOf(TooLarge)
    await expect(readBytes(streamed(bytes, 100, { 'Content-Length': '1001' }), 1_000)).rejects.toBeInstanceOf(TooLarge)
  })
})
