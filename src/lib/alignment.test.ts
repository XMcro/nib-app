import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { asAlignment, withoutDefaultAlignment } from './alignment'

describe('asAlignment', () => {
  it('takes the four, and nothing else', () => {
    for (const value of ['left', 'center', 'right', 'justify']) expect(asAlignment(value)).toBe(value)
    for (const value of [null, undefined, '', 'start', 'CENTER', 'center; color: red', 1, {}]) expect(asAlignment(value)).toBeNull()
  })
})

describe('a body as it is stored', () => {
  it('says nothing about a line with no alignment, so it is the body it always was', () => {
    const body = () => ({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'b' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      ],
    })
    const fromEditor = body()
    fromEditor.content[0] = { ...fromEditor.content[0], attrs: { textAlign: null } } as never
    fromEditor.content[1].attrs = { level: 2, textAlign: null } as never
    ;(fromEditor.content[2] as JSONContent).content![0].content![0].attrs = { textAlign: null }
    expect(withoutDefaultAlignment(fromEditor)).toEqual(body())
  })

  it('keeps the line that has one, and every other attribute', () => {
    const aligned = { type: 'paragraph', attrs: { textAlign: 'center' } }
    const heading = { type: 'heading', attrs: { level: 1, textAlign: 'right' } }
    const image = { type: 'image', attrs: { src: 'x', alt: null } }
    expect(withoutDefaultAlignment({ type: 'doc', content: [aligned, heading, image] })).toEqual({ type: 'doc', content: [aligned, heading, image] })
  })

  it('says nothing of a line no link goes to, nor of a link that is to all of its note; and keeps what one has', () => {
    const fromEditor: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { textAlign: null, blockId: null }, content: [{ type: 'noteLink', attrs: { id: 'a', title: 'A', block: null, part: null } }] },
        { type: 'heading', attrs: { level: 2, textAlign: 'center', blockId: 'abcd1234' }, content: [{ type: 'noteLink', attrs: { id: 'a', title: 'A', block: 'wxyz5678', part: 'Its words' } }] },
      ],
    }
    expect(withoutDefaultAlignment(fromEditor)).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'noteLink', attrs: { id: 'a', title: 'A' } }] },
        { type: 'heading', attrs: { level: 2, textAlign: 'center', blockId: 'abcd1234' }, content: [{ type: 'noteLink', attrs: { id: 'a', title: 'A', block: 'wxyz5678', part: 'Its words' } }] },
      ],
    })
  })

  it('says nothing of a picture’s size when it has none, and keeps the one it has', () => {
    const picture = (attrs: Record<string, unknown>) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: '', drawing: null, ...attrs } }] }] })
    const stored = (body: JSONContent) => withoutDefaultAlignment(body).content![0].content![0].attrs
    expect(stored(picture({ size: null }))).toEqual({ src: 'data:image/png;base64,AAAA', alt: '', drawing: null })
    expect(stored(picture({ size: 'medium' }))).toEqual({ src: 'data:image/png;base64,AAAA', alt: '', drawing: null, size: 'medium' })
  })
})
