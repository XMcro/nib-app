import { useMemo } from 'react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { notesAndTks } from '../editor/NoteToSelf'

/**
 * The open document's notes to self and its TKs, in the order they come, in
 * the library like History. Each row shows its place in the text: a note
 * opens there, read; a TK is selected, to be written over.
 */
export function NotesToSelfPanel({ doc, onBack, onShow }: { doc: PMNode; onBack: () => void; onShow: (key: string) => void }) {
  const entries = useMemo(() => notesAndTks(doc), [doc])
  return (
    <div className="nib-swap flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 pb-2">
        <button onClick={onBack} className="nib-tap cursor-pointer text-[11px] text-muted hover:text-ink">
          ← Back
        </button>
        <span className="text-[11px] text-faint">Notes to self and TKs</span>
      </div>

      {entries.length === 0 ? (
        <div className="px-4 py-[22px] text-[12px] text-muted">
          None in this one. Select some words and choose Add a note to self, or write TK for anything still to come.
        </div>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {entries.map((entry) => (
            <li key={entry.key}>
              <button onClick={() => onShow(entry.key)} className="block w-full cursor-pointer rounded-md px-2 py-[9px] text-left hover:bg-item-hover pointer-coarse:min-h-11">
                {entry.kind === 'note' ? (
                  <>
                    <span className="line-clamp-3 border-l-2 border-line pl-2 text-[11px] leading-[1.45] text-muted">{entry.passage}</span>
                    <span className="mt-1.5 block text-[13px] leading-[1.45] break-words whitespace-pre-wrap">{entry.text}</span>
                  </>
                ) : (
                  <span className="block text-[13px] leading-[1.45] break-words">
                    {entry.before}
                    <strong className="font-semibold">{entry.word}</strong>
                    {entry.after}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
