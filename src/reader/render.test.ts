// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderDocument, safeHref } from './render'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const doc = (...content: unknown[]) => ({ type: 'doc', content })
const para = (...content: unknown[]) => ({ type: 'paragraph', content })

function draw(body: unknown) {
  const into = document.createElement('article')
  renderDocument(body, into)
  return into
}

describe('the reader’s renderer', () => {
  // One element per mark, however many were listed: 15,000 bold marks on one
  // word nested 15,000 elements deep, and every reader's tab crashed laying it out.
  it('draws each kind of mark once on a piece of text', () => {
    const out = draw(doc(para(text('loud', [...Array.from({ length: 2000 }, () => ({ type: 'bold' })), { type: 'italic' }, { type: 'italic' }]))))
    expect(out.querySelectorAll('strong')).toHaveLength(1)
    expect(out.querySelectorAll('em')).toHaveLength(1)
    expect(out.querySelector('strong > em')?.textContent).toBe('loud')
  })

  it('draws a callout open, of its kind, and of no kind it doesn’t know', () => {
    const callout = (kind: unknown, collapsed: boolean) => ({ type: 'callout', attrs: { kind, collapsed }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Words' }] }] })
    const out = draw({ type: 'doc', content: [callout('warning', true), callout('x" onclick="y', false)] })
    const boxes = [...out.querySelectorAll<HTMLElement>('div[data-callout]')]
    expect(boxes.map((box) => box.dataset.callout)).toEqual(['warning', 'note'])
    expect(boxes[0].textContent).toBe('Words')
    expect(boxes[0].querySelector('p')?.textContent).toBe('Words')
    expect(boxes[1].hasAttribute('onclick')).toBe(false)
  })

  it('draws all six heading levels, and a second-level one for any other', () => {
    const heading = (level: unknown) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: 'x' }] })
    const out = draw({ type: 'doc', content: [4, 5, 6, 7, 0, '4'].map(heading) })
    expect([...out.children].map((element) => element.tagName)).toEqual(['H4', 'H5', 'H6', 'H2', 'H2', 'H2'])
  })

  it('sits a line where the writer put it, and takes no other style from the body', () => {
    const line = (type: string, textAlign: unknown, attrs = {}) => ({ type, attrs: { ...attrs, textAlign }, content: [{ type: 'text', text: 'x' }] })
    const out = draw({ type: 'doc', content: [line('paragraph', 'center'), line('heading', 'right', { level: 2 }), line('paragraph', 'center; color: red'), line('paragraph', 'end'), line('paragraph', null)] })
    expect([...out.querySelectorAll<HTMLElement>('h2, p')].map((element) => element.style.textAlign)).toEqual(['center', 'right', '', '', ''])
  })

  it('leaves each line to take its direction from its words, as the editor does', () => {
    const out = draw(doc({ type: 'heading', attrs: { level: 1 }, content: [text('عنوان')] }, para(text('نص')), { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('בעברית'))] }] }, { type: 'table', content: [] }))
    for (const element of out.querySelectorAll('h1, p')) expect(element.getAttribute('dir')).toBe('auto')
    expect(out.querySelector('ul')?.hasAttribute('dir')).toBe(false)
  })

  it('draws Nib’s nodes and marks', () => {
    const out = draw(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [text('Chapter one')] },
        para(text('bold', [{ type: 'bold' }]), text(' and '), text('marked', [{ type: 'highlight' }, { type: 'underline' }])),
        { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('a point'))] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para(text('done'))] }] },
        { type: 'codeBlock', content: [text('let x = 1')] },
        { type: 'blockquote', content: [para(text('said'))] },
      ),
    )
    expect(out.querySelector('h1')?.textContent).toBe('Chapter one')
    expect(out.querySelector('strong')?.textContent).toBe('bold')
    expect(out.querySelector('mark > u')?.textContent).toBe('marked')
    expect(out.querySelector('ul > li > p')?.textContent).toBe('a point')
    expect(out.querySelector<HTMLInputElement>('li.task input')?.checked).toBe(true)
    expect(out.querySelector('pre > code')?.textContent).toBe('let x = 1')
    expect(out.querySelector('blockquote p')?.textContent).toBe('said')
  })

  it('never parses text as markup', () => {
    const out = draw(doc(para(text('<img src=x onerror=alert(1)><script>alert(1)</script>'))))
    expect(out.querySelector('img, script')).toBeNull()
    expect(out.textContent).toBe('<img src=x onerror=alert(1)><script>alert(1)</script>')
  })

  it('follows only http, https and mailto links, never as the opener or referrer', () => {
    const out = draw(
      doc(
        para(
          text('ok', [{ type: 'link', attrs: { href: 'https://example.com/a' } }]),
          text('bad', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
          text('data', [{ type: 'link', attrs: { href: 'data:text/html,<script>' } }]),
        ),
      ),
    )
    const links = out.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('https://example.com/a')
    expect(links[0].rel).toBe('noopener noreferrer nofollow')
    expect(out.textContent).toBe('okbaddata')
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c')
  })

  it('says a picture’s size when it’s one Nib knows, and nothing of any other', () => {
    const sizes = ['medium', 'huge', 300, '50%" onload="x', undefined]
    const out = draw(doc(para(...sizes.map((size) => ({ type: 'image', attrs: { src: PNG, alt: '', size } })))))
    expect([...out.querySelectorAll('img')].map((image) => image.getAttribute('data-size'))).toEqual(['medium', null, null, null, null])
    expect(out.querySelector('img')!.getAttributeNames().sort()).toEqual(['alt', 'data-size', 'src'])
  })

  it('shows only images Nib allows: inline data, never remote or SVG', () => {
    const out = draw(
      doc(
        para(
          { type: 'image', attrs: { src: PNG, alt: 'a picture' } },
          { type: 'image', attrs: { src: 'https://tracker.example/pixel.png' } },
          { type: 'image', attrs: { src: 'data:image/svg+xml;base64,PHN2Zz4=' } },
        ),
      ),
    )
    const images = out.querySelectorAll('img')
    expect(images).toHaveLength(1)
    expect(images[0].getAttribute('src')).toBe(PNG)
    expect(images[0].alt).toBe('a picture')
  })

  it('unwraps nodes it doesn’t know to their text, and ignores attributes it doesn’t use', () => {
    const out = draw(doc({ type: 'iframe', attrs: { src: 'https://evil.example' }, content: [para(text('kept'))] }, { type: 'paragraph', attrs: { onclick: 'alert(1)', style: 'x' }, content: [text('plain')] }))
    expect(out.querySelector('iframe')).toBeNull()
    expect(out.innerHTML).not.toMatch(/onclick|style=/)
    expect(out.textContent).toBe('keptplain')
  })

  it('survives garbage and absurd nesting', () => {
    expect(draw(null).childElementCount).toBe(0)
    expect(draw({ type: 'doc', content: 'not a list' }).childElementCount).toBe(0)
    let deep: unknown = para(text('bottom'))
    for (let i = 0; i < 5000; i++) deep = { type: 'blockquote', content: [deep] }
    expect(() => draw(doc(deep))).not.toThrow()
  })

  // A type named for one of Object's own properties found it, not a tag, and threw.
  it('survives nodes and marks named for Object’s own properties, and deep nesting inside a line', () => {
    const odd = doc(
      para(text('marked', [{ type: 'constructor' }, { type: '__proto__' }, { type: 'toString' }])),
      { type: 'constructor', content: [para(text('kept'))] },
      { type: '__proto__', content: [para(text('kept too'))] },
    )
    expect(() => draw(odd)).not.toThrow()
    expect(draw(odd).textContent).toBe('markedkeptkept too')
    let deep: unknown = text('bottom')
    for (let i = 0; i < 5000; i++) deep = { type: 'mystery', content: [deep] }
    expect(() => draw(doc(para(deep)))).not.toThrow()
  })

  it('shows a formula as its LaTeX at once, then drawn as MathML, with nothing a formula asks for done', async () => {
    const out = draw(doc(para(text('So '), { type: 'mathInline', content: [text('x^2')] }, text('.')), { type: 'mathBlock', content: [text('\\frac{a}{b}')] }, para({ type: 'mathInline', content: [text('\\frac{a')] }, { type: 'mathInline', content: [text('\\href{javascript:alert(1)}{x}')] })))
    // Before KaTeX is here: nothing lost.
    expect(out.querySelector('p')!.textContent).toBe('So x^2.')
    await vi.waitFor(() => expect(out.querySelectorAll('math')).toHaveLength(3))
    const [inLine, onItsOwn] = out.querySelectorAll('math')
    expect(inLine.closest('span.math')).not.toBeNull()
    expect(inLine.querySelector('annotation')!.textContent).toBe('x^2')
    expect(onItsOwn.closest('div.math')).not.toBeNull()
    expect(onItsOwn.getAttribute('display')).toBe('block')
    // No markup of KaTeX's own drawing, which the page's policy would refuse the styles of.
    expect(out.querySelector('.katex-html, [style]')).toBeNull()
    // What KaTeX can't read stays as written; and a link a stranger's formula asks for is no link, only its words.
    const [unread, asked] = out.querySelectorAll('p:last-of-type span.math')
    expect(unread.textContent).toBe('\\frac{a')
    expect(unread.querySelector('math')).toBeNull()
    expect(asked.querySelector('math')).not.toBeNull()
    expect(out.querySelector('a, [href]')).toBeNull()
  })

  // KaTeX's chemistry takes the square of a formula's length to read it, and the draft is a stranger's.
  it('draws chemistry, but not a formula of it longer than anyone writes, nor more of it than a draft has', async () => {
    const formula = (tex: string) => para({ type: 'mathInline', content: [text(tex)] })
    const long = `\\ce{${'A'.repeat(1200)}}`
    const full = `\\ce{${'A'.repeat(985)}}`
    const out = draw(doc(formula('\\ce{2H2 + O2 -> 2H2O}'), formula(long), ...Array.from({ length: 21 }, () => formula(full)), formula('x^2')))
    const formulas = [...out.querySelectorAll('span.math')]
    // The reaction, twenty of the 990 characters, and the formula that isn't chemistry: the 21st would have passed 20,000.
    await vi.waitFor(() => expect(out.querySelectorAll('math')).toHaveLength(22))
    expect(formulas[0].querySelectorAll('msub, msubsup').length).toBeGreaterThanOrEqual(3)
    // Nothing held at no height, which WebKit doesn't show (lib/mathml): H2O read "H O".
    expect(formulas[0].querySelector('msub > mn')!.textContent).toBe('2')
    expect(out.querySelector('mpadded[height="0px"], mpadded[width^="+"]')).toBeNull()
    expect(formulas[1].textContent).toBe(long)
    expect(formulas[21].querySelector('math')).not.toBeNull()
    expect(formulas[22].textContent).toBe(full)
    expect(formulas[23].querySelector('math')).not.toBeNull()
  })

  // Following one set `#fn-1` where the link's key was: reloaded, or copied
  // from the address bar, the link then said "This link is incomplete".
  it('goes to a footnote and back without touching the address', () => {
    const out = draw(doc(para(text('A claim'), { type: 'footnote', attrs: { text: 'Pevensie 1950' } })))
    document.body.append(out)
    const scrolled: string[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
    const before = location.href
    out.querySelector<HTMLAnchorElement>('sup a')!.click()
    out.querySelector<HTMLAnchorElement>('section.footnotes a')!.click()
    expect(location.href).toBe(before)
    expect(scrolled).toEqual(['fn-1', 'fnref-1'])
    out.remove()
  })

  it('numbers footnotes and lists them at the end, where a touch screen can reach them', () => {
    const out = draw(doc(para(text('A claim'), { type: 'footnote', attrs: { text: 'Pevensie 1950' } }, text(' and another'), { type: 'footnote', attrs: { text: '<b>not bold</b>' } })))
    expect([...out.querySelectorAll('sup a')].map((a) => a.textContent)).toEqual(['1', '2'])
    const notes = out.querySelectorAll('section.footnotes li')
    expect(notes[0].id).toBe('fn-1')
    expect(notes[0].textContent).toBe('Pevensie 1950 ↩')
    expect(notes[1].querySelector('b')).toBeNull()
  })

  it('draws a page’s table, with spans only as plain small numbers', () => {
    const cell = (type: string, value: string, attrs: Record<string, unknown> = {}) => ({ type, attrs, content: [para(text(value))] })
    const out = draw(
      doc({
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('tableHeader', 'Leaves'), cell('tableHeader', 'From')] },
          { type: 'tableRow', content: [cell('tableCell', '07:40', { colspan: 2, rowspan: '3" onclick="x' })] },
          { type: 'tableRow', content: [cell('tableCell', 'big', { colspan: 5000 })] },
        ],
      }),
    )
    expect([...out.querySelectorAll('table > tr > th')].map((th) => th.textContent)).toEqual(['Leaves', 'From'])
    const [spanned, huge] = out.querySelectorAll('td')
    expect(spanned.getAttribute('colspan')).toBe('2')
    expect(spanned.hasAttribute('rowspan')).toBe(false)
    expect(huge.hasAttribute('colspan')).toBe(false)
  })
})
