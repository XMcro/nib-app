import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Placed } from '../db/db'
import { birthdayStamp, TWELFTH_OF_JUNE } from '../lib/birthday'
import { dayMonth, longDay, shortDay } from '../lib/time'
import { HOLIDAYS, holidaysFound, KEEPSAKE_DAYS, nextOf, onDay, type Holiday } from '../lib/holidays'
import { inkwellStamp, KEEPSAKES, keepsOf, keptOf, rarityStamp, yearStamp, type Keeps } from '../lib/keepsakes'
import { copiesOf, gotOf } from '../lib/market'
import type { StampMarket } from '../lib/marketActions'
import { MAX_PLACED, samePlaced } from '../lib/placed'
import { motion } from '../lib/motion'
import { openedLate } from '../lib/collection'
import { bookStamp, doorDay, doorUnopened, firstStepsStamp, stampFor, type Stamp } from '../lib/rewards'
import { DOORS } from '../lib/stampWords'
import { BOOK, foundIn, LUCKY, RARITIES, RARITY_INKS, RARITY_NAMES, type Entry, type Rarity } from '../lib/stampbook'
import { DoorSheet } from './ChristmasCalendar'
import { Market } from './Market'
import { StampArt } from './StampArt'
import { Blank, StampPage, type Chosen } from './StampPage'
import { Sheet } from './Sheet'
import { StampSheet } from './StampSheet'

/** How each rarity is found, as its pages say: a pack's odds (lib/stampbook LUCKY). */
const HOW: Record<Rarity, string> = {
  common: `${LUCKY.common}% of stamps drawn`,
  rare: `${LUCKY.rare}% of stamps drawn`,
  unique: `${LUCKY.unique}% of stamps drawn`,
  legendary: `${LUCKY.legendary}% of stamps drawn`,
  mythic: `${LUCKY.mythic}% of stamps drawn`,
}

/** On the keepsakes' page: first steps' stamp, Nib's birthday's, a year with Nib's, a rarity completed's, a keepsake day's, or a Christmas calendar door's. */
type Keepsake = { keepsake: 'first steps' | 'birthday' | 'inkwell' | 'year' | 'rarity' } | { keepsakeDay: Holiday } | { door: number }

/** The writing the Stampbook was opened over, to put stamps on (lib/placed): what to call it, and its stamps. */
export type Onto = { label: string; stamps: Placed[]; set: (stamps: Placed[]) => void }

/** Stamps to a page: five rows of five, so common's 187 take eight pages and rare's 60 three. */
const PER_PAGE = 25

/** The book's pages, in order: the contents, each rarity's, the holidays', and the keepsakes'. */
type Leaf = { kind: 'contents' } | { kind: 'rarity'; rarity: Rarity; entries: Entry[]; part: number; parts: number } | { kind: 'holidays' } | { kind: 'keepsakes' }
const LEAVES: Leaf[] = [
  { kind: 'contents' },
  ...RARITIES.flatMap((rarity) => {
    const all = BOOK.filter((entry) => entry.rarity === rarity)
    const parts = Math.ceil(all.length / PER_PAGE)
    return Array.from({ length: parts }, (_, part): Leaf => ({ kind: 'rarity', rarity, entries: all.slice(part * PER_PAGE, (part + 1) * PER_PAGE), part, parts }))
  }),
  { kind: 'holidays' },
  { kind: 'keepsakes' },
]
const firstPageOf = (rarity: Rarity) => LEAVES.findIndex((leaf) => leaf.kind === 'rarity' && leaf.rarity === rarity)
const HOLIDAYS_PAGE = LEAVES.findIndex((leaf) => leaf.kind === 'holidays')

/** Numbers as runs, the first 200's and the hundred after them apart: "197–200, 299–300". */
function runsOf(nos: number[]): string {
  const runs: [number, number][] = []
  for (const no of nos) {
    const last = runs.at(-1)
    if (last && no === last[1] + 1) last[1] = no
    else runs.push([no, no])
  }
  return runs.map(([from, to]) => (from === to ? `${from}` : `${from}–${to}`)).join(', ')
}

