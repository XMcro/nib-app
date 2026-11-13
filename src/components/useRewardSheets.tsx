import { useInkwellStory } from '../lib/buddy'
import { useState } from 'react'
import type { Item, Placed } from '../db/db'
import { useBirthday } from '../lib/birthday'
import { useCounted } from '../lib/counts'
import { useDailyReminder } from '../lib/dailyReminder'
import type { useFirsts } from '../lib/firsts'
import { samePlaced } from '../lib/placed'
import { nativeApp } from '../lib/platform'
import { remindersAvailable } from '../lib/reminders'
import { WINTER, type Theme } from '../lib/theme'
import { localDay } from '../lib/time'
import type { useStamps } from '../lib/useStamps'
import type { useUnprompted } from '../lib/useUnprompted'
import { BirthdayCard, BirthdayPresent } from './BirthdayGift'
import { ChristmasCalendar } from './ChristmasCalendar'
import { ChristmasCard, ChristmasPresent } from './ChristmasGift'
import type { Command } from './CommandPalette'
import { DailyCoins } from './DailyCoins'
import { DailyReminderOffer } from './DailyReminderOffer'
import { FirstSteps, FirstStepsDone } from './FirstSteps'
import { Market } from './Market'
import { PackButton, PackOpening } from './Pack'
import { Stampbook } from './Stampbook'
import { StampCard } from './StampPage'

/**
 * What's free for writing and for coming back: the stampbook, the market, the
 * coins, the pack, the calendar and the presents. The ten sheets are in the
 * order they stack in, which is App's order; the buttons wait beside the way
 * back to the library.
 */
export function useRewardSheets({ rewards, firsts, unprompted, everything, subscribed, stampsOnto, theme, changeTheme, writeFrom }: {
  rewards: ReturnType<typeof useStamps>
  firsts: ReturnType<typeof useFirsts>
  /** What comes up without being asked for (lib/useUnprompted). */
  unprompted: ReturnType<typeof useUnprompted>
  everything: Item[]
  subscribed: boolean
  /** The note or page open, to put stamps on from the Stampbook (lib/placed). */
  stampsOnto: { label: string; stamps: Placed[]; set: (stamps: Placed[]) => void } | null
  theme: Theme
  changeTheme: (next: Theme) => void
  /** The day's prompt, as the first line of a new note. */
  writeFrom: (prompt: string) => void
}) {
  const { coinsOpen, closeCoins, packOpen, openPack, closePack, offeringDaily, setOfferingDaily, offerDaily } = unprompted
  const [viewingCalendar, setViewingCalendar] = useState(false)
  const [viewingStampbook, setViewingStampbook] = useState(false)
  // The market on its own, from the library's coin.
  const [viewingMarket, setViewingMarket] = useState(false)
  // A stamp on the writing, tapped open (components/Stampbook StampCard).
  const [lookingAt, setLookingAt] = useState<Placed | null>(null)
  // Christmas Day's present, opened and on screen.
  const [unwrapping, setUnwrapping] = useState(false)
  const birthday = useBirthday()
  // Inkwell's keepsake, kept the first time it tells its story (lib/buddy).
  const inkwell = useInkwellStory()
  const [celebrating, setCelebrating] = useState(false)
  // The daily reminder, offered once, as the first pack is put away.
  const daily = useDailyReminder(!rewards.waiting)
  useCounted(viewingStampbook, 'stampbook_opened')

  return {
    sheets: (
      <>
        {viewingStampbook && (
          <Stampbook
            stamps={rewards.stamps}
            market={rewards.market}
            firstSteps={firsts.finished}
            written={everything.length ? localDay(Math.min(...everything.map((item) => item.createdAt))) : null}
            birthday={birthday.kept}
            inkwell={inkwell}
            onto={stampsOnto}
            onClose={() => setViewingStampbook(false)}
          />
        )}
        {viewingMarket && (
          <Market
            market={rewards.market}
            onClose={() => setViewingMarket(false)}
          />
        )}
        {lookingAt && stampsOnto && (
          <StampCard
            placed={lookingAt}
            label={stampsOnto.label}
            onTakeOff={() => stampsOnto.set(stampsOnto.stamps.filter((had) => !samePlaced(had, lookingAt)))}
            onClose={() => setLookingAt(null)}
          />
        )}
        {firsts.celebrating && firsts.finished && <FirstStepsDone day={firsts.finished} onClose={firsts.endCelebration} />}
        {viewingCalendar && <ChristmasCalendar stamps={rewards.stamps} onClose={() => setViewingCalendar(false)} />}
        {celebrating && birthday.kept && <BirthdayCard kept={birthday.kept} onStampbook={() => setViewingStampbook(true)} onClose={() => setCelebrating(false)} />}
        {unwrapping && <ChristmasCard stamps={rewards.stamps} wearingWinter={theme === WINTER} onWinter={() => changeTheme(WINTER)} onCalendar={() => setViewingCalendar(true)} onClose={() => setUnwrapping(false)} />}
        {coinsOpen && <DailyCoins login={rewards.market.login} points={rewards.market.points} subscribed={subscribed} onCollect={rewards.market.collect} onClose={closeCoins} />}
        {packOpen && (
          <PackOpening
            day={rewards.today}
            waiting={rewards.waiting}
            offered={packOpen === 'offered'}
            onOpen={rewards.openPack}
            onClose={(putAway) => {
              closePack()
              if (putAway && remindersAvailable && !daily.asked) offerDaily()
            }}
            onWrite={writeFrom}
            onStampbook={() => setViewingStampbook(true)}
            onCalendar={() => setViewingCalendar(true)}
          />
        )}
        {offeringDaily && (
          <DailyReminderOffer
            onSet={async (time) => {
              await daily.change(time)
              setOfferingDaily(false)
            }}
            onDecline={() => {
              daily.decline()
              setOfferingDaily(false)
            }}
          />
        )}
      </>
    ),
    buttons: (
      <>
        {nativeApp && rewards.waiting && !packOpen && (
          <PackButton day={rewards.today} onOpen={openPack} />
        )}
        {rewards.christmas && (
          <ChristmasPresent
            onOpen={() => {
              rewards.openChristmas()
              setUnwrapping(true)
            }}
          />
        )}
        {birthday.waiting && (
          <BirthdayPresent
            onOpen={() => {
              birthday.open()
              setCelebrating(true)
            }}
          />
        )}
        {firsts.showing && <FirstSteps done={firsts.done} fresh={firsts.fresh} onPutAway={firsts.putAway} />}
      </>
    ),
    /** Its rows in the palette. */
    commands: (): Command[] => [
      // Free, once there's a stamp to see: a pack's, or first steps' or the birthday's, which come without one.
      ...(nativeApp && (rewards.stamps.length || firsts.finished || birthday.kept) ? [{ id: 'stampbook', label: 'Stampbook', run: () => setViewingStampbook(true) }] : []),
      // Free, all December.
      ...(nativeApp && new Date().getMonth() === 11 ? [{ id: 'christmas', label: 'Christmas calendar', run: () => setViewingCalendar(true) }] : []),
    ],
    /** A stamp on the writing, tapped open. */
    lookAt: setLookingAt,
    /** The daily reminder, for Settings. */
    daily,
    /** The library's coin and its stamps. Free, in the app, where stamps are. */
    library: nativeApp ? { points: rewards.market.points, onStampbook: () => setViewingStampbook(true), onMarket: () => setViewingMarket(true) } : undefined,
  }
}
