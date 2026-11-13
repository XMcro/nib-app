import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import '../index.css'
import { withoutDefaultAlignment } from '../lib/alignment'
import { fitted, nibEditor, textClass } from './extensions'

/** Each line takes its direction from its own words, in what's drawn and not in what's stored. */

const line = (type: string, text: string, attrs?: object): JSONContent => ({ type, ...(attrs && { attrs }), content: [{ type: 'text', text }] })
const BODY: JSONContent = {
  type: 'doc',
  content: [
    line('heading', 'مرحبا بالعالم', { level: 1 }),
    line('paragraph', 'هذا نص عربي من اليمين إلى اليسار.'),
    line('paragraph', 'Mixed with a line of English.'),
    { type: 'bulletList', content: [{ type: 'listItem', content: [line('paragraph', 'בעברית')] }] },
  ],
}

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

function open() {
  const element = document.body.appendChild(document.createElement('div'))
  editor = new Editor({ element, ...nibEditor(true), content: fitted(BODY, true), editorProps: { attributes: { class: textClass(true) } } })
  return [...editor.view.dom.querySelectorAll<HTMLElement>('h1, p, li, ul')]
}

const direction = (element: HTMLElement) => getComputedStyle(element).direction

describe('a line’s direction', () => {
  it('comes from its own words', () => {
    const [heading, arabic, english, list, item] = open()
    expect([heading, arabic].map(direction)).toEqual(['rtl', 'rtl'])
    expect(direction(english)).toBe('ltr')
    expect([list, item].map(direction)).toEqual(['rtl', 'rtl'])
    // And is laid out that way: from the right edge, and from the left.
    const words = (element: HTMLElement) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return range.getBoundingClientRect()
    }
    expect(Math.abs(words(arabic).right - arabic.getBoundingClientRect().right)).toBeLessThan(2)
    expect(Math.abs(words(english).left - english.getBoundingClientRect().left)).toBeLessThan(2)
  })

  it('isn’t stored: the body comes out as it went in, for the apps already out there', () => {
    open()
    expect(withoutDefaultAlignment(editor!.getJSON())).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: BODY.content![0].content },
        { type: 'paragraph', content: BODY.content![1].content },
        { type: 'paragraph', content: BODY.content![2].content },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: BODY.content![3].content![0].content![0].content }] }] },
      ],
    })
    expect(JSON.stringify(editor!.getJSON())).not.toContain('"dir"')
  })
})
