import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useCounted } from '../lib/counts'
import badge from '../assets/plus-badge.png'
import { dailyOf, lastOne, PACKS, PACKS_A_WEEK, PLUS_DAYS, plusCoinsOf, repeatsOf, REROLL, REROLLS_A_WEEK, thisWeek, VALUE } from '../lib/market'
import type { StampMarket } from '../lib/marketActions'
import { motion } from '../lib/motion'
import { touchApp } from '../lib/platform'
import { bookStamp } from '../lib/rewards'
import { BOOK, LUCKY, RARITIES, RARITY_INKS, RARITY_NAMES } from '../lib/stampbook'
import { longDay } from '../lib/time'
import { Coin } from './Coin'
import { countUp } from './countUp'
import { PackArt, PackOpening } from './Pack'
import { Sheet } from './Sheet'
import { StampArt } from './StampArt'

/**
 * The stamp market, over the Stampbook: the coins there are, counting up as
 * they come; what they buy, packs of 1, 3 or 10 (so many a week), another go
 * at today's stamp, days of Nib Plus's features (never sync, which is the
 * subscription's); every repeat, the rarest first, to sell a copy at a time
 * or all at once, one of each always kept (holidays, doors and keepsakes are
 * never repeats, so never here); and a code for coins, given out by Nib's
 * maker (lib/codes). A pack bought, or today's stamp again, opens as the
 * day's pack does.
 */
