import type { JSONContent } from '@tiptap/react'

/**
 * How a paragraph or a heading sits on its line, when the writer has said.
 * Otherwise it has no alignment, and sits where its own words' direction puts it.
 */
export const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const
export type Alignment = (typeof ALIGNMENTS)[number]

/** One of them, or null: this comes from stored bodies, pasted pages and imported files. */
export const asAlignment = (raw: unknown): Alignment | null => (ALIGNMENTS.includes(raw as Alignment) ? (raw as Alignment) : null)

const UNSAID = ['blockId', 'block', 'part', 'size']

/**
 * The editor's JSON as a body is stored. The editor gives every paragraph a
 * `textAlign` of null, and stored that would change the body of every document
 * for nothing: a version from before it would look reformatted, and sync would
 * see two bodies where there is one. So a line that has no alignment says
 * nothing about it. In place: `getJSON` makes this copy for the caller.
 *
 * The same for what a link to one line adds (lib/links): the line's marker,
 * and on the link its line and that line's words. Null, they aren't stored.
 * Nor is a picture's size (lib/image), which most pictures don't have.
 */
export function withoutDefaultAlignment<T extends JSONContent>(node: T): T {
  const attrs = node.attrs
  if (attrs && (('textAlign' in attrs && !asAlignment(attrs.textAlign)) || UNSAID.some((name) => attrs[name] === null))) {
    const rest = Object.fromEntries(Object.entries(attrs).filter(([name, value]) => (name === 'textAlign' ? asAlignment(value) : !(value === null && UNSAID.includes(name)))))
    if (Object.keys(rest).length) node.attrs = rest
    else delete node.attrs
  }
  node.content?.forEach(withoutDefaultAlignment)
  return node
}
