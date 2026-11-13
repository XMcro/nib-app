import { useState, type ReactNode } from 'react'
import type { Placed } from '../db/db'
import { nextOf, type Holiday } from '../lib/holidays'
import { VALUE } from '../lib/market'
import { whatIs } from '../lib/placed'
import { bookStamp, drawn, stampFor } from '../lib/rewards'
import { BOOK, LUCKY, RARITY_NAMES, type Entry } from '../lib/stampbook'
import { dayMonth, localDay, longDay, shortDay } from '../lib/time'
import { StampArt } from './StampArt'
import { StampSheet } from './StampSheet'

export type Chosen = { entry: Entry } | { holiday: Holiday }

/** A stamp still to find: its place in the book, perforated, with its number or date. */
export function Blank({ label, large = false }: { label: string; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex items-center justify-center rounded-[2px] border border-dashed border-line text-faint ${large ? 'h-[132px] w-[110px] text-[15px]' : 'h-[48px] w-[40px] text-[10px]'}`}
    >
      {label}
    </span>
  )
}

/**
 * One stamp's own page, over the book: large, with its name and story and
 * when it was found, or how to find it. `children`: what can be done with
 * one found, given the days it was found.
 */
export function StampPage({
  chosen,
  days,
  today,
  copies = 0,
  onSell,
  onBack,
  back = 'Back',
  children,
}: {
  chosen: Chosen
  days: string[] | undefined
  today: string
  /** How many of it there are, and selling one: a repeat's, from the Stampbook. */
  copies?: number
  onSell?: () => void
  onBack: () => void
  back?: string
  children?: (days: string[]) => ReactNode
}) {
  // Sold here, a copy at a time: each rises off the button as coins.
  const [sold, setSold] = useState(0)
  const entry = 'entry' in chosen ? chosen.entry : null
  const holiday = 'holiday' in chosen ? chosen.holiday : null
  const when = days
    ? days.length === 1
      ? `Found on ${longDay(days[0])}.`
      : `Found ${days.length} times, first on ${longDay(days[0])}.`
    : entry
      ? `Each stamp drawn is ${RARITY_NAMES[entry.rarity].toLowerCase()} ${LUCKY[entry.rarity]}% of the time, any of the ${BOOK.filter((other) => other.rarity === entry.rarity).length}, so repeats come too.`
      : `Open the day’s pack on ${dayMonth(nextOf(holiday!, today))}, and it’s yours.`

  return (
    <StampSheet
      label={entry ? `No. ${entry.no}` : holiday!.name}
      art={
        days ? (
          <StampArt stamp={entry ? bookStamp(entry.no, days[0]) : stampFor(days[0])} width={110} />
        ) : (
          <Blank label={entry ? `No. ${entry.no}` : shortDay(nextOf(holiday!, today))} large />
        )
      }
      caption={entry ? `${RARITY_NAMES[entry.rarity]} · No. ${entry.no}` : 'Holiday'}
      name={entry ? (days ? entry.name : 'Still to find') : holiday!.name}
      story={entry ? (days ? entry.story : null) : holiday!.story}
      note={when}
      back={back}
      onBack={onBack}
    >
      {days && children?.(days)}
      {entry && onSell && (copies > 1 || sold > 0) && (
        <div className="relative mt-4 border-t border-line pt-3">
          {copies > 1 && (
            <button
              onClick={() => {
                onSell()
                setSold((was) => was + 1)
              }}
              className="nib-tap cursor-pointer rounded-md border border-line px-3 py-1.5 text-[12px] text-ink hover:bg-item-hover"
            >
              Sell one for {VALUE[entry.rarity]} {VALUE[entry.rarity] === 1 ? 'coin' : 'coins'}
            </button>
          )}
          <p className="mt-1.5 text-[11px] text-muted" aria-live="polite">
            You have {copies}. You always keep one.
          </p>
          {sold > 0 && (
            <span key={sold} aria-hidden className="nib-gain pointer-events-none absolute top-1 right-2 text-[15px] font-semibold text-accent">
              +{VALUE[entry.rarity]}
            </span>
          )}
        </div>
      )}
    </StampSheet>
  )
}

/**
 * The stamps put on a note or page (lib/placed), at the top of the writing,
 * over to the right as on an envelope. Tapped, one opens to its card.
 */
export function WritingStamps({ stamps, onOpen }: { stamps: Placed[]; onOpen: (placed: Placed) => void }) {
  return (
    <div className="relative">
      <div className="absolute -top-[58px] right-0 flex gap-2">
        {stamps.map((placed) => {
          const what = whatIs(placed)
          return (
            <button
              key={placed.no ?? placed.day}
              aria-label={`Stamp: ${'entry' in what ? what.entry.name : what.holiday.name}`}
              onClick={() => onOpen(placed)}
              className="nib-stamp nib-tap cursor-pointer"
            >
              <StampArt stamp={drawn(placed)} width={30} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A stamp on the writing, tapped: its card, from which it can be taken off. */
export function StampCard({ placed, label, onTakeOff, onClose }: { placed: Placed; label: string; onTakeOff: () => void; onClose: () => void }) {
  const [today] = useState(() => localDay(Date.now()))
  return (
    <StampPage chosen={whatIs(placed)} days={[placed.day]} today={today} onBack={onClose} back="Close">
      {() => (
        <button
          onClick={() => {
            onTakeOff()
            onClose()
          }}
          className="nib-tap mt-4 mr-2 cursor-pointer rounded-md border border-line px-3 py-1.5 text-[12px] text-ink hover:bg-item-hover"
        >
          Take off {label}
        </button>
      )}
    </StampPage>
  )
}
