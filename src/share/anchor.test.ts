import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { nibExtensions } from '../editor/extensions'
import { findQuote } from './anchor'

const schema = getSchema(nibExtensions(true))
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = schema.nodeFromJSON({
  type: 'doc',
  content: [
    para('The lamp turned all night.'),
    { type: 'paragraph', content: [{ type: 'text', text: 'Over the ' }, { type: 'text', text: 'harbour', marks: [{ type: 'bold' }] }, { type: 'text', text: ', quietly.' }] },
  ],
})

describe('findQuote', () => {
  it('finds a passage across marks, and returns exactly its range', () => {
    const range = findQuote(doc, 'the harbour')!
    expect(doc.textBetween(range.from, range.to)).toBe('the harbour')
  })

  it('reads a reader’s line break between paragraphs as the break it is', () => {
    const range = findQuote(doc, 'all night.\nOver the')!
    expect(doc.textBetween(range.from, range.to, ' ')).toBe('all night. Over the')
  })

  it('is null once the passage has been rewritten', () => {
    expect(findQuote(doc, 'the lighthouse turned')).toBeNull()
    expect(findQuote(doc, '   ')).toBeNull()
  })
})
