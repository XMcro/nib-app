import { useEffect, useMemo, useRef } from 'react'
import type { JSONContent } from '@tiptap/react'
import type { Item, Kind } from '../db/db'
import * as items from '../db/items'
import { count } from './counts'
import { DAILY } from './dailyReminder'
import { drainInbox, inbox, linkAction, shareTargets } from './inbox'
import { startKeyboard } from './keyboard'
import { coveredNow, coverOpenVault } from './lock'
import { startMirror } from './mirror'
import { NOTE_DELETED, NOTE_IN_TRASH } from './notices'
import { nativeApp, touchApp } from './platform'
import { reminderPlugin } from './reminders'
import type { OpenDocument } from './useOpenDocument'

/** What runs from launch and draws nothing: nib:// links and reminder taps, the inbox, the file copy, the keyboard, the vault's cover. */
export function useLaunchServices({ session, libraryRead, documents, addToOpen, plus, plusKnown, changeKind, hideListOverText, open, setNotice }: {
  session: OpenDocument
  /** The first cards are on their way to the screen. */
  libraryRead: boolean
  /** Every note and page in the library, not the archive's or the trash's. */
  documents: Item[]
  /** Blocks put at the end of the document open in the editor, if `id` is that one (lib/inbox `drainInbox`). */
  addToOpen: (id: string, content: JSONContent[]) => boolean
  /** Nib Plus's features are open: told to the share sheet, which takes other files than pictures only with them. */
  plus: boolean
  /** Whether the App Store has said yet. Until it has, `plus` is only not known to be on. */
  plusKnown: boolean
  changeKind: (next: Kind) => void
  hideListOverText: () => void
  /** A document opened, the library put away. */
  open: (id: string) => void
  setNotice: (notice: string) => void
}) {
  const { typeInDraft } = session

  /** nib://new-note and nib://new-page, from a widget or Shortcuts. */
  async function openLink(url: string) {
    const action = linkAction(url)
    if (!action) return
    count(action === 'new-page' ? 'page_new' : 'note_new')
    changeKind(action === 'new-page' ? 'page' : 'note')
    hideListOverText()
    // Not over Lock Nib's cover: the keyboard would sit above it. Once
    // unlocked, the new note is there to tap into.
    if (nativeApp && (await coveredNow())) return
    typeInDraft()
  }

  /** A reminder was tapped. Read from the database: on a launch, the lists may not have loaded yet. */
  async function openReminded(id: string) {
    // The daily reminder (lib/dailyReminder) is for no note in particular: Nib opening is enough.
    if (id.startsWith(DAILY)) return
    const item = await items.get(id).catch(() => undefined)
    if (!item) return setNotice(NOTE_DELETED)
    if (item.deletedAt !== undefined) return setNotice(NOTE_IN_TRASH)
    open(id)
  }

  const latest = useRef({ openLink, openReminded, addToOpen })
  latest.current = { openLink, openReminded, addToOpen }

  // The vault's notes kept out of the app switcher's snapshot (lib/lock).
  useEffect(() => (nativeApp ? coverOpenVault() : undefined), [])

  // The keyboard on iPhone and iPad, which the formatting bar rides on.
  useEffect(() => (touchApp ? startKeyboard() : undefined), [])

  // Quick capture: the share sheet and Shortcuts leave captures in the inbox,
  // which empties into notes on launch and whenever Nib comes back to the
  // front. A failure leaves them waiting for next time, so it is only logged.
  // And again once Plus is known, for what waited on it (lib/inbox).
  useEffect(() => {
    if (!nativeApp) return
    const drain = () => void drainInbox((id, content) => latest.current.addToOpen(id, content), plusKnown).catch((error: unknown) => console.warn('Nib: could not empty the inbox', error))
    const onVisible = () => document.visibilityState === 'visible' && drain()
    drain()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [plusKnown])

  useEffect(() => {
    if (!nativeApp) return
    // Caught: where the plugin is missing (tests, a browser) the listener rejects.
    const listener = inbox.addListener('openUrl', ({ url }) => void latest.current.openLink(url)).catch(() => null)
    const reminded = reminderPlugin.addListener('open', ({ id }) => void latest.current.openReminded(id)).catch(() => null)
    return () => {
      void listener.then((handle) => handle?.remove())
      void reminded.then((handle) => handle?.remove())
    }
  }, [])

  // What the share sheet may offer to add to (lib/inbox `shareTargets`): told to it whenever the ten change, a
  // note locked among them leaving at once; and as Nib leaves the front or comes back, for Lock Nib turned off since.
  const targets = useMemo(() => JSON.stringify(shareTargets(documents)), [documents])
  useEffect(() => {
    if (!nativeApp || !libraryRead) return
    // Asked for inside the promise: where the inbox is stood in for without it (tests), that's a warning and not the app down.
    const send = () => void Promise.resolve().then(() => inbox.targets({ targets: JSON.parse(targets) })).catch((error: unknown) => console.warn('Nib: could not tell the share sheet its notes', error))
    send()
    document.addEventListener('visibilitychange', send)
    return () => document.removeEventListener('visibilitychange', send)
  }, [targets, libraryRead])

  // Not before it's known: every launch would tell the sheet there was no Plus for a moment.
  useEffect(() => {
    if (!nativeApp || !plusKnown) return
    void Promise.resolve()
      .then(() => inbox.plus({ active: plus }))
      .catch((error: unknown) => console.warn('Nib: could not tell the share sheet of Plus', error))
  }, [plus, plusKnown])

  // An earlier Nib kept edits a lock beat in the clear until the vault opened.
  useEffect(() => {
    items.boxCopiesOnce().catch((error: unknown) => console.warn('Nib: could not box the copies', error))
  }, [])

  // In the iOS app, every change is also kept in a file iOS will not clear
  // (see lib/mirror). The database write already succeeded, so a failure here
  // is a notice, not "Can't save to this device".
  useEffect(() => {
    if (!nativeApp || !libraryRead) return
    return startMirror((error) => {
      console.error('Nib: could not update the app’s file copy', error)
      setNotice('Couldn’t update the backup copy in the app’s files. Your writing is still saved.')
    })
  }, [libraryRead])
}
