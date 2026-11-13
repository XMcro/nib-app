import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import '../index.css'
import { applyTheme, NAMED, type Theme } from '../lib/theme'
import { nibExtensions } from './extensions'
import { NoteCard } from './NoteCard'

/** A note to self, read: opened from its underline, edited, and done with. */

const note = (id: string, text: string) => ({ type: 'noteToSelf', attrs: { id, text } })
const run = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) })
// "at seven" runs from 18 to 26.
const FERRY: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [run('The ferry leaves '), run('at seven', [note('n1', 'Check the tide times.')]), run(' sharp.')] }],
}
// One note on a selection across two paragraphs: a piece in each.
const ACROSS: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [run('First '), run('half', [note('n2', 'Too slow?')])] },
    { type: 'paragraph', content: [run('second', [note('n2', 'Too slow?')]), run(' half.')] },
  ],
}

let editor: Editor | undefined

let done = 0

function open(content: JSONContent = FERRY) {
  const element = document.createElement('div')
  element.className = 'bg-paper text-ink'
  // Room above the text for the card.
  element.style.paddingTop = '120px'
  document.body.append(element)
  editor = new Editor({ element, extensions: nibExtensions(true), content, editorProps: { attributes: { class: 'nib-editor' } } })
  render(<NoteCard editor={editor} onDone={() => done++} />)
  editor.view.dom.focus()
  return editor
}

const card = () => screen.queryByRole('dialog', { name: 'Note to self' })
const notes = () => {
  const found: { text: string; note?: string }[] = []
  editor!.state.doc.descendants((node) => {
    if (node.isText) found.push({ text: node.text!, note: node.marks.find((mark) => mark.type.name === 'noteToSelf')?.attrs.text })
  })
  return found.filter((one) => one.note !== undefined)
}
const caretAt = (pos: number) => act(() => void editor!.commands.setTextSelection(pos))

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
  applyTheme('light')
})

describe('a note to self, read', () => {
  it('opens on a tap on its underlined words, their first letter too', async () => {
    open()
    const passage = document.querySelector('.nib-note-to-self')!
    // The left of its "a": the caret goes against the passage, not into it.
    await userEvent.click(passage, { position: { x: 1, y: passage.getBoundingClientRect().height / 2 } })
    expect(editor!.state.selection.from).toBe(18)
    await waitFor(() => expect(card()?.textContent).toContain('Check the tide times.'))
    // Placed over the words, the first time too.
    await waitFor(() => expect(card()!.getBoundingClientRect().bottom).toBeLessThanOrEqual(passage.getBoundingClientRect().top))
  })

  it('opens with the caret brought inside, not against an end, and closes on typing', async () => {
    open()
    await caretAt(18)
    await caretAt(26)
    expect(card()).toBeNull()

    await caretAt(21)
    await waitFor(() => expect(card()).not.toBeNull())
    await userEvent.keyboard('X')
    await waitFor(() => expect(card()).toBeNull())
    expect(editor!.getText()).toBe('The ferry leaves at Xseven sharp.')
  })

  it('closes on Escape, and as the caret leaves', async () => {
    open()
    await caretAt(21)
    await waitFor(() => expect(card()).not.toBeNull())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(card()).toBeNull())

    await caretAt(22)
    await waitFor(() => expect(card()).not.toBeNull())
    // Against its end it stays: the caret has only to go one further.
    await caretAt(26)
    expect(card()).not.toBeNull()
    await caretAt(5)
    await waitFor(() => expect(card()).toBeNull())
  })

  it('takes new words with Edit, in every piece of the note', async () => {
    open(ACROSS)
    await caretAt(9)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const field = screen.getByRole('textbox', { name: 'The note' })
    expect((field as HTMLTextAreaElement).value).toBe('Too slow?')
    // The caret at the end, to write on.
    expect((field as HTMLTextAreaElement).selectionStart).toBe('Too slow?'.length)
    await userEvent.fill(field, 'Cut this.')
    await userEvent.keyboard('{Enter}')

    expect(notes()).toEqual([
      { text: 'half', note: 'Cut this.' },
      { text: 'second', note: 'Cut this.' },
    ])
    await waitFor(() => expect(card()?.textContent).toContain('Cut this.'))
  })

  it('comes off every piece with Done, leaving the words, and undo has it back', async () => {
    open(ACROSS)
    await caretAt(9)
    const before = done
    await userEvent.click(await screen.findByRole('button', { name: 'Done, take the note off' }))

    // Said, with Undo beside it (Editor's notice): nothing said it could come back.
    expect(done).toBe(before + 1)
    expect(notes()).toEqual([])
    expect(editor!.getText()).toBe('First half\n\nsecond half.')
    await waitFor(() => expect(card()).toBeNull())
    act(() => void editor!.commands.undo())
    expect(notes()).toHaveLength(2)
  })
})

/** The underline on every theme: the accent's, and enough against the page to be seen as something to tap. */
const rgb = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number)
const luminance = (color: string) => {
  const [r, g, b] = rgb(color).map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

describe('the underline of a note to self', () => {
  const THEMES: Theme[] = ['light', 'dark', ...NAMED.map((one) => one.id)]
  for (const theme of THEMES) {
    it(`stands out from the page on ${theme}`, () => {
      applyTheme(theme)
      open()
      const style = getComputedStyle(document.querySelector('.nib-note-to-self')!)
      const page = getComputedStyle(editor!.view.dom.parentElement!).backgroundColor
      expect(style.textDecorationLine).toBe('underline')
      // Non-text contrast, as for a control (WCAG 1.4.11).
      expect(contrast(style.textDecorationColor, page)).toBeGreaterThanOrEqual(3)
    })
  }
})
