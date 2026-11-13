import type { ReactNode } from 'react'
import { RATES } from '../lib/readAloud'

/** While Nib reads aloud (lib/readAloud): Pause or Resume, slower and faster, and Stop. */
export function ReadingBar({
  beside = false,
  paused,
  rate,
  onPause,
  onResume,
  onRate,
  onStop,
}: {
  /** A document is open beside the one being read (App's main). */
  beside?: boolean
  paused: boolean
  rate: number
  onPause: () => void
  onResume: () => void
  onRate: (rate: number) => void
  onStop: () => void
}) {
  const at = RATES.indexOf(rate)
  return (
    // Over the middle of the bottom edge, and on a phone a line higher, clear of the word count.
    // With a document beside, over the middle of the writing's half, and a line higher there
    // too: half an iPad is as narrow as a phone.
    <div
      className={`pointer-events-none fixed right-[var(--nib-beside,0px)] left-0 z-20 flex justify-center ${beside ? 'bottom-[calc(2.75rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(0.75rem+env(safe-area-inset-bottom))] phone:bottom-[calc(2.75rem+env(safe-area-inset-bottom))]'}`}
    >
      <div role="toolbar" aria-label="Reading aloud" className="nib-float pointer-events-auto flex items-center gap-px rounded-lg border border-line bg-paper p-1 text-[12px] pointer-coarse:text-[15px]">
        <Action onClick={paused ? onResume : onPause}>{paused ? 'Resume' : 'Pause'}</Action>
        <span className="mx-1 h-4 w-px bg-line" />
        <Action label="Slower" disabled={at <= 0} onClick={() => onRate(RATES[at - 1])}>
          −
        </Action>
        <span className="min-w-[3.5ch] text-center text-muted tabular-nums">
          {rate}×
        </span>
        <Action label="Faster" disabled={at >= RATES.length - 1} onClick={() => onRate(RATES[at + 1])}>
          +
        </Action>
        <span className="mx-1 h-4 w-px bg-line" />
        <Action onClick={onStop}>Stop</Action>
      </div>
    </div>
  )
}

function Action({ label, disabled, onClick, children }: { label?: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-7 min-w-7 cursor-pointer rounded-md px-2 hover:bg-item-hover disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent pointer-coarse:h-11 pointer-coarse:min-w-11"
    >
      {children}
    </button>
  )
}
