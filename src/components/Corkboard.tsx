import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import type { Item } from '../db/db'
import { moveChapter, progressOf, STATUSES, statusOf, type Part, type Status } from '../lib/manuscript'
import { countWords } from '../lib/stats'
import { plainText, SUMMARY_MAX } from '../lib/text'
import { isLocked, shownTitle } from '../lib/vault'

const NAMES: Record<Status, string> = { draft: 'Draft', revised: 'Revised', done: 'Done' }
const next = (status: Status) => STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length]
const words = (n: number) => `${n.toLocaleString()} word${n === 1 ? '' : 's'}`

/** How close to the panel's top or bottom a card in hand has to come for it to scroll, and how fast, as the list's chapters. */
const EDGE = 48
const SCROLL = 8

/**
 * A book's chapters as index cards, the Manuscript's Cards (Nib Plus): each
 * with its title, its one-line summary, its words and its status (lib/manuscript),
 * the summary written on the card and the status changed by pressing it. A card
 * moves by its handle, dragged across the board or with the arrow keys, within
 * its part, as a chapter does in the list. Above them, the book's progress by status.
 */
export function Corkboard({ parts, scroller, onOpen, onMove, onSummary, onStatus }: {
  parts: Part[]
  /** What the Manuscript scrolls in, for a card held near its top or bottom. */
  scroller: RefObject<HTMLDivElement | null>
  onOpen: (id: string) => void
  onMove: (places: { id: string; position: number }[]) => void
  onSummary: (id: string, summary: string | null) => void
  onStatus: (id: string, status: Status) => void
}) {
  const chapters = parts.flatMap((part) => part.chapters)
  const progress = progressOf(chapters)
  const said = [progress.done && `${progress.done} done`, progress.revised && `${progress.revised} revised`, progress.draft && `${progress.draft} ${progress.draft === 1 ? 'draft' : 'drafts'}`].filter(Boolean).join(' · ')
  const share = (n: number) => `${(100 * n) / chapters.length}%`
  return (
    <div className="pb-6 phone:pb-24">
      <div className="px-4 pb-1">
        <div role="img" aria-label={`Progress: ${said}`} className="flex h-[5px] overflow-hidden rounded-full bg-line">
          <span className="bg-ink" style={{ width: share(progress.done) }} />
          <span className="bg-ink/40" style={{ width: share(progress.revised) }} />
        </div>
        <p aria-hidden className="mt-1 text-[11px] text-muted">{said}</p>
      </div>
      {parts.map((part, index) => (
        <Fragment key={part.folder}>
          {part.name !== null && <h3 className="px-4 pt-4 pb-1 text-[11px] font-medium text-muted">{part.name}</h3>}
          <Cards
            name={part.name}
            chapters={part.chapters}
            before={parts.slice(0, index).reduce((sum, earlier) => sum + earlier.chapters.length, 0)}
            scroller={scroller}
            onOpen={onOpen}
            onMove={onMove}
            onSummary={onSummary}
            onStatus={onStatus}
          />
        </Fragment>
      ))}
    </div>
  )
}

/**
 * `order` with `id` where (x, y) is among the others, by their cards in `board`
 * as they're laid out now: after each whose middle it's past, reading along the
 * rows, and before the rest (components/chipDrag, for folders).
 */
function placed(board: HTMLElement, id: string, order: string[], x: number, y: number): string[] {
  const others = order.filter((one) => one !== id)
  const before = others.filter((one) => {
    const box = board.querySelector(`[data-card="${CSS.escape(one)}"]`)?.getBoundingClientRect()
    return box !== undefined && (y > box.bottom || (y >= box.top && x > box.left + box.width / 2))
  }).length
  return [...others.slice(0, before), id, ...others.slice(before)]
}

