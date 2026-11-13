import { describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import JSZip from 'jszip'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import { bookFilename, compileDocx, compileHtml, documentFilename, toDocx, toHtml } from './documentExport'
import { compileEpub } from './epub'
import { zipOf } from './exportMany'
import { setLinkable } from './links'
import { mathFor } from './math'
import { coloursFor } from '../editor/codeColours'
import { MOST_COLOURED } from './codeReader'

// Real encodings, made here: a PNG, and a WebP, which Word cannot show.
function encoded(type: string, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 1
  const context = canvas.getContext('2d')!
  context.fillStyle = color
  context.fillRect(0, 0, 2, 1)
  return canvas.toDataURL(type)
}
const PNG = encoded('image/png', '#c00')
/** That picture as a JPEG, its EXIF saying where it was taken. */
function jpegWithExif() {
  const base = atob(encoded('image/jpeg', '#c00').split(',')[1])
  const exif = 'Exif\0\0GPS 51.5'
  return `data:image/jpeg;base64,${btoa(`${base.slice(0, 2)}\xff\xe1\x00${String.fromCharCode(exif.length + 2)}${exif}${base.slice(2)}`)}`
}
const WEBP = encoded('image/webp', '#00c')

const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })

const page = (content: JSONContent[]): Item => ({
  id: 'x',
  kind: 'page',
  body: { type: 'doc', content },
  createdAt: 1,
  updatedAt: 1,
  version: 1,
})

const SAMPLE = page([
  { type: 'heading', attrs: { level: 1 }, content: [text('The <Lighthouse> & Keeper')] },
  p(text('Plain, '), text('bold', [{ type: 'bold' }]), text(', a '), text('link', [{ type: 'link', attrs: { href: 'https://example.com' } }]), text('.'), { type: 'footnote', attrs: { text: 'A note at the bottom.' } }),
  { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('Outer')), { type: 'orderedList', content: [{ type: 'listItem', content: [p(text('Inner'))] }] }] }] },
  { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(text('Done'))] }] },
  { type: 'blockquote', content: [p(text('Quoted'))] },
  { type: 'codeBlock', content: [text('line one\nline two')] },
  p({ type: 'image', attrs: { src: PNG } }, { type: 'image', attrs: { src: WEBP } }),
])

describe('toHtml', () => {
  it('is a standalone page with the document in it', () => {
    const html = toHtml(SAMPLE)
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<title>The &lt;Lighthouse&gt; &amp; Keeper</title>')
    expect(html).toContain('<h1 dir="auto">The &lt;Lighthouse&gt; &amp; Keeper</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('line one\nline two')
    expect(html).toContain(`src="${PNG}"`)
  })

  // A cell's stored width went into the table's style as it was, so a
  // string there wrote CSS: a background image fetched from anywhere when the
  // file was opened, or the PDF made.
  it('takes only numbers for a table’s column widths', () => {
    const cell = (colwidth: unknown): JSONContent => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth }, content: [p(text('x'))] })
    const html = toHtml(page([{ type: 'table', content: [{ type: 'tableRow', content: [cell(['1px;background:url(https://tracker.example/x.png);--a:']), cell([120])] }] }]))
    expect(html).not.toContain('tracker.example')
    expect(html).toContain('120px')
  })

  it('numbers footnotes and lists them at the end', () => {
    const html = toHtml(SAMPLE)
    expect(html).toContain('<sup><a href="#note-1" id="ref-1">1</a></sup>')
    expect(html).toMatch(/<ol class="notes"><li id="note-1">A note at the bottom\. <a href="#ref-1">↩<\/a><\/li><\/ol>/)
  })
})

describe('a link to one line of a note', () => {
  it('is a link to the note: none of that line’s words, and no marker on it or on the line it’s in', () => {
    setLinkable([{ ...page([p(text('Trips')), { type: 'paragraph', attrs: { blockId: 'line1234' }, content: [text('Bring a coat.')] }]), id: 'trips' }])
    const html = toHtml(page([{ type: 'paragraph', attrs: { blockId: 'mine1234' }, content: [text('See '), { type: 'noteLink', attrs: { id: 'trips', title: 'Trips', block: 'line1234', part: 'As it was linked' } }] }]))
    setLinkable([])
    expect(html).toContain('Trips')
    for (const kept of ['Bring a coat', 'As it was linked', 'line1234', 'mine1234', 'data-block', 'data-note-part', 'data-note-block', '›']) expect(html).not.toContain(kept)
  })
})

