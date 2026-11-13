import { useRef, useState, type CSSProperties } from 'react'
import type { Item } from '../db/db'
import { motion } from '../lib/motion'
import { relativeTime } from '../lib/time'
import { shownTitle } from '../lib/vault'

// At Motion's Full: a note lifted out of the trash, one shredded, and the
// wait between rows shredded one after another by Empty trash.
const RESTORE_MS = 520
const SHRED_MS = 760
const CASCADE_MS = 80
/** How many rows Empty trash shreds; any more fade. */
const SHREDDED = 12
/** How many strips a note is shredded into. */
const STRIPS = 9

/** A row's space closing, once what was in it is going, so the rows after it rise. */
function closeUp(row: HTMLElement, ms: number, delay: number) {
  const { paddingTop, paddingBottom } = getComputedStyle(row)
  return row.animate(
    [
      { height: `${row.offsetHeight}px`, paddingTop, paddingBottom },
      { height: '0px', paddingTop: '0px', paddingBottom: '0px' },
    ],
    { duration: ms, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
  )
}

/**
 * Restored: a little dip, then up and out of the trash in a wash of the
 * accent, back to the library. Eased frame by frame: one easing over the lot
 * raced through the rise before it could be seen.
 */
function liftOut(row: HTMLElement, ms: number): Promise<unknown> {
  const wash = 'color-mix(in srgb, var(--color-accent) 16%, transparent)'
  row.animate(
    [
      { transform: 'none', opacity: 1, backgroundColor: 'transparent', easing: 'ease-out' },
      { transform: 'translateY(3px) scale(0.99)', opacity: 1, backgroundColor: wash, offset: 0.12, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
      { transform: 'translateY(-26px) scale(1.04)', opacity: 0, backgroundColor: wash, offset: 0.7 },
      { transform: 'translateY(-26px) scale(1.04)', opacity: 0, backgroundColor: wash },
    ],
    { duration: ms, fill: 'forwards' },
  )
  return closeUp(row, ms * 0.5, ms * 0.45).finished
}

/**
 * Deleted for good: the row as a sheet of paper, cut into strips that come
 * apart and fall away, turning as they go, while its space closes. The strips
 * are copies on a layer over the page, which the list would clip. After
 * `delay`, for Empty trash's rows one after another.
 */
function shred(row: HTMLElement, ms: number, delay: number): Promise<unknown> {
  const box = row.getBoundingClientRect()
  const layer = document.createElement('div')
  layer.className = 'nib-shreds'
  layer.setAttribute('aria-hidden', 'true')
  Object.assign(layer.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` })
  const cuts = Array.from({ length: STRIPS }, (_, i) => {
    const strip = row.cloneNode(true) as HTMLElement
    strip.className = `${strip.className} nib-strip`
    strip.removeAttribute('style')
    strip.style.clipPath = `inset(0 ${100 - ((i + 1) * 100) / STRIPS}% 0 ${(i * 100) / STRIPS}%)`
    layer.append(strip)
    return strip
  })
  document.body.append(layer)
  row.animate([{ visibility: 'hidden' }, { visibility: 'hidden' }], { duration: ms + delay, fill: 'forwards' })
  const falls = cuts.map((strip, i) => {
    // Each its own way, but the same each time: no randomness to test around.
    const spread = (i - (STRIPS - 1) / 2) * 2
    const spin = ((i * 37) % 23) - 11
    const fall = 70 + ((i * 29) % 45)
    return strip.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${spread}px, 5px)`, opacity: 1, offset: 0.22 },
        { transform: `translate(${spread * 3}px, ${fall}px) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: ms, delay: delay + (i % 3) * 40, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' },
    ).finished
  })
  const closing = closeUp(row, ms * 0.45, delay + ms * 0.35).finished
  return Promise.all([...falls, closing]).finally(() => layer.remove())
}

export function TrashList({
  items,
  onBack,
  onRestore,
  onPurge,
  onPurgeAll,
}: {
  items: Item[]
  onBack: () => void
  onRestore: (id: string) => void
  onPurge: (id: string) => void
  onPurgeAll: () => void
}) {
  // Purging is the one irreversible action left, so it is always two-step.
  const [confirming, setConfirming] = useState<string | null>(null)

  // Each going row's animation first (above), then what it does. Not at all
  // with Motion at None or where there's nothing to animate with (jsdom).
  const rows = useRef(new Map<string, HTMLElement>())
  const going = useRef(new Set<string>())
  function animated(ids: string[], animate: (row: HTMLElement, ms: number, index: number) => Promise<unknown>, ms: number, act: () => void) {
    const scaled = ms * motion()
    const els = ids.map((id) => rows.current.get(id)).filter((row): row is HTMLElement => row !== undefined)
    if (ids.some((id) => going.current.has(id))) return
    if (!scaled || els.length === 0 || typeof els[0].animate !== 'function') return act()
    ids.forEach((id) => going.current.add(id))
    void Promise.all(els.map((row, index) => animate(row, scaled, index))).then(() => {
      act()
      ids.forEach((id) => going.current.delete(id))
      // Still here a moment later, refused: back they come.
      window.setTimeout(() => {
        for (const row of els) row.getAnimations().forEach((animation) => animation.cancel())
      }, 1000)
    })
  }
  const restore = (id: string) => animated([id], liftOut, RESTORE_MS, () => onRestore(id))
  const purge = (id: string) => animated([id], (row, ms) => shred(row, ms, 0), SHRED_MS, () => onPurge(id))
  // The first dozen shredded in turn; any more simply fade as the last goes.
  const purgeAll = () =>
    animated(
      items.map((item) => item.id),
      (row, ms, index) =>
        index < SHREDDED
          ? shred(row, ms, index * CASCADE_MS * motion())
          : row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.4, delay: SHREDDED * CASCADE_MS * motion(), fill: 'forwards' }).finished,
      SHRED_MS,
      onPurgeAll,
    )

  return (
    <div className="nib-swap flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 pb-2">
        <button
          onClick={onBack}
          className="nib-tap cursor-pointer text-[11px] text-muted hover:text-ink"
        >
          ← Back
        </button>
        {items.length > 0 && (
          <button
            onClick={() => (confirming === 'all' ? purgeAll() : setConfirming('all'))}
            onBlur={() => setConfirming(null)}
            className={`nib-tap cursor-pointer text-[11px] ${
              confirming === 'all' ? 'font-medium text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {confirming === 'all' ? 'Empty for good?' : 'Empty trash'}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-[22px] text-[12px] text-muted">
          Trash is empty.
        </div>
      ) : (
        <div className="flex flex-col gap-px px-2">
          {items.map((item, index) => {
            const armed = confirming === item.id
            return (
              // Tumbling in, each in turn (index.css), once (data-arrived).
              <div
                key={item.id}
                ref={(row) => {
                  if (row) rows.current.set(item.id, row)
                  else rows.current.delete(item.id)
                }}
                onMouseLeave={() => armed && setConfirming(null)}
                onAnimationEnd={(event) => {
                  if (event.target === event.currentTarget) event.currentTarget.dataset.arrived = ''
                }}
                style={{ '--i': index } as CSSProperties}
                className="nib-trash-row group shrink-0 overflow-hidden rounded-md px-2 py-[9px] hover:bg-item-hover"
              >
                <div className="truncate text-[13px] leading-[1.35] text-muted">
                  {shownTitle(item)}
                </div>
                <div className="mt-[3px] flex items-center gap-2 text-[11px] text-muted">
                  <span>{item.kind === 'note' ? 'Note' : 'Page'}</span>
                  <span aria-hidden>·</span>
                  <span>{relativeTime(item.deletedAt ?? item.updatedAt)}</span>
                  <span className="flex-1" />
                  <button
                    onClick={() => restore(item.id)}
                    className="nib-tap cursor-pointer opacity-0 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 pointer-coarse:opacity-100"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => (armed ? purge(item.id) : setConfirming(item.id))}
                    onBlur={() => setConfirming(null)}
                    className={`nib-tap cursor-pointer ${
                      armed
                        ? 'font-medium text-ink opacity-100'
                        : 'opacity-0 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 pointer-coarse:opacity-100'
                    }`}
                  >
                    {armed ? 'Delete for good?' : 'Delete'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
