import { registerPlugin } from '@capacitor/core'
import { getSchema } from '@tiptap/core'
import { isAllowedUri } from '@tiptap/extension-link'
import { generateHTML } from '@tiptap/html'
import type { JSONContent } from '@tiptap/react'
import type { IParagraphOptions } from 'docx'
import type { Item } from '../db/db'
import { nibExtensions } from '../editor/extensions'
import { fitSchema } from '../editor/fitSchema'
import { withoutNotes } from '../editor/NoteToSelf'
import { asAlignment } from './alignment'
import { asCalloutKind, CALLOUT_CSS, CALLOUT_INK, CALLOUT_NAMES } from './callouts'
import { download, share } from './download'
import { handOverFile, takeExport } from './exportFile'
import { attachedName, NOT_INCLUDED } from './attachment'
import { allowedImageSrc, asImageSize, filterBodyImages, IMAGE_SHARE, IMAGE_SIZE_RULES, withoutAboutIn } from './image'
import { linkTitle, withoutLines } from './links'
import { fromMarkup, withMathML } from './math'
import type { Stretch } from '../editor/codeWorker'
import { CODE_CSS, CODE_INK } from './codeLanguages'
import { coloursOf } from '../editor/codeColours'
import { titleOf } from './text'
import { aboutWords, runningHead, withSceneBreaks, type Standard } from './manuscript'

/**
 * One document as Word, PDF or HTML — Nib Plus. Markdown export stays in
 * ./export and stays free.
 *
 * HTML is the base: it comes from the editor's own schema, so it renders
 * exactly what the document holds, and the PDF is that same page printed by
 * the system (ios/App/App/NibPdfPlugin.swift). Word is built from the
 * document's JSON directly, since a .docx is its own structure, not markup.
 */

export type RichFormat = 'docx' | 'pdf' | 'html'

/** What a manuscript compiles to (lib/manuscript): Word, PDF, or an e-book (lib/epub). */
export type BookFormat = 'docx' | 'pdf' | 'epub'

/** What each is called, wherever one is offered. */
export const FORMAT_NAMES: Record<RichFormat | BookFormat, string> = { docx: 'Word', pdf: 'PDF', html: 'HTML', epub: 'EPUB' }
export const RICH_FORMATS: RichFormat[] = ['docx', 'pdf', 'html']
export const BOOK_FORMATS: BookFormat[] = ['docx', 'pdf', 'epub']
/** What a book in standard manuscript format (lib/manuscript Standard) is made as: no e-book. */
export const STANDARD_FORMATS: BookFormat[] = ['docx', 'pdf']

/** `header`: a standard manuscript's running head, which the printer puts on each page after the first with its number, and an inch of margin all round. */
const pdfPrinter = registerPlugin<{ render(options: { html: string; name: string; header?: string }): Promise<{ path: string }> }>('NibPdf')

/** Makes a file in `format`, and hands it over. The system prints the PDF (ios/App/App/NibPdfPlugin.swift), with `header` for a standard manuscript. */
export function makeFile(format: RichFormat, name: string, { docx, html, header }: { docx: () => Promise<Blob>; html: () => string; header?: string }): Promise<void> {
  if (format === 'docx') return docx().then((file) => download(file, name))
  if (format === 'html') return download(html(), name, 'text/html;charset=utf-8')
  return pdfPrinter.render({ html: html(), name, ...(header ? { header } : {}) }).then(({ path }) => handOverFile(path, share))
}

/** A PDF's bytes, for a file that holds several (lib/exportMany). `name` is its own in the exports folder while it's printed. */
export const printPdf = (html: string, name: string) => pdfPrinter.render({ html, name }).then(({ path }) => takeExport(path))

/** A file name from a title, which is what Files, Mail and Word show. */
export function fileNamed(title: string, extension: string): string {
  const name = title
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, '')
    // Nor a dot first: that is a hidden file, and NibPdfPlugin refuses one.
    .replace(/^[\s.]+/, '')
    .trim()
    .slice(0, 80)
  return `${name || 'Untitled'}.${extension}`
}

/** One document's file, named for its title. */
export const documentFilename = (item: Item, extension: RichFormat) => fileNamed(titleOf(item.body), extension)

/** A table's file, named for the document it is in. */
export const csvFilename = (body: JSONContent) => fileNamed(titleOf(body), 'csv')