describe('a callout', () => {
  const callout = (kind: string, ...content: JSONContent[]): JSONContent => ({ type: 'callout', attrs: { kind, collapsed: true }, content })

  it('names an attached file in a page and in Word, and brings neither the file nor which one it is', async () => {
    const attached = page([p(text('Minutes')), { type: 'attachment', attrs: { file: { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'application/pdf', size: 2_400_000 }, name: 'Q3 <report>.pdf' } }])
    const html = toHtml(attached)
    expect(html).toMatch(/<div data-name="[^"]*" data-attachment="" class="nib-attachment"><strong>Q3 &lt;report&gt;\.pdf<\/strong> \(attached file, not included\)<\/div>/)
    expect(html).not.toContain('7b0f6f0e')
    expect(html).not.toContain('data-file')
    const xml = await (await JSZip.loadAsync(await toDocx(attached))).file('word/document.xml')!.async('string')
    expect(xml).toContain('Q3 &lt;report&gt;.pdf')
    expect(xml).toContain(' (attached file, not included)')
    expect(xml).not.toContain('7b0f6f0e')
  })

  it('is a box of its kind in HTML, its kind written over it, and open', () => {
    const html = toHtml(page([callout('warning', p(text('Mind the step')))]))
    expect(html).toMatch(/<div data-callout="warning"[^>]*><p dir="auto">Mind the step<\/p><\/div>/)
    expect(html).toContain('[data-callout="warning"]::before { content: "Warning"; color: #a85b00; }')
    expect(html).not.toMatch(/\[data-collapsed\][^{]*\{[^}]*display: none/)
  })

  it('in Word, reads a kind it doesn’t know as a note, and still writes the file', async () => {
    const zip = await JSZip.loadAsync(await toDocx(page([callout('nonsense', p(text('Words')))])))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('>Note<')
    expect(xml).toContain('>Words<')
  })

  it('in Word, has its kind in words over its lines, a rule of its colour down all of them, a list’s too', async () => {
    const list: JSONContent = { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('In a list'))] }] }
    const zip = await JSZip.loadAsync(await toDocx(page([callout('caution', p(text('Mind the step')), list), p(text('After'))])))
    const xml = await zip.file('word/document.xml')!.async('string')
    const paragraphs = xml.match(/<w:p>.*?<\/w:p>/gs)!
    const of = (words: string) => paragraphs.find((one) => one.includes(`>${words}<`))!
    expect(of('Caution')).toContain('<w:b/>')
    expect(of('Caution')).toContain('<w:color w:val="B91C1C"/>')
    for (const words of ['Caution', 'Mind the step', 'In a list']) expect(of(words)).toMatch(/<w:left [^>]*w:color="B91C1C"/)
    expect(of('After')).not.toContain('<w:left')
  })
})

describe('the deeper headings', () => {
  const heading = (level: number, words: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [text(words)] })
  const deep = page([heading(4, 'Four'), heading(5, 'Five'), heading(6, 'Six')])

  it('stay headings in HTML, sized to step down', () => {
    const html = toHtml(deep)
    for (const level of [4, 5, 6]) expect(html).toContain(`<h${level} dir="auto">`)
    for (const rule of ['h4 { font-size', 'h5 { font-size', 'h6 { font-size']) expect(html).toContain(rule)
  })

  it('are Word’s own headings, each with its look', async () => {
    const zip = await JSZip.loadAsync(await toDocx(deep))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml.match(/<w:pStyle w:val="Heading\d"\/>/g)).toEqual(['<w:pStyle w:val="Heading4"/>', '<w:pStyle w:val="Heading5"/>', '<w:pStyle w:val="Heading6"/>'])
    const styles = await zip.file('word/styles.xml')!.async('string')
    for (const level of [4, 5, 6]) expect(styles).toContain(`w:styleId="Heading${level}"`)
    const look = (level: number) => new RegExp(`w:styleId="Heading${level}".*?</w:style>`, 's').exec(styles)![0]
    expect(look(4)).toContain('<w:sz w:val="24"/>')
    expect(look(5)).toContain('<w:sz w:val="22"/>')
    expect(look(6)).toContain('<w:sz w:val="20"/>')
  })
})

