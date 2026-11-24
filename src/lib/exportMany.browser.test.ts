import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { Item } from '../db/db'
import { zipOf } from './exportMany'

/** Several documents as one zip (lib/exportMany). The printing itself is the system's (NibPdfPlugin.swift), stood in for here. */

const printer = vi.hoisted(() => ({ busy: 0, most: 0, printPdf: vi.fn() }))
vi.mock('./documentExport', async (actual) => ({ ...(await actual<typeof import('./documentExport')>()), printPdf: printer.printPdf }))

const note = (text: string): Item => ({
  id: crypto.randomUUID(),
  kind: 'note',
  body: { type: 'doc', content: text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }, { type: 'paragraph', content: [{ type: 'text', text: `More of ${text}` }] }] : [{ type: 'paragraph' }] },
  createdAt: 1,
  updatedAt: 1,
  version: 1,
})
const unzipped = async (zip: Blob) => unzipSync(new Uint8Array(await zip.arrayBuffer()))

beforeEach(() => {
  printer.busy = 0
  printer.most = 0
  printer.printPdf.mockReset().mockImplementation(async (_html: string, name: string) => {
    printer.most = Math.max(printer.most, ++printer.busy)
    await new Promise((resolve) => setTimeout(resolve, 20))
    printer.busy--
    return new TextEncoder().encode(`%PDF of ${name}`)
  })
})

describe('several documents as a zip', () => {
  it('holds a Markdown file for each, named for its title', async () => {
    const zip = await zipOf([note('Alpha'), note('Beta')], 'md', () => {})
    expect(zip.type).toBe('application/zip')
    const files = await unzipped(zip)
    expect(Object.keys(files)).toEqual(['Alpha.md', 'Beta.md'])
    expect(strFromU8(files['Alpha.md'])).toBe('Alpha\n\nMore of Alpha')
    expect(strFromU8(files['Beta.md'])).toContain('More of Beta')
  })

  it('holds a screenplay as its Fountain, named for its title', async () => {
    const lines = ['Title: The Keeper', '', 'INT. HOUSE - DAY']
    const script: Item = { ...note(''), kind: 'page', screenplay: true, body: { type: 'doc', content: lines.map((text) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })) } }
    const files = await unzipped(await zipOf([script, { ...script, id: crypto.randomUUID() }], 'md', () => {}))
    expect(Object.keys(files)).toEqual(['The Keeper.fountain', 'The Keeper 2.fountain'])
    expect(strFromU8(files['The Keeper.fountain'])).toBe('Title: The Keeper\n\nINT. HOUSE - DAY\n')
  })

  it('numbers a second of the same name, whatever its capitals, and one with no title is Untitled', async () => {
    const files = await unzipped(await zipOf([note('Draft'), note('draft'), note('Draft'), note(''), note('')], 'md', () => {}))
    expect(Object.keys(files)).toEqual(['Draft.md', 'draft 2.md', 'Draft 3.md', 'Untitled.md', 'Untitled 2.md'])
  })

  it('numbers past a title too long to be told apart by its end', async () => {
    const long = 'x'.repeat(120)
    const files = await unzipped(await zipOf([note(long), note(long)], 'md', () => {}))
    expect(Object.keys(files)).toEqual([`${'x'.repeat(80)}.md`, `${'x'.repeat(80)} 2.md`])
  })

  it('holds a page of its own for each as HTML', async () => {
    const files = await unzipped(await zipOf([note('Alpha'), note('Beta')], 'html', () => {}))
    expect(Object.keys(files)).toEqual(['Alpha.html', 'Beta.html'])
    const page = strFromU8(files['Beta.html'])
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).toContain('<title>Beta</title>')
    expect(page).toContain('>More of Beta</p>')
    expect(page).not.toContain('Alpha')
  })

  it('prints PDFs one at a time, in order, each under its own name, saying which it is on', async () => {
    const heard: [number, number][] = []
    const files = await unzipped(await zipOf([note('Alpha'), note('Alpha'), note('Beta')], 'pdf', (which, of) => heard.push([which, of])))
    expect(printer.most).toBe(1)
    expect(printer.printPdf.mock.calls.map(([, name]) => name)).toEqual(['Alpha.pdf', 'Alpha 2.pdf', 'Beta.pdf'])
    expect(printer.printPdf.mock.calls[2][0]).toContain('>More of Beta</p>')
    expect(heard).toEqual([[1, 3], [2, 3], [3, 3]])
    expect(Object.keys(files)).toEqual(['Alpha.pdf', 'Alpha 2.pdf', 'Beta.pdf'])
    expect(strFromU8(files['Alpha 2.pdf'])).toBe('%PDF of Alpha 2.pdf')
  })

  it('makes no zip when one can’t be printed', async () => {
    printer.printPdf.mockRejectedValueOnce(new Error('no printer'))
    await expect(zipOf([note('Alpha'), note('Beta')], 'pdf', () => {})).rejects.toThrow('no printer')
  })
})
