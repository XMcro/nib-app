import { useState } from 'react'
import type { JSONContent } from '@tiptap/react'
import type { Revision } from '../db/db'
import { FREE_DAYS } from '../db/revisions'
import { describeLength } from '../lib/stats'
import { plainText } from '../lib/text'
import { relativeTime } from '../lib/time'
import { Comparison } from './Comparison'

/**
 * A document's versions, newest first. Without Nib Plus it reaches back
 * FREE_DAYS; the older ones are kept, counted at the end, and show with Plus.
 * One opened is compared with the text as it is now, with Plus; without it,
 * it's shown as it was, to read and restore whole.
 */

const COMPARE_PLUS = 'Comparing a version with the text as it is now, and bringing back one paragraph of it, are part of Nib Plus. Reading an earlier version and restoring it whole are free.'

export function HistoryPanel({
  revisions,
  times = revisions.map((revision) => revision.createdAt),
  onMore,
  now,
  keepsAll,
  onBack,
  onRestore,
  onBringBack,
  onPlus,
  compares,
  readOnly,
}: {
  /** The newest, as many as have been read: the rest are read as the list is scrolled to its end (lib/useHistory). */
  revisions: Revision[]
  /** When every version was made, newest first. */
  times?: number[]
  /** The list has been scrolled to the end of those read. */
  onMore?: () => void
  /** The document's text as stored, which a version is compared with. The newest version, if not given. */
  now?: JSONContent
  keepsAll: boolean
  onBack: () => void
  onRestore: (revision: Revision) => void
  /** One paragraph of `revision` brought back: the text to store, worked out from `basis`, the text it was compared with. */
  onBringBack: (revision: Revision, basis: JSONContent, body: JSONContent) => void
  /** The older ones asked for: Plus, saying why. */
  onPlus: (reason: string) => void
  /** Plus's features are open: a version opened is compared with now. */
  compares: boolean
  readOnly?: boolean
}) {
  const [comparing, setComparing] = useState<string | null>(null)
  // The newest is the text on screen, however old: it always shows.
  const since = keepsAll ? -Infinity : Date.now() - FREE_DAYS * 86_400_000
  const shown = revisions.filter((revision, index) => index === 0 || revision.createdAt >= since)
  const within = times.filter((at, index) => index === 0 || at >= since).length
  const older = times.length - within
  const compared = shown.find((revision, index) => index > 0 && revision.id === comparing)

  if (compared) {
    const basis = now ?? revisions[0].body
    return (
      <Comparison
        then={compared.body}
        now={basis}
        at={compared.createdAt}
        onBack={() => setComparing(null)}
        onRestore={() => onRestore(compared)}
        onBringBack={(body) => onBringBack(compared, basis, body)}
        readOnly={readOnly}
        plain={!compares}
        onPlus={() => onPlus(COMPARE_PLUS)}
      />
    )
  }

  return (
    <div
      onScroll={(event) => {
        const box = event.currentTarget
        if (revisions.length < within && box.scrollHeight - box.scrollTop - box.clientHeight < 600) onMore?.()
      }}
      className="nib-swap flex flex-1 flex-col overflow-y-auto"
    >
      <div className="flex items-center justify-between px-4 pb-2">
        <button onClick={onBack} className="nib-tap cursor-pointer text-[11px] text-muted hover:text-ink">
          ← Back
        </button>
        <span className="text-[11px] text-faint">History</span>
      </div>

      {revisions.length === 0 ? (
        <div className="px-4 py-[22px] text-[12px] text-muted">
          No earlier versions yet.
        </div>
      ) : (
        <div className="flex flex-col gap-px px-2">
          <ol aria-label="Versions" className="flex flex-col gap-px">
            {shown.map((revision, index) => {
              const when = (
                <>
                  <div className="text-[13px] leading-[1.35]">{index === 0 ? 'Current' : relativeTime(revision.createdAt)}</div>
                  <div className="mt-[3px] text-[11px] text-muted">{describeLength(plainText(revision.body))}</div>
                </>
              )
              return (
                <li key={revision.id} className="shrink-0">
                  {/* The text on screen: nothing to compare it with. */}
                  {index === 0 ? (
                    <div className="px-2 py-[9px]">{when}</div>
                  ) : (
                    <button
                      onClick={() => setComparing(revision.id)}
                      className="block w-full cursor-pointer rounded-md px-2 py-[9px] text-left hover:bg-item-hover"
                    >
                      {when}
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
          {older > 0 && (
            <button
              onClick={() =>
                onPlus(`${older} older ${older === 1 ? 'version is' : 'versions are'} kept. Nib Plus shows every version, not just the last ${FREE_DAYS} days.`)
              }
              className="nib-tap flex shrink-0 cursor-pointer justify-between gap-3 rounded-md px-2 py-[9px] text-left text-[11px] text-muted hover:bg-item-hover"
            >
              <span>
                {older} older {older === 1 ? 'version' : 'versions'}, from before the last {FREE_DAYS} days
              </span>
              <span className="shrink-0">Plus ›</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
