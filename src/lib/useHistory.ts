import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { JSONContent } from '@tiptap/react'
import type { Revision } from '../db/db'
import * as items from '../db/items'
import * as revisionStore from '../db/revisions'
import { useCounted } from './counts'
import type { OpenDocument } from './useOpenDocument'

const OTHER_NOTE = 'That version is of another note.'
/** Versions read at a time: a long page's whole history, read at once, can be most of a gigabyte. */
const PAGE = 40

/** Version history (components/HistoryPanel): its versions, read while it's up, and the two ways one comes back. */
export function useHistory({ viewing, close, session, setNotice }: {
  viewing: boolean
  close: () => void
  session: OpenDocument
  setNotice: (notice: string) => void
}) {
  const { activeId, whenSaved, guarded, putBack } = session
  useCounted(viewing, 'history_opened')
  // Read only while History is up: every save writes a version, and this would
  // read them all back, bodies and all, as the writer types. Null, not empty,
  // while closed, so History never opens on "no earlier versions" for a moment.
  // A page at a time, the first and more as the list is scrolled to its end.
  const [reach, setReach] = useState(PAGE)
  if (!viewing && reach !== PAGE) setReach(PAGE)
  const versions = useLiveQuery(
    () => (viewing && activeId ? revisionStore.latest(activeId, reach) : null),
    [viewing, activeId, reach],
  )
  const times = useLiveQuery(
    () => (viewing && activeId ? revisionStore.times(activeId) : null),
    [viewing, activeId],
  )

  async function restore(revision: Revision) {
    await whenSaved(async (id) => {
      // Only into its own note: History can still list the last note's versions
      // for a moment after another is opened.
      if (revision.itemId !== id) return setNotice(OTHER_NOTE)
      await guarded(async () => {
        await putBack(id, await items.get(id), revision.body)
        close()
      })
    })
  }

  // One paragraph of an earlier version back into the text (History's
  // comparison), kept in History as a restore is: the text it replaces is
  // stored as a version first. History stays open, for the next one.
  async function bringBack(revision: Revision, basis: JSONContent, body: JSONContent) {
    await whenSaved(async (id) => {
      if (revision.itemId !== id) return setNotice(OTHER_NOTE)
      await guarded(async () => {
        const current = await items.get(id)
        // Worked out from the text compared; if that has changed since, it would undo the change.
        if (!current || JSON.stringify(current.body) !== JSON.stringify(basis)) return setNotice('The text changed just then. Try again.')
        await putBack(id, current, body)
        setNotice('Brought back. The text before is kept in History.')
      })
    })
  }

  return { versions, times: times ?? undefined, showMore: () => setReach((now) => now + PAGE), restore, bringBack }
}