/** One part's cards, or the book's own: the board, and a card moved on it. `before`: how many chapters come before these in the book. */
function Cards({ name, chapters, before, scroller, onOpen, onMove, onSummary, onStatus }: {
  name: string | null
  chapters: Item[]
  before: number
  scroller: RefObject<HTMLDivElement | null>
  onOpen: (id: string) => void
  onMove: (places: { id: string; position: number }[]) => void
  onSummary: (id: string, summary: string | null) => void
  onStatus: (id: string, status: Status) => void
}) {
  // A move shown before it's stored and comes back, as the list's (ManuscriptPanel Chapters).
  const ids = chapters.map((item) => item.id).join()
  const [moved, setMoved] = useState<{ over: string; order: string[] } | null>(null)
  if (moved && moved.over !== ids) setMoved(null)
  const byId = new Map(chapters.map((item) => [item.id, item]))
  const order = moved && moved.over === ids ? moved.order.map((id) => byId.get(id)!) : chapters

  // The card in hand, and the order it has the board in as it goes.
  const [held, setHeld] = useState<{ id: string; order: string[] } | null>(null)
  const board = useRef<HTMLOListElement>(null)
  const refocus = useRef<string | null>(null)
  useEffect(() => {
    if (!refocus.current) return
    board.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(refocus.current)}"] [data-handle]`)?.focus()
    refocus.current = null
  })

  function move(from: number, to: number) {
    const places = moveChapter(order, from, to)
    if (places.length === 0) return
    const next = order.map((item) => item.id)
    next.splice(to, 0, ...next.splice(from, 1))
    setMoved({ over: ids, order: next })
    onMove(places)
  }

  function grab(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || !board.current) return
    event.preventDefault()
    let now = order.map((item) => item.id)
    setHeld({ id, order: now })
    let x = event.clientX
    let y = event.clientY
    let speed = 0
    let frame = 0
    const place = () => {
      const next = placed(board.current!, id, now, x, y)
      if (next.join() === now.join()) return
      now = next
      setHeld({ id, order: now })
    }
    // Near the top or bottom, the panel scrolls on, for a book longer than the screen.
    const roll = () => {
      frame = 0
      if (!speed || !scroller.current) return
      scroller.current.scrollTop += speed
      place()
      frame = requestAnimationFrame(roll)
    }
    const follow = (moving: globalThis.PointerEvent) => {
      x = moving.clientX
      y = moving.clientY
      place()
      const box = scroller.current?.getBoundingClientRect()
      speed = !box ? 0 : y < box.top + EDGE ? -SCROLL : y > box.bottom - EDGE ? SCROLL : 0
      if (speed && !frame) frame = requestAnimationFrame(roll)
    }
    const end = (ending: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', follow)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      cancelAnimationFrame(frame)
      setHeld(null)
      // Still one of these: trashed or moved out on another device while in hand, it's put nowhere.
      if (ending.type === 'pointerup' && byId.has(id)) move(order.findIndex((item) => item.id === id), now.indexOf(id))
    }
    window.addEventListener('pointermove', follow)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  function nudge(event: KeyboardEvent<HTMLButtonElement>, from: number) {
    const to = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? from - 1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? from + 1 : null
    if (to === null) return
    event.preventDefault()
    if (to < 0 || to >= order.length) return
    refocus.current = order[from].id
    move(from, to)
  }

  const shown = held ? held.order.map((id) => byId.get(id)).filter((item) => item !== undefined) : order

  return (
    <ol ref={board} aria-label={name === null ? 'Chapter cards' : `Chapter cards of ${name}`} className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2 px-3 select-none">
      {shown.map((item, index) => {
        const at = order.indexOf(item)
        return (
          <Card
            key={item.id}
            item={item}
            number={before + index + 1}
            held={held?.id === item.id}
            first={at === 0}
            last={at === order.length - 1}
            onGrab={(event) => grab(event, item.id)}
            onNudge={(event) => nudge(event, at)}
            onMove={(by) => move(at, at + by)}
            onOpen={() => onOpen(item.id)}
            onSummary={(summary) => onSummary(item.id, summary)}
            onStatus={(status) => onStatus(item.id, status)}
          />
        )
      })}
    </ol>
  )
}

