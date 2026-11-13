import { useState } from 'react'
import { describeExpiry, expiryChoices, firstExpiry } from '../lib/expiry'
import { Sheet } from './Sheet'

/**
 * A document's expiry date (lib/expiry): a day from the quick choices or the
 * picker. Shows the date already set, if there is one, with the way to take
 * it off. `canSet` is Nib Plus: without it a date that's there can only be
 * taken off.
 */
export function ExpiryDialog({
  what,
  current,
  canSet,
  onSet,
  onClear,
  onClose,
}: {
  what: 'note' | 'page'
  current?: string
  canSet: boolean
  onSet: (day: string) => Promise<void>
  onClear: () => Promise<void>
  onClose: () => void
}) {
  const [now] = useState(() => Date.now())
  const first = firstExpiry(now)
  const [custom, setCustom] = useState(() => (current && current >= first ? current : expiryChoices(now)[0].day))
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function attempt(action: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await action()
      onClose()
    } catch {
      setMessage('Couldn’t set the date.')
    } finally {
      setBusy(false)
    }
  }

  // Not today's or a day gone by: that would go at once. Empty while the picker holds no day.
  const picked = custom >= first ? custom : null
  const quiet = 'nib-tap cursor-pointer text-[12px] text-muted hover:text-ink disabled:cursor-default disabled:opacity-50'
  return (
    <Sheet label="Expiry date" onClose={onClose} className="nib-pop h-fit w-[min(400px,90vw)] rounded-lg border border-line bg-paper p-4">
      <div className="text-[14px] font-medium">Expiry date</div>
      <p className="mt-2 text-[12px] leading-[1.5] text-muted">
        {current ? `Expires ${describeExpiry(current, now)}. On that day this ${what} moves to the trash, where it can be put back.` : `On the day you choose, this ${what} moves to the trash, where it can be put back.`}
      </p>

      {canSet ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {expiryChoices(now).map((choice) => (
              <button
                key={choice.label}
                disabled={busy}
                onClick={() => void attempt(() => onSet(choice.day))}
                className="nib-tap cursor-pointer rounded-md border border-line px-3 py-1.5 text-[12px] text-ink hover:bg-item-hover pointer-coarse:py-2.5"
              >
                {choice.label} <span className="text-faint">{describeExpiry(choice.day, now)}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <input
              type="date"
              aria-label="Expires on"
              value={custom}
              min={first}
              onChange={(event) => setCustom(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 py-1.5 text-[12px] text-ink outline-none pointer-coarse:text-[16px]"
            />
            <button
              disabled={busy || !picked}
              onClick={() => picked && void attempt(() => onSet(picked))}
              className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:opacity-50"
            >
              Set
            </button>
          </div>
          {/* An iPhone's calendar doesn't hold to `min`: any day can come back from it. */}
          {custom && !picked && <p className="mt-2 text-[12px] leading-[1.5] text-muted">Choose a day from tomorrow on.</p>}
        </>
      ) : (
        <p className="mt-2 text-[12px] leading-[1.5] text-muted">Setting or changing a date is part of Nib Plus.</p>
      )}

      {message && (
        <p role="alert" className="mt-2 text-[12px] text-ink">
          {message}
        </p>
      )}

      <div className="mt-3 flex items-center gap-4 border-t border-line pt-3">
        {current && (
          <button disabled={busy} onClick={() => void attempt(onClear)} className={quiet}>
            Remove expiry date
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
