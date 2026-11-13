import { useCallback, useState } from 'react'

/** What Nib says in more than one place, written once. */
export const CANT_SAVE = 'Can’t save to this device'
export const CANT_REACH = 'Couldn’t reach Nib. Check your connection and try again.'
export const COPY_KEPT = 'A locked note was edited on two devices. The other edit is kept as a separate locked note.'
export const NOTE_IN_TRASH = 'That note is in the trash.'
export const NOTE_DELETED = 'That note was deleted.'

/** A notice's one thing to do, beside Dismiss. */
export type NoticeAction = { label: string; run: () => void }

/**
 * What's being said to the writer, as words. The editor's notice can have
 * something to do beside Dismiss (Keep the picture). Held with its words and
 * its document, so another notice in its place, or another document, shows
 * without it.
 */
export type Notice = { text: string; action?: NoticeAction; /** Whose action it is, if it's only for one document. */ docKey?: string }

/** The one notice up, if any. Most of Nib has only words to say, so `setNotice` takes those as they are. It's steady, as a state setter is: effects depend on it (lib/plus). */
export function useNotice() {
  const [notice, set] = useState<Notice | null>(null)
  const setNotice = useCallback((next: string | Notice | null) => set(typeof next === 'string' ? { text: next } : next), [])
  return [notice, setNotice] as const
}
