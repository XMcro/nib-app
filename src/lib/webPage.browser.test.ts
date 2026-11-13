import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import source from '../../ios/App/NibShare/Page.js?raw'
import { withWebPage } from './importApps'
import { plainText } from './text'

/**
 * A web page shared whole: what Safari's page script hands the share sheet
 * (ios/App/NibShare/Page.js, run here as Safari runs it), and what the app
 * makes of it (lib/importApps `withWebPage`).
 */

type Read = { title: string; url: string; html: string; selection: string; article: string; visible: string }
const NibPage = new Function(`${source}; return NibPage`)() as { read(document: Document): Read; LIMIT: number; new (): { run(given: { completionFunction(read: Read): void }): void } }

const PAGE = `
  <style>.gone { display: none }</style>
  <nav><ul><li><a href="/about">About</a></li></ul></nav>
  <article>
    <h1>Tides of the north harbour</h1>
    <p>High water comes <em>twice</em> a day. See the <a href="tables/2026.html">tables</a>, or <a href="javascript:alert(1)">this</a>.</p>
    <img src="https://example.com/harbour.jpg" alt="The harbour at dusk">
    <h2>Spring tides</h2>
    <ul><li>New moon</li><li>Full moon</li></ul>
    <blockquote><p>Time and tide wait for no one.</p></blockquote>
    <table><tr><th>Day</th><th>High</th></tr><tr><td>Mon</td><td>06:12</td></tr></table>
    <div class="gone">Folded by its styling</div>
    <section hidden="until-found"><p>Folded until found</p></section>
    <p hidden>Marked as hidden</p>
    <span aria-hidden="true">An icon’s name</span>
    <form><input value="search"><button>Go</button></form>
    <script>window.stolen = document.cookie</script>
  </article>`

const lead = (title: string): JSONContent[] => [
  { type: 'paragraph', content: [{ type: 'text', text: title }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'https://example.com/tides', marks: [{ type: 'link', attrs: { href: 'https://example.com/tides' } }] }] },
]
const types = (blocks: JSONContent[]) => blocks.map((block) => (block.type === 'heading' ? `h${block.attrs!.level}` : block.type))
const text = (blocks: JSONContent[]) => plainText({ type: 'doc', content: blocks })
const hrefs = (blocks: JSONContent[]): string[] => blocks.flatMap((block) => [...(block.marks ?? []).filter((mark) => mark.type === 'link').map((mark) => String(mark.attrs!.href)), ...hrefs(block.content ?? [])])

let frame: HTMLIFrameElement | undefined
/** A page of its own, at an address of its own, as the one in Safari is. */
async function pageOf(body: string): Promise<Document> {
  frame = document.body.appendChild(document.createElement('iframe'))
  const page = frame.contentDocument!
  page.open()
  page.write(`<!doctype html><title>Tides of the north harbour</title><base href="https://example.com/harbour/"><body>${body}`)
  page.close()
  return page
}
afterEach(() => frame?.remove())

