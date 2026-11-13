// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { bodyHash } from '../../worker/signing'
import { db } from '../db/db'
import * as items from '../db/items'
import { plainText } from '../lib/text'
import { SyncHttpError } from './api'
import { deriveKeys, newCode, seal, type SyncKeys } from './crypto'
import { fakeServer } from './fakeServer'
import { readClipperCode, sealPost } from '../../worker/inbox-seal'
import { inboxAddress, newInboxAddress, postBody, postKind, takePosts } from './inbox'

/**
 * The library's inbox from a device's side (sync/inbox), against the server's
 * own library (worker/library, through sync/fakeServer), with posts sealed as
 * the Worker seals them.
 */

const hash = (secret: string) => bodyHash(new TextEncoder().encode(secret))
const secretOf = (address: string) => address.split('.').at(-1)!
const marks = (node: JSONContent): string[] => [...(node.marks ?? []).map((mark) => `${mark.type}${mark.attrs?.href ? `:${mark.attrs.href}` : ''}`), ...(node.content ?? []).flatMap(marks)]
const types = (body: JSONContent) => (body.content ?? []).map((block) => block.type)

describe('the library’s inbox, from a device', () => {
  let code: string
  let keys: SyncKeys
  let server: ReturnType<typeof fakeServer>

  beforeEach(async () => {
    code = newCode()
    keys = await deriveKeys(code)
    server = fakeServer()
    await db.items.clear()
    await db.revisions.clear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('has none until one is made; then an address any device with the code can show, and no one else', async () => {
    expect((await inboxAddress(keys, server.api))?.address ?? null).toBe(null)
    const address = (await newInboxAddress(keys, server.api)).address
    expect(address).toMatch(new RegExp(`^${location.origin}/v1/in/${keys.libraryId}\\.[A-Za-z0-9_-]{43}$`))
    expect((await inboxAddress(keys, server.api))?.address ?? null).toBe(address)
    // Another device, with the code alone.
    expect((await inboxAddress(await deriveKeys(code), server.api))?.address ?? null).toBe(address)
    // Another code, shown what this library keeps: it can't open it.
    expect(await inboxAddress(await deriveKeys(newCode()), server.api)).toBe(null)
  })

  it('leaves the server the hash of the address’s secret and a key that only seals: what opens posts is kept there sealed', async () => {
    const address = (await newInboxAddress(keys, server.api)).address
    const secret = secretOf(address)
    const held = JSON.stringify((await server.api.inbox()).kept) + JSON.stringify(server.library.status('a test library', Date.now()))
    expect(held).not.toContain(secret)
    // The hash of the secret is what a post is let in by.
    await server.post(await hash(secret), { text: 'let in' })
    await expect(server.post(await hash('another'), { text: 'not' })).rejects.toBeInstanceOf(SyncHttpError)
    expect((await server.api.inbox()).kept!.length).toBeLessThan(4096)
  })

  it('takes nothing kept under another name for the inbox’s own', async () => {
    await newInboxAddress(keys, server.api)
    const { kept } = await server.api.inbox()
    expect(kept).toBeTruthy()
    // A record of the library's, sealed with the same key, put in its place: not an inbox this device will use.
    const record = await seal(keys, 'a-record', { d: 'A'.repeat(43), x: 'A'.repeat(43), y: 'A'.repeat(43), secret: 'S'.repeat(43) })
    vi.spyOn(server.api, 'inbox').mockResolvedValue({ on: true, kept: record, posts: [], more: false })
    expect((await inboxAddress(keys, server.api))?.address ?? null).toBe(null)
    // Nor what opens but isn't a key and a secret.
    vi.mocked(server.api.inbox).mockResolvedValue({ on: true, kept: await seal(keys, 'inbox', { d: 'short', x: 7, secret: 'S'.repeat(43) }), posts: [], more: false })
    expect((await inboxAddress(keys, server.api))?.address ?? null).toBe(null)
    vi.mocked(server.api.inbox).mockResolvedValue({ on: true, kept: await seal(keys, 'inbox', null), posts: [], more: false })
    expect((await inboxAddress(keys, server.api))?.address ?? null).toBe(null)
  })

  it('gives a new address that stops the old one, and still opens what was waiting', async () => {
    const first = (await newInboxAddress(keys, server.api)).address
    await server.post(await hash(secretOf(first)), { title: 'Sent to the first address' })
    const second = (await newInboxAddress(keys, server.api)).address
    expect(second).not.toBe(first)
    expect((await inboxAddress(keys, server.api))?.address ?? null).toBe(second)
    await expect(server.post(await hash(secretOf(first)), { text: 'late' })).rejects.toMatchObject({ status: 404 })
    await server.post(await hash(secretOf(second)), { title: 'Sent to the second' })
    expect(await takePosts(keys, server.api)).toBe(2)
    expect((await db.items.toArray()).map((item) => plainText(item.body)).sort()).toEqual(['Sent to the first address', 'Sent to the second'])
  })

  it('makes a note of each post: its title first, its text read as Markdown, its link last; dated when it came, and cleared from the server', async () => {
    const address = await hash(secretOf((await newInboxAddress(keys, server.api)).address))
    const at = Date.UTC(2026, 10, 11, 9, 30)
    await server.post(address, { title: '  Tide   times ', text: '## Today\n\nHigh water at **06:12**.\n\n- [ ] Check the moorings\n- [x] Call the harbour\n\n1. One\n2. Two', url: 'https://example.com/tides?day=1' }, at)
    await server.post(address, { text: 'Only words.' }, at + 1000)
    await server.post(address, { url: 'https://example.com/only-a-link' }, at + 2000)
    expect(await takePosts(keys, server.api, 'Harbour')).toBe(3)

    const made = (await db.items.toArray()).sort((a, b) => a.createdAt - b.createdAt)
    expect(made.map((item) => [item.kind, item.folder, item.createdAt, item.updatedAt])).toEqual([
      ['note', 'Harbour', at, at],
      ['note', 'Harbour', at + 1000, at + 1000],
      ['note', 'Harbour', at + 2000, at + 2000],
    ])
    const [first, second, third] = made.map((item) => item.body)
    // A note has no headings: a heading's words are a line of it.
    expect(types(first)).toEqual(['paragraph', 'paragraph', 'paragraph', 'taskList', 'orderedList', 'paragraph'])
    expect(plainText(first).split('\n').slice(0, 3)).toEqual(['Tide times', 'Today', 'High water at 06:12.'])
    expect(first.content![3].content!.map((task) => task.attrs?.checked)).toEqual([false, true])
    expect(marks(first)).toEqual(['bold', 'link:https://example.com/tides?day=1'])
    expect(plainText(second)).toBe('Only words.')
    expect(plainText(third)).toBe('https://example.com/only-a-link')
    expect(marks(third)).toEqual(['link:https://example.com/only-a-link'])
    expect(await server.api.inbox()).toMatchObject({ on: true, posts: [], more: false })
    // In no folder, with none said.
    await server.post(address, { text: 'Later' }, at + 3000)
    await takePosts(keys, server.api)
    expect((await db.items.toArray()).find((item) => plainText(item.body) === 'Later')!.folder).toBeUndefined()
  })

  it('makes one note of a post however often it’s taken in: after a failure to say so, and on another device', async () => {
    const address = await hash(secretOf((await newInboxAddress(keys, server.api)).address))
    await server.post(address, { title: 'Once' })
    const took = vi.spyOn(server.api, 'tookPosts').mockRejectedValueOnce(new SyncHttpError(500, 'down'))
    await expect(takePosts(keys, server.api)).rejects.toThrow('down')
    const [note] = await db.items.toArray()
    expect(note.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    // Still waiting: taken in again, no second note, and the server told this time.
    expect(await takePosts(keys, server.api)).toBe(0)
    expect(await db.items.count()).toBe(1)
    expect(took).toHaveBeenCalledTimes(2)
    expect((await server.api.inbox()).posts).toEqual([])

    // Another device that took the same post would give its note the same id, so the two are one document when they sync.
    await server.post(address, { title: 'Twice' })
    took.mockRejectedValueOnce(new SyncHttpError(500, 'down'))
    await takePosts(keys, server.api).catch(() => {})
    const here = (await db.items.toArray()).find((item) => plainText(item.body) === 'Twice')!
    await items.purge(here.id)
    await takePosts(await deriveKeys(code), server.api)
    const there = (await db.items.toArray()).find((item) => plainText(item.body) === 'Twice')!
    expect(there.id).toBe(here.id)
    expect(there.body).toEqual(here.body)
    // And not the id of any other post's note.
    expect(there.id).not.toBe(note.id)
  })

  it('makes a note of its own of a post numbered as an earlier one was, in a library deleted and made again under the code', async () => {
    const address = await hash(secretOf((await newInboxAddress(keys, server.api)).address))
    await server.post(address, { title: 'In the first library' }, Date.now() - 2000)
    const [first] = (await server.api.inbox()).posts
    await takePosts(keys, server.api)
    // The server counts from one again; what tells the two apart is when each came.
    await server.post(address, { title: 'In the second' }, Date.now() - 1000)
    const [second] = (await server.api.inbox()).posts
    vi.spyOn(server.api, 'inbox').mockResolvedValueOnce({ ...(await server.api.inbox()), posts: [{ ...second, id: first.id }] })
    vi.spyOn(server.api, 'tookPosts').mockResolvedValueOnce()
    expect(await takePosts(keys, server.api)).toBe(1)
    expect((await db.items.toArray()).map((item) => plainText(item.body)).sort()).toEqual(['In the first library', 'In the second'])
  })

  it('takes in every post waiting, however many answers they come in', async () => {
    const address = await hash(secretOf((await newInboxAddress(keys, server.api)).address))
    for (let n = 0; n < 120; n++) await server.post(address, { text: `Post ${n}` })
    const asked = vi.spyOn(server.api, 'inbox')
    expect(await takePosts(keys, server.api)).toBe(120)
    expect(asked).toHaveBeenCalledTimes(3)
    expect(await db.items.count()).toBe(120)
    expect((await server.api.inbox()).posts).toEqual([])
  })

  it('trusts nothing in a post: what isn’t text is nothing, a link is a web address or isn’t one, and nothing runs', async () => {
    expect(postBody({ title: 7, text: ['a'], url: { href: 'x' } } as never)).toEqual({ type: 'doc', content: [] })
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'example.com', ' ']) {
      expect(postBody({ title: 'Kept', url }), url).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kept' }] }] })
    }
    const hostile = postBody({ title: '<img src=x onerror=alert(1)>', text: '<script>alert(1)</script>\n\n[click](javascript:alert(1)) <b onclick="alert(1)">bold</b>\n\n![a picture](https://example.com/track.png)' })
    const kept = JSON.stringify(hostile)
    expect(kept).not.toMatch(/<script|onclick|onerror=alert\(1\)"|javascript:|"image"/)
    // The title is words, as written, whatever they look like.
    expect(plainText({ type: 'doc', content: [hostile.content![0]] })).toBe('<img src=x onerror=alert(1)>')
    // A picture elsewhere isn't fetched: what it was is said in its place.
    expect(plainText(hostile)).toContain('![a picture](https://example.com/track.png)')
  })

  it('lets go of a post it can’t read, says so in the log, and still makes notes of the rest', async () => {
    const address = await hash(secretOf((await newInboxAddress(keys, server.api)).address))
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await server.post(address, { title: 'Before' })
    server.library.addPost(address, 'AQQ=', Date.now())
    await server.post(address, { title: 7 } as never)
    await server.post(address, { title: 'After' })
    expect(await takePosts(keys, server.api)).toBe(2)
    expect((await db.items.toArray()).map((item) => plainText(item.body)).sort()).toEqual(['After', 'Before'])
    expect(warned).toHaveBeenCalledTimes(2)
    expect(warned.mock.calls.flat().join(' ')).not.toMatch(/Before|After/)
    expect((await server.api.inbox()).posts).toEqual([])
  })

  it('gives the browser extension a code to seal its own clips with: the address, and the key that only this library’s devices can open', async () => {
    const made = await newInboxAddress(keys, server.api)
    expect(made.clipper.startsWith(`${made.address}#`)).toBe(true)
    expect((await inboxAddress(await deriveKeys(code), server.api))!.clipper).toBe(made.clipper)
    const read = readClipperCode(made.clipper)!
    expect(read.address).toBe(made.address)
    // Sealed as the extension would, in its browser, and kept by the server as it came: this device opens it.
    const sealed = await sealPost(read.key, { title: 'Clipped', url: 'https://example.com/tides', page: '<h2>Spring tides</h2><p>High water comes twice a day.</p>', part: 'article' })
    server.library.addPost(await hash(secretOf(read.address)), sealed, Date.now())
    expect(await takePosts(keys, server.api)).toBe(1)
    const [clip] = await db.items.toArray()
    expect(clip.kind).toBe('page')
    expect(plainText(clip.body)).toBe('Clipped\nhttps://example.com/tides\nSpring tides\nHigh water comes twice a day.')
    // A new address is a new code, with the same key: what the extension sealed and sent before can still be opened.
    const next = await newInboxAddress(keys, server.api)
    expect(next.clipper).not.toBe(made.clipper)
    expect(readClipperCode(next.clipper)!.key).toBe(read.key)
  })

  it('reads a clip as a page shared from Safari is read: a page of its own for more than a selection, a note’s lines for a selection, and nothing in it trusted', () => {
    const PAGE = '<nav><a href="https://example.com/about">About</a></nav><h1>Tides of the north harbour</h1><p>High water comes <em>twice</em> a day.</p><h2>Spring tides</h2><ul><li>New moon</li></ul><table><tr><td>Mon</td><td>06:12</td></tr></table>'
    const clip = { title: 'Tides of the north harbour', url: 'https://example.com/tides', page: PAGE }
    for (const part of ['article', 'visible', 'whole', 'picked', undefined]) {
      expect(postKind({ ...clip, part }), String(part)).toBe('page')
      const body = postBody({ ...clip, part })
      expect(types(body), String(part)).toEqual(['heading', 'paragraph', 'paragraph', 'paragraph', 'heading', 'bulletList', 'table'])
      expect(plainText(body).split('\n').slice(0, 4)).toEqual(['Tides of the north harbour', 'https://example.com/tides', 'About', 'High water comes twice a day.'])
      // Its title said once, though the page says it too.
      expect(plainText(body).match(/Tides of the north harbour/g)).toHaveLength(1)
    }
    expect(postKind({ ...clip, part: 'selection' })).toBe('note')
    const chosen = postBody({ ...clip, part: 'selection' })
    expect(types(chosen)).not.toEqual(expect.arrayContaining(['heading', 'table']))
    expect(plainText(chosen)).toContain('Mon\n06:12')
    // The clipper's own words, read as Markdown, come between the link and the page's.
    const noted = postBody({ ...clip, text: 'For **Thursday**.', part: 'article' })
    expect(plainText(noted).split('\n').slice(0, 4)).toEqual(['Tides of the north harbour', 'https://example.com/tides', 'For Thursday.', 'About'])
    expect(marks(noted)).toContain('bold')
    // A post with no page is a note as ever, whatever it says of parts; and a page that isn't text is no page.
    expect(postKind({ title: 'A post', part: 'whole' })).toBe('note')
    expect(postKind({ title: 'A post', page: { not: 'html' }, part: 'whole' } as never)).toBe('note')
    expect(postKind({ title: 'A post', page: '   ', part: 'whole' })).toBe('note')
    const hostile = JSON.stringify(postBody({ title: 'Kept', url: 'javascript:alert(1)', page: '<p onclick="steal()">Words<img src="https://example.com/x.png" onerror="steal()"></p><script>steal()</script><a href="javascript:steal()">go</a>', part: 'whole' }))
    expect(hostile).not.toMatch(/steal|onerror|onclick|x\.png|javascript:/)
    expect(hostile).toContain('Words')
  })

  it('does nothing with no inbox, or one this device can’t open', async () => {
    const took = vi.spyOn(server.api, 'tookPosts')
    expect(await takePosts(keys, server.api)).toBe(0)
    const address = await hash(secretOf((await newInboxAddress(keys, server.api)).address))
    await server.post(address, { title: 'Not for this code' })
    expect(await takePosts(await deriveKeys(newCode()), server.api)).toBe(0)
    expect(took).not.toHaveBeenCalled()
    expect(await db.items.count()).toBe(0)
    // Still there for a device that can.
    expect(await takePosts(keys, server.api)).toBe(1)
  })
})
