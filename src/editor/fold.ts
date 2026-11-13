import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { foldsOf, keepFolds } from '../lib/folds'
import { icon } from './Callout'

/**
 * Folding: a heading on a page puts its section out of sight, down to the
 * next heading of its level or above; and a line of a list, in a note or a
 * page, what is under it. Drawn over the text and never part of it, so the
 * document is as it was, in every export and on every other device; what is
 * folded is kept on this one (lib/folds).
 */

/** `can`: all that can fold in the document as it is now, kept so it's worked out once a change. */
type Folds = { folded: readonly number[]; can: Map<number, Foldable>; decorations: DecorationSet }
/** Fold or unfold what is at `toggle`; or unfold what is at each of `open`. */
type Change = { toggle: number } | { open: number[] }

export const foldKey = new PluginKey<Folds>('fold')

/** What can fold: where its control goes, inside its own line, and the lines it puts away, from the first to past the last. */
type Foldable = { inside: number; from: number; to: number }

const ITEMS = new Set(['listItem', 'taskItem'])

/** Everything in the document that can fold, by where it is. A heading with nothing under it can't, nor a list's line with none. */
function foldable(doc: Node): Map<number, Foldable> {
  const found = new Map<number, Foldable>()
  // Headings fold at the top level: one in a callout or a quotation has no section of its own.
  const blocks: { pos: number; level: number | null }[] = []
  doc.forEach((node, pos) => blocks.push({ pos, level: node.type.name === 'heading' ? Number(node.attrs.level) : null }))
  blocks.forEach(({ pos, level }, index) => {
    if (level === null) return
    let end = index + 1
    while (end < blocks.length && !(blocks[end].level !== null && blocks[end].level! <= level)) end++
    if (end > index + 1) found.set(pos, { inside: pos + 1, from: blocks[index + 1].pos, to: end < blocks.length ? blocks[end].pos : doc.content.size })
  })
  doc.descendants((node, pos) => {
    // A line of a list is a paragraph first, and then whatever is under it.
    if (ITEMS.has(node.type.name) && node.childCount > 1) found.set(pos, { inside: pos + 2, from: pos + 1 + node.child(0).nodeSize, to: pos + node.nodeSize - 1 })
    return !node.isTextblock
  })
  return found
}

/** What a fold is known by on this device: a heading by its level and its words, a list's line by its words. */
const nameOf = (node: Node) => (node.type.name === 'heading' ? `${node.attrs.level} ${node.textContent}` : `- ${node.child(0).textContent}`)

/** What was folded when the document was last open here. Two of a name are told apart only by how many were folded. */
function restored(doc: Node, names: string[]): number[] {
  const left = [...names]
  const folded: number[] = []
  for (const pos of [...foldable(doc).keys()].sort((a, b) => a - b)) {
    const at = left.indexOf(nameOf(doc.nodeAt(pos)!))
    if (at < 0) continue
    left.splice(at, 1)
    folded.push(pos)
  }
  return folded
}

/** The control: `back` is how far before it its heading or list's line starts. */
const toggle = (shut: boolean, back: number) => (view: EditorView, getPos: () => number | undefined) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'nib-fold'
  button.contentEditable = 'false'
  // One a heading, down a long page: Tab goes on past them.
  button.tabIndex = -1
  button.setAttribute('aria-expanded', String(!shut))
  const what = back === 1 ? 'this section' : 'what’s under this'
  button.setAttribute('aria-label', `${shut ? 'Show' : 'Hide'} ${what}`)
  button.append(icon('M4.5 6.25L8 9.75l3.5-3.5'))
  // Pressing it mustn't take the caret out of the text, on a phone the keyboard with it.
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', () => {
    const inside = getPos()
    if (inside === undefined) return
    const { state } = view
    const tr = state.tr.setMeta(foldKey, { toggle: inside - back } satisfies Change)
    // Off the lines being put away, where it couldn't be seen: to the end of the line that stays.
    const hidden = foldKey.getState(state)?.can.get(inside - back)
    if (!shut && hidden && hides(hidden, state)) tr.setSelection(Selection.near(state.doc.resolve(hidden.from - 1), -1))
    view.dispatch(tr)
  })
  return button
}

