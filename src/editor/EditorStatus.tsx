import { useEffect, useReducer, useRef, useState } from 'react'
import { type Editor, useEditorState } from '@tiptap/react'
import type { Goal, Item } from '../db/db'
import { describeGoal, MAX_GOAL_WORDS } from '../lib/documentGoal'
import type { DailyGoal } from '../lib/goal'
import { MAX_SPRINT_MINUTES, SPRINT_LENGTHS, type Sprint, type SprintDone } from '../lib/sprint'
import { useLook } from '../lib/look'
import { touchApp } from '../lib/platform'
import { countCharacters, countWords, describeLength } from '../lib/stats'
import { relativeTime } from '../lib/time'
import { reasonAt, styleChecking, styleUnderlined, suggestions } from './styleCheck/plugin'

/**
 * A document's goal and sprints, which are Nib Plus. Passed only in the app,
 * where Plus is sold; without Plus they are a single row that leads to
 * Billing. The daily goal is free, and comes in as `goal`.
 */
export type GoalControls = {
  plus: boolean
  sprint: Sprint | null
  sprintDone: SprintDone | null
  onSetGoal: (goal: Goal | null) => void
  onStartSprint: (minutes: number) => void
  onStopSprint: () => void
  onDismissSprint: () => void
  /** Something here that's Plus's, asked for without it: Plus, saying why. */
  onPlus: (reason: string) => void
  /** From the palette: open the panel at one of its forms. `at` makes a repeat a new request. */
  request: { form: 'goal' | 'sprint'; at: number } | null
}

/**
 * The only always-on chrome in the editor pane, and deliberately the quietest
 * thing on screen. Clicking it opens the rest of what is known about the note.
 */
