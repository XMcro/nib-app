import { describe, expect, it } from 'vitest'
import type { Item } from '../db/db'
import { buildExport, exportFilename } from './export'

const AT = new Date('2026-08-07T12:00:00Z').getTime()
const MADE = new Date('2026-08-05T09:00:00Z').getTime()

const item = (kind: Item['kind'], text: string, createdAt = MADE): Item => ({
  id: `id-${text}`,
  kind,
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  version: 1,
  createdAt,
  updatedAt: createdAt,
})

describe('buildExport', () => {
  it('heads the file with the export date', () => {
    expect(buildExport([], [], AT)).toContain('# Nib export — 2026-08-07')
  })

  it('says so when there is nothing to export', () => {
    expect(buildExport([], [], AT)).toContain('Nothing saved yet.')
  })

  it('counts each kind, pluralised', () => {
    expect(buildExport([item('note', 'a')], [], AT)).toContain('1 note.')
    expect(buildExport([item('note', 'a'), item('note', 'b')], [], AT)).toContain('2 notes.')
    expect(buildExport([item('note', 'a')], [item('page', 'p')], AT)).toContain('1 note, 1 page.')
  })

  it('omits a section that has no items', () => {
    const output = buildExport([item('note', 'a')], [], AT)
    expect(output).toContain('## Notes')
    expect(output).not.toContain('## Pages')
  })

  it('writes each item with its title and creation date', () => {
    const output = buildExport([item('note', 'Ask Mara')], [], AT)
    expect(output).toContain('### Ask Mara')
    expect(output).toContain('*2026-08-05*')
    expect(output).toContain('Ask Mara')
  })

  it('carries formatting through as markdown', () => {
    const bold: Item = {
      ...item('note', 'x'),
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'loud', marks: [{ type: 'bold' }] }] },
        ],
      },
    }
    expect(buildExport([bold], [], AT)).toContain('**loud**')
  })

  it('puts a rule between entries and nowhere else', () => {
    const two = buildExport([item('note', 'a'), item('note', 'b')], [], AT)
    expect(two.split('\n\n---\n\n')).toHaveLength(2)

    // A single entry needs no rule at all, and headings are never separated.
    const one = buildExport([item('note', 'a')], [], AT)
    expect(one).not.toContain('---')
    expect(one).toContain('# Nib export — 2026-08-07\n\n1 note.\n\n## Notes\n\n### a')
  })
})

describe('exportFilename', () => {
  it('is dated and ends in .md', () => {
    expect(exportFilename(AT)).toBe('nib-export-2026-08-07.md')
  })

  // Security finding 7 of the 8 November audit.
  it('leaves what a picture says about itself behind', () => {
    const exif = new TextEncoder().encode('Exif\0\0GPS 51.5')
    const photo = `data:image/jpeg;base64,${btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe1, 0, exif.length + 2, ...exif, 0xff, 0xd9))}`
    const note = { id: 'a', kind: 'note' as const, version: 1, createdAt: 0, updatedAt: 0, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: photo } }] }] } }
    const file = buildExport([note], [], 0)
    expect(file).toContain(btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xd9)))
    expect(file).not.toContain(photo.slice(photo.indexOf(',') + 1))
  })
})