/** A page's name, as its section is labelled and the foot of the book says. */
function nameOf(leaf: Leaf) {
  if (leaf.kind === 'contents') return 'Contents'
  if (leaf.kind === 'holidays') return 'Holidays'
  if (leaf.kind === 'keepsakes') return 'Keepsakes'
  return leaf.parts > 1 ? `${RARITY_NAMES[leaf.rarity]}, page ${leaf.part + 1} of ${leaf.parts}` : RARITY_NAMES[leaf.rarity]
}

/** A stamp's width in its mount, and the mounts to a row: the rarest few have room to be seen. */
const MOUNT: Record<Rarity, { art: number; columns: number }> = {
  common: { art: 44, columns: 5 },
  rare: { art: 44, columns: 5 },
  unique: { art: 44, columns: 5 },
  legendary: { art: 70, columns: 3 },
  mythic: { art: 86, columns: 2 },
}

/** How long, in milliseconds at full Motion, the cover waits before it swings open, and a page takes to turn. */
const COVER_WAIT = 380
const TURN = 560

/**
 * The stampbook (lib/stampbook) as an album: all 200, found or not, the 17
 * holidays' (lib/holidays), and the keepsakes, first steps' stamp, Nib's
 * birthday's and the Christmas calendar's doors. It appears shut, and its cover swings open
 * onto the contents, each rarity's progress filling in; its pages turn with
 * a swipe, the arrow keys, or the arrows at its foot. On each page a stamp
 * found settles into its mount, held at the corners, and the rarer catch the
 * light now and then; one still to find leaves its mount empty, with its
 * number, or a holiday its next date. Tapped, either opens to its own page,
 * where one found can be put on the writing it was opened over (`onto`), or
 * taken off it. With Motion off it all simply appears.
 */