export function EditorStatus({
  editor,
  item,
  goal,
  goals,
  readOnly,
}: {
  editor: Editor
  item?: Item
  goal?: DailyGoal | null
  goals?: GoalControls
  readOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<'goal' | 'sprint' | null>(null)
  const look = useLook()

  const watched = useEditorState({
    editor,
    selector: ({ editor }) => ({
      text: editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', ' '),
      styleOn: styleChecking(editor.state),
      // Without Nib Plus the check only counts: the count is all it shows.
      count: styleChecking(editor.state) && !styleUnderlined(editor.state) ? suggestions(editor.state) : null,
      // A touch screen can't hover an underline, so its reason shows here
      // while the caret is in it.
      reason: touchApp ? reasonAt(editor.state, editor.state.selection.from) : null,
    }),
  })
  const text = watched?.text

  // A palette request is new each time, even for the same form. App keeps the
  // last for good and this remounts with every document, so the one it mounted
  // with was for a document before this one.
  const requested = goals?.request
  const mountedWith = useRef(requested)
  useEffect(() => {
    if (!requested || requested === mountedWith.current) return
    setOpen(true)
    setForm(requested.form)
  }, [requested])

  // The time left only needs to move while a sprint is under way.
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const running = Boolean(goals?.plus && goals.sprint)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(tick, 15_000)
    return () => clearInterval(timer)
  }, [running])

  const body = text ?? ''
  const now = Date.now()
  const target = goals?.plus ? item?.goal : null
  const sprint = goals?.plus ? goals.sprint : null
  const done = goals?.plus ? goals.sprintDone : null
  const met = goal && goal.written >= goal.goal
  const days = goal?.streak ? `${goal.streak} ${goal.streak === 1 ? 'day' : 'days'} in a row` : ''

  let line: string
  if (watched?.reason) {
    line = watched.reason
  } else if (sprint) {
    const left = Math.max(1, Math.ceil((sprint.endsAt - now) / 60_000))
    line = `Sprint · ${describeWords(sprint.written)} · ${left} min left`
  } else if (done) {
    line = `Sprint done · ${describeWords(done.written)} in ${done.minutes} min`
  } else {
    line = target ? describeGoal(target, countWords(body), now) : describeLength(body)
    if (typeof watched?.count === 'number') line += ` · ${describeSuggestions(watched.count)}`
    if (goal) line += met ? ` · Goal met${days ? ` · ${days}` : ''}` : ` · ${goal.written.toLocaleString()} of ${goal.goal.toLocaleString()} today`
  }

  // Hidden in Customize, the line still comes when asked for (the palette's
  // goal and sprint commands open its panel), and while a sprint's time runs.
  if (typeof item?.archivedAt === 'number') line = `Archived · ${line}`
  if (item?.template === true) line = `Template · ${line}`
  // Said whatever Customize hides: that it can't be changed, and that it's on this device only (db Item.deviceOnly).
  const said = [item?.deviceOnly === true && 'This device only', readOnly && 'Read-only'].filter(Boolean).join(' · ')
  if (said) line = look.wordCount ? `${said} · ${line}` : said
  if (!look.wordCount && !open && !sprint && !said) return null

  return (
    // Fixed to the screen, so it has to keep clear of the home indicator and
    // the rounded corners itself: the app's own safe-area padding does not
    // reach a fixed element. And of a document open beside (App's main).
    <div
      className="fixed right-[calc(1rem+env(safe-area-inset-right)+var(--nib-beside,0px))] bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-10 flex max-w-[calc(100vw-2rem-var(--nib-beside,0px))] flex-col items-end"
    >
      {open && (
        <div className="nib-float mb-2 min-w-[180px] origin-bottom-right rounded-md border border-line bg-paper p-3 text-[11px]">
          <dl>
            <Row label="Words" value={countWords(body).toLocaleString()} />
            <Row label="Characters" value={countCharacters(body).toLocaleString()} />
            {target && <Row label="Goal" value={describeGoal(target, countWords(body), now)} />}
            {watched?.styleOn && (
              <Row label="Style" value={typeof watched.count === 'number' ? describeSuggestions(watched.count) : 'Checked on this device'} />
            )}
            {goal && (
              <>
                <Row label="Today" value={`${goal.written.toLocaleString()} of ${goal.goal.toLocaleString()} words`} />
                {days && <Row label="Goal met" value={days} />}
              </>
            )}
            {item && (
              <>
                <Row label="Kind" value={item.kind === 'note' ? 'Note' : 'Page'} />
                <Row label="Created" value={relativeTime(item.createdAt)} />
                <Row label="Edited" value={relativeTime(item.updatedAt)} />
              </>
            )}
          </dl>
          {typeof watched?.count === 'number' && watched.count > 0 && goals && (
            <button
              onClick={() => goals.onPlus('With Nib Plus, the style check underlines each suggestion in your text.')}
              className="nib-tap flex w-full cursor-pointer justify-between gap-6 py-[2px] text-left"
            >
              <span>See them underlined</span>
              <span className="text-muted">Plus ›</span>
            </button>
          )}
          {goals && (
            <div className="mt-2 border-t border-line pt-2">
              {goals.plus ? (
                <>
                  {item && (
                    <GoalForm
                      goal={item.goal ?? null}
                      editing={form === 'goal'}
                      onEdit={(editing) => setForm(editing ? 'goal' : null)}
                      onSave={(next) => {
                        goals.onSetGoal(next)
                        setForm(null)
                      }}
                    />
                  )}
                  <SprintControls
                    running={sprint !== null}
                    choosing={form === 'sprint'}
                    onChoose={(choosing) => setForm(choosing ? 'sprint' : null)}
                    onStart={(minutes) => {
                      goals.onStartSprint(minutes)
                      setForm(null)
                    }}
                    onStop={goals.onStopSprint}
                  />
                </>
              ) : (
                <button
                  onClick={() => goals.onPlus('Deadlines and sprints are part of Nib Plus, with a calendar of your writing days.')}
                  className="nib-tap flex w-full cursor-pointer justify-between gap-6 py-[2px] text-left"
                >
                  <span>Deadlines and sprints</span>
                  <span className="text-muted">Plus ›</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <button
        aria-expanded={open}
        onClick={() => {
          // The summary has been seen once it's clicked.
          if (done) goals?.onDismissSprint()
          setOpen((value) => !value)
        }}
        className="nib-tap cursor-pointer text-[11px] text-faint hover:text-muted"
      >
        {line}
      </button>
    </div>
  )
}

const describeWords = (n: number) => `${n.toLocaleString()} word${n === 1 ? '' : 's'}`
const describeSuggestions = (n: number) => (n ? `${n.toLocaleString()} suggestion${n === 1 ? '' : 's'}` : 'No suggestions')

const action = 'nib-tap cursor-pointer text-muted hover:text-ink'
const field = 'w-full min-w-0 rounded-[4px] border border-line bg-transparent px-1.5 py-0.5 text-[11px] outline-none pointer-coarse:text-[16px]'

/** The document's goal: what it is, and a small form to set, change or remove it. */
function GoalForm({
  goal,
  editing,
  onEdit,
  onSave,
}: {
  goal: Goal | null
  editing: boolean
  onEdit: (editing: boolean) => void
  onSave: (goal: Goal | null) => void
}) {
  if (!editing) {
    return (
      <button onClick={() => onEdit(true)} className={`${action} block py-[2px]`}>
        {goal ? 'Change the goal' : 'Set a goal for this'}
      </button>
    )
  }
  return <GoalEditor goal={goal} onCancel={() => onEdit(false)} onSave={onSave} />
}

/** Mounted afresh each time, so it starts from the goal as it is now, sync and all. A book's too (components/ManuscriptPanel), its date called something else beside who the book is by. */
export function GoalEditor({ goal, onCancel, onSave, dateLabel = 'By' }: { goal: Goal | null; onCancel: () => void; onSave: (goal: Goal | null) => void; dateLabel?: string }) {
  const [words, setWords] = useState(goal ? String(goal.words) : '')
  const [deadline, setDeadline] = useState(goal?.deadline ?? '')
  const count = Math.floor(Number(words))
  const valid = count >= 1 && count <= MAX_GOAL_WORDS
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) onSave(deadline ? { words: count, deadline } : { words: count })
      }}
      className="flex flex-col gap-1.5 py-[2px]"
    >
      <label className="flex items-center justify-between gap-3">
        <span className="text-muted">Words</span>
        <input
          autoFocus
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_GOAL_WORDS}
          value={words}
          onChange={(event) => setWords(event.target.value)}
          aria-label="Goal, in words"
          className={`${field} max-w-[90px] text-right`}
        />
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="text-muted">{dateLabel}</span>
        <input
          type="date"
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
          aria-label="Deadline, optional"
          className={`${field} max-w-[130px]`}
        />
      </label>
      <div className="flex justify-end gap-3">
        {goal && (
          <button type="button" onClick={() => onSave(null)} className={action}>
            Remove
          </button>
        )}
        <button type="button" onClick={onCancel} className={action}>
          Cancel
        </button>
        <button type="submit" disabled={!valid} className={`${action} font-medium text-ink disabled:cursor-default disabled:text-faint`}>
          Save
        </button>
      </div>
    </form>
  )
}

