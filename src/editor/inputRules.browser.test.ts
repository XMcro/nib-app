import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { nibExtensions } from './extensions'

/**
 * The rules a writer actually feels: typing `- `, `# `, `**bold**`. None of it
 * can be tested under jsdom, which has no layout, so ProseMirror refuses to
 * run at all. These need a browser that really lays the document out.
 */

let editor: Editor | undefined

/** `[` and `{` open key descriptors in userEvent's keyboard syntax; double them to type one. */
const literal = (text: string) => text.replace(/[[{]/g, (char) => char + char)

async function type(text: string, { page = false } = {}): Promise<JSONContent> {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({ element, extensions: nibExtensions(page), content: '' })
  // `commands.focus()` defers the DOM focus to requestAnimationFrame, so the
  // node has to be focused directly too — the same pair Editor.tsx uses.
  editor.commands.focus('end')
  editor.view.dom.focus()
  await userEvent.keyboard(literal(text))
  return editor.getJSON() as JSONContent
}

/** The first block's type, which is what most input rules change. */
const firstBlock = (doc: JSONContent) => doc.content?.[0]

afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

describe('markdown input rules', () => {
  it('turns "# " into a heading on a page', async () => {
    const block = firstBlock(await type('# Chapter one', { page: true }))
    expect(block?.type).toBe('heading')
    expect(block?.attrs?.level).toBe(1)
    expect(block?.content?.[0].text).toBe('Chapter one')
  })

  it('leaves "# " as text in a note, which has no headings', async () => {
    const block = firstBlock(await type('# Chapter one'))
    expect(block?.type).toBe('paragraph')
    expect(block?.content?.[0].text).toBe('# Chapter one')
  })

  it('turns "- " into a bullet list', async () => {
    const block = firstBlock(await type('- milk'))
    expect(block?.type).toBe('bulletList')
    expect(block?.content?.[0].content?.[0].content?.[0].text).toBe('milk')
  })

  it('turns "1. " into an ordered list', async () => {
    expect(firstBlock(await type('1. first'))?.type).toBe('orderedList')
  })

  it('turns "> " into a blockquote', async () => {
    expect(firstBlock(await type('> quoted'))?.type).toBe('blockquote')
  })

  it('turns "- [ ] " into an unchecked task', async () => {
    const block = firstBlock(await type('- [ ] pack socks'))
    expect(block?.type).toBe('taskList')
    expect(block?.content?.[0].attrs?.checked).toBe(false)
  })

  it('turns "- [x] " into a checked task', async () => {
    const block = firstBlock(await type('- [x] done'))
    expect(block?.type).toBe('taskList')
    expect(block?.content?.[0].attrs?.checked).toBe(true)
  })

  it.each([
    ['**bold**', 'bold'],
    ['*italic*', 'italic'],
    ['~~struck~~', 'strike'],
    ['`code`', 'code'],
  ])('applies %s while typing', async (typed, mark) => {
    const block = firstBlock(await type(`${typed} `))
    expect(block?.content?.[0].marks?.[0].type).toBe(mark)
  })
})

/**
 * The audit narrowed autolinking because `.md`, `.sh` and `.py` are live TLDs,
 * so writing about a file linkified it. Only the configured predicate could be
 * unit-tested; this drives the plugin itself.
 */
describe('autolink', () => {
  /** The link href on the first text node, if the autolinker made one. */
  async function linkAfterTyping(text: string) {
    const block = firstBlock(await type(`${text} `))
    const marks = block?.content?.[0].marks ?? []
    return marks.find((mark) => mark.type === 'link')?.attrs?.href
  }

  it.each(['README.md', 'build.sh', 'setup.py'])('leaves the filename %s alone', async (name) => {
    expect(await linkAfterTyping(name)).toBeUndefined()
  })

  it.each([
    ['https://example.com', 'https://example.com'],
    ['www.example.com', 'http://www.example.com'],
  ])('links %s', async (typed, href) => {
    expect(await linkAfterTyping(typed)).toBe(href)
  })

  it('gives a new link the safe attributes an import cannot override', async () => {
    const block = firstBlock(await type('https://example.com '))
    const link = (block?.content?.[0].marks ?? []).find((mark) => mark.type === 'link')
    expect(link?.attrs?.rel).toBe('noopener noreferrer nofollow')
    expect(link?.attrs?.target).toBe('_blank')
  })
})
