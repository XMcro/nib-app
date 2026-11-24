import { useRef, useState } from 'react'
import { ReminderError } from '../lib/reminders'
import { Sheet } from './Sheet'

/**
 * Invitations to write (lib/invitations), offered once, on their own, at a
 * pause (lib/feedback askDue): promotional notifications are asked for apart
 * from anything else (App Store guideline 4.5.4). iOS asks its own question
 * the first time, if the daily reminder hasn't already.
 */
export function InvitationsOffer({ onYes, onNo }: { onYes: () => Promise<void>; onNo: () => void }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const yes = useRef<HTMLButtonElement>(null)

  async function accept() {
    setBusy(true)
    setMessage('')
    try {
      await onYes()
    } catch (error) {
      setMessage(error instanceof ReminderError ? error.message : 'Couldn’t turn them on.')
      setBusy(false)
    }
  }

  return (
    <Sheet label="Invitations to write" onClose={onNo} focus={yes} focusOnTouch className="nib-pop h-fit w-[min(360px,90vw)] rounded-lg border border-line bg-paper p-4">
      <div className="text-[14px] font-medium">A nudge now and then?</div>
      <p className="mt-2 text-[12px] leading-[1.5] text-muted">
        A short line to bring you back to the page, about your streak, your book or today’s pack, around the time you usually write. One a day at most, the
        daily reminder included, and none once you’ve written. Made on this device, and nothing leaves it. It’s in Settings, under Goals, to change.
      </p>
      {message && (
        <p role="alert" className="mt-2 text-[12px] text-ink">
          {message}
        </p>
      )}
      <div className="mt-3 flex items-center justify-end gap-4">
        <button onClick={onNo} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
          Not now
        </button>
        <button ref={yes} disabled={busy} onClick={() => void accept()} className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:opacity-50">
          Yes, nudge me
        </button>
      </div>
    </Sheet>
  )
}
