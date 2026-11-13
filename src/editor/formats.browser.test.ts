import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { nibExtensions } from './extensions'
import { formatById } from './formats'

/** Real ProseMirror commands, so a real browser. */

let editor: Editor | undefined

function open(html: string, page = true) {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({ element, extensions: nibExtensions(page), content: html })
  return editor
}

const run = (id: string) => formatById(id)!.run(editor!)
const first = (): JSONContent => (editor!.getJSON().content ?? [])[0]

afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

describe('each format does what it says', () => {
  it.each([
    ['format-title', { type: 'heading', attrs: { level: 1 } }],
    ['format-heading', { type: 'heading', attrs: { level: 2 } }],
    ['format-subheading', { type: 'heading', attrs: { level: 3 } }],
    ['format-mono', { type: 'codeBlock' }],
    ['format-quote', { type: 'blockquote' }],
    ['format-checklist', { type: 'taskList' }],
    ['format-bullets', { type: 'bulletList' }],
    ['format-numbers', { type: 'orderedList' }],
  ])('%s shapes the line the caret is on', (id, expected) => {
    open('<p>a line</p>')
    editor!.commands.setTextSelection(3)
    run(id)
    expect(first()).toMatchObject(expected)
    expect(formatById(id)!.active(editor!)).toBe(true)
  })

  it('Body takes a line back to plain text, out of a heading or a list', () => {
    open('<h2>was a heading</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>was a task</p></li></ul>')
    editor!.commands.setTextSelection(3)
    run('format-body')
    expect(first().type).toBe('paragraph')
    editor!.commands.setTextSelection(editor!.state.doc.content.size - 3)
    run('format-body')
    expect((editor!.getJSON().content ?? []).map((node) => node.type)).toEqual(['paragraph', 'paragraph'])
    expect(formatById('format-body')!.active(editor!)).toBe(true)
  })

  it.each([
    ['format-bold', 'bold'],
    ['format-italic', 'italic'],
    ['format-underline', 'underline'],
    ['format-strike', 'strike'],
    ['format-highlight', 'highlight'],
  ])('%s marks the selection', (id, mark) => {
    open('<p>some words</p>')
    editor!.commands.setTextSelection({ from: 1, to: 5 })
    run(id)
    expect(first().content?.[0]).toMatchObject({ text: 'some', marks: [{ type: mark }] })
  })

  it('indents a list item under the one above, and outdents it back', () => {
    open('<ul><li><p>one</p></li><li><p>two</p></li></ul>')
    editor!.commands.setTextSelection(editor!.state.doc.content.size - 4)
    run('format-indent')
    expect(first().content).toHaveLength(1)
    expect(first().content?.[0].content?.[1].type).toBe('bulletList')
    run('format-outdent')
    expect(first().content).toHaveLength(2)
  })

  it('indents a checklist item too', () => {
    open('<ul data-type="taskList"><li data-type="taskItem"><p>one</p></li><li data-type="taskItem"><p>two</p></li></ul>')
    editor!.commands.setTextSelection(editor!.state.doc.content.size - 4)
    run('format-indent')
    expect(first().content).toHaveLength(1)
    expect(first().content?.[0].content?.[1].type).toBe('taskList')
  })

  it('works in a note, which has everything but headings', () => {
    open('<p>a note</p>', false)
    editor!.commands.setTextSelection(3)
    run('format-checklist')
    expect(first().type).toBe('taskList')
  })
})
