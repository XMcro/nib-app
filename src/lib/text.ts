import type { JSONContent } from '@tiptap/react'
import { attachedName } from './attachment'

/** Node types that sit inside a line rather than starting one. */
const INLINE = new Set(['text', 'hardBreak', 'footnote', 'image', 'noteLink', 'mathInline'])

/**
 * A node's children. Bodies are checked on the way in (lib/image
 * `filterBodyImages`), but one stored before that, with text that wasn't a
 * string, threw here, and the list, and so the app, drew nothing.
 */
const children = (node: JSONContent): JSONContent[] =>
  Array.isArray(node.content) ? node.content.filter((child) => typeof child === 'object' && child !== null) : []

/** What a link to a note in the vault reads as, wherever it's read: the title it still holds is what the lock is for. */
export const LOCKED_LINK = 'A locked note'

/** The notes in the vault, in the library or the trash (lib/links keeps it). */
let inTheVault: ReadonlySet<string> = new Set()

export const isInVault = (id: string) => inTheVault.has(id)

/** A node's words, as the library, search and counts read them. */
export function nodeText(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text
  // A link to another note reads as that note's title, as it shows.
  if (node.type === 'noteLink') return isInVault(String(node.attrs?.id ?? '')) ? LOCKED_LINK : String(node.attrs?.title ?? '')
  // A footnote's text is deliberately *not* included. It is an aside carried in
  // an attribute, so folding it in here fused it onto the preceding word — a
  // note titled "A claim" listed itself as "A claimPevensie 1950" — and made
  // this count disagree with the one the editor shows for the same document.
  if (node.type === 'hardBreak') return '\n'
  const content = children(node)
  // Blocks nested inside a block — list items, quoted paragraphs — each start
  // their own line. Joining them with nothing ran the words together, so the
  // word count and title here disagreed with what the editor itself showed.
  const separator = content.some((child) => !INLINE.has(child.type ?? '')) ? '\n' : ''
  return content.map(nodeText).join(separator)
}

// Bodies are never changed in place, only replaced, so a body's text is worked
// out once: the library's cards, the links' titles and the day's word count
// all ask for it on every render, of every document. Worked out again only if
// which notes are locked changes, as a link to one reads differently then.
let known = new WeakMap<JSONContent, string>()
/** The same for its title, which an A-to-Z sort asks for at every comparison. */
let knownTitles = new WeakMap<JSONContent, string>()
/** And what a search looks in, lower-cased. */
let knownSearches = new WeakMap<JSONContent, string>()

export function setInVault(ids: ReadonlySet<string>) {
  if (ids.size === inTheVault.size && [...ids].every(isInVault)) return
  inTheVault = ids
  known = new WeakMap()
  knownTitles = new WeakMap()
  knownSearches = new WeakMap()
}

/** One line per block. Feeds the list title, the preview, and length counts. */
export function plainText(body: JSONContent): string {
  if (typeof body !== 'object' || body === null) return ''
  let text = known.get(body)
  if (text === undefined) known.set(body, (text = children(body).map(nodeText).join('\n')))
  return text
}

function footnotes(node: JSONContent, found: string[] = []): string[] {
  if (node.type === 'footnote') {
    const text = String(node.attrs?.text ?? '').trim()
    if (text) found.push(text)
  }
  for (const child of children(node)) footnotes(child, found)
  return found
}

/** The names of the files attached, in order. Like a footnote's wording, not prose: found by a search, and not counted as words, which the editor doesn't count either. */
function attached(node: JSONContent, found: string[] = []): string[] {
  if (node.type === 'attachment') found.push(attachedName(node))
  for (const child of children(node)) attached(child, found)
  return found
}

/**
 * Everything a search should match. Separate from `plainText` because a
 * footnote's wording is part of what was written and worth finding, but it is
 * not prose: folding it in there fused it onto the neighbouring word and made
 * the word count disagree with the editor's own.
 */
export function searchText(body: JSONContent): string {
  return [plainText(body), ...footnotes(body), ...attached(body)].join('\n')
}

/** `searchText` in lower case, worked out once a body. */
export function searchable(body: JSONContent): string {
  let text = knownSearches.get(body)
  if (text === undefined) knownSearches.set(body, (text = searchText(body).toLowerCase()))
  return text
}

/** The first line after the title: what Preview rows show under it. */
export function previewOf(body: JSONContent): string {
  const lines = plainText(body).split('\n').map((line) => line.trim()).filter(Boolean)
  return lines[1] ?? ''
}

export function titleOf(body: JSONContent): string {
  if (typeof body !== 'object' || body === null) return 'Untitled'
  let title = knownTitles.get(body)
  if (title === undefined) knownTitles.set(body, (title = plainText(body).split('\n').map((line) => line.trim()).find(Boolean) ?? attached(body)[0] ?? 'Untitled'))
  return title
}

/** The corkboard's (lib/manuscript, Nib Plus): a chapter's summary is one line, of at most this many characters. */
export const SUMMARY_MAX = 200

/** One line of at most SUMMARY_MAX characters: what a summary is kept as, from what's typed or arrives. Nothing left is none. */
export function oneLine(text: string): string | null {
  return [...text.replace(/\s+/g, ' ').trim()].slice(0, SUMMARY_MAX).join('').trim() || null
}
