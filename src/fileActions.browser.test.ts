import { beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import type { Theme } from './lib/theme'
import type { Sort } from './lib/sort'
import type { OpenDocument } from './lib/useOpenDocument'
import { db } from './db/db'
import * as items from './db/items'
import { fileActions } from './fileActions'
import { forgetFile, keepFile } from './lib/files'

/**
 * What's made to be kept or printed has each picture's original
 * (lib/originals), with the real file store and a real picture; the handing
 * over is stood in for. A PDF is the HTML, printed by the system.
 */

const mocks = vi.hoisted(() => ({ download: vi.fn(async () => {}) }))
vi.mock('./lib/download', async (actual) => ({ ...(await actual<typeof import('./lib/download')>()), download: mocks.download }))

/** A real PNG, `edge` pixels square. */
async function png(edge: number, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = edge
  const context = canvas.getContext('2d')!
  context.fillStyle = color
  context.fillRect(0, 0, edge, edge)
  context.fillStyle = '#fff'
  context.fillRect(1, 1, edge / 2, edge / 3)
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

let small: Uint8Array
let original: Uint8Array
let id: string

/** A document whose picture is the small one, with its original in the file store. */
const body = (text: string): JSONContent => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text }] },
    { type: 'paragraph', content: [{ type: 'image', attrs: { src: `data:image/png;base64,${base64(small)}`, full: { id, type: 'image/png', size: original.length } } }] },
  ],
})

function actions(open?: string) {
  const session = {
    flush: async () => {},
    guarded: async (action: () => Promise<unknown>) => action(),
    whenSaved: async (then: (id: string) => Promise<unknown>) => then(open!),
  } as unknown as OpenDocument
  return fileActions({ session, setNotice: vi.fn(), features: true, askPlus: vi.fn(), everything: [], theme: 'light' as Theme, sort: 'recent' as Sort, setImportReport: vi.fn(), onRestored: vi.fn() })
}
const handed = () => mocks.download.mock.calls[0] as unknown as [string | Blob, string]
const unzipped = async (file: string | Blob) => unzipSync(new Uint8Array(await (file as Blob).arrayBuffer()))

beforeEach(async () => {
  await db.items.clear()
  mocks.download.mockReset().mockResolvedValue(undefined)
  small = await png(2, '#c00')
  original = await png(40, '#06c')
  id = (await keepFile(new Blob([original as BlobPart])))!
})

describe('an export with a picture that has an original', () => {
  it('has the original as HTML, and nothing of the file it came from', async () => {
    await actions(await items.create('note', body('On the hill'))).exportCurrentAs('html')
    const [page, name] = handed()
    expect(name).toBe('On the hill.html')
    expect(page).toContain(`src="data:image/png;base64,${base64(original)}"`)
    expect(page).not.toContain(base64(small))
    expect(page).not.toContain(id)
    expect(page).not.toContain('data-full')
  })

  it('has the note’s own picture where the original isn’t on this device', async () => {
    await forgetFile(id)
    await actions(await items.create('note', body('On the hill'))).exportCurrentAs('html')
    const [page] = handed()
    expect(page).toContain(`src="data:image/png;base64,${base64(small)}"`)
    expect(page).not.toContain(id)
  })

  it('has the original as Word', async () => {
    await actions(await items.create('page', body('On the hill'))).exportCurrentAs('docx')
    const files = await unzipped(handed()[0])
    const media = Object.keys(files).filter((path) => /^word\/media\/./.test(path))
    expect(media).toHaveLength(1)
    expect(files[media[0]]).toEqual(original)
  })

  it('has it in a compiled book, as an e-book and as Word', async () => {
    const one = await items.create('page', body('Chapter one'))
    const chapters = [(await items.get(one))!]
    await actions().compileManuscript('Book', [{ name: null, folder: 'Book', chapters }], 'epub')
    const files = await unzipped(handed()[0])
    const pictures = Object.keys(files).filter((path) => /picture-\d+\.png$/.test(path))
    expect(pictures).toHaveLength(1)
    expect(files[pictures[0]]).toEqual(original)

    mocks.download.mockClear()
    await actions().compileManuscript('Book', [{ name: null, folder: 'Book', chapters }], 'docx')
    const word = await unzipped(handed()[0])
    expect(Object.keys(word).filter((path) => /^word\/media\/./.test(path)).map((path) => word[path])).toEqual([original])
  })

  it('has it in each of several picked as HTML, and the note’s own in Markdown', async () => {
    const one = await items.create('note', body('First'))
    const two = await items.create('note', body('Second'))
    await actions().exportMany([one, two], 'html', () => {})
    const decoder = new TextDecoder()
    const pages = Object.values(await unzipped(handed()[0])).map((file) => decoder.decode(file))
    expect(pages).toHaveLength(2)
    for (const page of pages) {
      expect(page).toContain(base64(original))
      expect(page).not.toContain(base64(small))
    }

    mocks.download.mockClear()
    await actions().exportMany([one], 'md', () => {})
    const [markdown] = Object.values(await unzipped(handed()[0])).map((file) => decoder.decode(file))
    expect(markdown).toContain(base64(small))
    expect(markdown).not.toContain(base64(original))
    expect(markdown).not.toContain(id)
  })
})
