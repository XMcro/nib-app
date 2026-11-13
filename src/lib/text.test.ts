import { describe, expect, it, vi } from 'vitest'
import { plainText, searchable, searchText, setInVault, titleOf } from './text'

const doc = (...content: unknown[]) => ({ type: 'doc', content }) as never
const para = (...children: unknown[]) => ({ type: 'paragraph', content: children })
const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, marks })

describe('worked out once a body', () => {
  it('its title', () => {
    const body = doc(para(text('A title')), para(text('more')))
    expect(titleOf(body)).toBe('A title')
    const split = vi.spyOn(String.prototype, 'split')
    expect(titleOf(body)).toBe('A title')
    expect(split).not.toHaveBeenCalled()
    split.mockRestore()
  })

  it('what a search looks in, lower case', () => {
    const body = doc(para(text('MiXeD Case')))
    expect(searchable(body)).toBe('mixed case')
    const lower = vi.spyOn(String.prototype, 'toLowerCase')
    expect(searchable(body)).toBe('mixed case')
    expect(lower).not.toHaveBeenCalled()
    lower.mockRestore()
  })

  it('and again once a link to a locked note reads differently', () => {
    const body = doc(para({ type: 'noteLink', attrs: { id: 'x', title: 'The secret' } }))
    expect(titleOf(body)).toBe('The secret')
    setInVault(new Set(['x']))
    expect(titleOf(body)).toBe('A locked note')
    setInVault(new Set())
    expect(titleOf(body)).toBe('The secret')
  })
})

describe('plainText', () => {
  it('puts one line per top-level block', () => {
    expect(plainText(doc(para(text('first')), para(text('second'))))).toBe('first\nsecond')
  })

  it('joins marked runs without breaking the line', () => {
    const mixed = doc(para(text('Hello '), text('world', [{ type: 'bold' }]), text('!')))
    expect(plainText(mixed)).toBe('Hello world!')
  })

  it('returns an empty string for an empty document', () => {
    expect(plainText(doc())).toBe('')
    expect(plainText({ type: 'doc' } as never)).toBe('')
  })

  // Joining nested blocks with nothing ran the words together, so the word
  // count and preview shown here disagreed with the editor's own for the same
  // document — three checklist items counted as one run-on line.
  it('starts a new line for each block nested inside another', () => {
    const list = doc({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [para(text('Buy milk'))] },
        { type: 'listItem', content: [para(text('Call mum'))] },
      ],
    })
    expect(plainText(list)).toBe('Buy milk\nCall mum')
  })

  it('keeps a multi-paragraph quote on separate lines', () => {
    const quoted = doc({
      type: 'blockquote',
      content: [para(text('one')), para(text('two'))],
    })
    expect(plainText(quoted)).toBe('one\ntwo')
  })

  it('treats a hard break as a line break', () => {
    expect(plainText(doc(para(text('a'), { type: 'hardBreak' }, text('b'))))).toBe('a\nb')
  })
})

describe('plainText, images', () => {
  const image = { type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'a cat' } }

  // An image is inline, so the words either side of it stay on one line.
  it('does not break the line around an image', () => {
    expect(plainText(doc(para(text('a'), image, text('b'))))).toBe('ab')
  })

  // Deliberate: alt text is not prose. A picture-only note is Untitled and
  // counts nothing, which matches what the editor's own readout shows.
  it('counts a picture as no words and no title', () => {
    expect(plainText(doc(para(image)))).toBe('')
    expect(titleOf(doc(para(image)))).toBe('Untitled')
  })
})

describe('searchText', () => {
  const footnote = (text: string) => ({ type: 'footnote', attrs: { text } })

  it('matches a footnote that the prose does not show', () => {
    const body = doc(para(text('A claim'), footnote('Pevensie 1950')))
    expect(searchText(body)).toContain('Pevensie 1950')
    // ...without fusing it onto the word before it, which is what titles read.
    expect(searchText(body)).not.toContain('claimPevensie')
    expect(plainText(body)).toBe('A claim')
  })

  it('finds footnotes nested anywhere in the document', () => {
    const body = doc({
      type: 'bulletList',
      content: [{ type: 'listItem', content: [para(text('item'), footnote('buried'))] }],
    })
    expect(searchText(body)).toContain('buried')
  })

  it('collects every footnote, not just the first', () => {
    const body = doc(para(text('a'), footnote('one')), para(text('b'), footnote('two')))
    expect(searchText(body)).toContain('one')
    expect(searchText(body)).toContain('two')
  })

  it('leaves out notes to self: they are about the writing, not in it', () => {
    const note = { type: 'noteToSelf', attrs: { id: 'n1', text: 'Check the tide times.' } }
    expect(searchText(doc(para({ type: 'text', text: 'at seven', marks: [note] })))).toBe('at seven')
  })

  it('is just the prose when there are no footnotes', () => {
    const body = doc(para(text('nothing special')))
    expect(searchText(body)).toBe('nothing special')
  })

  it('ignores a footnote with no text yet', () => {
    expect(searchText(doc(para(text('a'), footnote('   '))))).toBe('a')
  })
})

describe('titleOf', () => {
  it('uses the first non-empty line', () => {
    expect(titleOf(doc(para(text('Ask Mara')), para(text('later'))))).toBe('Ask Mara')
  })

  it('skips leading blank paragraphs', () => {
    expect(titleOf(doc(para(), para(text('   ')), para(text('Real title'))))).toBe('Real title')
  })

  it('trims surrounding whitespace', () => {
    expect(titleOf(doc(para(text('  padded  '))))).toBe('padded')
  })

  it('falls back to Untitled when there is no text at all', () => {
    expect(titleOf(doc(para()))).toBe('Untitled')
    expect(titleOf(doc())).toBe('Untitled')
  })

  // Stored before bodies were checked on the way in, text that wasn't a
  // string threw here, and the list, and so the whole app, drew nothing.
  it('reads past text that isn’t a string', () => {
    const odd = { type: 'paragraph', content: [{ type: 'text', text: { toString: 0, valueOf: 0 } }] }
    expect(titleOf(doc(odd, para(text('Still here'))))).toBe('Still here')
  })
})
