// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { nibExtensions } from './extensions'
import { fitSchema } from './fitSchema'
import { withoutDefaultAlignment } from '../lib/alignment'
import { plainText } from '../lib/text'

const page = getSchema(nibExtensions(true))
const note = getSchema(nibExtensions(false))

const text = (value: string, marks?: string[]): JSONContent => ({
  type: 'text',
  text: value,
  ...(marks ? { marks: marks.map((type) => ({ type })) } : {}),
})
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

/** What the editor will actually load, so a test fails exactly where the editor would. */
const loads = (body: JSONContent, schema = page) => withoutDefaultAlignment(schema.nodeFromJSON(body).toJSON() as JSONContent)

describe('fitSchema', () => {
  it('passes a document this version can read through untouched', () => {
    const body = doc(paragraph(text('plain '), text('bold', ['bold'])))
    expect(fitSchema(body, page)).toBe(body)
  })

  it('drops a mark it does not know and keeps the words and the other marks', () => {
    const body = doc(paragraph(text('one '), text('word', ['bold', 'sparkle']), text(' here')))
    expect(() => page.nodeFromJSON(body)).toThrow(/no mark type sparkle/)
    const fitted = loads(fitSchema(body, page))
    expect(plainText(fitted)).toBe('one word here')
    expect(fitted.content?.[0].content?.[1].marks).toEqual([{ type: 'bold' }])
  })

  it('turns an unknown block into a paragraph holding its words', () => {
    const body = doc({ type: 'sparkle', content: [text('Remember the ferry')] }, paragraph(text('after')))
    expect(loads(fitSchema(body, page))).toEqual(doc(paragraph(text('Remember the ferry')), paragraph(text('after'))))
  })

  it('keeps the text of an unknown inline node where it was', () => {
    const body = doc(paragraph(text('ask '), { type: 'mention', content: [text('Sam')] }, text(' today')))
    expect(plainText(loads(fitSchema(body, page)))).toBe('ask Sam today')
  })

  it('unwraps an unknown container and keeps what is inside', () => {
    const body = doc({ type: 'columns', content: [paragraph(text('left')), text('loose'), paragraph(text('right'))] })
    expect(loads(fitSchema(body, page))).toEqual(
      doc(paragraph(text('left')), paragraph(text('loose')), paragraph(text('right'))),
    )
  })

  it('reads a heading in a note as a paragraph, since notes have no headings', () => {
    const body = doc({ type: 'heading', attrs: { level: 1 }, content: [text('Shopping')] }, paragraph(text('milk')))
    expect(loads(fitSchema(body, note), note)).toEqual(doc(paragraph(text('Shopping')), paragraph(text('milk'))))
  })

  it('reaches into lists and quotes', () => {
    const body = doc({
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph(text('first', ['sparkle']))] }],
    })
    expect(loads(fitSchema(body, page))).toEqual(
      doc({ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('first'))] }] }),
    )
  })

  it('does not let one malformed node take the rest of the document with it', () => {
    const body = doc(paragraph(text('still here')), { type: 'paragraph', content: 'not a list' } as unknown as JSONContent)
    // The broken paragraph stays as an empty line; the one before it is untouched.
    expect(loads(fitSchema(body, page))).toEqual(doc(paragraph(text('still here')), { type: 'paragraph' }))
  })

  it('never throws, whatever is stored', () => {
    for (const body of [{ type: 'doc', content: 'x' }, { type: 'mystery' }, {}] as JSONContent[]) {
      expect(() => loads(fitSchema(body, page))).not.toThrow()
    }
  })
})
