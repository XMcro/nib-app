import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { localDay } from '../lib/time'
import { IMPORT_ACCEPT } from '../lib/importApps'
import { lock, type LockStatus } from '../lib/lock'
import { motion } from '../lib/motion'
import { macApp, nativeApp } from '../lib/platform'
import { bookStamp } from '../lib/rewards'
import { BOOK } from '../lib/stampbook'
import { NibMark } from './NibMark'
import { PackArt } from './Pack'
import { Sheet } from './Sheet'
import { StampArt } from './StampArt'

/**
 * The first thing a new device sees (App: an empty library with sync off):
 * three pages to swipe through, each drawn as it comes into view: what Nib
 * is, the stamps for writing each day, and that the writing is yours alone.
 * The three ways in stay below them all: a new note, the writing from another
 * device, or another app's notes. Full screen on a phone; on a wider screen,
 * each page's picture on one side and its words on the other. Once only
 * (lib/newDevice).
 */

/** Each part rises in turn (index.css .nib-hello), this long after its page is shown. */
const after = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

function unlockLine(status: LockStatus | null): string {
  if (!status) return 'Lock Nib, and share only what you choose.'
  const secret = status.device === 'Mac' ? 'your password' : 'your passcode'
  const biometry = { faceID: 'Face ID', touchID: 'Touch ID', opticID: 'Optic ID', none: secret }[status.biometry]
  return `Lock Nib with ${biometry}. Share only what you choose.`
}

type Point = { title: string; line: string; icon: ReactNode }

const card =
  'rounded-xl bg-paper px-[15px] py-4 shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_14px_30px_rgba(24,68,118,0.14)] dark:bg-item-active dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_30px_rgba(0,0,0,0.45)]'
const label = 'text-[9px] font-semibold tracking-[0.08em] text-muted uppercase'

