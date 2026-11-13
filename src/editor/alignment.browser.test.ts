import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { CellSelection } from '@tiptap/pm/tables'
import { TextSelection } from '@tiptap/pm/state'
import type { JSONContent } from '@tiptap/react'
import '../index.css'
import { withoutDefaultAlignment } from '../lib/alignment'
import { htmlToBody } from '../lib/import'
import { nibEditor, textClass } from './extensions'
import { formatById } from './formats'

const line = (text: string, attrs?: object, type = 'paragraph'): JSONContent => ({ type, ...(attrs && { attrs }), content: [{ type: 'text', text }] })

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

function open(content: JSONContent[] | string, page = true) {
  const element = document.body.appendChild(document.createElement('div'))
  editor = new Editor({ element, ...nibEditor(page), content: typeof content === 'string' ? content : { type: 'doc', content }, editorProps: { attributes: { class: textClass(page) } } })
  return editor
}
const press = (id: string) => formatById(id)!.run(editor!)
const active = (id: string) => formatById(id)!.active(editor!)
const blocks = (): JSONContent[] => editor!.getJSON().content ?? []
const drawn = (selector: string) => getComputedStyle(editor!.view.dom.querySelector(selector)!).textAlign

describe('aligning', () => {
  it('moves the line the caret is in, draws it, and lights up the one chosen', () => {
    open([line('one'), line('two')]).commands.setTextSelection(2)
    press('format-align-center')
    expect(blocks()[0].attrs?.textAlign).toBe('center')
    expect(blocks()[1].attrs?.textAlign).toBeNull()
    expect(drawn('p')).toBe('center')
    expect(active('format-align-center')).toBe(true)
    expect(active('format-align-right')).toBe(false)
  })

  it('puts the cursor back in the text, as Commands has it away in its own field', async () => {
    const field = document.body.appendChild(document.createElement('input'))
    open([line('one')]).commands.setTextSelection(2)
    field.focus()
    press('format-align-center')
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    expect(document.activeElement).toBe(editor!.view.dom)
  })

  it('goes from one to another, and back to none when chosen again', () => {
    open([line('one')]).commands.setTextSelection(2)
    press('format-align-right')
    press('format-justify')
    expect(blocks()[0].attrs?.textAlign).toBe('justify')
    press('format-justify')
    expect(blocks()[0].attrs?.textAlign).toBeNull()
    expect(editor!.view.dom.querySelector('p')!.hasAttribute('style')).toBe(false)
  })

  it('moves every line selected, a heading among them', () => {
    open([line('one'), line('two', { level: 2 }, 'heading'), line('three')]).commands.selectAll()
    press('format-align-right')
    expect(blocks().map((block) => block.attrs?.textAlign)).toEqual(['right', 'right', 'right'])
    expect(blocks()[1].attrs?.level).toBe(2)
    expect(drawn('h2')).toBe('right')
  })

  it('works in a note, which has no headings', () => {
    open([line('one')], false).commands.setTextSelection(2)
    press('format-align-center')
    expect(blocks()[0].attrs?.textAlign).toBe('center')
  })

  it('moves one line of a list', () => {
    open([{ type: 'bulletList', content: [{ type: 'listItem', content: [line('one')] }, { type: 'listItem', content: [line('two')] }] }]).commands.setTextSelection(3)
    press('format-align-center')
    const items = blocks()[0].content!
    expect(items[0].content![0].attrs?.textAlign).toBe('center')
    expect(items[1].content![0].attrs?.textAlign).toBeNull()
  })

  it('moves every cell selected in a table', () => {
    const cell = (text: string): JSONContent => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [line(text)] })
    open([{ type: 'table', content: [{ type: 'tableRow', content: [cell('a'), cell('b'), cell('c')] }] }])
    const { doc } = editor!.state
    const cells: number[] = []
    doc.descendants((node, at) => void (node.type.name === 'tableCell' && cells.push(at)))
    editor!.view.dispatch(editor!.state.tr.setSelection(CellSelection.create(doc, cells[0], cells[1])))
    press('format-align-right')
    expect(blocks()[0].content![0].content!.map((cell) => cell.content![0].attrs?.textAlign)).toEqual(['right', 'right', null])
  })

  it('carries on to the next line', () => {
    open([line('one', { textAlign: 'center' })]).commands.setTextSelection(4)
    editor!.commands.splitBlock()
    expect(blocks().map((block) => block.attrs?.textAlign)).toEqual(['center', 'center'])
  })

  it('stays when the line becomes a heading, and goes when it becomes body text', () => {
    open([line('one', { textAlign: 'center' })]).commands.setTextSelection(2)
    press('format-heading')
    expect(blocks()[0]).toMatchObject({ type: 'heading', attrs: { level: 2, textAlign: 'center' } })
    press('format-body')
    expect(blocks()[0].type).toBe('paragraph')
    expect(blocks()[0].attrs?.textAlign).toBeNull()
  })

  it('leaves a code block alone', () => {
    open([{ type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] }]).commands.setTextSelection(2)
    press('format-align-center')
    expect(blocks()[0].attrs).not.toHaveProperty('textAlign')
  })

  it('lets the space where a line wraps hang past the edge, so the lines end level', () => {
    open([line('one', { textAlign: 'right' }), line('two')])
    const [aligned, plain] = editor!.view.dom.querySelectorAll('p')
    expect(getComputedStyle(aligned).whiteSpace).toBe('pre-wrap')
    expect(getComputedStyle(plain).whiteSpace).toBe('break-spaces')
  })

  it('can put a line written from the right on the left', () => {
    open([line('هذا نص عربي', { textAlign: 'left' }), line('هذا نص عربي')])
    const [first, second] = editor!.view.dom.querySelectorAll('p')
    expect(getComputedStyle(first).textAlign).toBe('left')
    expect(getComputedStyle(second).direction).toBe('rtl')
  })

  it('takes a pasted or imported line’s alignment, if it is one of the four', () => {
    open('<p style="text-align: center">one</p><p style="text-align: start">two</p><h2 style="text-align: right">three</h2>')
    expect(blocks().map((block) => block.attrs?.textAlign)).toEqual(['center', null, 'right'])
  })

  it('draws no style from anything else that a stored body says', () => {
    open([line('one', { textAlign: 'center; position: fixed' }), line('two', { textAlign: 7 })])
    for (const paragraph of editor!.view.dom.querySelectorAll('p')) expect(paragraph.hasAttribute('style')).toBe(false)
  })

  it('says nothing about the lines not aligned in a file brought in', () => {
    expect(htmlToBody('<p>one</p><p style="text-align: center">two</p>', 'note').content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
      { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'two' }] },
    ])
  })

  it('leaves a document nothing has been aligned in stored as it was', () => {
    const body: JSONContent = { type: 'doc', content: [line('one'), line('two', { level: 1 }, 'heading'), { type: 'bulletList', content: [{ type: 'listItem', content: [line('three')] }] }] }
    open(body.content!)
    editor!.view.dispatch(editor!.state.tr.setSelection(TextSelection.atEnd(editor!.state.doc)))
    expect(withoutDefaultAlignment(editor!.getJSON())).toEqual(body)
  })
})