describe('a formula', () => {
  const formulas = page([p(text('So '), { type: 'mathInline', content: [text('x^2 < y')] }, text('.')), { type: 'mathBlock', content: [text('\\frac{a}{b}')] }])

  it('goes to Word as its LaTeX, in a line and on its own', async () => {
    const xml = await (await JSZip.loadAsync(await toDocx(formulas))).file('word/document.xml')!.async('string')
    expect(xml).toContain('x^2 &lt; y')
    expect(xml).toContain('\\frac{a}{b}')
  })

  // In this order: KaTeX, once fetched, stays for the rest of the file.
  it('goes to HTML as its LaTeX if KaTeX hasn’t been fetched for it', () => {
    const html = toHtml(formulas)
    expect(html).toContain('<span data-math="">x^2 &lt; y</span>')
    expect(html).toContain('<div data-math="">\\frac{a}{b}</div>')
  })

  it('goes to HTML, which the PDF is printed from, as MathML, once it has: drawn by the browser with no styles or fonts of KaTeX’s', async () => {
    await mathFor([formulas.body])
    const html = toHtml(formulas)
    const page = new DOMParser().parseFromString(html, 'text/html')
    const [inLine, onItsOwn] = page.querySelectorAll('[data-math] math')
    expect(inLine.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML')
    expect(inLine.closest('p')!.textContent).toContain('So ')
    expect(inLine.getAttribute('display')).toBeNull()
    expect(onItsOwn.getAttribute('display')).toBe('block')
    expect(onItsOwn.querySelector('mfrac')).not.toBeNull()
    // Its LaTeX is still in it, as MathML's own note of where it came from.
    expect(inLine.querySelector('annotation')!.textContent).toBe('x^2 < y')
    expect(html).not.toContain('katex-html')
    expect(html).not.toContain('style="')
  })

  it('leaves one KaTeX can’t read as its LaTeX, and draws the rest', async () => {
    await mathFor([formulas.body])
    const html = toHtml(page([p({ type: 'mathInline', content: [text('\\frac{a')] }, text(' and '), { type: 'mathInline', content: [text('b_1')] })]))
    expect(html).toContain('<span data-math="">\\frac{a</span>')
    expect(html).toContain('<msub>')
  })

  it('draws chemistry too, and leaves as its LaTeX chemistry longer than anyone writes', async () => {
    const long = `\\ce{${'A^'.repeat(600)}}`
    const chemistry = page([p({ type: 'mathInline', content: [text('\\ce{2H2 + O2 -> 2H2O}')] }, text(' and '), { type: 'mathInline', content: [text(long)] })])
    await mathFor([chemistry.body])
    const html = toHtml(chemistry)
    const drawn = new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[data-math] math')
    expect(drawn).toHaveLength(1)
    expect(drawn[0].querySelector('annotation')!.textContent).toBe('\\ce{2H2 + O2 -> 2H2O}')
    // The plain 2s are subscripts now.
    expect(drawn[0].querySelectorAll('msub, msubsup').length).toBeGreaterThanOrEqual(3)
    expect(html).toContain(`<span data-math="">${long}</span>`)
  })

  // WebKit shows nothing of what KaTeX's MathML holds at no height, which is how its chemistry writes every small number: H2O read "H O".
  it('writes nothing a browser’s own MathML loses: small numbers, an isotope’s, and the words over an arrow', async () => {
    const texts = ['\\ce{H2O}', '\\ce{^{14}_{6}C}', '\\ce{A ->[heat] B}', 'a \\smash[b]{b} \\vphantom{X} c']
    const body = page(texts.map((tex) => p({ type: 'mathInline', content: [text(tex)] })))
    await mathFor([body.body])
    const html = toHtml(body)
    const [water, carbon, heated, plain] = new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[data-math] math > semantics > mrow')
    expect(html).not.toMatch(/<mpadded[^>]*(height="0px"|lspace="-|width="\+)/)
    expect(water.querySelector('msub > mn')!.textContent).toBe('2')
    // Each once to be seen (and once unseen, which keeps their room).
    expect([...carbon.querySelectorAll('mn')].filter((n) => !n.closest('mphantom')).map((n) => n.textContent).sort()).toEqual(['14', '6'])
    expect(heated.querySelector('mover')!.textContent).toContain('heat')
    expect(plain.textContent).toBe('abc')
  })

  it('goes into an e-book as MathML, well-formed, its chapter marked as having some', async () => {
    await mathFor([formulas.body])
    const plain = page([p(text('No formula here.'))])
    const book = await JSZip.loadAsync(await compileEpub('Book', [formulas, plain]).arrayBuffer())
    const chapter = await book.file('OEBPS/chapter-1.xhtml')!.async('string')
    const parsed = new DOMParser().parseFromString(chapter, 'application/xhtml+xml')
    expect(parsed.querySelector('parsererror')).toBeNull()
    expect(parsed.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math')).toHaveLength(2)
    const manifest = await book.file('OEBPS/content.opf')!.async('string')
    expect(manifest).toContain('<item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" properties="mathml"/>')
    expect(manifest).toContain('<item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>')
  })

  it('is drawn in each page of several exported at once, and is LaTeX in their Markdown', async () => {
    const files = unzipSync(new Uint8Array(await (await zipOf([formulas], 'html', () => {})).arrayBuffer()))
    expect(strFromU8(Object.values(files)[0])).toContain('<math')
    const markdown = unzipSync(new Uint8Array(await (await zipOf([formulas], 'md', () => {})).arrayBuffer()))
    expect(strFromU8(Object.values(markdown)[0])).toBe('So $x^2 < y$.\n\n$$\n\\frac{a}{b}\n$$')
  })
})

describe('code in an export', () => {
  const code = (value: string, language?: string): JSONContent => ({ type: 'codeBlock', attrs: { language: language ?? null }, content: [text(value)] })
  const SOURCE = 'const a = "<b>&" // not <i>\nreturn x<y&&1;'
  const written = page([code(SOURCE, 'javascript')])
  const shownCode = (html: string) => new DOMParser().parseFromString(html, 'text/html').querySelector('pre code')!

  it('is in its colours in HTML, which the PDF is printed from, and every character is as written', async () => {
    await coloursFor([written.body])
    const html = toHtml(written)
    expect(html).toContain('<span class="nib-code-keyword">const</span>')
    expect(html).toContain('<span class="nib-code-comment">// not &lt;i&gt;</span>')
    expect(html).toContain('.nib-code-keyword { color: #6d3fd4; }')
    expect(shownCode(html).textContent).toBe(SOURCE)
    expect(shownCode(html).className).toBe('language-javascript')
  })

  it('goes out as it was with no language, none Nib knows, or if it’s too long to colour', async () => {
    const plain = page([code('const a'), code('const a', 'nosuchlanguage'), code('const a\n'.repeat(MOST_COLOURED / 8 + 1), 'javascript')])
    await coloursFor([plain.body])
    expect(toHtml(plain)).not.toContain('<span class="nib-code-')
  })

  it('is left plain if it wasn’t waited for', () => {
    expect(toHtml(page([code('const notWaitedFor', 'javascript')]))).not.toContain('<span class="nib-code-')
  })

  it('is in its colours in Word, a run to each, and each line still its own', async () => {
    const lines = page([code('/* over\ntwo */ const a', 'javascript')])
    await coloursFor([lines.body])
    const xml = await (await JSZip.loadAsync(await toDocx(lines))).file('word/document.xml')!.async('string')
    expect(xml.match(/<w:color w:val="6a6f7a"\/>/g)).toHaveLength(2)
    expect(xml).toMatch(/<w:color w:val="6d3fd4"\/>.*?<w:t[^>]*>const<\/w:t>/)
    expect(xml).not.toMatch(/<w:t[^>]*><\/w:t>/)
    expect([...xml.matchAll(/<w:p>.*?<\/w:p>/g)].map(([one]) => [...one.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(([, words]) => words).join(''))).toEqual(['/* over', 'two */ const a'])
  })

  it('keeps its colours through an export of more blocks than are remembered', async () => {
    const many = page(Array.from({ length: 230 }, (_, index) => code(`const exported${index}`, 'javascript')))
    await coloursFor([many.body])
    expect(toHtml(many).match(/<span class="nib-code-keyword">const<\/span>/g)).toHaveLength(230)
  })

  it('is in its colours in an e-book, which is still well formed', async () => {
    await coloursFor([written.body])
    const files = unzipSync(new Uint8Array(await compileEpub('Book', [written]).arrayBuffer()))
    const chapter = strFromU8(Object.entries(files).find(([name]) => name.endsWith('chapter-1.xhtml') || name.endsWith('chapter1.xhtml'))![1])
    expect(chapter).toContain('<span class="nib-code-keyword">const</span>')
    expect(new DOMParser().parseFromString(chapter, 'application/xhtml+xml').querySelector('parsererror')).toBeNull()
    expect(Object.values(files).map((file) => strFromU8(file)).join('')).toContain('.nib-code-keyword { color: #6d3fd4; }')
  })

  it('is in its colours in each page of several exported at once, and as a fence in their Markdown', async () => {
    // Words no other test here has had read, so nothing has waited for them but this.
    const unread = page([code('const neverReadBefore', 'javascript')])
    const files = unzipSync(new Uint8Array(await (await zipOf([unread], 'html', () => {})).arrayBuffer()))
    expect(strFromU8(Object.values(files)[0])).toContain('<span class="nib-code-keyword">const</span>')
    const markdown = unzipSync(new Uint8Array(await (await zipOf([unread], 'md', () => {})).arrayBuffer()))
    expect(strFromU8(Object.values(markdown)[0])).toBe('```javascript\nconst neverReadBefore\n```')
  })
})

describe('a line with an alignment', () => {
  const wordXml = async (item: Item) => (await JSZip.loadAsync(await toDocx(item))).file('word/document.xml')!.async('string')
  const aligned = (value: string, words: string, type = 'paragraph', attrs = {}): JSONContent => ({ type, attrs: { ...attrs, textAlign: value }, content: [text(words)] })

  it('keeps it in HTML, which the PDF is printed from, and leaves out anything else', () => {
    const html = toHtml(page([aligned('center', 'Middle'), aligned('right', 'Top', 'heading', { level: 1 }), aligned('center; color: red', 'Odd'), p(text('Plain'))]))
    expect(html).toContain('<p dir="auto" style="text-align: center;">Middle</p>')
    expect(html).toContain('<h1 dir="auto" style="text-align: right;">Top</h1>')
    expect(html).toContain('<p dir="auto">Odd</p>')
    expect(html).toContain('<p dir="auto">Plain</p>')
  })

  it('keeps it in Word, on that line only', async () => {
    const xml = await wordXml(page([aligned('center', 'Middle'), aligned('right', 'Side', 'heading', { level: 2 }), aligned('justify', 'Even'), aligned('left', 'Start'), p(text('Plain'))]))
    expect(xml.match(/<w:jc w:val="[a-z]+"\/>/g)).toEqual(['<w:jc w:val="center"/>', '<w:jc w:val="right"/>', '<w:jc w:val="both"/>', '<w:jc w:val="left"/>'])
  })

  it('keeps it on a checklist’s line in Word', async () => {
    const task: JSONContent = { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [aligned('center', 'Do it')] }] }
    expect(await wordXml(page([task]))).toContain('<w:jc w:val="center"/>')
  })

  it('turns left and right round in Word for a line written from the right, as Word does', async () => {
    const xml = await wordXml(page([aligned('left', 'هذا نص'), aligned('right', 'هذا نص آخر')]))
    expect(xml.match(/<w:jc w:val="[a-z]+"\/>/g)).toEqual(['<w:jc w:val="right"/>', '<w:jc w:val="left"/>'])
  })
})

describe('a line written from the right', () => {
  const rightToLeft = page([p(text('هذا نص عربي')), p(text('A line of English.'))])

  it('takes its direction from its words on a page', () => {
    const html = toHtml(rightToLeft)
    expect(html).toContain('<p dir="auto">هذا نص عربي</p>')
    expect(html).toContain('<p dir="auto">A line of English.</p>')
  })

  it('is said to be one in Word, and only it', async () => {
    const zip = await JSZip.loadAsync(await toDocx(rightToLeft))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml.match(/<w:bidi\/>/g)).toHaveLength(1)
    expect(xml.indexOf('<w:bidi/>')).toBeLessThan(xml.indexOf('هذا'))
  })
})

