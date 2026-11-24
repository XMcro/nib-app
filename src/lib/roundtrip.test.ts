// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import { buildExport } from './export'
import { markdownToBody, parseImport } from './import'
import { toMarkdown } from './markdown'
import { plainText } from './text'

/**
 * The shape the serialiser tests could not reach: what a document actually
 * looks like after it has been through a file and back. Every case here was a
 * silent corruption before — text deleted, formatting invented, or one
 * document torn into two.
 */

const para = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** A note's text, exported to Markdown and imported straight back. */
const rideAlong = (text: string) => plainText(markdownToBody(toMarkdown(para(text)), 'note'))

const item = (body: JSONContent): Item => ({
  id: crypto.randomUUID(),
  kind: 'note',
  body,
  version: 1,
  createdAt: Date.parse('2026-08-07T12:00:00Z'),
  updatedAt: Date.parse('2026-08-07T12:00:00Z'),
})

describe('markdown round trip', () => {
  it.each([
    ['angle brackets', 'Use Array<string> not any[]'],
    ['a bare tag', 'The <Sidebar /> component owns the list'],
    ['intraword asterisks', 'the regex is a*b*c'],
    ['asterisks and backticks', 'cost is 5*2*3 dollars and `not code`'],
    ['a leading hash', '# not a heading'],
    ['a leading dash', '- not a list'],
    ['a leading number', '1. first thing'],
    ['a bracket pair', 'see [1](notes) for detail'],
    ['a horizontal rule', '---'],
    ['an export section heading', '## Notes'],
    ['underscores', 'the file is called _draft_ for now'],
    ['a blockquote marker', '> not a quote'],
    ['an ampersand entity', 'literally &amp; not an ampersand'],
    ['a backslash', 'the escape is \\n in most languages'],
  ])('keeps %s as written', (_label, text) => {
    expect(rideAlong(text)).toBe(text)
  })

  it('keeps a code block’s language', () => {
    const body: JSONContent = { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'def go(): pass' }] }] }
    expect(markdownToBody(toMarkdown(body), 'note').content?.[0].attrs?.language).toBe('python')
  })

  it('keeps a code block that contains a fence', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        { type: 'codeBlock', content: [{ type: 'text', text: 'a\n```\nb' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ],
    }
    const back = markdownToBody(toMarkdown(body), 'note')
    expect(back.content?.[0].type).toBe('codeBlock')
    // HTML code blocks always end in a newline; it is added once and does not
    // grow on later round trips.
    expect(back.content?.[0].content?.[0].text?.trimEnd()).toBe('a\n```\nb')
    // The paragraph must not have been swallowed as source by an early close.
    expect(back.content?.[1].type).toBe('paragraph')
    expect(plainText(back).split('\n').at(-1)).toBe('after')
  })

  it('keeps a list item that holds more than one paragraph', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'second para' }] },
              ],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'next item' }] }],
            },
          ],
        },
      ],
    }
    const back = markdownToBody(toMarkdown(body), 'note')
    expect(back.content).toHaveLength(1)
    expect(back.content?.[0].type).toBe('bulletList')
    expect(back.content?.[0].content).toHaveLength(2)
    expect(back.content?.[0].content?.[0].content).toHaveLength(2)
  })

  // Shift+Enter is bound inside headings too, and a newline would end an ATX
  // heading — leaving half the title behind as a stray paragraph.
  it('keeps a page heading that contains a hard break', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [
            { type: 'text', text: 'The long' },
            { type: 'hardBreak' },
            { type: 'text', text: 'title' },
          ],
        },
      ],
    }
    const back = markdownToBody(toMarkdown(body), 'page')
    expect(back.content).toHaveLength(1)
    expect(back.content?.[0].type).toBe('heading')
    expect(plainText(back)).toContain('title')
  })

  it('keeps a footnote and its text', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'claim' },
            { type: 'footnote', attrs: { text: 'the source is "X" & Y' } },
          ],
        },
      ],
    }
    const back = markdownToBody(toMarkdown(body), 'note')
    const note = back.content?.[0].content?.[1]
    expect(note?.type).toBe('footnote')
    expect(note?.attrs?.text).toBe('the source is "X" & Y')
  })

  // Two line ends in a row ended the paragraph it was in: the footnote came back as none.
  it('keeps a footnote with an empty line in its text', () => {
    const text = 'first line\n\nsecond\r\nthird'
    const body: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'claim' }, { type: 'footnote', attrs: { text } }] }] }
    const back = markdownToBody(toMarkdown(body), 'note')
    expect(back.content).toHaveLength(1)
    expect(back.content?.[0].content?.[1]).toMatchObject({ type: 'footnote', attrs: { text } })
  })

  // Only a body not made in the editor has code that's bold or a link as well: the other mark went inside the backticks.
  it('writes code that is bold or a link too with the code innermost', () => {
    const marked = (...marks: object[]) => toMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x*y', marks }] }] } as JSONContent)
    expect(marked({ type: 'bold' }, { type: 'code' })).toBe('**`x*y`**')
    expect(marked({ type: 'link', attrs: { href: 'https://example.com' } }, { type: 'code' })).toBe('[`x*y`](https://example.com)')
  })

  // Deliberate: a footnote is an aside, so its text stays out of the title, the
  // list preview and the word count, all of which read from plainText.
  it('keeps footnote text out of the visible prose', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'claim' },
            { type: 'footnote', attrs: { text: 'Pevensie 1950' } },
          ],
        },
      ],
    }
    expect(plainText(body)).toBe('claim')
  })

  it('keeps a link whose href holds parens and spaces', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'https://good.test/a)b c' } }],
            },
          ],
        },
      ],
    }
    const back = markdownToBody(toMarkdown(body), 'note')
    const mark = back.content?.[0].content?.[0].marks?.[0]
    expect(plainText(back)).toBe('link')
    expect(decodeURI(String(mark?.attrs?.href))).toBe('https://good.test/a)b c')
  })

  it('does not let an href smuggle a second link in', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'link',
              marks: [
                { type: 'link', attrs: { href: 'https://good.test/x) [pwn](https://evil.test' } },
              ],
            },
          ],
        },
      ],
    }
    const back = markdownToBody(toMarkdown(body), 'note')
    expect(plainText(back)).toBe('link')
    // The whole thing stays inside one percent-encoded href: no second link is
    // minted, and nothing points at the smuggled host.
    const marks = (back.content?.[0].content ?? []).flatMap((child) => child.marks ?? [])
    expect(marks).toHaveLength(1)
    expect(String(marks[0]?.attrs?.href)).not.toContain('evil.test"')
    expect(back.content?.[0].content).toHaveLength(1)
  })
})

