import { Gunzip, Inflate, unzipSync, type UnzipFileInfo, type Unzipped } from 'fflate'
import type { JSONContent } from '@tiptap/react'
import { base64 } from '../../worker/base64'
import type { Kind } from '../db/db'
import { BACKUP_KIND } from './backup'
import { COLORNOTE_AUTOMATIC, isColornote, openColornote } from './colornote'
import { readDocx, type Left } from './docx'
import { DOC_BUDGET, MAX_BYTES, allowedImageSrc, withoutAbout } from './image'
import { htmlToBody, isNibExport, markdownToBody, markdownToHtml, parseImport } from './import'
import { md5 } from './md5'
import { tarEntries } from './tar'
import { plainText } from './text'
import { isTime } from './time'

/**
 * Other note apps' exports, read into Nib documents. Pure: nothing here
 * touches the database, and every file is untrusted. HTML is only ever parsed
 * into inert `DOMParser` documents, nothing is fetched, and a picture comes in
 * only as a data URI built from bytes that were inside the file itself.
 */

export type Imported = {
  kind: Kind
  body: JSONContent
  createdAt?: number
  updatedAt?: number
  pinned?: boolean
  /** Put away in the app it came from, as Keep's archive is. */
  archived?: boolean
  /** From an Obsidian vault: the folder it was in there, the innermost, and its tags as written; from Google Keep, its labels. Whoever keeps the document says what becomes of them (fileActions). */
  folder?: string
  tags?: string[]
  /** What `folder` and `tags` are called where they came from, for saying so when they're left out: "Keep’s labels". */
  filing?: string
  /** From an Obsidian vault, where a line's `^id` is never part of its words (lib/links). */
  vault?: boolean
}

/** `skipped` holds short reasons a person can read, one per line. */
export type ImportResult = { documents: Imported[]; skipped: string[] }

export const IMPORT_ACCEPT = [
  '.md',
  '.markdown',
  '.txt',
  '.html',
  '.htm',
  '.json',
  '.enex',
  '.zip',
  '.tgz',
  '.jex',
  '.backup',
  '.bear2bk',
  '.textpack',
  '.docx',
  'text/markdown',
  'text/plain',
  'text/html',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // On a Mac, Apple Notes says what `.enex` is, as XML, and the picker goes by that over Nib's own word: without this, Evernote's exports can't be picked there. An XML file that isn't one is reported as not read.
  'application/xml',
].join(',')

const MARKDOWN = new Set(['md', 'markdown', 'txt'])
const HTML = new Set(['html', 'htm'])
/** A `.textpack` is one zipped TextBundle; a `.bear2bk` is many. */
const ARCHIVES = new Set(['zip', 'bear2bk', 'textpack'])
/** Google Takeout's other form, a gzipped tar; and Joplin's own export, a tar. */
const TARS = new Set(['tgz', 'jex'])
/** A Map, not an object: a file named `x.constructor` must not find Object's own keys. */
const PICTURES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
])

/** Read whole into memory, as fflate needs: much more and a phone's web view gives out. */
const MAX_FILE = 512 * 1024 * 1024
/**
 * Unpacking runs on the main thread, so the work it may take is capped: what
 * is read and what is written, for every file Nib keeps. A real export is
 * mostly text, a few MB of which covers thousands of notes, and pictures small
 * enough to keep (MAX_BYTES each); larger ones are never unpacked.
 */
const MAX_WORK = 128 * 1024 * 1024
/**
 * The most a document can come in as, in characters as it is kept, pictures and all (DOC_BUDGET of them): some 6 MB of text, more than a long novel.
 * A .docx of well under 1 MB unpacked to a page of 100 MB, which the library's mirror then wrote out at every launch.
 */
const MAX_DOCUMENT = 8 * 1024 * 1024
/** About 2,500 notes in a Bear backup, which writes four entries a note before its pictures. */
const MAX_ENTRIES = 10_000
/** How much of a deflated file is unpacked at a time: one that says less than it holds is caught within this, at most about 66 MB at deflate's 1032 to 1. */
const INFLATE_STEP = 64 * 1024
/** Past this many, files a zip held that Nib left out are summed up, not listed. */
const MAX_LISTED = 10

const NIB_BACKUP = 'This is a Nib backup. Use Restore from a backup in Settings instead.'
const TOO_LARGE = '[picture not imported: too large]'
const NOT_READ = '[picture not imported: not a format Nib reads]'

type Meta = { title?: string; createdAt?: number; updatedAt?: number; pinned?: boolean; archived?: boolean; folder?: string; tags?: string[]; filing?: string; vault?: boolean }
/** `size`, where it differs from the bytes at hand: a picture too large to keep is never unpacked. */
type Picture = { bytes: Uint8Array; type: string; size?: number }
/** The bytes of a picture a document points at, if the file it came in holds them. */
type Find = (src: string) => Picture | null

/**
 * Reasons counted while reading and worded once at the end, so a thousand
 * trashed notes come back as one line rather than a thousand.
 */
type Counted = 'simplenoteTrash' | 'bearTrash' | 'bearLocked' | 'keepTrash' | 'keepRecordings' | 'joplinTrash' | 'joplinLocked' | 'joplinTodos' | 'joplinFiles' | 'zohoFiles' | 'fusebaseFiles' | 'colornoteTrash' | 'colornoteLocked' | 'empty' | 'tooLarge' | 'unreadable' | 'wordPictures' | 'wordShapes' | 'wordEquations' | 'wordHeaders'
type Run = { documents: Imported[]; skipped: string[]; counts: Partial<Record<Counted, number>> }

