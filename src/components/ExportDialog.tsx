import { useState } from 'react'
import { forPlus, MANY_FORMATS, MANY_NAMES, type ManyFormat } from '../lib/exportMany'
import { Sheet } from './Sheet'

/**
 * What the documents picked in the library export as (lib/exportMany): one
 * zip, a file each. It stays up while they're made, saying how far along,
 * and can't be closed till then: the system prints a PDF at a time.
 */
export function ExportDialog({
  count,
  plus,
  onExport,
  onClose,
}: {
  count: number
  plus: boolean
  /** Makes the zip and hands it over, saying which document it's on. Done, whoever opened this takes it down. */
  onExport: (format: ManyFormat, making: (which: number, of: number) => void) => Promise<unknown>
  onClose: () => void
}) {
  const [working, setWorking] = useState(false)
  const [at, setAt] = useState<[number, number] | null>(null)

  function choose(format: ManyFormat) {
    setWorking(true)
    void onExport(format, (which, of) => setAt([which, of]))
  }

  return (
    <Sheet label="Export" onClose={() => working || onClose()} pressOutside={!working} top="pt-[14vh]" className="nib-pop flex h-fit w-[min(400px,90vw)] flex-col rounded-lg border border-line bg-paper p-4">
      <div className="text-[14px] font-medium">Export {count === 1 ? 'one document' : `${count} documents`}</div>
      <p className="mt-1 text-[12px] text-muted">One zip, with a file for each.</p>
      <div className="mt-3 flex flex-col gap-px">
        {MANY_FORMATS.map((format) => (
          <button
            key={format}
            disabled={working}
            onClick={() => choose(format)}
            className="nib-tap flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-item-hover disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent pointer-coarse:py-2.5"
          >
            {MANY_NAMES[format]}
            {forPlus(format) && !plus && <span className="text-[10.5px] text-faint">Plus</span>}
          </button>
        ))}
      </div>
      <div className="mt-4 flex min-h-[28px] items-center justify-end">
        {working ? (
          <span role="status" className="text-[12px] text-muted">
            {at ? `Making ${at[0]} of ${at[1]}…` : 'Exporting…'}
          </span>
        ) : (
          <button onClick={onClose} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
            Cancel
          </button>
        )}
      </div>
    </Sheet>
  )
}
