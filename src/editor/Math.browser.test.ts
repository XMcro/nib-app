import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { Editor, getSchema } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import '../index.css'
import { compare } from '../lib/compare'
import { markdownToBody } from '../lib/import'
import { toMarkdown } from '../lib/markdown'
import { plainText } from '../lib/text'
import { nibEditor, nibExtensions, textClass } from './extensions'
import { fitSchema } from './fitSchema'

/** Formulas (Math.ts): typed, drawn, changed, and what the rest of Nib makes of them. */

const line = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const text = (value: string): JSONContent => ({ type: 'text', text: value })
const inline = (tex: string): JSONContent => ({ type: 'mathInline', content: [text(tex)] })
const block = (tex: string): JSONContent => ({ type: 'mathBlock', content: tex ? [text(tex)] : [] })

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

function open(content: JSONContent[] = [{ type: 'paragraph' }], { page = false, editable = true } = {}) {
  const element = document.body.appendChild(document.createElement('div'))
  editor = new Editor({ element, ...nibEditor(page), content: { type: 'doc', content }, editable, editorProps: { attributes: { class: textClass(page) } } })
  editor.view.dom.focus()
  return editor
}
/** Without the alignment every paragraph comes out of the editor with. */
const blocks = () => JSON.parse(JSON.stringify(editor!.getJSON().content, (key, value) => (key === 'attrs' && value && 'textAlign' in value ? undefined : value))) as JSONContent[]
const formulas = () => [...editor!.view.dom.querySelectorAll<HTMLElement>('.nib-math')]
const drawn = (formula: HTMLElement) => formula.querySelector<HTMLElement>('.nib-math-drawn')!
const field = (formula: HTMLElement) => formula.querySelector<HTMLInputElement | HTMLTextAreaElement>('.nib-math-source')!
/** Once KaTeX has been fetched and has drawn. */
const settled = () => expect.poll(() => formulas().every((formula) => drawn(formula).querySelector('.katex, .katex-error') !== null), { timeout: 10_000 }).toBe(true)
const type = async (keys: string) => {
  editor!.view.dom.focus()
  await userEvent.keyboard(keys)
}

describe('a formula as it is typed', () => {
  it('is what stands between two dollars, once the second is typed', async () => {
    open()
    await type('Mass is $E = mc^2$ here.')
    expect(blocks()).toEqual([line(text('Mass is '), inline('E = mc^2'), text(' here.'))])
  })

  it.each([
    ['two prices', 'From $20-$30 a day'],
    ['a price and a dollar sign after a space', 'It was $5 and he had $ left'],
    ['a dollar inside a word', 'US$5 and A$7 each'],
    ['dollars with a space inside either', 'a $ x$ and $x $ b'],
  ])('leaves %s as they were typed', async (_, typed) => {
    open()
    await type(typed)
    expect(blocks()).toEqual([line(text(typed))])
  })

  it('takes a formula that opens with a number, and one in brackets', async () => {
    open()
    await type('($3x^2$) and $2+2=4$')
    expect(blocks()).toEqual([line(text('('), inline('3x^2'), text(') and '), inline('2+2=4'))])
  })

  it('goes back to the dollars with one Backspace', async () => {
    open()
    await type('$x^2$')
    expect(blocks()).toEqual([line(inline('x^2'))])
    await type('{Backspace}')
    expect(blocks()).toEqual([line(text('$x^2$'))])
  })

  it('makes a formula on its own lines of two dollars and a space, alone on a line, opened to be written', async () => {
    open()
    await type('$$ ')
    // With a line after it, as it ends the page: there'd be nowhere to go on writing.
    expect(blocks()).toEqual([{ type: 'mathBlock' }, { type: 'paragraph' }])
    await expect.poll(() => document.activeElement === field(formulas()[0])).toBe(true)
    await userEvent.keyboard('\\frac{{a}{{b}{Meta>}{Enter}{/Meta}')
    expect(blocks()[0]).toEqual(block('\\frac{a}{b}'))
    // And the writing has the keys again, on that line.
    expect(editor!.view.hasFocus()).toBe(true)
    await type('after')
    expect(blocks()).toEqual([block('\\frac{a}{b}'), line(text('after'))])
  })

  it('shows all of a long formula’s LaTeX in its field, wrapped as a phone wraps it, and each new line', async () => {
    const long = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} + \\sum_{i=1}^{n} \\frac{a_i + b_i}{c_i} + \\int_0^1 f(t)\\,dt'
    open([block(long), { type: 'paragraph' }])
    editor!.view.dom.style.width = '320px'
    formulas()[0].dispatchEvent(new Event('nibmathopen'))
    const source = field(formulas()[0])
    await expect.poll(() => document.activeElement === source).toBe(true)
    const wrapped = source.clientHeight
    expect(source.scrollHeight).toBeLessThanOrEqual(wrapped)
    // More than the one line it would be on a wide page.
    expect(wrapped).toBeGreaterThan(2.5 * parseFloat(getComputedStyle(source).lineHeight))
    await userEvent.keyboard('{ArrowRight}{Enter}y = 1')
    expect(source.clientHeight).toBeGreaterThan(wrapped)
    expect(source.scrollHeight).toBeLessThanOrEqual(source.clientHeight)
  })

  it('adds no line after a formula made above other writing', async () => {
    open([{ type: 'paragraph' }, line(text('below'))])
    editor!.commands.focus('start')
    await type('$$ ')
    expect(blocks()).toEqual([{ type: 'mathBlock' }, line(text('below'))])
  })

  it('leaves two dollars in the middle of a line alone', async () => {
    open()
    await type('cost $$ ')
    expect(blocks()).toEqual([line(text('cost $$ '))])
  })
})

