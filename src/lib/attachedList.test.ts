import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import { attachedAcross } from './attachedList'

/** Every attachment in the library, as the manager lists them (lib/attachedList). */

const file = (n: number, size: number, type = 'application/pdf') => ({ id: `7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c${String(n).padStart(2, '0')}`, type, size })
const attachment = (attrs: Record<string, unknown>): JSONContent => ({ type: 'attachment', attrs })
const item = (id: string, title: string, ...blocks: JSONContent[]): Item => ({ id, kind: 'note', body: { type: 'doc', content: [{ type: 'paragraph', content: title ? [{ type: 'text', text: title }] : [] }, ...blocks] }, version: 1, createdAt: 1, updatedAt: 1 })

describe('the attachments in a library', () => {
  it('are listed the largest first, then by name, each with the document it’s in', () => {
    const { rows } = attachedAcross([
      item('a', 'Harbour plan', attachment({ file: file(1, 2_000), name: 'tides.csv' }), { type: 'blockquote', content: [attachment({ file: file(2, 9_000_000), name: 'survey.pdf' })] }),
      item('b', '', attachment({ file: file(3, 2_000), name: 'Berths.pdf' })),
      item('c', 'No files here'),
    ])
    expect(rows.map((row) => [row.name, row.file.size, row.item, row.title])).toEqual([
      ['survey.pdf', 9_000_000, 'a', 'Harbour plan'],
      // A document with no words of its own is titled by what's attached to it, as in the library.
      ['Berths.pdf', 2_000, 'b', 'Berths.pdf'],
      ['tides.csv', 2_000, 'a', 'Harbour plan'],
    ])
    expect(new Set(rows.map((row) => row.key)).size).toBe(3)
  })

  it('leave out one that’s a name alone, and anything that isn’t a file of the store’s', () => {
    const { rows, bytes } = attachedAcross([item('a', 'Minutes', attachment({ file: null, name: 'gone.pdf' }), attachment({ file: { id: '../index', type: 'x/y', size: 5 }, name: 'bad.pdf' }), attachment({ file: file(1, 300), name: '' }))])
    expect(rows).toEqual([])
    expect(bytes).toBe(0)
  })

  it('count a file once for the room it takes, however many documents name it', () => {
    const shared = file(1, 4_000_000)
    const { rows, bytes } = attachedAcross([item('a', 'One', attachment({ file: shared, name: 'report.pdf' }), attachment({ file: shared, name: 'report.pdf' })), item('b', 'Two', attachment({ file: shared, name: 'report.pdf' }), attachment({ file: file(2, 1_000_000), name: 'memo.m4a' }))])
    expect(rows).toHaveLength(4)
    expect(new Set(rows.map((row) => row.key)).size).toBe(4)
    expect(bytes).toBe(5_000_000)
  })
})