describe('toDocx', () => {
  it('is a Word document carrying the structure, not just the words', async () => {
    const zip = await JSZip.loadAsync(await toDocx(SAMPLE))
    const xml = await zip.file('word/document.xml')!.async('string')

    expect(xml).toContain('w:val="Heading1"')
    expect(xml).toContain('The &lt;Lighthouse&gt; &amp; Keeper')
    expect(xml).toMatch(/<w:b\/>|<w:b w:val="true"\/>/)
    expect(xml).toContain('<w:hyperlink')
    expect(xml).toContain('<w:footnoteReference')
    expect(xml).toContain('☑ ')
    expect(xml).toContain('Menlo')

    // The nested ordered list sits one level below the bullet it belongs to.
    expect(xml).toMatch(/<w:ilvl w:val="0"\/>[\s\S]*Outer[\s\S]*<w:ilvl w:val="1"\/>[\s\S]*Inner/)

    const footnotes = await zip.file('word/footnotes.xml')!.async('string')
    expect(footnotes).toContain('A note at the bottom.')
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string')
    expect(rels).toContain('https://example.com')
  })

  // A stored link the editor would refuse, file: or javascript:, went into the
  // Word file as it was, for whoever opened it to click.
  it('keeps only links the editor allows, leaving the rest as their words', async () => {
    const zip = await JSZip.loadAsync(
      await toDocx(page([p(text('share', [{ type: 'link', attrs: { href: 'file://attacker.example/share/x' } }]), text(' and '), text('run', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))])),
    )
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string')
    expect(rels).not.toContain('attacker.example')
    expect(rels).not.toContain('javascript:')
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).not.toContain('<w:hyperlink')
    expect(xml).toContain('share')
  })

  it('embeds images, turning WebP into PNG because Word cannot open WebP', async () => {
    // Not fetched: the app page's policy lets it fetch Nib's servers alone (lib/csp).
    const fetching = vi.spyOn(globalThis, 'fetch')
    const zip = await JSZip.loadAsync(await toDocx(SAMPLE))
    expect(fetching).not.toHaveBeenCalled()
    fetching.mockRestore()
    const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/') && !zip.files[name].dir)
    expect(media).toHaveLength(2)
    expect(media.every((name) => name.endsWith('.png'))).toBe(true)
  })
})

