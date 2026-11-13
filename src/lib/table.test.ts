// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import { toHtml } from './documentExport'
import { markdownToBody } from './import'
import { toMarkdown } from './markdown'

/** Tables on a page: through Markdown and back, and out as HTML. */

const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const cell = (type: 'tableHeader' | 'tableCell', ...content: JSONContent[]): JSONContent => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: content.length ? content : [{ type: 'paragraph' }],
})
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', ...(content.length ? { content } : {}) })

const page: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Ferries')] },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', p(text('Leaves'))), cell('tableHeader', p(text('From')))] },
        { type: 'tableRow', content: [cell('tableCell', p(text('07:40', [{ type: 'bold' }]))), cell('tableCell', p(text('Pier 3 | east')))] },
        { type: 'tableRow', content: [cell('tableCell', p(text('09:10'))), cell('tableCell', p(text('Pier 1')), p(text('then bus')))] },
      ],
    },
  ],
}

const table = (body: JSONContent) => body.content?.find((node) => node.type === 'table')
const cells = (body: JSONContent) =>
  table(body)?.content?.map((row) => row.content?.map((one) => (one.content ?? []).map((block) => (block.content ?? []).map((t) => t.text ?? (t.type === 'hardBreak' ? '/' : '')).join('')).join('/')))

describe('a table in Markdown', () => {
  it('is written as a GFM table, a | in a cell escaped and a cell’s lines joined with <br>', () => {
    expect(toMarkdown(page)).toBe(
      ['# Ferries', '', '| Leaves | From |', '| --- | --- |', '| **07:40** | Pier 3 \\| east |', '| 09:10 | Pier 1<br>then bus |'].join('\n'),
    )
  })

  it('comes back into a page as the same table', () => {
    const back = markdownToBody(toMarkdown(page), 'page')
    expect(table(back)?.content?.[0].content?.map((one) => one.type)).toEqual(['tableHeader', 'tableHeader'])
    expect(cells(back)).toEqual([
      ['Leaves', 'From'],
      ['07:40', 'Pier 3 | east'],
      ['09:10', 'Pier 1/then bus'],
    ])
    expect(table(back)?.content?.[1].content?.[0].content?.[0].content?.[0].marks).toEqual([{ type: 'bold' }])
  })

  it('is read from another app’s Markdown', () => {
    const body = markdownToBody('| a | b |\n|---|---|\n| 1 | 2 |', 'page')
    expect(cells(body)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('a table exported as HTML', () => {
  it('is a real table, with borders a printed page keeps', () => {
    const item: Item = { id: 'x', kind: 'page', body: page, version: 1, createdAt: 1, updatedAt: 1 }
    const html = toHtml(item)
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    expect(parsed.querySelectorAll('table tr')).toHaveLength(3)
    expect(parsed.querySelectorAll('th')).toHaveLength(2)
    expect(parsed.querySelector('td')?.textContent).toBe('07:40')
    expect(html).toContain('th, td { border: 1px solid #ccc;')
  })
})
