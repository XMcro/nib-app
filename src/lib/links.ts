import type { JSONContent } from '@tiptap/react'
import type { Item, Kind } from '../db/db'
import { isInVault, LOCKED_LINK, plainText, setInVault, titleOf } from './text'
import { isLocked } from './vault'

/**
 * Links between notes. A link holds the id of what it points to, so renaming
 * a note never breaks one, and the title it had when linked, to fall back on
 * when there is nothing else to show.
 *
 * The editor reads titles from here rather than from the database, so a link
 * can show what its note is called now, with no query per link. App keeps it
 * current from the same live lists the library shows.
 */

/**
 * `title` is empty for a document with no words yet, or one in the vault,
 * which `[[` leaves out.
 */
export type Linkable = { id: string; title: string; kind: Kind; updatedAt: number; locked: boolean; readOnly: boolean }

let documents: Linkable[] = []
let byId = new Map<string, Linkable>()
/** Each one's words, for a link to one line of them (`partsOf`). The same objects the library holds: nothing is copied. */
let bodies = new Map<string, JSONContent>()
const listeners = new Set<() => void>()

/** `items`, what can be linked to; `trash`, only so that a link to a locked note in it still hides what it's called. */
export function setLinkable(items: Item[], trash: Item[] = []) {
  // First, for this: a title can be a link to one of them.
  setInVault(new Set([...items, ...trash].filter(isLocked).map((item) => item.id)))
  bodies = new Map(items.filter((item) => !isLocked(item)).map((item) => [item.id, item.body]))
  const next = items.map((item) => ({
    id: item.id,
    title: plainText(item.body).trim() ? titleOf(item.body) : '',
    kind: item.kind,
    updatedAt: item.updatedAt,
    locked: isLocked(item),
    readOnly: Boolean(item.readOnly),
  }))
  // The lists are new after every save, as the writer types; only a title
  // changed, a lock, or a document come or gone, redraws the links on screen.
  const same = (one: Linkable, i: number) => one.id === documents[i].id && one.title === documents[i].title && one.locked === documents[i].locked
  if (next.length === documents.length && next.every(same)) {
    documents = next
    return
  }
  documents = next
  byId = new Map(next.map((one) => [one.id, one]))
  listeners.forEach((listener) => listener())
}

/**
 * What a link to `id` shows: its note's title now, else `stored`, the one it
 * had when linked. Nothing of a note in the vault, whose old title the link
 * still holds.
 */
export function shownTitle(id: string, stored: unknown): string {
  if (isInVault(id)) return LOCKED_LINK
  return byId.get(id)?.title || String(stored ?? '') || 'Untitled'
}

/** What a link to another note is called: its note's title now, or the one it had when linked. */
export function linkTitle(node: JSONContent): string {
  return shownTitle(String(node.attrs?.id ?? ''), node.attrs?.title)
}

/**
 * One line of a document that a link can go to: a heading or a paragraph with
 * words, wherever it is (in a list, a callout, a table). `index` counts them
 * from the top. `block` is the marker it carries once something links to it
 * (the `blockId` of its node), which is what the link holds: its words can
 * change and it can move, and the link still finds it.
 */
export type Part = { index: number; text: string; heading: boolean; block: string | null }

/** What a marker looks like: Nib's own are eight letters and digits; stored and pasted ones aren't trusted. */
export const asBlock = (raw: unknown): string | null => (typeof raw === 'string' && /^[a-z0-9]{4,16}$/.test(raw) ? raw : null)

export const newBlock = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0')

const wordsOf = (line: JSONContent) => plainText({ type: 'doc', content: [line] }).replace(/\s+/g, ' ').trim()

/** The lines of `body` a link can go to, in the order they're read, and the node each is. */
function linesIn(body: JSONContent): { parts: Part[]; nodes: JSONContent[] } {
  let lines = linesOfBody.get(body)
  if (lines) return lines
  const found = (lines = { parts: [] as Part[], nodes: [] as JSONContent[] })
  const walk = (node: JSONContent) => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const text = wordsOf(node)
      if (!text) return
      found.parts.push({ index: found.parts.length, text, heading: node.type === 'heading', block: asBlock(node.attrs?.blockId) })
      found.nodes.push(node)
    } else node.content?.forEach(walk)
  }
  walk(body)
  linesOfBody.set(body, lines)
  return lines
}
const linesOfBody = new WeakMap<JSONContent, { parts: Part[]; nodes: JSONContent[] }>()