describe('underline and highlight', () => {
  const STYLED = page([p(text('under', [{ type: 'underline' }]), text(' and '), text('lit', [{ type: 'highlight' }]))])

  it('keep their tags in HTML', () => {
    const html = toHtml(STYLED)
    expect(html).toContain('<u>under</u>')
    expect(html).toContain('<mark>lit</mark>')
  })

  it('become an underline and a yellow highlight in Word', async () => {
    const zip = await JSZip.loadAsync(await toDocx(STYLED))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toMatch(/<w:u w:val="single"\/>[\s\S]*under/)
    expect(xml).toMatch(/<w:highlight w:val="yellow"\/>[\s\S]*lit/)
  })
})

describe('notes to self', () => {
  const NOTE = { type: 'noteToSelf', attrs: { id: 'n1', text: 'Check the tide times.' } }
  const noted = page([p(text('The ferry leaves '), text('at seven', [NOTE]), text(' sharp.'))])
  const unzipped = async (blob: Blob) => {
    const zip = await JSZip.loadAsync(blob)
    return (await Promise.all(Object.values(zip.files).map((file) => file.async('string')))).join('\n')
  }

  it('stay behind in HTML, which the PDF is printed from', () => {
    const html = toHtml(noted)
    expect(html).toContain('<p dir="auto">The ferry leaves at seven sharp.</p>')
    expect(html).not.toMatch(/tide|nib-note-to-self/)
  })

  it('stay behind in Word', async () => {
    const files = await unzipped(await toDocx(noted))
    expect(files).toContain('at seven')
    expect(files).not.toContain('tide')
  })

  it('stay behind in a compiled book', async () => {
    expect(compileHtml('The Harbour', [noted])).not.toContain('tide')
    expect(await unzipped(await compileDocx('The Harbour', [noted]))).not.toContain('tide')
  })
})

