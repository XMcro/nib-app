import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { addPicture } from '../editor/addPicture'
import { PICTURE_PROBLEMS, PictureError, asPictureAddress, pictureAt } from '../lib/pictureLink'
import { Sheet } from './Sheet'

/**
 * Add a picture from a link (lib/pictureLink): the address, fetched once, and
 * the picture put in where the cursor is, as a pasted one would be. It says
 * what it does before it does it: this is the one place Nib fetches from an
 * address that isn't its own.
 */
export function PictureLinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [address, setAddress] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!asPictureAddress(address)) return setMessage(PICTURE_PROBLEMS.address)
    setBusy(true)
    setMessage('')
    try {
      const went = await addPicture(editor, await pictureAt(address))
      if (went === 'added') return onClose()
      // A picture did come, and the page wouldn't keep it (lib/image toDataUrl): not one of its kinds, or, a detailed
      // photograph, still over a picture's limit at the smallest it's drawn.
      setMessage(went === 'full' ? 'This document is full — no more images fit' : 'Can’t add that picture. It’s a kind Nib doesn’t keep, or it can’t be made small enough.')
    } catch (error) {
      setMessage(error instanceof PictureError ? error.message : PICTURE_PROBLEMS.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    // The field takes the focus by the sheet's own doing, on a phone too, where it's what the dialog was opened for:
    // left to autoFocus, the sheet took it for itself on a Mac, and an address typed went nowhere.
    <Sheet label="Add a picture from a link" onClose={onClose} focus={field} focusOnTouch top="pt-[18vh]" className="nib-pop h-fit w-[min(420px,90vw)] rounded-lg border border-line bg-paper p-4">
      <form onSubmit={submit}>
        <div className="text-[14px] font-medium">Add a picture from a link</div>
        <p className="mt-1 text-[12px] leading-[1.5] text-muted">Nib fetches the picture once from that address and keeps a copy in this document.</p>
        <input
          ref={field}
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={address}
          onChange={(event) => {
            setAddress(event.target.value)
            // What was said of the last address isn't said of this one.
            setMessage('')
          }}
          placeholder="https://"
          aria-label="The picture’s address"
          className="mt-3 h-[34px] w-full rounded-md border border-line bg-paper px-[9px] text-[13px] outline-none placeholder:text-muted pointer-coarse:h-11 pointer-coarse:text-[16px]"
        />
        {message && (
          <p role="alert" className="mt-2 text-[12px] leading-[1.5] text-ink">
            {message}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="nib-tap cursor-pointer rounded-md px-3 py-1.5 text-[12px] text-muted hover:text-ink">
            Cancel
          </button>
          <button type="submit" disabled={busy || !address.trim()} className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:cursor-default disabled:opacity-50">
            {busy ? 'Fetching…' : 'Add'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