describe('a formula drawn', () => {
  it('is drawn by KaTeX, in a line and on its own lines, with no LaTeX left showing', async () => {
    open([line(text('So '), inline('x^2'), text('.')), block('\\int_0^1 x\\,dx')])
    await settled()
    const [small, large] = formulas()
    expect(small.tagName).toBe('SPAN')
    expect(large.tagName).toBe('DIV')
    expect(drawn(small).querySelector('.katex-html')).not.toBeNull()
    expect(drawn(large).querySelector('.katex-display')).not.toBeNull()
    expect(getComputedStyle(field(small)).display).toBe('none')
    // KaTeX's own styles came with it: its screen-reader copy is out of sight, not doubled on the page.
    expect(getComputedStyle(drawn(small).querySelector('.katex-mathml')!).position).toBe('absolute')
    // And its fonts.
    expect(getComputedStyle(drawn(small).querySelector('.katex')!).fontFamily).toContain('KaTeX_Main')
  })

  it('shows what KaTeX can’t read as written, marked, and doesn’t stop the page', async () => {
    open([line(inline('\\frac{a'), text(' and '), inline('b_1'))])
    await settled()
    const [wrong, right] = formulas()
    expect(drawn(wrong).querySelector('.katex-error')?.textContent).toBe('\\frac{a')
    expect(drawn(right).querySelector('.katex-html')).not.toBeNull()
  })

  it('runs nothing a formula asks for', async () => {
    open([line(inline('\\href{javascript:window.hacked=1}{x} \\htmlData{a=b}{y}'))])
    await settled()
    expect(drawn(formulas()[0]).querySelector('a, [data-a]')).toBeNull()
    expect((window as { hacked?: number }).hacked).toBeUndefined()
  })

  it('draws chemistry, typed between dollars as any formula is', async () => {
    open()
    await type('Water: $\\ce{{2H2 + O2 -> 2H2O}$ at $\\pu{{25 kJ//mol}$')
    expect(blocks()).toEqual([line(text('Water: '), inline('\\ce{2H2 + O2 -> 2H2O}'), text(' at '), inline('\\pu{25 kJ//mol}'))])
    await settled()
    const [reaction, amount] = formulas()
    expect(reaction.querySelector('.katex-error')).toBeNull()
    expect(amount.querySelector('.katex-error')).toBeNull()
    // Subscripts KaTeX's chemistry made of the plain 2s, and its arrow.
    expect(drawn(reaction).querySelectorAll('.katex-html .msupsub').length).toBeGreaterThanOrEqual(3)
    expect(drawn(reaction).querySelector('.katex-mathml annotation')!.textContent).toBe('\\ce{2H2 + O2 -> 2H2O}')
    expect(drawn(amount).textContent).toContain('kJ')
  })

  it('leaves as written chemistry longer than anyone writes, and braces deeper than KaTeX goes', async () => {
    const long = `\\ce{${'A^'.repeat(600)}}`
    const deep = `${'{'.repeat(20_000)}x${'}'.repeat(20_000)}`
    open([line(inline(long)), line(inline(deep)), line(inline('x^2'))])
    const [first, second, third] = formulas()
    await expect.poll(() => drawn(third).querySelector('.katex-html') !== null, { timeout: 10_000 }).toBe(true)
    expect(drawn(first).textContent).toBe(long)
    expect(drawn(first).querySelector('.katex')).toBeNull()
    expect(drawn(second).textContent).toBe(deep)
  })
})

