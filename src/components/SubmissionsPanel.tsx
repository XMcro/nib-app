import { useState, type FormEvent } from 'react'
import {
  addSubmission,
  ANSWER_WORDS,
  ANSWERS,
  answerOf,
  changeSubmission,
  followUpAfter,
  inOrder,
  pending,
  removeSubmission,
  submissionsOf,
  useSubmissions,
  type Answer,
  type Piece,
  type Submission,
} from '../lib/submissions'
import { localDay } from '../lib/time'

const quiet = 'nib-tap cursor-pointer text-[11px] text-muted hover:text-ink'
const field = 'mt-1 h-[30px] w-full rounded-md border border-line bg-paper px-[9px] text-[12px] text-ink outline-none pointer-coarse:h-11 pointer-coarse:text-[16px]'

/** A day as the device says it: "21 Nov 2026". */
const dayWords = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The submission tracker (lib/submissions), in the library like Attachments:
 * one piece's submissions, which can be given another, or all of them, those
 * still waiting first. A row opens its form; in the whole list, the piece
 * it's of opens too.
 */
export function SubmissionsPanel({ piece, titleOf, onBack, onOpen, onPlus }: {
  /** Of this piece only, and more can be added; else every one. */
  piece?: Piece
  /** Without Nib Plus: asks for it. Adding one is Plus; those already kept stay to read, change and remove. */
  onPlus?: () => void
  /** A piece's title, as the library says it. */
  titleOf: (piece: Piece) => string
  onBack: () => void
  /** The piece a submission is of, opened. */
  onOpen: (piece: Piece) => void
}) {
  const all = useSubmissions()
  const list = piece ? submissionsOf(all, piece) : inOrder(submissionsOf(all))
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const chosen = editing && editing !== 'new' ? list.find((one) => one.id === editing) : undefined

  if (editing === 'new' || chosen) {
    return (
      <div className="nib-swap flex flex-1 flex-col overflow-y-auto px-4">
        <SubmissionForm
          submission={chosen}
          of={titleOf(chosen?.piece ?? piece!)}
          onDone={() => setEditing(null)}
          onSave={(changes) => {
            if (chosen) changeSubmission(chosen.id, changes)
            else addSubmission(piece!, changes)
            setEditing(null)
          }}
          onDelete={
            chosen &&
            (() => {
              removeSubmission(chosen.id)
              setEditing(null)
            })
          }
        />
      </div>
    )
  }

  return (
    <div className="nib-swap flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 pb-2">
        <button onClick={onBack} className={quiet}>
          ← Back
        </button>
        <span className="max-w-[60%] truncate text-[11px] text-faint">{piece ? `Submissions of ${titleOf(piece)}` : 'Submissions'}</span>
      </div>
      {piece && (
        <button onClick={onPlus ?? (() => setEditing('new'))} className="nib-tap mx-4 mb-2 cursor-pointer rounded-md border border-line py-2 text-[12px] hover:bg-item-hover">
          Add a submission
        </button>
      )}
      {list.length === 0 ? (
        <p className="px-4 py-[22px] text-[12px] leading-[1.5] text-muted">
          {piece
            ? 'Not sent anywhere yet. Add where it goes when you send it, and Nib reminds you to follow up.'
            : 'Nothing sent yet. Add a submission from a note or page, in Commands, or from a book’s Manuscript.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-px px-2">
          {list.map((one) => (
            <li key={one.id} className="flex items-center gap-2 rounded-md hover:bg-item-hover">
              <button onClick={() => setEditing(one.id)} className="min-w-0 flex-1 cursor-pointer px-2 py-[9px] text-left pointer-coarse:min-h-11">
                <span className="block truncate text-[13px] leading-[1.45]">{one.where ?? 'Somewhere'}</span>
                <span className="block text-[11px] leading-[1.45] text-muted">{said(one, piece ? undefined : titleOf(one.piece))}</span>
              </button>
              {!piece && (
                <button
                  onClick={() => onOpen(one.piece)}
                  aria-label={`Open ${titleOf(one.piece)}`}
                  className="nib-tap mr-2 shrink-0 cursor-pointer rounded-md border border-line px-2.5 py-1 text-[11px] text-muted hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                >
                  Open
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** A row's second line: what came back, when it went, and when to follow up while it's waiting. */
function said(one: Submission, title?: string): string {
  const parts = [ANSWER_WORDS[answerOf(one)]]
  if (one.sent) parts.push(`sent ${dayWords(one.sent)}`)
  if (pending(one) && one.followUp) parts.push(`follow up ${dayWords(one.followUp)}`)
  else if (!pending(one) && one.answered) parts.push(dayWords(one.answered))
  if (title) parts.push(title)
  return parts.join(' · ')
}

type Changes = Parameters<typeof changeSubmission>[1]

/** Where it went and when, what came back and when, a day to follow up, and a note: a new one's sent today, followed up 90 days on. */
function SubmissionForm({ submission, of, onSave, onDelete, onDone }: { submission?: Submission; of: string; onSave: (changes: Changes) => void; onDelete?: () => void; onDone: () => void }) {
  const today = localDay(Date.now())
  const [where, setWhere] = useState(submission?.where ?? '')
  const [sent, setSent] = useState(submission?.sent ?? today)
  const [answer, setAnswer] = useState<Answer>(submission ? answerOf(submission) : 'waiting')
  const [answered, setAnswered] = useState(submission?.answered ?? '')
  const [followUp, setFollowUp] = useState(submission ? (submission.followUp ?? '') : followUpAfter(today))
  const [note, setNote] = useState(submission?.note ?? '')
  const heard = answer !== 'waiting'

  function save(event: FormEvent) {
    event.preventDefault()
    onSave({
      where,
      sent: sent || null,
      answer,
      answered: heard ? answered || today : null,
      followUp: followUp || null,
      note: note || null,
    })
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onDone} className={quiet}>
          ← Back
        </button>
        <span className="max-w-[60%] truncate text-[11px] text-faint">{of}</span>
      </div>
      <label className="text-[11px] text-muted">
        Where it went
        <input value={where} onChange={(event) => setWhere(event.target.value)} placeholder="A magazine, a contest, an agent" className={field} />
      </label>
      <label className="text-[11px] text-muted">
        Sent
        <input type="date" value={sent} onChange={(event) => setSent(event.target.value)} className={field} />
      </label>
      <label className="text-[11px] text-muted">
        What came back
        <select value={answer} onChange={(event) => setAnswer(event.target.value as Answer)} className={field}>
          {ANSWERS.map((one) => (
            <option key={one} value={one}>
              {ANSWER_WORDS[one]}
            </option>
          ))}
        </select>
      </label>
      {heard && (
        <label className="text-[11px] text-muted">
          When
          <input type="date" value={answered || today} onChange={(event) => setAnswered(event.target.value)} className={field} />
        </label>
      )}
      <label className="text-[11px] text-muted">
        Follow up
        <input type="date" value={followUp} onChange={(event) => setFollowUp(event.target.value)} className={field} />
      </label>
      {!heard && followUp && <p className="text-[10.5px] leading-[1.5] text-faint">Nib reminds you that morning, while you’re still waiting.</p>}
      <label className="text-[11px] text-muted">
        Note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} className={`${field} h-auto py-1.5`} />
      </label>
      <button type="submit" disabled={!where.trim()} className="nib-tap mt-1 w-full cursor-pointer rounded-md bg-ink py-2 text-[12px] font-medium text-paper disabled:cursor-default disabled:opacity-50">
        {submission ? 'Save' : 'Add'}
      </button>
      {onDelete && (
        <button type="button" onClick={onDelete} className={`${quiet} mt-1`}>
          Delete this submission
        </button>
      )}
    </form>
  )
}
