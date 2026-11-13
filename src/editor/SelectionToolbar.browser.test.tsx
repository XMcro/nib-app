import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/react'
import { Editor as NibEditor } from './Editor'
import '../index.css'
import { nibExtensions } from './extensions'
import { SelectionToolbar } from './SelectionToolbar'
import { resetLook, setLook, setLookPlus } from '../lib/look'

/**
 * The selection toolbar is a TipTap BubbleMenu: it is positioned by floating-ui
 * and driven by requestAnimationFrame, so it never appeared under jsdom and the
 * backgrounded Chrome connector suspended rAF entirely. A real foreground
 * browser is the only place it can be exercised at all.
 */

let editor: Editor | undefined

/** Mounts the toolbar over a document holding `text`, with that text selected. */
async function selectAll(text: string, { showHeading = true } = {}) {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({
    element,
    extensions: nibExtensions(showHeading),
    content: `<p>${text}</p>`,
  })
  render(<SelectionToolbar editor={editor} showHeading={showHeading} />)

  editor.commands.focus()
  editor.view.dom.focus()
  // The whole paragraph, which is what opens the toolbar.
  editor.commands.setTextSelection({ from: 1, to: text.length + 1 })
  await waitFor(() => expect(screen.getByLabelText('Bold')).toBeTruthy())
}

const body = (): JSONContent => editor!.getJSON() as JSONContent
const firstText = () => body().content?.[0].content?.[0]
const markTypes = () => (firstText()?.marks ?? []).map((mark) => mark.type)

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

describe('SelectionToolbar', () => {
  it('appears once there is a selection', async () => {
    await selectAll('the quick brown fox')
    expect(screen.getByLabelText('Italic')).toBeTruthy()
    expect(screen.getByLabelText('Add a link')).toBeTruthy()
  })

  it.each([
    ['Bold', 'bold'],
    ['Italic', 'italic'],
    ['Strikethrough', 'strike'],
    ['Code', 'code'],
  ])('%s applies its mark to the selection', async (label, mark) => {
    await selectAll('formatted')
    await userEvent.click(screen.getByLabelText(label))
    await waitFor(() => expect(markTypes()).toContain(mark))
  })

  it('reports what is already active through aria-pressed', async () => {
    await selectAll('formatted')
    expect(screen.getByLabelText('Bold').getAttribute('aria-pressed')).toBe('false')

    await userEvent.click(screen.getByLabelText('Bold'))
    await waitFor(() =>
      expect(screen.getByLabelText('Bold').getAttribute('aria-pressed')).toBe('true'),
    )
  })

  it('offers H2 on a page but not in a note', async () => {
    await selectAll('a heading', { showHeading: true })
    expect(screen.queryByLabelText('Heading')).toBeTruthy()

    cleanup()
    editor?.destroy()
    document.body.replaceChildren()

    await selectAll('not a heading', { showHeading: false })
    expect(screen.queryByLabelText('Heading')).toBeNull()
  })

  it('turns the selection into a quote', async () => {
    await selectAll('quoted')
    await userEvent.click(screen.getByLabelText('Quote'))
    await waitFor(() => expect(body().content?.[0].type).toBe('blockquote'))
  })

  it('adds a link from the prompt, then offers to remove it', async () => {
    await selectAll('linked')
    await userEvent.click(screen.getByLabelText('Add a link'))

    const field = await screen.findByPlaceholderText('Paste a link, then press Return')
    await userEvent.fill(field, 'https://example.com')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(markTypes()).toContain('link'))
    expect(firstText()?.marks?.[0].attrs?.href).toBe('https://example.com')
    // The button becomes the inverse action once a link is active.
    await waitFor(() => expect(screen.getByLabelText('Remove link')).toBeTruthy())
  })

  it.each([
    ['Checklist', 'taskList'],
    ['Bulleted list', 'bulletList'],
    ['Numbered list', 'orderedList'],
  ])('opens the More panel and turns the selection into a %s', async (label, type) => {
    await selectAll('an item')
    await userEvent.click(screen.getByLabelText('More'))

    await userEvent.click(await screen.findByText(label))
    await waitFor(() => expect(body().content?.[0].type).toBe(type))
  })

  it.each([
    ['Underline', 'underline'],
    ['Highlight', 'highlight'],
  ])('applies %s from the More panel', async (label, mark) => {
    await selectAll('formatted')
    await userEvent.click(screen.getByLabelText('More'))
    await userEvent.click(await screen.findByText(label))
    await waitFor(() => expect(markTypes()).toContain(mark))
  })

  it('adds a footnote carrying its text', async () => {
    await selectAll('a claim')
    await userEvent.click(screen.getByLabelText('More'))
    await userEvent.click(await screen.findByText('Add a footnote'))

    const field = await screen.findByPlaceholderText('Write the footnote, then press Return')
    await userEvent.fill(field, 'Pevensie 1950')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      const inline = body().content?.[0].content ?? []
      expect(inline.some((node) => node.type === 'footnote')).toBe(true)
    })
    const note = (body().content?.[0].content ?? []).find((node) => node.type === 'footnote')
    expect(note?.attrs?.text).toBe('Pevensie 1950')
  })

  it('adds a note to self on the selected words', async () => {
    await selectAll('at seven')
    await userEvent.click(screen.getByLabelText('More'))
    await userEvent.click(await screen.findByText('Add a note to self'))

    const field = await screen.findByPlaceholderText('Write the note, then press Return')
    await userEvent.fill(field, 'Check the tide times.')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(markTypes()).toEqual(['noteToSelf']))
    expect(firstText()?.text).toBe('at seven')
    expect(firstText()?.marks?.[0].attrs).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), text: 'Check the tide times.' })
  })

  it('clears formatting but not a note to self, which isn’t formatting', async () => {
    await selectAll('formatted')
    await userEvent.click(screen.getByLabelText('Bold'))
    await userEvent.click(screen.getByLabelText('More'))
    await userEvent.click(await screen.findByText('Add a note to self'))
    await userEvent.fill(await screen.findByPlaceholderText('Write the note, then press Return'), 'Too much?')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(markTypes()).toEqual(['bold', 'noteToSelf']))

    await userEvent.click(await screen.findByLabelText('More'))
    await userEvent.click(await screen.findByText('Clear formatting'))
    await waitFor(() => expect(markTypes()).toEqual(['noteToSelf']))
  })

  it('clears formatting it applied', async () => {
    await selectAll('formatted')
    await userEvent.click(screen.getByLabelText('Bold'))
    await waitFor(() => expect(markTypes()).toContain('bold'))

    await userEvent.click(screen.getByLabelText('More'))
    await userEvent.click(await screen.findByText('Clear formatting'))
    await waitFor(() => expect(markTypes()).toHaveLength(0))
  })

  it('names the shortcut on hover, which is the only place it is shown', async () => {
    await selectAll('formatted')
    await userEvent.hover(screen.getByLabelText('Bold'))
    expect(await screen.findByText(/^(⌘B|Ctrl\+B)$/)).toBeTruthy()
  })
})

