import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { Editor, getSchema } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import '../index.css'
import { CALLOUT_CSS, CALLOUT_INK, CALLOUT_KINDS, CALLOUT_NAMES } from '../lib/callouts'
import { markdownToBody } from '../lib/import'
import { toMarkdown } from '../lib/markdown'
import { plainText, previewOf, titleOf } from '../lib/text'
import { fitSchema } from './fitSchema'
import { nibEditor, nibExtensions, textClass } from './extensions'
import { formatById, formatsFor } from './formats'

const line = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const box = (kind: string, collapsed: boolean, ...content: JSONContent[]): JSONContent => ({ type: 'callout', attrs: { kind, collapsed }, content })

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

function open(content: JSONContent[], page = true) {
  const element = document.body.appendChild(document.createElement('div'))
  editor = new Editor({ element, ...nibEditor(page), content: { type: 'doc', content }, editorProps: { attributes: { class: textClass(page) } } })
  return editor
}
const press = (id: string) => formatById(id)!.run(editor!)
const blocks = (): JSONContent[] => editor!.getJSON().content ?? []
const callout = () => editor!.view.dom.querySelector<HTMLElement>('.nib-callout')!
const menu = () => callout().querySelector('select')!
const fold = () => callout().querySelector<HTMLButtonElement>('.nib-callout-fold')!
const shown = (element: Element) => getComputedStyle(element).display !== 'none'
const choose = (kind: string) => {
  menu().value = kind
  menu().dispatchEvent(new Event('change', { bubbles: true }))
}
const inner = (position: number) => editor!.commands.setTextSelection(position)

describe('a callout in Markdown', () => {
  it.each<[string, string, object]>([
    ['the alert GitHub writes', '> [!NOTE]\n> Words', { kind: 'note', collapsed: false }],
    ['lower case, as Obsidian writes it', '> [!warning]\n> Words', { kind: 'warning', collapsed: false }],
    ['folded, as Obsidian writes it', '> [!tip]-\n> Words', { kind: 'tip', collapsed: true }],
    ['open, as Obsidian can write it', '> [!tip]+\n> Words', { kind: 'tip', collapsed: false }],
  ])('comes in from %s', (_, markdown, attrs) => {
    expect(markdownToBody(markdown, 'note').content).toEqual([{ type: 'callout', attrs, content: [line('Words')] }])
  })

  it('takes the words on the marker’s line as its first line, and a line left blank after it as nothing', () => {
    expect(markdownToBody('> [!NOTE] Mind this\n>\n> More', 'note').content![0].content).toEqual([line('Mind this'), line('More')])
    expect(markdownToBody('> [!NOTE]\n>\n> More', 'note').content![0].content).toEqual([line('More')])
  })

  it('leaves any other quotation a quotation', () => {
    expect(markdownToBody('> Plain', 'note').content![0].type).toBe('blockquote')
    expect(markdownToBody('> [!NONSENSE]\n> Words', 'note').content![0].type).toBe('blockquote')
    expect(markdownToBody('> [a link](https://example.com)', 'note').content![0].type).toBe('blockquote')
  })

  it.each(CALLOUT_KINDS)('comes back from its own export as it went, a %s', (kind) => {
    const body = { type: 'doc', content: [box(kind, kind === 'tip', line('First'), line('Second'), { type: 'bulletList', content: [{ type: 'listItem', content: [line('Item')] }] }), line('After')] }
    expect(markdownToBody(toMarkdown(body), 'page').content).toEqual(body.content)
  })
})

