import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { checkPasscode, MAX_PASSCODE, VaultError, type VaultMode } from '../lib/vault'
import { forgetPasscode, recallPasscode, rememberPasscode, vaultUnlock } from '../lib/vaultKey'
import { Sheet } from './Sheet'

const TITLE: Record<VaultMode, string> = {
  create: 'Set a vault passcode',
  open: 'Open the vault',
  change: 'Change the vault passcode',
}

const ACTION: Record<VaultMode, [idle: string, busy: string]> = {
  create: ['Lock', 'Locking…'],
  open: ['Open', 'Opening…'],
  change: ['Change', 'Changing…'],
}

/**
 * The vault's passcode: set once, asked for to open the vault, or changed. It
 * is not Lock Nib's, and nothing on the device can recover it.
 */
export function VaultDialog({ mode, onSubmit, onClose }: { mode: VaultMode; onSubmit: (passcode: string) => Promise<void>; onClose: () => void }) {
  const [passcode, setPasscode] = useState('')
  const [again, setAgain] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const choosing = mode !== 'open'
  // Face ID or Touch ID (lib/vaultKey): what's set up here, whether it has the
  // passcode, and whether to give it the one typed now.
  const [unlock, setUnlock] = useState<{ name: string; stored: boolean } | null>(null)
  const [keep, setKeep] = useState(false)
  const passcodeField = useRef<HTMLInputElement>(null)

  const foundUnlock = useEffectEvent((found: typeof unlock) => {
    setUnlock(found)
    // Opening, with the passcode kept: straight to Face ID.
    if (found?.stored && mode === 'open') void viaBiometry(found)
  })

  useEffect(() => {
    // Once, as the dialog opens.
    void vaultUnlock().then(foundUnlock)
  }, [])

  async function viaBiometry(found = unlock) {
    const recalled = await recallPasscode()
    if (recalled) await attempt(recalled, found, true)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (choosing) {
      const problem = checkPasscode(passcode)
      if (problem) return setMessage(problem)
      if (passcode !== again) return setMessage('The two don’t match.')
    }
    await attempt(passcode, unlock, false)
  }

  async function attempt(given: string, found: typeof unlock, recalled: boolean) {
    setBusy(true)
    setMessage('')
    try {
      await onSubmit(given)
      // Asked for, or kept already and now typed (a changed passcode, say).
      if (found && !recalled && (keep || found.stored)) await rememberPasscode(given).catch(() => {})
      onClose()
    } catch (error) {
      // Changed on another device: the one kept here opens nothing now.
      if (recalled && found && error instanceof VaultError) {
        await forgetPasscode().catch(() => {})
        setUnlock({ ...found, stored: false })
        setMessage(`The passcode ${found.name} kept no longer opens the vault. Type the new one.`)
      } else setMessage(error instanceof VaultError ? error.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  // The system face, as the Mac's and iPhone's own password fields: Nib's
  // mono and sans faces both draw a passcode as big heavy dots.
  const field =
    'w-full rounded-md border border-line bg-transparent px-2 py-1.5 font-[system-ui] text-[13px] tracking-[0.15em] text-ink outline-none pointer-coarse:text-[16px]'
  return (
    <Sheet label={TITLE[mode]} onClose={onClose} focus={passcodeField} focusOnTouch className="nib-pop h-fit w-[min(400px,90vw)] rounded-lg border border-line bg-paper p-4">
      <form onSubmit={(event) => void submit(event)}>
        <div className="text-[14px] font-medium">{TITLE[mode]}</div>
        <p className="mt-2 text-[12px] leading-[1.5] text-muted">
          {mode === 'open'
            ? 'Locked notes and pages open with the vault’s passcode, which isn’t your device’s.'
            : 'Locked notes and pages are encrypted with this passcode, on this device and in sync. If you forget it, no one can open them: not Nib, not Apple.'}
        </p>
        {choosing && <p className="mt-1.5 text-[12px] leading-[1.5] text-muted">A longer passcode is harder to guess from a copy of the library.</p>}
        <input
          ref={passcodeField}
          type="password"
          autoComplete={choosing ? 'new-password' : 'current-password'}
          aria-label={mode === 'change' ? 'New passcode' : 'Passcode'}
          placeholder={mode === 'change' ? 'New passcode' : 'Passcode'}
          maxLength={MAX_PASSCODE}
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          className={`mt-3 ${field}`}
        />
        {choosing && (
          <input
            type="password"
            autoComplete="new-password"
            aria-label="The same again"
            placeholder="The same again"
            maxLength={MAX_PASSCODE}
            value={again}
            onChange={(event) => setAgain(event.target.value)}
            className={`mt-2 ${field}`}
          />
        )}
        {unlock && !unlock.stored && mode !== 'change' && (
          <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} />
            Use {unlock.name} to open it next time
          </label>
        )}
        {message && (
          <p role="alert" className="mt-2 text-[12px] text-ink">
            {message}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-4">
          {unlock?.stored && mode === 'open' && (
            <button type="button" disabled={busy} onClick={() => void viaBiometry()} className="nib-tap mr-auto cursor-pointer text-[12px] text-muted hover:text-ink">
              Use {unlock.name}
            </button>
          )}
          <button type="button" onClick={onClose} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !passcode}
            className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:cursor-default disabled:opacity-50"
          >
            {busy ? ACTION[mode][1] : ACTION[mode][0]}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