const many = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`
const WORDING: Record<Counted, (n: number) => string> = {
  simplenoteTrash: (n) => `${many(n, 'note')} in Simplenote’s trash`,
  bearTrash: (n) => `${many(n, 'note')} in Bear’s trash`,
  bearLocked: (n) => `${many(n, 'note')} locked with Bear’s encryption`,
  keepTrash: (n) => `${many(n, 'note')} in Keep’s trash`,
  keepRecordings: (n) => `${many(n, 'voice recording')} from Keep`,
  joplinTrash: (n) => `${many(n, 'note')} in Joplin’s trash`,
  joplinLocked: (n) => `${many(n, 'note')} encrypted by Joplin`,
  joplinTodos: (n) => (n === 1 ? 'The tick on a to-do from Joplin' : `The ticks on ${n} to-dos from Joplin`),
  joplinFiles: (n) => `${many(n, 'file')} attached in Joplin`,
  zohoFiles: (n) => `${many(n, 'file')} attached in Zoho Notebook`,
  fusebaseFiles: (n) => `${many(n, 'file')} attached in FuseBase`,
  colornoteTrash: (n) => `${many(n, 'note')} in ColorNote’s trash`,
  colornoteLocked: (n) => `${many(n, 'note')} locked in ColorNote`,
  empty: (n) => many(n, 'empty note'),
  tooLarge: (n) => `${many(n, 'picture')} too large to import`,
  unreadable: (n) => `${many(n, 'note')} that couldn’t be read`,
  wordPictures: (n) => `${many(n, 'picture')} from Word, too large or in a format Nib doesn’t read`,
  wordShapes: (n) => (n === 1 ? 'A text box or shape from Word' : `${n} text boxes and shapes from Word`),
  wordEquations: (n) => `${many(n, 'equation')} from Word`,
  wordHeaders: (n) => (n === 1 ? 'A Word document’s headers and footers' : `The headers and footers of ${n} Word documents`),
}

/** What a Word document had that Nib has no place for, as the report counts it. */
const LEFT: Record<keyof Left, Counted> = { pictures: 'wordPictures', shapes: 'wordShapes', equations: 'wordEquations', headers: 'wordHeaders' }

/** "one page", "3 notes", "5 notes and pages": what an import brought in. */
export function importedWords(kinds: Kind[]): string {
  const pages = kinds.filter((kind) => kind === 'page').length
  if (kinds.length === 1) return pages ? 'one page' : 'one note'
  return pages && pages < kinds.length ? `${kinds.length} notes and pages` : `${kinds.length} ${pages ? 'pages' : 'notes'}`
}

function count(run: Run, what: Counted, by = 1) {
  run.counts[what] = (run.counts[what] ?? 0) + by
}

/** How a file's password is asked for: its name, and whether the one given last didn't open it. Null for no password given. */
export type AskPassword = (about: { name: string; again: boolean }) => Promise<string | null>

/** `fallbackKind` is used only for plain Markdown and text files, exactly as before. `ask` is for a file that is encrypted, which only ColorNote's backup is. */
export async function readImportFile(file: File, fallbackKind: Kind, ask?: AskPassword): Promise<ImportResult> {
  const run: Run = { documents: [], skipped: [], counts: {} }
  const extension = extensionOf(file.name)
  if (file.size > MAX_FILE) return { documents: [], skipped: [`${file.name}: more than 512 MB, too large to open`] }
  try {
    if (MARKDOWN.has(extension)) addMarkdownFile(run, await file.text(), fallbackKind)
    else if (extension === 'json') addJson(run, await file.text(), file.name)
    else if (extension === 'enex') addEnex(run, await file.text(), file.name)
    else if (extension === 'docx') await addDocx(run, new Uint8Array(await file.arrayBuffer()), file.name)
    else if (HTML.has(extension)) addHtmlFile(run, await file.text())
    else if (ARCHIVES.has(extension)) {
      const opened = openZip(run, new Uint8Array(await file.arrayBuffer()), file.name)
      if (opened) addArchive(run, opened, extension === 'textpack')
    } else if (TARS.has(extension)) {
      const opened = openTar(run, new Uint8Array(await file.arrayBuffer()), file.name, extension === 'tgz')
      if (opened && extension === 'jex') addJex(run, opened)
      else if (opened) addArchive(run, opened, false)
    } else if (extension === 'backup') await addColornote(run, new Uint8Array(await file.arrayBuffer()), file.name, ask)
    else run.skipped.push(`${file.name}: not a format Nib reads`)
  } catch {
    run.skipped.push(`${file.name}: couldn’t be read`)
  }

  const skipped = [
    ...run.skipped,
    ...Object.entries(run.counts).map(([what, n]) => WORDING[what as Counted](n)),
  ]
  // Importing nothing and saying nothing would look like the button is broken.
  if (!run.documents.length && !skipped.length) skipped.push(`${file.name}: nothing to import`)
  return { documents: run.documents, skipped }
}

/** What a Word document holds that lib/docx reads: its XML parts, the document's links, and its pictures. */
const WORD_PARTS = /^word\/(?:[^/]+\.xml|_rels\/document\.xml\.rels|media\/[^/]+)$/

/** A Word document: one page, with what Word had that Nib has no place for counted (lib/docx). */
async function addDocx(run: Run, bytes: Uint8Array, name: string) {
  // A .docx is a zip, and is opened past the same checks as any (unzipChecked): a small one can unpack to gigabytes.
  let files: Unzipped
  try {
    files = unzipChecked(bytes, name, (path) => WORD_PARTS.test(path))
  } catch (error) {
    run.skipped.push(error instanceof Refused ? error.message : `${name}: couldn’t be read`)
    return
  }
  const { body, left } = await readDocx(files)
  if (body.content!.every((block) => block.type === 'paragraph' && !block.content?.length)) return count(run, 'empty')
  if (tooLong(body)) return void run.skipped.push(`${name}: couldn’t be read`)
  run.documents.push({ kind: 'page', body })
  for (const [what, n] of Object.entries(left) as [keyof Left, number][]) if (n) count(run, LEFT[what], n)
}

// ---------------------------------------------------------------------------
// Turning one document's HTML into a Nib document

/**
 * The shared path every app format ends on. `kind` is set only when the source
 * decided it (a Nib export); otherwise the content decides.
 */
function addHtml(
  run: Run,
  html: string,
  meta: Meta,
  { find, kind, prepare }: { find?: Find; kind?: Kind; prepare?: (doc: Document, meta: Meta) => void } = {},
) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // It may add to what is known of the document, from what it finds in it.
  prepare?.(doc, meta)
  tidy(doc)
  inlinePictures(doc, run, find)
  // Parsed as a page first, so only headings the schema really keeps count.
  const asPage = htmlToBody(doc.body.innerHTML, 'page')
  // A table makes a page too: a note has none, and would run its cells together.
  const chosen = kind ?? (headed(asPage, meta.title) || contains(asPage, 'table') ? 'page' : 'note')
  if (chosen === 'note') {
    flattenTables(doc)
    addBody(run, htmlToBody(doc.body.innerHTML, 'note'), chosen, meta)
    return
  }
  // A page opens with its title as an h1. Where the app's title is simply the
  // first line, that line is the one to promote — when it is a line of its own.
  // Not on a page Nib itself exported: that one is already as its writer left it.
  const lead = leadBlock(asPage)
  const implied =
    !kind && lead?.type === 'paragraph' && !contains(lead, 'hardBreak') ? blockText(lead) : undefined
  addBody(run, asPage, chosen, { ...meta, title: meta.title ?? implied })
}

/**
 * A web page shared whole (lib/inbox): its body as Safari handed it to the
 * share sheet, read as any imported page is, in an inert document, onto the
 * schema of the kind of document it's for, after `lead`, the words and the
 * link from the sheet. No pictures: none is fetched, and none is kept. The
 * page's own title, where it opens with the one the sheet already gave, isn't
 * said twice; and a page of Nib's opens with it as a heading.
 */
export function withWebPage(lead: JSONContent[], html: string, kind: Kind): JSONContent[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const picture of doc.querySelectorAll('img, picture, source, svg')) picture.remove()
  // Its own main heading, where that's the title the sheet gave: wherever it comes, after a menu as often as not.
  const title = lead[0] ? blockText(lead[0]) : ''
  if (title) [...doc.querySelectorAll('h1')].find((heading) => same(heading.textContent ?? '', title))?.remove()
  tidy(doc)
  if (kind === 'note') flattenTables(doc)
  // What held only a picture or a button holds nothing now: no bullet with nothing beside it, and no blank line.
  for (const left of doc.querySelectorAll('li, p')) if (!left.textContent?.trim()) left.remove()
  for (const list of doc.querySelectorAll('ul, ol')) if (!list.querySelector('li')) list.remove()
  const read = htmlToBody(doc.body.innerHTML, kind)
  return withTitle({ type: 'doc', content: [...lead, ...(read.content ?? [])] }, kind, title || undefined).content!
}

const tooLong = (body: JSONContent) => JSON.stringify(body).length > MAX_DOCUMENT

function addBody(run: Run, body: JSONContent, kind: Kind, meta: Meta) {
  const titled = withTitle(body, kind, meta.title)
  if (!plainText(titled).trim() && !contains(titled, 'image')) {
    count(run, 'empty')
    return
  }
  if (tooLong(titled)) {
    count(run, 'unreadable')
    return
  }
  run.documents.push({
    kind,
    body: titled,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    pinned: meta.pinned,
    archived: meta.archived,
    folder: meta.folder,
    tags: meta.tags,
    filing: meta.filing,
    vault: meta.vault,
  })
}

const BLOCKS = 'div, p, ul, ol, table, h1, h2, h3, h4, h5, h6, blockquote, pre, hr'

/**
 * Where other apps' HTML and Nib's schema disagree. Only `<p>` is a paragraph
 * to the schema: a `<div>` line (all of Evernote's) is read through, so an
 * empty one — a blank line — vanished. And a `<br>` closing a line draws
 * nothing in a browser but is a hard break to the schema, so the `<p><br></p>`
 * Evernote and Notesnook write for a blank line came in two lines tall.
 */
function tidy(doc: Document) {
  for (const div of doc.querySelectorAll('div')) {
    if (!div.querySelector(BLOCKS)) rename(div, 'p')
  }
  for (const br of doc.querySelectorAll('br')) {
    if (!sibling(br, 'next') && br.parentElement?.matches('p, li')) br.remove()
  }
}

/** A note has no tables: left as they are, a row's cells run into one word, so each becomes its own line. */
function flattenTables(doc: Document) {
  for (const cell of doc.querySelectorAll('td, th')) rename(cell, cell.querySelector(BLOCKS) ? 'div' : 'p')
}

function rename(element: Element, tag: string) {
  const renamed = element.ownerDocument.createElement(tag)
  renamed.append(...element.childNodes)
  element.replaceWith(renamed)
}

/** The nearest sibling that is not just whitespace between tags. */
function sibling(node: Node, way: 'next' | 'previous'): Node | null {
  let found = way === 'next' ? node.nextSibling : node.previousSibling
  while (found?.nodeType === 3 && !found.textContent?.trim()) {
    found = way === 'next' ? found.nextSibling : found.previousSibling
  }
  return found
}

/**
 * Every picture becomes a data URI Nib keeps, or visible text saying why not.
 * The limits are the editor's own: one picture up to MAX_BYTES (there is no
 * canvas here to shrink a larger one), and a document's pictures up to
 * DOC_BUDGET counted the way `imageBytes` counts them, so an imported document
 * can be opened and edited without tripping the budget. A reference that
 * cannot be found is left alone; `reshapeForSchema` shows it as text.
 */
function inlinePictures(doc: Document, run: Run, find?: Find) {
  let used = 0
  for (const image of doc.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? ''
    let uri: string | null = null
    let bytes: number
    if (src.startsWith('data:')) {
      // Unlike a path, a refused data URI shown as text is a wall of base64.
      if (!allowedImageSrc(src)) {
        image.replaceWith(NOT_READ)
        continue
      }
      uri = src
      bytes = Math.floor(((src.length - src.indexOf(',') - 1) * 3) / 4)
    } else {
      const picture = find?.(src)
      if (!picture) continue
      bytes = picture.size ?? picture.bytes.length
      // Encoded only once it is known to fit, so a huge photo is never copied.
      if (bytes <= MAX_BYTES) uri = `data:${picture.type};base64,${base64(picture.bytes)}`
      // The one image policy still has the last word (an empty file fails it).
      if (uri && !allowedImageSrc(uri)) continue
    }
    if (uri) {
      // Kept without where it was taken and when, as a picture taken in by hand is (toDataUrl).
      uri = withoutAbout(uri)
      if (!uri) {
        image.replaceWith(NOT_READ)
        continue
      }
    }
    if (!uri || bytes > MAX_BYTES || used + uri.length > DOC_BUDGET) {
      image.replaceWith(TOO_LARGE)
      count(run, 'tooLarge')
      continue
    }
    used += uri.length
    image.setAttribute('src', uri)
  }
}

/**
 * The kind rule: a heading makes a page, except a heading that only repeats
 * the title at the top — that is how most apps write a title, and a note
 * written that way is still a note.
 */
function headed(body: JSONContent, title?: string): boolean {
  const lead = leadBlock(body)
  const titleHeading = lead?.type === 'heading' && (title === undefined || same(blockText(lead), title))
  return countNodes(body, 'heading') > (titleHeading ? 1 : 0)
}

/**
 * Nib has no title field: a document's title is its first line. When the app
 * kept the title apart from the text, it has to become that first line — as an
 * h1 on a page, a paragraph on a note — unless the text already opens with it.
 */
function withTitle(body: JSONContent, kind: Kind, title?: string): JSONContent {
  if (!title) return body
  const blocks = body.content ?? []
  const lead = leadBlock(body)
  if (kind === 'note') {
    const first = plainText(body).split('\n').find((line) => line.trim()) ?? ''
    if (same(first, title)) return body
    return { ...body, content: [line('paragraph', title), ...blocks] }
  }
  if (lead && same(blockText(lead), title)) {
    if (lead.type === 'heading') return body
    // The title is already there as a plain line; promote it rather than
    // writing it twice.
    if (lead.type === 'paragraph') {
      const heading = { ...lead, type: 'heading', attrs: { level: 1 } }
      return { ...body, content: blocks.map((block) => (block === lead ? heading : block)) }
    }
  }
  return { ...body, content: [line('heading', title), ...blocks] }
}

const line = (type: 'paragraph' | 'heading', text: string): JSONContent => ({
  type,
  ...(type === 'heading' ? { attrs: { level: 1 } } : {}),
  content: [{ type: 'text', text }],
})

const blockText = (block: JSONContent) => plainText({ type: 'doc', content: [block] })
const leadBlock = (body: JSONContent) => (body.content ?? []).find((block) => blockText(block).trim())
const squash = (text: string) => text.replace(/\s+/g, ' ').trim()
const same = (a: string, b: string) => squash(a).toLowerCase() === squash(b).toLowerCase()

function countNodes(node: JSONContent, type: string): number {
  const own = node.type === type ? 1 : 0
  return own + (node.content ?? []).reduce((sum, child) => sum + countNodes(child, type), 0)
}

const contains = (node: JSONContent, type: string) => countNodes(node, type) > 0

/** Plain text keeps its lines exactly, blank ones included, and its spacing. */
function plainBody(text: string): JSONContent {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n')
  return {
    type: 'doc',
    content: lines.map((text) =>
      text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' },
    ),
  }
}

// ---------------------------------------------------------------------------
// Markdown, frontmatter, and dates

const CREATED = ['created', 'created_at', 'created-at', 'date']
const UPDATED = ['updated', 'updated_at', 'updated-at', 'modified']

/** A Markdown or text file picked on its own: today's import, plus frontmatter. */
function addMarkdownFile(run: Run, text: string, fallbackKind: Kind) {
  // Apple Notes' export is a note or a page by what is in it, as any app's is: it may hold a table. Its pictures are in a folder beside it, which isn't here.
  if (fromAppleNotes(text)) return addMarkdown(run, text, () => null)
  const { meta, markdown } = frontmatter(text)
  const own = isNibExport(markdown)
  const entries = parseImport(markdown, fallbackKind)
  // Frontmatter with a title and nothing under it is still a titled note.
  if (!entries.length && meta.title) entries.push({ kind: fallbackKind, markdown: '' })
  for (const entry of entries) {
    addBody(run, markdownToBody(entry.markdown, entry.kind), entry.kind, own ? {} : meta)
  }
}

/** Markdown from inside an archive: its pictures can be found, and its kind is decided by its headings. */
function addMarkdown(run: Run, text: string, find: Find, known: Meta = {}, prepare?: (doc: Document, meta: Meta) => void) {
  const { meta, markdown } = frontmatter(text)
  if (isNibExport(markdown)) {
    for (const entry of parseImport(markdown, 'note')) {
      addHtml(run, markdownToHtml(entry.markdown), {}, { find, kind: entry.kind })
    }
    return
  }
  const notes = fromAppleNotes(markdown)
  // What the app recorded beside the file outranks what was typed into it.
  const merged: Meta = {
    title: known.title ?? meta.title,
    createdAt: known.createdAt ?? meta.createdAt,
    updatedAt: known.updatedAt ?? meta.updatedAt,
    pinned: known.pinned ?? meta.pinned,
    folder: known.folder,
    tags: known.tags,
    filing: known.filing,
    vault: known.vault,
  }
  if (!notes) return addHtml(run, markdownToHtml(markdown), merged, { find, prepare })
  addHtml(run, markdownToHtml(appleNotesMarkdown(markdown)), merged, {
    find,
    prepare: (doc, meta) => {
      underline(doc)
      prepare?.(doc, meta)
    },
  })
}

/** What Apple Notes writes that isn't a line of words ending in its two spaces: a table's row, a quotation's line, and the line it leaves before a table. */
const NOTES_OTHER = /^(?:\||>|$)/

/**
 * Whether Apple Notes wrote this (File, Export To, Markdown): there, every
 * line of words ends in two spaces, the blank ones too, and only a
 * monostyled block's lines, a table's and a quotation's don't have to.
 * Nothing else in the file says where it came from.
 */
function fromAppleNotes(text: string): boolean {
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/)
  let fenced = false
  let words = 0
  for (const line of lines) {
    if (line.startsWith('```')) fenced = !fenced
    else if (!fenced && !NOTES_OTHER.test(line)) {
      if (!line.endsWith('  ')) return false
      if (line.trim()) words++
    }
  }
  return words > 0
}

