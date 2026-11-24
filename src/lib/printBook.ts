import regular from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url'
import regularMore from '@fontsource-variable/literata/files/literata-latin-ext-wght-normal.woff2?url'
import italic from '@fontsource-variable/literata/files/literata-latin-wght-italic.woff2?url'
import italicMore from '@fontsource-variable/literata/files/literata-latin-ext-wght-italic.woff2?url'
import type { Item } from '../db/db'
import { endnotes, escape, markupOf, pdfPrinter, type BookPrint } from './documentExport'
import { share } from './download'
import { handOverFile } from './exportFile'
import { IMAGE_SIZE_RULES } from './image'
import { SCENE_BREAK } from './manuscript'

/**
 * A book's inside, ready to print and sell through print on demand (Amazon
 * KDP, IngramSpark): Nib Plus. A title page on the right, the copyright on
 * its back, then each chapter opening on a right-hand page, set in Literata,
 * whose licence (SIL OFL) lets a book set in it be sold. The author's name
 * heads the left-hand pages and the title the right; the numbers are at the
 * foot, from chapter one. The system lays it out and prints it
 * (ios/App/App/NibPdfPlugin.swift `book`). The cover isn't in it: both take
 * that as a file of its own.
 */

/** Why the Plus sheet opened, when a book for print was asked for without it. */
export const PRINT_PLUS = 'A book’s inside, ready to print and sell through Amazon KDP or IngramSpark, is part of Nib Plus.'

/** The trims offered, in points, each with its text's size, in points. */
export const TRIMS = {
  '5x8': { name: '5 × 8 in', width: 360, height: 576, size: 10.5 },
  '5.5x8.5': { name: '5.5 × 8.5 in', width: 396, height: 612, size: 11 },
  '6x9': { name: '6 × 9 in', width: 432, height: 648, size: 11.5 },
} as const
export type Trim = keyof typeof TRIMS

/**
 * In points: ¾ inch at the spine, as KDP asks of a book of up to 700 pages,
 * and ½ inch outside; ¾ inch above and below, where the heads and numbers go.
 */
export const MARGINS = { inside: 54, outside: 36, top: 54, bottom: 54 }

/** The printer lays a page out a quarter wider than it prints (lib/documentExport STANDARD_STYLE): a point is 1.25px. */
const PX = 1.25
const LINE = 1.4

/** Literata's Latin letters, upright and italic, each file by the letters it has. Others are set in a serif the device has. */
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const MORE = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'
const FACES = [
  { url: regular, style: 'normal', range: LATIN },
  { url: regularMore, style: 'normal', range: MORE },
  { url: italic, style: 'italic', range: LATIN },
  { url: italicMore, style: 'italic', range: MORE },
]

export type PrintBook = { title: string; author?: string; chapters: Item[]; trim: Trim; dropCaps: boolean; year: number; lang: string }

/** The three stars between scenes, in place of the marks the writer typed: ***, #, ⁂ and the like (lib/manuscript SCENE_BREAK). */
const BREAK = '* * *'

/**
 * What the printer is given, but for the letters: `faces` is their
 * @font-face rules, and `font` the upright Latin file, base64, for the heads.
 * The footnotes are numbered through the book, each chapter's after it.
 */
