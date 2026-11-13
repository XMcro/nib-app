import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { STEPS, type Step } from '../lib/firsts'
import { macApp, touchApp } from '../lib/platform'
import { firstStepsStamp } from '../lib/rewards'
import { Sheet } from './Sheet'
import { StampArt } from './StampArt'

/** What each step is, and how to do it, on the device in hand. */
const WHAT: Record<Step, { title: string; how: string }> = {
  write: { title: 'Write a first line', how: 'Anything at all.' },
  page: { title: 'Make a page', how: 'Notes are for jotting down; pages, in Pages, for writing out. Start one there.' },
  focus: {
    title: 'Try focus mode',
    how: macApp ? 'Press ⇧⌘F, or choose it after ⌘K. Everything but the words goes.' : 'Choose Focus mode in Commands. Everything but the words goes.',
  },
  commands: {
    title: 'Open Commands',
    how: macApp ? 'Press ⌘K. Everything else is there.' : touchApp ? 'Tap Commands, at the top. Everything else is there.' : 'Press Ctrl+K. Everything else is there.',
  },
}

/**
 * First steps (lib/firsts), beside the way back to the library like a pack
 * put off till later: a ring that fills as each step is done, popping as it does,
 * and the list of them under it when it's tapped. It takes no focus and moves
 * no text.
 */
export function FirstSteps({ done, fresh, onPutAway }: { done: Step[]; fresh: Step | null; onPutAway: () => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  // Under the button, but moved left as far as it must be to stay on screen:
  // on a phone, with the day's pack before it, the button is well over to the right.
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    if (!open || !box.current || !list.current) return
    setShift(Math.min(0, innerWidth - 12 - box.current.getBoundingClientRect().left - list.current.offsetWidth))
  }, [open])

  // Put away again by a press anywhere else.
  useEffect(() => {
    if (!open) return
    const elsewhere = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', elsewhere)
    return () => document.removeEventListener('pointerdown', elsewhere)
  }, [open])

  return (
    <div ref={box} className="relative">
      {/* Drawn afresh as each step is done, so it pops again. */}
      <button
        key={done.length}
        aria-expanded={open}
        aria-label={`First steps, ${done.length} of ${STEPS.length} done`}
        onClick={() => setOpen((value) => !value)}
        data-ticked={fresh ? '' : undefined}
        className="nib-firsts nib-tap relative flex cursor-pointer items-center gap-1.5 rounded-md bg-item-hover py-1 pr-2.5 pl-2 text-[12px] font-medium text-muted hover:text-ink"
      >
        <Ring done={done.length} />
        First steps
      </button>
      {open && (
        <div
          ref={list}
          role="dialog"
          aria-label="First steps"
          style={{ left: shift }}
          className="nib-float absolute top-[calc(100%+6px)] z-20 w-[min(300px,calc(100vw-24px))] rounded-lg border border-line bg-paper p-3 shadow-[0_10px_30px_rgba(10,20,40,0.12)]"
        >
          <div className="text-[13px] font-medium">First steps</div>
          <p className="mt-0.5 text-[11px] text-muted">
            {done.length} of {STEPS.length} done. All four, and there’s a stamp for it.
          </p>
          <ul className="mt-2.5 flex flex-col gap-2.5">
            {STEPS.map((step) => (
              <li key={step} data-done={done.includes(step) || undefined} className="flex gap-2.5">
                <span
                  aria-hidden
                  className={`mt-px flex size-4 shrink-0 items-center justify-center rounded-full border ${done.includes(step) ? 'border-accent bg-accent text-paper' : 'border-line'}`}
                >
                  {done.includes(step) && (
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 5.2l2 2 4-4.4" />
                    </svg>
                  )}
                </span>
                <div>
                  <div className={`text-[12.5px] font-medium ${done.includes(step) ? 'text-muted line-through decoration-faint' : ''}`}>
                    {WHAT[step].title}
                    <span className="sr-only">{done.includes(step) ? ', done' : ''}</span>
                  </div>
                  {!done.includes(step) && <div className="mt-px text-[11.5px] leading-[1.45] text-muted">{WHAT[step].how}</div>}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end">
            <button onClick={onPutAway} className="nib-tap cursor-pointer text-[11.5px] text-muted hover:text-ink">
              Put away
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** A ring, a quarter of it filled for each step done. */
function Ring({ done }: { done: number }) {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" className="-rotate-90">
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle cx="7" cy="7" r="5.5" fill="none" className="stroke-accent" strokeWidth="2" strokeLinecap="round" pathLength={STEPS.length} strokeDasharray={`${done} ${STEPS.length}`} />
    </svg>
  )
}

/** All four done: the first steps stamp, pressed on, to keep in the Stampbook. */
export function FirstStepsDone({ day, onClose }: { day: string; onClose: () => void }) {
  return (
    <Sheet label="First steps, done" onClose={onClose} focusOnTouch className="nib-pop h-fit w-[min(320px,90vw)] rounded-lg border border-line bg-paper p-5 text-center">
      <div className="nib-stamp mx-auto w-fit" data-fresh>
        <StampArt stamp={firstStepsStamp(day)} width={96} />
      </div>
      <div className="mt-5 text-[14px] font-medium">First steps, done</div>
      <p className="mt-1 text-[12px] leading-[1.5] text-muted">You’ve found your way round Nib. This stamp is yours, with the keepsakes in the Stampbook.</p>
      <button onClick={onClose} className="nib-tap mt-4 cursor-pointer rounded-md bg-ink px-4 py-1.5 text-[12px] font-medium text-paper">
        Close
      </button>
    </Sheet>
  )
}
