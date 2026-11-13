import { type Editor, Mark } from '@tiptap/core'
import { DOMSerializer, type Mark as PMMark, type Node as PMNode } from '@tiptap/pm/model'
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { JSONContent } from '@tiptap/react'

export const NOTE_TO_SELF = 'noteToSelf'

/** Which note is open to read (NoteCard), by its id. */
export const reading = new PluginKey<string | null>('noteReading')
/** The card's own key, so a note opened or closed is shown or hidden then and there. */
export const noteCard = new PluginKey('noteCard')

const noteOf = (node: PMNode | null | undefined): PMMark | undefined => node?.marks.find((mark) => mark.type.name === NOTE_TO_SELF)

/** Whether the caret is on the note: inside its passage, or against either end. */
function touching(state: EditorState, id: string) {
  const { empty, $from } = state.selection
  return empty && [$from.nodeBefore, $from.nodeAfter].some((node) => noteOf(node)?.attrs.id === id)
}

/** Opens a note's card, or closes it. */
function read(view: EditorView, id: string | null) {
  view.dispatch(view.state.tr.setMeta(reading, id).setMeta(noteCard, id ? 'show' : 'hide'))
}

/**
 * A note to self: the writer's words about a passage ("check the tide
 * times"). It's a mark on the passage, as bold is, so it moves with the words
 * as they're edited, comes back with undo, and syncs and backs up with the
 * document, with nothing new to store. One on a selection across paragraphs
 * is in a piece in each, the pieces one note by their `id`.
 *
 * The writer's alone. Its words are never in the markup, so not in anything
 * written from it (an HTML export, the clipboard). Nothing pasted or imported
 * makes one. A copy leaves notes behind, while a passage dragged elsewhere in
 * the text takes its note along. Shares and exports take notes off
 * (withoutNotes), and Markdown and Word write only the marks they know.
 *
 * Read by tapping the underlined passage, or by bringing the caret into it
 * from the keyboard; typing, or the caret's leaving, closes it again.
 */
export const NoteToSelf = Mark.create({
  name: NOTE_TO_SELF,
  // What's typed just before or after the passage isn't what the note is about.
  inclusive: false,

  addAttributes() {
    return {
      id: { default: null, rendered: false },
      text: { default: '', rendered: false },
    }
  },

  parseHTML() {
    return []
  },

  renderHTML() {
    return ['span', { class: 'nib-note-to-self' }, 0]
  },

  addProseMirrorPlugins() {
    // The copy's markup without the note: no span, and nothing to say one was there.
    const { nodes, marks } = DOMSerializer.fromSchema(this.editor.schema)
    const { [this.name]: _note, ...others } = marks
    const copy = new Plugin({ props: { clipboardSerializer: new DOMSerializer(nodes, others) } })

    const open = new Plugin<string | null>({
      key: reading,
      state: {
        init: () => null,
        apply(tr, id, _old, state) {
          const asked = tr.getMeta(reading)
          if (asked !== undefined) return asked
          if (tr.docChanged) return null
          if (!tr.selectionSet || (id && touching(state, id))) return id
          // Only a caret right inside a passage: one against its end could be
          // there to write on after it.
          const { empty, $from } = state.selection
          return (empty && $from.marks().find((mark) => mark.type.name === NOTE_TO_SELF)?.attrs.id) || null
        },
      },
      props: {
        // A tap anywhere on the underlined words, its first and last letters too.
        handleClick(view, _pos, event) {
          const passage = event.target instanceof Element ? event.target.closest('.nib-note-to-self') : null
          const id = passage && noteOf(view.state.doc.nodeAt(view.posAtDOM(passage, 0)))?.attrs.id
          if (id && reading.getState(view.state) !== id) read(view, id)
          return false
        },
        handleKeyDown(view, event) {
          if (event.key !== 'Escape' || !reading.getState(view.state)) return false
          read(view, null)
          return true
        },
      },
    })

    return [copy, open]
  },
})

export const ASK_FOR_NOTE = 'nibAskForNote'

/** ⌘K's Add a note to self: the selection toolbar asks for the note, as its ••• does. */
export const askForNote = (editor: Editor) => editor.view.dispatch(editor.state.tr.setMeta(ASK_FOR_NOTE, true))

/** The note open to read: its id and its words. */
export function openNote(state: EditorState): { id: string; text: string } | null {
  const id = reading.getState(state)
  if (!id) return null
  const { $from } = state.selection
  const mark = [$from.nodeBefore, $from.nodeAfter].map(noteOf).find((one) => one?.attrs.id === id)
  return mark ? { id, text: String(mark.attrs.text) } : null
}

