import type { Editor } from '@tiptap/core'
import { DOC_BUDGET, imageBytes, toDataUrl } from '../lib/image'
import { keepOriginal } from '../lib/originals'

/**
 * A picture file put in at the cursor, by the rules a pasted one goes in by
 * (Editor handleFiles): made to fit and stripped of what it says about itself,
 * and only a kind Nib keeps (lib/image toDataUrl, which gives nothing for any
 * other; the picture's own node checks its src again), and only while the
 * document has room. With Nib Plus its original is kept beside the library
 * (lib/originals), once it's known the picture is going in. Says how it went.
 */
export async function addPicture(editor: Editor, file: Blob): Promise<'added' | 'refused' | 'full'> {
  const src = await toDataUrl(file)
  if (editor.isDestroyed || !src) return 'refused'
  if (src.length > DOC_BUDGET - imageBytes(editor.state.doc)) return 'full'
  // None for a locked document's, which its editor says it is (NibImage's storage).
  const full = await keepOriginal(file, editor.storage.image.locked)
  if (editor.isDestroyed) return 'refused'
  editor.view.dispatch(editor.state.tr.replaceSelectionWith(editor.schema.nodes.image.create({ src, alt: '', full })).scrollIntoView())
  return 'added'
}
