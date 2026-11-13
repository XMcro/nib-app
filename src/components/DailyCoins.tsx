import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { LOGIN_WEEK, loginCoins } from '../lib/market'
import { motion } from '../lib/motion'
import { touchApp } from '../lib/platform'
import { Coin } from './Coin'
import { countUp } from './countUp'
import { Sheet } from './Sheet'

type Login = { step: number; coins: number; rest: number }

/**
 * Today's coins for coming back, before today's pack: the week's seven days
 * of coins, doubling, those collected and today's; the big coin, dropped in
 * spinning, to tap; collected, it springs and flings a fountain of little
 * ones as the coins there are count up. Tapped outside, or Escape, collects
 * them and goes. Collected on another device first, it goes as it is.
 */
export function DailyCoins({ login, points, subscribed, onCollect, onClose }: { login: Login | null; points: number; subscribed: boolean; onCollect: () => number | null; onClose: () => void }) {
  // As it came up: once collected, there's none to collect.
  const [day] = useState(login)
  const [collected, setCollected] = useState(false)
  // As kept, once collected: worked out afresh then, from what another device may have brought meanwhile.
  const [kept, setKept] = useState<number | null>(null)
  const [scale] = useState(motion)
  const [shown, setShown] = useState(points)
  const from = useRef(points)
  const done = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!collected && !login) onClose()
  }, [collected, login, onClose])
  // The coins there are, counting up to the new count as the little ones fly.
  useEffect(() => {
    if (!collected) return
    const start = from.current
    const span = 900 * scale
    if (!span || points === start) return setShown(points)
    return countUp(start, points, span, 250 * scale, setShown)
  }, [collected, points, scale])
  if (!day) return null
  const { step, coins, rest } = day
  const week = step === LOGIN_WEEK
  const fountain = week ? 24 : 14

  function collect() {
    if (collected) return
    from.current = points
    setKept(onCollect())
    setCollected(true)
    // The big coin, collected, can't be pressed again: Done, for Escape and Return.
    if (!touchApp) done.current?.focus()
  }
  /** Gone, collected first. */
  function leave() {
    if (!collected) onCollect()
    onClose()
  }

  return (
    // Come up of its own accord: on a Mac the focus goes to the card, not its button, so a key meant for the writing can't collect.
    <Sheet
      label="Today’s coins"
      data-collected={collected || undefined}
      onClose={leave}
      focusOnTouch
      overlay="z-[56] flex flex-col overflow-y-auto bg-ink/30 p-4"
      className="nib-market relative m-auto w-full max-w-[360px] rounded-lg border border-line bg-paper px-5 pt-5 pb-4 text-center shadow-[0_18px_50px_rgba(10,20,40,0.25)]"
    >
      <div className="text-[14px] font-medium">{step ? `Day ${step} of ${LOGIN_WEEK}${week ? ': a whole week' : ''}` : 'Today’s coins'}</div>
      <p className="mx-auto mt-1 max-w-[280px] text-[12px] leading-[1.5] text-muted">
        {week
          ? `The most there is. Now ${loginCoins(0, subscribed)} a day, and a new week in 31 days.`
          : step
            ? `Come back tomorrow for ${loginCoins(step + 1, subscribed).toLocaleString()}.${step === 1 ? ' Miss a day and the week starts over.' : ''}`
            : rest === 1
              ? `${loginCoins(0, subscribed)} a day for now. A new week starts tomorrow.`
              : `${loginCoins(0, subscribed)} a day for now. A new week starts in ${rest} days.`}
      </p>

      {step > 0 && (
        <ol className="mt-4 grid grid-cols-7 gap-1" aria-label="This week">
          {Array.from({ length: LOGIN_WEEK }, (_, i) => {
            const on = i + 1
            const state = on < step || (on === step && collected) ? 'got' : on === step ? 'today' : 'ahead'
            return (
              <li
                key={on}
                data-state={state}
                aria-label={`Day ${on}, ${loginCoins(on, subscribed).toLocaleString()} coins${state === 'got' ? ', collected' : state === 'today' ? ', today' : ''}`}
                className={`nib-market-in relative flex flex-col items-center gap-1 rounded-md py-1.5 ${on === step ? 'bg-[color-mix(in_srgb,#f2c94c_22%,var(--color-paper))]' : ''}`}
                style={{ '--i': on } as CSSProperties}
              >
                <span className={state === 'ahead' ? 'text-muted opacity-50' : ''}>
                  <Coin size={on === step ? 26 : 22} plain={state === 'ahead'} />
                </span>
                <span className={`text-[10px] tabular-nums ${on === step ? 'font-semibold' : 'text-muted'}`}>{loginCoins(on, subscribed).toLocaleString()}</span>
                {state === 'got' && (
                  <span aria-hidden className="nib-plus-got absolute -top-1 right-0.5 flex size-3.5 items-center justify-center rounded-full bg-accent text-paper">
                    <svg viewBox="0 0 10 10" width={8} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 5.2 L4.2 7.3 L8 2.8" />
                    </svg>
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}

      <div className="relative mt-5 flex justify-center">
        <span aria-hidden className="nib-coins-glow pointer-events-none absolute top-1/2 left-1/2 size-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full" />
        <button aria-label={`Collect ${coins.toLocaleString()} coins`} disabled={collected} onClick={collect} className="relative block cursor-pointer rounded-full outline-offset-4 disabled:cursor-default">
          <span className="nib-coins-pop block" data-collected={collected || undefined}>
            <span className="nib-points-coin block">
              <Coin size={92} />
            </span>
          </span>
          {/* The fountain: more for a whole week. */}
          {collected && scale > 0 && (
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2">
              {Array.from({ length: fountain }, (_, i) => (
                <span
                  key={i}
                  data-now
                  className="nib-coin-fly"
                  style={{ '--a': `${(i * 360) / fountain - 90}deg`, '--r': `${90 + (i % 4) * 22}px`, '--d': `${(i % 5) * 45}ms` } as CSSProperties}
                >
                  <Coin size={13} />
                </span>
              ))}
            </span>
          )}
        </button>
      </div>
      <div className="relative mt-3 text-[28px] leading-none font-semibold tabular-nums">+{(kept ?? coins).toLocaleString()}</div>
      <div className="relative mt-1 text-[11.5px] text-muted">{subscribed ? 'coins, two and a half times with Nib Plus' : 'coins'}</div>

      <div className="relative mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
        {/* Said once, as it ends, not each number as it counts up. */}
        <span className="sr-only" aria-live="polite">
          {collected ? `You have ${points.toLocaleString()} ${points === 1 ? 'coin' : 'coins'}.` : ''}
        </span>
        <span className="text-left text-[12px] text-muted" aria-hidden={collected || undefined}>
          {collected ? (
            <>
              You have <span className="font-semibold text-ink tabular-nums">{shown.toLocaleString()}</span> {points === 1 ? 'coin' : 'coins'}.
            </>
          ) : subscribed ? (
            ''
          ) : (
            'Two and a half times as many with Nib Plus.'
          )}
        </span>
        <button ref={done} onClick={collected ? onClose : collect} className="nib-tap shrink-0 cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-paper">
          {collected ? 'Done' : 'Collect'}
        </button>
      </div>
    </Sheet>
  )
}
