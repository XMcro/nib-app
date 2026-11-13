import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { db } from '../db/db'
import * as items from '../db/items'
import { MAX_FILE } from './fileRef'
import { listFiles, readFile } from './files'
import { DOC_BUDGET } from './image'
import { keepOriginals } from './originals'
import { plainText } from './text'

/**
 * Pictures and other files shared with a capture (lib/inbox `drainInbox`), in
 * a browser, where a picture can be read and made small as the app does it.
 * The inbox, and where its files wait, are stood in for.
 */

const native = vi.hoisted(() => ({ list: null as unknown as () => Promise<{ captures: object[] }>, ack: null as unknown as (options: { ids: string[] }) => Promise<void>, acked: [] as string[] }))
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: () => native,
}))

const { drainInbox } = await import('./inbox')

const ID = 'c0ffee00-0000-4000-8000-000000000001'
const NOTE = 'ab1e0000-0000-4000-8000-000000000001'
const AT = Date.parse('2026-11-11T09:00:00Z')
const doc = (...lines: string[]): JSONContent => ({ type: 'doc', content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) })

/** Where the inbox keeps a capture's files, stood in for: what's fetched from a `file:` address. */
const waiting = new Map<string, Blob>()
const realFetch = globalThis.fetch
function shared(name: string, blob: Blob, uri = `file:///group/Inbox/${ID}.files/${waiting.size}`) {
  waiting.set(uri, blob)
  return { name, type: blob.type, size: blob.size, uri }
}
/** A photograph: a JPEG with enough in it to be worth keeping whole. */
async function photo(edge = 600): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = edge
  const pen = canvas.getContext('2d')!
  const pixels = pen.createImageData(edge, edge)
  for (let at = 0; at < pixels.data.length; at++) pixels.data[at] = at % 4 === 3 ? 255 : (at * 7919) % 251
  pen.putImageData(pixels, 0, 0)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.95))
}
const pdf = (size = 4000) => new Blob([new Uint8Array(size).map((_, at) => at % 251)], { type: 'application/pdf' })
const capture = (files: unknown[], more: object = {}) => ({ captures: [{ id: ID, text: 'From Photos', createdAt: AT, files, ...more }] })
const blocks = async (id = ID) => (await items.get(id))!.body.content!
const pictureOf = (block: JSONContent) => block.content![0]

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
  for (const file of await listFiles()) await (await import('./files')).forgetFile(file.id)
  waiting.clear()
  native.acked = []
  native.ack = async ({ ids }) => void native.acked.push(...ids)
  vi.stubGlobal('fetch', async (url: string, ...rest: []) => {
    if (!String(url).startsWith('file:')) return realFetch(url, ...rest)
    const blob = waiting.get(String(url))
    return blob ? { ok: true, status: 200, blob: async () => blob } : { ok: false, status: 404 }
  })
})
afterEach(() => {
  keepOriginals(false)
  vi.unstubAllGlobals()
})

