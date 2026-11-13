import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import JSZip from 'jszip'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import type { PlusProduct } from './lib/plus'
import type { OpenDocument } from './lib/useOpenDocument'
import * as vault from './lib/vault'
import * as revisions from './db/revisions'
import { localDay } from './lib/time'

/**
 * Compiling a manuscript (ManuscriptPanel's Compile as): one Word, PDF or EPUB file
 * of the whole book, for Nib Plus. In the app, as Plus is.
 */

vi.mock('./lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/platform')>()),
  nativeApp: true,
}))
vi.mock('./lib/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/inbox')>()),
  inbox: { list: async () => ({ captures: [] }), ack: async () => {}, addListener: async () => ({ remove: async () => {} }) },
}))
vi.mock('./lib/lock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/lock')>()),
  lock: { status: async () => ({ enabled: false, after: 0, available: true, biometry: 'faceID', device: 'iPhone' }), vault: async () => {} },
}))

const PRODUCTS: PlusProduct[] = [
  { id: 'app.nib.plus.monthly', displayName: 'Monthly', displayPrice: '$3.99', price: 3.99, currency: 'USD', period: 'month' },
  { id: 'app.nib.plus.yearly', displayName: 'Yearly', displayPrice: '$29.99', price: 29.99, currency: 'USD', period: 'year' },
]
const state = vi.hoisted(() => ({ active: false }))
const { useState } = await import('react')
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [...useState({ active: state.active }), true],
  store: {
    products: async () => ({ products: PRODUCTS }),
    purchase: vi.fn(),
    restore: vi.fn(),
    manage: vi.fn(),
    entitlement: vi.fn(),
  },
}))
// The PDF is printed by the system (NibPdfPlugin.swift): stood in for, what it's asked to print kept, and the sheet that would share it.
const printer = vi.hoisted(() => ({ asked: [] as { html: string; name: string; header?: string }[] }))
vi.mock('@capacitor/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@capacitor/core')>()
  const pdf = { render: async (options: { html: string; name: string; header?: string }) => (printer.asked.push(options), { path: `file:///exports/${options.name}` }) }
  return { ...real, registerPlugin: ((name: string, ...rest: []) => (name === 'NibPdf' ? pdf : real.registerPlugin(name, ...rest))) as typeof real.registerPlugin }
})
vi.mock('./lib/download', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/download')>()), share: async () => {} }))
vi.mock('./lib/upsell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/upsell')>()),
  watchUpsell: () => () => {},
}))

const { App } = await import('./App')
const { fileActions } = await import('./fileActions')
const { readFolderSettings, replaceFolderSettings } = await import('./lib/folderSettings')
const { bookOf } = await import('./lib/manuscript')

const doc = (title: string, text: string) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: title }] },
    { type: 'paragraph', content: [{ type: 'text', text }] },
  ],
})
const library = () => within(document.querySelector<HTMLElement>('.nib-library')!)

/** Files handed over as a browser would download them: the name and what's in it. */
let handed: { name: string; blob: Blob }[] = []

beforeEach(async () => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  localStorage.clear()
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  await db.items.clear()
  await page.viewport(1280, 800)
  state.active = false
  replaceFolderSettings({})
  handed = []
  printer.asked = []
  const two = await items.create('page', doc('Chapter two', 'It had been a long season.'), { folder: 'Novel' })
  const one = await items.create('page', doc('Chapter one', 'The boats came in late.'), { folder: 'Novel' })
  await items.setPositions([
    { id: one, position: 1 },
    { id: two, position: 2 },
  ])
  await items.create('note', doc('Research notes', 'Tides.'), { folder: 'Novel' })
  let made: Blob | null = null
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    made = blob as Blob
    return 'blob:made'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (this.download && made) handed.push({ name: this.download, blob: made })
  })
})
afterEach(() => void vi.useRealTimers())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openManuscript() {
  await act(async () => void render(<App />))
  await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
  await userEvent.click(await library().findByRole('button', { name: /^Novel/ }))
  await userEvent.click(await library().findByRole('button', { name: 'Manuscript' }))
  await library().findByText('2 chapters · 15 words')
}

