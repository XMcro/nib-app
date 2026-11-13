import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { nibExtensions } from './extensions'
import { FormatBar } from './FormatBar'
import { startKeyboard } from '../lib/keyboard'
import { resetLook, setLook, setLookPlus } from '../lib/look'

/**
 * The bar has to hold focus in the text while it is pressed, or on an iPhone
 * the keyboard drops and the bar goes with it. Focus is real only in a browser.
 */

let editor: Editor | undefined

function mount(page = true) {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({ element, extensions: nibExtensions(page), content: '<p>a line</p>' })
  render(<FormatBar editor={editor} page={page} />)
  return editor
}

async function focus() {
  await act(async () => {
    editor!.commands.focus('end')
    editor!.view.dom.focus()
  })
  await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeTruthy())
}

/** Lines enough to scroll, in a scroller as App's, and the keyboard watched (lib/keyboard). The text hasn't focus yet. */
function scrolledLines() {
  const stop = startKeyboard()
  const scroller = document.createElement('div')
  scroller.dataset.scroll = ''
  // Not fixed, as App's isn't: ProseMirror goes on from a fixed box no further up.
  Object.assign(scroller.style, { position: 'absolute', top: '0', left: '0', height: `${innerHeight}px`, overflowY: 'auto', width: '320px' })
  const element = document.createElement('div')
  // As in App.tsx: room after the text for its last line to clear them.
  element.style.paddingBottom = 'var(--nib-covered, 0px)'
  scroller.append(element)
  document.body.append(scroller)
  const lines = Array.from({ length: 80 }, (_, i) => `<p>Line ${i + 1}</p>`).join('')
  editor = new Editor({ element, extensions: nibExtensions(true), content: lines })
  render(<FormatBar editor={editor} page />)
  return { scroller, stop }
}

/** What MainViewController reports: a keyboard this many points tall, over a web view the window's height. */
const keyboard = (height: number) => act(async () => void window.dispatchEvent(Object.assign(new Event('nibkeyboard'), { height, window: innerHeight })))

/** A finger coming down on, or lifting from, `target`; none left on the screen after. */
const touch = (target: Element, type: 'touchstart' | 'touchend') => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { touches: [] }))

const first = (): JSONContent => (editor!.getJSON().content ?? [])[0]
const editorFocused = () => document.activeElement?.closest('.ProseMirror') != null

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