describe('changing a formula', () => {
  it('opens its LaTeX in a field on a click, and Return puts it back, as one change to undo', async () => {
    const page = open([line(text('So '), inline('x^2'), text('.'))])
    await settled()
    await userEvent.click(drawn(formulas()[0]))
    const input = field(formulas()[0])
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('x^2')
    // All of it chosen, so what's typed takes its place.
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3])
    await userEvent.keyboard('y^3{Enter}')
    expect(blocks()).toEqual([line(text('So '), inline('y^3'), text('.'))])
    expect(page.view.hasFocus()).toBe(true)
    // The caret is after it, in the writing.
    await userEvent.keyboard('!')
    expect(blocks()).toEqual([line(text('So '), inline('y^3'), text('!.'))])
    page.commands.undo()
    page.commands.undo()
    expect(blocks()).toEqual([line(text('So '), inline('x^2'), text('.'))])
  })

  it('redraws a formula on its own lines as it is typed, and keeps it when the field is left', async () => {
    open([block('a'), line(text('After.'))])
    await settled()
    await userEvent.click(drawn(formulas()[0]))
    await userEvent.keyboard('b^2')
    // Drawn above the field, from what is in it, before anything is saved.
    await expect.poll(() => drawn(formulas()[0]).querySelector('.katex-mathml annotation')?.textContent).toBe('b^2')
    expect(blocks()[0]).toEqual(block('a'))
    await userEvent.click(editor!.view.dom.querySelector('p')!)
    expect(blocks()[0]).toEqual(block('b^2'))
  })

  it('leaves it as it was on Escape', async () => {
    open([line(inline('x^2'))])
    await settled()
    await userEvent.click(drawn(formulas()[0]))
    await userEvent.keyboard('junk{Escape}')
    expect(blocks()).toEqual([line(inline('x^2'))])
    expect(getComputedStyle(field(formulas()[0])).display).toBe('none')
  })

  it('takes a formula emptied out of the page', async () => {
    open([line(text('So '), inline('x^2'), text('.'))])
    await settled()
    await userEvent.click(drawn(formulas()[0]))
    await userEvent.keyboard('{Backspace}{Enter}')
    expect(blocks()).toEqual([line(text('So .'))])
  })

  it('opens with Return when it has been chosen with the keys', async () => {
    const page = open([block('a'), line(text('After.'))])
    await settled()
    page.commands.setNodeSelection(0)
    await type('{Enter}')
    await expect.poll(() => document.activeElement === field(formulas()[0])).toBe(true)
  })

  it('doesn’t open where the page is only to be read', async () => {
    open([line(inline('x^2'))], { editable: false })
    await settled()
    await userEvent.click(drawn(formulas()[0]))
    expect(getComputedStyle(field(formulas()[0])).display).toBe('none')
  })
})