describe('compiling a manuscript', () => {
  // The vault shut after the panel drew them: a shut vault's pages are in no folder (lib/folders).
  it('says so when every page is locked with the vault shut, and makes nothing', async () => {
    await vault.openVault('harbour lights', [])
    const pages = await items.list('page')
    for (const page of pages) await items.lock(page.id, page.body)
    vault.closeVault()
    const setNotice = vi.fn()
    const session = { flush: async () => {}, guarded: (action: () => Promise<unknown>) => action() } as unknown as OpenDocument
    await fileActions({ session, setNotice, features: true, askPlus: vi.fn(), everything: [], theme: 'light', sort: 'updated', setImportReport: vi.fn(), onRestored: vi.fn() }).compileManuscript('Novel', [{ name: null, folder: 'Novel', chapters: pages }], 'docx')
    expect(setNotice).toHaveBeenCalledWith('Every page in this book is locked. Open the vault to compile it.')
    expect(handed).toHaveLength(0)
  })

  it('asks for Plus without it, and makes nothing', async () => {
    await openManuscript()
    await userEvent.click(library().getByRole('button', { name: 'Compile as Word' }))
    expect(await within(document.body).findByText('Compiling a manuscript into one Word, PDF or EPUB file is part of Nib Plus.')).toBeTruthy()
    expect(handed).toEqual([])
  })

  it('with Plus, hands over one Word file named for the folder, its chapters in book order and no notes', async () => {
    state.active = true
    await openManuscript()
    await userEvent.click(library().getByRole('button', { name: 'Compile as Word' }))
    await expect.poll(() => handed.length).toBe(1)
    expect(handed[0].name).toBe('Novel.docx')
    const xml = await (await JSZip.loadAsync(handed[0].blob)).file('word/document.xml')!.async('string')
    expect(xml.indexOf('Chapter one')).toBeGreaterThan(-1)
    expect(xml.indexOf('Chapter one')).toBeLessThan(xml.indexOf('Chapter two'))
    expect(xml).not.toContain('Research notes')
  })
})