describe('a picture shared into Nib', () => {
  it('goes into the note as a picture, after the words, small enough to be kept in it', async () => {
    const jpeg = await photo()
    native.list = async () => capture([shared('IMG_0042.jpg', jpeg)], { url: 'https://example.com/a' })
    expect(await drainInbox()).toBe(1)
    const body = await blocks()
    expect(body.map((block) => block.content?.[0]?.type)).toEqual(['text', 'text', 'image'])
    const picture = pictureOf(body[2])
    expect(picture.attrs!.src).toMatch(/^data:image\/(jpeg|webp);base64,/)
    expect(picture.attrs!.src.length).toBeLessThan(300_000)
    // Without Plus only the note's own copy is kept.
    expect(picture.attrs!.full).toBeNull()
    expect(await listFiles()).toEqual([])
    expect(native.acked).toEqual([ID])
  })

  it('has its original kept beside the library with Nib Plus', async () => {
    keepOriginals(true)
    const jpeg = await photo()
    native.list = async () => capture([shared('IMG_0042.jpg', jpeg)])
    await drainInbox()
    const { full } = pictureOf((await blocks())[1]).attrs as { full: { id: string; type: string; size: number } }
    expect(full).toMatchObject({ type: 'image/jpeg' })
    expect((await readFile(full.id))!.size).toBe(full.size)
  })

  it('says so in its place when the note it’s for has no room left for pictures', async () => {
    // A picture and a sketch's drawing already there, wherever they are in it, with room for one more picture and not two.
    native.list = async () => capture([shared('IMG_0042.jpg', await photo())])
    await drainInbox()
    const one = pictureOf((await blocks())[1]).attrs!.src.length
    await db.items.clear()
    const used = DOC_BUDGET - Math.round(one * 1.5)
    const album: JSONContent = { type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Album' }, { type: 'image', attrs: { src: `data:image/png;base64,${'A'.repeat(used / 2)}`, alt: '', drawing: 'D'.repeat(used / 2) } }] }] }] }
    await db.items.add({ id: NOTE, kind: 'note', body: album, version: 1, rev: 1, createdAt: 1, updatedAt: 1 })
    native.list = async () => capture([shared('IMG_0042.jpg', await photo()), shared('IMG_0043.jpg', await photo())], { into: NOTE })
    await drainInbox()
    const body = await blocks(NOTE)
    expect(body.map((block) => block.content![0].type)).toEqual(['paragraph', 'text', 'image', 'text'])
    expect(plainText(body[3])).toBe('IMG_0043.jpg didn’t fit: this document’s pictures are at their limit.')
  })
})

describe('another file shared into Nib', () => {
  it('is an attachment with Nib Plus, its file kept as it came', async () => {
    keepOriginals(true)
    const file = pdf()
    native.list = async () => capture([shared('Tide tables.pdf', file)])
    await drainInbox()
    const attachment = (await blocks())[1]
    expect(attachment).toMatchObject({ type: 'attachment', attrs: { name: 'Tide tables.pdf', file: { type: 'application/pdf', size: 4000 } } })
    expect(new Uint8Array(await (await readFile((attachment.attrs!.file as { id: string }).id))!.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()))
  })

  it('says why in its place without Plus, or past what one file may be', async () => {
    native.list = async () => capture([shared('Tide tables.pdf', pdf())])
    await drainInbox()
    expect(plainText((await items.get(ID))!.body)).toBe('From Photos\nTide tables.pdf: Attaching files is part of Nib Plus.')
    expect(await listFiles()).toEqual([])

    await db.items.clear()
    keepOriginals(true)
    native.list = async () => capture([shared('film.mov', new Blob([new Uint8Array(MAX_FILE + 1)], { type: 'video/quicktime' }))])
    await drainInbox()
    expect(plainText((await items.get(ID))!.body)).toContain('film.mov: That file is over 25 MB')
  })
})

describe('what’s shared with files', () => {
  it('waits until Nib knows whether Plus is on, while words alone are saved at once', async () => {
    const OTHER = 'c0ffee00-0000-4000-8000-000000000002'
    native.list = async () => ({ captures: [{ id: ID, text: 'With a file', createdAt: AT, files: [shared('Tide tables.pdf', pdf())] }, { id: OTHER, text: 'Words alone', createdAt: AT + 1 }] })
    expect(await drainInbox(undefined, false)).toBe(1)
    expect(await items.get(ID)).toBeUndefined()
    expect(native.acked).toEqual([OTHER])
    // Known now, and on: the file is an attachment, not a line saying there's no Plus.
    keepOriginals(true)
    native.list = async () => capture([shared('Tide tables.pdf', pdf())])
    expect(await drainInbox(undefined, true)).toBe(1)
    expect((await blocks())[1].type).toBe('attachment')
  })

  it('can be files alone, in the order they came, and can be added to a note there already', async () => {
    keepOriginals(true)
    await items.create('note', doc('Harbour notes'), { id: NOTE })
    native.list = async () => ({ captures: [{ id: ID, text: '', createdAt: AT, into: NOTE, files: [shared('Tide tables.pdf', pdf()), shared('IMG_0042.jpg', await photo(300))] }] })
    expect(await drainInbox()).toBe(1)
    const body = await blocks(NOTE)
    expect(body.map((block) => block.type === 'attachment' ? 'attachment' : block.content![0].type)).toEqual(['text', 'attachment', 'image'])
    expect(await items.get(ID)).toBeUndefined()

    // Into the note that's open, they're handed to its editor with the words.
    const put = vi.fn((_: string, __: JSONContent[]) => true)
    native.list = async () => capture([shared('Berths.pdf', pdf(500))], { into: NOTE })
    await drainInbox(put)
    expect(put.mock.calls[0][1].map((block) => block.type)).toEqual(['paragraph', 'attachment'])
  })

  it('reads a file only from where the inbox keeps them, and passes over what isn’t one', async () => {
    keepOriginals(true)
    waiting.set('https://example.com/evil.pdf', pdf())
    native.list = async () => capture([{ name: 'evil.pdf', type: 'application/pdf', size: 4000, uri: 'https://example.com/evil.pdf' }, { name: 'no-uri.pdf', type: 'application/pdf', size: 1 }, 'nonsense', null, shared('Real.pdf', pdf(600))])
    await drainInbox()
    expect((await blocks()).map((block) => block.type === 'attachment' ? block.attrs!.name : 'text')).toEqual(['text', 'Real.pdf'])
    native.list = async () => ({ captures: [{ id: 'c0ffee00-0000-4000-8000-000000000009', text: 'Words only', createdAt: AT, files: 'not a list' }] })
    expect(await drainInbox()).toBe(1)
  })

  it('waits in the inbox when one of its files can’t be read; and a note made before a crash isn’t read for again', async () => {
    keepOriginals(true)
    native.list = async () => capture([{ name: 'Gone.pdf', type: 'application/pdf', size: 4000, uri: 'file:///group/Inbox/nowhere' }])
    await expect(drainInbox()).rejects.toThrow('could not be read')
    expect(await items.get(ID)).toBeUndefined()
    expect(native.acked).toEqual([])

    native.list = async () => capture([shared('Tide tables.pdf', pdf())])
    native.ack = async () => {
      throw new Error('crashed before the files were deleted')
    }
    await expect(drainInbox()).rejects.toThrow('crashed')
    const kept = await listFiles()
    expect(kept).toHaveLength(1)
    native.ack = async ({ ids }) => void native.acked.push(...ids)
    expect(await drainInbox()).toBe(1)
    expect(await listFiles()).toEqual(kept)
    expect(native.acked).toEqual([ID])
  })
})

describe('a whole web page shared from Safari', () => {
  const PAGE = '<nav><a href="https://example.com/about">About</a></nav><h1>Tides of the north harbour</h1><p>High water comes twice a day.</p><h2>Spring tides</h2><ul><li>New moon</li></ul>'
  const whole = (more: object = {}) => ({ captures: [{ id: ID, text: 'Tides of the north harbour', url: 'https://example.com/tides', createdAt: AT, page: PAGE, ...more }] })
  const types = (body: JSONContent[]) => body.map((block) => (block.type === 'heading' ? `h${block.attrs!.level}` : block.type))

  it('is a page of its own with Nib Plus: its title a heading, its address under it, then its text as it was set out', async () => {
    keepOriginals(true)
    native.list = async () => whole()
    expect(await drainInbox()).toBe(1)
    const saved = (await items.get(ID))!
    expect(saved.kind).toBe('page')
    expect(saved.createdAt).toBe(AT)
    expect(types(saved.body.content!)).toEqual(['h1', 'paragraph', 'paragraph', 'paragraph', 'h2', 'bulletList'])
    expect(plainText(saved.body)).toBe('Tides of the north harbour\nhttps://example.com/tides\nAbout\nHigh water comes twice a day.\nSpring tides\nNew moon')
    expect(native.acked).toEqual([ID])
  })

  it('goes into a note there already as that note’s kind of lines, after what it had', async () => {
    keepOriginals(true)
    await items.create('note', doc('Harbour notes'), { id: NOTE })
    native.list = async () => whole({ into: NOTE })
    await drainInbox()
    const body = await blocks(NOTE)
    expect(types(body)).not.toContain('h2')
    expect(plainText({ type: 'doc', content: body })).toBe('Harbour notes\nTides of the north harbour\nhttps://example.com/tides\nAbout\nHigh water comes twice a day.\nSpring tides\nNew moon')
    expect((await items.get(NOTE))!.kind).toBe('note')
  })

  it('is its link and a word why without Plus; waits until Plus is known; and is nothing where no page came', async () => {
    native.list = async () => whole()
    expect(await drainInbox(undefined, false)).toBe(0)
    expect(await items.get(ID)).toBeUndefined()
    await drainInbox()
    expect((await items.get(ID))!.kind).toBe('note')
    expect(plainText((await items.get(ID))!.body)).toBe('Tides of the north harbour\nhttps://example.com/tides\nThe page’s text wasn’t kept: saving more than what’s selected is part of Nib Plus.')

    await db.items.clear()
    keepOriginals(true)
    native.list = async () => whole({ page: '' })
    await drainInbox()
    expect((await items.get(ID))!.kind).toBe('note')
    expect(plainText((await items.get(ID))!.body)).toBe('Tides of the north harbour\nhttps://example.com/tides')
    await db.items.clear()
    native.list = async () => whole({ page: { not: 'html' } })
    await drainInbox()
    expect(plainText((await items.get(ID))!.body)).toBe('Tides of the north harbour\nhttps://example.com/tides')
  })

  it('keeps what was selected for anyone, as a note’s lines: Plus or not, and never a page of its own', async () => {
    const SELECTED = '<h2>Spring tides</h2><ul><li>New moon</li></ul><p>See the <a href="https://example.com/tables">tables</a>.</p>'
    for (const plus of [false, true]) {
      await db.items.clear()
      keepOriginals(plus)
      native.list = async () => whole({ page: SELECTED, part: 'selection' })
      expect(await drainInbox()).toBe(1)
      const saved = (await items.get(ID))!
      expect(saved.kind, `Plus ${plus}`).toBe('note')
      expect(types(saved.body.content!)).toEqual(['paragraph', 'paragraph', 'paragraph', 'bulletList', 'paragraph'])
      expect(plainText(saved.body)).toBe('Tides of the north harbour\nhttps://example.com/tides\nSpring tides\nNew moon\nSee the tables.')
    }
    // Added to a page there already, it's that page's kind of lines.
    await db.items.clear()
    keepOriginals(false)
    await items.create('page', doc('Harbour page'), { id: NOTE })
    native.list = async () => whole({ page: SELECTED, part: 'selection', into: NOTE })
    await drainInbox()
    expect(types(await blocks(NOTE))).toContain('h2')
  })

  it('keeps the article and the part on screen as the whole page is kept: a page of its own with Plus, a word why without', async () => {
    for (const part of ['article', 'visible', 'whole', 'a part there isn’t', undefined]) {
      await db.items.clear()
      keepOriginals(true)
      native.list = async () => whole({ part })
      await drainInbox()
      expect((await items.get(ID))!.kind, String(part)).toBe('page')
      expect(plainText((await items.get(ID))!.body), String(part)).toContain('High water comes twice a day.')

      await db.items.clear()
      keepOriginals(false)
      await drainInbox()
      expect((await items.get(ID))!.kind, String(part)).toBe('note')
      expect(plainText((await items.get(ID))!.body), String(part)).toBe('Tides of the north harbour\nhttps://example.com/tides\nThe page’s text wasn’t kept: saving more than what’s selected is part of Nib Plus.')
    }
  })
})

