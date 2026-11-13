import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Where a link to one line lands (lib/links Part): the line is brought to the
 * middle of the page and shown for a moment, so it's known among its
 * neighbours. On the live editor only (Editor.tsx).
 */
export const arriveKey = new PluginKey<DecorationSet>('nibArrive')

/** How long the line stays shown. */
const SHOWN_FOR = 2000

export const arrive = () =>
  new Plugin<DecorationSet>({
    key: arriveKey,
    state: {
      init: () => DecorationSet.empty,
      // The meta is where the line starts, or null once its moment is over.
      apply(tr, shown) {
        const at: unknown = tr.getMeta(arriveKey)
        if (at === undefined) return shown.map(tr.mapping, tr.doc)
        const node = typeof at === 'number' ? tr.doc.nodeAt(at) : null
        return node ? DecorationSet.create(tr.doc, [Decoration.node(at as number, (at as number) + node.nodeSize, { class: 'nib-arrived' })]) : DecorationSet.empty
      },
    },
    props: { decorations: (state) => arriveKey.getState(state) },
  })

/**
 * Goes to the line of the open document that carries the marker `block`. The
 * caret is put at its start, which opens whatever was folded over it
 * (editor/fold), but the writing isn't given the keys: on a phone that would
 * bring the keyboard up over what was come to be read. A line that's gone
 * leaves the document where it opened, at its top.
 */
export function goToBlock(editor: Editor, block: string) {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.attrs.blockId === block) at = pos
    return at < 0
  })
  if (at < 0) return
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at + 1)).setMeta(arriveKey, at))
  // Once it's drawn, and anything folded over it has opened.
  requestAnimationFrame(() => {
    if (editor.isDestroyed) return
    const line = editor.view.nodeDOM(at)
    if (line instanceof HTMLElement) line.scrollIntoView({ block: 'center' })
    setTimeout(() => !editor.isDestroyed && editor.view.dispatch(editor.state.tr.setMeta(arriveKey, null)), SHOWN_FOR)
  })
}
