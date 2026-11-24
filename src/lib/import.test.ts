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

  // Split wherever the text had them, a page with a "Notes" heading of its own came back as two documents,
  // the second a note, and code with a rule in it as two pages with the code torn between them.
  it('splits an export only where it put a heading or a rule itself', () => {
    const page = (id: string, ...content: object[]): Item => ({ ...item('page', id), body: { type: 'doc', content } as Item['body'] })
    const words = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const headed = page('headed', words('Plan'), { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Notes' }] }, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Pages' }] }, words('After'))
    const coded = page('coded', words('Front matter'), { type: 'codeBlock', content: [{ type: 'text', text: 'title: x\n\n---\n\nbody' }] })
    const incoming = parseImport(buildExport([item('note', 'a note')], [headed, coded], Date.parse('2026-08-07')), 'note')
    expect(incoming.map(({ kind }) => kind)).toEqual(['note', 'page', 'page'])
    expect(incoming[1].markdown).toBe('Plan\n\n## Notes\n\n## Pages\n\nAfter')
    expect(incoming[2].markdown).toBe('Front matter\n\n```\ntitle: x\n\n---\n\nbody\n```')
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
