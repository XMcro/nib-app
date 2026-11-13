import type { Kind } from '../db/db'
import { importedWords } from '../lib/importApps'
import { Sheet } from './Sheet'

/** After an import that left something out: what came in, and why each thing didn't. Over Settings, which the import was started from and which stays open. */
export function ImportReport({ imported, skipped, onClose }: { imported: Kind[]; skipped: string[]; onClose: () => void }) {
  return (
    <Sheet label="Import" onClose={onClose} z="z-[55]" className="nib-pop h-fit w-[min(440px,90vw)] rounded-lg border border-line bg-paper p-4">
      <div className="text-[14px] font-medium">{imported.length ? `Imported ${importedWords(imported)}` : 'Nothing imported'}</div>
      <p className="mt-2 text-[12px] text-muted">Left out:</p>
      <ul className="mt-1 max-h-[40vh] list-disc overflow-y-auto pl-5 text-[12px] leading-[1.6] text-ink">
        {skipped.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <button onClick={onClose} className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper">
          OK
        </button>
      </div>
    </Sheet>
  )
}