export function Stampbook({
  stamps,
  market,
  firstSteps,
  written,
  birthday,
  inkwell = null,
  onto,
  onClose,
}: {
  stamps: string[]
  /** The market's (lib/market), and what's done there: selling repeats, buying a pack, or today's stamp again. */
  market: StampMarket
  /** The day first steps were all done (lib/firsts). */
  firstSteps: string | null
  /** The day of the oldest document (components/useRewardSheets), for a year with Nib. */
  written: string | null
  /** The birthday Nib's birthday stamp was kept on (lib/birthday). */
  birthday: string | null
  /** The day Inkwell first told its story (lib/buddy). */
  inkwell?: string | null
  onto: Onto | null
  onClose: () => void
}) {
  const { received, trades, today, points, sell: onSell } = market
  const [late] = useState(openedLate)
  // From packs and the market both.
  const found = foundIn(gotOf(received, trades))
  const copies = copiesOf(received, trades)
  const holidays = holidaysFound(stamps)
  const [trading, setTrading] = useState(false)
  const marketButton = useRef<HTMLButtonElement>(null)
  const keeps = keepsOf({ stamps, found, firstSteps, birthday, inkwell, written, today })
  const [chosen, setChosen] = useState<Chosen | Keepsake | null>(null)
  const [scale] = useState(motion)
  const [cover, setCover] = useState<'shut' | 'opening' | 'open'>(scale ? 'shut' : 'open')
  const [page, setPage] = useState(0)
  // A page turning over: the one left, and which way.
  const [turning, setTurning] = useState<{ from: number; forward: boolean } | null>(null)
  useEffect(() => {
    if (cover !== 'shut') return
    const timer = window.setTimeout(() => setCover('opening'), COVER_WAIT * scale)
    return () => window.clearTimeout(timer)
  }, [cover, scale])
  useEffect(() => {
    if (!turning) return
    const timer = window.setTimeout(() => setTurning(null), TURN * scale)
    return () => window.clearTimeout(timer)
  }, [turning, scale])
  const album = useRef<HTMLDivElement>(null)
  function turnTo(next: number) {
    if (next < 0 || next >= LEAVES.length || next === page) return
    // Focus on the page being left would go with it, and the arrow keys with it: to the book.
    if (album.current?.contains(document.activeElement)) album.current.focus({ preventScroll: true })
    setTurning(scale ? { from: page, forward: next > page } : null)
    setPage(next)
  }

  // A stamp's page hands focus back to the stamp (the rest is Sheet's).
  const opener = useRef<HTMLElement | null>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  function choose(next: Chosen | Keepsake, button: HTMLElement) {
    opener.current = button
    setChosen(next)
  }

  // A swipe across a page turns it, and isn't a tap on the stamp it began on;
  // on a Mac, two fingers across the trackpad. Each page scrolls up and down
  // only (touch-pan-y), or iOS takes a sideways drag as a scroll and cancels it.
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  const wheel = useRef({ dx: 0, until: 0 })

  // The page showing, and while one turns, the one it left: under it going
  // forward, as it lifts away; over it going back, as it comes down again.
  const layers = turning ? (turning.forward ? [page, turning.from] : [turning.from, page]) : [page]
  return (
    <>
      <Sheet
        label="Stampbook"
        onClose={onClose}
        top="pt-[8vh]"
        focus={closeButton}
        focusOnTouch
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') turnTo(page + 1)
          else if (event.key === 'ArrowLeft') turnTo(page - 1)
        }}
        className="nib-pop flex h-fit w-[min(420px,94vw)] flex-col rounded-lg border border-line bg-paper"
      >
        {/* Its buttons go below where there isn't room beside: at 320 points the words ran to eight lines. */}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-line p-4">
          <div className="min-w-[180px] flex-1">
            <div className="text-[14px] font-medium">Stampbook</div>
            <p className="mt-1 text-[12px] text-muted">
              {found.size} of {BOOK.length} found, and {holidays.size} of {HOLIDAYS.length} holidays. Kept on this device, and through iCloud on your others.
            </p>
          </div>
          {page > 0 && (
            <button onClick={() => turnTo(0)} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
              Contents
            </button>
          )}
          <button ref={marketButton} onClick={() => setTrading(true)} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
            Market · {points.toLocaleString()}
          </button>
          <button ref={closeButton} onClick={onClose} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
            Close
          </button>
        </div>
        <div
          ref={album}
          tabIndex={-1}
          className="nib-album relative m-3 h-[min(520px,60dvh)] outline-none"
          onPointerDown={(event) => {
            swipe.current = { x: event.clientX, y: event.clientY }
            swiped.current = false
          }}
          onPointerUp={(event) => {
            const from = swipe.current
            swipe.current = null
            if (!from) return
            const dx = event.clientX - from.x
            if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(event.clientY - from.y) * 1.5) return
            swiped.current = true
            turnTo(page + (dx < 0 ? 1 : -1))
          }}
          onClickCapture={(event) => {
            if (!swiped.current) return
            swiped.current = false
            event.stopPropagation()
          }}
          onWheel={(event) => {
            if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || event.timeStamp < wheel.current.until) return
            wheel.current.dx += event.deltaX
            if (Math.abs(wheel.current.dx) < 60) return
            turnTo(page + (wheel.current.dx > 0 ? 1 : -1))
            wheel.current = { dx: 0, until: event.timeStamp + TURN }
          }}
        >
          {layers.map((index) => {
            const left = index !== page
            const moving = turning !== null && (turning.forward ? left : !left)
            return (
              <AlbumPage
                key={index}
                index={index}
                left={left}
                className={moving ? (turning.forward ? 'nib-leaf-out' : 'nib-leaf-in') : ''}
                // The first page waits for the cover; the rest are under it as it turns.
                wait={(index === 0 && cover !== 'open' ? COVER_WAIT + 420 : 140) * scale}
                found={found}
                copies={copies}
                holidays={holidays}
                keeps={keeps}
                today={today}
                onChoose={choose}
                onJump={turnTo}
              />
            )
          })}
          {cover !== 'open' && <Cover state={cover} found={found.size} onOpen={() => setCover('opening')} onOpened={() => setCover('open')} />}
        </div>
        <div className="flex items-center gap-2 px-3 pb-3">
          <button aria-label="Previous page" disabled={page === 0} onClick={() => turnTo(page - 1)} className="nib-tap cursor-pointer rounded-md px-2.5 py-1 text-[15px] text-muted hover:text-ink disabled:cursor-default disabled:opacity-30">
            ‹
          </button>
          <div className="flex-1 text-center text-[11.5px] text-muted" aria-live="polite">
            {nameOf(LEAVES[page])}
          </div>
          <button
            aria-label="Next page"
            disabled={page === LEAVES.length - 1}
            onClick={() => turnTo(page + 1)}
            className="nib-tap cursor-pointer rounded-md px-2.5 py-1 text-[15px] text-muted hover:text-ink disabled:cursor-default disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </Sheet>
      {trading && (
        <Market
          market={market}
          onClose={() => {
            setTrading(false)
            marketButton.current?.focus()
          }}
        />
      )}
      {chosen && ('door' in chosen || 'keepsake' in chosen || 'keepsakeDay' in chosen) && (
        <KeepsakePage
          chosen={chosen}
          keeps={keeps}
          late={late}
          today={today}
          onBack={() => {
            setChosen(null)
            opener.current?.focus()
          }}
        />
      )}
      {chosen && ('entry' in chosen || 'holiday' in chosen) && (
        <StampPage
          chosen={chosen}
          days={'entry' in chosen ? found.get(chosen.entry.no) : holidays.get(chosen.holiday.name)}
          today={today}
          copies={'entry' in chosen ? (copies.get(chosen.entry.no) ?? 0) : undefined}
          onSell={'entry' in chosen ? () => onSell([chosen.entry.no]) : undefined}
          onBack={() => {
            setChosen(null)
            opener.current?.focus()
          }}
        >
          {(days) => onto && <PutOn placed={'entry' in chosen ? { day: days[0], no: chosen.entry.no } : { day: days[0] }} onto={onto} />}
        </StampPage>
      )}
    </>
  )
}