export const partsIn = (body: JSONContent): Part[] => linesIn(body).parts
/** The node of `body` that `part` is, to put its marker on (lib/blockLinks). */
export const nodeOf = (body: JSONContent, part: Part): JSONContent | undefined => linesIn(body).nodes[part.index]

/** The lines of the document `id` a link can go to; none of one in the vault, or gone. */
export function partsOf(id: string): Part[] {
  const body = bodies.get(id)
  return body ? partsIn(body) : []
}

/** As many of a line's words as its link keeps, to show if the line is ever gone. */
export const WORDS_KEPT = 80

/** As long as a link's words for its line run: enough to know it by. */
const PART_SHOWN = 40
const shortened = (text: string) => (text.length > PART_SHOWN ? `${text.slice(0, PART_SHOWN).trimEnd()}…` : text)

/**
 * What a link shows: its note's title, and for a link to one line of it, that
 * line's words as they are now, else `part`, as they were when linked: its
 * marker is written a moment after the link is, and a line since deleted is
 * still what the link was to (it opens the note, at its top).
 */
export function shownLink(attrs: { id?: unknown; title?: unknown; block?: unknown; part?: unknown }): string {
  const id = String(attrs.id ?? '')
  const title = shownTitle(id, attrs.title)
  const block = asBlock(attrs.block)
  if (!block || isInVault(id)) return title
  const words = partsOf(id).find((part) => part.block === block)?.text ?? (typeof attrs.part === 'string' ? attrs.part : '')
  return words ? `${title} › ${shortened(words)}` : title
}

