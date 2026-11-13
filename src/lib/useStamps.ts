import { useEffect, useState } from 'react'
import { keepStamps, openedChristmases, openedLate, readBook, readStamps, readTrades, STAMPS_SYNCED } from './collection'
import { count } from './counts'
import { copiesOf, type Trade } from './market'
import { marketOf, type StampMarket } from './marketActions'
import { bookStamp, catchUp, christmasWaiting, drawnOn, stampFor, type Pack } from './rewards'
import { packFor, type Received } from './stampbook'
import { localDay } from './time'

/**
 * The day's pack, waiting from the first time Nib opens on a day until it's
 * opened, and every day stamped; and the day's coins for coming back, two and
 * a half times as many with Nib Plus's subscription (`plus`). The day is read
 * again whenever Nib comes back to the screen, so a new day's pack and coins
 * are there after midnight.
 */
export function useStamps(plus: boolean): {
  /** The day it is here, kept up to date as Nib comes back to the screen. */
  today: string
  /** Today's pack, not yet opened. */
  waiting: boolean
  /** Opens it: its stamps kept, and what it held; null while `behind`. */
  openPack: () => Pack | null
  stamps: string[]
  /** What the coins do (lib/marketActions). */
  market: StampMarket
  /** Christmas Day's present, waiting to be opened (`christmasWaiting`). */
  christmas: boolean
  /** Opens it: Christmas Day's gold stamp, given. */
  openChristmas: () => void
  /** Winter (lib/theme), the theme a present gives: kept once one's been opened, any year. */
  winter: boolean
} {
  const [today, setToday] = useState(() => localDay(Date.now()))
  useEffect(() => {
    const look = () => document.visibilityState === 'visible' && setToday(localDay(Date.now()))
    document.addEventListener('visibilitychange', look)
    return () => document.removeEventListener('visibilitychange', look)
  }, [])
  // And at midnight, for a Nib left on the screen, as on a Mac: the new day's pack and coins, and a new week's.
  useEffect(() => {
    const midnight = new Date(Date.now())
    midnight.setHours(24, 0, 0, 0)
    const timer = setTimeout(() => setToday(localDay(Date.now())), midnight.getTime() - Date.now() + 1000)
    // A timer may not count the hours a Mac sleeps, so the day is looked at every minute too.
    const minutely = setInterval(() => setToday(localDay(Date.now())), 60_000)
    return () => {
      clearTimeout(timer)
      clearInterval(minutely)
    }
  }, [today])
  const [stamps, setStamps] = useState(readStamps)
  const [opened, setOpened] = useState(openedChristmases)
  const [received, setReceived] = useState(readBook)
  const [trades, setTrades] = useState(readTrades)
  // Brought from another device by sync: today's pack there is today's pack opened here.
  useEffect(() => {
    const reread = () => {
      setStamps(readStamps())
      setReceived(readBook())
      setOpened(openedChristmases())
      setTrades(readTrades())
    }
    window.addEventListener(STAMPS_SYNCED, reread)
    return () => window.removeEventListener(STAMPS_SYNCED, reread)
  }, [])

  // Set back a day at a time, the device's date brought a day's pack and coins each time, a new week of
  // packs and re-rolls, and the pick of the days with a mythic. So nothing new comes on a day before one
  // the stamps and coins have seen: whoever set it ahead once waits for that day.
  const latestOf = (days: string[], book: Received, all: Trade[]) =>
    [...days, ...book.map(([day]) => day), ...all.map((trade) => trade.day)].reduce((latest, day) => (day > latest ? day : latest), '')
  const latest = latestOf(stamps, received, trades)
  /**
   * The latest day the stamps and coins have seen, while the device's date is
   * earlier: till it comes, no day's coins, pack or Christmas present, and
   * no coins spent. Null otherwise.
   */
  const behind = today < latest ? latest : null
  /** Behind, as the stamps and coins are stored now: read afresh, as another window or device may have moved on. */
  const behindNow = () => today < latestOf(readStamps(), readBook(), readTrades())

  // Known by its stamps in the book: Christmas Day's present puts the day in `stamps` too.
  const waiting = !behind && !received.some(([day]) => day === today)

  return {
    today,
    waiting,
    openPack: () => {
      if (behindNow()) return null
      count('pack_opened')
      const days = readStamps()
      const book = readBook()
      const all = readTrades()
      const before = copiesOf(book.filter(([day]) => day !== today), all)
      // Opened already today, from another window: as it was.
      const held = book.filter(([day]) => day === today).map(([, no]) => no)
      const late = openedLate()
      const door = held.length ? (Object.keys(late).find((day) => late[day] === today) ?? null) : catchUp(days, today)
      const nos = held.length ? held : packFor(today)
      if (!held.length) {
        for (const day of [today, ...(door ? [door] : [])]) if (!days.includes(day)) days.push(day)
        days.sort()
        setStamps(days)
        for (const no of nos) book.push([today, no])
        keepStamps({ stamps: days, ...(door ? { late: { ...late, [door]: today } } : {}), book })
        setReceived(book)
      }
      return {
        day: today,
        dayStamp: drawnOn(today) ? null : stampFor(today),
        caughtUp: door ? stampFor(door) : null,
        stamps: nos.map((no) => ({ ...bookStamp(no, today), fresh: !before.get(no), copies: copiesOf(book, all).get(no) ?? 1 })),
        prompt: stampFor(today, book).prompt,
      }
    },
    stamps,
    market: marketOf({ today, plus, received, trades, setTrades, waiting, behind, behindNow }),
    christmas: !behind && christmasWaiting(stamps, opened, today),
    winter: opened.length > 0,
    openChristmas: () => {
      const year = Number(today.slice(0, 4))
      const days = readStamps()
      const given = !days.includes(`${year}-12-25`)
      if (given) {
        days.push(`${year}-12-25`)
        days.sort()
        setStamps(days)
      }
      const years = [...opened, year]
      keepStamps({ ...(given ? { stamps: days } : {}), christmas: years })
      setOpened(years)
    },
  }
}
