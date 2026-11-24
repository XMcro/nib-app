// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { nibExtensions } from './extensions'
import { setInVault } from '../lib/text'
import { MAX_CELLS, parseCsv, rowsOf, tableFromCsv, toCsv } from './tableCsv'

const schema = getSchema(nibExtensions(true))
const bytes = (text: string) => new TextEncoder().encode(text)
const made = (text: string) => {
  const read = tableFromCsv(bytes(text))
  if ('problem' in read) throw new Error(read.problem)
  return read.table
}
const shape = (table: JSONContent) => rowsOf(schema.nodeFromJSON(table))

describe('reading a CSV', () => {
  it.each<[string, string, string[][]]>([
    ['commas', 'a,b\nc,d', [['a', 'b'], ['c', 'd']]],
    ['Windows line ends', 'a,b\r\nc,d\r\n', [['a', 'b'], ['c', 'd']]],
    ['old Mac line ends', 'a\rb', [['a'], ['b']]],
    ['a comma inside quotes', '"a,b",c', [['a,b', 'c']]],
    ['a doubled quote', '"say ""hi""",c', [['say "hi"', 'c']]],
    ['a line end inside quotes', '"one\ntwo",c', [['one\ntwo', 'c']]],
    ['a quote in the middle of a cell, as it stands', 'ab"c,d', [['ab"c', 'd']]],
    ['empty cells', 'a,,c\n,,', [['a', '', 'c'], ['', '', '']]],
    ['blank lines left out', 'a\n\n\nb\n', [['a'], ['b']]],
    ['semicolons, as Excel writes them where a comma is the decimal point', 'a;1,5\nb;2,5', [['a', '1,5'], ['b', '2,5']]],
    ['tabs', 'a\tb\nc\td', [['a', 'b'], ['c', 'd']]],
    ['a delimiter inside quotes on the first line, not counted', '"a;b;c",d\ne,f', [['a;b;c', 'd'], ['e', 'f']]],
    ['nothing', '', []],
  ])('handles %s', (_, text, rows) => {
    expect(parseCsv(text)).toEqual(rows)
  })
})

describe('a table from a CSV', () => {
  it('fits the page, its first row the header, every row as wide as the widest', () => {
    const table = made('name,age,town\nAda\nGrace,85')
    expect(() => schema.nodeFromJSON(table).check()).not.toThrow()
    expect(table.content!.map((row) => row.content![0].type)).toEqual(['tableHeader', 'tableCell', 'tableCell'])
    expect(shape(table)).toEqual([['name', 'age', 'town'], ['Ada', '', ''], ['Grace', '85', '']])
  })

  it('gives each line of a cell its own paragraph', () => {
    const table = made('"one\ntwo",b')
    expect(table.content![0].content![0].content!.map((block) => block.content?.[0].text)).toEqual(['one', 'two'])
    expect(() => schema.nodeFromJSON(table).check()).not.toThrow()
  })

  it('reads UTF-8 with Excel’s byte-order mark, and Excel’s plain CSV', () => {
    expect(shape(made('\uFEFFcafé,b'))[0]).toEqual(['café', 'b'])
    const windows = tableFromCsv(Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x2c, 0x62]))
    expect('table' in windows && shape(windows.table)[0]).toEqual(['café', 'b'])
  })

  it('says so when there is nothing in it, or it is too much for a page', () => {
    expect(tableFromCsv(bytes(''))).toEqual({ problem: 'There’s nothing in that CSV.' })
    expect(tableFromCsv(bytes('\n\n'))).toEqual({ problem: 'There’s nothing in that CSV.' })
    const rows = (count: number) => bytes(Array.from({ length: count }, () => 'a,b').join('\n'))
    expect('table' in tableFromCsv(rows(MAX_CELLS / 2))).toBe(true)
    expect(tableFromCsv(rows(MAX_CELLS / 2 + 1))).toEqual({ problem: 'That CSV is too long to put in a page.' })
    expect(tableFromCsv(new Uint8Array(4 * 1024 * 1024 + 1))).toEqual({ problem: 'That CSV is too long to put in a page.' })
  })
})

describe('writing a CSV', () => {
  it('opens with the mark Excel needs for UTF-8, and ends lines as RFC 4180 does', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('\uFEFFa,b\r\nc,d\r\n')
  })

  it('quotes only what needs it', () => {
    expect(toCsv([['a,b', 'say "hi"', 'one\ntwo', 'plain']])).toBe('\uFEFF"a,b","say ""hi""","one\ntwo",plain\r\n')
  })

  it.each(['=SUM(A1:A2)', '@cmd', '+cmd|x', '-cmd|x', '\tx'])('makes text of %j, which a spreadsheet would run', (cell) => {
    expect(toCsv([[cell]])).toBe(`\uFEFF'${cell}\r\n`)
  })

  it.each(['-5', '+1.5', '-3,000.25', '+1 555 1234', '-12%', 'a=b', ''])('leaves %j as it is', (cell) => {
    expect(parseCsv(toCsv([[cell, 'x']]).slice(1))[0][0]).toBe(cell)
  })

  it('comes back as it went, formulas and all', () => {
    const rows = [['=SUM(A1:A2)', '@name', '-5'], ['"quoted", with comma', 'line\nbreak', '']]
    expect(shape(made(toCsv(rows).slice(1)))).toEqual(rows)
  })
})

describe('a table’s rows', () => {
  const cell = (content: JSONContent[], attrs = {}): JSONContent => ({ type: 'tableCell', attrs, content })
  const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
  const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: value, ...(marks && { marks }) })
  const row = (...content: JSONContent[]): JSONContent => ({ type: 'tableRow', content })

  it('are its words alone, a line to a paragraph or a break', () => {
    const table = { type: 'table', content: [row(
      cell([para(text('bold', [{ type: 'bold' }])), para(text('second'))]),
      cell([para(text('a'), { type: 'hardBreak' }, text('b'))]),
      cell([para(text('see '), { type: 'noteLink', attrs: { id: 'x', title: 'That note' } })]),
      cell([para(text('words'), { type: 'footnote', attrs: { text: 'kept back' } })]),
    )] }
    expect(rowsOf(schema.nodeFromJSON(table))).toEqual([['bold\nsecond', 'a\nb', 'see That note', 'words']])
    // Locked since it was linked to, the link still holds its title: the file gave it out, where the page doesn't.
    setInVault(new Set(['x']))
    expect(rowsOf(schema.nodeFromJSON(table))[0][2]).toBe('see A locked note')
    setInVault(new Set())
  })

  it('keep columns level around a merged cell, its words in the first square', () => {
    const table = { type: 'table', content: [
      row(cell([para(text('wide'))], { colspan: 2 }), cell([para(text('tall'))], { rowspan: 2 })),
      row(cell([para(text('a'))]), cell([para(text('b'))])),
    ] }
    expect(rowsOf(schema.nodeFromJSON(table))).toEqual([['wide', '', 'tall'], ['a', 'b', '']])
  })
})
