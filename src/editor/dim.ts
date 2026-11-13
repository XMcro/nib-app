import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const dimKey = new PluginKey('dim')

/**
 * Focus mode's dimming (Customize, Nib Plus): the top-level block the caret is
 * in is marked `nib-current`, and index.css fades the rest back. A whole list
 * or table counts as one block.
 */
export function dim() {
  return new Plugin({
    key: dimKey,
    props: {
      attributes: { class: 'nib-dim' },
      decorations(state) {
        const { $from } = state.selection
        // At the top level (an image selected, say) the block is the node after.
        const from = $from.depth > 0 ? $from.before(1) : $from.pos
        const node = state.doc.nodeAt(from)
        if (!node) return null
        return DecorationSet.create(state.doc, [Decoration.node(from, from + node.nodeSize, { class: 'nib-current' })])
      },
    },
  })
}