/** A compiled manuscript's file, named for the book: its folder (lib/manuscript). */
export const bookFilename = (title: string, extension: BookFormat) => fileNamed(title, extension)

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Each block of code that's been read for it (`coloursFor`) with its colours, as spans the export's own stylesheet colours. */
function withCodeColours(html: string): string {
  return html.replace(/<pre><code class="language-([\w+#.-]+)">([^<]*)<\/code><\/pre>/g, (whole, language: string, escaped: string) => {
    const text = fromMarkup(escaped)
    const stretches = coloursOf(language, text)
    if (!stretches.length) return whole
    let coloured = ''
    let at = 0
    for (const { from, to, colour } of stretches) {
      coloured += `${escape(text.slice(at, from))}<span class="nib-code-${colour}">${escape(text.slice(from, to))}</span>`
      at = to
    }
    return `<pre><code class="language-${language}">${coloured}${escape(text.slice(at))}</code></pre>`
  })
}

const STYLE = `
  :root { color-scheme: light; }
  body { margin: 0; background: #fff; color: #1a1a1a; font: 17px/1.65 -apple-system, "Helvetica Neue", Arial, sans-serif; }
  main { max-width: 680px; margin: 0 auto; padding: 48px 24px; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.5em; }
  h1 { font-size: 1.8em; } h2 { font-size: 1.4em; } h3 { font-size: 1.15em; } h4 { font-size: 1.05em; } h5 { font-size: 1em; } h6 { font-size: 0.95em; color: #555; }
  p { margin: 0 0 0.9em; }
  a { color: inherit; }
  mark { background: #fbe7a1; color: inherit; }
  img { max-width: 100%; height: auto; }
  ${IMAGE_SIZE_RULES}
  blockquote { margin: 0 0 0.9em; padding-inline-start: 1em; border-inline-start: 3px solid #d0d0d0; color: #555; }
  :is(ul, ol):has(> li:first-child p:dir(rtl)), blockquote:has(> p:first-child:dir(rtl)) { direction: rtl; }
  code, pre { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.88em; }
  code { background: #f2f2f2; padding: 0.1em 0.3em; border-radius: 3px; }
  pre { background: #f5f5f5; padding: 12px 14px; border-radius: 6px; white-space: pre-wrap; }
  pre code { background: none; padding: 0; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0.3em; }
  ul[data-type="taskList"] li { display: flex; gap: 0.5em; }
  ul[data-type="taskList"] li > label { flex: none; }
  ul[data-type="taskList"] li > div > p { margin: 0; }
  li > p { margin: 0 0 0.3em; }
  table { border-collapse: collapse; margin: 0 0 0.9em; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: start; vertical-align: top; }
  th { background: #f5f5f5; }
  th > p, td > p { margin: 0; }
  ${CALLOUT_CSS}
  ${CODE_CSS}
  div[data-math] { margin: 0 0 0.9em; overflow-x: auto; }
  .nib-attachment { margin: 0 0 0.9em; }
  /* A font that has the stretched brackets, arrows and bars of a formula: Chromium, left to choose, sets it in one that has none. */
  math { font-family: 'STIX Two Math', 'Cambria Math', 'Latin Modern Math', math; }
  .notes { font-size: 0.9em; color: #444; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 2em 0 1em; }
  .chapter + .chapter { break-before: page; }
  @media print { main { max-width: none; padding: 0; } a { text-decoration: none; } }
`

/**
 * Standard manuscript format's page (lib/manuscript Standard), for the PDF.
 * The printer lays a page out a quarter wider than it prints, so a pixel
 * here is 0.8 of a point there: 15px is 12pt, 45px half an inch. It gives
 * the margins and the running head itself (NibPdfPlugin.swift).
 */
