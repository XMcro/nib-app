import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { Editor } from '@tiptap/core'
import { nibExtensions } from './extensions'
import '../index.css'

/**
 * A checkbox sits centred on the first line of its item, in a note's mono
 * and a page's Inter, whatever size and margins the platform gives a
 * checkbox: on the Mac it sat visibly below its text. Needs layout, so a
 * browser.
 */

let editor: Editor | undefined

// Editor.tsx's classes for each kind of document.
const CLASSES = {
  note: 'nib-editor font-mono text-[15px] leading-[1.7]',
  page: 'nib-editor nib-editor-page text-[17px] leading-[1.65]',
}

function mount(kind: 'note' | 'page', checkbox = '') {
  const element = document.createElement('div')
  element.style.width = '320px'
  document.body.append(element)
  // Another platform's checkbox, at its size.
  const style = document.createElement('style')
  style.textContent = checkbox
  document.head.append(style)
  editor = new Editor({
    element,
    extensions: nibExtensions(kind === 'page'),
    editorProps: { attributes: { class: CLASSES[kind] } },
    content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>short</p></li><li data-type="taskItem" data-checked="false"><p>a long item that wraps onto a second line and then a third one</p></li></ul>',
  })
  return () => style.remove()
}

/** How far each box's centre is from the centre of its item's first line. */
function offsets(): number[] {
  const items = [...document.querySelectorAll<HTMLElement>('.ProseMirror ul[data-type="taskList"] > li')]
  expect(items).toHaveLength(2)
  return items.map((item) => {
    const box = item.querySelector('input')!.getBoundingClientRect()
    const range = document.createRange()
    const text = item.querySelector('p')!.firstChild!
    range.setStart(text, 0)
    range.setEnd(text, 1)
    const line = range.getBoundingClientRect()
    const lineHeight = parseFloat(getComputedStyle(item.querySelector('p')!).lineHeight)
    // The line box is centred on the glyph's box.
    const lineCentre = line.top + line.height / 2
    expect(lineHeight).toBeGreaterThan(line.height - 1)
    return Math.abs(box.top + box.height / 2 - lineCentre)
  })
}

afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

describe('a checklist', () => {
  // Each platform draws its own checkbox, at its own size: Chromium's happens
  // to suit a fixed offset, which is how the Mac's ended up below its text.
  it.each([
    ['note', 13],
    ['note', 16],
    ['note', 24],
    ['page', 13],
    ['page', 16],
    ['page', 24],
  ] as const)('centres each box on the first line, in a %s, with a %ipx checkbox', (kind, size) => {
    const unmount = mount(kind, `.ProseMirror input[type="checkbox"] { width: ${size}px; height: ${size}px }`)
    for (const offset of offsets()) expect(offset).toBeLessThan(1)
    unmount()
  })
})

/**
 * A box ticks its own item and does nothing else. TipTap's own box focused
 * the editor first, which put the caret back where it last was: on an iPhone
 * the keyboard came up and the text scrolled away to that line, away from the
 * box that had been tapped.
 */
describe('ticking a box', () => {
  const checked = () => editor!.state.doc.firstChild!.children.map((item) => item.attrs.checked)
  const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

  /** The caret, part way into the second item. */
  function caretInSecondItem(): number {
    const text = document.querySelectorAll('.ProseMirror li p')[1].firstChild!
    const at = editor!.view.posAtDOM(text, 6)
    editor!.commands.setTextSelection(at)
    return at
  }

  it('leaves a writer who wasn’t typing not typing, with the caret where it was', async () => {
    mount('note')
    const at = caretInSecondItem()
    await userEvent.click(document.querySelector('.ProseMirror li input')!)
    await frames()
    expect(checked()).toEqual([true, false])
    expect(editor!.view.hasFocus()).toBe(false)
    expect(editor!.state.selection.from).toBe(at)
  })

  it('keeps the caret where it was while typing', async () => {
    mount('note')
    editor!.view.dom.focus()
    const at = caretInSecondItem()
    await userEvent.click(document.querySelector('.ProseMirror li input')!)
    await frames()
    expect(checked()).toEqual([true, false])
    expect(editor!.view.hasFocus()).toBe(true)
    expect(editor!.state.selection.from).toBe(at)
  })

  // The label is a line tall and the box sits in its middle, so a finger can
  // land on the label just above or below the box.
  it('ticks from the label around the box, without starting to type', async () => {
    mount('note')
    caretInSecondItem()
    await userEvent.click(document.querySelector('.ProseMirror li label')!, { position: { x: 1, y: 1 } })
    await frames()
    expect(checked()).toEqual([true, false])
    expect(editor!.view.hasFocus()).toBe(false)
  })

  it('unticks', async () => {
    mount('note')
    const box = document.querySelector<HTMLInputElement>('.ProseMirror li input')!
    await userEvent.click(box)
    await userEvent.click(box)
    expect(checked()).toEqual([false, false])
    expect(box.checked).toBe(false)
  })
})