/**
 * The Stampbook's cover, shut: green cloth, a gold frame, and a winged nib on
 * a perforated stamp, with how many are found. It swings open on its spine
 * (`state` opening) a moment after the book appears, or at a tap.
 */
function Cover({ state, found, onOpen, onOpened }: { state: 'shut' | 'opening'; found: number; onOpen: () => void; onOpened: () => void }) {
  return (
    <div aria-hidden data-cover={state} onClick={onOpen} onAnimationEnd={(event) => event.animationName === 'coverOpen' && onOpened()} className="nib-cover absolute inset-0 z-10 flex cursor-pointer flex-col items-center justify-center">
      <span className="nib-cover-frame" />
      <span className="text-[10px] font-semibold tracking-[0.4em]">NIB</span>
      <svg viewBox="0 0 80 96" width={92} className="mt-4">
        <rect x={6} y={6} width={68} height={84} fill="none" stroke="currentColor" strokeWidth={3.2} strokeDasharray="0.01 5.2" strokeLinecap="round" />
        <rect x={12} y={12} width={56} height={72} fill="none" stroke="currentColor" strokeWidth={1} />
        <path d="M31 47 C22 41 15 43 10 36 C18 37 23 34 30 39 C23 33 19 30 16 23 C24 27 28 30 33 37 Z" fill="currentColor" opacity={0.85} />
        <path d="M49 47 C58 41 65 43 70 36 C62 37 57 34 50 39 C57 33 61 30 64 23 C56 27 52 30 47 37 Z" fill="currentColor" opacity={0.85} />
        <path d="M40 24 L50 50 L40 72 L30 50 Z" fill="currentColor" />
        <path d="M40 52 V70" stroke="#1d3229" strokeWidth={1.4} />
        <circle cx={40} cy={50} r={2.6} fill="#1d3229" />
      </svg>
      <span className="mt-5 text-[17px] font-semibold tracking-[0.3em]">STAMPBOOK</span>
      <span className="mt-2 text-[11px] tracking-[0.12em] opacity-80">
        {found} OF {BOOK.length}
      </span>
    </div>
  )
}

/**
 * One page of the album. `left`: the one a turning page has left, there to
 * be seen and not used. `wait`: how long before its stamps settle in, or the
 * contents' progress fills.
 */