/** A line of one of Apple Notes' lists: how far in it is, four spaces a step, what it is, and its words. */
const NOTES_ITEM = /^( *)(?:([*-]) (?:\[([ xX])\] )?|(\d+\.) )(.*)$/

/**
 * Apple Notes' Markdown as Markdown that means what the note did. There a
 * line is a paragraph, a list's line or not, with nothing between them: read
 * as written, a paragraph under a list's line is taken into it, and lines one
 * after another run into one paragraph. So paragraphs are set apart here, and
 * a list's lines kept together. A list that begins a step in, as Notes lets
 * one, would be code, so its lines are brought back by as much; and bullets, dashes and a checklist's boxes, which Notes keeps as lists of
 * their own, get a marker each, as one marker would make one list of them.
 * A monostyled block is left as written.
 */
function appleNotesMarkdown(text: string): string {
  const out: string[] = []
  let fenced = false
  /** What the line before was; and for a list's, how far in it came out, and how far in its lists began. */
  let last: 'item' | 'quote' | 'table' | 'words' = 'words'
  let depth = 0
  let start = 0
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('```')) {
      out.push(...(fenced ? [raw, ''] : ['', raw]))
      fenced = !fenced
      last = 'words'
      continue
    }
    if (fenced) {
      out.push(raw)
      continue
    }
    const line = raw.trimEnd()
    const item = NOTES_ITEM.exec(line)
    const kind = item ? 'item' : line.startsWith('>') ? 'quote' : line.startsWith('|') ? 'table' : 'words'
    if (kind === 'words' || kind !== last) out.push('')
    if (item) {
      const [, indent, bullet, box, number, words] = item
      const steps = Math.floor(indent.length / 4)
      if (last !== 'item') start = steps
      depth = last === 'item' ? Math.min(Math.max(steps - start, 0), depth + 1) : 0
      const marker = number ?? (box !== undefined ? `+ [${box}]` : bullet)
      out.push(`${' '.repeat(depth * 4)}${marker} ${words}`)
    } else out.push(kind === 'words' ? line.trimStart() : line)
    last = kind
  }
  return out.join('\n')
}

/** Apple Notes writes underlined words as `++words++`. Code is left as written. */
function underline(doc: Document) {
  replaceInText(doc, /\+\+([^+\s](?:[^+\n]*[^+\s])?)\+\+/g, (match) => {
    const under = doc.createElement('u')
    under.textContent = match[1]
    return under
  })
}

const FRONTMATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/
/**
 * Every line between the fences has to look like YAML — a key, a list item, an
 * indented continuation, a comment — so a note that merely opens with a rule
 * and closes a paragraph with another is not eaten as metadata.
 */