export function printOptions(book: PrintBook, faces: string, font?: string): BookPrint {
  const { width, height, size } = TRIMS[book.trim]
  // The text's height on a page, and a line's, in the page's pixels.
  const text = (height - MARGINS.top - MARGINS.bottom) * PX
  const line = size * PX * LINE
  const lang = escape(book.lang)
  const author = book.author?.trim() || undefined
  let notes = 1
  const chapters = book.chapters.map((chapter) => {
    // Parsed, not assigned to a live element: nothing in it loads or runs.
    const { body } = new DOMParser().parseFromString(`<body>${markupOf(chapter)}</body>`, 'text/html')
    for (const paragraph of body.querySelectorAll('p')) {
      if (SCENE_BREAK.test(paragraph.textContent ?? '')) {
        paragraph.className = 'break'
        paragraph.textContent = BREAK
      }
    }
    notes += endnotes(body, notes)
    // On paper there's nowhere to go back to.
    for (const back of body.querySelectorAll('.notes li > a:last-child')) back.remove()
    return { markup: `<main lang="${lang}" class="${chapter.id.startsWith('part:') ? 'part' : 'chapter'}">${body.innerHTML}</main>`, side: 'right' as const }
  })
  const headings = 'h1, h2, h3, h4, h5, h6'
  const opening = `:is(${headings})`
  const style = `
  ${faces}
  :root { color-scheme: light; }
  body { margin: 0; background: #fff; color: #000; font: ${size * PX}px/${LINE} Literata, Georgia, serif; }
  p { margin: 0; text-indent: 1.5em; text-align: justify; -webkit-hyphens: auto; hyphens: auto; widows: 2; orphans: 2; }
  :is(${headings}, .break, blockquote, ul, ol, pre, table, img) + p, main > p:first-child, p[style*="text-align"], li p, td p, th p, blockquote p { text-indent: 0; }
  ${opening} { font-weight: 400; text-align: center; line-height: 1.25; margin: 1.6em 0 0.8em; break-after: avoid; -webkit-hyphens: manual; hyphens: manual; }
  h1 { font-size: 1.6em; } h2 { font-size: 1.3em; } h3 { font-size: 1.1em; } h4, h5, h6 { font-size: 1em; font-style: italic; }
  /* A chapter opens a quarter of the way down its page, and a part a third. */
  .chapter { padding-top: ${Math.round(text / 4)}px; }
  .part { padding-top: ${Math.round(text / 3)}px; }
  :is(.chapter, .part) > :first-child { margin-top: 0; }
  .chapter > ${opening}:first-child { margin-bottom: 2em; }
  .part h1 { font-size: 2em; }
  .title-page { padding-top: ${Math.round(text / 4)}px; }
  .title-page p { text-align: center; text-indent: 0; -webkit-hyphens: manual; hyphens: manual; }
  .title { font-size: 2.2em; line-height: 1.2; }
  .by { margin-top: 2em; font-size: 1.15em; }
  /* The copyright at the foot of its page. */
  .copyright-page { padding-top: ${Math.round(text - 3 * line)}px; }
  .copyright-page p { font-size: 0.85em; text-indent: 0; text-align: left; }
  /* Spaced with word-spacing: Literata has no wider space of its own, and the device's would come in another face. */
  .break { text-align: center; text-indent: 0; margin: 0.7em 0; word-spacing: 0.6em; }
  blockquote { margin: 0.8em 1.5em; }
  ul, ol { margin: 0.8em 0; padding-left: 1.5em; }
  li p { text-align: left; }
  img { max-width: 100%; height: auto; display: block; margin: 1em auto; break-inside: avoid; }
  ${IMAGE_SIZE_RULES}
  a { color: inherit; text-decoration: none; }
  mark { background: none; color: inherit; }
  code, pre { font-family: ui-monospace, Menlo, monospace; font-size: 0.85em; }
  pre { margin: 0.8em 0; white-space: pre-wrap; }
  table { border-collapse: collapse; margin: 0.8em auto; }
  th, td { border: 0.5pt solid #000; padding: 2px 6px; text-align: start; vertical-align: top; }
  math { font-family: 'STIX Two Math', math; }
  sup { line-height: 0; }
  /* Before the chapter's notes. */
  hr { border: 0; border-top: 0.5pt solid #000; width: 4em; margin: 2em 0 1em; }
  .notes { font-size: 0.85em; padding-left: 1.5em; }
  ${
    book.dropCaps
      ? // At least as tall as its letter, so a short first paragraph doesn't leave the next to wrap round it.
        `.chapter > ${opening}:first-child + p, .chapter > p:first-child { min-height: ${3 * LINE}em; }
  .chapter > ${opening}:first-child + p::first-letter, .chapter > p:first-child::first-letter { -webkit-initial-letter: 3; initial-letter: 3; margin-right: 0.08em; }`
      : ''
  }
`
  return {
    width,
    height,
    ...MARGINS,
    style,
    left: author ?? book.title,
    right: book.title,
    ...(font ? { font } : {}),
    sections: [
      { markup: `<main lang="${lang}" class="title-page"><p class="title">${escape(book.title)}</p>${author ? `<p class="by">${escape(author)}</p>` : ''}</main>`, side: 'right', front: true },
      // Its back: blank, with no author to name.
      { markup: `<main lang="${lang}" class="copyright-page">${author ? `<p>Copyright © ${book.year} ${escape(author)}. All rights reserved.</p>` : ''}</main>`, side: 'left', front: true },
      ...chapters,
    ],
  }
}

function base64(bytes: Uint8Array): string {
  let text = ''
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(text)
}

/** The book as `name`, a PDF, handed over. Literata is Nib's own, read from its files here (the page's policy lets it), and put in the page. */
export async function printBook(book: PrintBook, name: string): Promise<void> {
  const files = await Promise.all(FACES.map(async ({ url }) => base64(new Uint8Array(await (await fetch(url)).arrayBuffer()))))
  const faces = FACES.map(
    ({ style, range }, i) => `@font-face { font-family: Literata; font-style: ${style}; font-weight: 200 900; src: url(data:font/woff2;base64,${files[i]}) format('woff2'); unicode-range: ${range}; }`,
  ).join('\n  ')
  const { path } = await pdfPrinter.book({ name, ...printOptions(book, faces, files[0]) })
  await handOverFile(path, share)
}