describe('a formula in the rest of Nib', () => {
  const body: JSONContent = { type: 'doc', content: [line(text('So '), inline('x_1 * y'), text('.')), block('a\\\\b')] }

  it('goes to Markdown between dollars, its LaTeX untouched', () => {
    expect(toMarkdown(body)).toBe('So $x_1 * y$.\n\n$$\na\\\\b\n$$')
  })

  it('reads as its LaTeX in a line, for a title or a search', () => {
    expect(plainText(body)).toBe('So x_1 * y.\na\\\\b')
  })

  it('is compared as one thing, by its LaTeX', () => {
    const changed: JSONContent = { type: 'doc', content: [line(text('So '), inline('x_2 * y'), text('.')), block('a\\\\c')] }
    const parts = compare(body, changed).filter((part) => part.kind !== 'same')
    expect(parts).toHaveLength(2)
    expect(JSON.stringify(parts)).toContain('x_2 * y')
    expect(JSON.stringify(parts)).toContain('a\\\\\\\\c')
  })

  it('shows as its LaTeX on a Nib from before formulas, with nothing lost', () => {
    const old = getSchema(nibExtensions(true).filter((extension) => !extension.name.startsWith('math')))
    expect(fitSchema(body, old).content).toEqual([line(text('So '), text('x_1 * y'), text('.')), line(text('a\\\\b'))])
  })

  describe('read from Markdown', () => {
    const read = (markdown: string) => markdownToBody(markdown, 'note').content

    it('comes back from what Nib wrote, its LaTeX as it was', () => {
      const markdown = toMarkdown(body)
      expect(read(markdown)).toEqual(body.content)
      expect(toMarkdown({ type: 'doc', content: read(markdown) })).toBe(markdown)
    })

    it('keeps the underscores and stars of a formula out of emphasis', () => {
      expect(read('Let $a_i * b_i$ and $c_j * d_j$ be.')).toEqual([line(text('Let '), inline('a_i * b_i'), text(' and '), inline('c_j * d_j'), text(' be.'))])
    })

    it('reads one that follows bold, a link or a single letter', () => {
      const types = (markdown: string) => read(markdown)![0].content!.map((child) => child.type)
      expect(types('**So** $x^2$ is')).toEqual(['text', 'text', 'mathInline', 'text'])
      expect(types('[a link](https://example.com) $x^2$')).toEqual(['text', 'text', 'mathInline'])
      expect(types('a $x^2$')).toEqual(['text', 'mathInline'])
      expect(types('$x^2$ first, ($y$) in brackets')).toEqual(['mathInline', 'text', 'mathInline', 'text'])
    })

    it('reads chemistry’s arrows as the formula’s, not as markup', () => {
      const markdown = 'Carbonic acid: $\\ce{CO2 + H2O <=> H2CO3}$ and $\\ce{A <- B}$.'
      const body = markdownToBody(markdown, 'note')
      expect(body.content).toEqual([line(text('Carbonic acid: '), inline('\\ce{CO2 + H2O <=> H2CO3}'), text(' and '), inline('\\ce{A <- B}'), text('.'))])
      expect(toMarkdown(body)).toBe(markdown)
    })

    it('takes a formula on its own lines, on one line or several, and in a list', () => {
      expect(read('$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$')).toEqual([block('\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}')])
      expect(read('Before\n\n$$E = mc^2$$\n\nAfter')).toEqual([line(text('Before')), block('E = mc^2'), line(text('After'))])
      expect(read('- $x^2$ first')![0].content![0].content![0]).toEqual(line(inline('x^2'), text(' first')))
    })

    it.each([
      ['two prices', 'From $20-$30 a day'],
      ['a price and a later dollar', 'It was $5 and he had $ left, or $6'],
      ['dollars in words', 'US$5 and A$7$ each'],
      ['an escaped dollar', 'Not \\$x^2\\$ at all'],
    ])('leaves %s as words', (_, markdown) => {
      const [paragraph] = read(markdown)!
      expect(paragraph.content!.every((child) => child.type === 'text')).toBe(true)
      expect(plainText({ type: 'doc', content: [paragraph] })).toBe(markdown.replace(/\\\$/g, '$'))
    })

    it('leaves dollars in code as code', () => {
      expect(JSON.stringify(read('`$x^2$` and\n\n```\n$$\ny\n$$\n```'))).not.toContain('math')
    })

    it('doesn’t take everything between two stray pairs of dollars for a formula', () => {
      const found = read('$$ is what a formula starts with.\n\nA paragraph between.\n\nAnd $$ ends one.')!
      expect(found.map((node) => node.type)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    })
  })

  it('is copied and pasted as itself', () => {
    const page = open([line(text('So '), inline('x^2'), text('.')), block('a')])
    const html = page.getHTML()
    expect(html).toContain('<span data-math="">x^2</span>')
    expect(html).toContain('<div data-math="">a</div>')
    page.commands.setContent(html)
    expect(blocks()).toEqual([line(text('So '), inline('x^2'), text('.')), block('a')])
  })
})
