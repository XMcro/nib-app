import { useState } from 'react'
import type { Item } from '../db/db'
import * as items from '../db/items'
import { describeExpiry } from '../lib/expiry'
import { ExpiryDialog } from './ExpiryDialog'

type Row = { id: string; label: string; run: () => void }

const EXPIRY_PLUS = 'A date for a note or page to move itself to the trash is part of Nib Plus.'

/** The open document's expiry date (lib/expiry): its dialog, the row under its text, and its row in the palette. */
export function useDocumentExpiry(activeItem: Item | undefined, focusMode: boolean, features: boolean) {
  const [setting, setSetting] = useState(false)
  const current = activeItem?.expires ?? undefined
  return {
    dialog: setting && activeItem && (
      <ExpiryDialog
        what={activeItem.kind}
        current={current}
        canSet={features}
        onSet={(day) => items.setExpiry(activeItem.id, day)}
        onClear={() => items.setExpiry(activeItem.id, null)}
        onClose={() => setSetting(false)}
      />
    ),
    row: current && !focusMode && (
      <button onClick={() => setSetting(true)} className="nib-tap mt-10 block cursor-pointer text-[12px] text-muted hover:text-ink">
        Expires · {describeExpiry(current)}
      </button>
    ),
    /**
     * Its row in the palette, with a document open. With a date there it's offered whatever Plus says, to take the
     * date off; with none, as Plus's rows are (`plusRow`, App).
     */
    commands: (plusRow: (row: Row, reason: string) => Row[]): Row[] =>
      !activeItem ? [] : current ? [{ id: 'expiry', label: 'Change expiry date…', run: () => setSetting(true) }] : plusRow({ id: 'expiry', label: 'Set an expiry date…', run: () => setSetting(true) }, EXPIRY_PLUS),
  }
}