export function Market({ market, onClose }: { market: StampMarket; onClose: () => void }) {
  const { received, trades, canReroll, subscribed, plusUntil, today, behind, points, sell: onSell, buyPack: onBuyPack, reroll: onReroll, buyPlus: onBuyPlus, redeem: onRedeem } = market
  useCounted(true, 'market_opened')
  // Coins from codes buy packs and re-rolls, not Plus (lib/market plusCoinsOf).
  const plusCoins = plusCoinsOf(received, trades)
  const repeats = repeatsOf(received, trades).sort((a, b) => RARITIES.indexOf(BOOK[b.no - 1].rarity) - RARITIES.indexOf(BOOK[a.no - 1].rarity) || a.no - b.no)
  const spare = repeats.reduce((sum, { spare }) => sum + spare, 0)
  const worth = repeats.reduce((sum, { no, spare }) => sum + spare * VALUE[BOOK[no - 1].rarity], 0)
  const packsLeft = PACKS_A_WEEK - thisWeek(trades, 'pack', today)
  const rerollsLeft = REROLLS_A_WEEK - thisWeek(trades, 'reroll', today)
  // Today's stamp, the one of it kept, its spares sold: a re-roll would give it back.
  const todays = dailyOf(received, trades).filter(([day]) => day === today).at(-1)?.[1]
  const keptOne = todays !== undefined && lastOne(received, trades, todays, today)
  const [opening, setOpening] = useState<{ size: number } | { again: true } | null>(null)
  const [unbought, setUnbought] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const until = plusUntil > now ? new Date(plusUntil).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
  // Days just bought: said with a flourish.
  const [gotPlus, setGotPlus] = useState(0)
  // Asked first, as a tap spends up to 13,000 coins: the days of Plus chosen, and selling every repeat with legendary and mythic ones among them.
  const [buying, setBuying] = useState<(typeof PLUS_DAYS)[number] | null>(null)
  const [sellingAll, setSellingAll] = useState(false)
  const rare = repeats.reduce((sum, { no, spare }) => sum + (['legendary', 'mythic'].includes(BOOK[no - 1].rarity) ? spare : 0), 0)
  function sellAll() {
    setSellingAll(false)
    onSell(repeats.flatMap(({ no, spare }) => Array<number>(spare).fill(no)))
  }
  // A code being typed, and what came of the last one.
  const [code, setCode] = useState('')
  const [redeemed, setRedeemed] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  // The coins shown count up to the coins there are: from nothing as the market opens, once its
  // coin has landed, and from the last count after a trade, whose gain rises beside them.
  const [scale] = useState(motion)
  const [shown, setShown] = useState(() => (scale ? 0 : points))
  const [gain, setGain] = useState<{ points: number; key: number } | null>(null)
  const from = useRef(scale ? 0 : points)
  const opened = useRef(false)
  useEffect(() => {
    const start = from.current
    from.current = points
    const first = !opened.current
    opened.current = true
    if (points === start) return
    if (!first && points > start) setGain((was) => ({ points: points - start, key: (was?.key ?? 0) + 1 }))
    const span = (first ? 900 : 600) * scale
    if (!span) return setShown(points)
    return countUp(start, points, span, (first ? 1100 : 0) * scale, setShown)
  }, [points, scale])

  // Focus here for the keyboard, on a Mac: on iPhone and iPad it would ring Done in blue.
  // A trade can take the button pressed with it (the last of a repeat), and a pack, once opened,
  // hand it back to a tile its points no longer buy: focus stays in the market, for Escape.
  const doneButton = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const lost = !document.activeElement || document.activeElement === document.body
    if (!touchApp && lost && !opening) dialog.current?.focus()
  }, [points, opening, asking])

  return (
    <>
      <Sheet ref={dialog} label="Market" onClose={onClose} z="z-[55]" top="pt-[10vh]" focus={doneButton} className="nib-market flex h-fit max-h-[80dvh] w-[min(400px,94vw)] flex-col rounded-lg border border-line bg-paper">
        <div className="flex items-start gap-3 border-b border-line p-4">
          <div className="flex-1">
            <div className="text-[14px] font-medium">Market</div>
            <p className="mt-1 text-[12px] leading-[1.5] text-muted">
              Spend coins on packs, another go at today’s stamp and days of Plus’s features, and sell repeats for more. You always keep one of each; holiday and special stamps aren’t sold.
            </p>
          </div>
          <button ref={doneButton} onClick={onClose} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
            Done
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* The coin and the count beside it, on one line, in the middle: with "coins" under the count, the count sat above the coin's middle. */}
          <div className="nib-points nib-market-in relative flex items-center justify-center gap-3 rounded-lg px-4 py-3" style={{ '--i': 0 } as CSSProperties}>
            <span aria-hidden className="nib-points-glint" />
            {/* The coin drops in spinning and lands with a shower of little ones. */}
            <span aria-hidden className="relative">
              <span className="nib-points-coin block">
                <Coin size={42} />
              </span>
              {scale > 0 && (
                <span className="pointer-events-none absolute top-1/2 left-1/2">
                  {Array.from({ length: 8 }, (_, i) => (
                    <span key={i} className="nib-coin-fly" style={{ '--a': `${i * 45 + 20}deg`, '--r': `${46 + (i % 3) * 14}px` } as CSSProperties}>
                      <Coin size={13} />
                    </span>
                  ))}
                </span>
              )}
            </span>
            {/* Said as it is, not each number as it counts up. */}
            <span className="sr-only" aria-live="polite">{`${points.toLocaleString()} ${points === 1 ? 'coin' : 'coins'}`}</span>
            <span className="flex items-baseline gap-1.5" aria-hidden>
              <span className="text-[26px] leading-none font-semibold tabular-nums">{shown.toLocaleString()}</span>
              <span className="text-[12px] text-muted">{points === 1 ? 'coin' : 'coins'}</span>
            </span>
            {gain && (
              <span key={gain.key} aria-hidden className="nib-gain absolute top-3 right-4 text-[16px] font-semibold text-accent">
                +{gain.points.toLocaleString()}
              </span>
            )}
          </div>
          {points < 0 && (
            <p className="mt-1.5 text-[11.5px] leading-[1.5] text-muted">Below nothing: coins were spent on two devices before they caught up with each other. New coins make it up first.</p>
          )}

          <h3 className="nib-market-in mt-5 text-[12px] font-medium" style={{ '--i': 1 } as CSSProperties}>
            Spend
          </h3>
          {unbought && <p className="mt-1.5 text-[11.5px] leading-[1.5] text-muted">{unbought}</p>}
          {behind && (
            <p role="status" className="mt-1.5 rounded-md bg-item-hover px-3 py-2 text-[11.5px] leading-[1.5]">
              Your stamps and coins have been used as late as {longDay(behind)}, and this device’s date is earlier. Till that day comes here, there are no daily coins or packs, and coins can’t be spent. If you’ve crossed time zones, it won’t be long. If not, check the date and time in Settings.
            </p>
          )}
          <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="Packs">
            {PACKS.map(({ size, price }, i) => {
              const short = price - points
              return (
                <button
                  key={size}
                  aria-label={`Buy a pack of ${size === 1 ? '1 stamp' : `${size} stamps`} for ${price} coins`}
                  disabled={!!behind || short > 0 || packsLeft <= 0}
                  onClick={() => setOpening({ size })}
                  style={{ '--i': 2 + i } as CSSProperties}
                  className="nib-market-in nib-market-pack nib-tap flex cursor-pointer flex-col items-center rounded-lg border border-line px-2 pt-3 pb-2 hover:bg-item-hover disabled:cursor-default disabled:opacity-45"
                >
                  <PackArt day={today} width={40} shine={false} inside={size} />
                  <span className="mt-2 text-[12px] font-medium">{size === 1 ? '1 stamp' : `${size} stamps`}</span>
                  <span className="text-[11px] text-muted">{short > 0 ? `${short.toLocaleString()} more` : `${price} coins`}</span>
                </button>
              )
            })}
          </div>
          <p className="nib-market-in mt-1.5 text-[11px] text-muted" style={{ '--i': 5 } as CSSProperties}>
            {packsLeft > 0 ? `${packsLeft} of ${PACKS_A_WEEK} packs left this week.` : 'No packs left this week. More on Monday.'} Each stamp, as in the daily pack:{' '}
            {[...RARITIES].reverse().map((rarity) => `${RARITY_NAMES[rarity].toLowerCase()} ${LUCKY[rarity]}%`).join(', ')}.
          </p>
          <div className="nib-market-in mt-3 flex items-center gap-3 rounded-lg border border-line px-3 py-2.5" style={{ '--i': 6 } as CSSProperties}>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium">Today’s stamp, again</span>
              <span className="block text-[11px] leading-[1.45] text-muted">
                {!canReroll
                  ? 'Open today’s pack first.'
                  : keptOne
                    ? `Today’s is the one ${BOOK[todays - 1].name} you keep, its spares sold, so it can’t be given back.`
                    : rerollsLeft > 0
                      ? `A new draw in place of today’s. ${rerollsLeft} of ${REROLLS_A_WEEK} left this week.`
                      : 'None left this week. More on Monday.'}
              </span>
            </span>
            <button
              disabled={!!behind || !canReroll || keptOne || rerollsLeft <= 0 || points < REROLL}
              onClick={() => setOpening({ again: true })}
              className="nib-tap shrink-0 cursor-pointer rounded-md border border-line px-2.5 py-1 text-[12px] hover:bg-item-hover disabled:cursor-default disabled:opacity-45"
            >
              {points < REROLL ? `${(REROLL - points).toLocaleString()} more` : `Re-roll · ${REROLL}`}
            </button>
          </div>
          <div className="nib-market-in nib-market-plus mt-3 rounded-lg border border-line px-3 py-2.5" role="group" aria-label="Nib Plus from coins" style={{ '--i': 7 } as CSSProperties}>
            <div className="flex items-center gap-2">
              <img src={badge} alt="" className="size-5" />
              <span className="flex-1 text-[12.5px] font-medium">Nib Plus, from coins</span>
              {gotPlus > 0 && (
                <span key={gotPlus} className="nib-plus-got rounded-full bg-accent px-2 py-px text-[10.5px] font-semibold text-paper">
                  Yours till {until}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-[1.45] text-muted">
              {subscribed
                ? 'You have Nib Plus already.'
                : `${until ? `Open until ${until}; more runs on from then. ` : ''}Plus’s features here: themes, goals, Open beside, compiling and more. Not sync, which is the subscription’s. Days run from when they’re bought, alongside a subscription if you start one.`}
            </p>
            {!subscribed && plusCoins < points && (
              <p className="mt-1 text-[11px] leading-[1.45] text-muted">
                {(points - plusCoins).toLocaleString()} of your coins are from codes: they buy packs and re-rolls, not Plus.
              </p>
            )}
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {PLUS_DAYS.map((length) => (
                <button
                  key={length.days}
                  aria-label={`${length.label} of Nib Plus for ${length.price.toLocaleString()} coins`}
                  aria-pressed={buying === length}
                  disabled={!!behind || subscribed || plusCoins < length.price}
                  onClick={() => setBuying(length)}
                  className="nib-tap flex cursor-pointer flex-col items-center rounded-md border border-line px-1 py-1.5 hover:bg-item-hover disabled:cursor-default disabled:opacity-45"
                >
                  <span className="text-[11.5px] font-medium">{length.label}</span>
                  <span className="text-[10.5px] text-muted">{length.price.toLocaleString()}</span>
                </button>
              ))}
            </div>
            {buying && (
              <div className="mt-2 flex items-center gap-2 rounded-md bg-item-hover px-2.5 py-2">
                <span className="min-w-0 flex-1 text-[11.5px] leading-[1.45]">
                  {buying.label} of Plus’s features for {buying.price.toLocaleString()} coins?
                </span>
                <button
                  onClick={() => {
                    setBuying(null)
                    if (onBuyPlus(buying.days)) setGotPlus((was) => was + 1)
                  }}
                  className="nib-tap shrink-0 cursor-pointer rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-paper"
                >
                  Buy
                </button>
                <button onClick={() => setBuying(null)} className="nib-tap shrink-0 cursor-pointer text-[12px] text-muted hover:text-ink">
                  Cancel
                </button>
              </div>
            )}
          </div>
          <h3 className="nib-market-in mt-5 text-[12px] font-medium" style={{ '--i': 8 } as CSSProperties}>
            Sell
          </h3>
          <div className="mt-1 text-[11px] text-muted">
            Each repeat: {RARITIES.map((rarity) => `${RARITY_NAMES[rarity].toLowerCase()} ${VALUE[rarity]}`).join(', ')}
          </div>

          {repeats.length ? (
            <>
              <button
                disabled={sellingAll}
                onClick={() => (rare ? setSellingAll(true) : sellAll())}
                className="nib-tap mt-3 w-full cursor-pointer rounded-md bg-ink px-3 py-2 text-[12.5px] font-medium text-paper disabled:cursor-default disabled:opacity-45"
              >
                {spare === 1 ? 'Sell the one repeat' : `Sell all ${spare} repeats`} · +{worth.toLocaleString()}
              </button>
              {sellingAll && (
                <div className="mt-2 flex items-center gap-2 rounded-md bg-item-hover px-2.5 py-2">
                  <span className="min-w-0 flex-1 text-[11.5px] leading-[1.45]">
                    That sells {rare === 1 ? 'a legendary or mythic stamp' : `${rare} legendary and mythic stamps`} too, keeping one of each.
                  </span>
                  <button onClick={sellAll} className="nib-tap shrink-0 cursor-pointer rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-paper">
                    Sell all
                  </button>
                  <button onClick={() => setSellingAll(false)} className="nib-tap shrink-0 cursor-pointer text-[12px] text-muted hover:text-ink">
                    Cancel
                  </button>
                </div>
              )}
              <ul className="mt-4 space-y-2" aria-label="Your repeats">
                {repeats.map(({ no, spare }, i) => {
                  const entry = BOOK[no - 1]
                  return (
                    <li key={no} className="nib-repeat flex items-center gap-3" style={{ '--i': i } as CSSProperties}>
                      <span className="nib-stamp shrink-0">
                        <StampArt stamp={bookStamp(no, today)} width={34} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{entry.name}</span>
                        <span className="block text-[11px] text-muted">
                          {/* Deepened towards the ink, as the pack's are, to read on light paper and dark. */}
                          <span style={{ color: entry.rarity === 'common' ? undefined : `color-mix(in srgb, ${RARITY_INKS[entry.rarity]} 65%, var(--color-ink))` }}>{RARITY_NAMES[entry.rarity]}</span> · {spare === 1 ? '1 spare' : `${spare} spare`} · +{VALUE[entry.rarity]} each
                        </span>
                      </span>
                      <button
                        aria-label={`Sell one copy of ${entry.name} for ${VALUE[entry.rarity]} ${VALUE[entry.rarity] === 1 ? 'coin' : 'coins'}`}
                        onClick={() => onSell([no])}
                        className="nib-tap shrink-0 cursor-pointer rounded-md border border-line px-2.5 py-1 text-[12px] hover:bg-item-hover"
                      >
                        Sell 1
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-[12.5px] leading-[1.5] text-muted">No repeats to sell. Any stamp you get twice from a pack is yours to sell here.</p>
          )}

          {onRedeem && (
            <form
              className="mt-6 border-t border-line pt-4"
              onSubmit={async (event) => {
                event.preventDefault()
                if (asking) return
                setAsking(true)
                setRedeemed(null)
                const result = await onRedeem(code)
                setAsking(false)
                if (typeof result === 'number') setCode('')
                setRedeemed(
                  typeof result === 'number'
                    ? `${result.toLocaleString()} ${result === 1 ? 'coin' : 'coins'}, yours.`
                    : result === 'used'
                      ? 'You’ve used that code already.'
                      : result === 'used up'
                        ? 'That code has been used as many times as it can be.'
                        : result === 'ended'
                          ? 'That code has ended.'
                          : result === 'too many'
                            ? 'That’s as many codes as Nib takes from one connection in a day. Try again tomorrow.'
                            : result === 'offline'
                              ? 'Nib couldn’t reach its server. Try again when you’re online.'
                              : 'That isn’t a code Nib knows. Check it and try again.',
                )
              }}
            >
              <label htmlFor="nib-coin-code" className="block text-[12px] font-medium">
                A code for coins
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="nib-coin-code"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value)
                    setRedeemed(null)
                  }}
                  // On iPhone and iPad the keyboard shortens the market and leaves the field below it: up it comes, once the keyboard has.
                  onFocus={(event) => {
                    const field = event.currentTarget
                    if (touchApp) window.setTimeout(() => field.scrollIntoView({ block: 'center' }), 350)
                  }}
                  placeholder="NIB-XXXX-XXXX"
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  // 16 points: any smaller and iOS zooms the page in to type.
                  className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2.5 py-1 text-[16px] tracking-wide uppercase outline-none placeholder:text-faint focus:border-muted"
                />
                <button type="submit" disabled={!code.trim() || asking} className="nib-tap shrink-0 cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-paper disabled:cursor-default disabled:opacity-45">
                  {asking ? 'Redeeming…' : 'Redeem'}
                </button>
              </div>
              {redeemed && (
                <p role="status" className="mt-1.5 text-[11.5px] text-muted">
                  {redeemed}
                </p>
              )}
            </form>
          )}
        </div>
      </Sheet>
      {opening && (
        <PackOpening
          day={today}
          bought={'size' in opening ? opening.size : undefined}
          again={'again' in opening}
          onOpen={() => {
            const pack = 'size' in opening ? onBuyPack(opening.size) : onReroll()
            // Spent meanwhile, in another window or on another device, or the week's run out: said, not just closed.
            if (!pack) setUnbought('size' in opening ? 'That pack couldn’t be bought: the coins or this week’s packs have gone meanwhile.' : 'Today’s stamp couldn’t be drawn again: the coins or this week’s re-rolls have gone meanwhile.')
            return pack
          }}
          onClose={() => setOpening(null)}
        />
      )}
    </>
  )
}