const STANDARD_STYLE = `
  :root { color-scheme: light; }
  body { margin: 0; background: #fff; color: #000; font: 15px/2 'Times New Roman', Times, serif; }
  p { margin: 0; text-indent: 45px; }
  p[style*="text-align"], li p, td p, th p, .notes p { text-indent: 0; }
  h1, h2, h3, h4, h5, h6 { font-size: 1em; font-weight: normal; text-align: center; margin: 0 0 2em; }
  a { color: inherit; text-decoration: none; }
  mark { background: none; color: inherit; }
  img { max-width: 100%; height: auto; }
  ${IMAGE_SIZE_RULES}
  blockquote { margin: 0 0 0 45px; }
  ul, ol { margin: 0; }
  code, pre { font-family: 'Courier New', Courier, monospace; font-size: 1em; }
  pre { margin: 0; white-space: pre-wrap; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 0 6px; text-align: start; vertical-align: top; }
  ${CALLOUT_CSS}
  div[data-math] { margin: 0; }
  math { font-family: 'STIX Two Math', 'Cambria Math', 'Latin Modern Math', math; }
  hr { border: 0; border-top: 1px solid #000; width: 150px; margin: 30px 0 0; }
  /* The first page: the name and the length on its first line, single-spaced, and the title halfway down. */
  .first-page .top { display: flex; justify-content: space-between; gap: 30px; line-height: 1.15; text-indent: 0; }
  .first-page .title { margin-top: 380px; text-align: center; text-indent: 0; }
  .first-page .by { text-align: center; text-indent: 0; }
  /* Each chapter on a page of its own, a third of the way down. */
  .chapter { break-before: page; padding-top: 240px; }
`

/** Words whose first letter is of a script written from the right. */
const RIGHT_TO_LEFT = /^[^\p{L}]*[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u

/**
 * A document's own markup, from the editor's schema, its formulas as MathML:
 * once whoever asks has waited for `mathFor` its documents (lib/math).
 */
export function markupOf(item: Item): string {
  const extensions = nibExtensions(item.kind === 'page')
  // generateHTML throws on a mark or node this version does not know, as the
  // editor does; see fitSchema. And filtered first, as the editor's is. Notes
  // to self are the writer's, and stay behind.
  return withCodeColours(withMathML(generateHTML(fitSchema(withoutLines(withoutNotes(withoutAboutIn(filterBodyImages(item.body)))), getSchema(extensions)), extensions)))
}

/** One document as a standalone page. */
export const toHtml = (item: Item) => standalone(titleOf(item.body), markupOf(item))

/**
 * A manuscript (lib/manuscript) as one page: its chapters in order, each a
 * section that starts a new page in print, which the PDF is, and the
 * footnotes numbered through the whole book.
 */
export const compileHtml = (title: string, chapters: Item[]) =>
  standalone(title, chapters.map((chapter) => `<section class="chapter">${markupOf(chapter)}</section>`).join(''))

/** A manuscript in standard manuscript format (lib/manuscript Standard), for the PDF: the first page, then each chapter a third of the way down a page of its own. */
export function standardHtml(book: Standard, chapters: Item[]): string {
  const first = `<section class="first-page"><p class="top"><span>${escape(book.author ?? '')}</span><span>${escape(aboutWords(book.words))}</span></p><p class="title">${escape(book.title)}</p>${book.author ? `<p class="by">by ${escape(book.author)}</p>` : ''}</section>`
  const rest = chapters.map((chapter) => `<section class="chapter">${markupOf({ ...chapter, body: withSceneBreaks(chapter.body) })}</section>`).join('')
  return standalone(book.title, first + rest, STANDARD_STYLE)
}

/**
 * A standalone page: styles inline, images already data URIs. Footnotes are
 * stored inside the text (see editor/Footnote); here they become numbered
 * references with the notes listed at the end, as a reader expects on paper.
 */
function standalone(title: string, markup: string, style = STYLE): string {
  // Parsed, not assigned to a live element: nothing in it loads or runs.
  const page = new DOMParser().parseFromString(`<main>${markup}</main>`, 'text/html')
  const main = page.querySelector('main')!
  endnotes(main)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>${style}</style>
</head>
<body>
${main.outerHTML}
</body>
</html>
`
}

/**
 * The footnotes in `root`, stored inside the text (editor/Footnote), as
 * numbered references, with the notes listed after the rest. Numbered from
 * `from`, for a chapter of a book whose earlier chapters had some (lib/epub).
 * Returns how many there were.
 */
export function endnotes(root: Element, from = 1): number {
  const page = root.ownerDocument
  const notes: string[] = []
  for (const sup of root.querySelectorAll<HTMLElement>('sup[data-footnote]')) {
    notes.push(sup.getAttribute('data-text') ?? '')
    const n = from + notes.length - 1
    const link = page.createElement('a')
    link.setAttribute('href', `#note-${n}`)
    link.id = `ref-${n}`
    link.textContent = String(n)
    sup.replaceChildren(link)
    for (const name of ['title', 'data-text', 'data-footnote', 'class']) sup.removeAttribute(name)
  }
  if (notes.length) {
    root.append(page.createElement('hr'))
    const list = page.createElement('ol')
    list.className = 'notes'
    if (from > 1) list.setAttribute('start', String(from))
    notes.forEach((text, i) => {
      const entry = page.createElement('li')
      entry.id = `note-${from + i}`
      entry.textContent = `${text} `
      const back = page.createElement('a')
      back.setAttribute('href', `#ref-${from + i}`)
      back.textContent = '↩'
      entry.append(back)
      list.append(entry)
    })
    root.append(list)
  }
  return notes.length
}

