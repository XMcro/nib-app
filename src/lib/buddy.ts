import { useSyncExternalStore } from 'react'

/**
 * The writing buddy (components/Buddy): the nib from the icon, with a face, in
 * a corner, to ask about Nib and about writing. Free, and nothing it does
 * leaves this device. Off until it's said yes to: offered once, after the
 * update that brings it (lib/feedback askDue), or turned on in Settings. Kept
 * on this device, as each device's look is.
 */

const KEY = 'nib-buddy'
type Answer = 'on' | 'off'

/** Its answer with storage off, for this session. */
let unstored: Answer | null = null

/** Read each time, so what's stored is always what's shown. */
function read(): Answer | null {
  try {
    const kept = localStorage.getItem(KEY)
    return kept === 'on' || kept === 'off' ? kept : null
  } catch {
    return unstored
  }
}

const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Whether the nib is in its corner. */
export const useBuddy = () => useSyncExternalStore(subscribe, () => read() === 'on')

/** Asked already, whatever the answer, or set in Settings: not offered again. */
export const buddyAsked = () => read() !== null

/** Yes or no, from its offer or Settings. */
export function setBuddy(on: boolean) {
  unstored = on ? 'on' : 'off'
  try {
    localStorage.setItem(KEY, unstored)
  } catch {
    // Storage off: it lasts for this session.
  }
  listeners.forEach((listener) => listener())
}

/** The day Inkwell first told its story, for its keepsake (lib/keepsakes inkwellStamp): on this device, as first steps' day is. */
const STORY_KEY = 'nib-inkwell-story'
let unstoredStory: string | null = null

function readStory(): string | null {
  try {
    const kept = localStorage.getItem(STORY_KEY)
    return kept && /^\d{4}-\d\d-\d\d$/.test(kept) ? kept : null
  } catch {
    return unstoredStory
  }
}

/** The day Inkwell's keepsake was kept, or null. */
export const useInkwellStory = () => useSyncExternalStore(subscribe, readStory)

/** Kept on `day`, the first time it tells its story: whether it was this time. */
export function keepInkwell(day: string): boolean {
  if (readStory()) return false
  unstoredStory = day
  try {
    localStorage.setItem(STORY_KEY, day)
  } catch {
    // Storage off: it lasts for this session.
  }
  listeners.forEach((listener) => listener())
  return true
}
