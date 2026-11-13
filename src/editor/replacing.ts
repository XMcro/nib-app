import { Fragment, type Mark, type Node as PMNode, Slice } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import { SearchQuery, type SearchResult } from 'prosemirror-search'

/** The marks on every bit of a stretch of text. */
function marksThroughout(doc: PMNode, from: number, to: number) {
  const inline: PMNode[] = []
  doc.nodesBetween(from, to, (node) => void (node.isInline && inline.push(node)))
  return inline.reduce<readonly Mark[]>((marks, node) => marks.filter((mark) => mark.isInSet(node.marks)), inline[0]?.marks ?? [])
}

/**
 * Keeps what covered all of the words it replaces, a note to self included,
 * which the library drops at the note's end. And without a pattern what goes
 * in is exactly what was typed, where the library would read `$1` in it.
 * The find bar's (./FindBar), and a book's Replace all (./bookFind).
 */
export class Replacing extends SearchQuery {
  getReplacements(state: EditorState, result: SearchResult) {
    const { from, to } = result
    const marks = marksThroughout(state.doc, from, to)
    if (!this.regexp) {
      const words = this.replace ? Fragment.from(state.schema.text(this.replace, marks)) : Fragment.empty
      return [{ from, to, insert: new Slice(words, 0, 0) }]
    }
    return super.getReplacements(state, result).map((range) => {
      const nodes: PMNode[] = []
      range.insert.content.forEach((node) => nodes.push(node.isText ? node.mark(marks.reduce((set, mark) => mark.addToSet(set), node.marks)) : node))
      return { ...range, insert: new Slice(Fragment.fromArray(nodes), 0, 0) }
    })
  }
}
