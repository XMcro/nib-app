import { strFromU8, type Unzipped } from 'fflate'
import type { JSONContent } from '@tiptap/react'
import { DOC_BUDGET, allowedImageSrc, toDataUrl } from './image'

/**
 * A Word document (.docx) read into a Nib page. A .docx is a zip of XML: the
 * text is in word/document.xml, and the styles, list numbering, footnotes,
 * comments, links and pictures it points at are in parts beside it. Read with
 * fflate and the browser's own XML parser, into inert documents: nothing in
 * the file runs or is fetched.
 *
 * Kept: headings (Title and Heading 1 as a title, Heading 2, Heading 3 and
 * below), bold, italic, underline, strikethrough, links, bulleted and
 * numbered lists, quotes (styled as one, or ruled down the left), tables,
 * line breaks, footnotes and endnotes,
 * pictures (made to fit, as a pasted one is) and comments, as notes to self on
 * the same words. Tracked changes come in accepted. Nib's own look stands in
 * for fonts, sizes and colours; what it has no place for is counted in `left`.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

/** What a Word document held that Nib leaves out, counted. */
export type Left = Partial<Record<'shapes' | 'equations' | 'headers' | 'pictures', number>>
export type DocxRead = { body: JSONContent; left: Left }

const TOO_LARGE = '[picture not imported: too large]'
const NOT_READ = '[picture not imported: not a format Nib reads]'
type Marks = NonNullable<JSONContent['marks']>
const PICTURE_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
])

const is = (el: Element, name: string, ns = W) => el.namespaceURI === ns && el.localName === name
const child = (el: Element | null | undefined, name: string) => (el ? [...el.children].find((one) => is(one, name)) : undefined)
const attr = (el: Element | null | undefined, name: string, ns = W) => el?.getAttributeNS(ns, name) ?? null
/** A toggle like <w:b/>: on unless it says 0, false or none. */
const on = (props: Element | undefined, name: string) => {
  const el = child(props, name)
  return !!el && !['0', 'false', 'none'].includes(attr(el, 'val') ?? '')
}

type Style = { name: string; numId?: string; ilvl?: string }
type Comment = { text: string }
type Parts = {
  styles: Map<string, Style>
  /** numId → level → ordered (else bulleted); a level numbered "none" isn't a list. */
  lists: Map<string, Map<string, boolean | null>>
  links: Map<string, string>
  pictures: Map<string, string>
  footnotes: Map<string, string>
  endnotes: Map<string, string>
  comments: Map<string, Comment>
}

