import { useEffect, useRef, useState } from 'react'
import type { Item } from '../db/db'
import * as items from '../db/items'
import { dueOn, expiredNotice } from './expiry'
import type { Notice } from './notices'
import { localDay } from './time'

/**
 * Today, on the writer's calendar, while Nib is open: turned over at
 * midnight, and looked at again whenever Nib comes back to the front, as a
 * timer doesn't run while a phone sleeps or a tab is put away.
 *
 * Only with Nib in front. What follows a new day is a write (useExpiring),
 * and one begun as an iPhone puts Nib to sleep is cut off part way: it came
 * back saying it couldn't save, or couldn't update its file copy.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localDay(Date.now()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const look = () => {
      // Gone to the back, or at the back at midnight: coming to the front looks, and sets the timer again.
      if (document.visibilityState !== 'visible') return
      const now = new Date()
      setToday(localDay(now.getTime()))
      clearTimeout(timer)
      // The next midnight by the calendar, which a day of 23 or 25 hours has too.
      timer = setTimeout(look, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime())
    }
    look()
    document.addEventListener('visibilitychange', look)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', look)
    }
  }, [])
  return today
}

/**
 * Notes and pages whose expiry date has come (lib/expiry) move to the trash:
 * as Nib opens, as their day comes with it open, and as one arrives from
 * another device already due. Whatever Plus says: a date set stands. Archived
 * ones too. Says what went, with Undo, which puts them back without the date
 * that sent them (db/items `restore`). The one in front (`inFront`) goes as
 * well, and isn't in what's said: its words stay there under the banner any
 * open document in the trash has, which says it expired and has its Restore.
 */
export function useExpiring(listed: Item[], archived: Item[], inFront: string | null, guarded: (action: () => Promise<unknown>) => Promise<unknown>, setNotice: (notice: Notice) => void) {
  const today = useToday()
  // Asked to go already, and not yet out of the lists: not asked twice.
  const sent = useRef(new Set<string>())
  const write = useRef(guarded)
  write.current = guarded
  const front = useRef(inFront)
  front.current = inFront
  useEffect(() => {
    const due = dueOn([...listed, ...archived], today)
    for (const id of sent.current) if (!due.some((item) => item.id === id)) sent.current.delete(id)
    const going = due.filter((item) => !sent.current.has(item.id))
    if (going.length === 0) return
    const ids = going.map((item) => item.id)
    for (const id of ids) sent.current.add(id)
    void write.current(async () => {
      await items.remove(ids)
      const told = going.filter((item) => item.id !== front.current)
      if (told.length > 0) setNotice({ text: expiredNotice(told), action: { label: 'Undo', run: () => void write.current(() => Promise.all(told.map((item) => items.restore(item.id)))) } })
    })
  }, [listed, archived, today, setNotice])
}
