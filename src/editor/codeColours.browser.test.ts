import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { JSONContent } from '@tiptap/react'
import '../index.css'
import { MOST_COLOURED } from '../lib/codeReader'
import { nibEditor, textClass } from './extensions'

/** Colours over a code block's text (codeColours.ts), in a real editor with the real grammars: what shows, and what the document holds. */

const code = (text: string, language: string | null = null): JSONContent => ({ type: 'codeBlock', attrs: { language }, content: text ? [{ type: 'text', text }] : undefined })
const line = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function open(content: JSONContent[], editable = true) {
  const element = document.body.appendChild(document.createElement('div'))
  editor = new Editor({ element, ...nibEditor(true), content: { type: 'doc', content }, editable, editorProps: { attributes: { class: textClass(true) } } })
  return editor
}
const dom = () => editor!.view.dom
const words = (colour: string, within: ParentNode = dom()) => [...within.querySelectorAll(`.nib-code-${colour}`)].map((element) => element.textContent)
/** What's sent to be read from now on. */
const reads = () => vi.spyOn(Worker.prototype, 'postMessage')
const seen = (colour: string, text: string) => vi.waitFor(() => expect(words(colour)).toContain(text), { timeout: 10_000 })
const block = (index: number) => dom().querySelectorAll('pre')[index]
const menu = (index = 0) => block(index).querySelector('select')!
const shownName = (index = 0) => block(index).querySelector('.nib-code-language span')!.textContent
function choose(language: string, index = 0) {
  menu(index).value = language
  menu(index).dispatchEvent(new Event('change', { bubbles: true }))
}
const language = (index = 0) => editor!.getJSON().content![index].attrs?.language

