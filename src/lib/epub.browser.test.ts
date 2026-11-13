import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import { compileEpub } from './epub'

/** A real PNG, made here. */
function png(color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 1
  const context = canvas.getContext('2d')!
  context.fillStyle = color
  context.fillRect(0, 0, 2, 1)
  return canvas.toDataURL('image/png')
}
const PICTURE = png('#c00')

const text = (value: string): JSONContent => ({ type: 'text', text: value })
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const chapter = (id: string, content: JSONContent[]): Item => ({ id, kind: 'page', body: { type: 'doc', content }, createdAt: 1, updatedAt: 1, version: 1 })

const ONE = chapter('one', [p(text('Chapter one')), p(text('The boats & the <quay>.'), { type: 'footnote', attrs: { text: 'First note.' } }), p({ type: 'image', attrs: { src: PICTURE } })])
const TWO = chapter('two', [p(text('Chapter two')), p(text('A long season.'), { type: 'footnote', attrs: { text: 'Second note.' } }), p({ type: 'image', attrs: { src: PICTURE } })])

async function open(chapters = [ONE, TWO], title = 'The Harbour & Other Stories') {
  const bytes = new Uint8Array(await compileEpub(title, chapters, 'en-GB').arrayBuffer())
  const files = unzipSync(bytes)
  const read = (name: string) => strFromU8(files[name])
  const xml = (name: string) => new DOMParser().parseFromString(read(name), 'application/xml')
  return { bytes, files, read, xml }
}

const broken = (doc: Document) => doc.getElementsByTagName('parsererror').length > 0

