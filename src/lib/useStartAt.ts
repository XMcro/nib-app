import { useEffect, useEffectEvent, useRef } from 'react'
import type { Kind } from '../db/db'
import { sameName, type Library, type Place } from './folders'
import { keepLeftAt, leftAt, type Start } from './startAt'

/**
 * Nib opening where it was asked to (lib/startAt), once: when the library has
 * been read, so what's gone since is known, and with Plus, as tabs come back
 * (components/useTabs). Not over something opened or chosen before then. And
 * what's on screen kept, for the next time, while Nib is to open where it was left.
 */
export function useStartAt({ start, ready, features, untouched, has, library, changeKind, setPlace, open, onScreen }: {
  start: Start
  /** The library has been read. */
  ready: boolean
  features: boolean
  /** Nothing has been opened, begun or chosen yet: Nib is as it launched. */
  untouched: () => boolean
  /** Whether a document is there to open: not gone, and not in the trash. */
  has: (id: string) => boolean
  library: Library
  changeKind: (next: Kind) => void
  setPlace: (place: Place) => void
  /** A document opened, the library put away. */
  open: (id: string) => void
  /** The document on screen now, or null: the library, or a draft not yet saved. */
  onScreen: string | null
}) {
  const begun = useRef(false)
  const begin = useEffectEvent(() => {
    if (!untouched()) return
    if (start.on === 'pages') changeKind('page')
    const folder = start.folder === null ? undefined : library.folders.find((known) => sameName(known.name, start.folder!))
    if (folder) setPlace({ folder: folder.name })
    // Kept only while Nib is to open where it was left (lib/startAt): there to read is asked for.
    const left = leftAt()
    if (left !== null && has(left)) open(left)
  })
  useEffect(() => {
    if (begun.current || !ready || !features) return
    begun.current = true
    begin()
  }, [ready, features])

  // From once Nib has opened where it was to: before that, nothing on screen yet would be kept over what was left.
  useEffect(() => {
    if (begun.current && features) keepLeftAt(onScreen)
  }, [onScreen, features, start.on])
}
