import { useRef, useState } from 'react'
import { dayMonth, localDay } from '../lib/time'
import { openedLate } from '../lib/collection'
import { calendarDoors, stampFor, type Door } from '../lib/rewards'
import { DOORS, MOTIFS } from '../lib/stampWords'
import { StampArt, GroundFill } from './StampArt'
import { Sheet } from './Sheet'
import { StampSheet } from './StampSheet'

/**
 * The Christmas calendar (lib/rewards), in December: its 24 doors over a
 * winter night, each opened by its day's pack. A shut door wears its stamp's
 * pattern, and today's a ribbon. An open door stands swung out on its hinge
 * with its stamp behind it, and one opened today swings open as the calendar
 * appears. A missed door stays shut until a later pack in December opens it,
 * the latest missed first and one to a pack; doors still to come are faint.
 * Tapped, a door opens to its own page.
 */
export function ChristmasCalendar({ stamps, onClose }: { stamps: string[]; onClose: () => void }) {
  const [today] = useState(() => localDay(Date.now()))
  const [late] = useState(openedLate)
  const [looking, setLooking] = useState<Door | null>(null)
  // A door's page hands focus back to the door (the rest is Sheet's).
  const opener = useRef<HTMLElement | null>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  const doors = calendarDoors(stamps, today)
  const open = doors.filter((door) => door.state === 'open').length
  const todays = doors.find((door) => door.day === today)
  const now =
    todays?.state === 'today' ? ` Today’s pack opens door ${todays.door}.` : todays?.state === 'open' ? ' Today’s door is open.' : ''

  return (
    <>
      <Sheet label="Christmas calendar" onClose={onClose} top="pt-[8vh]" focus={closeButton} focusOnTouch className="nib-pop flex h-fit max-h-[86dvh] w-[min(380px,92vw)] flex-col rounded-lg border border-line bg-paper">
        <div className="flex items-start gap-3 border-b border-line p-4">
          <div className="flex-1">
            <div className="text-[14px] font-medium">Christmas calendar</div>
            <p className="mt-1 text-[12px] leading-[1.5] text-muted">
              {open === DOORS ? `All ${DOORS} doors open.` : `${open} of ${DOORS} doors open.`}
              {now} Each day’s pack in December also opens the latest door you’ve missed.
            </p>
          </div>
          <button ref={closeButton} onClick={onClose} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative grid grid-cols-4 gap-3 px-4 pt-16 pb-28">
            <WinterScene />
            {doors.map((door) => (
              <DoorView
                key={door.day}
                door={door}
                fresh={door.state === 'open' && door.day === today}
                onOpen={(button) => {
                  opener.current = button
                  setLooking(door)
                }}
              />
            ))}
          </div>
        </div>
      </Sheet>
      {looking && (
        <DoorSheet
          door={looking}
          openedOn={late[looking.day]}
          onBack={() => {
            setLooking(null)
            opener.current?.focus()
          }}
        />
      )}
    </>
  )
}

const WHY = { today: 'opens with today’s pack', missed: 'missed', ahead: 'still to come' }

function DoorView({ door, fresh, onOpen }: { door: Door; fresh: boolean; onOpen: (button: HTMLElement) => void }) {
  const stamp = stampFor(door.day)
  return (
    <button
      aria-label={door.state === 'open' ? `Door ${door.door}, open` : `Door ${door.door}, ${WHY[door.state]}`}
      data-state={door.state}
      data-fresh={fresh || undefined}
      onClick={(event) => onOpen(event.currentTarget)}
      className={`nib-tap relative flex aspect-[5/6] cursor-pointer items-center justify-center ${door.state === 'open' ? 'nib-door' : ''}`}
    >
      {door.state === 'open' && (
        <span className="nib-stamp">
          <StampArt stamp={stamp} width={42} />
        </span>
      )}
      {/* Shut, or swung out on its hinge. */}
      <DoorFace door={door} className={door.state === 'open' ? 'nib-door-panel' : door.state === 'ahead' ? 'opacity-60' : ''} />
    </button>
  )
}

/** A door's face: its number on its stamp's pattern, and a ribbon round today's. */
function DoorFace({ door, className = '', large = false }: { door: Door; className?: string; large?: boolean }) {
  const { ink, ground } = stampFor(door.day)
  return (
    <span
      aria-hidden
      style={{ borderColor: ink, color: ink, background: `color-mix(in srgb, color-mix(in srgb, ${ink} 14%, var(--color-paper)) 88%, transparent)` }}
      className={`absolute inset-0 flex items-center justify-center overflow-hidden rounded-[3px] border font-medium ${large ? 'text-[34px]' : 'text-[17px]'} ${className}`}
    >
      <GroundFill ground={ground!} ink={ink} />
      <span className="relative rounded-full bg-paper/85 px-[0.35em] leading-[1.35]">{door.door}</span>
      {door.state === 'today' && <Ribbon />}
    </span>
  )
}