/** The same lines put away after a change as before it: nothing written into them, taken from them, or moved under them. */
const untouched = (before: Node, was: Foldable, after: Node, now: Foldable) => before.slice(was.from, was.to).content.eq(after.slice(now.from, now.to).content)

/** The lines put away in the document as it stands, for what should pass over them: Read aloud. */
export function foldedAway(state: EditorState): { from: number; to: number }[] {
  const folds = foldKey.getState(state)
  return folds ? folds.folded.map((pos) => folds.can.get(pos)!) : []
}

/** Whether the caret, or either end of what is selected, is in the lines `hidden` puts away. */
const hides = ({ from, to }: Foldable, { selection }: EditorState) => [selection.from, selection.head].some((pos) => pos >= from && pos < to)

function drawn(doc: Node, can: Map<number, Foldable>, folded: ReadonlySet<number>): DecorationSet {
  const decorations: Decoration[] = []
  for (const [pos, { inside, from, to }] of can) {
    const shut = folded.has(pos)
    const back = inside - pos
    decorations.push(Decoration.widget(inside, toggle(shut, back), { side: -1, key: `${back}${shut ? 'folded' : 'open'}`, ignoreSelection: true, stopEvent: () => true }))
    if (!shut) continue
    decorations.push(Decoration.node(pos, pos + doc.nodeAt(pos)!.nodeSize, { 'data-folded': '' }))
    // Each block it puts away: the ones after it for a heading, the ones under it for a list's line.
    const $from = doc.resolve(from)
    for (let index = $from.index(), at = from; at < to; index++) {
      const size = $from.parent.child(index).nodeSize
      decorations.push(Decoration.node(at, at + size, { class: 'nib-folded-away' }))
      at += size
    }
  }
  return DecorationSet.create(doc, decorations)
}

/** `id`: the document's, for what's kept of its folds; null while it has none. */
export function fold(id: () => string | null) {
  // What this device has of the document's folds, so they're written only when they change.
  let kept = foldsOf(id()).join('\n')
  return new Plugin<Folds>({
    key: foldKey,
    state: {
      init: (_, state) => {
        const folded = restored(state.doc, foldsOf(id()))
        const can = foldable(state.doc)
        return { folded, can, decorations: drawn(state.doc, can, new Set(folded)) }
      },
      apply(tr, value, before, state) {
        const change = tr.getMeta(foldKey) as Change | undefined
        if (!tr.docChanged && !change) return value
        const can = tr.docChanged ? foldable(state.doc) : value.can
        const folded = new Set<number>()
        for (const was of value.folded) {
          const pos = tr.mapping.map(was, 1)
          const now = can.get(pos)
          // What can fold no longer, or is gone, is folded no longer. Nor what was changed where it
          // couldn't be seen: by Replace all, a line joined into it, or one moved under it.
          if (now && (!tr.docChanged || untouched(before.doc, value.can.get(was)!, state.doc, now))) folded.add(pos)
        }
        if (change && 'toggle' in change && !folded.delete(change.toggle) && can.has(change.toggle)) folded.add(change.toggle)
        if (change && 'open' in change) for (const pos of change.open) folded.delete(pos)
        return { folded: [...folded], can, decorations: drawn(state.doc, can, folded) }
      },
    },
    props: {
      decorations: (state) => foldKey.getState(state)?.decorations,
    },
    // Find, an arrow key, the outline or an undo, going into lines that are put away, shows them: every fold around them, one inside another.
    appendTransaction(transactions, _, state) {
      if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null
      const { folded, can } = foldKey.getState(state)!
      const open = folded.filter((pos) => hides(can.get(pos)!, state))
      return open.length ? state.tr.setMeta(foldKey, { open } satisfies Change) : null
    },
    view: () => ({
      update(view, before) {
        const now = foldKey.getState(view.state)!
        const document = id()
        if (!document || now === foldKey.getState(before)) return
        const names = now.folded.map((pos) => nameOf(view.state.doc.nodeAt(pos)!))
        if (names.join('\n') === kept) return
        kept = names.join('\n')
        keepFolds(document, names)
      },
    }),
  })
}