/** How large Word shows a picture: as it is, made to fit, or, sized by the writer (lib/image), that share of the page's text. */
function wordSize(image: WordImage, size: unknown): { width: number; height: number } {
  const chosen = asImageSize(size)
  if (!chosen) return { width: image.width, height: image.height }
  const width = Math.round((MAX_IMAGE_WIDTH * IMAGE_SHARE[chosen]) / 100)
  return { width, height: Math.round((width * image.height) / image.width) }
}

/** An image ready for Word: which only takes PNG, JPEG and GIF, and wants a size. */
type WordImage = { data: Uint8Array; type: 'png' | 'jpg' | 'gif'; width: number; height: number }

const MAX_IMAGE_WIDTH = 600 // px; a Letter or A4 page's text column at Word's 96 dpi

async function wordImage(src: string): Promise<WordImage | null> {
  if (!allowedImageSrc(src)) return null
  // Read from the data URI here, not fetched: the app page's policy lets it
  // fetch Nib's own servers and nothing else (lib/csp).
  const [, mime, base64] = /^data:([^;]+);base64,(.*)$/.exec(src)!
  const blob = new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], { type: mime })
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, MAX_IMAGE_WIDTH / bitmap.width)
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  let bytes: Blob = blob
  let type: WordImage['type'] = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/gif' ? 'gif' : 'png'
  if (blob.type === 'image/webp') {
    // Word cannot show WebP. Every browser Nib runs in can decode it, so redraw as PNG.
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    bytes = (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))) ?? blob
    type = 'png'
  }
  bitmap.close()
  return { data: new Uint8Array(await bytes.arrayBuffer()), type, width, height }
}

function collectImages(node: JSONContent, found: Set<string>) {
  if (node.type === 'image' && typeof node.attrs?.src === 'string') found.add(node.attrs.src)
  node.content?.forEach((child) => collectImages(child, found))
}

/** The document as a .docx: headings, lists, quotes, code, links, footnotes and images carried across. */
export const toDocx = (item: Item) => wordFile(titleOf(item.body), [withoutAboutIn(item.body)])

/** A manuscript (lib/manuscript) as one .docx: its chapters in order, each after the first from a new page, the footnotes numbered through. */
export const compileDocx = (title: string, chapters: Item[]) => wordFile(title, chapters.map((chapter) => withoutAboutIn(chapter.body)))

/** A manuscript in standard manuscript format (lib/manuscript Standard) as a .docx: the first page, then the running head and the page number on each after it. */
export const standardDocx = (book: Standard, chapters: Item[]) => wordFile(book.title, chapters.map((chapter) => withSceneBreaks(withoutAboutIn(chapter.body))), book)

/** Letter where people print on it, as the PDF printer has it (NibPdfPlugin.swift); A4 everywhere else. In twentieths of a point. */
function paper(): { width: number; height: number } {
  let region: string | undefined
  try {
    region = new Intl.Locale(navigator.language).maximize().region
  } catch {
    // A language the browser can't read: A4, as most of the world has.
  }
  return ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'PR'].includes(region ?? '') ? { width: 12240, height: 15840 } : { width: 11906, height: 16838 }
}