/** Today's door, tied up like a present: a red ribbon each way, and a bow where they cross. */
function Ribbon() {
  return (
    <svg data-ribbon viewBox="0 0 50 60" className="absolute inset-0 h-full w-full">
      <path d="M33 0 V60 M0 15 H50" style={{ stroke: '#c8463a', strokeWidth: 5 }} />
      <path d="M33 0 V60 M0 15 H50" style={{ stroke: '#9e2f26', strokeWidth: 5, strokeDasharray: '0.6 4.4', opacity: 0.5 }} />
      <path d="M33 15 C26 6 22 12 26 16 C29 19 33 15 33 15 Z M33 15 C40 6 44 12 40 16 C37 19 33 15 33 15 Z" style={{ fill: '#c8463a', stroke: '#9e2f26', strokeWidth: 0.8 }} />
      <path d="M32 16 L28 25 M34 16 L38 25" style={{ stroke: '#c8463a', strokeWidth: 2.4, strokeLinecap: 'round' }} />
      <circle cx={33} cy={15} r={2.2} style={{ fill: '#9e2f26' }} />
    </svg>
  )
}

/** A few stars over the scene, scattered the same way every time. */
const STARS = Array.from({ length: 46 }, (_, i) => {
  const x = (i * 73.13) % 340
  const y = (i * 37.71 + (i % 3) * 11) % 300
  return [x, y, i % 5 === 0 ? 1.3 : 0.8] as const
})

/**
 * The night behind the doors: stars and a moon over snowy hills, pines, and
 * a cottage with its window lit. The same in either theme, as a printed
 * calendar is.
 */
function WinterScene() {
  return (
    <svg aria-hidden data-scene viewBox="0 0 340 600" preserveAspectRatio="xMidYMax slice" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <linearGradient id="nib-winter-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#13294a" />
          <stop offset="0.65" stopColor="#2d5b86" />
          <stop offset="1" stopColor="#7aa3c4" />
        </linearGradient>
      </defs>
      <rect width="340" height="600" fill="url(#nib-winter-sky)" />
      {STARS.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#ffffff" opacity={0.75} />
      ))}
      <circle cx="282" cy="40" r="30" fill="#f6efd6" opacity="0.12" />
      <circle cx="282" cy="40" r="17" fill="#f6efd6" />
      <path d="M0 528 Q60 500 120 520 T240 512 T340 518 V600 H0 Z" fill="#cfdeeb" />
      {[18, 52, 96, 150, 268, 312].map((x, i) => (
        <path key={x} d={`M${x} ${506 - (i % 2) * 6} l-7 17 h4 l-6 14 h18 l-6 -14 h4 Z`} fill="#24513f" />
      ))}
      <path d="M0 566 Q90 540 180 562 T340 552 V600 H0 Z" fill="#eef4f9" />
      <path d="M214 568 V550 L232 536 L250 550 V568 Z" fill="#7a4a35" />
      <path d="M210 552 L232 532 L254 552" fill="none" stroke="#f8fbfd" strokeWidth="4" strokeLinejoin="round" />
      <rect x="226" y="553" width="11" height="9" fill="#f3c76b" />
      <path d="M242 541 V530 H247 V545" fill="#7a4a35" />
      <path d="M244 526 q-4 -6 1 -11 q5 -5 0 -11" fill="none" stroke="#eef4f9" strokeWidth="2" opacity="0.6" />
    </svg>
  )
}

/**
 * A door's own page, from the calendar or the Stampbook's keepsakes: open, its stamp large,
 * its prompt, and the day it was opened (`openedOn`, if not its own); shut,
 * the door, and when it will open.
 */
export function DoorSheet({ door, openedOn, onBack }: { door: Door; openedOn?: string; onBack: () => void }) {
  const stamp = stampFor(door.day)
  const date = dayMonth(door.day)
  const open = door.state === 'open'
  return (
    <StampSheet
      label={`Door ${door.door}`}
      art={
        open ? (
          <StampArt stamp={stamp} width={110} />
        ) : (
          <span className="relative block h-[132px] w-[110px]">
            <DoorFace door={door} large />
          </span>
        )
      }
      caption={`Door ${door.door} · ${date}`}
      name={open ? MOTIFS[stamp.motif] : door.state === 'today' ? 'Today’s door' : door.state === 'missed' ? 'Missed' : 'Still to come'}
      note={
        open
          ? openedOn && openedOn !== door.day
            ? `Opened on ${dayMonth(openedOn)}, with that day’s pack.`
            : `Opened on ${date}.`
          : door.state === 'today'
            ? 'Today’s pack opens it.'
            : door.state === 'missed'
              ? 'Each day’s pack in December opens the latest door missed.'
              : `It opens on ${date}, with that day’s pack.`
      }
      onBack={onBack}
    >
      {(open || door.state === 'today') && (
        <div className="mt-4 border-t border-line pt-3 text-left">
          <div className="text-[11px] text-muted">Its prompt</div>
          <p className="mt-1 text-[13px] leading-[1.5]">{stamp.prompt}</p>
        </div>
      )}
    </StampSheet>
  )
}