describe('what Safari hands the share sheet of a page', () => {
  it('is its title, its address and its body: without what isn’t read, without pictures, and with each link’s whole address', async () => {
    const page = await pageOf(PAGE)
    const read = NibPage.read(page)
    expect(read.title).toBe('Tides of the north harbour')
    expect(read.url).toBe(page.URL)
    for (const gone of ['Marked as hidden', 'An icon’s name', 'stolen', '<img', '<form', '<input', '<style', 'display: none']) expect(read.html, gone).not.toContain(gone)
    // What's only folded away is the page's text all the same: on a phone, most of a long article.
    expect(read.html).toContain('Folded by its styling')
    expect(read.html).toContain('Folded until found')
    expect(read.html).toContain('<a href="https://example.com/harbour/tables/2026.html">tables</a>')
    expect(read.html).toContain('<a href="https://example.com/about">About</a>')
    expect(read.html).toContain('<h2>Spring tides</h2>')
    // The page itself is as it was.
    expect(page.querySelector('img')).not.toBeNull()
    expect(page.querySelector('a[href="/about"]')).not.toBeNull()
  })

  it('is handed over without its body when that’s more than Nib keeps, and still handed over when the page can’t be read', async () => {
    const long = await pageOf(`<p>${'word '.repeat(NibPage.LIMIT / 5 + 10)}</p>`)
    expect(NibPage.read(long)).toMatchObject({ title: 'Tides of the north harbour', html: '' })
    frame!.remove()
    // As Safari calls it: one function, given where to answer. A page with no body to copy still says what it's called.
    const real = Object.getOwnPropertyDescriptor(Document.prototype, 'body')!
    Object.defineProperty(document, 'body', { get: () => null, configurable: true })
    let answered: Read | undefined
    try {
      new NibPage().run({ completionFunction: (read) => void (answered = read) })
    } finally {
      Object.defineProperty(document, 'body', real)
      delete (document as { body?: unknown }).body
    }
    expect(answered).toEqual({ title: document.title, url: document.URL, html: '', selection: '', article: '', visible: '' })
  })

  it('hands over what’s selected, and nothing with nothing selected: read as the whole page is, items of a list still a list', async () => {
    const page = await pageOf(PAGE)
    expect(NibPage.read(page).selection).toBe('')
    const chosen = page.getSelection()!
    // From the middle of a paragraph to the end of the heading after the picture.
    const paragraph = page.querySelector('article p')!
    const range = page.createRange()
    range.setStart(paragraph.firstChild!, 'High water '.length)
    range.setEnd(page.querySelector('h2')!.firstChild!, 'Spring tides'.length)
    chosen.addRange(range)
    const { selection } = NibPage.read(page)
    expect(selection).toContain('comes <em>twice</em> a day.')
    expect(selection).toContain('<a href="https://example.com/harbour/tables/2026.html">tables</a>')
    expect(selection).toContain('<h2>Spring tides</h2>')
    for (const gone of ['High water', 'New moon', '<img', 'About']) expect(selection, gone).not.toContain(gone)
    // The page's own selection is as it was.
    expect(chosen.toString()).toContain('Spring tides')

    chosen.removeAllRanges()
    const items = page.querySelectorAll('article ul li')
    const two = page.createRange()
    two.setStart(items[0].firstChild!, 0)
    two.setEnd(items[1].firstChild!, 'Full'.length)
    chosen.addRange(two)
    expect(NibPage.read(page).selection.replace(/\s+/g, ' ')).toBe('<ul><li>New moon</li><li>Full</li></ul>')

    // A selection of nothing to read is none.
    chosen.removeAllRanges()
    const picture = page.createRange()
    picture.selectNode(page.querySelector('img')!)
    chosen.addRange(picture)
    expect(NibPage.read(page).selection).toBe('')
  })

  it('hands over the article: what holds most of the page’s paragraphs, whole, without what stands beside it', async () => {
    const words = (n: number) => 'A sentence about the harbour and its tides. '.repeat(n)
    const page = await pageOf(`
      <header><nav><p>${words(1)}</p><a href="/">Home</a></nav></header>
      <div id="wrap">
        <aside class="side"><p>${words(2)}</p><p>${words(2)}</p></aside>
        <article>
          <header><h1>Tides of the north harbour</h1><p>By the harbour master</p></header>
          <div class="body">
            <p>First. ${words(3)}</p>
            <section><h2>Spring tides</h2><p>Second. ${words(3)}</p><div style="display:none"><p>Folded. ${words(2)}</p></div></section>
            <aside><p>Related. ${words(2)}</p></aside>
            <nav><a href="/next">Next</a></nav>
            <img src="x.png" alt="A picture">
            <p>Short.</p>
          </div>
        </article>
      </div>
      <footer><p>${words(2)}</p></footer>`)
    const { article, html } = NibPage.read(page)
    for (const kept of ['<h1>Tides of the north harbour</h1>', 'By the harbour master', 'First.', '<h2>Spring tides</h2>', 'Second.', 'Folded.', 'Short.']) expect(article, kept).toContain(kept)
    for (const gone of ['Home', 'Related.', 'Next', '<img', '<aside', '<nav', '<footer', 'class="side"']) expect(article, gone).not.toContain(gone)
    // The whole page has all of it.
    for (const kept of ['Home', 'Related.', 'First.']) expect(html, kept).toContain(kept)

    // With no article said, it's what holds most of the paragraphs; with no paragraphs of any length, there's none.
    frame!.remove()
    const plain = await pageOf(`<div id="menu"><p>${words(1)}</p></div><div id="story"><p>One. ${words(2)}</p><p>Two. ${words(2)}</p></div>`)
    expect(NibPage.read(plain).article.replace(/\s+/g, ' ')).toMatch(/^<p>One\. .*<\/p><p>Two\. .*<\/p>$/)
    frame!.remove()
    expect(NibPage.read(await pageOf('<p>Too short to tell.</p><ul><li>Home</li></ul>')).article).toBe('')

    // An article in sections, none of them most of it, beside a notice with more words than any one section: all its sections, and not the notice.
    frame!.remove()
    const sectioned = await pageOf(`
      <main>
        <div class="notice"><p>Notice. ${words(5)}</p><p>${words(4)}</p></div>
        <div class="content"><div class="text">
          <section><p>Lead. ${words(3)}</p></section>
          <h2>Publication</h2><section><p>Second. ${words(4)}</p></section>
          <h2>Calculation</h2><section><div><p>Third. ${words(4)}</p></div><p>Fourth. ${words(3)}</p></section>
        </div></div>
      </main>
      <footer><p>${words(2)}</p></footer>`)
    const whole = NibPage.read(sectioned).article
    for (const kept of ['Lead.', '<h2>Publication</h2>', 'Second.', '<h2>Calculation</h2>', 'Third.', 'Fourth.']) expect(whole, kept).toContain(kept)
    expect(whole).not.toContain('Notice.')
    expect(whole.trim()).toMatch(/^<section>/)

    // A notice with more words than the article itself, named as one: not counted, and not the article. Nor is what's named as beside the writing kept within it.
    frame!.remove()
    const noticed = await pageOf(`
      <div id="siteNotice"><div class="frb"><p>Please give. ${words(9)}</p><p>${words(9)}</p></div></div>
      <div class="post-content social-ready"><p>The story. ${words(4)}</p><div class="related-posts"><p>Read next. ${words(3)}</p></div><p>Its end. ${words(3)}</p></div>
      <div class="comments"><p>A long comment. ${words(4)}</p></div>`)
    // Whatever the page itself is called: one with a notice showing often says so of the whole page.
    noticed.body.className = 'has-banner notice-shown'
    noticed.documentElement.className = 'cookie-consent-open'
    const story = NibPage.read(noticed).article
    for (const kept of ['The story.', 'Its end.']) expect(story, kept).toContain(kept)
    for (const gone of ['Please give.', 'Read next.', 'A long comment.']) expect(story, gone).not.toContain(gone)
    // The whole page has them all.
    for (const kept of ['Please give.', 'Read next.', 'A long comment.']) expect(NibPage.read(noticed).html, kept).toContain(kept)

    // Articles that are each a small part of the page (a list of them, or comments under a story) aren't the article: what holds most is.
    frame!.remove()
    const listed = await pageOf(`<div id="story"><p>The story. ${words(8)}</p></div><div id="more"><article><p>First comment. ${words(2)}</p></article><article><p>Second comment. ${words(2)}</p></article></div>`)
    expect(NibPage.read(listed).article).toContain('The story.')
    expect(NibPage.read(listed).article).not.toContain('comment')
    // And where nothing holds more than half, it's the page.
    frame!.remove()
    const even = await pageOf(`<div><p>Left. ${words(3)}</p></div><div><p>Middle. ${words(3)}</p></div><div><p>Right. ${words(3)}</p></div>`)
    for (const kept of ['Left.', 'Middle.', 'Right.']) expect(NibPage.read(even).article, kept).toContain(kept)
    // Paragraphs straight in the page are the page's own.
    frame!.remove()
    expect(NibPage.read(await pageOf(`<h1>Title</h1><p>One. ${words(2)}</p>`)).article).toContain('<h1>Title</h1>')
  })

  it('hands over the part on screen: not what is above it, below it, or not drawn; and what is drawn by its children alone', async () => {
    const page = await pageOf(`
      <style>p, h2, li { margin: 0; height: 100px } .folded { display: none } .through { display: contents }</style>
      <p>Above, scrolled past.</p>
      <h2>Half on screen at the top</h2>
      <div class="through"><p>Through a wrapper <a href="there">that draws nothing itself</a>.</p></div>
      <p class="folded">Folded away.</p>
      <ul><li>On screen</li><li>Half on screen at the foot</li><li>Below</li></ul>
      <p>Far below.</p>`)
    frame!.style.cssText = 'width: 400px; height: 300px; border: 0'
    page.body.style.margin = '0'
    page.defaultView!.scrollTo(0, 150)
    const { visible } = NibPage.read(page)
    for (const kept of ['Half on screen at the top', 'Through a wrapper', '<a href="https://example.com/harbour/there">', '<li>On screen</li>', '<li>Half on screen at the foot</li>']) expect(visible, kept).toContain(kept)
    for (const gone of ['Above', 'Folded away', '<li>Below</li>', 'Far below', '<style']) expect(visible, gone).not.toContain(gone)
    // What's drawn outside what holds it is where it's drawn: a holder with no height, scrolled past, its words on screen all the same.
    // And a paragraph half on screen is kept whole, the link in the half above with it.
    page.body.innerHTML = `
      <div style="height: 0"><div style="height: 400px"></div><p>Drawn below its holder.</p></div>
      <div style="height: 150px"></div>
      <p style="height: 400px"><a href="above">A link in the part above</a><br>and the rest of it</p>`
    page.defaultView!.scrollTo(0, 350)
    const drawn = NibPage.read(page).visible
    expect(drawn).toContain('Drawn below its holder.')
    expect(drawn).toContain('<a href="https://example.com/harbour/above">A link in the part above</a>')
    // On screen up and down, but off to one side, hidden, or folded shut: not on screen. Nor is what has no size, though its place is there.
    page.body.innerHTML = `
      <div style="position: fixed; top: 0; left: -300px; width: 280px"><p>A menu waiting off to the side.</p></div>
      <p style="visibility: hidden">There, and not to be seen.</p>
      <div style="content-visibility: hidden"><p>Folded shut.</p></div>
      <div style="height: 0; overflow: hidden"><p>Shut to no height.</p></div>
      <p>Plainly there.</p>`
    page.defaultView!.scrollTo(0, 0)
    const seen = NibPage.read(page).visible
    expect(seen).toContain('Plainly there.')
    for (const gone of ['A menu waiting', 'not to be seen', 'Folded shut', 'Shut to no height']) expect(seen, gone).not.toContain(gone)
    // Nothing on screen to read: nothing.
    page.defaultView!.scrollTo(0, 0)
    page.body.innerHTML = '<div style="height: 2000px"></div><p>Below it all.</p>'
    expect(NibPage.read(page).visible).toBe('')
  })

  it('still hands over the rest when one way of reading the page fails', async () => {
    const page = await pageOf(PAGE)
    page.getSelection = () => {
      throw new Error('no selection here')
    }
    const read = NibPage.read(page)
    expect(read.selection).toBe('')
    expect(read.html).toContain('<h2>Spring tides</h2>')
    expect(read.article).toContain('High water comes')
  })

  it('hands over no part longer than Nib keeps, and the shorter ones all the same', async () => {
    const page = await pageOf(`<article><p>The article. ${'word '.repeat(2000)}</p></article><div>${'<span>filler</span> '.repeat(NibPage.LIMIT / 20)}</div>`)
    const read = NibPage.read(page)
    expect(read.html).toBe('')
    expect(read.article).toContain('The article.')
    expect(read.article.length).toBeLessThan(NibPage.LIMIT)
  })
})

