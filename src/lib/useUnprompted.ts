import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { Sync } from '../sync'
import { keepInCloud } from './cloud'
import { dailyAsked } from './dailyReminder'
import { askDue, rememberOffered } from './feedback'
import type { useFirsts } from './firsts'
import { nativeApp, touchApp } from './platform'
import { cardCame, caretInText, quiet, twoInARow, watchTyping } from './quiet'

const clearToAsk = () => quiet() && !caretInText()

/**
 * What Nib brings up without being asked, one at a time and in this order:
 * today's coins, today's pack, first steps' card, then what Nib asks once.
 * The Plus offer looks for itself, at moments of its own (lib/upsell), by the
 * same idea of quiet.
 */
export function useUnprompted({
  listed,
  writing,
  sync,
  plusKnown,
  coinsDue,
  packWaiting,
  today,
  firsts,
  held,
}: {
  /** The library, once read. */
  listed: readonly unknown[] | undefined
  /** There's writing in it. */
  writing: boolean
  sync: Pick<Sync, 'known' | 'code' | 'status'>
  plusKnown: boolean
  coinsDue: boolean
  packWaiting: boolean
  today: string
  firsts: ReturnType<typeof useFirsts>
  /** Something is up that holds all this back: the welcome, Plus's, the Plus sheet, focus mode. */
  held: boolean
}) {
  /** Open, or 'offered': come up of its own accord rather than asked for. */
  const [packOpen, setPackOpen] = useState<boolean | 'offered'>(false)
  const [coinsOpen, setCoinsOpen] = useState(false)
  // What Nib asks once (lib/feedback).
  const [asking, setAsking] = useState<'counts' | 'feedback' | 'buddy' | null>(null)
  // The daily reminder, offered once, as the first pack is put away.
  const [offeringDaily, setOfferingDaily] = useState(false)
  // Its turn, held for a pause: it would have been the third in a row.
  const [dailyDue, setDailyDue] = useState(false)

  // Today's pack may have been opened, and today's coins collected, on another
  // device (lib/collection), signed in to the same Apple Account (lib/cloud) or
  // with sync on: they wait for iCloud's first read and sync's first look, or a
  // few seconds of neither.
  const [cloudLooked, setCloudLooked] = useState(!nativeApp)
  useEffect(() => (nativeApp ? keepInCloud(() => setCloudLooked(true)) : undefined), [])
  const [syncLooked, setSyncLooked] = useState(false)
  const lookedNow = cloudLooked && sync.known && (!sync.code || ['synced', 'offline', 'error', 'inactive'].includes(sync.status.state))
  useEffect(() => {
    if (syncLooked || !nativeApp) return
    if (lookedNow) return setSyncLooked(true)
    const timer = setTimeout(() => setSyncLooked(true), 5000)
    return () => clearTimeout(timer)
  }, [syncLooked, lookedNow])

  useEffect(() => watchTyping(), [])

  // How many times Nib has come back to the front, and how many of those have been looked at.
  const [fronts, setFronts] = useState(0)
  const frontsSeen = useRef(0)
  useEffect(() => {
    const back = () => document.visibilityState === 'visible' && setFronts((n) => n + 1)
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [])

  const coinsOffered = useRef<string | null>(null)
  const packOffered = useRef<string | null>(null)
  // Whether the library had writing as Nib opened: a writer from before first steps, not one just begun.
  const wroteBefore = useRef<boolean | null>(null)
  useEffect(() => {
    if (listed && wroteBefore.current === null) wroteBefore.current = writing
  }, [listed, writing])
  const askedThisLaunch = useRef(false)

  const bring = useEffectEvent((next: 'coins' | 'pack' | 'daily' | 'earned' | 'firsts') => {
    // Set in Settings while it waited its turn: nothing left to offer.
    if (next === 'daily' && dailyAsked()) return setDailyDue(false)
    cardCame()
    if (next === 'daily') {
      setDailyDue(false)
      setOfferingDaily(true)
    } else if (next === 'coins') {
      coinsOffered.current = today
      setCoinsOpen(true)
    } else if (next === 'pack') {
      packOffered.current = today
      setPackOpen('offered')
    } else if (next === 'earned') firsts.celebrate()
    else firsts.grant()
  })

  // Today's coins for coming back, then today's pack, come up of their own
  // accord a moment after Nib opens, or come back on a new day, once the
  // library's here and nothing else is being asked; the coins once the App
  // Store has said whether Plus is on, for Plus's two and a half times. Put
  // off, the pack waits beside the way back to the library. And only at a
  // pause (lib/quiet).
  // First steps' card next, when the last of them has been done. A writer with
  // a library from before first steps never saw the welcome that begins them:
  // theirs is given, once, its card at a pause after the day's coins, and its
  // pack offered or opened.
  // Then what Nib asks once (lib/feedback): at most one a launch, after the day's coins and pack, a few seconds in, at a
  // pause, and not with the caret in the text. Looked at again once the Keychain has answered: something may have come up.
  // Each started afresh as what was up goes, so the next never comes in less than a tick.
  useEffect(() => {
    const back = fronts !== frontsSeen.current
    frontsSeen.current = fronts
    if (!nativeApp || !listed || !syncLooked || coinsOpen || packOpen || held) return
    const next = coinsDue
      ? plusKnown && coinsOffered.current !== today
        ? 'coins'
        : null
      : packWaiting && packOffered.current !== today
        ? 'pack'
        : dailyDue
          ? 'daily'
          : firsts.earned
            ? 'earned'
            : !firsts.begun && wroteBefore.current
              ? 'firsts'
              : plusKnown && !askedThisLaunch.current && !asking && !offeringDaily && !firsts.celebrating
                ? 'ask'
                : null
    if (!next) return
    // Come back to the front, iOS puts the caret and the keyboard back where they were left, and with the caret in the
    // text nothing comes up: a new day's coins and pack never came. Coming back is as good as opening Nib, where they come
    // first, so the keyboard is put away for them, as it is when Nib opens.
    if (back && touchApp && (next === 'coins' || next === 'pack') && caretInText()) (document.activeElement as HTMLElement).blur()
    let live = true
    let ticks = 0
    const timer = setInterval(() => {
      if (next === 'ask' ? ++ticks < 5 || !clearToAsk() : !quiet()) return
      clearInterval(timer)
      if (next !== 'ask') return bring(next)
      void askDue().then((due) => {
        if (!live) return
        askedThisLaunch.current = true
        if (!due || !clearToAsk()) return
        if (due === 'feedback') void rememberOffered()
        cardCame()
        setAsking(due)
      })
    }, 700)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [listed, syncLooked, plusKnown, coinsDue, packWaiting, today, firsts.begun, firsts.earned, firsts.celebrating, asking, offeringDaily, dailyDue, coinsOpen, packOpen, held, fronts])

  return {
    coinsOpen,
    closeCoins: () => setCoinsOpen(false),
    packOpen,
    /** Asked for, from the button beside the way back to the library: not offered again today. */
    openPack: () => {
      packOffered.current = today
      setPackOpen(true)
    },
    closePack: () => setPackOpen(false),
    asking,
    endAsking: () => setAsking(null),
    offeringDaily,
    setOfferingDaily,
    /** The first pack put away: the daily reminder offered then and there, or at a pause later if that would be a third in a row. */
    offerDaily: () => {
      if (twoInARow()) return setDailyDue(true)
      cardCame()
      setOfferingDaily(true)
    },
  }
}
