import type { Editor } from '@tiptap/core'

/**
 * The editors of the tabs behind (lib/tabs), put away whole: off the page,
 * with what they'd undo, where the caret was and how far down they were
 * scrolled, so each is as it was left when its tab comes forward again. One
 * is on the page at a time, as ever: these draw nothing and save nothing.
 *
 * Each is kept under the key its document will next be opened with
 * (lib/useOpenDocument editorKey), which has the document's version in it: one
 * changed since, by another device or a restore, is opened afresh from what's
 * stored, and the editor kept for it goes.
 */
type Kept = { id: string; editor: Editor; scroll: number }
const kept = new Map<string, Kept>()

function drop(key: string) {
  kept.get(key)?.editor.destroy()
  kept.delete(key)
}

/** Put away, for the document `id`, to be opened next as `key`. */
export function keep(key: string, id: string, editor: Editor, scroll: number) {
  for (const [other, { id: its }] of kept) if (its === id) drop(other)
  // Its view goes, with its lines; its state stays.
  editor.unmount()
  kept.set(key, { id, editor, scroll })
}

/** The editor kept for `key`, back in hand: no longer kept. */
export function taken(key: string): Kept | undefined {
  const one = kept.get(key)
  kept.delete(key)
  return one
}

/** Only for the documents `behind` says have a tab behind: the rest go for good. */
export function forget(behind: (id: string) => boolean) {
  for (const [key, { id }] of kept) if (!behind(id)) drop(key)
}

/** How many are kept, for tests. */
export const keptCount = () => kept.size
