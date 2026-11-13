import { useMemo, useState } from 'react'
import type { Item } from '../db/db'
import { attachedAcross, type AttachedRow } from '../lib/attachedList'
import { aboutOf, sizeText } from '../lib/attachment'
import { OPEN_PROBLEMS, openAttached } from '../lib/preview'

/**
 * Every file attached to a note or a page (lib/attachment), in the library
 * like the trash: the largest first, with the room they take. A row goes to
 * its document; Open shows the file as its card does (lib/preview). One is
 * removed in its document, where Undo and its history are.
 */
export function AttachmentsPanel({ items, trash, onBack, onOpen }: { items: Item[]; trash: Item[]; onBack: () => void; onOpen: (id: string) => void }) {
  const { rows, bytes } = useMemo(() => attachedAcross(items), [items])
  const waiting = useMemo(() => attachedAcross(trash).rows.length, [trash])
  return (
    <div className="nib-swap flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 pb-2">
        <button onClick={onBack} className="nib-tap cursor-pointer text-[11px] text-muted hover:text-ink">
          ← Back
        </button>
        <span className="text-[11px] text-faint">{rows.length === 0 ? 'Attachments' : `${rows.length === 1 ? '1 attachment' : `${rows.length} attachments`} · ${sizeText(bytes)}`}</span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-[22px] text-[12px] text-muted">Nothing attached. With Nib Plus, Attach a file… in Commands puts any file in a note or a page.</div>
      ) : (
        <ul className="flex flex-col gap-px px-2">
          {rows.map((row) => (
            <Row key={row.key} row={row} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {waiting > 0 && (
        <p className="px-4 py-3 text-[11px] leading-[1.5] text-muted">
          {waiting === 1 ? 'One more is' : `${waiting} more are`} in the trash, and {waiting === 1 ? 'takes' : 'take'} room until it’s emptied.
        </p>
      )}
    </div>
  )
}

function Row({ row, onOpen }: { row: AttachedRow; onOpen: (id: string) => void }) {
  const [state, setState] = useState<'opening' | keyof typeof OPEN_PROBLEMS | null>(null)
  const open = () => {
    setState('opening')
    void openAttached(row.file, row.name).then((went) => setState(went === 'opened' ? null : went))
  }
  return (
    <li className="flex items-center gap-2 rounded-md hover:bg-item-hover">
      <button onClick={() => onOpen(row.item)} className="min-w-0 flex-1 cursor-pointer px-2 py-[9px] text-left pointer-coarse:min-h-11">
        <span className="block truncate text-[13px] leading-[1.45]">{row.name}</span>
        <span className="block text-[11px] leading-[1.45] text-muted">
          {state === 'opening' ? 'Opening…' : state ? OPEN_PROBLEMS[state] : `${aboutOf(row)} · in ${row.title}`}
        </span>
      </button>
      <button
        onClick={open}
        disabled={state === 'opening'}
        aria-label={`Open ${row.name}`}
        className="nib-tap mr-2 shrink-0 cursor-pointer rounded-md border border-line px-2.5 py-1 text-[11px] text-muted hover:text-ink disabled:cursor-default disabled:text-faint pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        Open
      </button>
    </li>
  )
}