/** Each piece of a note, wherever it is. */
function pieces(state: EditorState, id: string) {
  const found: { from: number; to: number; mark: PMMark }[] = []
  state.doc.descendants((node, pos) => {
    const mark = noteOf(node)
    if (node.isText && mark?.attrs.id === id) found.push({ from: pos, to: pos + node.nodeSize, mark })
  })
  return found
}

/** New words for a note, in every piece of it. It stays open. */
export function rewriteNote(view: EditorView, id: string, text: string) {
  const tr = view.state.tr.setMeta(reading, id)
  for (const { from, to, mark } of pieces(view.state, id)) tr.addMark(from, to, mark.type.create({ ...mark.attrs, text }))
  view.dispatch(tr)
}

/** A piece of a note taken off: where it was, and the note. */
export type NotePiece = ReturnType<typeof pieces>[number]

/** Done with: the note comes off every piece of its passage, and the words stay. Undo, or History, has it back. Says what came off, for restoreNote. */
export function removeNote(view: EditorView, id: string): NotePiece[] {
  const removed = pieces(view.state, id)
  const tr = view.state.tr.setMeta(reading, null)
  for (const { from, to, mark } of removed) tr.removeMark(from, to, mark)
  view.dispatch(tr)
  return removed
}

/** A note taken off put back on its words, wherever they've got to, with whatever's been written since left alone: a newer note on those words among it, as one note's mark replaces another's. */
export function restoreNote(view: EditorView, removed: NotePiece[]) {
  const tr = view.state.tr
  for (const { from, to, mark } of removed) if (from < to && !view.state.doc.rangeHasMark(from, to, mark.type)) tr.addMark(from, to, mark)
  if (tr.docChanged) view.dispatch(tr)
}

/** A note's passage in view, the caret at its start and its card open: the Notes list's row for it. */
export function showNote(editor: Editor, id: string, from: number) {
  editor.chain().focus().setTextSelection(from).setMeta(reading, id).setMeta(noteCard, 'show').scrollIntoView().run()
}

/** What the Notes list holds, in the order it comes in the document. */
export type Entry =
  | { key: string; kind: 'note'; id: string; text: string; passage: string; from: number; to: number }
  | { key: string; kind: 'tk'; word: string; before: string; after: string; from: number; to: number }

// A placeholder for what's still to come: TK in capitals, a word of its own. TKTK too. What's before
// it is the first group, matched and not looked behind at: iOS before 16.4 can't read a lookbehind,
// and one anywhere in the script stops the whole app loading.
const TK = /(^|[^\p{L}\p{N}])((?:TK)+)(?![\p{L}\p{N}])/gu
// How much of a TK's paragraph shows on either side of it.
const AROUND = 40

/** A document's notes to self, a note's pieces as one, and its TKs, each with where it is. */
export function notesAndTks(doc: PMNode): Entry[] {
  const notes = new Map<string, Extract<Entry, { kind: 'note' }>>()
  const tks: Entry[] = []
  doc.descendants((node, pos) => {
    const mark = noteOf(node)
    if (node.isText && mark) {
      const id = String(mark.attrs.id)
      const seen = notes.get(id)
      if (!seen) notes.set(id, { key: `note:${id}`, kind: 'note', id, text: String(mark.attrs.text), passage: node.text!, from: pos, to: pos + node.nodeSize })
      else {
        // Its pieces in other paragraphs, or apart, are marked as apart.
        seen.passage += (pos === seen.to ? '' : ' … ') + node.text
        seen.to = pos + node.nodeSize
      }
    }
    if (!node.isTextblock) return
    // A character for each footnote or line break, so places in it are places in the document.
    const text = node.textBetween(0, node.content.size, undefined, ' ')
    for (const match of text.matchAll(TK)) {
      const word = match[2]
      const at = match.index + match[1].length
      const end = at + word.length
      const before = at > AROUND ? `…${text.slice(at - AROUND, at).replace(/^\S*\s/, '')}` : text.slice(0, at)
      const after = end + AROUND < text.length ? `${text.slice(end, end + AROUND).replace(/\s\S*$/, '')}…` : text.slice(end)
      tks.push({ key: `tk:${tks.length}`, kind: 'tk', word, before, after, from: pos + 1 + at, to: pos + 1 + end })
    }
  })
  return [...notes.values(), ...tks].sort((a, b) => a.from - b.from)
}

/** A document with its notes to self taken off, for what leaves Nib. Stored JSON is not trusted, so anything else is passed through. */
export function withoutNotes(node: JSONContent): JSONContent {
  const kept: JSONContent = { ...node }
  if (Array.isArray(node.marks)) {
    const marks = node.marks.filter((mark) => mark?.type !== NOTE_TO_SELF)
    if (marks.length) kept.marks = marks
    else delete kept.marks
  }
  if (Array.isArray(node.content)) kept.content = node.content.map(withoutNotes)
  return kept
}