describe('compiling a manuscript with parts', () => {
  beforeEach(async () => {
    state.active = true
    const storm = await items.create('page', doc('The storm', 'It broke at noon.'), { folder: 'Novel/Part 1' })
    const calm = await items.create('page', doc('The calm', 'Nothing moved.'), { folder: 'Novel/Part 1' })
    await items.setPositions([
      { id: calm, position: 1 },
      { id: storm, position: 2 },
    ])
    await items.create('page', doc('Landfall', 'They saw the light.'), { folder: 'Novel/Part 2' })
  })
  const open = async (...chips: RegExp[]) => {
    await act(async () => void render(<App />))
    await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
    for (const chip of chips) await userEvent.click(await library().findByRole('button', { name: chip }))
    await userEvent.click(await library().findByRole('button', { name: 'Manuscript' }))
  }

  it('hands over one book: the folder’s own chapters, then each part on a page of its own name before its chapters', async () => {
    await open(/^Novel/)
    await library().findByText(/^5 chapters · /)
    await userEvent.click(library().getByRole('button', { name: 'Compile as Word' }))
    await expect.poll(() => handed.length).toBe(1)
    expect(handed[0].name).toBe('Novel.docx')
    const xml = await (await JSZip.loadAsync(handed[0].blob)).file('word/document.xml')!.async('string')
    const order = ['Chapter one', 'Chapter two', 'Part 1', 'The calm', 'The storm', 'Part 2', 'Landfall'].map((words) => xml.indexOf(`>${words}<`))
    expect(order.every((at) => at > -1)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('names a part’s own book for its folder and itself, with no page for a part in it', async () => {
    await open(/^Novel/, /^Part 1, in Novel/)
    await library().findByText(/^2 chapters · /)
    await userEvent.click(library().getByRole('button', { name: 'Compile as Word' }))
    await expect.poll(() => handed.length).toBe(1)
    // The colon in "Novel: Part 1" is no part of a file's name.
    expect(handed[0].name).toBe('Novel Part 1.docx')
    const xml = await (await JSZip.loadAsync(handed[0].blob)).file('word/document.xml')!.async('string')
    expect(xml).toContain('The calm')
    expect(xml).not.toContain('>Part 1<')
    expect(xml).not.toContain('Chapter one')
  })
})

describe('code in what’s handed over', () => {
  const source = (words: string) => ({ type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: `const ${words}` }] }] })
  const actions = (id: string) => {
    const session = { flush: async () => {}, guarded: (action: () => Promise<unknown>) => action(), whenSaved: (act: (id: string) => Promise<void>) => act(id) } as unknown as OpenDocument
    return fileActions({ session, setNotice: vi.fn(), features: true, askPlus: vi.fn(), everything: [], theme: 'light', sort: 'updated', setImportReport: vi.fn(), onRestored: vi.fn() })
  }

  it('is in its colours in a compiled book', async () => {
    const id = await items.create('page', source('inTheBook'), { folder: 'Code' })
    await actions(id).compileManuscript('Code', [{ name: null, folder: 'Code', chapters: [(await items.get(id))!] }], 'docx')
    await expect.poll(() => handed.length).toBe(1)
    expect(await (await JSZip.loadAsync(handed[0].blob)).file('word/document.xml')!.async('string')).toMatch(/<w:color w:val="6d3fd4"\/>.*?<w:t[^>]*>const<\/w:t>/)
  })

  it('is in its colours in a page exported by itself', async () => {
    const id = await items.create('page', source('byItself'))
    await actions(id).exportCurrentAs('html')
    await expect.poll(() => handed.length).toBe(1)
    expect(await handed[0].blob.text()).toContain('<span class="nib-code-keyword">const</span>')
  })
})

describe('compiling a manuscript as an e-book', () => {
  it('with Plus, hands over one EPUB named for the folder, its chapters in book order', async () => {
    state.active = true
    await openManuscript()
    await userEvent.click(library().getByRole('button', { name: 'Compile as EPUB' }))
    await expect.poll(() => handed.length).toBe(1)
    expect(handed[0].name).toBe('Novel.epub')
    const zip = await JSZip.loadAsync(handed[0].blob)
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip')
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav.indexOf('Chapter one')).toBeGreaterThan(-1)
    expect(nav.indexOf('Chapter one')).toBeLessThan(nav.indexOf('Chapter two'))
    expect(nav).not.toContain('Research notes')
  })
})