describe('a manuscript as an EPUB', () => {
  it('starts as every e-reader needs: the mimetype first, stored as it is, with nothing extra', async () => {
    const { bytes } = await open()
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50) // a local file header
    expect(view.getUint16(8, true)).toBe(0) // stored, not compressed
    const nameLength = view.getUint16(26, true)
    expect(view.getUint16(28, true)).toBe(0) // no extra field
    expect(strFromU8(bytes.subarray(30, 30 + nameLength))).toBe('mimetype')
    expect(strFromU8(bytes.subarray(30 + nameLength, 30 + nameLength + 20))).toBe('application/epub+zip')
  })

  it('points the container at a package titled for the book, its chapters in book order', async () => {
    const { xml } = await open()
    const container = xml('META-INF/container.xml')
    expect(container.querySelector('rootfile')?.getAttribute('full-path')).toBe('OEBPS/content.opf')

    const opf = xml('OEBPS/content.opf')
    expect(broken(opf)).toBe(false)
    expect(opf.getElementsByTagName('dc:title')[0].textContent).toBe('The Harbour & Other Stories')
    expect(opf.getElementsByTagName('dc:language')[0].textContent).toBe('en-GB')
    expect(opf.getElementsByTagName('dc:identifier')[0].textContent).toMatch(/^urn:uuid:[0-9a-f-]{36}$/)
    expect(opf.querySelector('meta[property="dcterms:modified"]')?.textContent).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    const spine = [...opf.querySelectorAll('spine itemref')].map((ref) => opf.getElementById(ref.getAttribute('idref')!)?.getAttribute('href'))
    expect(spine).toEqual(['chapter-1.xhtml', 'chapter-2.xhtml'])
  })

  it('lists the chapters by title in its table of contents', async () => {
    const { xml } = await open()
    const nav = xml('OEBPS/nav.xhtml')
    expect(broken(nav)).toBe(false)
    expect(nav.querySelector('nav')?.getAttributeNS('http://www.idpf.org/2007/ops', 'type')).toBe('toc')
    expect([...nav.querySelectorAll('nav li a')].map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Chapter one', 'chapter-1.xhtml'],
      ['Chapter two', 'chapter-2.xhtml'],
    ])
  })

  it('keeps a callout, well-formed, its kind written over it', async () => {
    const boxed = chapter('one', [{ type: 'callout', attrs: { kind: 'tip', collapsed: true }, content: [p(text('Words'))] }])
    const { xml, read } = await open([boxed])
    const one = xml('OEBPS/chapter-1.xhtml')
    expect(broken(one)).toBe(false)
    expect(one.querySelector('div')?.getAttribute('data-callout')).toBe('tip')
    expect(one.querySelector('div p')?.textContent).toBe('Words')
    expect(read('OEBPS/style.css')).toContain('[data-callout="tip"]::before { content: "Tip";')
  })

  it('keeps the deeper headings, spaced like the others', async () => {
    const deep = chapter('one', [{ type: 'heading', attrs: { level: 5 }, content: [text('Five')] }])
    const { xml, read } = await open([deep])
    expect(xml('OEBPS/chapter-1.xhtml').querySelector('h5')?.textContent).toBe('Five')
    expect(read('OEBPS/style.css')).toContain('h4, h5, h6 { line-height')
  })

  it('keeps a line’s alignment, well-formed', async () => {
    const aligned = chapter('one', [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [text('Part One')] }])
    const { xml } = await open([aligned])
    const one = xml('OEBPS/chapter-1.xhtml')
    expect(broken(one)).toBe(false)
    expect(one.querySelector('p')?.getAttribute('style')).toBe('text-align: center;')
  })

  it('makes each chapter well-formed XHTML, its words intact', async () => {
    const { xml } = await open()
    const one = xml('OEBPS/chapter-1.xhtml')
    expect(broken(one)).toBe(false)
    expect(one.documentElement.namespaceURI).toBe('http://www.w3.org/1999/xhtml')
    expect(one.body.textContent).toContain('The boats & the <quay>.')
    expect(one.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe('style.css')
  })

  it('leaves notes to self behind', async () => {
    const note = { type: 'noteToSelf', attrs: { id: 'n1', text: 'Check the tide times.' } }
    const { files, read } = await open([chapter('noted', [p(text('Chapter one')), p({ type: 'text', text: 'The boats came in.', marks: [note] })])])
    expect(read('OEBPS/chapter-1.xhtml')).toContain('The boats came in.')
    for (const name of Object.keys(files)) expect(read(name)).not.toMatch(/tide|nib-note-to-self/)
  })

  it('numbers footnotes through the book, each chapter’s notes at its end', async () => {
    const { xml } = await open()
    const one = xml('OEBPS/chapter-1.xhtml')
    const two = xml('OEBPS/chapter-2.xhtml')
    expect(one.getElementById('ref-1')?.getAttribute('href')).toBe('#note-1')
    expect(one.getElementById('note-1')?.textContent).toContain('First note.')
    expect(two.getElementById('ref-2')?.getAttribute('href')).toBe('#note-2')
    expect(two.getElementById('note-2')?.textContent).toContain('Second note.')
    expect(two.querySelector('ol.notes')?.getAttribute('start')).toBe('2')
  })

  it('carries a picture as a file of its own, once however often it’s used, listed in the package', async () => {
    const { files, xml } = await open()
    const pictures = Object.keys(files).filter((name) => name.startsWith('OEBPS/images/'))
    expect(pictures).toEqual(['OEBPS/images/picture-1.png'])
    expect(files['OEBPS/images/picture-1.png']).toEqual(Uint8Array.from(atob(PICTURE.split(',')[1]), (char) => char.charCodeAt(0)))
    for (const name of ['OEBPS/chapter-1.xhtml', 'OEBPS/chapter-2.xhtml']) {
      const img = xml(name).querySelector('img')!
      expect(img.getAttribute('src')).toBe('images/picture-1.png')
      expect(img.hasAttribute('alt')).toBe(true)
    }
    const opf = xml('OEBPS/content.opf')
    expect(opf.querySelector('manifest item[href="images/picture-1.png"]')?.getAttribute('media-type')).toBe('image/png')
  })

  it('lists in its package every file it holds, and holds every file listed', async () => {
    const { files, xml } = await open()
    const listed = [...xml('OEBPS/content.opf').querySelectorAll('manifest item')].map((item) => `OEBPS/${item.getAttribute('href')}`)
    const held = Object.keys(files).filter((name) => !['mimetype', 'META-INF/container.xml', 'OEBPS/content.opf'].includes(name))
    expect(listed.sort()).toEqual(held.sort())
    expect(xml('OEBPS/content.opf').querySelector('manifest item[properties="nav"]')?.getAttribute('href')).toBe('nav.xhtml')
  })
})

describe('a picture the writer sized, in a book', () => {
  it('says its size in its chapter, and the book’s stylesheet has what each size is', async () => {
    const bytes = new Uint8Array(await compileEpub('Sized', [chapter('one', [p({ type: 'image', attrs: { src: PICTURE, alt: '', size: 'large' } })])], 'en-GB').arrayBuffer())
    const files = unzipSync(bytes)
    expect(strFromU8(files['OEBPS/chapter-1.xhtml'])).toMatch(/<img [^>]*data-size="large"/)
    expect(strFromU8(files['OEBPS/style.css'])).toContain('img[data-size="large"] { width: 75%; }')
  })
})
