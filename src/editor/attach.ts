import type { Editor } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Selection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Attached } from '../lib/attachment'
import { asFileName } from '../lib/attachment'
import { MAX_FILE } from '../lib/fileRef'
import { keepFile } from '../lib/files'
import { keepsFiles } from '../lib/originals'

/** Why a file wasn't attached, as the writer is told. */
export const ATTACH_PROBLEMS = {
  plus: 'Attaching files is part of Nib Plus.',
  locked: 'A locked note can’t hold attachments. Remove its lock first.',
  large: 'That file is over 25 MB, the most Nib keeps of one.',
  failed: 'Couldn’t keep that file on this device.',
} as const
export type AttachProblem = keyof typeof ATTACH_PROBLEMS

/**
 * `file`, kept in the store beside the library (lib/files), as an attachment
 * for a document to name (lib/attachment); or why not. Not without Plus; not
 * for a locked document, whose text is sealed where a file isn't; not past
 * what one file may be.
 */
export async function keepAttached(file: File, locked: boolean): Promise<Attached | AttachProblem> {
  if (!keepsFiles()) return 'plus'
  if (locked) return 'locked'
  if (file.size > MAX_FILE) return 'large'
  const id = await keepFile(file)
  if (!id) return 'failed'
  // What it says it is, where it says: a file with no kind is just a file.
  return { file: { id, type: file.type.split(';')[0].trim() || 'application/octet-stream', size: file.size }, name: asFileName(file.name) ?? 'File' }
}

/**
 * An attachment put in where the cursor is, or after the block that's
 * selected, with the cursor going on to the line after it, made if there's
 * none: left on the attachment itself, the next thing attached or typed took
 * its place.
 */
export function insertAttached(view: EditorView, attached: Attached) {
  const { schema, selection } = view.state
  const node = schema.nodes.attachment.create(attached)
  // Where a whole block is what's selected, it goes after that block, not in its place: a note that begins
  // with an attachment opens with that one selected, and the next file attached took it out.
  const beside = selection instanceof NodeSelection && selection.node.isBlock ? selection.to : null
  const tr = beside === null ? view.state.tr.replaceSelectionWith(node) : view.state.tr.insert(beside, node)
  const after = beside !== null ? beside + node.nodeSize : tr.selection instanceof NodeSelection && tr.selection.node === node ? tr.selection.to : null
  if (after !== null) {
    if (!tr.doc.resolve(after).nodeAfter) tr.insert(after, schema.nodes.paragraph.create())
    tr.setSelection(Selection.near(tr.doc.resolve(after), 1))
  }
  view.dispatch(tr.scrollIntoView())
}

/**
 * What's pasted or dropped into a locked note, with each attachment in it as
 * its name alone: the card copied from another note says which file it is,
 * and a locked note names none (it would be sealed without it, lib/vault).
 * The same slice back if it had none to take.
 */
export function withoutFiles(slice: Slice): Slice {
  let taken = false
  const names = (fragment: Fragment): Fragment => {
    const nodes: PMNode[] = []
    fragment.forEach((node) => {
      if (node.type.name === 'attachment' && node.attrs.file) {
        taken = true
        nodes.push(node.type.create({ ...node.attrs, file: null }))
      } else nodes.push(node.copy(names(node.content)))
    })
    return Fragment.fromArray(nodes)
  }
  const content = names(slice.content)
  return taken ? new Slice(content, slice.openStart, slice.openEnd) : slice
}
export const NAME_ONLY = 'A locked note can’t hold attachments, so only the name was pasted.'

/** A file attached where the cursor is, in the document `editor` has open; or why it wasn't. */
export async function attachFile(editor: Editor, file: File): Promise<'added' | AttachProblem> {
  const attached = await keepAttached(file, editor.storage.image.locked)
  if (typeof attached === 'string') return attached
  if (editor.isDestroyed) return 'failed'
  insertAttached(editor.view, attached)
  return 'added'
}