describe('a table', () => {
  const cell = (type: string, value: string, attrs = {}) => ({ type, attrs: { colspan: 1, rowspan: 1, ...attrs }, content: [p(text(value))] })
  const table = page([
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', 'Leaves'), cell('tableHeader', 'From')] },
        { type: 'tableRow', content: [cell('tableCell', '07:40', { colspan: 2 })] },
      ],
    },
  ])

  it('becomes a Word table, its header row repeated on each page, a spanned cell kept', async () => {
    const zip = await JSZip.loadAsync(await toDocx(table))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1)
    expect(xml.match(/<w:tr>/g)).toHaveLength(2)
    expect(xml).toContain('<w:tblHeader/>')
    expect(xml).toMatch(/<w:gridSpan w:val="2"\/>[\s\S]*07:40/)
  })
})

describe('a document with formatting this version does not know', () => {
  it('still exports as HTML, with every word', () => {
    const html = toHtml(page([p(text('kept', [{ type: 'sparkle' }]), text(' too'))]))
    expect(html).toContain('<p dir="auto">kept too</p>')
  })
})

describe('documentFilename', () => {
  it('names the file after the title, without characters a file system refuses', () => {
    expect(documentFilename(page([p(text('Notes: a/b? "draft"'))]), 'pdf')).toBe('Notes ab draft.pdf')
    expect(documentFilename(page([]), 'docx')).toBe('Untitled.docx')
  })

  // A name starting with a dot is a hidden file, and the PDF maker
  // (NibPdfPlugin.swift) refuses one: ".NET migration" couldn't be exported.
  it('leaves off dots the title starts with', () => {
    expect(documentFilename(page([p(text('.NET migration'))]), 'pdf')).toBe('NET migration.pdf')
    expect(documentFilename(page([p(text('...'))]), 'pdf')).toBe('Untitled.pdf')
  })
})

