import { describe, expect, it } from 'vitest'
import type { Item } from '../db/db'
import { buildExport } from './export'
import { parseImport } from './import'

const item = (kind: Item['kind'], text: string): Item => ({
  id: `id-${text}`,
  kind,
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  version: 1,
  createdAt: new Date('2026-08-05T09:00:00Z').getTime(),
  updatedAt: new Date('2026-08-05T09:00:00Z').getTime(),
})

describe('parseImport', () => {
  it('treats an ordinary file as one document of the current kind', () => {
    expect(parseImport('# Shopping\n\nBread, milk', 'note')).toEqual([
      { kind: 'note', markdown: '# Shopping\n\nBread, milk' },
    ])
    expect(parseImport('hello', 'page')).toEqual([{ kind: 'page', markdown: 'hello' }])
  })

  it('ignores an empty file', () => {
    expect(parseImport('   \n\n ', 'note')).toEqual([])
  })

  it('unpacks a Nib export back into separate items of the right kind', () => {
    const md = buildExport(
      [item('note', 'first note'), item('note', 'second note')],
      [item('page', 'a page')],
      new Date('2026-08-07T12:00:00Z').getTime(),
    )
    const incoming = parseImport(md, 'note')

    expect(incoming).toEqual([
      { kind: 'note', markdown: 'first note' },
      { kind: 'note', markdown: 'second note' },
      { kind: 'page', markdown: 'a page' },
    ])
  })

  it('round-trips a notes-only export', () => {
    const md = buildExport([item('note', 'only one')], [], Date.parse('2026-08-07'))
    expect(parseImport(md, 'page')).toEqual([{ kind: 'note', markdown: 'only one' }])
  })

  it('keeps body content that merely looks like a header line', () => {
    const [entry] = parseImport('### Not an export\n\nbody text', 'note')
    expect(entry.markdown).toBe('### Not an export\n\nbody text')
  })

  // Matching a bare "# Nib export" prefix meant the user's own writing about
  // the export format imported as nothing at all, silently.
  it('imports a note that merely writes about the export format', () => {
    const text = '# Nib export format notes\n\nIt starts with a date.'
    expect(parseImport(text, 'note')).toEqual([{ kind: 'note', markdown: text }])
  })

  it('falls back to one document when an export lost its section headings', () => {
    const md = buildExport([item('note', 'still here')], [], Date.parse('2026-08-07'))
    const edited = md.replace('\n## Notes\n', '\n')
    const incoming = parseImport(edited, 'note')
    expect(incoming).toHaveLength(1)
    expect(incoming[0].markdown).toContain('still here')
  })
})