describe('a manuscript’s stamps', () => {
  /** The chapters wear 139, on a sunburst, Halloween's and 127 between them, 127 twice. */
  async function stamp() {
    const [one, two] = (await items.list('page')).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    await items.setStamps(one.id, [{ day: '2026-11-06', no: 139 }, { day: '2026-11-04', no: 127 }])
    await items.setStamps(two.id, [{ day: '2026-10-31' }, { day: '2026-11-05', no: 127 }])
  }

  it('are its chapters’, each once, on its page', async () => {
    await stamp()
    await openManuscript()
    const worn = library().getByRole('img', { name: 'Its chapters’ 3 stamps' })
    expect([...worn.children].map((stamp) => stamp.firstElementChild!.getAttribute('aria-label')!.split(',')[0])).toEqual(['The sun', 'An inkpot', 'A jack-o’-lantern'])
  })

  it('go on a cover before the first chapter, in Word and in an e-book, and there’s none without', async () => {
    state.active = true
    await stamp()
    await openManuscript()
    await userEvent.click(library().getByRole('button', { name: 'Compile as Word' }))
    await expect.poll(() => handed.length).toBe(1)
    const word = await JSZip.loadAsync(handed[0].blob)
    const xml = await word.file('word/document.xml')!.async('string')
    expect(xml.indexOf('Novel')).toBeGreaterThan(-1)
    expect(xml.indexOf('<w:drawing>')).toBeGreaterThan(xml.indexOf('Novel'))
    expect(xml.indexOf('<w:drawing>')).toBeLessThan(xml.indexOf('Chapter one'))
    expect(Object.values(word.files).filter((file) => file.name.startsWith('word/media/') && !file.dir)).toHaveLength(1)

    await userEvent.click(library().getByRole('button', { name: 'Compile as EPUB' }))
    await expect.poll(() => handed.length).toBe(2)
    const book = await JSZip.loadAsync(handed[1].blob)
    const nav = await book.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav.indexOf('Novel')).toBeGreaterThan(-1)
    expect(nav.indexOf('Novel')).toBeLessThan(nav.indexOf('Chapter one'))
    const cover = await book.file('OEBPS/chapter-1.xhtml')!.async('string')
    expect(cover).toContain('alt="Stamps: Sunburst, Midnight Ink, Halloween"')
    expect(Object.keys(book.files).filter((name) => name.startsWith('OEBPS/images/'))).toEqual(['OEBPS/images/picture-1.png'])
    // Drawn, the three side by side, at twice their size.
    const png = await book.file('OEBPS/images/picture-1.png')!.async('blob')
    const bitmap = await createImageBitmap(png)
    expect([bitmap.width, bitmap.height]).toEqual([(3 * (110 + 24) + 24) * 2, (132 + 2 * 24) * 2])
    // Each a whole stamp, its paper solid in the middle: not the sunburst behind the first, loose.
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    const middles = [0, 1, 2].map((i) => canvas.getContext('2d')!.getImageData((24 + i * (110 + 24) + 55) * 2, (24 + 66) * 2, 1, 1).data[3])
    expect(middles).toEqual([255, 255, 255])

    // Taken off, the cover goes too.
    for (const page of await items.list('page')) await items.setStamps(page.id, [])
    await userEvent.click(library().getByRole('button', { name: 'Compile as EPUB' }))
    await expect.poll(() => handed.length).toBe(3)
    // No cover: no picture of stamps, and the book begins at its title page.
    const plain = await JSZip.loadAsync(handed[2].blob)
    expect(Object.keys(plain.files).filter((name) => name.startsWith('OEBPS/images/'))).toEqual([])
    expect(await plain.file('OEBPS/chapter-1.xhtml')!.async('string')).not.toContain('<img')
  })

  it('opens on a title page after the cover: the title and who it’s by, as given in the Manuscript, the name kept for the next book', async () => {
    state.active = true
    await openManuscript()
    const titlePage = within(library().getByRole('group', { name: 'Title page' }))
    await userEvent.fill(titlePage.getByRole('textbox', { name: 'Title' }), 'The Long Season')
    await userEvent.fill(titlePage.getByRole('textbox', { name: 'By' }), 'Ann Writer')
    await userEvent.click(library().getByRole('button', { name: 'Compile as Word' }))
    await expect.poll(() => handed.length).toBe(1)
    expect(handed[0].name).toBe('The Long Season.docx')
    const xml = await (await JSZip.loadAsync(handed[0].blob)).file('word/document.xml')!.async('string')
    expect(xml.indexOf('The Long Season')).toBeGreaterThan(-1)
    expect(xml.indexOf('by Ann Writer')).toBeGreaterThan(xml.indexOf('The Long Season'))
    expect(xml.indexOf('by Ann Writer')).toBeLessThan(xml.indexOf('Chapter one'))

    await userEvent.click(library().getByRole('button', { name: 'Compile as EPUB' }))
    await expect.poll(() => handed.length).toBe(2)
    const opf = await (await JSZip.loadAsync(handed[1].blob)).file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<dc:title>The Long Season</dc:title>')
    expect(opf).toContain('<dc:creator>Ann Writer</dc:creator>')
    expect(readFolderSettings().novel).toMatchObject({ title: 'The Long Season', author: 'Ann Writer' })
    // Another book is by the same name till it's given its own.
    expect(bookOf('Poems', readFolderSettings())).toEqual({ title: 'Poems', author: 'Ann Writer' })
  })
})