/** Start a sprint of a set length or one of your own, or end the one under way. */
function SprintControls({
  running,
  choosing,
  onChoose,
  onStart,
  onStop,
}: {
  running: boolean
  choosing: boolean
  onChoose: (choosing: boolean) => void
  onStart: (minutes: number) => void
  onStop: () => void
}) {
  const [minutes, setMinutes] = useState('')

  if (running) {
    return (
      <button onClick={onStop} className={`${action} block py-[2px]`}>
        End the sprint
      </button>
    )
  }

  const count = Math.round(Number(minutes))
  const valid = count >= 1 && count <= MAX_SPRINT_MINUTES
  return (
    <div className="py-[2px]">
      <div className="flex items-center gap-2.5">
        <span className="flex-1 text-muted">Sprint</span>
        {SPRINT_LENGTHS.map((length) => (
          <button key={length} onClick={() => onStart(length)} aria-label={`Start a ${length}-minute sprint`} className={action}>
            {length} min
          </button>
        ))}
        <button onClick={() => onChoose(!choosing)} aria-expanded={choosing} className={action}>
          Other
        </button>
      </div>
      {choosing && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (valid) onStart(count)
          }}
          className="mt-1.5 flex items-center justify-end gap-2"
        >
          <input
            autoFocus
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_SPRINT_MINUTES}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            aria-label="Sprint length, in minutes"
            className={`${field} max-w-[60px] text-right`}
          />
          <span className="text-muted">min</span>
          <button type="submit" disabled={!valid} className={`${action} font-medium text-ink disabled:cursor-default disabled:text-faint`}>
            Start
          </button>
        </form>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6 py-[2px]">
      <dt className="text-muted">{label}</dt>
      <dd className="whitespace-nowrap">{value}</dd>
    </div>
  )
}