/** A heading's words as a wiki link can say them: Obsidian leaves out what would end the link. */
const wikiWords = (words: string) => words.replace(/[#|^:[\]\\]|%%/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * A link as Markdown writes it: `Title`, or Obsidian's `Title#Heading` for one
 * to a heading. A paragraph can only be named by writing a tag into it, which
 * would show anywhere but Obsidian, so a link to one is to its note there.
 */
export function wikiTarget(node: JSONContent): string {
  const title = linkTitle(node)
  const block = asBlock(node.attrs?.block)
  const line = block ? partsOf(String(node.attrs?.id ?? '')).find((part) => part.block === block) : undefined
  const heading = line?.heading ? wikiWords(line.text) : ''
  return heading ? `${title}#${heading}` : title
}

/**
 * A body for reading outside Nib, in an exported file or a shared draft: a
 * link to a line is a link to its note, with none of that line's words, and
 * no line says that anything links to it.
 */
export function withoutLines(node: JSONContent): JSONContent {
  const attrs = node.attrs && Object.entries(node.attrs).filter(([name]) => !['blockId', 'block', 'part'].includes(name))
  return { ...node, ...(attrs && { attrs: Object.fromEntries(attrs) }), ...(node.content && { content: node.content.map(withoutLines) }) }
}

/** Every document that can be linked to, the most recently edited first. */
export function linkable(): Linkable[] {
  return [...documents].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** The document `id` names, unless it is gone or in the trash. */
export function linked(id: string): Linkable | undefined {
  return byId.get(id)
}

export function onLinkableChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function collectLinks(node: JSONContent, found: Set<string>) {
  if (node.type === 'noteLink' && typeof node.attrs?.id === 'string') found.add(node.attrs.id)
  for (const child of node.content ?? []) collectLinks(child, found)
}

// Bodies are never changed in place: "Linked from" asks for every document's on each render.
const linksOf = new WeakMap<JSONContent, Set<string>>()

/** The ids `body` links to. */
export function linksIn(body: JSONContent): Set<string> {
  let found = linksOf.get(body)
  if (!found) {
    found = new Set()
    collectLinks(body, found)
    linksOf.set(body, found)
  }
  return found
}

/** What links to `id`: the "Linked from" list. Most recently edited first. */
export function linksTo(id: string, items: Item[]): Item[] {
  return items.filter((item) => item.id !== id && linksIn(item.body).has(id)).sort((a, b) => b.updatedAt - a.updatedAt)
}

const WIKI = /\[\[([^[\]\n]{1,200})\]\]/g

/** How Obsidian marks a line for a link to go to: ` ^id` at its end. */
const ANCHOR = / +\^([a-zA-Z0-9-]+)$/

function anchorOf(line: JSONContent): string | undefined {
  const last = line.content?.at(-1)
  if (last?.type !== 'text' || last.marks?.some((mark) => mark.type === 'code')) return undefined
  return ANCHOR.exec(last.text ?? '')?.[1]
}

function dropAnchor(line: JSONContent) {
  if (!anchorOf(line)) return
  const last = line.content!.at(-1)!
  last.text = last.text!.replace(ANCHOR, '')
  if (!last.text) line.content!.pop()
}

/** The lines of a body that a wiki link can name: a heading by its words, and any line by its `^id`. The first of a name. */
function namedLines(body: JSONContent): Map<string, JSONContent> {
  const named = new Map<string, JSONContent>()
  for (const part of partsIn(body)) {
    const line = nodeOf(body, part)!
    const anchor = anchorOf(line)
    const name = anchor ? `^${anchor}` : part.heading ? wikiWords(part.text).toLowerCase() : ''
    if (name && !named.has(name)) named.set(name, line)
  }
  return named
}

type FindTitle = (title: string) => string | undefined
/** What a link to the document `id` adds for the line `section` of it, if that can be found. */
type ToLine = (id: string, section: string | undefined) => { block?: string; part?: string }

/**
 * Turns `[[Title]]` in imported text into links, where a document by that
 * title exists (`find`), as Bear, Obsidian and Notesnook write them. An alias
 * (`[[Title|shown]]`) still finds its note, and so does its folder before it
 * (`[[Folder/Title]]`), as Obsidian writes one of two notes with a name. Text
 * in code is left as it was written.
 *
 * `[[Title#Heading]]` and Obsidian's `[[Title#^id]]` go to that line, which
 * takes a marker, when it's in one of these `documents`. One already in the
 * library isn't written to by an import, and is linked to as a whole. An
 * `^id` is Obsidian's and not the writer's words: it comes off a line a link
 * goes to and, in a note from a `vault`, off every line.
 */
export function linkWikiLinks(documents: { id: string; body: JSONContent; vault?: boolean }[], find: FindTitle): JSONContent[] {
  // Its nodes to change, and what they hold (a picture's data, say) left where it is.
  const copied = (node: JSONContent): JSONContent => ({ ...node, ...(node.content && { content: node.content.map(copied) }) })
  const bodies = documents.map(({ body }) => copied(body))
  const lines = new Map(documents.map(({ id }, i) => [id, namedLines(bodies[i])]))
  const toLine: ToLine = (id, section) => {
    const name = section?.trim()
    const line = name ? lines.get(id)?.get(name.startsWith('^') ? name : wikiWords(name).toLowerCase()) : undefined
    if (!line) return {}
    dropAnchor(line)
    const block = asBlock(line.attrs?.blockId) ?? newBlock()
    line.attrs = { ...line.attrs, blockId: block }
    return { block, part: wordsOf(line).slice(0, WORDS_KEPT) }
  }
  bodies.forEach((body) => relink(body, find, toLine))
  documents.forEach(({ vault }, i) => vault && partsIn(bodies[i]).forEach((part) => dropAnchor(nodeOf(bodies[i], part)!)))
  return bodies
}

/** One node in, changed in place, and the nodes it becomes out: a text node may split around its links. */
function relink(node: JSONContent, find: FindTitle, toLine: ToLine): JSONContent[] {
  if (node.type === 'codeBlock') return [node]
  if (node.type === 'text') {
    const text = node.text ?? ''
    if ((node.marks ?? []).some((mark) => mark.type === 'code')) return [node]
    const parts: JSONContent[] = []
    let last = 0
    for (const match of text.matchAll(WIKI)) {
      // Obsidian writes a heading under a heading as `#One#Two`: the last is the line.
      const [name, ...sections] = match[1].split('|')[0].split('#')
      const whole = name.trim()
      // A title with a slash of its own is looked for first.
      const title = whole && find(whole) ? whole : whole.slice(whole.lastIndexOf('/') + 1).trim()
      const id = title ? find(title) : undefined
      if (!id) continue
      if (match.index > last) parts.push({ ...node, text: text.slice(last, match.index) })
      parts.push({ type: 'noteLink', attrs: { id, title, ...toLine(id, sections.at(-1)) } })
      last = match.index + match[0].length
    }
    if (!parts.length) return [node]
    if (last < text.length) parts.push({ ...node, text: text.slice(last) })
    return parts
  }
  if (node.content) node.content = node.content.flatMap((child) => relink(child, find, toLine))
  return [node]
}