describe('a manuscript in standard manuscript format', () => {
  async function asGiven() {
    state.active = true
    await openManuscript()
    const titlePage = within(library().getByRole('group', { name: 'Title page' }))
    await userEvent.fill(titlePage.getByRole('textbox', { name: 'Title' }), 'The Long Season')
    await userEvent.fill(titlePage.getByRole('textbox', { name: 'By' }), 'Ann Writer')
    // A break between scenes at the end of the first chapter.
    const [one] = await items.list('page').then((pages) => pages.filter((page) => JSON.stringify(page.body).includes('Chapter one')))
    await items.update(one.id, { ...one.body, content: [...one.body.content!, { type: 'paragraph', content: [{ type: 'text', text: '***' }] }] })
  }

  it('asks for Plus without it, and makes nothing', async () => {
    await openManuscript()
    await userEvent.click(library().getByRole('button', { name: 'Compile a standard manuscript as Word' }))
    expect(await within(document.body).findByText('Compiling a manuscript into one Word, PDF or EPUB file is part of Nib Plus.')).toBeTruthy()
    expect(handed).toEqual([])
  })

  it('as Word: Times New Roman, double-spaced, an inch all round; the name, length and title first, then each chapter a third down a page of its own, under the running head and numbered from 1', async () => {
    await asGiven()
    await userEvent.click(library().getByRole('button', { name: 'Compile a standard manuscript as Word' }))
    await expect.poll(() => handed.length).toBe(1)
    expect(handed[0].name).toBe('The Long Season.docx')
    const zip = await JSZip.loadAsync(handed[0].blob)
    const styles = await zip.file('word/styles.xml')!.async('string')
    expect(styles).toMatch(/<w:docDefaults>.*w:ascii="Times New Roman".*<w:sz w:val="24"\/>.*w:after="0".*w:line="480"/s)

    const xml = await zip.file('word/document.xml')!.async('string')
    const [first, book] = xml.split(/<\/w:sectPr>/)
    // The first page: the name, then at the right the length; the title halfway down; who it's by. No running head.
    expect(first).toMatch(/Ann Writer<\/w:t>.*<w:tab\/>.*16 words<\/w:t>/s)
    expect(first.indexOf('16 words')).toBeLessThan(first.indexOf('The Long Season'))
    expect(first.indexOf('The Long Season')).toBeLessThan(first.indexOf('by Ann Writer'))
    expect(first).not.toContain('headerReference')
    expect(first).toMatch(/<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720"/)
    // The book: its own pages from 1, under the running head; each chapter a third down (Letter or A4), each paragraph indented.
    expect(book).toContain('<w:pgNumType w:start="1"/>')
    expect(book).toMatch(/<w:headerReference w:type="default"/)
    expect(book.indexOf('Chapter one')).toBeLessThan(book.indexOf('Chapter two'))
    expect(book.match(/<w:pageBreakBefore\/>/g)).toHaveLength(1)
    expect(book.match(/w:before="(3840|4173)"/g)).toHaveLength(2)
    expect(book).toMatch(/w:firstLine="720"/)
    expect(book).toMatch(/<w:jc w:val="center"\/>.*<w:t xml:space="preserve">#<\/w:t>/s)
    expect(book).not.toContain('***')
    const header = await zip.file(/^word\/header\d*\.xml$/)[0].async('string')
    expect(header).toContain('Writer / THE LONG SEASON / ')
    expect(header).toMatch(/PAGE/)
    // No cover, no title page of its own, no notes.
    expect(Object.keys(zip.files).filter((name) => name.startsWith('word/media/'))).toEqual([])
    expect(xml).not.toContain('Research notes')
  })

  it('as PDF: the same first page and chapters, the running head given to the printer to put on each page after the first', async () => {
    await asGiven()
    await userEvent.click(library().getByRole('button', { name: 'Compile a standard manuscript as PDF' }))
    await expect.poll(() => printer.asked.length).toBe(1)
    const [{ html, name, header }] = printer.asked
    expect(name).toBe('The Long Season.pdf')
    expect(header).toBe('Writer / THE LONG SEASON / ')
    const page = new DOMParser().parseFromString(html, 'text/html')
    expect(page.querySelector('style')!.textContent).toContain("font: 15px/2 'Times New Roman'")
    expect(page.querySelector('.first-page')!.textContent).toBe('Ann Writer16 wordsThe Long Seasonby Ann Writer')
    expect([...page.querySelectorAll('.chapter')].map((chapter) => chapter.textContent)).toEqual(['Chapter oneThe boats came in late.#', 'Chapter twoIt had been a long season.'])
    expect(page.querySelector('.chapter p[style*="text-align: center"]')!.textContent).toBe('#')
    expect(page.querySelector('img')).toBeNull()

    // An ordinary PDF is as ever: the printer's own margins, no running head.
    await userEvent.click(library().getByRole('button', { name: 'Compile as PDF' }))
    await expect.poll(() => printer.asked.length).toBe(2)
    expect(printer.asked[1]).not.toHaveProperty('header')
    expect(printer.asked[1].html).toContain('by Ann Writer')
  })
})

describe('a book’s word goal, in the app', () => {
  it('asks for Plus without it', async () => {
    await openManuscript()
    await userEvent.click(library().getByRole('button', { name: /A word goal for this book/ }))
    expect(await within(document.body).findByText('A word goal for each book, with a deadline, is part of Nib Plus.')).toBeTruthy()
  })

  it('with Plus, is set in the Manuscript and has the book’s words against it', async () => {
    state.active = true
    await openManuscript()
    await userEvent.click(library().getByRole('button', { name: 'Set a word goal' }))
    await userEvent.fill(library().getByRole('spinbutton', { name: 'Goal, in words' }), '1000')
    await userEvent.click(library().getByRole('button', { name: 'Save' }))
    expect(await library().findByText('15 of 1,000')).toBeTruthy()
    expect(readFolderSettings().novel.goal).toEqual({ words: 1000 })
  })
})

describe('finding across a book, in the app', () => {
  const chapter = async (title: string) => (await items.list('page')).find((page) => JSON.stringify(page.body).includes(title))!
  const textOf = (body: { content?: { content?: { text?: string }[] }[] }) => (body.content ?? []).map((block) => (block.content ?? []).map((run) => run.text).join('')).join('\n')
  async function findAndReplace(words: string, replacement: string, said: string) {
    await userEvent.click(await library().findByRole('button', { name: 'Find in this book' }))
    // Undo's there from the start, greyed till there's a Replace all to undo.
    expect(library().getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true)
    await userEvent.fill(library().getByRole('textbox', { name: 'Find in this book' }), words)
    await userEvent.fill(library().getByRole('textbox', { name: 'Replace with' }), replacement)
    await expect.poll(() => library().getByRole('button', { name: 'Replace all' }).hasAttribute('disabled')).toBe(false)
    await userEvent.click(library().getByRole('button', { name: 'Replace all' }))
    await expect.poll(() => library().queryByRole('status')?.textContent).toBe(said)
  }

  it('replaces in every chapter, the one open with what was typed in it too, each keeping its words before in History; Undo puts them back', async () => {
    state.active = true
    const one = await chapter('Chapter one')
    await openManuscript()
    // Chapter one open, with words typed in it and not yet saved.
    await userEvent.click(library().getAllByRole('button', { name: /Chapter one/ }).at(-1)!)
    await expect.poll(() => document.querySelector('.ProseMirror')?.textContent).toContain('The boats came in late.')
    const editor = (document.querySelector('.ProseMirror') as HTMLElement & { editor: { commands: { focus: (at: 'end') => void } } }).editor
    await act(async () => editor.commands.focus('end'))
    await userEvent.keyboard(' Rain.')
    await userEvent.click(screen.getByRole('button', { name: 'Pages' }))
    // Back where it was, in the Manuscript.
    await findAndReplace('boats', 'ships', 'Replaced 1 in 1 chapter')

    expect(textOf((await items.get(one.id))!.body)).toBe('Chapter one\nThe ships came in late. Rain.')
    expect((await revisions.list(one.id)).some((revision) => textOf(revision.body) === 'Chapter one\nThe boats came in late. Rain.')).toBe(true)
    // The editor under the library has the new words, so it can't write the old ones back.
    expect(document.querySelector('.ProseMirror')?.textContent).toContain('The ships came in late. Rain.')

    // Undo is a button of its own beside Replace all, always there, and stays while something else is typed (asked 2026-11-13: it was hard to
    // find, and went the moment anything else was done).
    const undo = () => library().getByRole('button', { name: 'Undo' })
    expect(library().getByRole('textbox', { name: 'Replace with' }).parentElement!.contains(undo())).toBe(true)
    expect(library().getByRole('button', { name: 'Replace all' })).toBeTruthy()
    await userEvent.fill(library().getByRole('textbox', { name: 'Find in this book' }), 'season')
    expect(undo().hasAttribute('disabled')).toBe(false)
    await userEvent.click(undo())
    await expect.poll(() => library().queryByRole('status')?.textContent).toBe('Put back 1 chapter')
    // Nothing left to undo: still there, greyed.
    expect(undo().hasAttribute('disabled')).toBe(true)
    expect(textOf((await items.get(one.id))!.body)).toBe('Chapter one\nThe boats came in late. Rain.')
    expect(document.querySelector('.ProseMirror')?.textContent).toContain('The boats came in late. Rain.')
  })

  it('replaces in a locked chapter while the vault is open, keeping no History of its words; shut, it’s out of the book', async () => {
    state.active = true
    const two = await chapter('Chapter two')
    await vault.openVault('harbour lights', [])
    await items.lock(two.id, two.body)
    await act(async () => void render(<App />))
    await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
    await userEvent.click(await library().findByRole('button', { name: /^Novel/ }))
    await userEvent.click(await library().findByRole('button', { name: 'Manuscript' }))
    await findAndReplace('season', 'summer', 'Replaced 1 in 1 chapter')

    const stored = (await items.get(two.id))!
    expect(vault.isLocked(stored)).toBe(true)
    expect(JSON.stringify(stored)).not.toContain('summer')
    expect(textOf((await items.opened(stored))!.body)).toBe('Chapter two\nIt had been a long summer.')
    expect((await revisions.list(two.id)).some((revision) => JSON.stringify(revision.body).includes('summer'))).toBe(false)

    // A shut vault's pages are in no folder (lib/folders), so not in the book either.
    await act(async () => vault.closeVault())
    await userEvent.fill(library().getByRole('textbox', { name: 'Find in this book' }), 'summer')
    await expect.poll(() => library().queryByRole('status')?.textContent).toBe('No matches')
  })

  it('opens the chapter of a match tapped, its find bar open at it', async () => {
    state.active = true
    await openManuscript()
    await userEvent.click(library().getByRole('button', { name: 'Find in this book' }))
    await userEvent.fill(library().getByRole('textbox', { name: 'Find in this book' }), 'season')
    await expect.poll(() => library().queryByRole('status')?.textContent).toBe('1 in 1 chapter')
    await userEvent.click(library().getByRole('button', { name: 'It had been a long season.' }))
    const field = await within(document.body).findByLabelText<HTMLInputElement>('Find in this document')
    expect(field.value).toBe('season')
    await expect.poll(() => field.closest('[role=search]')?.querySelector('[role=status]')?.textContent).toBe('1 of 1')
    expect(document.querySelector('.ProseMirror')?.textContent).toContain('It had been a long season.')
    expect(document.querySelector('.ProseMirror-active-search-match')?.textContent).toBe('season')
    // The bar keeps the keyboard, as it does opened by ⌘F, after the chapter has had its own focus: so no formatting bar over the match.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(document.activeElement).toBe(field)
  })
})