function AlbumPage({
  index,
  left,
  className,
  wait,
  found,
  copies,
  holidays,
  keeps,
  today,
  onChoose,
  onJump,
}: {
  index: number
  left: boolean
  className: string
  wait: number
  found: Map<number, string[]>
  /** How many of each there are, less any traded in (lib/market). */
  copies: Map<number, number>
  holidays: Map<string, string[]>
  keeps: Keeps
  today: string
  onChoose: (chosen: Chosen | Keepsake, button: HTMLElement) => void
  onJump: (page: number) => void
}) {
  const leaf = LEAVES[index]
  return (
    <section
      aria-label={nameOf(leaf)}
      aria-hidden={left || undefined}
      inert={left}
      className={`nib-leaf absolute inset-0 touch-pan-y overflow-y-auto px-4 pt-4 pb-3 ${className}`}
      style={{ '--wait': `${wait}ms` } as CSSProperties}
    >
      {leaf.kind === 'contents' ? (
        <Contents found={found} holidays={holidays} keeps={keeps} onJump={onJump} />
      ) : leaf.kind === 'keepsakes' ? (
        <>
          <PageHead title="Keepsakes" line={`${keptOf(keeps)} of ${KEEPSAKES} found`} />
          <h4 className="mb-2 text-center text-[11.5px] text-muted">First steps, Nib’s birthday and Inkwell</h4>
          <Mounts columns={3} art={44}>
            <Mount
              label={keeps.firstSteps ? 'First steps' : 'First steps, still to find'}
              stamp={keeps.firstSteps ? firstStepsStamp(keeps.firstSteps) : undefined}
              empty="Steps"
              art={44}
              order={0}
              onClick={(button) => onChoose({ keepsake: 'first steps' }, button)}
            />
            <Mount
              label={keeps.birthday ? 'Nib’s birthday' : 'Nib’s birthday, still to find'}
              stamp={keeps.birthday ? birthdayStamp(keeps.birthday) : undefined}
              empty={shortDay(TWELFTH_OF_JUNE)}
              art={44}
              order={1}
              onClick={(button) => onChoose({ keepsake: 'birthday' }, button)}
            />
            <Mount
              label={keeps.inkwell ? 'Inkwell' : 'Inkwell, still to find'}
              stamp={keeps.inkwell ? inkwellStamp(keeps.inkwell) : undefined}
              empty="Ink"
              art={44}
              order={2}
              onClick={(button) => onChoose({ keepsake: 'inkwell' }, button)}
            />
          </Mounts>
          <h4 className="mt-4 mb-2 text-center text-[11.5px] text-muted">Milestones and special days</h4>
          <Mounts columns={5} art={44}>
            <Mount
              label={keeps.year ? 'A year with Nib' : 'A year with Nib, still to find'}
              stamp={keeps.year ? yearStamp(keeps.year) : undefined}
              empty="1 year"
              art={44}
              order={3}
              onClick={(button) => onChoose({ keepsake: 'year' }, button)}
            />
            <Mount
              label={keeps.rarity ? 'A rarity completed' : 'A rarity completed, still to find'}
              stamp={keeps.rarity ? rarityStamp(keeps.rarity.day) : undefined}
              empty="All"
              art={44}
              order={4}
              onClick={(button) => onChoose({ keepsake: 'rarity' }, button)}
            />
            {KEEPSAKE_DAYS.map((keepsake, i) => {
              const days = keeps.days.get(keepsake.name)
              return (
                <Mount
                  key={keepsake.name}
                  label={days ? keepsake.name : `${keepsake.name}, still to find`}
                  stamp={days && stampFor(days[0])}
                  empty={shortDay(`2028-${keepsake.date(2028)}`)}
                  art={44}
                  order={5 + i}
                  onClick={(button) => onChoose({ keepsakeDay: keepsake }, button)}
                />
              )
            })}
          </Mounts>
          <h4 className="mt-4 mb-2 text-center text-[11.5px] text-muted">The Christmas calendar</h4>
          <Mounts columns={5} art={44}>
            {Array.from({ length: DOORS }, (_, i) => {
              const days = keeps.doors.get(i + 1)
              return (
                <Mount
                  key={i}
                  label={days ? `Door ${i + 1}` : `Door ${i + 1}, still to find`}
                  stamp={days && stampFor(days[0])}
                  empty={shortDay(doorDay(i + 1, today))}
                  art={44}
                  order={5 + KEEPSAKE_DAYS.length + i}
                  onClick={(button) => onChoose({ door: i + 1 }, button)}
                />
              )
            })}
          </Mounts>
        </>
      ) : leaf.kind === 'holidays' ? (
        <>
          <PageHead title="Holidays" line={`${holidays.size} of ${HOLIDAYS.length} found · In the day’s pack`} />
          <Mounts columns={5} art={44}>
            {HOLIDAYS.map((holiday, i) => {
              const days = holidays.get(holiday.name)
              return (
                <Mount
                  key={holiday.name}
                  label={days ? holiday.name : `${holiday.name}, still to find`}
                  stamp={days && stampFor(days[0])}
                  empty={shortDay(nextOf(holiday, today))}
                  art={44}
                  order={i}
                  onClick={(button) => onChoose({ holiday }, button)}
                />
              )
            })}
          </Mounts>
        </>
      ) : (
        <>
          <PageHead
            title={RARITY_NAMES[leaf.rarity]}
            aside={`No. ${runsOf(leaf.entries.map((entry) => entry.no))}`}
            line={`${BOOK.filter((entry) => entry.rarity === leaf.rarity && found.has(entry.no)).length} of ${BOOK.filter((entry) => entry.rarity === leaf.rarity).length} found · ${HOW[leaf.rarity]}`}
          />
          <Mounts columns={MOUNT[leaf.rarity].columns} art={MOUNT[leaf.rarity].art}>
            {leaf.entries.map((entry, i) => {
              const days = found.get(entry.no)
              const have = copies.get(entry.no) ?? 0
              return (
                <Mount
                  key={entry.no}
                  label={days ? `No. ${entry.no}, ${entry.name}${have > 1 ? `, ${have} copies` : ''}` : `No. ${entry.no}, still to find`}
                  stamp={days && bookStamp(entry.no, days[0])}
                  copies={have}
                  empty={String(entry.no)}
                  art={MOUNT[leaf.rarity].art}
                  order={i}
                  onClick={(button) => onChoose({ entry }, button)}
                />
              )
            })}
          </Mounts>
        </>
      )}
      <div aria-hidden className="mt-4 text-center text-[10px] text-faint">
        {index + 1}
      </div>
    </section>
  )
}