/**
 * The text scrolls inside its own box (App.tsx's `data-scroll`), not the
 * window. The toolbar has to go with it: placed against the window, it stayed
 * where it was while the text slid under it, covering the lines it then hid.
 */
describe('SelectionToolbar in the live editor', () => {
  it('scrolls with the text it belongs to', async () => {
    let live: TiptapEditor | null = null
    const lines = Array.from({ length: 60 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Line ${i + 1}` }] }))
    render(
      <div data-scroll style={{ height: '400px', overflowY: 'auto', width: '360px' }}>
        <div style={{ paddingTop: '200px' }}>
          <NibEditor kind="page" focus={false} initialBody={{ type: 'doc', content: lines }} onChange={() => {}} onEditor={(next) => (live = next)} />
        </div>
      </div>,
    )
    await waitFor(() => expect(live).not.toBeNull())
    const editor = live! as TiptapEditor
    // The editor puts the caret at the end on opening, which scrolls there.
    await new Promise((resolve) => setTimeout(resolve, 100))
    const scroller = document.querySelector<HTMLElement>('[data-scroll]')!
    scroller.scrollTop = 0
    editor.view.dom.focus()
    // "Line 3", selected.
    editor.commands.setTextSelection({ from: editor.view.posAtDOM(document.querySelectorAll('.ProseMirror p')[2].firstChild!, 0), to: editor.view.posAtDOM(document.querySelectorAll('.ProseMirror p')[2].firstChild!, 6) })
    const toolbar = await screen.findByLabelText('Bold')
    const word = () => document.querySelectorAll('.ProseMirror p')[2].getBoundingClientRect().top
    await waitFor(() => expect(toolbar.getBoundingClientRect().bottom).toBeLessThanOrEqual(word()))
    const gap = word() - toolbar.getBoundingClientRect().top

    scroller.scrollTop = 120
    // At once, in the same frame as the text: no repositioning to wait for.
    expect(Math.round(word() - toolbar.getBoundingClientRect().top)).toBe(Math.round(gap))
  })
})

describe('the row Customize chooses', () => {
  const toolbar = () => screen.getByRole('toolbar', { name: 'Selection' })
  const row = () => [...toolbar().querySelectorAll('button, [role="separator"]')].map((child) => child.getAttribute('aria-label') ?? '|')
  const more = async () => {
    await userEvent.click(screen.getByLabelText('More'))
    await screen.findByText('Copy as Markdown')
    return screen.getAllByRole('button').filter((button) => !toolbar().contains(button)).map((button) => button.textContent)
  }

  afterEach(() => {
    resetLook()
    setLookPlus({ active: false, known: false })
  })

  it('is the row it always was by default, with the rest under •••', async () => {
    await selectAll('the quick brown fox')
    expect(row()).toEqual(['Bold', 'Italic', 'Strikethrough', 'Add a link', '|', 'Heading', 'Quote', 'Code', '|', 'More'])
    expect(await more()).toEqual(['Underline', 'Highlight', 'Checklist', 'Bulleted list', 'Numbered list', 'Add a footnote', 'Add a note to self', 'Copy as Markdown', 'Clear formatting'])
  })

  it('holds the chosen buttons in their order, with Plus, and moves the rest under •••', async () => {
    setLookPlus({ active: true, known: true })
    setLook({ toolbar: ['format-checklist', 'format-bold', 'format-highlight'] })
    await selectAll('the quick brown fox')
    expect(row()).toEqual(['Checklist', '|', 'Bold', 'Highlight', '|', 'More'])
    expect(await more()).toEqual([
      'Italic',
      'Strikethrough',
      'Add a link',
      'Heading',
      'Quote',
      'Code',
      'Underline',
      'Bulleted list',
      'Numbered list',
      'Add a footnote',
      'Add a note to self',
      'Copy as Markdown',
      'Clear formatting',
    ])

    await userEvent.click(screen.getByLabelText('Highlight'))
    expect(markTypes()).toContain('highlight')
  })

  it('is the old row again once Plus has gone', async () => {
    setLookPlus({ active: false, known: true })
    setLook({ toolbar: ['format-checklist'] })
    await selectAll('the quick brown fox', { showHeading: false })
    expect(row()).toEqual(['Bold', 'Italic', 'Strikethrough', 'Add a link', '|', 'Quote', 'Code', '|', 'More'])
  })
})

describe('a picture selected', () => {
  // One dot by one: its own size is far under the text's width.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const picture = () => editor!.state.doc.firstChild!.firstChild!
  // Not the one ProseMirror puts after it to keep the line open, which has no picture.
  const drawn = () => editor!.view.dom.querySelector<HTMLImageElement>('img[src]')!

  async function selectPicture() {
    const element = document.createElement('div')
    element.className = 'nib-editor'
    element.style.width = '600px'
    document.body.append(element)
    editor = new Editor({ element, extensions: nibExtensions(true), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: PNG, alt: '' } }] }] } })
    render(<SelectionToolbar editor={editor} showHeading />)
    editor.commands.focus()
    editor.view.dom.focus()
    editor.commands.setNodeSelection(1)
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Picture' })).toBeTruthy())
  }

  it('has a row of its own, sizes and where it sits, in place of the styles for words', async () => {
    await selectPicture()
    expect(screen.queryByLabelText('Bold')).toBeNull()
    expect(screen.queryByLabelText('More')).toBeNull()
    const row = screen.getByRole('toolbar', { name: 'Picture' })
    expect([...row.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Small', 'Medium', 'Large', 'Full width', 'Align left', 'Align center', 'Align right'])
  })

  it('is shown at the size chosen, a share of the text’s width, and at its own again when that’s chosen twice', async () => {
    await selectPicture()
    await waitFor(() => expect(drawn().getBoundingClientRect().width).toBe(1))
    await userEvent.click(screen.getByLabelText('Medium'))
    expect(picture().attrs.size).toBe('medium')
    expect(screen.getByLabelText('Medium').getAttribute('aria-pressed')).toBe('true')
    expect(Math.round(drawn().getBoundingClientRect().width)).toBe(300)
    // Still the picture chosen, with its row, for the next choice.
    await userEvent.click(screen.getByLabelText('Full width'))
    expect(Math.round(drawn().getBoundingClientRect().width)).toBe(600)
    await userEvent.click(screen.getByLabelText('Small'))
    expect(Math.round(drawn().getBoundingClientRect().width)).toBe(198)
    await userEvent.click(screen.getByLabelText('Large'))
    expect(Math.round(drawn().getBoundingClientRect().width)).toBe(450)
    await userEvent.click(screen.getByLabelText('Large'))
    expect(picture().attrs.size).toBeNull()
    expect(drawn().getBoundingClientRect().width).toBe(1)
    // One step each to undo.
    editor!.commands.undo()
    expect(picture().attrs.size).toBe('large')
  })

  it('sits where its line is aligned: in the middle, at the right, and back at the left', async () => {
    await selectPicture()
    await userEvent.click(screen.getByLabelText('Small'))
    const left = () => Math.round(drawn().getBoundingClientRect().left - editor!.view.dom.getBoundingClientRect().left)
    expect(left()).toBe(0)
    await userEvent.click(screen.getByLabelText('Align center'))
    expect(editor!.state.doc.firstChild!.attrs.textAlign).toBe('center')
    expect(screen.getByLabelText('Align center').getAttribute('aria-pressed')).toBe('true')
    expect(left()).toBe(201)
    await userEvent.click(screen.getByLabelText('Align right'))
    expect(left()).toBe(402)
    await userEvent.click(screen.getByLabelText('Align right'))
    expect(editor!.state.doc.firstChild!.attrs.textAlign).toBeNull()
    expect(left()).toBe(0)
  })
})
