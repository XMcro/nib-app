import { useState } from 'react'
import type { Repeat } from '../db/db'
import { describeReminder, ReminderError, REPEATS, repeatWord, suggestedTimes, toLocalInput } from '../lib/reminders'
import { Sheet } from './Sheet'

const WORDS: Record<Repeat, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }

/**
 * Remind me about this: a time from the quick choices or the picker, kept
 * with the note, so every device it's on rings. Shows the reminder already
 * set, if there is one, with the way to remove it.
 */
export function ReminderDialog({
  current,
  repeat,
  snoozed,
  silentHere = false,
  onSet,
  onClear,
  onClose,
}: {
  current?: number
  /** How the one set repeats, if it does. */
  repeat?: Repeat
  /** Until when it's snoozed on this device, from its notification, if it is. */
  snoozed?: number
  /** There's a reminder, and this device won't ring it: Nib's notifications aren't allowed here. */
  silentHere?: boolean
  onSet: (at: number, repeat: Repeat | null) => Promise<void>
  onClear: () => Promise<void>
  onClose: () => void
}) {
  const [now] = useState(() => Date.now())
  const [custom, setCustom] = useState(() => toLocalInput(current ?? suggestedTimes(now)[0].at))
  const [again, setAgain] = useState<Repeat | null>(repeat ?? null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function attempt(action: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
      onClose()
    } catch (error) {
      setMessage(error instanceof ReminderError ? error.message : 'Couldn’t set the reminder.')
    } finally {
      setBusy(false)
    }
  }

  // The picker's value is local time with no zone, which Date reads as local.
  const picked = new Date(custom).getTime()
  const quiet = 'nib-tap cursor-pointer text-[12px] text-muted hover:text-ink disabled:cursor-default disabled:opacity-50'
  return (
    <Sheet label="Remind me" onClose={onClose} className="nib-pop h-fit w-[min(400px,90vw)] rounded-lg border border-line bg-paper p-4">
      <div className="text-[14px] font-medium">Remind me</div>
      <p className="mt-2 text-[12px] leading-[1.5] text-muted">
        {current ? `Set for ${describeReminder(current, now)}${repeat ? `, ${repeatWord({ at: current, repeat })}` : ''}.` : 'A notification with this note’s title.'} It rings on every device your library is on.
      </p>
      {snoozed && <p className="mt-2 text-[12px] leading-[1.5] text-muted">Snoozed on this device until {describeReminder(snoozed, now)}.</p>}
      {silentHere && <p className="mt-2 text-[12px] leading-[1.5] text-muted">Not on this one: notifications are off for Nib here. Turn them on in Settings, under Notifications.</p>}

      {/* Chosen first: it goes with whichever time is set below. */}
      <label className="mt-3 flex items-center gap-2 text-[12px] text-muted">
        Repeat
        <select
          aria-label="Repeat"
          value={again ?? ''}
          onChange={(event) => setAgain(REPEATS.find((one) => one === event.target.value) ?? null)}
          className="rounded-md border border-line bg-transparent px-2 py-1.5 text-[12px] text-ink outline-none pointer-coarse:text-[16px]"
        >
          <option value="">Doesn’t repeat</option>
          {REPEATS.map((one) => (
            <option key={one} value={one}>
              {WORDS[one]}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        {suggestedTimes(now).map((choice) => (
          <button
            key={choice.label}
            disabled={busy}
            onClick={() => void attempt(() => onSet(choice.at, again))}
            className="nib-tap cursor-pointer rounded-md border border-line px-3 py-1.5 text-[12px] text-ink hover:bg-item-hover pointer-coarse:py-2.5"
          >
            {choice.label} <span className="text-faint">{describeReminder(choice.at, now)}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="datetime-local"
          aria-label="Remind me at"
          value={custom}
          min={toLocalInput(now)}
          onChange={(event) => setCustom(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 py-1.5 text-[12px] text-ink outline-none pointer-coarse:text-[16px]"
        />
        <button
          disabled={busy || !Number.isFinite(picked)}
          onClick={() => void attempt(() => onSet(picked, again))}
          className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:opacity-50"
        >
          Set
        </button>
      </div>

      {message && (
        <p role="alert" className="mt-2 text-[12px] text-ink">
          {message}
        </p>
      )}

      <div className="mt-3 flex items-center gap-4 border-t border-line pt-3">
        {(current || snoozed) && (
          <button disabled={busy} onClick={() => void attempt(onClear)} className={quiet}>
            Remove reminder
          </button>
        )}
        <span className="flex-1" />
        <button onClick={onClose} className={quiet}>
          Close
        </button>
      </div>
    </Sheet>
  )
}