describe('a manuscript compiled', () => {
  const chapter = (id: string, content: JSONContent[]): Item => ({ ...page(content), id })
  const one = chapter('one', [p(text('Chapter one')), p(text('The boats came in.'), { type: 'footnote', attrs: { text: 'First note.' } })])
  const two = chapter('two', [p(text('Chapter two')), p(text('It had been a long season.'), { type: 'footnote', attrs: { text: 'Second note.' } })])

  it('is one page of HTML titled for the book, every chapter in order, each from a new page', () => {
    const html = compileHtml('The Harbour', [one, two])
    expect(html).toContain('<title>The Harbour</title>')
    expect(html.match(/<section class="chapter">/g)).toHaveLength(2)
    expect(html.indexOf('Chapter one')).toBeLessThan(html.indexOf('Chapter two'))
    expect(html).toMatch(/\.chapter \+ \.chapter \{ break-before: page; \}/)
  })

  it('numbers footnotes through the whole book, in HTML', () => {
    const html = compileHtml('The Harbour', [one, two])
    expect(html).toContain('<a href="#note-1" id="ref-1">1</a>')
    expect(html).toContain('<a href="#note-2" id="ref-2">2</a>')
    expect(html).toMatch(/<li id="note-1">First note\. [\s\S]*<li id="note-2">Second note\. /)
  })

  it('is one Word file titled for the book, each chapter after the first from a new page, footnotes numbered through', async () => {
    const zip = await JSZip.loadAsync(await compileDocx('The Harbour', [one, two]))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml.indexOf('Chapter one')).toBeLessThan(xml.indexOf('Chapter two'))
    expect(xml.match(/<w:pageBreakBefore/g)).toHaveLength(1)
    // The break comes where the second chapter does.
    expect(xml.indexOf('<w:pageBreakBefore')).toBeLessThan(xml.indexOf('Chapter two'))
    expect(xml.indexOf('<w:pageBreakBefore')).toBeGreaterThan(xml.indexOf('The boats came in.'))
    expect(xml).toMatch(/<w:footnoteReference w:id="1"\/>[\s\S]*<w:footnoteReference w:id="2"\/>/)
    const footnotes = await zip.file('word/footnotes.xml')!.async('string')
    expect(footnotes).toContain('First note.')
    expect(footnotes).toContain('Second note.')
    expect(await zip.file('docProps/core.xml')!.async('string')).toContain('The Harbour')
  })

  it('starts a chapter that opens with a table on a new page too', async () => {
    const table = chapter('table', [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p(text('Tide'))] }] }] }])
    const zip = await JSZip.loadAsync(await compileDocx('The Harbour', [one, table]))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml.match(/<w:pageBreakBefore/g)).toHaveLength(1)
    expect(xml.indexOf('<w:pageBreakBefore')).toBeLessThan(xml.indexOf('<w:tbl>'))
  })

  it('is named for the book', () => {
    expect(bookFilename('The Harbour: a/b', 'docx')).toBe('The Harbour ab.docx')
    expect(bookFilename('.', 'pdf')).toBe('Untitled.pdf')
  })

  // Security finding 7 of the 8 November audit.
  it('leaves what a picture says about itself behind, in the page and in Word', async () => {
    const stored: Item = { id: 'a', kind: 'note', version: 1, createdAt: 0, updatedAt: 0, body: { type: 'doc', content: [p({ type: 'image', attrs: { src: jpegWithExif(), alt: '' } })] } }
    const before = JSON.stringify(stored.body)
    const page = toHtml(stored)
    expect(atob(/src="data:image\/jpeg;base64,([^"]+)"/.exec(page)![1])).not.toContain('GPS 51.5')
    const zip = await JSZip.loadAsync(await toDocx(stored))
    const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/') && !name.endsWith('/'))
    expect(media).toHaveLength(1)
    expect(await zip.file(media[0])!.async('binarystring')).not.toContain('GPS 51.5')
    expect(JSON.stringify(stored.body)).toBe(before)
  })
})

