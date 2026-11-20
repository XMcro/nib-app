import { describe, expect, it, vi } from 'vitest'
import { signedMessage, verifySignature, bodyHash } from '../../worker/signing'
import { deriveKeys, newCode, type SyncKeys } from './crypto'
import { httpApi, MOST_ANSWER, within } from './api'

const BASE = 'https://sync.nib.test'

/** A server that takes signed requests (worker/sync, worker/library), as the app meets it. */
function fakeServer(keys: SyncKeys) {
  let enrolled: string | null = null
  const seen: { path: string; authorization: string }[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.slice(BASE.length)
    const headers = init.headers as Record<string, string>
    const authorization = headers.Authorization
    seen.push({ path, authorization })
    const text = (init.body as string | undefined) ?? ''
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
    const proved = async (key: string) =>
      verifySignature(key, headers['X-Nib-Signature'], signedMessage({ id: keys.libraryId, method: init.method!, path, time: Number(headers['X-Nib-Time']), bodyHash: await bodyHash(new TextEncoder().encode(text)) }))
    if (authorization.startsWith('Signed ')) {
      if (!enrolled) return reply(401, { error: 'No key yet.', code: 'unenrolled' })
      if (!(await proved(enrolled))) return reply(401, { error: 'Not signed for this library.' })
      return reply(200, { records: [], seq: 0, more: false })
    }
    if (authorization !== `Bearer ${keys.libraryId}.${keys.secret}`) return reply(401, { error: 'No.' })
    if (path === '/v1/key') {
      const key = JSON.parse(text).key as string
      if (!(await proved(key))) return reply(401, { error: 'That key isn’t this device’s.' })
      enrolled = key
      return reply(200, { enrolled: true })
    }
    return reply(200, { records: [], seq: 0, more: false, entitled: true, expiresAt: null, bytes: 0 })
  })
  return { fetch, seen }
}

