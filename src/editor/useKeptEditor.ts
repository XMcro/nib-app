import { useEffect, useLayoutEffect, useRef } from 'react'
import { Editor, type EditorOptions } from '@tiptap/core'
import { keep, taken } from './kept'
import { scrollerOf } from './scroller'

/** What the editor tells the component drawing it. Called on whichever component that is now: a kept editor outlives the one that made it. */
type Told = Pick<EditorOptions, 'onUpdate' | 'onTransaction' | 'onBlur'>
const toldOf = new WeakMap<Editor, { current: Told }>()

/** What a document being left is kept as (lib/useOpenDocument keptAs). */
export type KeptAs = (docKey: string) => { key: string; id: string } | null

/**
 * The editor for the document opened as `docKey`: the one kept for it
 * (editor/kept), as it was left, or a new one from `make`. In place of
 * Tiptap's useEditor, which destroys its editor with the component: this one
 * is put away instead when `keptAs` says its document is being left for
 * another, and only otherwise destroyed.
 *
 * `scroll` is how far down a kept one was, and null for a new one.
 */
export function useKeptEditor({ docKey, keptAs, make, editorProps, editable, told }: {
  docKey?: string
  keptAs?: KeptAs
  /** The rest of a new editor's options: its extensions and what it opens with. */
  make: () => Partial<EditorOptions>
  editorProps: EditorOptions['editorProps']
  editable: boolean
  told: Told
}): { editor: Editor; scroll: number | null } {
  const held = useRef<{ editor: Editor; scroll: number | null } | null>(null)
  if (held.current === null) {
    const back = docKey === undefined ? undefined : taken(docKey)
    if (back) {
      // Its props are the last component's, which is gone. Its view was taken down as it was put away.
      back.editor.setOptions({ editorProps, editable })
      back.editor.mount(document.createElement('div'))
      held.current = { editor: back.editor, scroll: back.scroll }
    } else {
      const now = { current: told }
      const editor = new Editor({
        ...make(),
        editorProps,
        editable,
        onUpdate: (props) => now.current.onUpdate(props),
        onTransaction: (props) => now.current.onTransaction(props),
        onBlur: (props) => now.current.onBlur(props),
      })
      toldOf.set(editor, now)
      held.current = { editor, scroll: null }
    }
  }
  const { editor, scroll } = held.current
  // The latest render's, as useEditor keeps its callbacks.
  toldOf.get(editor)!.current = told

  // Read while its lines are still on the page: by the time it's put away the next document's are, and a shorter one has scrolled back up.
  const scrolled = useRef(0)
  useLayoutEffect(() => () => void (scrolled.current = scrollerOf(editor)?.scrollTop ?? 0), [editor])

  const leaving = useRef(keptAs)
  leaving.current = keptAs
  const going = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    clearTimeout(going.current)
    return () => {
      const as = docKey === undefined ? null : leaving.current?.(docKey)
      if (as) keep(as.key, as.id, editor, scrolled.current)
      // A moment later, and not if it's back by then: in development React takes every component down once and puts it straight back.
      else going.current = setTimeout(() => editor.destroy(), 1)
    }
  }, [editor, docKey])

  return { editor, scroll }
}