export function Welcome({
  onStart,
  onSync,
  onImport,
  onClose,
}: {
  /** A new note, ready to type into. */
  onStart: () => void
  onSync: () => void
  onImport: (files: File[]) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [unlock, setUnlock] = useState<LockStatus | null>(null)
  const [current, setCurrent] = useState(0)
  // Pages drawn so far: each one's picture plays the first time it's shown.
  const [shown, setShown] = useState<number[]>([0])

  useEffect(() => {
    if (nativeApp) void lock.status().then(setUnlock, () => {})
  }, [])

  // Next goes on the last page; if it had focus, the welcome keeps it, or the arrow keys and Escape would stop.
  useEffect(() => {
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus()
  }, [current])

  function show(page: number) {
    setCurrent(page)
    setShown((pages) => (pages.includes(page) ? pages : [...pages, page]))
  }

  // Where Next, a dot or an arrow key is taking the track, until it's there:
  // a smooth scroll passes the pages between, which aren't where it's going.
  const heading = useRef<{ page: number; until: number } | null>(null)

  // Swiped, or scrolled there: whichever page fills most of the view.
  function onScroll() {
    const element = track.current
    if (!element || !element.clientWidth) return
    const page = Math.round(element.scrollLeft / element.clientWidth)
    const going = heading.current
    if (going && Date.now() < going.until) {
      if (Math.abs(element.scrollLeft - going.page * element.clientWidth) < 2) heading.current = null
      return
    }
    heading.current = null
    if (page !== current) show(page)
  }

  function go(page: number) {
    const next = Math.max(0, Math.min(PAGES - 1, page))
    const element = track.current
    if (element) {
      // Given up on after a second, should a swipe take over on the way.
      heading.current = { page: next, until: Date.now() + 1000 }
      element.scrollTo({ left: next * element.clientWidth, behavior: motion() ? 'smooth' : 'auto' })
    }
    show(next)
  }

  const today = localDay(Date.now())
  const pages: { title: string; line: string; points: Point[]; art: ReactNode }[] = [
    {
      title: 'Welcome to Nib',
      line: 'A quiet place to write. No account to make, and nothing to set up.',
      points: [
        {
          title: 'Notes and pages',
          line: 'Jot it down in Notes. Write it out in Pages.',
          icon: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4" />,
        },
        {
          title: 'Room to think',
          line: 'Focus mode clears away everything but the words.',
          icon: <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M9 12h6" />,
        },
      ],
      art: <PageAndNote />,
    },
    {
      title: 'A pack of stamps each day',
      line: `Open Nib each day for a pack with a stamp in it, maybe a rare one, and a prompt for what to write next. There are ${BOOK.length} to collect.`,
      points: [
        {
          title: 'A Christmas calendar',
          line: 'In December, each day’s pack opens a door.',
          icon: <path d="M4 7h16v13H4zM4 11h16M9 7v13M15 7v13M8 4v3M16 4v3" />,
        },
        {
          title: 'A nudge, if you like',
          line: 'A reminder on the days your pack is still waiting.',
          icon: <path d="M6 10a6 6 0 0 1 12 0v4l2 3H4l2-3zM10 20a2 2 0 0 0 4 0" />,
        },
      ],
      art: <Pack day={today} />,
    },
    {
      title: 'Yours alone',
      line: `Your writing stays on ${macApp ? 'this Mac' : 'this device'}. It leaves only if you share a draft or turn on sync.`,
      points: [
        {
          title: 'Locked when you like',
          line: unlockLine(unlock),
          icon: (
            <>
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </>
          ),
        },
        {
          title: 'Free to take with you',
          line: 'Export everything as Markdown, free, always.',
          icon: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
        },
      ],
      art: <Locked />,
    },
  ]

  const quiet = 'nib-tap flex h-9 cursor-pointer items-center px-2.5 text-[13px] whitespace-nowrap text-muted hover:text-ink max-lg:h-11 phone:text-[13.5px]'

  return (
    <Sheet
      ref={dialog}
      aria-labelledby="nib-welcome-title"
      onClose={onClose}
      overlay="z-50 flex items-center justify-center bg-black/30 backdrop-blur-[3px] phone:bg-shell phone:backdrop-blur-none"
      focusOnTouch
      pressOutside={false}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(current + 1)
        else if (event.key === 'ArrowLeft') go(current - 1)
      }}
      className="nib-pop flex max-h-[calc(100dvh-2rem)] w-[min(820px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[18px] bg-paper text-ink shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_30px_80px_rgba(10,20,40,0.28)] phone:h-full phone:max-h-none phone:w-full phone:rounded-none phone:bg-shell phone:pt-[env(safe-area-inset-top)] phone:pr-[env(safe-area-inset-right)] phone:pb-[env(safe-area-inset-bottom)] phone:pl-[env(safe-area-inset-left)] phone:shadow-none"
    >
      <div
        ref={track}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pages.map((page, i) => (
          <section
            key={page.title}
            aria-label={`${i + 1} of ${PAGES}`}
            aria-hidden={i !== current}
            data-page={i}
            className="flex w-full shrink-0 snap-start snap-always phone:flex-col phone:overflow-y-auto"
          >
            {/* Drawn afresh the first time the page is shown, so its picture plays then. */}
            <div key={shown.includes(i) ? 'shown' : 'waiting'} className={`contents ${shown.includes(i) ? '' : '[&>*]:invisible'}`}>
              <div className="flex min-h-[290px] w-[330px] shrink-0 items-center justify-center bg-plus-wash phone:mt-4 phone:min-h-[260px] phone:w-full phone:bg-transparent">
                {page.art}
              </div>
              <div className="flex min-w-0 flex-1 flex-col px-11 pt-11 pb-2 phone:px-7 phone:pt-3">
                {i === 0 ? (
                  <h1 id="nib-welcome-title" className="nib-hello text-[30px] leading-[1.1] font-bold tracking-[-0.025em]" style={after(350)}>
                    {page.title}
                  </h1>
                ) : (
                  <h2 className="nib-hello text-[26px] leading-[1.15] font-bold tracking-[-0.025em]" style={after(150)}>
                    {page.title}
                  </h2>
                )}
                <p className="nib-hello mt-2.5 text-[15px] leading-[1.5] text-muted phone:text-[15.5px] phone:leading-[1.45]" style={after(i === 0 ? 420 : 220)}>
                  {page.line}
                </p>
                <ul className="mt-7 flex flex-col gap-[18px] phone:mt-6 phone:gap-4">
                  {page.points.map((point, j) => (
                    <li key={point.title} className="nib-hello flex items-center gap-[13px]" style={after((i === 0 ? 500 : 300) + j * 60)}>
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-plus-wash text-plus-ink">
                        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                          {point.icon}
                        </svg>
                      </span>
                      <div>
                        <div className="text-[14.5px] font-semibold phone:text-[15px]">{point.title}</div>
                        <div className="mt-px text-[13px] text-muted phone:text-[13.5px]">{point.line}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* The same below every page: where you are, and the three ways in. */}
      <div className="nib-hello flex items-center gap-4 px-11 pt-4 pb-[26px] max-lg:flex-col max-lg:items-stretch max-lg:gap-2 phone:px-7 phone:pt-3 phone:pb-3" style={after(720)}>
        <div className="flex items-center gap-1 max-lg:justify-center">
          {pages.map((page, i) => (
            <button
              key={page.title}
              aria-label={`Page ${i + 1} of ${PAGES}`}
              aria-current={i === current ? 'step' : undefined}
              onClick={() => go(i)}
              className="nib-tap flex size-6 cursor-pointer items-center justify-center"
            >
              <span className={`block h-1.5 rounded-full transition-all ${i === current ? 'w-4 bg-ink' : 'w-1.5 bg-line'}`} />
            </button>
          ))}
          {current < PAGES - 1 && (
            <button onClick={() => go(current + 1)} className={`${quiet} max-lg:hidden`}>
              Next
            </button>
          )}
        </div>
        <span className="flex-1 max-lg:hidden" />
        <div className="flex items-center justify-center max-lg:order-last">
          <button onClick={onSync} className={quiet}>
            Sync from another device
          </button>
          <span aria-hidden="true" className="text-[13px] text-muted">
            ·
          </span>
          <label className={`${quiet} focus-within:text-ink`}>
            Import notes
            <input
              type="file"
              accept={IMPORT_ACCEPT}
              multiple
              className="sr-only"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                if (files.length) onImport(files)
              }}
            />
          </label>
        </div>
        <button
          onClick={onStart}
          className="nib-tap h-10 cursor-pointer rounded-[10px] bg-ink px-5 text-[14px] font-semibold whitespace-nowrap text-paper max-lg:h-11 phone:h-[52px] phone:rounded-[14px] phone:text-[16px]"
        >
          Start writing
        </button>
      </div>
    </Sheet>
  )
}

const PAGES = 3

/** A page and a note, the nib writing a line under the note. */
function PageAndNote() {
  return (
    <div role="img" aria-label="A page and a note in Nib, the note’s last words underlined in ink" className="relative h-[250px] w-[316px]">
      <div className="nib-hello absolute top-[18px] left-0" style={after(50)}>
        <div className={`h-[214px] w-[186px] -rotate-6 ${card}`}>
          <div className={label}>Page</div>
          <div className="mt-1.5 mb-[7px] text-[13px] font-semibold">Chapter one</div>
          <div className="text-[9.5px] leading-[1.6] text-ink/75">
            Every evening at six, Mara climbed the ninety-one steps with a tin of oil and a notebook. The light did not need her. It had been automatic for eleven
            years. She went anyway.
          </div>
        </div>
      </div>
      <div className="nib-hello absolute top-[46px] left-[116px]" style={after(200)}>
        <div className={`relative h-[170px] w-[200px] rotate-[4deg] ${card}`}>
          <div className={label}>Note</div>
          <div className="mt-1.5 mb-[7px] text-[13px] font-semibold">First thought</div>
          <div className="text-[11px] leading-[1.55] text-ink/75">Everything worth keeping starts as a sentence.</div>
          <svg aria-hidden="true" className="nib-welcome-stroke absolute top-[104px] left-[14px]" width="118" height="14" viewBox="0 0 118 14" fill="none">
            <path d="M3 9C20 4 36 11 56 7S94 3 115 8" stroke="#2a93ff" strokeWidth="2.6" strokeLinecap="round" pathLength={1} />
          </svg>
          <div className="nib-hello-pen absolute top-[112px] left-[118px]">
            <NibMark className="block h-[34px] w-[21px] origin-top -rotate-[150deg] text-ink" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** A sample pack (components/Pack), and three of the stamps to find pressed on in turn: a common, a rare and a legendary. */
function Pack({ day }: { day: string }) {
  const places = ['left-[112px] top-[78px] -rotate-6', 'left-[168px] top-[20px] rotate-3', 'left-[230px] top-[96px] rotate-[8deg]']
  return (
    <div role="img" aria-label="A pack of stamps, and three of the stamps to find: a common, a rare and a legendary" className="relative h-[250px] w-[316px]">
      <div className="nib-hello absolute top-[40px] left-[6px] -rotate-[10deg]" style={after(50)}>
        <PackArt day={day} width={112} shine={false} />
      </div>
      {[1, 150, 191].map((no, i) => (
        <div key={no} className={`absolute ${places[i]}`}>
          <span className="nib-stamp block" data-fresh style={after(450 + i * 380)}>
            <StampArt stamp={bookStamp(no, day)} width={72} />
          </span>
        </div>
      ))}
    </div>
  )
}

/** A note with its words hidden, and a lock closing over it. */
function Locked() {
  return (
    <div role="img" aria-label="A note, its words hidden, locked" className="relative h-[250px] w-[316px]">
      <div className="nib-hello absolute top-[34px] left-[58px]" style={after(50)}>
        <div className={`h-[190px] w-[200px] -rotate-3 ${card}`}>
          <div className={label}>Note</div>
          <div className="mt-1.5 mb-[9px] text-[13px] font-semibold">Diary</div>
          {[92, 100, 80, 96, 64].map((width, i) => (
            <div key={i} className="mb-[9px] h-[7px] rounded-full bg-ink/12" style={{ width: `${width}%` }} />
          ))}
        </div>
      </div>
      <div className="nib-hello absolute top-[118px] left-[196px]" style={after(300)}>
        <div className="flex size-[64px] items-center justify-center rounded-2xl bg-ink text-paper shadow-[0_10px_24px_rgba(10,20,40,0.25)]">
          <svg aria-hidden="true" width="30" height="34" viewBox="0 0 30 34" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path className="nib-welcome-shackle" d="M8 15V10a7 7 0 0 1 14 0v5" />
            <rect x="4" y="15" width="22" height="16" rx="4" fill="currentColor" stroke="none" />
          </svg>
        </div>
      </div>
    </div>
  )
}
