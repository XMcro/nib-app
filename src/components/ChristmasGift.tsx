import { type CSSProperties, useRef, useState } from 'react'
import { readCalendar } from '../lib/goal'
import { localDay } from '../lib/time'
import { motion } from '../lib/motion'
import { decemberLookBack, stampFor } from '../lib/rewards'
import { DOORS } from '../lib/stampWords'
import { Sheet } from './Sheet'
import { StampArt } from './StampArt'

/**
 * Christmas Day's present (lib/rewards `christmasWaiting`): from the 25th to
 * the 31st, for anyone who opened a door that December. It waits beside the
 * way back to the library, like a pack put off, so it never interrupts a
 * sentence.
 */
export function ChristmasPresent({ onOpen }: { onOpen: () => void }) {
  return (
    <button aria-label="A Christmas present" onClick={onOpen} data-fresh className="nib-stamp nib-tap cursor-pointer">
      <StampArt stamp={stampFor(`${new Date().getFullYear()}-12-25`)} width={20} />
    </button>
  )
}

/**
 * The present, opened: Christmas Day's gold stamp, snow falling over the page
 * while it's open (with Motion at full, and the system not asking for less),
 * a look back at December, and Winter, a theme to keep.
 */
export function ChristmasCard({
  stamps,
  wearingWinter,
  onWinter,
  onCalendar,
  onClose,
}: {
  stamps: string[]
  /** Winter (lib/theme), the theme the present gives, is the one on now. */
  wearingWinter: boolean
  onWinter: () => void
  onCalendar: () => void
  onClose: () => void
}) {
  const [today] = useState(() => localDay(Date.now()))
  const [look] = useState(() => decemberLookBack(readCalendar(), stamps, today))
  const [snowing] = useState(() => motion() === 1)
  const [flakes] = useState(makeFlakes)
  const closeButton = useRef<HTMLButtonElement>(null)

  const days = `${look.days.toLocaleString()} ${look.days === 1 ? 'day' : 'days'}`
  const words = `${look.words.toLocaleString()} ${look.words === 1 ? 'word' : 'words'}`
  const doors = `${look.doors} of ${DOORS} doors`
  return (
    <>
      <Sheet label="Happy Christmas" onClose={onClose} top="pt-[14vh]" focus={closeButton} focusOnTouch className="nib-pop h-fit w-[min(340px,90vw)] rounded-lg border border-line bg-paper p-5">
        <div className="nib-stamp mx-auto w-fit" data-fresh>
          <StampArt stamp={stampFor(`${today.slice(0, 4)}-12-25`)} width={110} />
        </div>
        <div className="mt-5 text-center text-[15px] font-medium">Happy Christmas</div>
        <p className="mt-1 text-center text-[12px] leading-[1.5] text-muted">The gold stamp, for opening a door in December.</p>
        <div className="mt-4 border-t border-line pt-4">
          <div className="text-[11px] text-muted">Your December</div>
          <p className="mt-1.5 text-[14px] leading-[1.5]">
            {look.days ? `You wrote ${words} on ${days}, and opened ${doors}.` : `You opened ${doors}.`}
          </p>
          {look.days > 0 && <p className="mt-1 text-[11px] text-muted">Words written on this device.</p>}
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
          <p className="flex-1 text-[12px] leading-[1.5] text-muted">
            And Winter, a theme of frost and holly, is yours to keep. It’s in Settings, with the others.
          </p>
          {!wearingWinter && (
            <button onClick={onWinter} className="nib-tap shrink-0 cursor-pointer rounded-md border border-line px-3 py-1.5 text-[12px] text-ink hover:bg-item-hover">
              Try Winter
            </button>
          )}
        </div>
        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={() => {
              onClose()
              onCalendar()
            }}
            className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink"
          >
            Christmas calendar
          </button>
          <span className="flex-1" />
          <button ref={closeButton} onClick={onClose} className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper">
            Close
          </button>
        </div>
      </Sheet>
      {snowing && (
        <div aria-hidden data-snow className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
          {flakes.map((flake, i) => (
            <span key={i} className="nib-snowflake" style={flake} />
          ))}
        </div>
      )}
    </>
  )
}

/** Forty flakes, each its own size, place, speed and drift, falling for as long as the card is open. */
function makeFlakes(): CSSProperties[] {
  return Array.from({ length: 40 }, () => {
    const size = 3 + Math.random() * 5
    return {
      left: `${Math.random() * 100}%`,
      width: size,
      height: size,
      opacity: 0.5 + Math.random() * 0.5,
      animationDuration: `${6 + Math.random() * 6}s`,
      animationDelay: `${-Math.random() * 12}s`,
      '--drift': `${-30 + Math.random() * 60}px`,
    } as CSSProperties
  })
}