/** A chapter's index card: its handle and number, its status, its title to open it by, its summary to write, and its words. */
function Card({ item, number, held, first, last, onGrab, onNudge, onMove, onOpen, onSummary, onStatus }: {
  item: Item
  number: number
  held: boolean
  first: boolean
  last: boolean
  onGrab: (event: PointerEvent<HTMLButtonElement>) => void
  onNudge: (event: KeyboardEvent<HTMLButtonElement>) => void
  onMove: (by: -1 | 1) => void
  onOpen: () => void
  onSummary: (summary: string | null) => void
  onStatus: (status: Status) => void
}) {
  const title = shownTitle(item)
  const locked = isLocked(item)
  return (
    <li
      data-card={item.id}
      data-held={held || undefined}
      className="flex min-h-[136px] flex-col rounded-md border border-line bg-paper p-2 shadow-[0_1px_2px_rgba(0,0,0,0.06)] data-held:z-10 data-held:shadow-[0_8px_20px_rgba(0,0,0,0.18)]"
    >
      <div className="flex items-center gap-1">
        <button
          data-handle
          aria-label={`Move ${title}`}
          onPointerDown={onGrab}
          onKeyDown={onNudge}
          className="nib-tap -m-1 flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-faint hover:text-muted active:cursor-grabbing"
        >
          <Grip />
        </button>
        {/* For VoiceOver, which can't drag or press an arrow key. Off the Tab order: the handle has the arrow keys. */}
        {!first && (
          <button tabIndex={-1} onClick={() => onMove(-1)} className="sr-only">
            {title}, move earlier
          </button>
        )}
        {!last && (
          <button tabIndex={-1} onClick={() => onMove(1)} className="sr-only">
            {title}, move later
          </button>
        )}
        <span className="flex-1 text-[11px] text-faint tabular-nums">{number}</span>
        <StatusChip item={item} onStatus={onStatus} />
      </div>
      <button onClick={onOpen} className="mt-1.5 line-clamp-2 cursor-pointer text-left text-[13px] leading-[1.3] font-medium hover:underline">
        {title}
      </button>
      {/* A locked chapter has no summary: its words below say Locked. */}
      <div className="mt-1 flex-1">{!locked && <Summary item={item} lines={3} onSummary={onSummary} />}</div>
      <p className="mt-1.5 text-[11px] text-muted tabular-nums">{locked ? 'Locked' : words(countWords(plainText(item.body)))}</p>
    </li>
  )
}

/** A chapter's status (lib/manuscript), pressed to change it: Draft, Revised, Done, and round again. On a card, and in the Manuscript's list. */
export function StatusChip({ item, onStatus }: { item: Item; onStatus: (status: Status) => void }) {
  const status = statusOf(item)
  return (
    <button
      onClick={() => onStatus(next(status))}
      aria-label={`${NAMES[status]}: the status of ${shownTitle(item)}. Change it`}
      data-status={status}
      className="nib-tap shrink-0 cursor-pointer rounded-full border border-line px-1.5 py-px text-[10.5px] text-muted data-[status=done]:border-ink data-[status=done]:bg-ink data-[status=done]:text-paper data-[status=revised]:bg-ink/10 data-[status=revised]:text-ink"
    >
      {NAMES[status]}
    </button>
  )
}

/**
 * A chapter's one-line summary, written in place when pressed: Enter keeps
 * it, Escape doesn't, and emptied it's none. `lines`: how many it shows, on
 * a card or in the Manuscript's list. Not for a locked chapter, which has none.
 */
export function Summary({ item, lines, onSummary }: { item: Item; lines: 1 | 3; onSummary: (summary: string | null) => void }) {
  const title = shownTitle(item)
  const [writing, setWriting] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  // Once a summary: Enter ends it, and the field going can blur it after.
  const open = useRef(false)
  useEffect(() => {
    if (writing) field.current?.focus()
  }, [writing])

  function write() {
    open.current = true
    setWriting(true)
  }

  function done(keep: boolean) {
    if (!open.current || !field.current) return
    open.current = false
    const text = field.current.value
    setWriting(false)
    if (keep && text.trim() !== (item.summary ?? '')) onSummary(text.trim() ? text : null)
  }

  return writing ? (
    <textarea
      ref={field}
      defaultValue={item.summary ?? ''}
      maxLength={SUMMARY_MAX}
      rows={lines}
      aria-label={`Summary of ${title}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          done(true)
        } else if (event.key === 'Escape') {
          event.stopPropagation()
          done(false)
        }
      }}
      onBlur={() => done(true)}
      className="block w-full resize-none rounded-sm bg-transparent text-[11.5px] leading-[1.4] text-ink outline-none pointer-coarse:text-[16px]"
    />
  ) : (
    <button onClick={write} aria-label={item.summary ? `Change the summary of ${title}: ${item.summary}` : `Add a summary of ${title}`} className="block w-full min-w-0 cursor-text text-left text-[11.5px] leading-[1.4]">
      {item.summary ? <span className={`block text-muted ${lines === 1 ? 'truncate' : 'line-clamp-3'}`}>{item.summary}</span> : <span className="text-faint">Add a summary</span>}
    </button>
  )
}

export function Grip() {
  return (
    <svg aria-hidden="true" width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
      {[3, 8, 13].map((cy) => [4, 8].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.3" />))}
    </svg>
  )
}
