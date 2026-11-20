import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clipperCode, newInboxKeys, openPost } from '../../worker/inbox-seal'
import { SEALED_TYPE } from '../../worker/wire.mjs'
import { SYNC_ORIGIN } from '../lib/hosts'
import { WHY } from './clip'

/** The extension's background (clipper/background): the one place a clip is sent from, with the browser's own parts stood in for. */

type Listener = (message: unknown, sender: { id?: string }, respond: (answer: unknown) => void) => boolean | void
const ADDRESS = `${SYNC_ORIGIN}/v1/in/${'0123456789abcdef'.repeat(2)}.${'S'.repeat(43)}`
/** Where a clip goes: the address up to its secret, which goes in a header (src/clipper/clip `send`). */
const SENT_TO = ADDRESS.slice(0, ADDRESS.lastIndexOf('.'))
let listener: Listener
let stored: Record<string, unknown>
let fetching: ReturnType<typeof vi.fn>
let levels: unknown[]

beforeEach(async () => {
  stored = {}
  levels = []
  fetching = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetching)
  vi.stubGlobal('chrome', {
    runtime: { id: 'this-extension', onMessage: { addListener: (added: Listener) => void (listener = added) } },
    storage: { local: { get: async (key: string) => ({ [key]: stored[key] }), setAccessLevel: async (level: unknown) => void levels.push(level) } },
  })
  vi.resetModules()
  await import('./background')
})
afterEach(() => vi.unstubAllGlobals())

/** A message, and what it was answered, if it was. */
const asked = (message: unknown, sender = { id: 'this-extension' }) =>
  new Promise<{ taken: boolean | void; answer?: unknown }>((resolve) => {
    const taken = listener(message, sender, (answer) => resolve({ taken, answer }))
    if (taken !== true) resolve({ taken })
  })

describe('the extension’s background', () => {
  // The red-team review of 2026-11-17: a browser lets an extension's scripts in a page read its storage unless told otherwise.
  it('keeps its storage, the code in it, from the scripts it puts in pages', () => {
    expect(levels).toEqual([{ accessLevel: 'TRUSTED_CONTEXTS' }])
  })

  it('starts all the same in a browser that has no such setting, or refuses it', async () => {
    for (const setAccessLevel of [undefined, async () => Promise.reject(new Error('Not here.')), () => { throw new Error('Nor here.') }]) {
      vi.stubGlobal('chrome', { runtime: { id: 'this-extension', onMessage: { addListener: (added: Listener) => void (listener = added) } }, storage: { local: { get: async () => ({}), setAccessLevel } } })
      vi.resetModules()
      await import('./background')
      expect((await asked({ type: 'clip', post: { title: 'A' } })).taken).toBe(true)
    }
  })

  it('seals a clip from the extension with the code it keeps, and sends it to that code’s address', async () => {
    const keys = await newInboxKeys()
    stored.code = clipperCode(ADDRESS, keys.publicKey)
    const post = { title: 'Tides', url: 'https://example.com/tides', page: '<p>High water.</p>', part: 'picked' }
    expect(await asked({ type: 'clip', post })).toEqual({ taken: true, answer: { ok: true } })
    const [to, how] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    expect(to).toBe(SENT_TO)
    expect((how.headers as Record<string, string>)['Content-Type']).toBe(SEALED_TYPE)
    expect(await openPost(keys.privateKey, keys.publicKey, String(how.body))).toEqual(post)
  })

  it('takes nothing from anywhere but this extension, and nothing that isn’t a clip', async () => {
    stored.code = clipperCode(ADDRESS, (await newInboxKeys()).publicKey)
    expect(await asked({ type: 'clip', post: { title: 'x' } }, { id: 'another-extension' })).toEqual({ taken: undefined })
    expect(await asked({ type: 'clip', post: { title: 'x' } }, {} as { id: string })).toEqual({ taken: undefined })
    for (const message of [null, 'clip', { type: 'code' }, { post: { title: 'x' } }]) expect(await asked(message)).toEqual({ taken: undefined })
    expect(fetching).not.toHaveBeenCalled()
  })

  it('is never told where to send: a clip that names an address or a code goes to the kept code’s, without them', async () => {
    const keys = await newInboxKeys()
    stored.code = clipperCode(ADDRESS, keys.publicKey)
    await asked({ type: 'clip', address: 'https://elsewhere.example/v1/in/x', code: 'another', post: { title: 'x', address: 'https://elsewhere.example', code: 'another' } })
    expect(fetching).toHaveBeenCalledTimes(1)
    const [to, how] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    expect(to).toBe(SENT_TO)
    expect(await openPost(keys.privateKey, keys.publicKey, String(how.body))).toEqual({ title: 'x' })
  })

  it('says why with no code kept, or one that isn’t a code, and when the browser’s storage can’t be read', async () => {
    expect(await asked({ type: 'clip', post: { title: 'x' } })).toEqual({ taken: true, answer: { ok: false, why: WHY.code } })
    stored.code = 7
    expect(await asked({ type: 'clip', post: { title: 'x' } })).toEqual({ taken: true, answer: { ok: false, why: WHY.code } })
    expect(fetching).not.toHaveBeenCalled()
    ;(globalThis as unknown as { chrome: { storage: { local: { get: () => Promise<never> } } } }).chrome.storage.local.get = async () => {
      throw new Error('storage is gone')
    }
    expect(await asked({ type: 'clip', post: { title: 'x' } })).toEqual({ taken: true, answer: { ok: false, why: WHY.offline } })
  })
})