const YAML_LINE = /^(?:\s*(?:#.*)?|[^\s#:-][^:]*:(?:\s.*)?|\s+\S.*|\s*-(?:\s.*)?)$/

/** Strips YAML frontmatter (Notesnook, Bear, Obsidian…) and reads the few fields Nib has a use for. */
function frontmatter(text: string): { meta: Meta; markdown: string } {
  const match = FRONTMATTER.exec(text)
  const lines = match?.[1]?.split(/\r?\n/) ?? []
  if (!match || !lines.every((line) => YAML_LINE.test(line))) return { meta: {}, markdown: text }

  const fields = new Map<string, string>()
  for (const line of lines) {
    const field = /^([^\s#:-][^:]*):\s*(.*)$/.exec(line)
    if (field) fields.set(field[1].trim().toLowerCase(), unquote(field[2]))
  }
  const pick = (keys: string[]) => keys.map((key) => fields.get(key)).find((value) => value)
  return {
    meta: {
      title: cleanTitle(pick(['title'])),
      createdAt: toTime(pick(CREATED)),
      updatedAt: toTime(pick(UPDATED)),
      pinned: flag(pick(['pinned'])),
    },
    markdown: text.slice(match[0].length),
  }
}

/**
 * A vault note's tags from its properties, as Obsidian has written them over
 * the years: a list under `tags:`, or on its own line, in brackets or not,
 * with commas or spaces between. A tag has no space in it.
 */
function propertyTags(text: string): string[] {
  const lines = FRONTMATTER.exec(text)?.[1]?.split(/\r?\n/) ?? []
  const at = lines.findIndex((line) => /^tags?:/i.test(line))
  if (at < 0 || !lines.every((line) => YAML_LINE.test(line))) return []
  const beside = lines[at].slice(lines[at].indexOf(':') + 1).trim()
  const under: string[] = []
  for (let i = at + 1; !beside && /^\s*-\s/.test(lines[i] ?? ''); i++) under.push(lines[i].replace(/^\s*-\s+/, ''))
  const written = beside ? beside.replace(/^\[|\]$/g, '').split(/[,\s]+/) : under
  return written.map((tag) => unquote(tag).replace(/^#/, '').trim()).filter(Boolean)
}

/** A YAML scalar's text. Notesnook writes its titles JSON-quoted. */
function unquote(value: string): string {
  const text = value.trim()
  // A block scalar's text is on the lines below, which this does not read.
  if (/^[|>][+-]?$/.test(text)) return ''
  if (text.startsWith('"')) {
    try {
      return String(JSON.parse(text))
    } catch {
      return text.replace(/^"|"$/g, '')
    }
  }
  if (text.length > 1 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'")
  return text
}

function cleanTitle(value: unknown): string | undefined {
  return typeof value === 'string' && squash(value) ? squash(value) : undefined
}

/** Yes and no as the apps write them: booleans, 0 and 1, or their words. */
function flag(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'yes') return true
  if (value === false || value === 0 || value === '0' || value === 'false' || value === 'no') return false
  return undefined
}

const APPLE_EPOCH = Date.UTC(2001, 0, 1)

/**
 * Epoch milliseconds, or undefined for anything that is not clearly a date.
 *
 * Strings: ISO 8601; Evernote's `20200131T120000Z`; and Notesnook's
 * `31-01-2020 12:00 PM`, day first and in the exporter's local time, which
 * `Date.parse` would read month first or not at all. Numbers: milliseconds,
 * Unix seconds, or — below a billion, which as Unix seconds would be before
 * 2001 — seconds since 2001, the count Apple's Core Data stores. Digits in a
 * string count as a timestamp only from a billion up, so a frontmatter
 * `date: 2020` stays the year it says.
 */
function toTime(value: unknown): number | undefined {
  let time = NaN
  const text = typeof value === 'string' ? value.trim() : ''
  const stamp = typeof value === 'number' ? value : /^\d{10,}(\.\d+)?$/.test(text) ? Number(text) : NaN
  if (typeof value === 'number' || Number.isFinite(stamp)) {
    if (stamp > 0) time = stamp >= 1e11 ? stamp : stamp >= 1e9 ? stamp * 1000 : APPLE_EPOCH + stamp * 1000
  } else if (text) {
    const evernote = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(text)
    const notesnook = /^(\d{2})-(\d{2})-(\d{4}) (\d{1,2}):(\d{2})(?: ?([AP])M)?$/i.exec(text)
    if (evernote) {
      const [, y, mo, d, h, mi, s] = evernote.map(Number)
      time = Date.UTC(y, mo - 1, d, h, mi, s)
    } else if (notesnook) {
      const [, d, mo, y, h, mi] = notesnook.map(Number)
      const half = notesnook[6]?.toUpperCase()
      const hours = half ? (h % 12) + (half === 'P' ? 12 : 0) : h
      time = new Date(y, mo - 1, d, hours, mi).getTime()
    } else time = Date.parse(text)
  }
  return isTime(time) ? time : undefined
}

// ---------------------------------------------------------------------------
// Simplenote

/**
 * A `.json` file: Simplenote's `notes.json`, one note of Google Keep's, or a
 * Nib backup picked in the wrong place. Says which app's it was: Simplenote's
 * zip also holds a `.txt` copy of every note, and Keep's an `.html` one, that
 * must not come in a second time. `beside` is for what a Keep note keeps
 * beside it: its pictures, and the files it has that Nib leaves.
 */
function addJson(run: Run, text: string, name: string, beside?: Beside): 'simplenote' | 'keep' | null {
  let data: unknown = null
  try {
    data = JSON.parse(text)
  } catch {
    // Reported below, the same as any other JSON Nib does not know.
  }
  if (isRecord(data) && data.kind === BACKUP_KIND) {
    run.skipped.push(NIB_BACKUP)
    return null
  }
  if (isKeep(data)) {
    addKeep(run, data, beside)
    return 'keep'
  }
  // What Zoho Notebook's ZNote export says of a notebook, in the notebook's folder: no note, and nothing left out (an empty notebook has only this).
  if (isRecord(data) && data.data_type === 'NOTEBOOK' && typeof data.notebook_id === 'string') return null
  if (!isRecord(data) || !Array.isArray(data.activeNotes)) {
    run.skipped.push(`${name}: not a format Nib reads`)
    return null
  }
  for (const note of data.activeNotes) {
    try {
      addSimplenote(run, note)
    } catch {
      count(run, 'unreadable')
    }
  }
  if (Array.isArray(data.trashedNotes) && data.trashedNotes.length) {
    count(run, 'simplenoteTrash', data.trashedNotes.length)
  }
  return 'simplenote'
}

/** The first line of a Simplenote note is already its title. */
function addSimplenote(run: Run, note: unknown) {
  if (!isRecord(note) || typeof note.content !== 'string') throw new Error('Not a Simplenote note')
  const meta: Meta = {
    createdAt: toTime(note.creationDate),
    updatedAt: toTime(note.lastModified),
    pinned: flag(note.pinned),
  }
  if (note.markdown === true) addHtml(run, markdownToHtml(note.content), meta)
  else addBody(run, plainBody(note.content), 'note', meta)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// ---------------------------------------------------------------------------
// Google Keep

/** What a note keeps beside it in its folder: a picture by the name the note gives, and a way to say a file there is accounted for. */
type Beside = { find: Find; seen: (name: string) => void }

/**
 * One note as Google Takeout writes it, a JSON file each: these are in every
 * one, whatever language the account (and so the folder) is in.
 */
const isKeep = (data: unknown): data is Record<string, unknown> =>
  isRecord(data) && typeof data.isTrashed === 'boolean' && typeof data.userEditedTimestampUsec === 'number' && (typeof data.textContent === 'string' || Array.isArray(data.listContent))

/** Keep counts time in millionths of a second. */
const fromUsec = (value: unknown) => (typeof value === 'number' ? toTime(Math.round(value / 1000)) : undefined)

/** Takeout has been seen to name a `.jpg` as `.jpeg` in the note, and may the other way. */
const otherJpeg = (name: string) => name.replace(/\.jpe?g$/i, (end) => (end.length === 4 ? '.jpeg' : '.jpg'))

/**
 * Keep writes bold, italics and underlining as the style of a span, which the
 * editor's own reading of HTML takes as it is. But it writes a heading bold
 * too, and that is a heading here without being bold as well.
 */
function keepHeadings(doc: Document) {
  for (const span of doc.querySelectorAll('h1 span[style], h2 span[style], h3 span[style]')) span.removeAttribute('style')
}

/**
 * A note of Keep's: its words (as HTML where Keep wrote that, which newer
 * exports do, else a paragraph a line) or its checklist, then its pictures.
 * One in the trash is left out, and a voice recording is: both counted.
 */
function addKeep(run: Run, note: Record<string, unknown>, beside?: Beside) {
  const attachments = (Array.isArray(note.attachments) ? note.attachments : []).filter(isRecord).filter((file) => typeof file.filePath === 'string') as { filePath: string; mimetype?: unknown }[]
  const find: Find = (src) => beside?.find(src) ?? beside?.find(otherJpeg(src)) ?? null
  if (note.isTrashed) {
    // What it had goes with it, unreported.
    for (const { filePath } of attachments) for (const name of [filePath, otherJpeg(filePath)]) beside?.seen(name)
    return count(run, 'keepTrash')
  }
  const doc = new DOMParser().parseFromString('', 'text/html')
  const element = (tag: string, text?: string) => {
    const made = doc.createElement(tag)
    if (text !== undefined) made.textContent = text
    return made
  }
  // Keep's own HTML, read the one way the page's policy lets text become HTML (lib/trustedTypes): never set on an element.
  const parsed = (html: string) => [...new DOMParser().parseFromString(html, 'text/html').body.childNodes]
  if (typeof note.textContentHtml === 'string') doc.body.append(...parsed(note.textContentHtml))
  else if (typeof note.textContent === 'string') {
    // Keep ends a note's words with a new line where a picture follows, and writes none as "": neither is a line of the note's.
    const words = note.textContent.replace(/\s+$/, '')
    if (words) doc.body.append(...words.split(/\r?\n/).map((line) => element('p', line)))
  }
  if (Array.isArray(note.listContent)) {
    const list = element('ul')
    list.setAttribute('data-type', 'taskList')
    for (const entry of note.listContent.filter(isRecord)) {
      const item = element('li')
      item.setAttribute('data-type', 'taskItem')
      item.setAttribute('data-checked', String(entry.isChecked === true))
      if (typeof entry.textHtml === 'string') item.append(...parsed(entry.textHtml))
      else item.append(element('p', typeof entry.text === 'string' ? entry.text : ''))
      list.append(item)
    }
    doc.body.append(list)
  }
  // A page's link Keep kept with the note: under its words, by the page's name, unless they hold its address already.
  const words = doc.body.textContent ?? ''
  for (const link of (Array.isArray(note.annotations) ? note.annotations : []).filter(isRecord)) {
    if (typeof link.url !== 'string' || !/^https?:\/\//i.test(link.url) || words.includes(link.url)) continue
    const anchor = element('a', cleanTitle(link.title) ?? link.url)
    anchor.setAttribute('href', link.url)
    const line = element('p')
    line.append(anchor)
    doc.body.append(line)
  }
  for (const { filePath, mimetype } of attachments) {
    if (typeof mimetype === 'string' && mimetype.startsWith('audio/')) {
      beside?.seen(filePath)
      count(run, 'keepRecordings')
      continue
    }
    const image = element('img')
    image.setAttribute('src', filePath)
    const line = element('p')
    line.append(image)
    doc.body.append(line)
  }
  const labels = (Array.isArray(note.labels) ? note.labels : []).filter(isRecord).map((label) => label.name).filter((name): name is string => typeof name === 'string')
  const meta: Meta = {
    title: cleanTitle(note.title),
    createdAt: fromUsec(note.createdTimestampUsec) ?? fromUsec(note.userEditedTimestampUsec),
    updatedAt: fromUsec(note.userEditedTimestampUsec),
    pinned: flag(note.isPinned) || undefined,
    archived: flag(note.isArchived) || undefined,
    tags: labels,
    filing: 'Keep’s labels',
  }
  addHtml(run, doc.body.innerHTML, meta, { find, prepare: keepHeadings })
}

// ---------------------------------------------------------------------------
// Joplin

/** What Joplin calls each kind of item in its export, in the item's `type_`. */
const JOPLIN = { note: '1', notebook: '2', file: '4', tag: '5', tagged: '6' }
/** How a note points at another item of the export, a picture or a file or another note: by its id. */
const JOPLIN_REF = /^:\/([0-9a-f]{32})/

/**
 * A link to another note of the same import, written as the library links
 * what it imports (lib/links): by the note's title, and by the words it was
 * shown by where they differ. A title that holds the link's own marks would
 * break it, and is left as the words; words that hold them aren't put in it.
 */
const wikiLink = (title: string, shown: string) => (/[[\]|#^]/.test(title) ? shown : same(title, shown) || /[[\]|]/.test(shown) ? `[[${title}]]` : `[[${title}|${shown}]]`)

/**
 * One item of a Joplin export: what leads it (a note's title and words, a
 * notebook's or a tag's name) and, after its last blank line, what Joplin
 * knows of it, a line a field.
 */
function joplinItem(text: string): { lead: string; fields: Map<string, string> } {
  const cut = text.lastIndexOf('\n\n')
  const fields = new Map<string, string>()
  for (const line of text.slice(cut < 0 ? 0 : cut + 2).split('\n')) {
    const colon = line.indexOf(':')
    if (colon > 0) fields.set(line.slice(0, colon), line.slice(colon + 1).trim())
  }
  return { lead: cut < 0 ? '' : text.slice(0, cut), fields }
}

/**
 * Joplin's own export, a JEX: a tar of one `.md` an item, named by its id, and
 * the files notes hold under `resources/`. Each note comes in with its title,
 * its words (Markdown, or HTML where Joplin kept a clipped page as that), the
 * dates Joplin shows, its notebook and its tags. What's in Joplin's trash and
 * what it encrypted are left out, counted; a to-do comes in as a note.
 */
function addJex(run: Run, opened: Opened) {
  const decoder = new TextDecoder()
  const items = opened.paths.filter((path) => /^[0-9a-f]{32}\.md$/.test(path)).map((path) => joplinItem(decoder.decode(opened.files.get(path))))
  const of = (type: string) => items.filter((item) => item.fields.get('type_') === type)
  const named = (type: string) => new Map(of(type).map((item) => [item.fields.get('id') ?? '', squash(item.lead.split('\n')[0])]))
  const [titles, notebooks, tags] = [named(JOPLIN.note), named(JOPLIN.notebook), named(JOPLIN.tag)]
  const tagsOf = new Map<string, string[]>()
  for (const { fields } of of(JOPLIN.tagged)) {
    const [note, tag] = [fields.get('note_id') ?? '', tags.get(fields.get('tag_id') ?? '')]
    if (tag) tagsOf.set(note, [...(tagsOf.get(note) ?? []), tag])
  }
  /** Each file a note may hold, by its id. */
  const resources = new Map<string, string>()
  for (const path of opened.paths) {
    const id = /^resources\/([0-9a-f]{32})(?:\.[^/]*)?$/.exec(path)?.[1]
    if (id) resources.set(id, path)
  }
  const find: Find = (src) => pictureIn(opened, resources.get(JOPLIN_REF.exec(src)?.[1] ?? ''))
  /** A link to another note becomes one by its title, as the library links what it imports (lib/links); one to a file Nib doesn't bring in, the words it was shown by. */
  const links = (doc: Document) => {
    for (const anchor of doc.querySelectorAll('a[href^=":/"]')) {
      const id = JOPLIN_REF.exec(anchor.getAttribute('href')!)?.[1] ?? ''
      const shown = anchor.textContent ?? ''
      const title = titles.get(id)
      if (resources.has(id)) count(run, 'joplinFiles')
      anchor.replaceWith(title ? wikiLink(title, shown) : shown)
    }
  }
  for (const { lead, fields } of of(JOPLIN.note)) {
    if (Number(fields.get('deleted_time')) > 0) {
      count(run, 'joplinTrash')
      continue
    }
    if (fields.get('encryption_applied') === '1') {
      count(run, 'joplinLocked')
      continue
    }
    if (fields.get('is_todo') === '1') count(run, 'joplinTodos')
    const end = lead.indexOf('\n')
    const words = end < 0 ? '' : lead.slice(end + 1)
    const meta: Meta = {
      title: cleanTitle(end < 0 ? lead : lead.slice(0, end)),
      // The dates a person sees and can set, before the ones Joplin keeps for itself.
      createdAt: toTime(fields.get('user_created_time') || fields.get('created_time')),
      updatedAt: toTime(fields.get('user_updated_time') || fields.get('updated_time')),
      folder: notebooks.get(fields.get('parent_id') ?? '') || undefined,
      tags: tagsOf.get(fields.get('id') ?? '') ?? [],
      filing: 'Joplin’s notebooks and tags',
    }
    try {
      if (fields.get('markup_language') === '2') addHtml(run, words, meta, { find, prepare: links })
      else addMarkdown(run, words, find, meta, links)
    } catch {
      count(run, 'unreadable')
    }
  }
}

// ---------------------------------------------------------------------------
// Evernote

type Resource = { bytes: Uint8Array; type: string | null; name: string }

/** The src an `<en-media>` picture carries until its bytes are inlined. */
const MEDIA = 'en-media:'

/**
 * ENML's own elements are written self-closing, which only XML honours. Read
 * as HTML (which, unlike XML, survives `&nbsp;` and the other entities ENML is
 * full of), everything after one would end up inside it. The space before
 * `/>` is trimmed apart: matched in the pattern, a long run of it took seconds.
 * And a tag's attributes stop at the next `<`: from every unclosed tag,
 * `[^>]*` ran to the end of the note, and 40,000 of them took five seconds.
 */
const SELF_CLOSING = /<(en-media|en-todo)\b([^<>]*)\/>/gi

function addEnex(run: Run, text: string, name: string) {
  const xml = new DOMParser().parseFromString(text, 'application/xml')
  if (xml.querySelector('parsererror') || xml.documentElement.tagName !== 'en-export') {
    run.skipped.push(`${name}: couldn’t be read`)
    return
  }
  for (const note of Array.from(xml.getElementsByTagName('note'))) {
    try {
      addEnexNote(run, note)
    } catch {
      count(run, 'unreadable')
    }
  }
}

function addEnexNote(run: Run, note: Element) {
  // `<en-media hash>` names a resource by the MD5 of its decoded bytes; the
  // file holds no other link between the two.
  const resources = new Map<string, Resource>()
  for (const resource of Array.from(note.children).filter((child) => child.tagName === 'resource')) {
    try {
      const bytes = fromBase64(textOf(field(resource, 'data')))
      const mime = textOf(field(resource, 'mime')).trim().toLowerCase()
      const name = textOf(field(field(resource, 'resource-attributes'), 'file-name')).trim()
      resources.set(md5(bytes), { bytes, type: pictureType(mime), name: name || mime })
    } catch {
      // A damaged attachment costs only itself: its place shows as an attachment.
    }
  }

  const enml = textOf(field(note, 'content')).replace(
    SELF_CLOSING,
    (_, tag: string, attributes: string) => `<${tag}${attributes.trimEnd()}></${tag}>`,
  )
  const meta: Meta = {
    title: cleanTitle(textOf(field(note, 'title'))),
    createdAt: toTime(textOf(field(note, 'created'))),
    updatedAt: toTime(textOf(field(note, 'updated'))),
  }
  addHtml(run, enml, meta, {
    prepare: (doc) => fromEnml(doc, resources),
    find: (src) => {
      const resource = src.startsWith(MEDIA) ? resources.get(src.slice(MEDIA.length)) : undefined
      return resource?.type ? { bytes: resource.bytes, type: resource.type } : null
    },
  })
}

/** ENML's own elements, rewritten into the HTML Nib's schema reads. */
function fromEnml(doc: Document, resources: Map<string, Resource>) {
  for (const crypt of doc.querySelectorAll('en-crypt')) crypt.replaceWith('[encrypted text not imported]')

  for (const media of doc.querySelectorAll('en-media')) {
    const hash = (media.getAttribute('hash') ?? '').toLowerCase()
    const resource = resources.get(hash)
    if (resource?.type) {
      const image = doc.createElement('img')
      image.setAttribute('src', MEDIA + hash)
      media.replaceWith(image)
    } else {
      media.replaceWith(`[attachment: ${resource?.name || media.getAttribute('type') || 'unknown'}]`)
    }
  }

  // Evernote 10 writes a checklist as an ordinary list marked in its style.
  for (const list of doc.querySelectorAll('ul, ol')) {
    if (!/--en-todo\s*:\s*true/i.test(list.getAttribute('style') ?? '')) continue
    for (const item of Array.from(list.children)) {
      const checked = /--en-checked\s*:\s*true/i.test(item.getAttribute('style') ?? '')
      item.setAttribute('data-type', 'taskItem')
      item.setAttribute('data-checked', String(checked))
    }
    replaceWithTaskList(doc, list, Array.from(list.childNodes))
  }

  // Older notes put an <en-todo> at the start of a line. One alone on its line
  // becomes a task; anything less tidy keeps its box as text, so no checked
  // state is lost.
  for (const todo of doc.querySelectorAll('en-todo')) {
    if (!todo.isConnected) continue
    const line = todo.closest('div, p')
    const todos = line ? Array.from(line.querySelectorAll('en-todo')) : [todo]
    if (line && todos.length === 1 && !line.querySelector('div, p, ul, ol, table')) {
      const item = doc.createElement('li')
      item.setAttribute('data-type', 'taskItem')
      item.setAttribute('data-checked', String(isChecked(todo)))
      todo.remove()
      item.append(...line.childNodes)
      replaceWithTaskList(doc, line, [item])
    } else {
      for (const each of todos) each.replaceWith(isChecked(each) ? '[x] ' : '[ ] ')
    }
  }

  joinTaskLists(doc)
}

/** One task list per run of task lines, rather than one per line. */
function joinTaskLists(doc: Document) {
  for (const list of doc.querySelectorAll('ul[data-type="taskList"]')) {
    const previous = sibling(list, 'previous') as Element | null
    if (previous?.nodeType === 1 && previous.matches('ul[data-type="taskList"]')) {
      previous.append(...list.childNodes)
      list.remove()
    }
  }
}

function replaceWithTaskList(doc: Document, old: Element, items: Node[]) {
  const list = doc.createElement('ul')
  list.setAttribute('data-type', 'taskList')
  list.append(...items)
  old.replaceWith(list)
}

const isChecked = (todo: Element) => todo.getAttribute('checked')?.toLowerCase() === 'true'

/** A direct child element by name; ENEX's structure is fixed, so no deeper search is needed. */
const field = (parent: Element | undefined, name: string) =>
  parent ? Array.from(parent.children).find((child) => child.tagName === name) : undefined

const textOf = (element: Element | undefined) => element?.textContent ?? ''

/** The data URI type for a picture Nib stores, or null for anything else. */
function pictureType(mime: string): string | null {
  const type = mime === 'image/jpg' ? 'image/jpeg' : mime
  return [...PICTURES.values()].includes(type) ? type : null
}

// ---------------------------------------------------------------------------
// HTML (Notesnook, and any single page)

/**
 * Title from `<title>`, or the first `<h1>`; dates from `<meta>` (Notesnook
 * writes `created-at` and `updated-at`); text from `<body>`. A note of
 * UpNote's, a card of Zoho Notebook's or a page of FuseBase's is read its own
 * way (`addUpnote`, `addZoho`, `addFusebase`), with what `about` knows of it
 * from the rest of its export, and the file is said to have been that.
 */
function addHtmlFile(run: Run, text: string, find?: Find, about?: UpnoteAbout & ZohoAbout): 'upnote' | 'zoho' | 'fusebase' | null {
  const page = new DOMParser().parseFromString(text, 'text/html')
  const fusebase = page.querySelector(FUSEBASE)
  if (fusebase) {
    addFusebase(run, cleanTitle(page.title), fusebase, find)
    return 'fusebase'
  }
  const editor = page.querySelector('.shine-editor')
  if (editor) {
    addUpnote(run, editor, find, about)
    return 'upnote'
  }
  const card = zohoPage(page)
  if (card) {
    addZoho(run, card, find, about)
    return 'zoho'
  }
  const metas = new Map<string, string>()
  for (const meta of page.querySelectorAll('meta[name]')) {
    metas.set(meta.getAttribute('name')!.toLowerCase(), meta.getAttribute('content') ?? '')
  }
  const pick = (keys: string[]) => keys.map((key) => metas.get(key)).find((value) => value)
  const meta: Meta = {
    title: cleanTitle(page.title) ?? cleanTitle(page.querySelector('h1')?.textContent),
    createdAt: toTime(pick(CREATED)),
    updatedAt: toTime(pick(UPDATED)),
    pinned: flag(pick(['pinned'])),
  }
  addHtml(run, page.body.innerHTML, meta, { find })
  return null
}

// ---------------------------------------------------------------------------
// ColorNote

/** ColorNote's numbers for where a note is and what it is. */
const COLORNOTE = { trash: 16, deleted: 32, archive: 16, checklist: 16, own: 256 }
/** A title ColorNote gave a note that had none: its day, in brackets, as the phone writes a day. */
const COLORNOTE_DAY = /^\([\d./\- ]+\)$/

/**
 * ColorNote's backup (lib/colornote): opened with the password its own
 * backups have and, if that isn't it, with the one `ask` gets, asked for
 * again while it's wrong. Not given one, the backup isn't opened, and that
 * is said.
 */
async function addColornote(run: Run, bytes: Uint8Array, name: string, ask?: AskPassword) {
  if (!isColornote(bytes)) return void run.skipped.push(`${name}: not a format Nib reads`)
  let notes = await openColornote(bytes, COLORNOTE_AUTOMATIC)
  for (let again = false; !notes; again = true) {
    const password = (await ask?.({ name, again })) ?? null
    if (password === null) return void run.skipped.push(`${name}: not opened, without its password`)
    notes = await openColornote(bytes, password)
  }
  for (const note of notes) {
    try {
      addColornoteNote(run, note)
    } catch {
      count(run, 'unreadable')
    }
  }
}

/**
 * One note of ColorNote's: plain words, a line a line, or a checklist, whose
 * lines open `[ ]` or `[V]`. Its title is left off where ColorNote made it
 * of the note's own first words, or of its day. What's in ColorNote's trash
 * and what it locked are left out, counted; what it has deleted and its own
 * settings, which it keeps as notes, are passed over; its archive stays
 * archived. A note on its calendar comes in as a note, without its day.
 */
function addColornoteNote(run: Run, note: Record<string, unknown>) {
  if (note.type === COLORNOTE.own || note.active_state === COLORNOTE.own || note.active_state === COLORNOTE.deleted) return
  if (note.active_state === COLORNOTE.trash) return count(run, 'colornoteTrash')
  if (note.encrypted) return count(run, 'colornoteLocked')
  const words = (typeof note.note === 'string' ? note.note : '').replace(/\s+$/, '').split(/\r?\n/)
  const doc = new DOMParser().parseFromString('', 'text/html')
  for (const line of words) {
    const tick = note.type === COLORNOTE.checklist ? /^\[( |V)\] ?(.*)$/.exec(line) : null
    const made = doc.createElement(tick ? 'li' : 'p')
    made.textContent = tick ? tick[2] : line
    if (!tick) doc.body.append(made)
    else {
      made.setAttribute('data-type', 'taskItem')
      made.setAttribute('data-checked', String(tick[1] === 'V'))
      const list = doc.createElement('ul')
      list.setAttribute('data-type', 'taskList')
      list.append(made)
      doc.body.append(list)
    }
  }
  joinTaskLists(doc)
  const title = cleanTitle(note.title)
  const own = title && !COLORNOTE_DAY.test(title) && !squash(words[0]).startsWith(title)
  const meta: Meta = { title: own ? title : undefined, createdAt: toTime(note.created_date), updatedAt: toTime(note.modified_date), archived: note.space === COLORNOTE.archive || undefined }
  addHtml(run, doc.body.innerHTML, meta)
}

// ---------------------------------------------------------------------------
// FuseBase

/** Where a page of FuseBase's export keeps its words. */
const FUSEBASE = '#note-editor .nedit-root'

/**
 * One page of FuseBase's (Nimbus Note's, before), which exports a page at a
 * time: its words as FuseBase draws them, made what the editor reads. A list
 * is written flat, each item saying how far in it is and whether it is
 * ticked or numbered: it becomes the lists inside lists it shows as. A table
 * loses the row numbers, the gap beside them and the totals drawn around its
 * own cells. Code loses the name of its language written over it; a bookmark
 * becomes a link by the page's name; a link to another page stays one to it
 * on the web, which is all the export says of it. A file the page holds is
 * left, its name kept as words, and counted. No dates or tags: the export has
 * none.
 */
function addFusebase(run: Run, title: string | undefined, editor: Element, find?: Find) {
  const prepare = (doc: Document) => {
    for (const drawn of doc.querySelectorAll('.empty-caption, .image-comments-counter, .syntax-control-wrapper, tfoot')) drawn.remove()
    for (const number of doc.querySelectorAll('.table-head-start, tbody .table-head-item')) {
      const gap = number.nextElementSibling
      if (gap && !gap.textContent!.trim()) gap.remove()
      number.remove()
    }
    for (const list of doc.querySelectorAll('ul.editor-list')) {
      const items = [...list.children]
      const [ticks, numbered] = ['checkbox', 'number'].map((kind) => items[0]?.classList.contains(`list-item-${kind}`))
      const made = () => {
        const inner = doc.createElement(numbered ? 'ol' : 'ul')
        if (ticks) inner.setAttribute('data-type', 'taskList')
        return inner
      }
      const open = [{ level: 0, list: made() }]
      for (const item of items) {
        const level = Number(/\bindent-(\d+)\b/.exec(item.className)?.[1] ?? 0)
        while (open.length > 1 && open.at(-1)!.level > level) open.pop()
        const under = open.at(-1)!.list.lastElementChild
        if (level > open.at(-1)!.level && under) {
          open.push({ level, list: made() })
          under.append(open.at(-1)!.list)
        }
        if (ticks) item.setAttribute('data-type', 'taskItem')
        open.at(-1)!.list.append(item)
      }
      list.replaceWith(open[0].list)
    }
    // Code is written with a new line after its last, which is no line of it.
    for (const code of doc.querySelectorAll('syntax pre')) {
      const last = code.lastChild
      if (last?.nodeType === 3) last.textContent = last.textContent!.replace(/\n$/, '')
    }
    // A picture is drawn inside a link to its own file.
    for (const image of doc.querySelectorAll('.image-container a > img')) image.parentElement!.replaceWith(image)
    for (const held of doc.querySelectorAll('.file-wrapper')) {
      count(run, 'fusebaseFiles')
      const name = doc.createElement('p')
      name.textContent = ['main', 'ext'].map((part) => held.querySelector(`.file-name-${part}`)?.textContent ?? '').join('')
      held.replaceWith(name)
    }
    for (const bookmark of doc.querySelectorAll('.nimbus-bookmark')) {
      const link = doc.createElement('a')
      link.setAttribute('href', bookmark.querySelector('a[href]')?.getAttribute('href') ?? '')
      link.textContent = squash(bookmark.querySelector('.nimbus-bookmark__info__name')?.textContent ?? '') || link.getAttribute('href')
      const line = doc.createElement('p')
      line.append(link)
      bookmark.replaceWith(line)
    }
    // A mention of another page is its link between two marks that draw nothing.
    for (const mention of doc.querySelectorAll('mention')) mention.replaceWith(mention.querySelector('a') ?? (mention.textContent ?? '').replace(/\uFEFF/g, ''))
  }
  addHtml(run, editor.innerHTML, { title }, { find, prepare })
}

// ---------------------------------------------------------------------------
// Zoho Notebook

/** A card, from either form of Zoho's export: its name, its dates as Zoho wrote them, its notebook where the card itself says, its tags, and its words as HTML. */
type ZohoCard = { title?: string; created?: unknown; modified?: unknown; notebook?: string; tags: string[]; html: string }
/** What the rest of an export says of a card: what another card it links to is called, by that card's id. */
type ZohoAbout = { titleOf?: (id: string) => string | undefined }

/** How a card points at another: by its id. */
const ZOHO_LINK = /^zohonotebook:\/\/notes\/([\w-]+)/
/** The page Zoho's HTML export lists its cards on. */
const ZOHO_INDEX = /<title>Notebook Exported data<\/title>/i
/** Zoho writes this for a card with no name, a picture or a sketch mostly: it has none here either. */
const zohoTitle = (name: unknown) => (cleanTitle(name) === 'Untitled' ? undefined : cleanTitle(name))
/** A file a card holds is written self-closing, which only XML honours: read as HTML, what followed one would end up inside it (as ENML's are, above). */
const ZOHO_HELD = /<(znresource)\b([^<>]*)\/>/gi

function json(text: string | null | undefined): unknown {
  try {
    return JSON.parse(text ?? '')
  } catch {
    return null
  }
}

/** A card of the HTML export: what Zoho knows of it is JSON in the attributes of its page's body. Null for a page that is no card. */
function zohoPage(page: Document): ZohoCard | null {
  const { body } = page
  if (!body.hasAttribute('data-notecard')) return null
  const about = (name: string) => {
    const value = json(body.getAttribute(name))
    return isRecord(value) ? value : {}
  }
  const [card, notebook, tags] = [about('data-notecard'), about('data-notebook'), json(body.getAttribute('data-tag'))]
  return {
    title: zohoTitle(card.name),
    created: card.created_date,
    modified: card.modified_date,
    notebook: cleanTitle(notebook.name),
    tags: (Array.isArray(tags) ? tags : []).filter((tag): tag is string => typeof tag === 'string'),
    html: body.innerHTML,
  }
}

/** A card of the ZNote export, from its `Note.znel`: XML, with the card's words as HTML in `ZContent`. Null for what is no card. */
function zohoZnel(xml: string): ZohoCard | null {
  const note = new DOMParser().parseFromString(xml, 'application/xml').documentElement
  if (note.tagName !== 'ZNote') return null
  const text = (name: string) => note.getElementsByTagName(name)[0]?.textContent ?? undefined
  return {
    title: zohoTitle(text('ZTitle')),
    created: text('ZCreatedDate'),
    modified: text('ZModifiedDate'),
    tags: [...note.getElementsByTagName('ZTag')].map((tag) => tag.textContent ?? '').filter(Boolean),
    html: (text('ZContent') ?? '').replace(ZOHO_HELD, (_, tag: string, attributes: string) => `<${tag}${attributes}></${tag}>`),
  }
}

/**
 * One card of Zoho Notebook's. What Zoho writes its own way is made what the
 * editor reads: its ticks, a box beside its words in the HTML export and
 * around them in ZNote, in blocks nested as the ticks were, become one
 * checklist a run; a picture it holds, a picture; a link to another card, one
 * by that card's name (`wikiLink`), or its words where the card isn't in the
 * export. A file it holds that is no picture is left, and counted.
 */
function addZoho(run: Run, card: ZohoCard, find?: Find, { titleOf }: ZohoAbout = {}, notebook?: string) {
  const prepare = (doc: Document) => {
    for (const nest of doc.querySelectorAll('div.checklist')) nest.replaceWith(...nest.childNodes)
    for (const box of doc.querySelectorAll('input[type="checkbox"], checkbox')) {
      const row = box.parentElement!
      const item = doc.createElement('li')
      item.setAttribute('data-type', 'taskItem')
      item.setAttribute('data-checked', String(box.hasAttribute('checked') && box.getAttribute('checked') !== 'false'))
      if (box.tagName === 'INPUT') {
        box.remove()
        item.append(...row.childNodes)
      } else item.append(...box.childNodes)
      replaceWithTaskList(doc, row, [item])
    }
    // The HTML export puts each row in a block of its own: out of it, the lists of a run of rows meet.
    for (const list of doc.querySelectorAll('ul[data-type="taskList"]')) {
      const around = list.parentElement!
      if (around.tagName === 'DIV' && around.childNodes.length === 1) around.replaceWith(list)
    }
    joinTaskLists(doc)
    for (const held of doc.querySelectorAll('znresource')) {
      const path = held.getAttribute('relative-path') ?? ''
      if (PICTURES.has(extensionOf(path))) {
        const image = doc.createElement('img')
        image.setAttribute('src', path)
        held.replaceWith(image)
      } else {
        count(run, 'zohoFiles')
        held.remove()
      }
    }
    for (const link of doc.querySelectorAll('a[href^="zohonotebook://"]')) {
      const [title, shown] = [titleOf?.(ZOHO_LINK.exec(link.getAttribute('href')!)?.[1] ?? ''), link.textContent ?? '']
      link.replaceWith(title ? wikiLink(title, shown) : shown)
    }
  }
  const meta: Meta = { title: card.title, createdAt: toTime(card.created), updatedAt: toTime(card.modified), folder: card.notebook ?? notebook, tags: card.tags, filing: 'Zoho Notebook’s notebooks and tags' }
  addHtml(run, card.html, meta, { find, prepare })
}

// ---------------------------------------------------------------------------
// UpNote

/** What an UpNote note's export says of it outside its own file: the notebook it's in, and what another note it links to is called, by the link's address. */
type UpnoteAbout = { folder?: string; titleAt?: (href: string) => string | undefined }

/**
 * The first line of an UpNote note, which is its title: UpNote writes a line
 * as a block of its own, or as words ended by a `<br>`.
 */
function upnoteTitle(html: string): string {
  let line = ''
  const block = (node: Node) => node.nodeType === 1 && (node as Element).matches(BLOCKS)
  const ended = (node: Node): boolean => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) line += child.textContent
      else if (line.trim() && (child.nodeName === 'BR' || block(child))) return true
      else if (ended(child)) return true
    }
    return false
  }
  const editor = new DOMParser().parseFromString(html, 'text/html').querySelector('.shine-editor')
  if (editor) ended(editor)
  return squash(line)
}

/**
 * One note of UpNote's HTML export: its words are in `div.shine-editor`, and
 * its title is their first line. What UpNote writes its own way is made what
 * the editor reads: a list with ticks a checklist, a highlight of any colour
 * a highlight, a formula one. (A list inside a list, which UpNote puts beside
 * the item it is under, the editor's own reading already puts inside it.) A
 * hashtag is one of the note's tags, and stays in its words, its link to
 * UpNote dropped as any link to an app is. A link to another note becomes
 * one by that note's title (`wikiLink`), or its words where the note isn't
 * in the export. No date: the export has none but its files' own.
 */
function addUpnote(run: Run, editor: Element, find?: Find, { folder, titleAt }: UpnoteAbout = {}) {
  const tags = [...new Set([...editor.querySelectorAll('a[data-upnote-tag]')].map((tag) => tag.getAttribute('data-upnote-tag')!.replace(/^#/, '').trim()).filter(Boolean))]
  const prepare = (doc: Document) => {
    for (const item of doc.querySelectorAll('li[data-checked]')) {
      item.setAttribute('data-type', 'taskItem')
      item.parentElement!.setAttribute('data-type', 'taskList')
    }
    for (const highlight of doc.querySelectorAll('span[class*="shine-highlight"]')) rename(highlight, 'mark')
    for (const formula of doc.querySelectorAll('span[data-upnote-formula]')) {
      const math = doc.createElement('span')
      math.setAttribute('data-math', '')
      math.textContent = formula.getAttribute('data-upnote-formula')
      formula.replaceWith(math)
    }
    for (const link of doc.querySelectorAll('a[data-note-id]')) {
      const [title, shown] = [titleAt?.(link.getAttribute('href') ?? ''), link.textContent ?? '']
      link.replaceWith(title ? wikiLink(title, shown) : shown)
    }
  }
  addHtml(run, editor.innerHTML, { folder, tags, filing: 'UpNote’s notebooks and tags' }, { find, prepare })
}

// ---------------------------------------------------------------------------
// Zip archives: Simplenote, Bear, Notesnook, or any folder of notes

class Refused extends Error {}

/**
 * Two passes. The first reads only the zip's directory — a filter that returns
 * false inflates nothing — and refuses the archive before any work if it is
 * too big. The second unpacks just the entries the first counted, by their
 * place in the directory: by name, a picture left out for its size came back
 * in under the name of a small one. Each into a buffer of exactly the size the
 * directory declares, and no further (`inflated`), so refusing on the declared
 * sizes bounds memory and time even when an entry lies about its size. Only
 * the entries `take` wants are inflated, and of those no picture past
 * MAX_BYTES: it goes to `oversized`.
 * Throws Refused, or for a zip that isn't one, whatever fflate throws.
 */
function unzipChecked(bytes: Uint8Array, name: string, take: (path: string) => boolean, oversized: (path: string, size: number) => void = () => {}): Unzipped {
  const wanted: { entry: UnzipFileInfo; start: number }[] = []
  let entries = 0
  let work = 0
  const starts = checkLayout(bytes, name)
  const refused = () => new Refused(`${name}: couldn’t be opened`)
  unzipSync(bytes, {
    filter: (entry) => {
      // Checked first and on every entry: a forged directory can claim
      // billions of entries, and fflate would walk them all.
      const start = starts[entries]
      if (++entries > MAX_ENTRIES) throw tooMany(name)
      if (!take(entry.name)) return false
      if (start === undefined || (entry.compression !== 0 && entry.compression !== 8)) throw refused()
      // A stored file is copied as it is: its size is its real one, and
      // can't be more than it declares.
      if (entry.compression === 0 && entry.size > entry.originalSize) throw refused()
      if (PICTURES.has(extensionOf(entry.name)) && entry.originalSize > MAX_BYTES) {
        oversized(entry.name, entry.originalSize)
        return false
      }
      work += entry.size + entry.originalSize
      if (work > MAX_WORK) throw new Refused(`${name}: more than 128 MB to unpack, too large to open`)
      wanted.push({ entry, start })
      return false
    },
  })
  const files: Unzipped = {}
  for (const { entry, start } of wanted) {
    const data = bytes.subarray(start, start + entry.size)
    files[entry.name] = entry.compression ? inflated(data, entry.originalSize, refused) : data.slice()
  }
  return files
}

/**
 * A deflated file, unpacked no further than the size it declares. fflate's
 * own unzip goes on past the end of the buffer it's given, so the time it took
 * followed what the data really held, a thousand times its length, whatever
 * the directory said: 64 MB of it was minutes on the main thread.
 */
function inflated(data: Uint8Array, size: number, refused: () => Refused): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size)
  let filled = 0
  const stream = new Inflate((chunk) => {
    if (filled + chunk.length > size) throw refused()
    out.set(chunk, filled)
    filled += chunk.length
  })
  for (let at = 0; at < data.length; at += INFLATE_STEP) stream.push(data.subarray(at, at + INFLATE_STEP), at + INFLATE_STEP >= data.length)
  return out.subarray(0, filled)
}

/** An Obsidian vault's own folder, which every vault has: what is before it is the vault. */
const VAULT = /^((?:[^/.][^/]*\/)*)\.obsidian\//

/**
 * The folder Joplin's Markdown export keeps what notes hold in, at the top of
 * the export, made whether or not there is anything to keep: what is before
 * it is the export.
 */
const JOPLIN_FILES = /^((?:[^/.][^/]*\/)*)_resources\//

/** An archive opened: every file's path, the bytes of the documents and pictures in it, the pictures too large to keep, and the Obsidian vaults and the Joplin Markdown exports it holds. */
type Opened = { paths: string[]; files: Map<string, Uint8Array>; oversized: Map<string, number>; vaults: string[]; joplin: string[] }

/**
 * An archive of notes: `unpack` hands back the documents and pictures in it,
 * the ones `take` says yes to; anything else is only listed, for the report.
 * What it throws is said as the reason the archive wasn't opened.
 */
function openArchive(run: Run, name: string, unpack: (take: (path: string) => boolean, oversized: (path: string, size: number) => void) => Iterable<[string, Uint8Array]>): Opened | null {
  const paths: string[] = []
  /** The folder of each Obsidian vault in it, with its slash: empty for one zipped from the inside. */
  const vaults = new Set<string>()
  /** The folder of each Joplin Markdown export in it, the same way. */
  const joplin = new Set<string>()
  /** Pictures too large to keep, by name, with their size: never unpacked. */
  const oversized = new Map<string, number>()
  try {
    const take = (path: string) => {
      const vault = VAULT.exec(path)
      if (vault && !vault[1].startsWith('__MACOSX/')) vaults.add(vault[1].normalize('NFC'))
      const exported = JOPLIN_FILES.exec(path)
      if (exported && !exported[1].startsWith('__MACOSX/')) joplin.add(exported[1].normalize('NFC'))
      if (ignored(path)) return false
      paths.push(path)
      return worthReading(path)
    }
    const files = unpack(take, (path, size) => oversized.set(path, size))
    // macOS writes accented file names decomposed; the Markdown that refers to
    // them is usually composed. Normalising both lets the two meet.
    const composed = <T>(map: Iterable<[string, T]>) => new Map([...map].map(([path, value]) => [path.normalize('NFC'), value]))
    return {
      paths: paths.map((path) => path.normalize('NFC')),
      files: composed(files),
      oversized: composed(oversized),
      vaults: [...vaults],
      joplin: [...joplin],
    }
  } catch (error) {
    run.skipped.push(error instanceof Refused ? error.message : `${name}: couldn’t be opened`)
    return null
  }
}

/** A zip, its documents and pictures inflated (unzipChecked). */
const openZip = (run: Run, bytes: Uint8Array, name: string) => openArchive(run, name, (take, oversized) => Object.entries(unzipChecked(bytes, name, take, oversized)))

/**
 * A tar, gzipped or not. Its files are in it as they are, so nothing is
 * unpacked and none is copied: a plain tar costs what it weighs, which the
 * limit on a file's size already bounds, and a gzipped one what `gunzipChecked`
 * lets it unpack to. Limited as a zip is in how many files. Twice as many
 * records as files are walked: Takeout writes one before every file.
 */
function openTar(run: Run, bytes: Uint8Array, name: string, gzipped: boolean): Opened | null {
  return openArchive(run, name, (take) => {
    const tar = gzipped ? gunzipChecked(bytes, name) : bytes
    let entries
    try {
      entries = tarEntries(tar, MAX_ENTRIES * 2)
    } catch (error) {
      throw error instanceof RangeError ? tooMany(name) : error
    }
    if (entries.length > MAX_ENTRIES) throw tooMany(name)
    const files: [string, Uint8Array][] = []
    for (const entry of entries) {
      // A tar made from inside its folder names every file from "./".
      const path = entry.name.replace(/^(?:\.\/)+/, '')
      if (take(path)) files.push([path, tar.subarray(entry.start, entry.start + entry.size)])
    }
    return files
  })
}

/**
 * A gzipped file, unpacked no further than the size its last four bytes say,
 * and not at all when that is more than Nib unpacks: as a zip's files are
 * (`inflated`), so one that says less than it holds stops there.
 */
function gunzipChecked(bytes: Uint8Array, name: string): Uint8Array {
  const refused = () => new Refused(`${name}: couldn’t be opened`)
  // What every gzip opens with: without it, its last bytes say nothing of a size.
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw refused()
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 4, true)
  if (size > MAX_WORK) throw new Refused(`${name}: more than 128 MB to unpack, too large to open`)
  const out = new Uint8Array(size)
  let filled = 0
  const stream = new Gunzip((chunk) => {
    // Past the size it said, this throws: there is no room for it.
    out.set(chunk, filled)
    filled += chunk.length
  })
  for (let at = 0; at < bytes.length; at += INFLATE_STEP) stream.push(bytes.subarray(at, at + INFLATE_STEP), at + INFLATE_STEP >= bytes.length)
  return out.subarray(0, filled)
}

const tooMany = (name: string) => new Refused(`${name}: more than 10,000 files, too many to open`)

/**
 * Reads the zip's own directory for where each file's data lies, which fflate
 * doesn't say, and refuses files whose data overlaps: each would be unpacked
 * again, so a few MB pointed at many times unpacked to hundreds. Anything that
 * doesn't add up (a ZIP64 archive among them, which no export Nib reads
 * needs) throws, and is reported as a zip that couldn't be opened. Returns
 * where each file's data starts, in the directory's order.
 */
function checkLayout(bytes: Uint8Array, name: string): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The directory's end record, which a comment of up to 64 KB can follow.
  let end = bytes.length - 22
  while (view.getUint32(end, true) !== 0x06054b50) {
    if (bytes.length - end > 22 + 0xffff) throw new Refused(`${name}: couldn’t be opened`)
    end--
  }
  // Read where fflate reads: this record's count at +8, and a ZIP64 record's
  // count and directory instead when there is one. Reading others, a
  // harmless directory could pass here while fflate unpacked another.
  let count = view.getUint16(end + 8, true)
  let directory = view.getUint32(end + 16, true)
  if (end >= 20 && view.getUint32(end - 20, true) === 0x07064b50) {
    const record = view.getUint32(end - 12, true)
    if (record + 56 <= bytes.length && view.getUint32(record, true) === 0x06064b50) {
      count = view.getUint32(record + 32, true)
      directory = view.getUint32(record + 48, true)
    }
  }
  if (count > MAX_ENTRIES) throw tooMany(name)
  const spans: [start: number, end: number][] = []
  const starts: number[] = []
  for (let i = 0, at = directory; i < count; i++) {
    const local = view.getUint32(at + 42, true)
    if (view.getUint32(at, true) !== 0x02014b50 || view.getUint32(local, true) !== 0x04034b50) {
      throw new Refused(`${name}: couldn’t be opened`)
    }
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    spans.push([local, data + view.getUint32(at + 20, true)])
    starts.push(data)
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  spans.sort((a, b) => a[0] - b[0])
  for (let i = 1; i < spans.length; i++) {
    if (spans[i][0] < spans[i - 1][1]) throw new Refused(`${name}: couldn’t be opened`)
  }
  return starts
}

/** Folders, Finder's `__MACOSX` copies, and dotfiles like `.DS_Store`. */
const ignored = (path: string) =>
  path.endsWith('/') || path.startsWith('__MACOSX/') || path.split('/').some((part) => part.startsWith('.'))

const worthReading = (path: string) => {
  const extension = extensionOf(path)
  return MARKDOWN.has(extension) || HTML.has(extension) || extension === 'enex' || extension === 'json' || extension === 'znote' || PICTURES.has(extension)
}

/** The picture at a path in an archive: its bytes, or for one too large to keep, only how large it is. */
function pictureIn({ files, oversized }: Opened, path: string | undefined): Picture | null {
  const type = path ? PICTURES.get(extensionOf(path)) : undefined
  if (!path || !type) return null
  const data = files.get(path)
  if (data) return { bytes: data, type }
  const size = oversized.get(path)
  return size === undefined ? null : { bytes: new Uint8Array(0), type, size }
}

/**
 * A TextBundle is a folder named `*.textbundle` holding `text.md` (or
 * `.markdown`, `.txt`), `info.json` and `assets/`. A `.textpack` may hold one
 * with its files at the top of the zip.
 */
const BUNDLE_TEXT = /^text\.(md|markdown|txt)$/i

function addArchive(run: Run, opened: Opened, packed: boolean) {
  const { paths, vaults, joplin } = opened
  const decoder = new TextDecoder()
  /** Files that went into a document one way or another; the rest are reported. */
  const used = new Set<string>()
  const read = (path: string) => {
    used.add(path)
    return decoder.decode(opened.files.get(path))
  }
  const pictureAt = (path: string | undefined): Picture | null => {
    const found = pictureIn(opened, path)
    if (found) used.add(path!)
    return found
  }
  const findIn =
    (folder: string): Find =>
    (src) => {
      for (const ref of new Set([src, safeDecode(src)])) {
        const found = pictureAt(resolvePath(folder, ref)?.normalize('NFC'))
        if (found) return found
      }
      return null
    }
  /** The vault a file is in, the innermost where one holds another. */
  const vaultOf = (path: string) => vaults.filter((root) => path.startsWith(root)).sort((a, b) => b.length - a.length)[0]
  /** A vault's pictures by name alone, whatever its capitals: the first of a name, where folders hold two. */
  const named = new Map<string, Map<string, string>>()
  const namedIn = (root: string) => {
    if (!named.has(root)) {
      const names = new Map<string, string>()
      for (const path of paths) {
        const name = nameOf(path).toLowerCase()
        if (path.startsWith(root) && PICTURES.has(extensionOf(path)) && !names.has(name)) names.set(name, path)
      }
      named.set(root, names)
    }
    return named.get(root)!
  }
  /** Obsidian's own way to a picture: beside the note or from the top of the vault, and by its name alone from anywhere in it. */
  const findInVault = (root: string, folder: string): Find => {
    const beside = findIn(folder)
    const fromTop = findIn(root)
    return (src) => beside(src) ?? fromTop(src) ?? (elsewhere(src) ? null : pictureAt(namedIn(root).get(nameOf(safeDecode(src)).normalize('NFC').toLowerCase())))
  }
  const attempt = (path: string, add: () => void) => {
    try {
      add()
    } catch {
      run.skipped.push(`${path}: couldn’t be read`)
    }
  }

  const listed = new Set(paths)
  /**
   * The notebook each note of an UpNote export is in. The export lists a
   * notebook's notes under `notebooks/<Notebook>/`, beside the notes
   * themselves: each a file of its note's name, holding the path to it or,
   * written on Windows, a shortcut. Of the notebooks a note is in, the first
   * listed; of one inside another, the one it is directly in.
   */
  const notebooks = new Map<string, string>()
  for (const path of paths) {
    const list = /^((?:[^/]+\/)*)notebooks\/((?:[^/]+\/)+)([^/]+\.html)(\.lnk)?$/i.exec(path)
    // A list's file holds a path up to its note, and nothing else: a page of words in such a folder is a page.
    if (!list || !(list[4] || /^(?:\.\.\/)+[^<>]*$/.test(decoder.decode(opened.files.get(path)).trim()))) continue
    used.add(path)
    const note = list[1] + list[3]
    if (!notebooks.has(note)) notebooks.set(note, list[2].split('/').at(-2)!)
  }
  // A page of FuseBase's has an `assets` folder beside it: its pictures and files, among FuseBase's own stylesheet
  // and fonts. None of it is a note, whatever kind of file, and none of it is said to be left: the page says what it held.
  for (const path of paths) {
    if (nameOf(path) !== 'note.html' || !new DOMParser().parseFromString(decoder.decode(opened.files.get(path)), 'text/html').querySelector(FUSEBASE)) continue
    for (const other of paths) if (other.startsWith(`${folderOf(path)}assets/`)) used.add(other)
  }

  /**
   * Zoho Notebook's ZNote export: a folder a notebook, named in its
   * `meta.json`, holding a `.znote` a card: a tar of the card's `Note.znel`
   * and the files it holds. Each is read once, for itself and for the cards
   * that link to it; null for one that is no card.
   */
  const cards = new Map<string, (ZohoCard & { find: Find }) | null>()
  const cardAt = (path: string) => {
    if (cards.has(path)) return cards.get(path)!
    let card: (ZohoCard & { find: Find }) | null = null
    try {
      const bytes = opened.files.get(path)!
      const entries = tarEntries(bytes, MAX_ENTRIES)
      const at = (entry: { start: number; size: number }) => bytes.subarray(entry.start, entry.start + entry.size)
      const znel = entries.find((entry) => nameOf(entry.name) === 'Note.znel')
      const found = znel && zohoZnel(decoder.decode(at(znel)))
      const find: Find = (src) => {
        const held = entries.find((entry) => entry.name === folderOf(znel!.name) + src)
        const type = PICTURES.get(extensionOf(src))
        return held && type ? { bytes: at(held), type } : null
      }
      if (found) card = { ...found, find }
    } catch {
      // No tar, so no card: said where it's asked for.
    }
    cards.set(path, card)
    return card
  }
  const znotes = new Map(paths.filter((path) => extensionOf(path) === 'znote').map((path) => [nameOf(path).slice(0, -'.znote'.length), path]))
  /** Each notebook's name, by its folder: its `meta.json` is the notebook's own, and no note. */
  const zohoBooks = new Map<string, string | undefined>()
  for (const path of znotes.values()) {
    const folder = folderOf(path)
    if (zohoBooks.has(folder)) continue
    const about = opened.files.has(`${folder}meta.json`) ? json(read(`${folder}meta.json`)) : null
    zohoBooks.set(folder, isRecord(about) ? cleanTitle(about.name) : undefined)
  }
  const addZnote = (path: string) => {
    used.add(path)
    const card = cardAt(path)
    if (!card) throw new Error('No card')
    addZoho(run, card, card.find, { titleOf: (id) => cardAt(znotes.get(id) ?? '')?.title }, zohoBooks.get(folderOf(path)))
  }

  /** One page of the archive: an UpNote note with its notebook and the notes it links to, and not its export's stylesheet; a card of Zoho's HTML export, and not its index; or any app's page. */
  const addPage = (path: string) => {
    const folder = folderOf(path)
    // What isn't a note of UpNote's, or isn't there, has no title to be found.
    const titleAt = (href: string) => {
      const at = resolvePath(folder, safeDecode(href))?.normalize('NFC')
      return at === undefined ? undefined : upnoteTitle(decoder.decode(opened.files.get(at)))
    }
    const titleOf = (id: string) => {
      const other = opened.files.get(`${folder}${id}.html`)
      return other && zohoPage(new DOMParser().parseFromString(decoder.decode(other), 'text/html'))?.title
    }
    const text = read(path)
    if (nameOf(path) === 'index.html' && ZOHO_INDEX.test(text)) return
    if (addHtmlFile(run, text, findIn(folder), { folder: notebooks.get(path), titleAt, titleOf }) === 'upnote') used.add(`${folder}styles.css`)
  }

  /** The Joplin Markdown export a file is in, the innermost; a vault's files are the vault's. */
  const exportOf = (path: string) => (vaultOf(path) === undefined ? joplin.filter((root) => path.startsWith(root) && !path.startsWith(`${root}_resources/`)).sort((a, b) => b.length - a.length)[0] : undefined)
  const isNote = (path: string) => extensionOf(path) === 'md' || HTML.has(extensionOf(path))
  /**
   * What each note of an export is called, by its file. Joplin names the file
   * by the title, cut to fifty characters and made safe for a file's name,
   * and writes the title itself only where it writes front matter.
   */
  const titles = new Map<string, string>()
  const titleOf = (path: string) => {
    if (!titles.has(path)) titles.set(path, frontmatter(decoder.decode(opened.files.get(path))).meta.title ?? nameOf(path).replace(/\.[^.]+$/, ''))
    return titles.get(path)!
  }
  /**
   * One note of a Joplin Markdown export: its words under whatever front
   * matter it has, in the notebook its folder is, the innermost. A link to
   * another note of the export, which Joplin writes as the path to its file,
   * becomes one by that note's title (`wikiLink`); any other path, which
   * leads nowhere once the note is in Nib, comes in as its words, and where
   * it led to a file in `_resources`, that is counted.
   */
  const addExported = (path: string, root: string) => {
    const text = read(path)
    const { meta, markdown } = frontmatter(text)
    const folder = folderOf(path)
    if (/^completed\?:/m.test(FRONTMATTER.exec(text)?.[1] ?? '')) count(run, 'joplinTodos')
    const known: Meta = { ...meta, title: titleOf(path), folder: folder.slice(root.length).split('/').at(-2), tags: propertyTags(text), filing: 'Joplin’s notebooks and tags' }
    const links = (doc: Document) => {
      for (const anchor of doc.querySelectorAll('a[href]')) {
        const href = anchor.getAttribute('href')!
        if (elsewhere(href)) continue
        const at = resolvePath(folder, safeDecode(href.split('#')[0]))?.normalize('NFC')
        const there = at !== undefined && listed.has(at) ? at : undefined
        const shown = anchor.textContent ?? ''
        if (there && exportOf(there) === root && isNote(there)) {
          anchor.replaceWith(wikiLink(titleOf(there), shown))
          continue
        }
        if (there?.startsWith(`${root}_resources/`)) {
          used.add(there)
          count(run, 'joplinFiles')
        }
        anchor.replaceWith(shown)
      }
    }
    if (HTML.has(extensionOf(path))) addHtml(run, markdown, known, { find: findIn(folder), prepare: links })
    else addMarkdown(run, markdown, findIn(folder), known, links)
  }

  // Each bundle's folder, mapped to its text file. Looked up by folder rather
  // than searched, because a Bear backup can hold thousands of them.
  const bundles = new Map<string, string>()
  for (const path of paths) {
    const folder = folderOf(path)
    const named = /\.textbundle\/$/i.test(folder) || (packed && !folder)
    if (named && BUNDLE_TEXT.test(path.slice(folder.length))) bundles.set(folder, path)
  }
  const bundleOf = (path: string) => (bundles.has('') ? '' : /^.*?\.textbundle\//i.exec(path)?.[0])
  const inBundle = (path: string) => {
    const folder = bundleOf(path)
    return folder !== undefined && bundles.has(folder)
  }
  /** Bundles left out on purpose (trashed, locked): their pictures go with them, unreported. */
  const dropped = new Set<string>()
  for (const [folder, text] of bundles) {
    used.add(text)
    attempt(text, () => {
      if (!addBundle(run, text, read, findIn(folder))) dropped.add(folder)
    })
  }

  let simplenote = false
  for (const path of paths) {
    if (extensionOf(path) !== 'json' || inBundle(path) || used.has(path)) continue
    attempt(path, () => {
      const folder = folderOf(path)
      const seen = (name: string) => {
        const at = resolvePath(folder, name)?.normalize('NFC')
        if (at) used.add(at)
      }
      const app = addJson(run, read(path), path, { find: findIn(folder), seen })
      if (app === 'simplenote') simplenote = true
      if (app !== 'keep') return
      // Takeout writes every note a second time as a page to look at, a list of the labels beside them,
      // and, a folder up, its own index of what it exported: none of them a note.
      used.add(`${path.slice(0, -'json'.length)}html`)
      used.add(`${folder}Labels.txt`)
      const above = folderOf(folder.slice(0, -1))
      if (/(?:^|\/)Takeout\/$/.test(above)) for (const other of paths) if (folderOf(other) === above && HTML.has(extensionOf(other))) used.add(other)
    })
  }

  for (const path of paths) {
    if (inBundle(path) || used.has(path)) continue
    // What a Joplin export's notes hold is no note, whatever kind of file it is.
    if (vaultOf(path) === undefined && joplin.some((root) => path.startsWith(`${root}_resources/`))) continue
    const extension = extensionOf(path)
    const exported = exportOf(path)
    if (exported !== undefined && (isNote(path) || nameOf(path) === '_folder.yml')) {
      // A notebook's icon, which the export with front matter writes beside its notes, is no file of anyone's.
      if (isNote(path)) attempt(path, () => addExported(path, exported))
      else used.add(path)
      continue
    }
    if (MARKDOWN.has(extension)) {
      // Simplenote's zip carries a `.txt` copy of every note in notes.json.
      if (simplenote && extension === 'txt') used.add(path)
      else {
        const vault = vaultOf(path)
        // In Obsidian a note is called what its file is, whatever its first line says.
        if (vault === undefined) attempt(path, () => addMarkdown(run, read(path), findIn(folderOf(path))))
        else {
          attempt(path, () => {
            const text = read(path)
            // Obsidian's folders go as deep as you like, Nib's one: the one the note is in.
            const folder = folderOf(path).slice(vault.length).split('/').at(-2)
            addMarkdown(run, text, findInVault(vault, folderOf(path)), { title: nameOf(path).slice(0, -extension.length - 1), folder, tags: propertyTags(text), filing: 'The vault’s folders and tags', vault: true }, obsidianMarks)
          })
        }
      }
    } else if (HTML.has(extension)) attempt(path, () => addPage(path))
    else if (extension === 'enex') attempt(path, () => addEnex(run, read(path), path))
    else if (extension === 'znote') attempt(path, () => addZnote(path))
  }

  const left = paths
    .filter((path) => !used.has(path) && !dropped.has(bundleOf(path) ?? '\0'))
    .map((path) => `${path}: ${PICTURES.has(extensionOf(path)) ? 'no note uses this picture' : 'not a format Nib reads'}`)
  run.skipped.push(...left.slice(0, MAX_LISTED))
  if (left.length > MAX_LISTED) run.skipped.push(`${left.length - MAX_LISTED} more files not imported`)
}

/**
 * One TextBundle: Bear's, or any other app's. Bear keeps its own metadata in
 * `info.json` under `net.shinyfrog.bear`. False when the note is left out.
 */
function addBundle(run: Run, text: string, read: (path: string) => string, find: Find): boolean {
  const folder = folderOf(text)
  let info: unknown = null
  try {
    info = JSON.parse(read(folder + 'info.json'))
  } catch {
    // Missing or damaged, info.json costs only the dates.
  }
  const bear = isRecord(info) && isRecord(info['net.shinyfrog.bear']) ? info['net.shinyfrog.bear'] : null
  if (bear && flag(bear.trashed)) {
    count(run, 'bearTrash')
    return false
  }
  // An encrypted note's text file is empty; its ciphertext is in info.json.
  if (bear && flag(bear.encrypted)) {
    count(run, 'bearLocked')
    return false
  }
  const known: Meta = bear
    ? { createdAt: toTime(bear.creationDate), updatedAt: toTime(bear.modificationDate), pinned: flag(bear.pinned) }
    : {}
  addMarkdown(run, read(text), find, known, bear ? markHighlights : undefined)
  return true
}

/** Bear writes a highlight as `::text::`; Nib's highlight is `<mark>`. Code is left as written. */
function markHighlights(doc: Document) {
  replaceInText(doc, /::([^:\n]+)::/g, (match) => highlight(doc, match[1]))
}

/**
 * What Obsidian writes its own way, in a vault's notes. `![[quay.png]]` is a
 * picture, whatever width follows a bar. `![[Tides]]` shows that note inside
 * this one, which Nib has no way to: it becomes `[[Tides]]`, a link to it
 * (lib/links). And `==text==` is a highlight. Code is left as written. A
 * `#tag` among the words stays there, and is one more of the note's tags:
 * letters, digits, `_`, `-` and `/`, and not digits alone, as `#12` is a number.
 */
function obsidianMarks(doc: Document, meta: Meta) {
  const tags = prose(doc).flatMap((node) => [...node.data.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((match) => match[1].replace(/\/+$/, '')))
  meta.tags = [...(meta.tags ?? []), ...tags.filter((tag) => /[^\d]/.test(tag))]
  replaceInText(doc, /!\[\[([^[\]\n|]+)((?:\|[^[\]\n]*)?)\]\]|==([^=\s](?:[^=\n]*[^=\s])?)==/g, ([, embedded, bar, marked]) => {
    if (marked) return highlight(doc, marked)
    if (!PICTURES.has(extensionOf(embedded))) return `[[${embedded}${bar}]]`
    const picture = doc.createElement('img')
    picture.setAttribute('src', embedded.trim())
    return picture
  })
}

function highlight(doc: Document, text: string) {
  const mark = doc.createElement('mark')
  mark.textContent = text
  return mark
}

/** The words of a document outside code, a run at a time. */
function prose(doc: Document): Text[] {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  return texts.filter((node) => !node.parentElement?.closest('code, pre'))
}

/** Each match of `pattern` in the words outside code, replaced by what `make` gives for it. */
function replaceInText(doc: Document, pattern: RegExp, make: (match: RegExpMatchArray) => string | Node) {
  for (const node of prose(doc)) {
    const parts: (string | Node)[] = []
    let last = 0
    for (const match of node.data.matchAll(pattern)) {
      parts.push(node.data.slice(last, match.index), make(match))
      last = match.index + match[0].length
    }
    if (!parts.length) continue
    node.replaceWith(...parts, node.data.slice(last))
  }
}

// ---------------------------------------------------------------------------
// Paths and bytes

const extensionOf = (path: string) => /\.([^./]+)$/.exec(path)?.[1].toLowerCase() ?? ''

/** The folder part of a path, with its trailing slash; empty at the top of the zip. */
const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1)

/** A file's own name, without its folders. */
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** Not in the archive at all: anything with a scheme, or another host. */
const elsewhere = (ref: string) => /^[a-z][a-z\d+.-]*:/i.test(ref) || ref.startsWith('//')

/**
 * Where `ref`, written in a document in `folder`, points inside the archive.
 * Null for anything with a scheme (http, data, file, a drive letter) or that
 * climbs out of the archive.
 */
function resolvePath(folder: string, ref: string): string | null {
  if (elsewhere(ref)) return null
  const parts: string[] = []
  for (const part of (ref.startsWith('/') ? ref : folder + ref).split(/[\\/]/)) {
    if (part === '..') {
      if (!parts.pop()) return null
    } else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replace(/\s+/g, '')), (char) => char.charCodeAt(0))
}
