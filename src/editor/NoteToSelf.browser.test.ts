import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { nibExtensions } from './extensions'
import { withoutDefaultAlignment } from '../lib/alignment'

/** A note to self in the editor: what it keeps, and what it never hands on. */

const NOTE = { type: 'noteToSelf', attrs: { id: 'n1', text: 'Check the tide times.' } }
// The passage, "at seven", runs from 18 to 26.
const DOC: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The ferry leaves ' },
        { type: 'text', text: 'at seven', marks: [NOTE] },
        { type: 'text', text: ' sharp.' },
      ],
    },
  ],
}

let editor: Editor | undefined

function open(content: JSONContent = DOC) {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({ element, extensions: nibExtensions(false), content })
  return editor
}

/** The words under a note, each note's run on its own. */
const noted = (doc: JSONContent) =>
  (doc.content ?? []).flatMap((block) => (block.content ?? []).filter((child) => child.marks?.some((mark) => mark.type === 'noteToSelf')).map((child) => child.text))

afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

describe('a note to self', () => {
  it('is kept with its passage, and its words are nowhere on the page', () => {
    const editor = open()
    expect(withoutDefaultAlignment(editor.getJSON())).toEqual(DOC)
    expect(editor.view.dom.querySelector('.nib-note-to-self')?.textContent).toBe('at seven')
    expect(editor.view.dom.outerHTML).not.toContain('tide')
  })

  it('takes in what is typed inside its passage, not just before or after it', async () => {
    const editor = open()
    editor.view.dom.focus()
    // Inside first, then its end (one further on for that), then its start.
    for (const [at, typed] of [[21, 'X'], [27, '!'], [18, '~']] as const) {
      editor.commands.setTextSelection(at)
      await userEvent.keyboard(typed)
    }
    expect(editor.getText()).toBe('The ferry leaves ~at Xseven! sharp.')
    expect(noted(editor.getJSON())).toEqual(['at Xseven'])
  })

  it('is left behind by a copy: none of it in the HTML or the text', () => {
    const editor = open()
    editor.commands.selectAll()
    const event = new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true })
    editor.view.dom.dispatchEvent(event)
    const html = event.clipboardData!.getData('text/html')
    expect(html).toContain('at seven')
    expect(html).not.toMatch(/tide|n1|nib-note-to-self|<span/)
    expect(event.clipboardData!.getData('text/plain')).toBe('The ferry leaves at seven sharp.')
  })

  // A drag within the text moves the slice this gives, not the markup it writes.
  it('goes along with its passage dragged elsewhere in the text', () => {
    const editor = open()
    editor.commands.setTextSelection({ from: 18, to: 26 })
    const { slice } = editor.view.serializeForClipboard(editor.state.selection.content())
    expect(slice.content.firstChild?.firstChild?.marks.map((mark) => mark.attrs.text)).toEqual(['Check the tide times.'])
  })

  it('can’t be made by anything pasted, even its own markup', () => {
    const editor = open({ type: 'doc', content: [{ type: 'paragraph' }] })
    const data = new DataTransfer()
    data.setData('text/html', '<p>A <span class="nib-note-to-self" data-text="planted">passage</span> pasted.</p>')
    data.setData('text/plain', 'A passage pasted.')
    editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    expect(editor.getText()).toBe('A passage pasted.')
    expect(noted(editor.getJSON())).toEqual([])
  })
})