describe('a picture the writer sized', () => {
  const sized = (size: unknown) => page([p({ type: 'image', attrs: { src: PNG, alt: 'x', size } }), p(text('after'))])
  const extent = async (item: Item) => {
    const xml = await (await JSZip.loadAsync(await toDocx(item))).file('word/document.xml')!.async('string')
    const [, cx, cy] = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml)!
    return [Number(cx) / 9525, Number(cy) / 9525]
  }

  it('says its size in a page of HTML, whose own styles make it that share of the text’s width', () => {
    const html = toHtml(sized('medium'))
    expect(html).toMatch(/<img [^>]*data-size="medium"/)
    expect(html).toContain('img[data-size="medium"] { width: 50%; }')
    // And is drawn so: the page as a browser lays it out.
    const frame = document.body.appendChild(document.createElement('iframe'))
    frame.style.width = '728px'
    frame.contentDocument!.open()
    frame.contentDocument!.write(html)
    frame.contentDocument!.close()
    const img = frame.contentDocument!.querySelector('img')!
    expect(Math.round(img.getBoundingClientRect().width)).toBe(340)
    frame.remove()
    expect(toHtml(sized(null))).not.toContain('<img data-size')
    expect(toHtml(sized('900px'))).not.toMatch(/<img [^>]*data-size/)
  })

  it('is that share of the page’s text in Word, taller in step, and its own size with none', async () => {
    const [own] = await extent(sized(null))
    expect(own).toBeLessThan(100)
    const [width, height] = await extent(sized('medium'))
    expect(width).toBe(300)
    expect(height / width).toBeCloseTo((await extent(sized(null)))[1] / own, 1)
    expect((await extent(sized('full')))[0]).toBe(600)
    expect((await extent(sized('small')))[0]).toBe(198)
    expect((await extent(sized('huge')))[0]).toBe(own)
  })
})