async function wordFile(title: string, bodies: JSONContent[], standard?: Standard): Promise<Blob> {
  const docx = await import('docx')
  const {
    AlignmentType,
    BorderStyle,
    Document,
    ExternalHyperlink,
    FootnoteReferenceRun,
    Header,
    HeadingLevel,
    ImageRun,
    LevelFormat,
    Packer,
    PageNumber,
    Paragraph,
    Tab,
    TabStopType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = docx
  type Run = InstanceType<typeof TextRun> | InstanceType<typeof ImageRun> | InstanceType<typeof ExternalHyperlink> | InstanceType<typeof FootnoteReferenceRun>
  type Line = InstanceType<typeof Paragraph>
  type Block = Line | InstanceType<typeof Table>

  const sources = new Set<string>()
  for (const body of bodies) collectImages(body, sources)
  const images = new Map<string, WordImage>()
  for (const src of sources) {
    const image = await wordImage(src).catch(() => null)
    if (image) images.set(src, image)
  }

  const footnotes: Record<number, { children: Line[] }> = {}
  let orderedLists = 0
  const MONO = 'Menlo'

  /** A line of code, from offset `at` of its block, in the colours found for the block. A comment can run over several lines. */
  const codeRuns = (line: string, at: number, stretches: Stretch[]) => {
    const run = (text: string, colour?: string) => new TextRun({ text, font: MONO, size: 20, ...(colour ? { color: CODE_INK[colour] } : {}) })
    const runs: InstanceType<typeof TextRun>[] = []
    let done = 0
    for (const { from, to, colour } of stretches) {
      const start = Math.max(from - at, 0)
      const end = Math.min(to - at, line.length)
      if (end <= start) continue
      if (start > done) runs.push(run(line.slice(done, start)))
      runs.push(run(line.slice(start, end), colour))
      done = end
    }
    if (done < line.length || !runs.length) runs.push(run(line.slice(done)))
    return runs
  }
  // A chapter's first block starts a new page: the next paragraph made takes it.
  let newPage = false
  // In standard manuscript format, a third of the way down it: an inch of margin, then the rest of the third.
  const page = standard ? paper() : undefined
  const INCH = 1440
  let opening = false

  function runs(nodes: JSONContent[] = [], base: { font?: string } = {}): Run[] {
    const out: Run[] = []
    for (const node of nodes) {
      if (node.type === 'text') {
        const marks = new Map((node.marks ?? []).map((mark) => [mark.type, mark]))
        const run = new TextRun({
          text: node.text ?? '',
          bold: marks.has('bold') || undefined,
          italics: marks.has('italic') || undefined,
          strike: marks.has('strike') || undefined,
          underline: marks.has('underline') ? {} : undefined,
          // A manuscript is black on white.
          highlight: marks.has('highlight') && !standard ? 'yellow' : undefined,
          font: marks.has('code') ? MONO : base.font,
          style: marks.has('link') ? 'Hyperlink' : undefined,
        })
        // Only what the editor allows: a stored file: or javascript: link is its words alone.
        const href = marks.get('link')?.attrs?.href
        out.push(typeof href === 'string' && href && isAllowedUri(href) ? new ExternalHyperlink({ link: href, children: [run] }) : run)
      } else if (node.type === 'hardBreak') {
        out.push(new TextRun({ text: '', break: 1 }))
      } else if (node.type === 'noteLink') {
        // The note it points to is not in the file, so it is its title.
        out.push(new TextRun({ text: linkTitle(node), font: base.font }))
      } else if (node.type === 'mathInline') {
        // A formula, as its LaTeX: Word's own equations are another format altogether.
        out.push(new TextRun({ text: (node.content ?? []).map((child) => child.text ?? '').join(''), font: MONO }))
      } else if (node.type === 'footnote') {
        const id = Object.keys(footnotes).length + 1
        footnotes[id] = { children: [new Paragraph({ text: String(node.attrs?.text ?? '') })] }
        out.push(new FootnoteReferenceRun(id))
      } else if (node.type === 'image') {
        const image = images.get(String(node.attrs?.src ?? ''))
        if (image) {
          out.push(
            new ImageRun({
              type: image.type,
              data: image.data,
              transformation: wordSize(image, node.attrs?.size),
              altText: node.attrs?.alt ? { name: 'Image', title: 'Image', description: String(node.attrs.alt) } : undefined,
            }),
          )
        }
      }
    }
    return out
  }

  /** Where a block sits: how deep, inside which list, and whether it opens a list item (only that one gets the bullet or number). */
  type Place = { indent: number; quote?: boolean | string; list?: { reference: string; level: number; instance?: number }; first?: boolean }

  function paragraph(children: Run[], place: Place, extra: IParagraphOptions = {}): Line {
    const numbering = place.list && place.first ? place.list : undefined
    const breaking = newPage
    const opens = opening
    newPage = false
    opening = false
    return new Paragraph({
      children,
      ...(numbering ? { numbering } : place.indent ? { indent: { left: 720 * place.indent } } : {}),
      ...(place.quote ? { border: { left: { style: BorderStyle.SINGLE, size: 12, color: place.quote === true ? 'BBBBBB' : place.quote, space: 8 } } } : {}),
      ...(breaking ? { pageBreakBefore: true } : {}),
      ...extra,
      ...(opens && page ? { spacing: { ...extra.spacing, before: Math.round(page.height / 3) - INCH } } : {}),
    })
  }

  /**
   * What a line says for itself. Word doesn't work out a paragraph's direction
   * from its words, as a page's dir="auto" does; and in a paragraph running
   * from the right, its "left" is the side the line starts on.
   */
  function ownLine(node: JSONContent): IParagraphOptions {
    const fromTheRight = RIGHT_TO_LEFT.test((node.content ?? []).map((run) => run.text ?? '').join(''))
    const wanted = asAlignment(node.attrs?.textAlign)
    const sides = { left: fromTheRight ? AlignmentType.RIGHT : AlignmentType.LEFT, center: AlignmentType.CENTER, right: fromTheRight ? AlignmentType.LEFT : AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED }
    return { ...(fromTheRight ? { bidirectional: true } : {}), ...(wanted ? { alignment: sides[wanted] } : {}) }
  }

  function blocks(nodes: JSONContent[] = [], place: Place = { indent: 0 }): Block[] {
    const out: Block[] = []
    for (const node of nodes) {
      switch (node.type) {
        case 'paragraph': {
          // In standard manuscript format, each paragraph of the text indented half an inch, as on a typed page; one in the middle or to the right isn't.
          const indented = standard && !place.indent && !place.list && !['center', 'right'].includes(asAlignment(node.attrs?.textAlign) ?? '')
          out.push(paragraph(runs(node.content), place, { ...ownLine(node), ...(indented ? { indent: { firstLine: 720 } } : {}) }))
          place = { ...place, first: false }
          break
        }
        case 'heading': {
          const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][Math.min(6, Number(node.attrs?.level ?? 1)) - 1]
          out.push(paragraph(runs(node.content), place, { heading: level, ...ownLine(node) }))
          break
        }
        case 'blockquote':
          out.push(...blocks(node.content, { indent: place.indent + 1, quote: true }))
          break
        case 'callout': {
          // A quotation's rule in its colour, under its kind in words: Word has no box that holds a list as well.
          const kind = asCalloutKind(node.attrs?.kind) ?? 'note'
          const color = CALLOUT_INK[kind].slice(1).toUpperCase()
          const inside = { indent: place.indent + 1, quote: color }
          out.push(paragraph([new TextRun({ text: CALLOUT_NAMES[kind], bold: true, color })], inside, { spacing: { after: 40 } }))
          out.push(...blocks(node.content, inside))
          break
        }
        // Its name, and that it isn't in the document: a Word file holds no other file here.
        case 'attachment':
          out.push(paragraph([new TextRun({ text: attachedName(node), bold: true }), new TextRun({ text: ` (${NOT_INCLUDED})` })], place))
          break
        // A formula on its own lines, as its LaTeX, set as code is.
        case 'mathBlock':
        case 'codeBlock': {
          const text = (node.content ?? []).map((child) => child.text ?? '').join('')
          const stretches = coloursOf(node.attrs?.language, text)
          let at = 0
          for (const line of text.split('\n')) {
            out.push(paragraph(codeRuns(line, at, stretches), place, { spacing: { after: 0 } }))
            at += line.length + 1
          }
          break
        }
        case 'bulletList':
        case 'orderedList': {
          const reference = node.type === 'bulletList' ? 'bullet' : 'ordered'
          const instance = node.type === 'orderedList' ? ++orderedLists : undefined
          const level = place.list ? place.list.level + 1 : 0
          for (const listItem of node.content ?? []) {
            out.push(...blocks(listItem.content, { indent: place.indent + 1, quote: place.quote, list: { reference, level, instance }, first: true }))
          }
          break
        }
        case 'taskList':
          for (const task of node.content ?? []) {
            const [first, ...rest] = task.content ?? []
            const box = new TextRun({ text: task.attrs?.checked ? '☑ ' : '☐ ' })
            out.push(paragraph([box, ...runs(first?.content)], { indent: place.indent + 1, quote: place.quote }, first ? ownLine(first) : {}))
            out.push(...blocks(rest, { indent: place.indent + 1, quote: place.quote }))
          }
          break
        case 'table': {
          // A chapter opening with a table: the page starts before it, not in its first cell.
          if (newPage) out.push(paragraph([], { indent: 0 }, { spacing: { after: 0 } }))
          const rows = (node.content ?? []).map(
            (row) =>
              new TableRow({
                // Repeated at the top of each page, as a header row is in Word.
                tableHeader: (row.content ?? []).every((cell) => cell.type === 'tableHeader') || undefined,
                children: (row.content ?? []).map((cell) => {
                  const inside = blocks(cell.content)
                  const span = (name: string) => (Number(cell.attrs?.[name] ?? 1) > 1 ? Number(cell.attrs?.[name]) : undefined)
                  return new TableCell({
                    // Word refuses a cell with nothing in it.
                    children: inside.length ? inside : [new Paragraph({})],
                    columnSpan: span('colspan'),
                    rowSpan: span('rowspan'),
                    shading: cell.type === 'tableHeader' ? { fill: 'F2F2F2' } : undefined,
                  })
                }),
              }),
          )
          if (rows.length) out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }))
          break
        }
      }
    }
    return out
  }

  const body = bodies.flatMap((chapter, index) => {
    newPage = index > 0
    opening = Boolean(standard)
    return blocks(chapter.content)
  })
  const levels =(format: (typeof LevelFormat)[keyof typeof LevelFormat], text: (level: number) => string) =>
    Array.from({ length: 6 }, (_, level) => ({
      level,
      format,
      text: text(level),
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    }))

  const heading = (size: number, before: number) =>
    standard
      ? // A chapter's title in its own words and size, in the middle, a line clear of the text.
        { run: { font: 'Times New Roman', size: 24, bold: false, color: '000000' }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 480 }, keepNext: true } }
      : { run: { size, bold: true, color: '1A1A1A' }, paragraph: { spacing: { before, after: 120 }, keepNext: true } }
  const document = new Document({
    title,
    ...(standard?.author ? { creator: standard.author } : {}),
    // Without defaults Word falls back to Times with no space between paragraphs.
    // Arial because it is on every Apple device and on Windows; Calibri is not
    // on an iPhone without Office. (Apple's Quick Look ignores these defaults
    // and previews in Times regardless; Word, Pages and Google Docs honour them.)
    styles: {
      default: {
        document: standard
          ? // Times New Roman at 12 points, double-spaced, no space between paragraphs.
            { run: { font: 'Times New Roman', size: 24 }, paragraph: { spacing: { after: 0, line: 480 } } }
          : { run: { font: 'Arial', size: 22 }, paragraph: { spacing: { after: 160, line: 276 } } },
        heading1: heading(36, 360),
        heading2: heading(30, 320),
        heading3: heading(26, 280),
        heading4: heading(24, 240),
        heading5: heading(22, 200),
        heading6: heading(20, 200),
      },
    },
    footnotes,
    numbering: {
      config: [
        { reference: 'bullet', levels: levels(LevelFormat.BULLET, (level) => ['•', '◦', '▪'][level % 3]) },
        { reference: 'ordered', levels: levels(LevelFormat.DECIMAL, (level) => `%${level + 1}.`) },
      ],
    },
    sections: page && standard ? standardSections(page, standard) : [{ children: body.length ? body : [new Paragraph({})] }],
  })
  return Packer.toBlob(document)

  /**
   * Standard manuscript format's pages: the first, with no running head, the
   * name and length on its first line and the title halfway down; then the
   * book, its pages numbered from 1 after the running head.
   */
  function standardSections(size: { width: number; height: number }, book: Standard) {
    const margin = { top: INCH, right: INCH, bottom: INCH, left: INCH, header: INCH / 2 }
    const single = { line: 240 }
    const first = [
      new Paragraph({
        spacing: single,
        tabStops: [{ type: TabStopType.RIGHT, position: size.width - 2 * INCH }],
        children: [new TextRun({ text: book.author ?? '' }), new TextRun({ children: [new Tab(), aboutWords(book.words)] })],
      }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: Math.round(size.height / 2) - INCH - 480 }, children: [new TextRun({ text: book.title })] }),
      ...(book.author ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `by ${book.author}` })] })] : []),
    ]
    const head = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: single, children: [new TextRun({ children: [runningHead(book), PageNumber.CURRENT] })] })] })
    return [
      { properties: { page: { size, margin } }, children: first },
      { properties: { page: { size, margin, pageNumbers: { start: 1 } } }, headers: { default: head }, children: body.length ? body : [new Paragraph({})] },
    ]
  }
}
