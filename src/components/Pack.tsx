import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { holidayOn, keepsakeDayOn } from '../lib/holidays'
import { motion } from '../lib/motion'
import { touchApp } from '../lib/platform'
import { PACKS, REROLL } from '../lib/market'
import { readStamps } from '../lib/collection'
import { catchUp, doorOf, type Pack, type Stamp } from '../lib/rewards'
import type { Rarity } from '../lib/stampbook'
import { BOOK, RARITIES, RARITY_INKS, RARITY_NAMES, STAMP_INKS } from '../lib/stampbook'
import { shortDay } from '../lib/time'
import { confetti } from './confetti'
import { Sheet } from './Sheet'
import { StampArt } from './StampArt'

/** "4 Nov" or "Nov 4", in the writer's own order, for the pack's foot. */
const short = (day: string) => shortDay(day).toUpperCase()

/** The wrapper's colours and what it says: a Christmas calendar day's in red and gold with snow, a holiday's in its ink, any other day's in Nib's blue and violet; one bought with points, black and gold. */
function themeOf(day: string, bought = false) {
  if (bought) return { from: '#2b2622', to: '#8a6a1c', label: 'Market pack', snow: false }
  const door = doorOf(day)
  if (door !== null) return { from: '#c0392b', to: '#6b1712', label: `Door ${door}`, snow: true }
  const holiday = holidayOn(day) ?? keepsakeDayOn(day)
  if (holiday) return { from: holiday.ink, to: `color-mix(in srgb, ${holiday.ink} 45%, #1a1630)`, label: holiday.name, snow: false }
  return { from: '#3a62a8', to: '#4b2f8f', label: 'Today’s pack', snow: false }
}

/** The colour a rarity glows when its stamp comes out; mythic's is a rainbow. */
const GLOW: Record<Rarity, string> = { ...RARITY_INKS, common: '#ffffff', legendary: '#f2c94c' }

/** The pack's crimped outline: teeth along its top and foot, straight sides. */
const OUTLINE = (() => {
  let d = 'M12 16'
  for (let x = 12; x < 148; x += 8) d += ` L${x + 4} 8 L${x + 8} 16`
  d += ' L148 204'
  for (let x = 148; x > 12; x -= 8) d += ` L${x - 4} 212 L${x - 8} 204`
  return `${d} Z`
})()

/** A few stars and specks on the foil, scattered the same way every time. */
const SPECKS = Array.from({ length: 18 }, (_, i) => [18 + ((i * 47) % 124), 40 + ((i * 71) % 160), i % 4 === 0 ? 1.4 : 0.8] as const)

/** The five rarities' colours, as dots on the label: what a pack might hold. */
const DOTS = RARITIES.map((rarity) => RARITY_INKS[rarity])

/**
 * A pack of stamps, drawn: a foil wrapper crimped top and foot and printed
 * all over with little stamps, a tear line under the top, a paper label with
 * a stamp still to see and the five rarities' dots, and a holographic strip
 * above the date. `torn`: its top flown off, the way it opens.
 */
