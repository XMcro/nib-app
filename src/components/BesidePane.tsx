import { useEffect, useMemo } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Item } from '../db/db'
import { fitted, nibEditor, textClass } from '../editor/extensions'
import { isScreenplay, nameOf } from '../lib/fountain'

/**
 * Side by side (Nib Plus): a second document beside the one being written,
 * to read and to copy or drag from. It's never edited here, so the one
 * being written is the only one saving, as it always was.
 */
export function BesidePane({ item, onSwap, onClose }: { item: Item; onSwap: () => void; onClose: () => void }) {
  const page = item.kind === 'page'
  // A screenplay beside is laid out as one too (lib/fountain).
  const screenplay = isScreenplay(item)
  const body = useMemo(() => fitted(item.body, page), [item.body, page])
  const editor = useEditor(
    {
      ...nibEditor(page, screenplay),
      content: body,
      editable: false,
      editorProps: { attributes: { class: textClass(page, screenplay), 'aria-readonly': 'true' } },
    },
    [page, screenplay],
  )
  // Kept to the document as it changes elsewhere: synced, or swapped back and edited.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.commands.setContent(body, { emitUpdate: false })
  }, [editor, body])

  const title = nameOf(item)
  return (
    <aside aria-label={`Beside: ${title}`} className="mt-11 flex h-[calc(100%-2.75rem)] w-1/2 shrink-0 flex-col border-l border-line">
      {/* Its buttons keep to the left: the right of this row is where App's notices come down. */}
      <div className="flex h-10 shrink-0 items-center gap-1 px-2">
        <button onClick={onClose} aria-label="Close the document beside" className="nib-tap flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-item-hover hover:text-ink pointer-coarse:size-11">
          <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
        <span className="min-w-0 truncate text-[12px] text-muted">{title}</span>
        {/* To write in this one: it changes places with the one being written. */}
        <button onClick={onSwap} aria-label="Swap: write in this one" className="nib-tap h-7 shrink-0 cursor-pointer rounded-md px-2 text-[12px] text-muted hover:bg-item-hover hover:text-ink pointer-coarse:h-11">
          Swap
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8">
        <div className="mx-auto max-w-[var(--nib-column,680px)] pt-[30px] pb-[30vh]">
          <EditorContent editor={editor} />
        </div>
      </div>
    </aside>
  )
}