describe('a callout', () => {
  it('goes around the line the caret is in, and comes off again', () => {
    open([line('one'), line('two')]).commands.setTextSelection(2)
    press('format-callout')
    expect(blocks()[0]).toMatchObject({ type: 'callout', attrs: { kind: 'note', collapsed: false } })
    expect(blocks()[0].content).toEqual([expect.objectContaining({ type: 'paragraph' })])
    expect(blocks()[1].type).toBe('paragraph')
    expect(formatById('format-callout')!.active(editor!)).toBe(true)
    press('format-callout')
    expect(blocks().map((block) => block.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('goes around every line selected', () => {
    open([line('one'), line('two')]).commands.selectAll()
    press('format-callout')
    expect(blocks()).toHaveLength(1)
    expect(blocks()[0].content).toHaveLength(2)
  })

  it('works in a note as in a page', () => {
    open([line('one')], false).commands.setTextSelection(2)
    expect(formatsFor(false).some((format) => format.id === 'format-callout')).toBe(true)
    press('format-callout')
    expect(blocks()[0].type).toBe('callout')
  })

  it.each(CALLOUT_KINDS)('is made as a %s from the palette, turned into one, or taken off by choosing it again', (kind) => {
    open([line('one')]).commands.setTextSelection(2)
    const id = `format-callout-${kind}`
    press(id)
    expect(blocks()[0]).toMatchObject({ type: 'callout', attrs: { kind } })
    expect(formatById(id)!.active(editor!)).toBe(true)
    const other = kind === 'note' ? 'tip' : 'note'
    press(`format-callout-${other}`)
    expect(blocks()[0].attrs?.kind).toBe(other)
    expect(formatById(id)!.active(editor!)).toBe(false)
    press(`format-callout-${other}`)
    expect(blocks()[0].type).toBe('paragraph')
  })

  it('offers its eight kinds by name in the menu over the icon, and takes the one chosen', () => {
    open([box('note', false, line('one'))])
    expect([...menu().options].map((option) => [option.value, option.textContent])).toEqual(CALLOUT_KINDS.map((kind) => [kind, CALLOUT_NAMES[kind]]))
    expect(menu().value).toBe('note')
    choose('warning')
    expect(blocks()[0].attrs).toEqual({ kind: 'warning', collapsed: false })
    expect(callout().dataset.callout).toBe('warning')
    expect(menu().value).toBe('warning')
  })

  it('draws a different icon for each kind', () => {
    open(CALLOUT_KINDS.map((kind) => box(kind, false, line('x'))))
    const drawn = [...editor!.view.dom.querySelectorAll('.nib-callout-kind path')].map((path) => path.getAttribute('d'))
    expect(new Set(drawn).size).toBe(8)
  })

  it('reads any other kind in a stored body as a note, and writes no other into the page', () => {
    open([box('note" onclick="x', false, line('one'))])
    expect(callout().dataset.callout).toBe('note')
    expect(callout().hasAttribute('onclick')).toBe(false)
  })

  it('folds down to its first line, and opens again', async () => {
    open([box('tip', false, line('Title'), line('Hidden'), line('Also hidden'))])
    const [title, hidden, also] = callout().querySelectorAll('p')
    expect(fold().getAttribute('aria-expanded')).toBe('true')
    expect(fold().getAttribute('aria-label')).toBe('Collapse callout')
    fold().click()
    expect(blocks()[0].attrs?.collapsed).toBe(true)
    expect([shown(title), shown(hidden), shown(also)]).toEqual([true, false, false])
    expect(fold().getAttribute('aria-expanded')).toBe('false')
    expect(fold().getAttribute('aria-label')).toBe('Expand callout')
    fold().click()
    expect(blocks()[0].attrs?.collapsed).toBe(false)
    expect(shown(callout().querySelectorAll('p')[1])).toBe(true)
  })

  it('takes the caret to the first line when the line it was in folds away', () => {
    open([box('tip', false, line('Title'), line('Hidden'))]).commands.setTextSelection(10)
    fold().click()
    expect(blocks()[0].attrs?.collapsed).toBe(true)
    expect(editor!.state.selection.$head.parent.textContent).toBe('Title')
  })

  it('leaves the caret alone when it is outside what folds', () => {
    open([box('tip', false, line('Title'), line('Hidden')), line('After')]).commands.setTextSelection(editor?.state.doc.content.size ?? 18)
    const before = editor!.state.selection.head
    fold().click()
    expect(editor!.state.selection.head).toBe(before)
  })

  it('opens when the caret goes into a line folded away, as Find or an arrow key takes it', () => {
    open([box('tip', true, line('Title'), line('Hidden'))])
    inner(10)
    expect(blocks()[0].attrs?.collapsed).toBe(false)
    expect(editor!.state.selection.$head.parent.textContent).toBe('Hidden')
  })

  it('stays folded with the caret on its first line', () => {
    open([box('tip', true, line('Title'), line('Hidden'))])
    expect(shown(callout().querySelectorAll('p')[1])).toBe(false)
    inner(3)
    expect(blocks()[0].attrs?.collapsed).toBe(true)
  })

  it('leaves folding out of undo, so undo undoes the writing', () => {
    open([box('tip', false, line('Title'), line('More'))]).commands.setTextSelection(3)
    editor!.commands.insertContent('x')
    fold().click()
    expect(blocks()[0].attrs?.collapsed).toBe(true)
    editor!.commands.undo()
    expect(blocks()[0].attrs?.collapsed).toBe(true)
    expect(blocks()[0].content![0].content![0].text).toBe('Title')
  })

  it('ends with Return on an empty last line, as a quote does', () => {
    open([box('tip', false, line('Title'), { type: 'paragraph' }), line('After')])
    inner(9)
    editor!.commands.keyboardShortcut('Enter')
    expect(blocks().map((block) => block.type)).toEqual(['callout', 'paragraph', 'paragraph'])
    expect(blocks()[0].content).toHaveLength(1)
  })

  it('in a read-only document, changes nothing: folding is only what shows, and the type stays', async () => {
    open([box('tip', false, line('Title'), line('Hidden'))]).setEditable(false, false)
    const before = editor!.getJSON()
    fold().click()
    expect(shown(callout().querySelectorAll('p')[1])).toBe(false)
    expect(fold().getAttribute('aria-expanded')).toBe('false')
    choose('warning')
    expect(menu().value).toBe('tip')
    expect(callout().dataset.callout).toBe('tip')
    expect(editor!.getJSON()).toEqual(before)
    expect(getComputedStyle(menu()).pointerEvents).toBe('none')
  })

  it('in a read-only document, doesn’t open itself when the caret lands in what’s folded', () => {
    open([box('tip', true, line('Title'), line('Hidden'))]).setEditable(false, false)
    inner(10)
    expect(blocks()[0].attrs?.collapsed).toBe(true)
  })

  it('keeps a key pressed in its type menu out of the writing', () => {
    open([box('tip', false, line('Title'))]).commands.setTextSelection(3)
    const before = editor!.getJSON()
    menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(editor!.getJSON()).toEqual(before)
  })

  it('keeps the caret where it was when the fold or the icon is pressed', async () => {
    open([box('tip', false, line('Title')), line('Below the box')]).commands.focus(14)
    await vi.waitFor(() => expect(document.activeElement).toBe(editor!.view.dom))
    const before = editor!.state.selection.head
    await userEvent.click(fold())
    expect(document.activeElement).toBe(editor!.view.dom)
    expect(editor!.state.selection.head).toBe(before)
    await userEvent.click(callout().querySelector<HTMLElement>('.nib-callout-kind')!, { force: true })
    expect(editor!.state.selection.head).toBe(before)
  })

  it('counts in the title, the preview and search, a line to a paragraph', () => {
    const body = { type: 'doc', content: [box('tip', true, line('Title'), line('Second'))] }
    expect(plainText(body)).toBe('Title\nSecond')
    expect(titleOf(body)).toBe('Title')
    expect(previewOf(body)).toBe('Second')
  })

  it('has labels that read on white paper, and rules for all eight', () => {
    const channel = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((at) => channel(parseInt(hex.slice(at, at + 2), 16)))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    for (const kind of CALLOUT_KINDS) {
      expect(1.05 / (luminance(CALLOUT_INK[kind]) + 0.05), kind).toBeGreaterThanOrEqual(4.5)
      expect(CALLOUT_CSS).toContain(`[data-callout="${kind}"] { border-color`)
    }
  })

  it('on a Nib from before callouts, loses the box and keeps the words', () => {
    const older = getSchema(nibExtensions(true).filter((extension) => extension.name !== 'callout'))
    const body = { type: 'doc', content: [box('tip', true, line('Title'), line('Hidden')), line('After')] }
    expect(fitSchema(body, older).content).toEqual([line('Title'), line('Hidden'), line('After')])
  })
})
