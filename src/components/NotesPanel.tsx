import { useEffect, useState } from 'react'
import type { ShareRef } from '../db/db'
import { CANT_REACH } from '../lib/notices'
import { relativeTime } from '../lib/time'
import { deleteNote, readNotes, setNotesOn, type ReaderNote } from '../share'

/**
 * Readers' notes on a shared draft, in the library like History.
 * Each sits under the passage it's about; tapping it shows that passage in
 * the draft, unless it's been rewritten, when the note is "on an earlier
 * draft". Only the writer sees these, and can delete any of them or turn
 * notes off.
 */
export function NotesPanel({
  share,
  onBack,
  isCurrent,
  onShow,
}: {
  share: ShareRef
  onBack: () => void
  /** Whether a quote still appears in the draft. */
  isCurrent: (quote: string) => boolean
  onShow: (quote: string) => void
}) {
  const [state, setState] = useState<{ notes: ReaderNote[]; notesOn: boolean } | 'loading' | 'unreachable'>('loading')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    readNotes(share)
      .then((loaded) => live && setState(loaded))
      .catch(() => live && setState('unreachable'))
    return () => {
      live = false
    }
  }, [share])

  // Changes go to the server first; on failure, nothing here pretends otherwise.
  async function change(action: () => Promise<unknown>, next: (current: { notes: ReaderNote[]; notesOn: boolean }) => { notes: ReaderNote[]; notesOn: boolean }) {
    setFailed(false)
    try {
      await action()
      setState((current) => (typeof current === 'object' ? next(current) : current))
    } catch {
      setFailed(true)
    }
  }

  const quiet = 'nib-tap cursor-pointer text-[11px] text-muted hover:text-ink'
  return (
    <div className="nib-swap flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 pb-2">
        <button onClick={onBack} className={quiet}>
          ← Back
        </button>
        <span className="text-[11px] text-faint">Notes from readers</span>
      </div>

      {state === 'loading' ? (
        <div className="px-4 py-[22px] text-[12px] text-muted">Loading…</div>
      ) : state === 'unreachable' ? (
        <div className="px-4 py-[22px] text-[12px] text-muted">{CANT_REACH}</div>
      ) : (
        <>
          {state.notes.length === 0 ? (
            <div className="px-4 py-[22px] text-[12px] text-muted">
              {state.notesOn ? 'No notes yet. Readers can select a passage and add one.' : 'Notes are off for this draft.'}
            </div>
          ) : (
            <ul className="flex flex-col gap-px px-2">
              {state.notes.map((note) => {
                const current = note.quote ? isCurrent(note.quote) : true
                return (
                  <li key={note.id} className="group shrink-0 rounded-md px-2 py-[9px] hover:bg-item-hover">
                    {note.quote && (
                      <button
                        onClick={() => current && onShow(note.quote!)}
                        disabled={!current}
                        className="block w-full cursor-pointer border-l-2 border-line pl-2 text-left text-[11px] leading-[1.45] text-muted disabled:cursor-default"
                      >
                        <span className="line-clamp-3">{note.quote}</span>
                        {!current && <span className="mt-0.5 block text-faint">On an earlier draft</span>}
                      </button>
                    )}
                    <p className="mt-1.5 text-[13px] leading-[1.45] whitespace-pre-wrap">{note.text}</p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-faint">
                      <span className="flex-1 truncate">
                        {note.name ? `${note.name} · ` : ''}
                        {relativeTime(note.at)}
                      </span>
                      <button
                        onClick={() => void change(() => deleteNote(share, note.id), (s) => ({ ...s, notes: s.notes.filter((other) => other.id !== note.id) }))}
                        aria-label="Delete this note"
                        className={quiet}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="mt-2 px-4 pb-3">
            <button
              onClick={() => void change(() => setNotesOn(share, !state.notesOn), (s) => ({ ...s, notesOn: !s.notesOn }))}
              className={quiet}
            >
              {state.notesOn ? 'Turn notes off' : 'Turn notes on'}
            </button>
            {failed && <p className="mt-1 text-[11px] text-muted">Couldn’t reach Nib. Try again.</p>}
          </div>
        </>
      )}
    </div>
  )
}
