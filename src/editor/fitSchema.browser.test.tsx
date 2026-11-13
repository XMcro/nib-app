import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Editor as TiptapEditor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { Editor } from './Editor'
import { nibExtensions } from './extensions'

/**
 * A note from a newer Nib, carrying a mark this version has never heard of —
 * what a 1.1 device's underline looks like to 1.0.
 */
const FROM_A_NEWER_NIB: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Three pages of a draft, ' },
        { type: 'text', text: 'one word underlined', marks: [{ type: 'sparkle' }] },
      ],
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'and the rest plain.' }] },
  ],
}

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('a document with formatting this version does not know', () => {
  it('blanks the whole page in a bare TipTap editor — the failure being guarded against', () => {
    const element = document.createElement('div')
    document.body.append(element)
    const bare = new TiptapEditor({ element, extensions: nibExtensions(true), content: FROM_A_NEWER_NIB })
    expect(bare.getText()).toBe('')
    bare.destroy()
  })

  it('opens in Nib with every word, the unknown formatting dropped', () => {
    const { container } = render(
      <Editor kind="page" initialBody={FROM_A_NEWER_NIB} focus={false} onChange={() => {}} />,
    )
    const text = container.querySelector('.ProseMirror')?.textContent
    expect(text).toContain('Three pages of a draft, one word underlined')
    expect(text).toContain('and the rest plain.')
  })
})