/** The plain words of some XML: its w:t, with a space between paragraphs. */
function words(el: Element): string {
  return [...el.getElementsByTagNameNS(W, 'p')]
    .map((p) => [...p.getElementsByTagNameNS(W, 't')].map((t) => t.textContent).join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function readParts(files: Record<string, Uint8Array>): Parts & { document: Document } {
  const xml = (name: string) => (files[name] ? new DOMParser().parseFromString(strFromU8(files[name]), 'application/xml') : null)
  const document = xml('word/document.xml')
  if (!document || !document.documentElement || !is(document.documentElement, 'document')) throw new Error('Not a Word document')

  const styles = new Map<string, Style>()
  for (const style of xml('word/styles.xml')?.getElementsByTagNameNS(W, 'style') ?? []) {
    const numPr = child(child(style, 'pPr'), 'numPr')
    styles.set(attr(style, 'styleId') ?? '', {
      name: (attr(child(style, 'name'), 'val') ?? '').toLowerCase(),
      numId: attr(child(numPr, 'numId'), 'val') ?? undefined,
      ilvl: attr(child(numPr, 'ilvl'), 'val') ?? undefined,
    })
  }

  const lists = new Map<string, Map<string, boolean | null>>()
  const numbering = xml('word/numbering.xml')
  if (numbering) {
    const abstract = new Map<string, Map<string, boolean | null>>()
    for (const definition of numbering.getElementsByTagNameNS(W, 'abstractNum')) {
      const levels = new Map<string, boolean | null>()
      for (const level of definition.getElementsByTagNameNS(W, 'lvl')) {
        const format = attr(child(level, 'numFmt'), 'val') ?? 'decimal'
        levels.set(attr(level, 'ilvl') ?? '0', format === 'none' ? null : format !== 'bullet')
      }
      abstract.set(attr(definition, 'abstractNumId') ?? '', levels)
    }
    for (const num of numbering.getElementsByTagNameNS(W, 'num')) {
      const levels = abstract.get(attr(child(num, 'abstractNumId'), 'val') ?? '')
      if (levels) lists.set(attr(num, 'numId') ?? '', levels)
    }
  }

  const links = new Map<string, string>()
  const pictures = new Map<string, string>()
  for (const rel of xml('word/_rels/document.xml.rels')?.documentElement.children ?? []) {
    const id = rel.getAttribute('Id') ?? ''
    const target = rel.getAttribute('Target') ?? ''
    const type = rel.getAttribute('Type') ?? ''
    if (type.endsWith('/hyperlink')) links.set(id, target)
    else if (type.endsWith('/image')) pictures.set(id, target.startsWith('/') ? target.slice(1) : `word/${target}`)
  }

  const notes = (name: string, tag: string) => {
    const found = new Map<string, string>()
    for (const note of xml(name)?.getElementsByTagNameNS(W, tag) ?? []) {
      // Word's separators are footnotes too, typed; a reader's are not.
      if (!attr(note, 'type') || attr(note, 'type') === 'normal') found.set(attr(note, 'id') ?? '', words(note))
    }
    return found
  }

  const comments = new Map<string, Comment>()
  for (const comment of xml('word/comments.xml')?.getElementsByTagNameNS(W, 'comment') ?? []) {
    const author = attr(comment, 'author')
    const text = words(comment)
    comments.set(attr(comment, 'id') ?? '', { text: author ? `${author}: ${text}` : text })
  }

  return {
    document,
    styles,
    lists,
    links,
    pictures,
    footnotes: notes('word/footnotes.xml', 'footnote'),
    endnotes: notes('word/endnotes.xml', 'endnote'),
    comments,
  }
}

type Block = { kind: 'title' | 'heading' | 'subheading' | 'quote' | 'body'; list: { level: number; ordered: boolean } | null; node: JSONContent }

/** Reads document.xml's body into Nib's blocks, gathering list items into lists and quotes into quotes. */
class Reader {
  left: Left = {}
  /** The comments open where reading has got to, by their ids. */
  private open = new Set<string>()
  private notes = new Map<string, string>()

  private parts: Parts

  constructor(parts: Parts) {
    this.parts = parts
  }

  count(what: keyof Left) {
    this.left[what] = (this.left[what] ?? 0) + 1
  }

  blocks(container: Element, inCell = false): JSONContent[] {
    const read: (Block | JSONContent)[] = []
    for (const el of container.children) {
      if (is(el, 'p')) read.push(this.paragraph(el))
      else if (is(el, 'tbl')) read.push(this.table(el))
      else if (is(el, 'sdt')) read.push(...this.blocks(child(el, 'sdtContent') ?? el))
    }
    const out: JSONContent[] = []
    let pending: { level: number; ordered: boolean; node: JSONContent }[] = []
    let quote: JSONContent[] = []
    const flush = () => {
      if (pending.length) out.push(...lists(pending))
      if (quote.length) out.push({ type: 'blockquote', content: quote })
      pending = []
      quote = []
    }
    for (const one of read) {
      if (!('kind' in one)) {
        flush()
        out.push(one)
        continue
      }
      const block = one as Block
      // Empty paragraphs were Word's spacing; Nib spaces its own.
      if (!block.node.content?.length) continue
      if (block.list) {
        if (quote.length) flush()
        pending.push({ ...block.list, node: block.node })
      } else if (block.kind === 'quote') {
        if (pending.length) flush()
        quote.push(block.node)
      } else {
        flush()
        out.push(block.node)
      }
    }
    flush()
    return out.length || !inCell ? out : [{ type: 'paragraph' }]
  }

  private paragraph(p: Element): Block {
    const props = child(p, 'pPr')
    const style = this.parts.styles.get(attr(child(props, 'pStyle'), 'val') ?? '')
    const name = style?.name ?? ''
    const heading = /^heading (\d)$/.exec(name)
    const kind: Block['kind'] =
      name === 'title' || heading?.[1] === '1'
        ? 'title'
        : heading?.[1] === '2'
          ? 'heading'
          : heading
            ? 'subheading'
            : // Word's quote styles, or a rule down the left, as Nib's own Word export draws one.
              /^(quote|intense quote|block text)$/.test(name) || child(child(props, 'pBdr'), 'left')
              ? 'quote'
              : 'body'

    // One text for words a run apart with the same marks, as Word often splits them.
    const content: JSONContent[] = []
    for (const node of this.inline([...p.children], [])) {
      const last = content.at(-1)
      if (node.type === 'text' && last?.type === 'text' && JSON.stringify(last.marks) === JSON.stringify(node.marks)) last.text += node.text!
      else content.push(node)
    }
    // Word's first-line tabs and stray spaces at either end.
    const first = content[0]
    if (first?.type === 'text') first.text = first.text!.replace(/^\s+/, '')
    const last = content.at(-1)
    if (last?.type === 'text') last.text = last.text!.replace(/\s+$/, '')
    const kept = content.filter((node) => node.type !== 'text' || node.text)

    // Word's "left" and "right" are the start and end of a line, which on one running from the right are the other way round.
    const jc = attr(child(props, 'jc'), 'val')
    const textAlign = jc === 'center' ? 'center' : jc === 'both' || jc === 'distribute' ? 'justify' : jc === 'right' || jc === 'end' ? (child(props, 'bidi') ? 'left' : 'right') : null
    const aligned = textAlign ? { textAlign } : {}
    const node: JSONContent =
      kind === 'body' || kind === 'quote'
        ? { type: 'paragraph', ...(textAlign ? { attrs: aligned } : {}), ...(kept.length ? { content: kept } : {}) }
        : { type: 'heading', attrs: { level: kind === 'title' ? 1 : Math.min(6, Math.max(2, Number(heading![1]))), ...aligned }, ...(kept.length ? { content: kept } : {}) }

    // A numbered heading ("Chapter 1") is a heading still.
    const numPr = child(props, 'numPr')
    const numId = attr(child(numPr, 'numId'), 'val') ?? style?.numId
    const ilvl = attr(child(numPr, 'ilvl'), 'val') ?? style?.ilvl ?? '0'
    const ordered = numId && numId !== '0' && kind !== 'title' && kind !== 'heading' && kind !== 'subheading' ? this.parts.lists.get(numId)?.get(ilvl) : null
    return { kind, node, list: ordered === undefined || ordered === null ? null : { level: Number(ilvl) || 0, ordered } }
  }

  /** A paragraph's runs, and what wraps them (links, insertions, fields), as text, breaks, footnotes and pictures. */
  private inline(elements: Element[], marks: Marks): JSONContent[] {
    const out: JSONContent[] = []
    for (const el of elements) {
      if (el.namespaceURI === MATH && (el.localName === 'oMath' || el.localName === 'oMathPara')) {
        this.count('equations')
        continue
      }
      if (is(el, 'AlternateContent', MC)) {
        out.push(...this.inline(choice(el), marks))
        continue
      }
      if (el.namespaceURI !== W) continue
      switch (el.localName) {
        case 'r':
          out.push(...this.run(el, marks))
          break
        case 'hyperlink': {
          const href = this.parts.links.get(attr(el, 'id', R) ?? '')
          const link = href && /^(https?|mailto):/i.test(href) ? [{ type: 'link', attrs: { href } }] : []
          out.push(...this.inline([...el.children], [...marks, ...link]))
          break
        }
        // Tracked insertions and moves are taken; deletions and the text a move left aren't.
        case 'ins':
        case 'moveTo':
        case 'smartTag':
        case 'customXml':
        case 'fldSimple':
        case 'bdo':
        case 'dir':
          out.push(...this.inline([...el.children], marks))
          break
        case 'sdt':
          out.push(...this.inline([...(child(el, 'sdtContent')?.children ?? [])], marks))
          break
        case 'commentRangeStart':
          this.open.add(attr(el, 'id') ?? '')
          break
        case 'commentRangeEnd':
          this.open.delete(attr(el, 'id') ?? '')
          break
      }
    }
    return out
  }

  private run(r: Element, around: Marks): JSONContent[] {
    const props = child(r, 'rPr')
    const style = this.parts.styles.get(attr(child(props, 'rStyle'), 'val') ?? '')?.name
    const marks: Marks = []
    if (on(props, 'b') || style === 'strong') marks.push({ type: 'bold' })
    if (on(props, 'i') || style === 'emphasis') marks.push({ type: 'italic' })
    if (on(props, 'u')) marks.push({ type: 'underline' })
    if (on(props, 'strike') || on(props, 'dstrike')) marks.push({ type: 'strike' })
    marks.push(...around)
    const note = this.note()
    if (note) marks.push(note)

    const out: JSONContent[] = []
    const text = (value: string) => {
      const last = out.at(-1)
      if (last?.type === 'text') last.text += value
      else out.push({ type: 'text', text: value, ...(marks.length ? { marks } : {}) })
    }
    const each = (elements: Element[]) => {
      for (const el of elements) {
        if (is(el, 'AlternateContent', MC)) each(choice(el))
        else if (el.namespaceURI === W) this.part(el, out, text)
      }
    }
    each([...r.children])
    return out
  }

  /** One thing in a run: words, a break, a footnote, a picture. */
  private part(el: Element, out: JSONContent[], text: (value: string) => void) {
    switch (el.localName) {
      case 't':
        text(el.textContent ?? '')
        break
      case 'tab':
        text('\t')
        break
      case 'noBreakHyphen':
        text('-')
        break
      case 'br':
      case 'cr':
        // A page or column break is Word's layout; a line break is the writer's.
        if (!attr(el, 'type') || attr(el, 'type') === 'textWrapping') out.push({ type: 'hardBreak' })
        break
      case 'footnoteReference':
      case 'endnoteReference': {
        const notes = el.localName === 'footnoteReference' ? this.parts.footnotes : this.parts.endnotes
        const said = notes.get(attr(el, 'id') ?? '')
        if (said) out.push({ type: 'footnote', attrs: { text: said } })
        break
      }
      case 'drawing':
        out.push(...this.drawing(el))
        break
      case 'pict':
      case 'object':
        this.count('shapes')
        break
    }
  }

  /** A picture, by its relationship id until `pictures` reads it; a shape, text box or chart is left out. */
  private drawing(drawing: Element): JSONContent[] {
    const blip = drawing.getElementsByTagNameNS(A, 'blip')[0]
    const id = blip?.getAttributeNS(R, 'embed')
    if (!id || drawing.getElementsByTagNameNS(W, 'txbxContent').length) {
      this.count('shapes')
      return []
    }
    const described = [...drawing.getElementsByTagName('*')].find((el) => el.localName === 'docPr')
    return [{ type: 'image', attrs: { src: `rel:${id}`, alt: described?.getAttribute('descr') ?? '' } }]
  }

  /** The note to self for the comments open here: one note for each set of them, so a comment's pieces stay one. */
  private note() {
    const ids = [...this.open].filter((id) => this.parts.comments.has(id)).sort()
    if (!ids.length) return null
    const key = ids.join(' ')
    let id = this.notes.get(key)
    if (!id) this.notes.set(key, (id = crypto.randomUUID()))
    return { type: 'noteToSelf', attrs: { id, text: ids.map((one) => this.parts.comments.get(one)!.text).join('\n') } }
  }

  private table(tbl: Element): JSONContent {
    const rows: JSONContent[] = []
    for (const tr of [...tbl.children].filter((el) => is(el, 'tr'))) {
      const header = on(child(tr, 'trPr'), 'tblHeader')
      const cells = [...tr.children].filter((el) => is(el, 'tc'))
      rows.push({
        type: 'tableRow',
        content: cells.map((tc) => {
          const span = Number(attr(child(child(tc, 'tcPr'), 'gridSpan'), 'val')) || 1
          return { type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: span, rowspan: 1, colwidth: null }, content: this.blocks(tc, true) }
        }),
      })
    }
    return { type: 'table', content: rows.filter((row) => row.content!.length) }
  }
}

/** What a newer Word wrote for readers that understand it (mc:Choice), over its fallback. */
const choice = (alternate: Element) => [...([...alternate.children].find((one) => is(one, 'Choice', MC))?.children ?? [])]

/** List items into lists, nested by their level: an item deeper than the last goes inside it. */
function lists(items: { level: number; ordered: boolean; node: JSONContent }[]): JSONContent[] {
  const out: JSONContent[] = []
  let at = 0
  const build = (level: number): JSONContent => {
    const ordered = items[at].ordered
    const list: JSONContent = { type: ordered ? 'orderedList' : 'bulletList', content: [] }
    while (at < items.length && items[at].level >= level) {
      const item = items[at]
      if (item.level === level) {
        if (item.ordered !== ordered) break
        list.content!.push({ type: 'listItem', content: [item.node] })
        at += 1
      } else {
        if (!list.content!.length) list.content!.push({ type: 'listItem', content: [{ type: 'paragraph' }] })
        list.content!.at(-1)!.content!.push(build(item.level))
      }
    }
    return list
  }
  while (at < items.length) out.push(build(items[at].level))
  return out
}

/** Each picture read from the file and made to fit, as a pasted one is, within the document's share; or words saying it's too large. */
async function pictures(body: JSONContent, files: Record<string, Uint8Array>, parts: Parts, left: Left) {
  const found: JSONContent[] = []
  const walk = (node: JSONContent) => {
    if (node.type === 'image') found.push(node)
    node.content?.forEach(walk)
  }
  walk(body)
  let used = 0
  for (const image of found) {
    const path = parts.pictures.get(String(image.attrs!.src).slice('rel:'.length)) ?? ''
    const type = PICTURE_TYPES.get(path.split('.').pop()!.toLowerCase())
    const bytes = files[path]
    const src = type && bytes ? await toDataUrl(new Blob([bytes as BlobPart], { type })) : null
    if (src && allowedImageSrc(src) && used + src.length <= DOC_BUDGET) {
      used += src.length
      image.attrs = { ...image.attrs, src }
      continue
    }
    left.pictures = (left.pictures ?? 0) + 1
    delete image.attrs
    Object.assign(image, { type: 'text', text: type ? TOO_LARGE : NOT_READ })
  }
}

/** A .docx file's parts, unzipped past lib/importApps' checks, as a Nib page, and what it held that Nib left out. Throws if it isn't a Word document. */
export async function readDocx(files: Unzipped): Promise<DocxRead> {
  const parts = readParts(files)
  const reader = new Reader(parts)
  const body: JSONContent = { type: 'doc', content: reader.blocks(child(parts.document.documentElement, 'body') ?? parts.document.documentElement) }
  if (!body.content!.length) body.content = [{ type: 'paragraph' }]
  for (const name of Object.keys(files)) {
    if (/^word\/(header|footer)\d*\.xml$/.test(name) && /<w:t[ >]/.test(strFromU8(files[name]))) {
      reader.count('headers')
      break
    }
  }
  await pictures(body, files, parts, reader.left)
  return { body, left: reader.left }
}
