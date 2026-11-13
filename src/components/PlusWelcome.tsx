import { useEffect, useEffectEvent, useRef, type CSSProperties } from 'react'
import badge from '../assets/plus-badge.png'
import { motion } from '../lib/motion'

/**
 * The moment Plus turns on here, from a purchase or a restore: the badge
 * lands, ink flicks out around it in the colours Plus opens up, and a stroke
 * underlines the welcome. Then the badge flows down to its place in the
 * library's footer as the rest fades, or, with the library put away, into the
 * gear beside the text, where Customize is; with neither, all of it fades. On its own after a few seconds, or at a tap. With less motion asked
 * for, it simply appears and goes (index.css).
 */

const INKS = ['#2a93ff', '#184476', '#ff5a9f', '#a7ff00', '#50fa7b', '#f2b33d', '#9b3d5a', '#4a7a8c']
const DROPS = 18
/** How long it stays before it starts to go. */
export const STAY_MS = 3000
/** The flight to the library's footer, at full motion. */
const FLIGHT_MS = 750

export function PlusWelcome({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const flier = useRef<HTMLImageElement>(null)
  const leaving = useRef(false)

  function leave() {
    if (leaving.current) return
    leaving.current = true
    void land(root.current!, flier.current!).then(onDone)
  }
  const leaveLater = useEffectEvent(leave)

  useEffect(() => {
    // The library's badge waits unseen (index.css) for this one to land on it.
    document.documentElement.dataset.welcoming = ''
    const timer = setTimeout(leaveLater, STAY_MS)
    return () => {
      clearTimeout(timer)
      delete document.documentElement.dataset.welcoming
    }
  }, [])

  return (
    <div ref={root} role="status" onClick={leave} className="nib-welcome fixed inset-0 z-[60] cursor-pointer">
      <div data-fades className="absolute inset-0 bg-paper/90 backdrop-blur-sm" />
      <div className="relative flex h-full flex-col items-center justify-center px-8 text-center text-ink">
        <div className="relative size-24">
          <span aria-hidden="true" className="nib-welcome-ring absolute inset-0 rounded-full bg-[rgba(42,147,255,0.22)]" />
          {Array.from({ length: DROPS }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="nib-welcome-drop absolute top-1/2 left-1/2 rounded-full"
              style={
                {
                  '--a': `${(360 / DROPS) * i}deg`,
                  '--d': `${92 + (i % 3) * 28}px`,
                  width: [9, 13, 11][i % 3],
                  height: [9, 13, 11][i % 3],
                  background: INKS[i % INKS.length],
                } as CSSProperties
              }
            />
          ))}
          <img ref={flier} src={badge} alt="" className="nib-welcome-badge relative size-24 rounded-[22px] shadow-[0_14px_34px_rgba(24,68,118,0.35)]" />
        </div>
        <div data-fades className="nib-welcome-text mt-8 text-[24px] font-bold tracking-[-0.02em]">
          Welcome to Nib Plus
        </div>
        <svg data-fades aria-hidden="true" className="nib-welcome-stroke text-plus" width="190" height="16" viewBox="0 0 190 16" fill="none">
          <path d="M5 10c26-7 50 1 78-3s62-7 102 1" stroke="currentColor" strokeWidth="3" strokeLinecap="round" pathLength="1" />
        </svg>
        <p data-fades className="nib-welcome-text nib-welcome-late mt-3 max-w-[300px] text-[14px] leading-[1.5] text-muted">
          Everything is unlocked. Make Nib yours in Settings, under Customize.
        </p>
      </div>
    </div>
  )
}

/** Whether a landing is there to be had: drawn, in view, and not under the library or in it put away. */
function onScreen(element: HTMLElement) {
  if (element.closest('[inert], [aria-hidden="true"]')) return false
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
}

/** Flies the badge to the library's as the rest fades, or fades the lot. Resolves when it's done. */
async function land(root: HTMLElement, badge: HTMLElement) {
  // Where there's nothing to animate with (jsdom), it's simply gone.
  if (typeof root.animate !== 'function') return
  const ms = FLIGHT_MS * motion()
  // The library's badge, or the gear (App) with the library put away.
  const target = [...document.querySelectorAll<HTMLElement>('[data-plus-badge], [data-plus-landing]')].find(onScreen)
  if (!target || ms === 0) {
    await root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.55, easing: 'ease', fill: 'forwards' }).finished
    return
  }

  // From where it rests, not where a landing cut short by a tap has it.
  badge.getAnimations().forEach((animation) => animation.finish())
  const [from, to] = [badge.getBoundingClientRect(), target.getBoundingClientRect()]
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  root.style.pointerEvents = 'none'
  for (const element of root.querySelectorAll<HTMLElement>('[data-fades]')) {
    element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.5, easing: 'ease', fill: 'forwards' })
  }
  // A small lift as it lets go, then down in a glide, shrinking to fit: onto
  // the library's badge, or into the gear, fading as it goes in.
  const into = !target.matches('[data-plus-badge]')
  await badge.animate(
    [
      { transform: 'none' },
      { transform: 'translateY(-14px) scale(1.06)', offset: 0.2, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
      { opacity: 1, offset: 0.75 },
      { transform: `translate(${dx}px, ${dy}px) scale(${to.width / from.width})`, opacity: into ? 0 : 1 },
    ],
    { duration: ms, fill: 'forwards' },
  ).finished
  // And the badge or gear takes the landing.
  target.animate([{ transform: 'scale(1.5)' }, { transform: 'none' }], { duration: 320 * motion(), easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' })
}