// The whole reason images are data URIs and not rows in a side table: the .md
// file is the only backup, and a reference to something not in it restores as
// a picture that is simply gone.
describe('images survive the only backup there is', () => {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  const withImage = (alt: string): JSONContent => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'before ' },
          { type: 'image', attrs: { src: PNG, alt } },
          { type: 'text', text: ' after' },
        ],
      },
    ],
  })

  it('carries the bytes through export and back', () => {
    const body = withImage('a cat')
    const back = markdownToBody(toMarkdown(body), 'note')
    const inline = back.content?.[0].content ?? []
    const image = inline.find((node) => node.type === 'image')

    expect(image?.attrs?.src).toBe(PNG)
    expect(image?.attrs?.alt).toBe('a cat')
    expect(plainText(back)).toBe('before  after')
  })

  it('converges rather than drifting on a second pass', () => {
    const once = toMarkdown(withImage('a cat'))
    expect(toMarkdown(markdownToBody(once, 'note'))).toBe(once)
  })

  it('does not let base64 forge the entry separator', () => {
    const file = buildExport(
      [item(withImage('one')), item(withImage('two'))],
      [],
      Date.parse('2026-08-07T12:00:00Z'),
    )
    expect(parseImport(file, 'note')).toHaveLength(2)
  })

  // A file path or a remote URL cannot be stored, but dropping it would delete
  // the writer's own reference to a picture they still have on disk.
  it.each(['![a cat](photo.jpg)', '![](https://example.test/y.png)'])(
    'keeps %s as visible text rather than deleting it',
    (markdown) => {
      const back = markdownToBody(markdown, 'note')
      expect(JSON.stringify(back)).not.toContain('"image"')
      expect(plainText(back)).toBe(markdown)
    },
  )

  it('keeps an alt full of Markdown metacharacters', () => {
    const back = markdownToBody(toMarkdown(withImage('a]b*c -x')), 'note')
    const image = (back.content?.[0].content ?? []).find((node) => node.type === 'image')
    expect(image?.attrs?.alt).toBe('a]b*c -x')
  })
})

describe('export round trip', () => {
  it('keeps a note containing a rule as one note', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '---' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ],
    }
    const file = buildExport([item(body)], [], Date.parse('2026-08-07T12:00:00Z'))
    const back = parseImport(file, 'note')
    expect(back).toHaveLength(1)
    expect(plainText(markdownToBody(back[0].markdown, 'note'))).toBe('before\n---\nafter')
  })

  it('keeps a page containing an H2 named Notes as one page', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Trip' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '## Notes' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'pack socks' }] },
      ],
    }
    const file = buildExport([], [{ ...item(body), kind: 'page' }], Date.parse('2026-08-07T12:00:00Z'))
    const back = parseImport(file, 'note')
    expect(back).toHaveLength(1)
    expect(back[0].kind).toBe('page')
    expect(plainText(markdownToBody(back[0].markdown, 'page'))).toContain('pack socks')
  })
})

describe('underline and highlight', () => {
  const marked = (type: string, value: string): JSONContent => ({ type: 'text', text: value, marks: [{ type }] })
  const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content }] })
  const marksOf = (body: JSONContent) =>
    (body.content?.[0].content ?? []).map((node) => [node.text, (node.marks ?? []).map((mark) => mark.type)])

  it('travels as <u> and <mark>, which Markdown lacks, and comes back as the same marks', () => {
    const body = doc(marked('underline', 'under'), { type: 'text', text: ' and ' }, marked('highlight', 'lit'))
    const markdown = toMarkdown(body)
    expect(markdown).toBe('<u>under</u> and <mark>lit</mark>')
    expect(marksOf(markdownToBody(markdown, 'note'))).toEqual([
      ['under', ['underline']],
      [' and ', []],
      ['lit', ['highlight']],
    ])
  })

  it('keeps them alongside bold', () => {
    const body = doc({ type: 'text', text: 'both', marks: [{ type: 'bold' }, { type: 'underline' }] })
    expect(marksOf(markdownToBody(toMarkdown(body), 'note'))).toEqual([['both', ['bold', 'underline']]])
  })

  it('leaves text that only looks like the tags as text', () => {
    expect(rideAlong('<u>not a tag</u> or <mark>this</mark>')).toBe('<u>not a tag</u> or <mark>this</mark>')
  })

  it('reads the underline Google Docs pastes, a styled span', () => {
    const body = markdownToBody('<span style="text-decoration: underline">pasted</span>', 'note')
    expect(marksOf(body)).toEqual([['pasted', ['underline']]])
  })

  it('takes nothing from a pasted <mark> but the highlight itself', () => {
    const body = markdownToBody('<mark style="background:red" class="fixed inset-0">x</mark>', 'note')
    expect(body.content?.[0].content?.[0].marks).toEqual([{ type: 'highlight' }])
  })
})
