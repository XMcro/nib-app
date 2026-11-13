import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import type { JSONContent } from '@tiptap/react'
import { nibExtensions } from './extensions'
import { notesAndTks, withoutNotes } from './NoteToSelf'

describe('withoutNotes', () => {
  it('takes off notes to self wherever they are, and nothing else', () => {
    const note = { type: 'noteToSelf', attrs: { id: 'n1', text: 'Check the tide times.' } }
    const item = (marks: JSONContent['marks']): JSONContent => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lanterns', marks }] }] })
    const list = (...items: JSONContent[]): JSONContent => ({ type: 'doc', content: [{ type: 'bulletList', content: items }] })
    expect(withoutNotes(list(item([note, { type: 'italic' }]), item([note])))).toEqual(list(item([{ type: 'italic' }]), { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lanterns' }] }] }))
  })

  // Stored JSON is not trusted: what synced or restored may not be what Nib wrote.
  it('passes through what isn’t a list of marks or of nodes', () => {
    const odd = { type: 'doc', content: [{ type: 'text', text: 'x', marks: 'bold' }, { type: 'text', text: 'y', marks: [null] }], attrs: 'z' } as unknown as JSONContent
    expect(withoutNotes(odd)).toEqual(odd)
  })
})

describe('notesAndTks', () => {
  const schema = getSchema(nibExtensions(true))
  const note = (id: string, text: string) => ({ type: 'noteToSelf', attrs: { id, text } })
  const run = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) })
  const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
  const read = (...content: JSONContent[]) => {
    const doc = PMNode.fromJSON(schema, { type: 'doc', content })
    return { doc, entries: notesAndTks(doc) }
  }

  it('gives a note once, its pieces together, apart where they are apart', () => {
    const { entries } = read(
      para(run('First '), run('half', [note('n2', 'Too slow?')])),
      para(run('sec', [note('n2', 'Too slow?')]), run('ond', [note('n2', 'Too slow?'), { type: 'bold' }]), run(' half.')),
    )
    expect(entries).toEqual([{ key: 'note:n2', kind: 'note', id: 'n2', text: 'Too slow?', passage: 'half … second', from: 7, to: 19 }])
  })

  it('finds TK in capitals as a word of its own, TKTK too, and nothing else', () => {
    const { doc, entries } = read(para(run('Leaves at TK, back by TKTK. The TK’s cost: Tk tk TKO ATKINS OTK 2TK.')))
    expect(entries.map((entry) => (entry.kind === 'tk' ? entry.word : null))).toEqual(['TK', 'TKTK', 'TK'])
    for (const entry of entries) expect(doc.textBetween(entry.from, entry.to)).toBe(entry.kind === 'tk' && entry.word)
  })

  it('finds both of two TKs one character apart', () => {
    expect(read(para(run('TK TK'))).entries).toMatchObject([{ word: 'TK', from: 1, to: 3 }, { word: 'TK', from: 4, to: 6 }])
  })

  it('finds a TK where it is, after a footnote or a line break too', () => {
    const { doc, entries } = read(para(run('See'), { type: 'footnote', attrs: { text: 'Pevensie' } }, run(' the'), { type: 'hardBreak' }, run('TK here.')))
    expect(entries).toHaveLength(1)
    expect(doc.textBetween(entries[0].from, entries[0].to)).toBe('TK')
  })

  it('shows a TK with some of its paragraph, in whole words', () => {
    const long = 'The ferry leaves the harbour every morning at TK and comes back long after the lamps along the quay are lit.'
    const [entry] = read(para(run(long))).entries
    expect(entry).toMatchObject({ before: '…leaves the harbour every morning at ', after: ' and comes back long after the lamps…' })
    expect(read(para(run('At TK.'))).entries[0]).toMatchObject({ before: 'At ', after: '.' })
  })

  it('puts notes and TKs in the order they come', () => {
    const { entries } = read(para(run('TK first, then '), run('a passage', [note('n1', 'Check.')]), run(', then TK.')), para(run('TKTK')))
    expect(entries.map((entry) => entry.key)).toEqual(['tk:0', 'note:n1', 'tk:1', 'tk:2'])
  })
})
