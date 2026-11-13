import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import '../index.css'
import { markdownToBody } from '../lib/import'
import { nibEditor, textClass } from './extensions'
import { formatById, formatsFor } from './formats'

const LEVELS: [string, number][] = [['format-heading-four', 4], ['format-heading-five', 5], ['format-heading-six', 6]]

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

function open(content: string, page = true) {
  const element = document.body.appendChild(document.createElement('div'))
  editor = new Editor({ element, ...nibEditor(page), content, editorProps: { attributes: { class: textClass(page) } } })
  return editor
}
const first = (): JSONContent => (editor!.getJSON().content ?? [])[0]
const size = (selector: string) => parseFloat(getComputedStyle(editor!.view.dom.querySelector(selector)!).fontSize)

describe('six heading levels', () => {
  it.each(LEVELS)('%s turns a line into that heading, says so, and turns it back', (id, level) => {
    open('<p>a line</p>').commands.setTextSelection(2)
    formatById(id)!.run(editor!)
    expect(first()).toMatchObject({ type: 'heading', attrs: { level } })
    expect(editor!.view.dom.querySelector(`h${level}`)?.textContent).toBe('a line')
    expect(formatById(id)!.active(editor!)).toBe(true)
    expect(formatById(id)!.keys).toContain(String(level))
    formatById(id)!.run(editor!)
    expect(first().type).toBe('paragraph')
  })

  it('makes a heading of each from its hashes as they’re typed', () => {
    for (const level of [4, 5, 6]) {
      open('<p></p>').commands.focus('start')
      const hashes = '#'.repeat(level)
      editor!.view.dispatch(editor!.state.tr.insertText(hashes))
      const { from } = editor!.state.selection
      editor!.view.someProp('handleTextInput', (run) => run(editor!.view, from, from, ' ', () => editor!.state.tr.insertText(' ', from, from)))
      expect(first()).toMatchObject({ type: 'heading', attrs: { level } })
      editor!.destroy()
    }
    editor = undefined
  })

  it('offers them in a page only, and a note reads one as a paragraph', () => {
    for (const [id] of LEVELS) {
      expect(formatsFor(true).some((format) => format.id === id)).toBe(true)
      expect(formatsFor(false).some((format) => format.id === id)).toBe(false)
    }
    open('<h5>a line</h5>', false)
    expect(first().type).toBe('paragraph')
  })

  it('steps down from the subheading, and stays readable', () => {
    open('<h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6>')
    expect(size('h3')).toBeGreaterThan(size('h4'))
    expect(size('h4')).toBeGreaterThan(size('h5'))
    expect(size('h6')).toBeGreaterThanOrEqual(16)
    const [five, six] = [...editor!.view.dom.querySelectorAll('h5, h6')].map((heading) => getComputedStyle(heading).color)
    expect(five).not.toBe(six)
  })

  it('grows and shrinks with the text size setting', () => {
    const root = document.documentElement
    root.dataset.size = 'test'
    root.style.setProperty('--nib-scale', '1.5')
    try {
      open('<h4>4</h4><h5>5</h5><h6>6</h6>')
      expect([size('h4'), size('h5'), size('h6')]).toEqual([25.5, 24, 24])
    } finally {
      delete root.dataset.size
      root.style.removeProperty('--nib-scale')
    }
  })

  it('gives each the room above it a heading has', () => {
    open('<p>a</p><h6>6</h6>')
    expect(getComputedStyle(editor!.view.dom.querySelector('h6')!).marginTop).toBe('26px')
  })

  it('never goes under 16 points on a touch screen, whatever the text size', () => {
    const sheet = [...document.styleSheets].flatMap((one) => [...one.cssRules]).filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText.includes('pointer: coarse'))
    const rules = sheet.flatMap((media) => [...media.cssRules]).map((rule) => (rule as CSSStyleRule).cssText)
    expect(rules.some((rule) => rule.includes('h4') && rule.includes('max(16px'))).toBe(true)
    expect(rules.some((rule) => rule.includes('h5') && rule.includes('h6') && rule.includes('max(16px'))).toBe(true)
  })

  it('brings the deeper Markdown headings in as headings, in a page', () => {
    expect(markdownToBody('#### Four\n\n##### Five\n\n###### Six', 'page').content?.map((block) => block.attrs?.level)).toEqual([4, 5, 6])
    expect(markdownToBody('#### Four', 'note').content?.[0].type).toBe('paragraph')
  })
})
