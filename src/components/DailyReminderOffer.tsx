import { useRef, useState } from 'react'
import { DEFAULT_TIME } from '../lib/dailyReminder'
import { ReminderError } from '../lib/reminders'
import { Sheet } from './Sheet'

/**
 * The daily reminder (lib/dailyReminder), offered once, as the first stamp's
 * card closes: by then the writer knows what it would be for. iOS asks its
 * own question the first time it's set.
 */
export function DailyReminderOffer({ onSet, onDecline }: { onSet: (time: string) => Promise<void>; onDecline: () => void }) {
  const [time, setTime] = useState(DEFAULT_TIME)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const remind = useRef<HTMLButtonElement>(null)

  async function set() {
    setBusy(true)
    setMessage('')
    try {
      await onSet(time)
    } catch (error) {
      setMessage(error instanceof ReminderError ? error.message : 'Couldn’t set the reminder.')
      setBusy(false)
    }
  }

  return (
    <Sheet label="A reminder to write" onClose={onDecline} focus={remind} focusOnTouch className="nib-pop h-fit w-[min(360px,90vw)] rounded-lg border border-line bg-paper p-4">
      <div className="text-[14px] font-medium">A reminder to write?</div>
      <p className="mt-2 text-[12px] leading-[1.5] text-muted">
        A notification at this time on each day your pack is still waiting, so a day’s stamps don’t slip by. On this device only. It’s in Settings, under
        Goals, to change.
      </p>
      <label className="mt-3 flex items-center justify-between gap-3 rounded-md border border-line px-2 py-1.5">
        <span className="text-[12px] font-medium">Each day at</span>
        <input
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          aria-label="Remind me at"
          className="bg-transparent text-right text-[12px] text-ink outline-none pointer-coarse:text-[16px]"
        />
      </label>
      {message && (
        <p role="alert" className="mt-2 text-[12px] text-ink">
          {message}
        </p>
      )}
      <div className="mt-3 flex items-center justify-end gap-4">
        <button onClick={onDecline} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
          Not now
        </button>
        <button
          ref={remind}
          disabled={busy || !time}
          onClick={() => void set()}
          className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:opacity-50"
        >
          Remind me
        </button>
      </div>
    </Sheet>
  )
}