describe('a web page read into a document', () => {
  it('keeps its headings, lists, quotes, links and tables in a page, after the words and the link, its title said once and as a heading', async () => {
    const { html } = NibPage.read(await pageOf(PAGE))
    const blocks = withWebPage(lead('Tides of the north harbour'), html, 'page')
    expect(types(blocks)).toEqual(['h1', 'paragraph', 'bulletList', 'paragraph', 'h2', 'bulletList', 'blockquote', 'table', 'paragraph', 'paragraph'])
    expect(text(blocks.slice(0, 2))).toBe('Tides of the north harbour\nhttps://example.com/tides')
    expect(text(blocks).match(/Tides of the north harbour/g)).toHaveLength(1)
    expect(text(blocks)).toContain('High water comes twice a day.')
    // Links that go somewhere, whole; one that would run something is words and no link.
    expect(hrefs(blocks)).toEqual(['https://example.com/tides', 'https://example.com/about', 'https://example.com/harbour/tables/2026.html'])
    expect(JSON.stringify(blocks)).not.toMatch(/javascript:|harbour\.jpg|The harbour at dusk|"image"/)
  })

  it('is a note’s lines in a note: no headings, a table’s cells each a line, the title still once', async () => {
    const { html } = NibPage.read(await pageOf(PAGE))
    const blocks = withWebPage(lead('Tides of the north harbour'), html, 'note')
    expect(types(blocks)).not.toEqual(expect.arrayContaining(['h1', 'h2', 'table']))
    expect(text(blocks).match(/Tides of the north harbour/g)).toHaveLength(1)
    expect(text(blocks)).toContain('Spring tides')
    expect(text(blocks)).toContain('Day\nHigh\nMon\n06:12')
  })

  it('leaves out what is empty once its picture or its button is gone: no bullet with nothing beside it, no blank line', () => {
    const html = '<ul><li><a href="https://example.com/"><img src="https://example.com/logo.png"></a></li><li>Tides</li><li> </li></ul><ul><li></li></ul><p> </p><div></div><ol><li><ul><li></li></ul></li><li>Charts</li></ol><p>Words</p>'
    for (const kind of ['page', 'note'] as const) {
      const blocks = withWebPage(lead('Harbour'), html, kind)
      expect(types(blocks).slice(2)).toEqual(['bulletList', 'orderedList', 'paragraph'])
      expect(text(blocks.slice(2))).toBe('Tides\nCharts\nWords')
      expect(blocks[2].content).toHaveLength(1)
      expect(blocks[3].content).toHaveLength(1)
    }
  })

  it('reads a page handed over by anything else as warily: no pictures, nothing run, and its own title kept where the sheet gave another', () => {
    const blocks = withWebPage(lead('My own words for it'), '<h1>Their title</h1><p onclick="steal()">Words<img src="https://example.com/x.png" onerror="steal()"></p><script>steal()</script><svg><text>drawn</text></svg>', 'page')
    expect(types(blocks)).toEqual(['h1', 'paragraph', 'h1', 'paragraph'])
    expect(text(blocks)).toBe('My own words for it\nhttps://example.com/tides\nTheir title\nWords')
    expect(JSON.stringify(blocks)).not.toMatch(/steal|onerror|onclick|x\.png|drawn/)
    // With no words from the sheet, the page speaks for itself.
    expect(types(withWebPage([], '<h1>Their title</h1><p>Words</p>', 'page'))).toEqual(['h1', 'paragraph'])
  })
})