function PageHead({ title, aside, line }: { title: string; aside?: string; line: string }) {
  return (
    <div className="mb-3 text-center">
      <h3 className="nib-page-title text-[13px] font-semibold">
        {title}
        {aside && <span className="ml-2 text-[11px] font-normal text-muted">{aside}</span>}
      </h3>
      <p className="mt-0.5 text-[11.5px] text-muted">{line}</p>
    </div>
  )
}

/** A page's mounts, in rows, as many to a row as the rarity has, or fewer where they don't fit (Slide Over on an iPad, 320 points). */
function Mounts({ columns, art, children }: { columns: number; art: number; children: ReactNode }) {
  return (
    <div className="mx-auto grid justify-center gap-[6px]" style={{ gridTemplateColumns: `repeat(auto-fill, ${art + 14}px)`, maxWidth: columns * (art + 14) + (columns - 1) * 6 }}>
      {children}
    </div>
  )
}

/**
 * A stamp's place on a page: with it found, the stamp, held at its corners,
 * settling in (`order` staggers them) and, from rare up, catching the light,
 * with how many `copies` there are past one; still to find, empty, with its
 * number or date.
 */
function Mount({
  label,
  stamp,
  copies = 1,
  empty,
  art,
  order,
  onClick,
}: {
  label: string
  stamp: Stamp | undefined
  copies?: number
  empty: string
  art: number
  order: number
  onClick: (button: HTMLElement) => void
}) {
  const shines = stamp?.rarity !== undefined && stamp.rarity !== 'common'
  return (
    <button
      aria-label={label}
      onClick={(event) => onClick(event.currentTarget)}
      data-found={stamp ? true : undefined}
      data-rarity={stamp?.rarity}
      className="nib-mount nib-tap cursor-pointer"
      style={{ '--i': order, height: art * 1.2 + 14 } as CSSProperties}
    >
      {stamp ? (
        <span className="nib-stamp">
          <StampArt stamp={stamp} width={art} />
        </span>
      ) : (
        <span aria-hidden className="text-[10px] text-faint">
          {empty}
        </span>
      )}
      {shines && <span aria-hidden className="nib-glint" />}
      {stamp && <span aria-hidden className="nib-corners" />}
      {stamp && copies > 1 && (
        <span aria-hidden className="absolute -top-1 -right-1 z-10 rounded-full border border-line bg-paper px-1 text-[9.5px] leading-[15px] font-semibold text-muted">
          ×{copies}
        </span>
      )}
    </button>
  )
}

