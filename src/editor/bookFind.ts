import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import type { JSONContent } from '@tiptap/react'
import { replaceAll, search, SearchQuery } from 'prosemirror-search'
import { fitted, nibExtensions } from './extensions'
import { Replacing } from './replacing'

/**
 * Find across a book (components/BookFind): each chapter's matches as its own
 * find bar sees them (./FindBar), the same query on the same document, so the
 * chapter opened at the third has it third in the bar's order too.
 */

const schema = getSchema(nibExtensions(true))

/** A chapter as its editor holds it (./Editor). */
export const docOf = (body: JSONContent): PMNode => schema.nodeFromJSON(fitted(body, true))

/** What's looked for: the bar's words and switches. */
export type BookQuery = { words: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean }

/** As the bar makes it. */
export const queryOf = ({ words, caseSensitive, wholeWord, regex }: BookQuery) => new SearchQuery({ search: words, regexp: regex, literal: true, caseSensitive, wholeWord })

/** As the bar puts it in (./replacing): what covered the words kept, and `$1` read only in a pattern. */
export const replacingOf = ({ words, caseSensitive, wholeWord, regex }: BookQuery, replace: string) => new Replacing({ search: words, replace, regexp: regex, literal: true, caseSensitive, wholeWord })

/** A chapter's words with every match replaced, as the bar's Replace all does it, and how many; null if there's none. */
export function replacedIn(body: JSONContent, query: Replacing): { body: JSONContent; count: number } | null {
  const doc = docOf(body)
  const count = matchesIn(doc, query).length
  if (count === 0) return null
  const state = EditorState.create({ doc, plugins: [search({ initialQuery: query })] })
  let next: EditorState | undefined
  replaceAll(state, (tr) => void (next = state.apply(tr)))
  return next ? { body: next.doc.toJSON(), count } : null
}

/** A match, with the words either side of it in its paragraph. */
export type Match = { before: string; text: string; after: string }

/** Letters either side of a match, about: cut at a space, so no word is broken. */
const AROUND = 40

const OBJECT = '￼'

function lead(text: string): string {
  if (text.length <= AROUND) return text
  const cut = text.slice(-AROUND)
  const space = cut.indexOf(' ')
  return `…${space >= 0 && space < AROUND - 1 ? cut.slice(space + 1) : cut}`
}

function trail(text: string): string {
  if (text.length <= AROUND) return text
  const cut = text.slice(0, AROUND)
  const space = cut.lastIndexOf(' ')
  return `${space > 0 ? cut.slice(0, space) : cut}…`
}

/** Every match in a chapter, in its order. */
export function matchesIn(doc: PMNode, query: SearchQuery): Match[] {
  const state = EditorState.create({ doc })
  const found: Match[] = []
  for (let next = query.findNext(state, 0); next; next = query.findNext(state, Math.max(next.to, next.from + 1))) {
    const $from = doc.resolve(next.from)
    const start = $from.start()
    const block = $from.parent
    found.push({
      before: lead(block.textBetween(0, next.from - start, undefined, OBJECT)),
      text: doc.textBetween(next.from, next.to, undefined, OBJECT),
      after: trail(block.textBetween(next.to - start, block.content.size, undefined, OBJECT)),
    })
  }
  return found
}