export function PackArt({ day, width, torn = false, shine = true, inside }: { day: string; width: number; torn?: boolean; shine?: boolean; inside?: number }) {
  const id = useId().replace(/[^\w-]/g, '')
  const theme = themeOf(day, inside !== undefined)
  const moving = shine && motion() > 0
  const body = (
    <>
      <path d={OUTLINE} fill={`url(#nib-pack-foil-${id})`} />
      <path d={OUTLINE} fill={`url(#nib-pack-print-${id})`} />
      {SPECKS.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#ffffff" opacity={theme.snow ? 0.75 : 0.35} />
      ))}
      <rect x={12} y={8} width={136} height={26} fill="#000000" opacity={0.12} />
      {Array.from({ length: 22 }, (_, i) => (
        <path key={i} d={`M${16 + i * 6} 18 V30`} stroke="#ffffff" strokeOpacity={0.18} strokeWidth={1} />
      ))}
      <text x={80} y={28} textAnchor="middle" fill="#ffffff" fillOpacity={0.85} style={{ fontSize: 8, fontWeight: 700, letterSpacing: 3 }}>
        NIB
      </text>
      {/* The label, and a stamp waiting in it. */}
      <rect x={30} y={56} width={100} height={110} rx={6} fill="#fbf8f1" />
      <rect x={34} y={60} width={92} height={102} rx={4} fill="none" stroke={theme.from} strokeOpacity={0.5} strokeWidth={1} />
      <rect x={58} y={70} width={44} height={52} rx={1} fill="none" stroke={theme.from} strokeWidth={1.4} strokeDasharray="2.2 2" />
      <text x={80} y={105} textAnchor="middle" fill={theme.from} style={{ fontSize: 24, fontWeight: 700 }}>
        ?
      </text>
      <text x={80} y={137} textAnchor="middle" fill="#2a2a2a" style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2.4 }}>
        STAMPS
      </text>
      <text x={80} y={148} textAnchor="middle" fill="#2a2a2a" fillOpacity={0.6} style={{ fontSize: 7.5, fontWeight: 600 }}>
        {inside !== undefined ? `${inside} INSIDE` : theme.label === 'Today’s pack' ? '1 INSIDE' : theme.label.toUpperCase()}
      </text>
      {DOTS.map((colour, i) => (
        <circle key={colour} cx={66 + i * 7} cy={155.5} r={1.9} fill={colour} />
      ))}
      <rect x={30} y={174} width={100} height={6} rx={1} fill={`url(#nib-pack-holo-${id})`} opacity={0.85} />
      <text x={80} y={192} textAnchor="middle" fill="#ffffff" fillOpacity={0.9} style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5 }}>
        {short(day)}
      </text>
      {/* The light catching the foil, passing across now and then. */}
      <rect x={-160} y={0} width={160} height={220} fill={`url(#nib-pack-sheen-${id})`} clipPath={`url(#nib-pack-shape-${id})`}>
        {moving && <animate attributeName="x" values="-160;160;160" keyTimes="0;0.45;1" dur="3.4s" repeatCount="indefinite" />}
      </rect>
    </>
  )
  return (
    <svg aria-hidden viewBox="0 0 160 220" width={width} height={(width * 220) / 160} className="block overflow-visible" style={{ fontFamily: '-apple-system, system-ui, sans-serif' }}>
      <defs>
        <linearGradient id={`nib-pack-foil-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: theme.from }} />
          <stop offset="1" style={{ stopColor: theme.to }} />
        </linearGradient>
        <linearGradient id={`nib-pack-sheen-${id}`} x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0.3" stopColor="#ffffff" stopOpacity={0} />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity={0.45} />
          <stop offset="0.7" stopColor="#ffffff" stopOpacity={0} />
        </linearGradient>
        <linearGradient id={`nib-pack-holo-${id}`} x1="0" y1="0" x2="1" y2="0">
          {['#f5b3c3', '#fbe39a', '#b7ecc5', '#a9d3f5', '#cdb8f2', '#f5b3c3'].map((colour, i) => (
            <stop key={i} offset={i / 5} stopColor={colour} />
          ))}
        </linearGradient>
        {/* Little perforated stamps, printed on the foil at a tilt. */}
        <pattern id={`nib-pack-print-${id}`} width={16} height={18} patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
          <rect x={3} y={3} width={9} height={11} rx={0.5} fill="none" stroke="#ffffff" strokeOpacity={0.13} strokeWidth={0.9} strokeDasharray="1.2 0.9" />
        </pattern>
        <clipPath id={`nib-pack-shape-${id}`}>
          <path d={OUTLINE} />
        </clipPath>
        <clipPath id={`nib-pack-top-${id}`}>
          <rect x={0} y={0} width={160} height={34} />
        </clipPath>
        <clipPath id={`nib-pack-rest-${id}`}>
          <rect x={0} y={34} width={160} height={190} />
        </clipPath>
      </defs>
      <g clipPath={`url(#nib-pack-rest-${id})`}>{body}</g>
      <g clipPath={`url(#nib-pack-top-${id})`} className={torn ? 'nib-pack-tear' : undefined}>
        {body}
      </g>
      {!torn && <path d="M16 34 H144" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={1} strokeDasharray="3 3" />}
      {!torn && <path d="M148 30 L142 34 L148 38" fill="none" stroke="#ffffff" strokeOpacity={0.8} strokeWidth={1.2} />}
    </svg>
  )
}

/** Today's pack, put off till later: beside the way back to the library, waiting, like the day's presents. */
export function PackButton({ day, onOpen }: { day: string; onOpen: () => void }) {
  return (
    <button aria-label="Today’s pack" onClick={onOpen} className="nib-tap cursor-pointer">
      <span className="nib-pack-wait">
        <PackArt day={day} width={16} shine={false} />
      </span>
    </button>
  )
}

type Phase = 'sealed' | 'tearing' | 'showing' | 'done'

/** How long, in milliseconds at full Motion, each part of the opening takes. */
const SHAKE = 520
const TEAR = 480
const STAGGER = 260
const LUCKY_WAIT = 520
/** The lucky stamp, face down, landing before it starts to shake. */
const LUCKY_RISE = 400
/** How long it shakes, glowing, before it turns over: the rarer, the longer. */
const CHARGE: Record<Rarity, number> = { common: 350, rare: 600, unique: 800, legendary: 1000, mythic: 1200 }
const LAND = 800

/** Sparks flung out in a ring, each at its own angle and to its own reach. */
const SPARKS = Array.from({ length: 16 }, (_, i) => ({ '--a': `${i * 22.5 + (i % 2) * 9}deg`, '--r': `${70 + ((i * 37) % 60)}px` }))
/** Mythic's sparks, in the rainbow its glow turns through. */
const RAINBOW = ['#e0526e', '#f2c94c', '#5bb37a', '#4f9bd9', '#8a63d2']
/** Little stars round the sealed pack, twinkling in turn: where, as a share of it across and down, and when. */
const TWINKLES = [
  [-14, 16, 0],
  [106, 8, 0.6],
  [-8, 68, 1.2],
  [104, 60, 0.3],
  [22, -8, 0.9],
  [78, 98, 1.5],
  [-18, 42, 1.8],
  [112, 34, 2.1],
] as const

/**
 * The day's pack, in the middle of the screen: it drops in and floats in
 * turning rays of light, stars twinkling round it. Tapped, it shakes, its top
 * tears off in a shower of sparks, and it bursts into a flash. The stamps flip
 * up out of it one by one, the day's own first. The lucky one comes last, face
 * down, and shakes, glowing in its rarity's colour, the longer the rarer,
 * before it turns over. Rare and up flare with sparks under a banner with the
 * rarity's name, and legendary and mythic shake the card, flash the screen
 * and bring confetti too. Then their names, which are new, and the day's
 * prompt. With Motion off it all simply appears. `onOpen` keeps its stamps
 * and says what it held, or null if it can't be had after all. The market's
 * open the same way (components/Market): a pack `bought` with points, of so
 * many stamps, or today's stamp drawn `again`.
 */
export function PackOpening({
  day,
  waiting = true,
  offered = false,
  bought,
  again = false,
  onOpen,
  onClose,
  onWrite = () => {},
  onStampbook = () => {},
  onCalendar = () => {},
}: {
  day: string
  /** Still to open: not, still sealed, once sync brings it opened on another device (lib/collection), and it goes. */
  waiting?: boolean
  /** Come up of its own accord: on a Mac the focus goes to the pack, not its button, so a key meant for the writing can't open it. */
  offered?: boolean
  bought?: number
  again?: boolean
  onOpen: () => Pack | null
  /** Gone: put off unopened with Later, or `putAway` once opened, rather than left for the Stampbook or to write. */
  onClose: (putAway?: boolean) => void
  onWrite?: (prompt: string) => void
  onStampbook?: () => void
  /** On a door's day, in the Stampbook's place. */
  onCalendar?: () => void
}) {
  const daily = bought === undefined && !again
  const [phase, setPhase] = useState<Phase>('sealed')
  const [pack, setPack] = useState<Pack | null>(null)
  const [scale] = useState(motion)
  const [pieces] = useState(makeConfetti)
  const theme = themeOf(day, bought !== undefined)
  const dialog = useRef<HTMLDivElement>(null)
  const sealedButton = useRef<HTMLButtonElement>(null)
  const doneButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (phase === 'done' && !touchApp) doneButton.current?.focus()
    // The pack's button goes as it tears: the focus stays in the pack, for Escape, rather than falling out of it.
    if ((phase === 'tearing' || phase === 'showing') && !touchApp) dialog.current?.focus()
  }, [phase])
  // A door missed, caught up by this pack as well as the day's own (lib/rewards catchUp), for what it says it holds.
  const [missed] = useState(() => daily && catchUp(readStamps(), day) !== null)
  useEffect(() => {
    if (phase === 'sealed' && !waiting) onClose()
  }, [phase, waiting, onClose])

  // The stamps in the order they come out: the day's own, a missed door, then the stampbook's, the lucky one.
  // Under each its name, and its rarity, or where a day's own is from.
  const own = (day: string) => (doorOf(day) !== null ? 'Christmas calendar' : keepsakeDayOn(day) ? 'Keepsake' : 'Holiday')
  const out: { stamp: Stamp; caption: string; kind: string; rarity?: Rarity; fresh?: boolean; copies?: number; lucky?: boolean }[] = pack
    ? [
        ...(pack.dayStamp ? [{ stamp: pack.dayStamp, caption: doorOf(pack.day) !== null ? `Door ${doorOf(pack.day)}` : ((holidayOn(pack.day) ?? keepsakeDayOn(pack.day))?.name ?? ''), kind: own(pack.day) }] : []),
        ...(pack.caughtUp ? [{ stamp: pack.caughtUp, caption: `Door ${doorOf(pack.caughtUp.day)}, missed`, kind: own(pack.caughtUp.day) }] : []),
        ...pack.stamps.map((stamp, i) => ({
          stamp,
          caption: BOOK[stamp.no! - 1].name,
          kind: RARITY_NAMES[stamp.rarity!],
          rarity: stamp.rarity,
          fresh: stamp.fresh,
          copies: stamp.copies,
          lucky: i === pack.stamps.length - 1,
        })),
      ]
    : []
  const luckyRarity = pack?.stamps[pack.stamps.length - 1].rarity ?? 'common'
  const rare = luckyRarity !== 'common'
  const grand = luckyRarity === 'legendary' || luckyRarity === 'mythic'
  // The lucky one waits a moment longer after any before it.
  const delayOf = (i: number) => (i * STAGGER + (out[i]?.lucky && i > 0 ? LUCKY_WAIT : 0)) * scale
  // When the lucky stamp turns over, and when it's all out.
  const reveal = delayOf(out.length - 1) + (LUCKY_RISE + CHARGE[luckyRarity]) * scale
  const showing = reveal + LAND * scale
  // Till then the glow behind keeps its rarity to itself.
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    if (phase !== 'showing') return
    const timer = window.setTimeout(() => setRevealed(true), reveal)
    return () => window.clearTimeout(timer)
  }, [phase, reveal])
  const lit = revealed || phase === 'done'

  // The opening, step by step; at Motion none, straight to the end.
  useEffect(() => {
    if (phase !== 'tearing' && phase !== 'showing') return
    const timer = window.setTimeout(() => setPhase(phase === 'tearing' ? 'showing' : 'done'), phase === 'tearing' ? (SHAKE + TEAR) * scale : showing)
    return () => window.clearTimeout(timer)
  }, [phase, scale, showing])

  function open() {
    const next = onOpen()
    if (!next) return onClose()
    setPack(next)
    setPhase(scale ? 'tearing' : 'done')
  }
  function finish() {
    onClose(true)
  }

  // Smaller the more there are, so a pack of ten fits a phone with its buttons.
  const big = out.length > 6 ? 44 : out.length > 3 ? 58 : 70
  return (
    <>
      {/* In the middle of the screen, or from the top and scrolling where it can't fit. */}
      {/* Focus here for the keyboard, on a Mac, and on iPhone and iPad as it comes up unasked, for VoiceOver (Sheet): the keyboard isn't up then, and it isn't handed back there. */}
      <Sheet
        ref={dialog}
        label={daily ? 'Today’s pack' : bought !== undefined ? `A pack of ${bought}` : 'Today’s stamp, again'}
        data-phase={phase}
        onClose={() => (phase === 'sealed' ? onClose() : phase === 'done' ? finish() : setPhase('done'))}
        overlay="z-[56] flex flex-col overflow-x-hidden overflow-y-auto bg-ink/30 p-4"
        focus={offered ? dialog : sealedButton}
        focusOnTouch={offered}
        onClick={() => phase === 'showing' && setPhase('done')}
        className="relative m-auto flex w-full max-w-[380px] flex-col items-center text-center"
      >
        {/* There from the start, empty, so what the pack held is read out as it's put in. */}
        <p className="sr-only" aria-live="polite">
          {pack && phase === 'done'
            ? `${daily ? 'In today’s pack' : 'In the pack'}: ${out.map(({ caption, kind, fresh, copies }) => `${caption}, ${kind.toLowerCase()}${fresh ? ', new' : copies !== undefined ? `, a repeat, ${copies} now` : ''}`).join('; ')}.`
            : ''}
        </p>
        {/* A glow behind the pack, and behind the lucky stamp in its rarity's colour. */}
        <div
          aria-hidden
          data-rarity={lit ? luckyRarity : undefined}
          className="nib-pack-glow pointer-events-none absolute top-1/2 left-1/2 size-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ '--glow': lit ? GLOW[luckyRarity] : '#fff3c4' } as CSSProperties}
        />
        {(phase === 'sealed' || phase === 'tearing') && (
          <>
            <div className="nib-pack-arrive relative">
              <span aria-hidden className="nib-pack-rays pointer-events-none absolute top-1/2 left-1/2 -mt-[220px] -ml-[220px] size-[440px] rounded-full" />
              <span aria-hidden className="pointer-events-none absolute inset-0">
                {TWINKLES.map(([x, y, at]) => (
                  <svg key={`${x}-${y}`} viewBox="0 0 10 10" width={14} className="nib-pack-twinkle absolute" style={{ left: `${x}%`, top: `${y}%`, '--t': `${at}s` } as CSSProperties}>
                    <path d="M5 0 L6 4 L10 5 L6 6 L5 10 L4 6 L0 5 L4 4 Z" fill="#fff8dc" />
                  </svg>
                ))}
              </span>
              {/* The button holds still, and the pack moves in it: what moves can't be pressed reliably. */}
              <button ref={sealedButton} aria-label="Open the pack" disabled={phase !== 'sealed'} onClick={open} className="relative block cursor-pointer rounded-lg outline-offset-4">
                <span className="nib-pack-float block">
                  <span className={`block ${phase === 'tearing' ? 'nib-pack-shake' : ''}`}>
                    <PackArt day={day} width={190} torn={phase === 'tearing'} inside={bought} />
                  </span>
                </span>
              </button>
              {phase === 'tearing' && (
                <>
                  <span aria-hidden className="nib-pack-burst pointer-events-none absolute top-[-40px] left-1/2 size-[160px] -translate-x-1/2 rounded-full" />
                  {/* Sparks from the tear, as the top comes away. */}
                  <span aria-hidden className="pointer-events-none absolute top-[40px] left-1/2" style={{ '--at': `${SHAKE * scale}ms` } as CSSProperties}>
                    {SPARKS.map((spark, i) => (
                      <span key={i} className="nib-pack-spark" style={{ ...spark, '--spark': i % 3 ? '#fff3c4' : '#ffffff' } as CSSProperties} />
                    ))}
                  </span>
                </>
              )}
            </div>
            <div className="relative mt-6 rounded-lg bg-paper/95 px-4 py-2.5 shadow-sm">
              <div className="text-[14px] font-medium">
                {bought !== undefined
                  ? `A pack of ${bought} · ${PACKS.find((pack) => pack.size === bought)?.price ?? ''} coins`
                  : again
                    ? `Today’s stamp, again · ${REROLL} coins`
                    : theme.label === 'Today’s pack'
                      ? 'Today’s pack'
                      : `Today’s pack · ${theme.label}`}
              </div>
              <p className="mt-0.5 text-[12px] text-muted">
                {bought !== undefined
                  ? `Tap it to open: ${bought === 1 ? 'a stamp' : `${bought} stamps`}, and any might be rare.`
                  : again
                    ? 'Tap it to open: a new stamp in place of today’s.'
                    : `Tap it to open: ${[theme.label !== 'Today’s pack' && 'the day’s own stamp', missed && 'a door you missed', theme.label !== 'Today’s pack' || missed ? 'one more' : 'a stamp'].filter(Boolean).join(', ')}, and it might be rare.`}
              </p>
              {phase === 'sealed' && (
                // A bought pack, or another go, put off is not bought: Cancel, not Later.
                <button onClick={() => onClose()} className="nib-tap mt-1 cursor-pointer text-[12px] text-muted hover:text-ink">
                  {daily ? 'Later' : 'Cancel'}
                </button>
              )}
            </div>
          </>
        )}
        {pack && (phase === 'showing' || phase === 'done') && rare && (
          // The rarity's name, slammed down over the card as the lucky stamp turns over.
          <div aria-hidden className="nib-pack-banner relative mb-3 text-[30px] leading-none font-extrabold tracking-[0.06em] uppercase" data-rarity={luckyRarity} style={{ '--glow': GLOW[luckyRarity], '--reveal': `${reveal}ms` } as CSSProperties}>
            {RARITY_NAMES[luckyRarity]}!
          </div>
        )}
        {pack && (phase === 'showing' || phase === 'done') && (
          <div
            className="nib-pack-card relative w-full rounded-lg border border-line bg-paper p-5 shadow-[0_18px_50px_rgba(10,20,40,0.25)]"
            data-quake={(grand && scale > 0) || undefined}
            style={{ '--reveal': `${reveal}ms`, '--c': `${CHARGE[luckyRarity] * scale}ms` } as CSSProperties}
          >
            <div className="flex flex-wrap items-end justify-center gap-x-3 gap-y-4" aria-hidden={phase !== 'done'}>
              {out.map(({ stamp, caption, kind, rarity, fresh, copies, lucky: isLucky }, i) => (
                <div
                  key={`${stamp.day}-${stamp.no ?? stamp.motif}-${i}`}
                  className={`nib-pack-stamp flex flex-col items-center ${out.length > 6 ? 'w-[68px]' : 'w-[88px]'}`}
                  data-lucky={isLucky || undefined}
                  data-rarity={rarity}
                  style={{ '--d': `${delayOf(i)}ms` } as CSSProperties}
                >
                  <span className="relative block">
                    {isLucky && rare && <span aria-hidden className="nib-rarity-burst absolute top-1/2 left-1/2 size-[150px]" style={{ '--glow': GLOW[luckyRarity] } as CSSProperties} />}
                    {isLucky && rare && scale > 0 && (
                      <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 z-10" style={{ '--at': `calc(var(--reveal) + 100ms * var(--m))` } as CSSProperties}>
                        {SPARKS.map((spark, j) => (
                          <span key={j} className="nib-pack-spark" style={{ ...spark, '--spark': luckyRarity === 'mythic' ? RAINBOW[j % RAINBOW.length] : GLOW[luckyRarity] } as CSSProperties} />
                        ))}
                      </span>
                    )}
                    <span className="nib-pack-face relative block" data-rarity={rarity}>
                      <span className="nib-stamp relative block">
                        <StampArt stamp={stamp} width={isLucky ? big + 16 : big} />
                      </span>
                      {/* Unique and up catch the light. */}
                      {isLucky && (luckyRarity === 'unique' || grand) && <span aria-hidden className="nib-glint" />}
                    </span>
                    {/* Face down, in the pack's colours, till it turns over. */}
                    {isLucky && (
                      <span
                        aria-hidden
                        className="nib-pack-back absolute inset-0 flex items-center justify-center rounded-[3px] text-[28px] font-bold text-white/90"
                        style={{ background: `linear-gradient(135deg, ${theme.from}, ${theme.to})`, '--glow': GLOW[luckyRarity] } as CSSProperties}
                      >
                        ?
                      </span>
                    )}
                    {fresh && <span className="nib-pack-new absolute -top-2 -right-3 z-10 rounded-full bg-accent px-1.5 py-px text-[9.5px] font-semibold text-paper">New</span>}
                    {/* A repeat, and how many there are now: worth points in the market. */}
                    {!fresh && copies !== undefined && (
                      <span className="nib-pack-new absolute -top-2 -right-3 z-10 rounded-full border border-line bg-paper px-1.5 py-px text-[9.5px] font-semibold text-muted">×{copies}</span>
                    )}
                  </span>
                  <span className="nib-pack-caption mt-2 text-[11.5px] leading-tight font-medium">{caption}</span>
                  {/* The rarer in their colour, deepened towards the ink to read on the paper. */}
                  <span className="nib-pack-caption mt-0.5 text-[10.5px] text-muted" style={{ color: rarity && rarity !== 'common' ? `color-mix(in srgb, ${RARITY_INKS[rarity]} 65%, var(--color-ink))` : undefined }}>
                    {kind}
                  </span>
                </div>
              ))}
            </div>
            {phase === 'done' && (
              <div className="nib-pack-after">
                {pack.prompt && (
                  <div className="mt-5 border-t border-line pt-4 text-left">
                    <div className="text-[11px] text-muted">Something to write, if you’d like it</div>
                    <p className="mt-1.5 text-[14px] leading-[1.5]">{pack.prompt}</p>
                  </div>
                )}
                <div className="mt-4 flex items-center gap-4">
                  {daily && (
                    <button
                      onClick={() => {
                        onClose()
                        if (doorOf(pack.day) !== null) onCalendar()
                        else onStampbook()
                      }}
                      className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink"
                    >
                      {doorOf(pack.day) !== null ? 'Christmas calendar' : 'Stampbook'}
                    </button>
                  )}
                  <span className="flex-1" />
                  <button ref={doneButton} onClick={finish} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
                    Done
                  </button>
                  {pack.prompt && (
                    <button
                      onClick={() => {
                        onClose()
                        onWrite(pack.prompt)
                      }}
                      className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper"
                    >
                      Write from it
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Sheet>
      {/* While Motion allows: a flash as the pack bursts, and as a legendary or mythic stamp turns over, a flash in its colour and confetti. */}
      {pack && scale > 0 && phase === 'showing' && <div aria-hidden className="nib-pack-flash pointer-events-none fixed inset-0 z-[61]" />}
      {pack && scale > 0 && grand && phase === 'showing' && (
        <div aria-hidden className="nib-pack-flash pointer-events-none fixed inset-0 z-[61]" style={{ '--flash': GLOW[luckyRarity], animationDelay: `${reveal + 100 * scale}ms` } as CSSProperties} />
      )}
      {pack && scale > 0 && grand && (phase === 'showing' || phase === 'done') && (
        <div aria-hidden data-confetti className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
          {pieces.map((piece, i) => (
            <span key={i} className="nib-confetti" style={{ ...piece, animationDelay: `${reveal / 1000 - Number.parseFloat(String(piece.animationDelay)) * 0.3}s` }} />
          ))}
        </div>
      )}
    </>
  )
}

/** Forty pieces, each its own colour, place, speed, drift and spin. */
function makeConfetti(): CSSProperties[] {
  return confetti(40, [STAMP_INKS.red, STAMP_INKS.amber, STAMP_INKS.green, STAMP_INKS.blue, STAMP_INKS.violet, '#f2c94c'], 3, 2)
}
