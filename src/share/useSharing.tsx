import { useEffect, useState } from 'react'
import { ShareDialog } from '../components/ShareDialog'
import type { Item, ShareRef } from '../db/db'
import * as items from '../db/items'
import { useCounted } from '../lib/counts'
import { CANT_REACH } from '../lib/notices'
import { nativeApp } from '../lib/platform'
import type { OpenDocument } from '../lib/useOpenDocument'
import * as vault from '../lib/vault'
import { freeShareHolder, liveShare, reportRenewal, revokeShare, stopSharingQuestion } from './index'
import { nameOf } from '../lib/fountain'

/** Share a draft (components/ShareDialog): the dialog and how it's wired, its rows in the palette, a renewal told to the server, and taking a locked note's share down. */
export function useSharing({ session, setNotice, activeItem, documents, subscribed, jws, askPlus, openNotes }: {
  session: OpenDocument
  setNotice: (notice: string) => void
  activeItem: Item | undefined
  /** Every document, trash too. */
  documents: Item[]
  subscribed: boolean
  jws: string | undefined
  askPlus: (reason: string) => void
  /** Readers' notes on the open document's share, in the library. */
  openNotes: () => void
}) {
  const { guarded, setSharedLocked } = session
  const [sharing, setSharing] = useState(false)
  useCounted(sharing, 'share_opened')

  // A share is paid for by the subscription that made it, and the server only
  // hears about a renewal when a device tells it, as with sync.
  const sharesLive = documents.some((item) => liveShare(item))
  useEffect(() => {
    if (!nativeApp || !subscribed || !jws || !sharesLive) return
    reportRenewal(jws).catch((error: unknown) => console.warn('Nib: could not report the renewal for shared drafts', error))
  }, [subscribed, jws, sharesLive])

  /** Takes a locked note's shared draft down, as Share a draft's "Stop sharing" does. */
  async function stopLocked(id: string) {
    const item = await items.get(id)
    const live = liveShare(item)
    if (!item || !live) return setSharedLocked(null)
    if (!confirm(stopSharingQuestion(live))) return
    try {
      await revokeShare(live)
    } catch {
      return setNotice(CANT_REACH)
    }
    await guarded(() => items.setShares(id, (item.shares ?? []).filter((share) => share.slug !== live.slug)))
    setSharedLocked(null)
  }

  return {
    stopLocked,
    dialog: sharing && activeItem && (
      <ShareDialog
        item={activeItem}
        subscribed={subscribed}
        jws={subscribed ? jws : undefined}
        freeHolder={(() => {
          // Trash too: a trashed document's link still serves until it's deleted for good.
          const holder = freeShareHolder(documents)
          return holder && holder.id !== activeItem.id ? nameOf(holder) : undefined
        })()}
        onShares={(shares: ShareRef[]) => void guarded(() => items.setShares(activeItem.id, shares))}
        onOpenNotes={() => {
          setSharing(false)
          openNotes()
        }}
        onPlus={(reason) => {
          setSharing(false)
          askPlus(reason)
        }}
        onClose={() => setSharing(false)}
      />
    ),
    /** Its rows in the palette. */
    commands: () => {
      // Free: one read-only link at a time. Plus: notes, a password, longer and more.
      if (!nativeApp || !activeItem || vault.isLocked(activeItem)) return []
      const live = liveShare(activeItem)
      return [
        { id: 'share-draft', label: 'Share a draft…', run: () => setSharing(true) },
        ...(live && !live.free ? [{ id: 'reader-notes', label: 'Notes from readers', run: openNotes }] : []),
      ]
    },
  }
}
