import { useRef, useState } from 'react'
import { Sheet } from './Sheet'

/**
 * Asks for the password of a backup being imported, which only ColorNote's
 * is (lib/colornote): the one its owner made it with, when it isn't the one
 * ColorNote's own backups have. It says what the password is for: Nib opens
 * the file with it where the file is, and keeps the notes, not the password.
 * Cancelled, it hands over none, and the backup isn't opened.
 */
export function PasswordDialog({ name, again, onPassword }: { name: string; again: boolean; onPassword: (password: string | null) => void }) {
  const [password, setPassword] = useState('')
  const field = useRef<HTMLInputElement>(null)
  return (
    // Over Settings, which the import was started from and which stays open.
    <Sheet label="A backup’s password" onClose={() => onPassword(null)} z="z-[55]" focus={field} focusOnTouch top="pt-[18vh]" className="nib-pop h-fit w-[min(420px,90vw)] rounded-lg border border-line bg-paper p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (password) onPassword(password)
        }}
      >
        <div className="text-[14px] font-medium">This backup needs its password</div>
        <p className="mt-1 break-words text-[12px] leading-[1.5] text-ink">{name}</p>
        <p className="mt-1 text-[12px] leading-[1.5] text-muted">It’s locked with your ColorNote master password. Nib opens it with that here, on this device, and doesn’t keep it.</p>
        <input
          ref={field}
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-label="The backup’s password"
          className="mt-3 h-[34px] w-full rounded-md border border-line bg-paper px-[9px] text-[13px] outline-none placeholder:text-muted pointer-coarse:h-11 pointer-coarse:text-[16px]"
        />
        {again && (
          <p role="alert" className="mt-2 text-[12px] leading-[1.5] text-ink">
            That password didn’t open it.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => onPassword(null)} className="nib-tap cursor-pointer rounded-md px-3 py-1.5 text-[12px] text-muted hover:text-ink">
            Cancel
          </button>
          <button type="submit" disabled={!password} className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:cursor-default disabled:opacity-50">
            Open
          </button>
        </div>
      </form>
    </Sheet>
  )
}
