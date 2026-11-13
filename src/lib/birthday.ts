import { useEffect, useState } from 'react'
import { keepStamps, openedBirthdays, STAMPS_SYNCED } from './collection'
import { localDay } from './time'
import type { Stamp } from './rewards'
import { MOTIFS } from './stampWords'
import { STAMP_INKS } from './stampbook'

/**
 * 12 June, the birthday of the one who made Nib. Opening Nib that day brings
 * a present, waiting beside the way back to the library as Christmas's does,
 * with a stamp found nowhere else: a cake in a shimmering foil, on confetti,
 * outside the stampbook's 300. It's kept from the first year it's opened, and
 * the present comes back each 12 June to celebrate again. Free, and kept on
 * this device.
 */

const BIRTHDAY = '06-12'

/** 12 June in some year, to say which day it is: the year isn't shown. */
export const TWELFTH_OF_JUNE = `2026-${BIRTHDAY}`

export function birthdayStamp(day: string): Stamp {
  return { day, motif: MOTIFS.indexOf('A birthday cake'), ink: STAMP_INKS.rose, prompt: '', rarity: 'mythic', ground: 'confetti' }
}

export function useBirthday() {
  const today = localDay(Date.now())
  const year = Number(today.slice(0, 4))
  const [opened, setOpened] = useState(openedBirthdays)
  // Opened on another device, and brought by sync (lib/collection).
  useEffect(() => {
    const reread = () => setOpened(openedBirthdays())
    window.addEventListener(STAMPS_SYNCED, reread)
    return () => window.removeEventListener(STAMPS_SYNCED, reread)
  }, [])
  return {
    /** It's the day, and this year's present hasn't been opened. */
    waiting: today.slice(5) === BIRTHDAY && !opened.includes(year),
    /** The birthday its stamp was first kept on, or null. */
    kept: opened.length ? `${Math.min(...opened)}-${BIRTHDAY}` : null,
    open: () => {
      const years = [...opened, year]
      // Storage off: opened for this session.
      keepStamps({ birthday: years })
      setOpened(years)
    },
  }
}
