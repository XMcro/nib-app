import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { type Editor, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { noteCard, openNote, removeNote, rewriteNote, type NotePiece } from './NoteToSelf'

// Above the caret, as the selection toolbar is: below, the keyboard could cover it.
const OPTIONS = { placement: 'top', offset: 10, flip: true, shift: { padding: 4 } } as const

const shouldShow = ({ state, view, element }: { state: EditorState; view: EditorView; element: HTMLElement }) =>
  openNote(state) !== null && (view.hasFocus() || element.contains(document.activeElement))

/** A note to self, open to read (editor/NoteToSelf): its words, Edit, and Done, which takes it off. */
/** `onDone`: a note taken off with Done, to say so and offer it back. */
export function NoteCard({ editor, readOnly, onDone }: { editor: Editor; readOnly?: boolean; onDone?: (removed: NotePiece[]) => void }) {
  const note = useEditorState({ editor, selector: ({ editor }) => openNote(editor.state) })
  const [draft, setDraft] = useState<string | null>(null)
  // Another note, or none: reading again.
  useEffect(() => setDraft(null), [note?.id])

  // Placed again once what it holds is drawn: placed as it showed, it was
  // placed empty, and grew down over the words.
  const editing = draft !== null
  useLayoutEffect(() => {
    if (note) editor.view.dispatch(editor.state.tr.setMeta(noteCard, 'updatePosition'))
  }, [editor, note, editing])

  function save() {
    const text = draft?.trim()
    if (note && text) rewriteNote(editor.view, note.id, text)
    setDraft(null)
    editor.commands.focus()
  }

  return (
    <BubbleMenu editor={editor} pluginKey={noteCard} shouldShow={shouldShow} options={OPTIONS}>
      {note && (
        <div role="dialog" aria-label="Note to self" className="nib-float w-[min(280px,calc(100vw-32px))] origin-bottom rounded-lg border border-line bg-paper p-1 text-[13px] pointer-coarse:text-[16px]">
          {draft === null ? (
            <>
              <p className="px-2 pt-1.5 pb-1 break-words whitespace-pre-wrap">{note.text}</p>
              {/* Pressed without taking the focus, so the keyboard stays up. */}
              {!readOnly && (
                <div className="flex justify-end gap-px" onMouseDown={(event) => event.preventDefault()}>
                  <Action onClick={() => setDraft(note.text)}>Edit</Action>
                  <Action
                    label="Done, take the note off"
                    onClick={() => {
                      const removed = removeNote(editor.view, note.id)
                      editor.commands.focus()
                      onDone?.(removed)
                    }}
                  >
                    Done
                  </Action>
                </div>
              )}
            </>
          ) : (
            <textarea
              autoFocus
              aria-label="The note"
              rows={3}
              enterKeyHint="done"
              value={draft}
              // At the end of the words, to write on; Chrome starts at the beginning.
              onFocus={(event) => event.currentTarget.setSelectionRange(draft.length, draft.length)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  save()
                } else if (event.key === 'Escape') {
                  setDraft(null)
                  editor.commands.focus()
                }
              }}
              className="block w-full resize-none bg-transparent px-2 py-1.5 outline-none"
            />
          )}
        </div>
      )}
    </BubbleMenu>
  )
}

function Action({ label, onClick, children }: { label?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button aria-label={label} onClick={onClick} className="h-[26px] cursor-pointer rounded-[5px] px-2 text-[12px] hover:bg-item-hover pointer-coarse:h-11 pointer-coarse:px-3 pointer-coarse:text-[15px]">
      {children}
    </button>
  )
}