/** The first page: each rarity, the holidays and the keepsakes, with how many are found, a bar filling to it, and the way to its pages. */
function Contents({ found, holidays, keeps, onJump }: { found: Map<number, string[]>; holidays: Map<string, string[]>; keeps: Keeps; onJump: (page: number) => void }) {
  const rows = [
    ...RARITIES.map((rarity) => {
      const all = BOOK.filter((entry) => entry.rarity === rarity)
      return { name: RARITY_NAMES[rarity], rarity, have: all.filter((entry) => found.has(entry.no)).length, of: all.length, how: HOW[rarity], page: firstPageOf(rarity) }
    }),
    { name: 'Holidays', rarity: undefined, have: holidays.size, of: HOLIDAYS.length, how: 'In the day’s pack', page: HOLIDAYS_PAGE },
    { name: 'Keepsakes', rarity: undefined, have: keptOf(keeps), of: KEEPSAKES, how: 'Milestones, special days, and Christmas', page: LEAVES.length - 1 },
  ]
  return (
    <>
      <PageHead title="Contents" line="Tap one to turn to it." />
      <ol className="space-y-1">
        {rows.map((row) => (
          <li key={row.name}>
            <button
              aria-label={`${row.name}, ${row.have} of ${row.of} found, ${row.how.toLowerCase()}`}
              onClick={() => onJump(row.page)}
              className="nib-tap w-full cursor-pointer rounded-md px-2 py-2 text-left hover:bg-item-hover"
            >
              <span className="flex items-baseline gap-2 text-[13px]">
                <span className="font-medium">{row.name}</span>
                <span aria-hidden className="mb-[3px] flex-1 border-b border-dotted border-line" />
                <span className="text-[12px] text-muted">
                  {row.have} of {row.of}
                </span>
              </span>
              <span className="nib-progress mt-1.5 block h-[5px] rounded-full bg-item-active" data-rarity={row.rarity}>
                <span style={{ '--to': `${(row.have / row.of) * 100}%`, '--rarity': row.rarity && row.rarity !== 'common' ? RARITY_INKS[row.rarity] : undefined } as CSSProperties} />
              </span>
              <span className="mt-1 flex text-[11px] text-muted">
                <span className="flex-1">{row.how}</span>
                <span>page {row.page + 1}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </>
  )
}

/**
 * A keepsake's own page: a door's, opened or to come, as the calendar has
 * it; or first steps' or the birthday's stamp, kept or how to find it.
 */
function KeepsakePage({ chosen, keeps, late, today, onBack }: { chosen: Keepsake; keeps: Keeps; late: Record<string, string>; today: string; onBack: () => void }) {
  if ('door' in chosen) {
    const days = keeps.doors.get(chosen.door)
    if (days) return <DoorSheet door={{ door: chosen.door, day: days[0], state: 'open' }} openedOn={late[days[0]]} onBack={onBack} />
    const day = doorDay(chosen.door, today)
    return <DoorSheet door={{ door: chosen.door, day, state: doorUnopened(day, today) }} onBack={onBack} />
  }
  if ('keepsakeDay' in chosen) {
    const { name, story } = chosen.keepsakeDay
    const days = keeps.days.get(name)
    return (
      <StampSheet
        label={name}
        art={days ? <StampArt stamp={stampFor(days[0])} width={110} /> : <Blank label={shortDay(`2028-${chosen.keepsakeDay.date(2028)}`)} large />}
        caption="Keepsake"
        name={days ? name : 'Still to find'}
        note={days ? `${story} Kept on ${longDay(days[0])}.` : `Open Nib on ${onDay(chosen.keepsakeDay, today)}, and the day’s pack holds it.`}
        onBack={onBack}
      />
    )
  }
  if (chosen.keepsake === 'year' || chosen.keepsake === 'rarity') {
    const year = chosen.keepsake === 'year'
    const day = year ? keeps.year : keeps.rarity?.day
    return (
      <StampSheet
        label={year ? 'A year with Nib' : 'A rarity completed'}
        art={day ? <StampArt stamp={year ? yearStamp(day) : rarityStamp(day)} width={110} /> : <Blank label={year ? '1 year' : 'All'} large />}
        caption="Keepsake"
        name={day ? (year ? 'A year with Nib' : 'A rarity completed') : 'Still to find'}
        note={
          year
            ? day
              ? `A year from your first stamp or your oldest writing, on ${longDay(day)}.`
              : keeps.yearDue
                ? `Yours on ${longDay(keeps.yearDue)}, a year from your first stamp or your oldest writing.`
                : 'Yours a year from your first stamp or your first writing.'
            : day
              ? `Every ${RARITY_NAMES[keeps.rarity!.rarity].toLowerCase()} stamp found, the last on ${longDay(day)}.`
              : 'Yours the first time you find every stamp of one rarity, from common to mythic.'
        }
        onBack={onBack}
      />
    )
  }
  if (chosen.keepsake === 'inkwell') {
    const day = keeps.inkwell
    return (
      <StampSheet
        label="Inkwell"
        art={day ? <StampArt stamp={inkwellStamp(day)} width={110} /> : <Blank label="Ink" large />}
        caption="Keepsake"
        name={day ? 'Inkwell' : 'Still to find'}
        note={day ? `Inkwell’s own stamp, the last drop of ink, for hearing its story on ${longDay(day)}.` : 'Yours when Inkwell tells you its story: ask it who it is, or press My story.'}
        onBack={onBack}
      />
    )
  }
  const first = chosen.keepsake === 'first steps'
  const day = first ? keeps.firstSteps : keeps.birthday
  return (
    <StampSheet
      label={first ? 'First steps' : 'Nib’s birthday'}
      art={day ? <StampArt stamp={first ? firstStepsStamp(day) : birthdayStamp(day)} width={110} /> : <Blank label={first ? 'Steps' : shortDay(TWELFTH_OF_JUNE)} large />}
      caption="Keepsake"
      name={day ? (first ? 'First steps' : 'Nib’s birthday') : 'Still to find'}
      note={
        day
          ? first
            ? `Your first steps, done on ${longDay(day)}.`
            : `Kept on ${longDay(day)}.`
          : first
            ? 'Yours when the four first steps are done.'
            : `Open Nib on ${dayMonth(TWELFTH_OF_JUNE)}, the birthday of the one who made it, and it’s yours.`
      }
      onBack={onBack}
    />
  )
}

/** Put a stamp found on the writing, or take it off: a few to a document. */
function PutOn({ placed, onto }: { placed: Placed; onto: Onto }) {
  const on = onto.stamps.some((had) => samePlaced(had, placed))
  if (!on && onto.stamps.length >= MAX_PLACED) {
    return <p className="mt-3 text-[12px] leading-[1.5] text-muted">There are {MAX_PLACED} stamps on {onto.label} already. Take one off to put this on.</p>
  }
  return (
    <button
      onClick={() => onto.set(on ? onto.stamps.filter((had) => !samePlaced(had, placed)) : [...onto.stamps, placed])}
      className="nib-tap mt-4 mr-2 cursor-pointer rounded-md border border-line px-3 py-1.5 text-[12px] text-ink hover:bg-item-hover"
    >
      {on ? `Take off ${onto.label}` : `Put on ${onto.label}`}
    </button>
  )
}