describe('FormatBar', () => {
  it('appears only while the text has focus', async () => {
    mount()
    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull()
    await focus()
  })

  it.each([
    ['Checklist', 'taskList'],
    ['Bulleted list', 'bulletList'],
    ['Numbered list', 'orderedList'],
  ])('starts a %s from the caret, and the text keeps focus', async (label, type) => {
    mount()
    await focus()
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(first().type).toBe(type)
    expect(editorFocused()).toBe(true)
    expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens every style under Aa, headings included, in a page', async () => {
    mount(true)
    await focus()
    await userEvent.click(screen.getByRole('button', { name: 'Text styles' }))
    for (const name of ['Title', 'Heading', 'Subheading', 'Body', 'Monostyled', 'Quote', 'Bold', 'Underline', 'Highlight', 'Indent', 'Outdent']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    await userEvent.click(screen.getByRole('button', { name: 'Title' }))
    expect(first()).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(editorFocused()).toBe(true)
  })

  it('makes a callout from under Aa, in a note too, and shows it is in one', async () => {
    mount(false)
    await focus()
    await userEvent.click(screen.getByRole('button', { name: 'Text styles' }))
    const callout = screen.getByRole('button', { name: 'Callout' })
    await userEvent.click(callout)
    expect(first()).toMatchObject({ type: 'callout', attrs: { kind: 'note' } })
    await waitFor(() => expect(callout.getAttribute('aria-pressed')).toBe('true'))
    expect(editorFocused()).toBe(true)
  })

  it('names the deeper headings under Aa in short, and for VoiceOver in full', async () => {
    mount(true)
    await focus()
    await userEvent.click(screen.getByRole('button', { name: 'Text styles' }))
    const four = screen.getByRole('button', { name: 'Heading 4' })
    expect(four.textContent).toBe('H4')
    expect(screen.getByRole('button', { name: 'Heading 6' }).textContent).toBe('H6')
    await userEvent.click(four)
    expect(first()).toMatchObject({ type: 'heading', attrs: { level: 4 } })
  })

  it('aligns the line from under Aa, in a note too, and shows which', async () => {
    mount(false)
    await focus()
    await userEvent.click(screen.getByRole('button', { name: 'Text styles' }))
    for (const name of ['Align left', 'Align right', 'Justify']) expect(screen.getByRole('button', { name })).toBeTruthy()
    const center = screen.getByRole('button', { name: 'Align center' })
    expect(center.getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(center)
    expect(first().attrs?.textAlign).toBe('center')
    await waitFor(() => expect(center.getAttribute('aria-pressed')).toBe('true'))
    expect(editorFocused()).toBe(true)
  })

  it('offers no headings in a note', async () => {
    mount(false)
    await focus()
    await userEvent.click(screen.getByRole('button', { name: 'Text styles' }))
    expect(screen.getByRole('button', { name: 'Body' })).toBeTruthy()
    for (const name of ['Title', 'Heading', 'Subheading', 'Table']) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  it('puts a table in a page, then offers rows and columns while the caret is in it', async () => {
    mount(true)
    await focus()
    await userEvent.click(screen.getByRole('button', { name: 'Text styles' }))
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(editor!.getJSON().content?.some((node) => node.type === 'table')).toBe(true)
    expect(editorFocused()).toBe(true)

    await userEvent.click(await screen.findByRole('button', { name: 'Add column' }))
    expect(document.querySelectorAll('.ProseMirror tr:first-child > *')).toHaveLength(4)
    await userEvent.click(screen.getByRole('button', { name: 'Delete table' }))
    expect(editor!.getJSON().content?.some((node) => node.type === 'table')).toBe(false)
    expect(await screen.findByRole('button', { name: 'Table' })).toBeTruthy()
  })

  it('puts the keyboard away, and itself with it', async () => {
    mount()
    await focus()
    await userEvent.click(screen.getByRole('button', { name: 'Hide keyboard' }))
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull())
    expect(editorFocused()).toBe(false)
  })

  // The keyboard slides over the text, and the bar rides on it: the line
  // being typed, and the one tapped on to raise it, stay clear of both.
  it('rides on the keyboard, and keeps the caret clear of the two', async () => {
    const { stop } = scrolledLines()
    await focus()
    const bar = screen.getByRole('toolbar', { name: 'Formatting' })

    // What MainViewController reports: a keyboard 300 points tall, over a web view the window's height.
    await keyboard(300)
    expect(bar.style.transform).toContain('300px')
    const top = innerHeight - bar.offsetHeight - 300
    expect(parseFloat(document.documentElement.style.getPropertyValue('--nib-covered'))).toBe(Math.round(innerHeight - top))
    await waitFor(() => expect(editor!.view.coordsAtPos(editor!.state.selection.head).bottom).toBeLessThanOrEqual(top))

    // New lines at the very end are brought clear by scrolling the text alone,
    // never the page, which the app holds still. On iOS what can be seen of the
    // page ends at the keyboard.
    Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => innerHeight - 300 })
    const pageScroll = vi.spyOn(window, 'scrollBy')
    await userEvent.keyboard('{Enter}{Enter}{Enter}')
    await waitFor(() => expect(editor!.view.coordsAtPos(editor!.state.selection.head).bottom).toBeLessThanOrEqual(top))
    expect(pageScroll).not.toHaveBeenCalled()
    pageScroll.mockRestore()
    delete (visualViewport as { height?: number }).height

    await keyboard(0)
    stop()
  })

  // The tap that raises the keyboard puts the caret down in the page, and the
  // editor reads it there a moment later: till then its own caret is where the
  // last writing left it, here the end, which the text once slid off towards.
  it('brings up the caret the tap put down, not the one the editor last had', async () => {
    const { scroller, stop } = scrolledLines()
    editor!.commands.setTextSelection(editor!.state.doc.content.size - 1)
    const scrolled = vi.spyOn(scroller, 'scrollBy')
    await act(async () => {
      getSelection()!.collapse(editor!.view.dom.querySelector('p')!.firstChild!, 2)
      editor!.view.dom.focus()
    })
    await keyboard(300)
    expect(scrolled).not.toHaveBeenCalled()
    await keyboard(0)
    stop()
  })

  // A long press that raises the keyboard is still choosing words: moved under
  // it, the choice ran on to wherever the text had gone, and over the bar it
  // ran to the end. The text stays still and the bar lets the finger reach the
  // lines beneath it till it lifts; then the end of the words is brought up.
  it('holds the text still under a finger choosing words, and brings their end up once it lifts', async () => {
    const { scroller, stop } = scrolledLines()
    const bar = document.querySelector<HTMLElement>('[aria-label="Formatting"]')!
    const top = innerHeight - bar.offsetHeight - 300
    const lines = [...editor!.view.dom.querySelectorAll('p')]
    // One on screen now that the keyboard will cover.
    const low = lines.find((line) => line.getBoundingClientRect().top > top + 10 && line.getBoundingClientRect().bottom < innerHeight)!
    const scrolled = vi.spyOn(scroller, 'scrollBy')

    touch(lines[2], 'touchstart')
    expect(bar.style.pointerEvents).toBe('none')
    await act(async () => {
      getSelection()!.setBaseAndExtent(lines[2].firstChild!, 0, low.firstChild!, 4)
      editor!.view.dom.focus()
    })
    await keyboard(300)
    expect(scrolled).not.toHaveBeenCalled()

    touch(lines[2], 'touchend')
    await waitFor(() => expect(bar.style.pointerEvents).toBe(''))
    await waitFor(() => expect(low.getBoundingClientRect().bottom).toBeLessThanOrEqual(top))
    expect(scrolled).toHaveBeenCalledTimes(1)
    await keyboard(0)
    stop()
  })
})

describe('the buttons beside Aa', () => {
  // Beside Aa and before Hide keyboard, with the Aa panel shut.
  const beside = () =>
    [...screen.getByRole('toolbar', { name: 'Formatting' }).querySelectorAll('button')]
      .map((button) => button.getAttribute('aria-label'))
      .filter((label) => label !== 'Text styles' && label !== 'Hide keyboard')

  afterEach(() => {
    resetLook()
    setLookPlus({ active: false, known: false })
  })

  it('are the three lists by default', async () => {
    mount()
    await focus()
    expect(beside()).toEqual(['Checklist', 'Bulleted list', 'Numbered list'])
  })

  it('are the ones Customize chose, in its order, with Plus', async () => {
    setLookPlus({ active: true, known: true })
    setLook({ keyboardBar: ['format-bold', 'format-indent', 'format-highlight'] })
    mount()
    await focus()
    expect(beside()).toEqual(['Bold', 'Indent', 'Highlight'])
    await userEvent.click(screen.getByRole('button', { name: 'Bold' }))
    // With only a caret, bold is what the next letters will be.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true'))
    expect(editorFocused()).toBe(true)
  })
})