describe('colours in a code block', () => {
  it('are drawn over the words of its language, and the document is the same with them or without', async () => {
    const content = [code('const a = "b" // c\nreturn 12', 'javascript')]
    open(content)
    await seen('keyword', 'const')
    expect(words('keyword')).toEqual(['const', 'return'])
    expect(words('string')).toEqual(['"b"'])
    expect(words('comment')).toEqual(['// c'])
    expect(words('number')).toEqual(['12'])
    expect(block(0).querySelector('code')!.textContent).toBe('const a = "b" // c\nreturn 12')
    expect(editor!.getJSON().content).toEqual(content)
    expect(editor!.getHTML()).toBe('<pre><code class="language-javascript">const a = "b" // c\nreturn 12</code></pre>')
  })

  it('come with a fence’s short name for a language', async () => {
    open([code('def go():\n  pass', 'py')])
    await seen('keyword', 'def')
  })

  it('come for a language outside the ones fetched first', async () => {
    open([code('module Main where', 'haskell')])
    await seen('keyword', 'module')
  })

  it('put only Nib’s own classes in the page, whatever a grammar calls its words', async () => {
    // Markdown's grammar has a `table`, Tailwind's name for `display: table`.
    open([code('| a | b |\n|---|---|\n| 1 | 2 |\n\n# Title', 'markdown')])
    await vi.waitFor(() => expect(block(0).querySelector('[class]')).not.toBeNull(), { timeout: 10_000 })
    const classes = [...block(0).querySelector('code')!.querySelectorAll('[class]')].map((element) => element.className)
    expect(classes.filter((name) => !/^nib-code-(comment|keyword|string|number|name)$/.test(name))).toEqual([])
  })

  it('leave text with no language, or none Nib knows, as it is', async () => {
    open([code('const a'), code('const a', 'nosuchlanguage'), code('const a', 'constructor'), code('const a', 'javascript')])
    await seen('keyword', 'const')
    expect(words('keyword')).toEqual(['const'])
    expect(words('keyword', block(3))).toEqual(['const'])
  })

  it('aren’t all read again at each keystroke because one block has a language with no grammar', async () => {
    open([line('Before'), code('x', 'nosuchlanguage'), code('const a', 'javascript')])
    await seen('keyword', 'const')
    const settled = () => new Promise((resolve) => setTimeout(resolve, 50))
    await settled()
    const read = reads()
    editor!.commands.insertContentAt(1, 'A')
    // As the editor's others are, one after another as a document opens: each makes every plugin's view again.
    editor!.registerPlugin(new Plugin({ key: new PluginKey('another') }))
    await settled()
    expect(read).not.toHaveBeenCalled()
  })

  it('give a word the grammar has no colour for the colour it’s inside', async () => {
    // The `#` of a C directive is a `directive-hash`, inside a macro.
    open([code('#include <a.h>', 'c')])
    await seen('keyword', 'include')
    expect(words('name')).toContain('#')
  })

  it('count a character made of two the way the document does', async () => {
    open([code('"😀" + 1', 'javascript')])
    await seen('number', '1')
    expect(words('string')).toEqual(['"😀"'])
  })

  it('follow what is typed', async () => {
    open([code('cons', 'javascript')])
    editor!.commands.insertContentAt(5, 't a')
    await seen('keyword', 'const')
    editor!.commands.deleteRange({ from: 3, to: 6 })
    await vi.waitFor(() => expect(words('keyword')).toEqual([]), { timeout: 10_000 })
  })

  it('stay on their words when text moves them, without the block being read again', async () => {
    open([line('Before'), code('let a', 'javascript'), code('const b', 'javascript')])
    await seen('keyword', 'const')
    const read = reads()
    editor!.commands.insertContentAt(1, 'A long way ')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(read).not.toHaveBeenCalled()
    expect(words('keyword')).toEqual(['let', 'const'])
    expect(editor!.state.doc.textBetween(0, editor!.state.doc.content.size, '|')).toBe('A long way Before|let a|const b')
  })

  it('are read again only for the block that changed', async () => {
    open([code('let a', 'javascript'), code('const b', 'javascript')])
    await seen('keyword', 'const')
    const read = reads()
    editor!.commands.insertContentAt(2, 'x')
    await vi.waitFor(() => expect(read).toHaveBeenCalled(), { timeout: 10_000 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(read.mock.calls.map(([message]) => message)).toEqual([{ language: 'javascript', text: 'lxet a' }])
    expect(words('keyword')).toEqual(['const'])
  })

  it('stay on the words they were on while a change is being read, rather than blink', async () => {
    open([code('const a', 'javascript')])
    await seen('keyword', 'const')
    editor!.commands.insertContentAt(8, ' b')
    expect(words('keyword')).toEqual(['const'])
  })

  it('read a document of more blocks than it remembers once each, and stop', async () => {
    const read = reads()
    open(Array.from({ length: 230 }, (_, index) => code(`const many${index}`, 'javascript')))
    await vi.waitFor(() => expect(words('keyword')).toHaveLength(230), { timeout: 20_000 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(read).toHaveBeenCalledTimes(230)
  })

  it('aren’t sent to an editor that has closed since it asked', async () => {
    open([code('const closedBeforeTheAnswer', 'javascript')])
    const told = vi.spyOn(editor!.view, 'dispatch')
    editor!.destroy()
    open([code('const openedAfterwards', 'javascript')])
    await seen('keyword', 'const')
    expect(told).not.toHaveBeenCalled()
  })

  it('stop for a block that takes too long to read, and go on to the next', async () => {
    const stopped = vi.spyOn(Worker.prototype, 'terminate')
    // A read that never comes back, as one of a long unbroken run of letters may not for seconds. Words no other test has had read.
    reads().mockImplementationOnce(() => {})
    open([code('let neverAnswered', 'python'), code('const answeredNext', 'javascript')])
    await seen('keyword', 'const')
    expect(stopped).toHaveBeenCalled()
    expect(block(0).querySelector('code')!.querySelectorAll('[class]')).toHaveLength(0)
  })

  it('go when the block stops being code', async () => {
    open([code('const a', 'javascript')])
    await seen('keyword', 'const')
    editor!.commands.setTextSelection(2)
    editor!.commands.toggleCodeBlock()
    expect(editor!.getJSON().content![0].type).toBe('paragraph')
    expect(dom().querySelector('[class^="nib-code-"]')).toBeNull()
  })

  it('reach a block inside a list, a quote or a callout', async () => {
    const bullet = (inner: JSONContent): JSONContent => ({ type: 'bulletList', content: [{ type: 'listItem', content: [line('Item'), inner] }] })
    open([bullet(code('let a', 'javascript')), { type: 'blockquote', content: [code('var b', 'javascript')] }, { type: 'callout', attrs: { kind: 'note', collapsed: false }, content: [code('const c', 'javascript')] }])
    await seen('keyword', 'const')
    expect(words('keyword')).toEqual(['let', 'var', 'const'])
  })

  it('stop for a block too long to read at every keystroke, and come back when it is short enough', async () => {
    const long = 'const a\n'.repeat(Math.ceil(MOST_COLOURED / 8) + 1)
    open([code(long, 'javascript'), code('let b', 'javascript')])
    await seen('keyword', 'let')
    expect(words('keyword')).toEqual(['let'])
    editor!.commands.deleteRange({ from: 2 + 8 * 8, to: long.length })
    await seen('keyword', 'const')
  })

  it('come back with an undo', async () => {
    open([code('const a', 'javascript')])
    await seen('keyword', 'const')
    editor!.commands.deleteRange({ from: 1, to: 8 })
    expect(words('keyword')).toEqual([])
    editor!.commands.undo()
    await seen('keyword', 'const')
  })

  it('are drawn in a document opened read-only', async () => {
    open([code('const a', 'javascript')], false)
    await seen('keyword', 'const')
  })
})

describe('a code block’s language', () => {
  it('is chosen from its menu, coloured at once and one undo from gone', async () => {
    open([code('def go():\n  pass')])
    expect(shownName()).toBe('Plain text')
    choose('python')
    expect(language()).toBe('python')
    expect(shownName()).toBe('Python')
    await seen('keyword', 'def')
    editor!.commands.undo()
    expect(language()).toBeNull()
    expect(shownName()).toBe('Plain text')
    expect(words('keyword')).toEqual([])
  })

  it('leaves the caret where it was when it changes', () => {
    open([code('one two')])
    editor!.commands.setTextSelection(4)
    choose('python')
    expect(editor!.state.selection.from).toBe(4)
  })

  it('goes back to plain text as no language at all', () => {
    open([code('a', 'python')])
    choose('')
    expect(language()).toBeNull()
  })

  it('shows one the menu doesn’t name as the fence wrote it, and keeps it', () => {
    open([code('const a', 'js'), code('x', 'nosuchlanguage')])
    expect(shownName(0)).toBe('js')
    expect(shownName(1)).toBe('nosuchlanguage')
    expect(language(0)).toBe('js')
  })

  it('offers every language in each block’s menu', () => {
    open([code('a'), code('b')])
    expect(menu(0).options.length).toBe(1 + 31 + 263)
    expect(menu(1).options.length).toBe(menu(0).options.length)
  })

  it('can’t be changed in a read-only document, and a plain block shows nothing there', () => {
    open([code('a', 'python'), code('b')], false)
    choose('ruby')
    expect(language()).toBe('python')
    expect(shownName()).toBe('Python')
    expect(getComputedStyle(block(1).querySelector('.nib-code-language')!).display).toBe('none')
    expect(getComputedStyle(block(0).querySelector('.nib-code-language')!).display).not.toBe('none')
  })

  it('never lies over a word: a long first line wraps round its name', () => {
    open([code(`${'word '.repeat(40)}`, 'python')])
    Object.assign(dom().style, { width: '320px' })
    const range = document.createRange()
    range.selectNodeContents(block(0).querySelector('code')!)
    const corner = block(0).querySelector('.nib-code-language span')!.getBoundingClientRect()
    const under = [...range.getClientRects()].filter((rect) => rect.top < corner.bottom && rect.bottom > corner.top && rect.left < corner.right && rect.right > corner.left)
    expect(under).toEqual([])
    expect(corner.width).toBeGreaterThan(0)
  })

  // iOS underlined `def`, and the name itself, in red; a tap on an underlined name went to the spelling and not the menu.
  it('isn’t spell-checked once chosen, nor is its name, and text in mono with no language still is', () => {
    open([code('def a', 'python'), code('plain words')])
    expect(block(0).querySelector('code')!.spellcheck).toBe(false)
    expect(block(1).querySelector('code')!.spellcheck).toBe(true)
    expect(block(1).querySelector<HTMLElement>('.nib-code-language')!.spellcheck).toBe(false)
    choose('python', 1)
    expect(block(1).querySelector('code')!.spellcheck).toBe(false)
  })

  it('stays out of what is copied or saved', () => {
    open([code('const a', 'python')])
    expect(editor!.getText()).toBe('const a')
    expect(editor!.getHTML()).not.toContain('select')
  })
})
