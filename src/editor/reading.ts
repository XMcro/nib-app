import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { scrollerOf } from './scroller'

export const readingKey = new PluginKey<DecorationSet>('reading')

/** The sentence being read aloud (lib/readAloud), highlighted. Drawn over the text, never part of it. */
export function reading(): Plugin<DecorationSet> {
  return new Plugin({
    key: readingKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const at = tr.getMeta(readingKey) as { from: number; to: number } | null | undefined
        if (at === undefined) return set.map(tr.mapping, tr.doc)
        return at ? DecorationSet.create(tr.doc, [Decoration.inline(at.from, at.to, { class: 'nib-reading' })]) : DecorationSet.empty
      },
    },
    props: { decorations: (state) => readingKey.getState(state) },
  })
}

/** Highlights the sentence being read and keeps it in view, or takes the highlight off. */
export function showReading(editor: Editor, at: { from: number; to: number } | null) {
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(readingKey, at))
  const shown = at && editor.view.dom.querySelector('.nib-reading')
  const scroller = scrollerOf(editor)
  if (!shown || !scroller) return
  // Brought to the middle once it's out of view, or nearly so: not every sentence, which would scroll all the time.
  const box = shown.getBoundingClientRect()
  const pane = scroller.getBoundingClientRect()
  if (box.top < pane.top || box.bottom > pane.bottom - pane.height * 0.25) shown.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