describe('sync requests', () => {
  it('are signed once this device has given the server its key, and carry no secret after', async () => {
    const keys = await deriveKeys(newCode())
    expect(keys.sign?.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const server = fakeServer(keys)
    vi.stubGlobal('fetch', server.fetch)
    const api = httpApi(BASE, keys)
    await api.changes(0)
    await api.push([])
    const after = server.seen.slice(server.seen.findIndex((request) => request.path === '/v1/key') + 1)
    expect(after.length).toBeGreaterThanOrEqual(2)
    expect(after.every((request) => request.authorization === `Signed ${keys.libraryId}`)).toBe(true)
    vi.unstubAllGlobals()
  })

  // Security finding 8 of the 8 November audit: one forged reply, from a proxy on the way, had a device send it the secret.
  it('never answer a signed request’s refusal with the secret', async () => {
    const keys = await deriveKeys(newCode())
    const refused = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ error: 'Missing or malformed sync credentials.' }), { status: 401 }))
    vi.stubGlobal('fetch', refused)
    await expect(httpApi(BASE, keys).changes(0)).rejects.toMatchObject({ status: 401 })
    expect(refused).toHaveBeenCalledOnce()
    expect((refused.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe(`Signed ${keys.libraryId}`)
    vi.unstubAllGlobals()
  })

  // Security finding 8, the rest of it: a device gives its key once per library, recorded on the device, and after that never sends the secret.
  describe('once this device has a key on the library', () => {
    function storage() {
      const kept = new Map<string, string>()
      vi.stubGlobal('localStorage', { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) })
    }
    const unenrolled = (seen: string[]) =>
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push((init.headers as Record<string, string>).Authorization)
        return new Response(JSON.stringify({ error: 'No key yet.', code: 'unenrolled' }), { status: 401 })
      })

    it('never sends the secret for a forged answer that it has none, and says so as an error', async () => {
      storage()
      const keys = await deriveKeys(newCode())
      const server = fakeServer(keys)
      vi.stubGlobal('fetch', server.fetch)
      await httpApi(BASE, keys).changes(0)
      expect(server.seen.some(({ path }) => path === '/v1/key')).toBe(true)
      const seen: string[] = []
      vi.stubGlobal('fetch', unenrolled(seen))
      // A later launch knows it too.
      await expect(httpApi(BASE, keys).changes(0)).rejects.toMatchObject({ status: 401 })
      expect(seen).toEqual([`Signed ${keys.libraryId}`])
      vi.unstubAllGlobals()
    })

    it('counts its signed requests being taken as having one, as on a device enrolled before this was kept', async () => {
      storage()
      const keys = await deriveKeys(newCode())
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ entitled: true, expiresAt: null, bytes: 0 }))))
      await httpApi(BASE, keys).status()
      const seen: string[] = []
      vi.stubGlobal('fetch', unenrolled(seen))
      await expect(httpApi(BASE, keys).status()).rejects.toMatchObject({ status: 401 })
      expect(seen).toEqual([`Signed ${keys.libraryId}`])
      vi.unstubAllGlobals()
    })

    it('doesn’t count a refused one as having a key', async () => {
      storage()
      const keys = await deriveKeys(newCode())
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Down.' }), { status: 500 })))
      await expect(httpApi(BASE, keys).status()).rejects.toMatchObject({ status: 500 })
      const server = fakeServer(keys)
      vi.stubGlobal('fetch', server.fetch)
      await httpApi(BASE, keys).status()
      expect(server.seen.some(({ path }) => path === '/v1/key')).toBe(true)
      vi.unstubAllGlobals()
    })

    it('still gives another library its first key', async () => {
      storage()
      const [one, two] = await Promise.all([deriveKeys(newCode()), deriveKeys(newCode())])
      for (const keys of [one, two]) {
        const server = fakeServer(keys)
        vi.stubGlobal('fetch', server.fetch)
        await httpApi(BASE, keys).changes(0)
        expect(server.seen.some(({ path }) => path === '/v1/key')).toBe(true)
      }
      vi.unstubAllGlobals()
    })

    for (const [made, how] of [['made again under its code', (api: ReturnType<typeof httpApi>) => api.create('receipt')], ['wiped', (api: ReturnType<typeof httpApi>) => api.wipe()]] as const) {
      it(`gives a library ${made} its first key`, async () => {
        storage()
        const keys = await deriveKeys(newCode())
        const before = fakeServer(keys)
        vi.stubGlobal('fetch', before.fetch)
        const api = httpApi(BASE, keys)
        await api.changes(0)
        await how(api)
        const after = fakeServer(keys)
        vi.stubGlobal('fetch', after.fetch)
        await api.changes(0)
        expect(after.seen.some(({ path }) => path === '/v1/key')).toBe(true)
        vi.unstubAllGlobals()
      })
    }
  })

  it('stop when giving the server its key finds no library', async () => {
    const keys = await deriveKeys(newCode())
    const replies = [{ status: 401, body: { error: 'No key yet.', code: 'unenrolled' } }, { status: 404, body: { error: 'No library for that code.' } }]
    const asked = vi.fn(async (_url: string, _init: RequestInit) => {
      const { status, body } = replies.shift()!
      return new Response(JSON.stringify(body), { status })
    })
    vi.stubGlobal('fetch', asked)
    await expect(httpApi(BASE, keys).status()).rejects.toMatchObject({ status: 404 })
    expect(asked).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })

  // An older iOS web view has no Ed25519.
  it('carry the secret from a device that can’t sign, every time', async () => {
    const keys = { ...(await deriveKeys(newCode())), sign: undefined }
    const server = fakeServer(keys)
    vi.stubGlobal('fetch', server.fetch)
    const api = httpApi(BASE, keys)
    await api.changes(0)
    await api.push([])
    expect(server.seen.map((request) => request.authorization)).toEqual(Array(2).fill(`Bearer ${keys.libraryId}.${keys.secret}`))
    await expect(api.requireSigned(true)).rejects.toMatchObject({ status: 400 })
    vi.unstubAllGlobals()
  })

  // The red-team review of 2026-11-17: an answer was read whole, whatever its size, and one of gigabytes ends the page.
  it('read an answer only as far as the most one may be', async () => {
    const bytes = new TextEncoder().encode('x'.repeat(100))
    expect(new TextDecoder().decode(await within(new Response(bytes), 100))).toBe('x'.repeat(100))
    await expect(within(new Response(bytes), 99)).rejects.toThrow('The sync server’s answer was too large.')
    await expect(within(new Response(bytes, { headers: { 'Content-Length': '5000' } }), 4999)).rejects.toThrow('too large')
    expect((await within(new Response(null, { status: 204 }), 10)).length).toBe(0)
  })

  it('refuse an answer past the most one may be, as text or as a file', async () => {
    const keys = await deriveKeys(newCode())
    const huge = new Uint8Array(MOST_ANSWER + 1)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(huge, { headers: { 'Content-Type': 'application/octet-stream' } })))
    const api = httpApi(BASE, { ...keys, sign: undefined })
    await expect(api.getFile('a'.repeat(43))).rejects.toThrow('too large')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(huge)))
    await expect(api.changes(0)).rejects.toThrow('too large')
    vi.unstubAllGlobals()
  })

  it('make a new library the old way: it has no key yet', async () => {
    const keys = await deriveKeys(newCode())
    const server = fakeServer(keys)
    vi.stubGlobal('fetch', server.fetch)
    await httpApi(BASE, keys).create('receipt')
    expect(server.seen[0]).toMatchObject({ path: '/v1/library', authorization: `Bearer ${keys.libraryId}.${keys.secret}` })
    vi.unstubAllGlobals()
  })
})
