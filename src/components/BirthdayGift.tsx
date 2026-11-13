import { type CSSProperties, useRef, useState } from 'react'
import { birthdayStamp, TWELFTH_OF_JUNE } from '../lib/birthday'
import { dayMonth, localDay } from '../lib/time'
import { motion } from '../lib/motion'
import { STAMP_INKS } from '../lib/stampbook'
import { confetti } from './confetti'
import { Sheet } from './Sheet'
import { StampArt } from './StampArt'

/**
 * The birthday present (lib/birthday), on 12 June: beside the way back to the
 * library, like a pack put off and Christmas's present, so it never
 * interrupts a sentence.
 */
export function BirthdayPresent({ onOpen }: { onOpen: () => void }) {
  return (
    <button aria-label="A birthday present" onClick={onOpen} data-fresh className="nib-stamp nib-tap cursor-pointer">
      <StampArt stamp={birthdayStamp(localDay(Date.now()))} width={20} />
    </button>
  )
}

/**
 * The present, opened: the birthday's stamp pressed on, and confetti falling
 * over the page while it's open (with Motion at full, and the system not
 * asking for less). `kept`: the birthday its stamp was first kept on.
 */
export function BirthdayCard({ kept, onStampbook, onClose }: { kept: string; onStampbook: () => void; onClose: () => void }) {
  const [today] = useState(() => localDay(Date.now()))
  const [falling] = useState(() => motion() === 1)
  const [pieces] = useState(makeConfetti)
  const closeButton = useRef<HTMLButtonElement>(null)

  const first = kept.slice(0, 4) === today.slice(0, 4)
  return (
    <>
      <Sheet label="A birthday present" onClose={onClose} top="pt-[14vh]" focus={closeButton} focusOnTouch className="nib-pop h-fit w-[min(340px,90vw)] rounded-lg border border-line bg-paper p-5">
        <div className="nib-stamp mx-auto w-fit" data-fresh>
          <StampArt stamp={birthdayStamp(today)} width={110} />
        </div>
        <div className="mt-5 text-center text-[15px] font-medium">A birthday present</div>
        <p className="mt-1.5 text-center text-[12.5px] leading-[1.5] text-muted">
          {first
            ? `Today, ${dayMonth(TWELFTH_OF_JUNE)}, is the birthday of the one who made Nib. To celebrate, a stamp you won’t find anywhere else, yours to keep.`
            : `Today, ${dayMonth(TWELFTH_OF_JUNE)}, is the birthday of the one who made Nib, and you’re here to celebrate again. Your cake stamp, from ${kept.slice(0, 4)}, is in the Stampbook, with the keepsakes.`}
        </p>
        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={() => {
              onClose()
              onStampbook()
            }}
            className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink"
          >
            Stampbook
          </button>
          <span className="flex-1" />
          <button ref={closeButton} onClick={onClose} className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper">
            Close
          </button>
        </div>
      </Sheet>
      {falling && (
        <div aria-hidden data-confetti className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
          {pieces.map((piece, i) => (
            <span key={i} className="nib-confetti" style={piece} />
          ))}
        </div>
      )}
    </>
  )
}

/** Fifty pieces, each its own colour, place, speed, drift and spin, falling for as long as the card is open. */
function makeConfetti(): CSSProperties[] {
  return confetti(50, [STAMP_INKS.red, STAMP_INKS.amber, STAMP_INKS.green, STAMP_INKS.blue, STAMP_INKS.violet, STAMP_INKS.rose], 4, 8)
}
