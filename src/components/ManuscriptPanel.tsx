import { Fragment, useEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { useCounted } from '../lib/counts'
import type { Item, Placed } from '../db/db'
import { BOOK_FORMATS, FORMAT_NAMES, STANDARD_FORMATS, type BookFormat } from '../lib/documentExport'
import { GoalEditor } from '../editor/EditorStatus'
import type { FindSeed } from '../editor/FindBar'
import { BookFind } from './BookFind'
import { describeGoal } from '../lib/documentGoal'
import { setOwn, settingOf, useFolderSettings } from '../lib/folderSettings'
import { saidAs } from '../lib/folders'
import { bookTitle, moveChapter, rememberedAuthor, type Part } from '../lib/manuscript'
import { drawn } from '../lib/rewards'
import { countWords } from '../lib/stats'
import { plainText } from '../lib/text'
import { isLocked, shownTitle } from '../lib/vault'
import { StampArt } from './StampArt'

const GOAL_PLUS = 'A word goal for each book, with a deadline, is part of Nib Plus.'
const FIND_PLUS = 'Finding and replacing across a book is part of Nib Plus.'

const words = (n: number) => `${n.toLocaleString()} word${n === 1 ? '' : 's'}`

/** How close to the list's top or bottom a chapter in hand has to come for the list to scroll, and how fast. */
const EDGE = 48
const SCROLL = 8

/**
 * A folder's pages as a manuscript's chapters (lib/manuscript): in book
 * order, each with its words, and the book's. A chapter moves by its handle,
 * dragged, or with the arrow keys; tapping one opens it. In place of the
 * library's cards, as History and Trash are. The book wears its chapters'
 * stamps (lib/placed), and its compiled cover does too. The folders inside
 * the folder are its parts, each under its name with its own chapters, which
 * move within it.
 */
export function ManuscriptPanel({
  folder,
  parts,
  onBack,
  onOpen,
  onMove,
  onCompile,
  plus,
  onPlus,
  onOpenAt,
  onRewrite,
  stamps = [],
}: {
  folder: string
  /** The book in order (lib/manuscript partsOf): the folder's own pages, then each part's. */
  parts: Part[]
  onBack: () => void
  onOpen: (id: string) => void
  /** Places to store (db/items setPositions). */
  onMove: (places: { id: string; position: number }[]) => void
  /** The whole book as one file, Word, PDF or EPUB, or in standard manuscript format as Word or PDF (lib/manuscript Standard): Nib Plus. Not offered where Plus can't be had. */
  onCompile?: (format: BookFormat, standard?: boolean) => unknown
  plus: boolean
  /** Asks for Nib Plus, saying why: for the book's goal. Its goal isn't offered without it, where Plus can't be had. */
  onPlus?: (reason: string) => void
  /** A chapter opened at a match of the book's find, its find bar open on it (components/BookFind): Nib Plus, offered as the goal is. */
  onOpenAt?: (id: string, seed: FindSeed) => void
  /** Chapters given new words by the book's Replace all (lib/useOpenDocument `rewrite`), offered with it. */
  onRewrite?: ComponentProps<typeof BookFind>['onRewrite']
  /** Its chapters' stamps, gathered (lib/placed). */
  stamps?: Placed[]
}) {
  useCounted(true, 'manuscript_opened')
  const scroller = useRef<HTMLDivElement>(null)
  const chapters = parts.flatMap((part) => part.chapters)
  // While the book's find is open, its matches are where the chapters were.
  const [finding, setFinding] = useState(false)

  // A book can take a while, and a second press would make a second file.
  const [compiling, setCompiling] = useState(false)
  function compile(format: BookFormat, standard?: boolean) {
    setCompiling(true)
    void Promise.resolve(onCompile?.(format, standard)).finally(() => setCompiling(false))
  }
  const formats = (label: string, offered: BookFormat[], standard?: boolean) => (
    <p className="mt-2 flex items-center gap-2 text-[12px] text-muted">
      {label}
      {offered.map((format, i) => (
        <Fragment key={format}>
          {i > 0 && <span aria-hidden>·</span>}
          <button aria-label={`${standard ? 'Compile a standard manuscript as' : 'Compile as'} ${FORMAT_NAMES[format]}`} disabled={compiling} onClick={() => compile(format, standard)} className="nib-tap cursor-pointer font-medium text-ink hover:underline disabled:cursor-default disabled:opacity-50 disabled:hover:no-underline">
            {FORMAT_NAMES[format]}
          </button>
        </Fragment>
      ))}
      {!plus && <span className="text-[10.5px] text-faint">Plus</span>}
    </p>
  )

  const counted = chapters.filter((item) => !isLocked(item))
  const total = counted.reduce((sum, item) => sum + countWords(plainText(item.body)), 0)

  return (
    <div ref={scroller} className="nib-swap flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 pb-2">
        <button onClick={onBack} className="nib-tap cursor-pointer text-[11px] text-muted hover:text-ink">
          ← Back
        </button>
        <span className="text-[11px] text-faint">Manuscript</span>
      </div>
      <div className="px-4 pt-1 pb-3">
        <div className="flex items-start gap-3">
          <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.01em]">{saidAs(folder)}</h2>
          {stamps.length > 0 && (
            <span role="img" aria-label={stamps.length === 1 ? 'Its chapters’ stamp' : `Its chapters’ ${stamps.length} stamps`} className="flex shrink-0 flex-wrap justify-end gap-1.5">
              {stamps.map((placed) => (
                <span key={placed.no ?? placed.day} aria-hidden className="nib-stamp">
                  <StampArt stamp={drawn(placed)} width={20} />
                </span>
              ))}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[12px] text-muted">
          {chapters.length === 1 ? '1 chapter' : `${chapters.length} chapters`} · {words(total)}
        </p>
        {onPlus && <BookGoal folder={folder} written={total} plus={plus} onPlus={() => onPlus(GOAL_PLUS)} />}
        <TitlePage folder={folder} />
        {onCompile && formats('Compile as', BOOK_FORMATS)}
        {/* For sending to an agent or an editor: Times New Roman, double-spaced, the writer's name and the title on each page. */}
        {onCompile && formats('Standard manuscript as', STANDARD_FORMATS, true)}
        {onOpenAt && onRewrite && !finding && (
          <button onClick={() => (plus ? setFinding(true) : onPlus?.(FIND_PLUS))} className="nib-tap mt-2 flex w-full cursor-pointer items-center justify-between gap-2 text-left text-[12px] font-medium text-ink hover:underline">
            <span>Find in this book</span>
            {!plus && <span className="text-[10.5px] font-normal text-faint">Plus</span>}
          </button>
        )}
      </div>
      {/* On a phone, room at the end to scroll the last chapter clear of New, as the cards have. */}
      {finding && onOpenAt && onRewrite ? (
        <BookFind chapters={chapters.map((item, index) => ({ item, number: index + 1 }))} onOpenAt={onOpenAt} onRewrite={onRewrite} onClose={() => setFinding(false)} />
      ) : (
      <div className="pb-6 phone:pb-24">
        {parts.map((part, index) => (
          <Fragment key={part.folder}>
            {part.name !== null && <h3 className="px-4 pt-4 pb-1 text-[11px] font-medium text-muted">{part.name}</h3>}
            {/* Numbered through the book, not from one in each part. */}
            <Chapters name={part.name} chapters={part.chapters} before={parts.slice(0, index).reduce((sum, earlier) => sum + earlier.chapters.length, 0)} scroller={scroller} onOpen={onOpen} onMove={onMove} />
          </Fragment>
        ))}
      </div>
      )}
    </div>
  )
}

/**
 * The book's word goal, and a date to make it by if it's given one: the
 * book's words against it, as a document's goal has its own (lib/documentGoal),
 * and Nib Plus as that is. Kept with the folder (lib/folderSettings), so on
 * the writer's other devices too. Without Plus, one already set is kept, not
 * shown.
 */
function BookGoal({ folder, written, plus, onPlus }: { folder: string; written: number; plus: boolean; onPlus: () => void }) {
  const goal = settingOf(useFolderSettings(), folder)?.goal
  const [editing, setEditing] = useState(false)
  const action = 'nib-tap cursor-pointer text-muted hover:text-ink'
  if (!plus) {
    return (
      <button onClick={onPlus} className={`${action} mt-1.5 flex w-full justify-between gap-2 text-left text-[11px]`}>
        <span>A word goal for this book</span>
        <span>Plus ›</span>
      </button>
    )
  }
  if (editing) {
    return (
      <div className="mt-1.5 text-[11px]">
        <GoalEditor
          goal={goal ?? null}
          dateLabel="Deadline"
          onCancel={() => setEditing(false)}
          onSave={(next) => {
            setOwn(folder, { goal: next })
            setEditing(false)
          }}
        />
      </div>
    )
  }
  if (!goal) {
    return (
      <button onClick={() => setEditing(true)} className={`${action} mt-1.5 block text-[11px]`}>
        Set a word goal
      </button>
    )
  }
  return (
    <div className="mt-1.5 text-[11px]">
      <div role="progressbar" aria-label="Book goal" aria-valuemin={0} aria-valuemax={goal.words} aria-valuenow={Math.min(written, goal.words)} className="h-[3px] overflow-hidden rounded-full bg-line">
        <div className="h-full bg-ink" style={{ width: `${Math.min(100, (100 * written) / goal.words)}%` }} />
      </div>
      <p className="mt-1 flex items-center justify-between gap-2 text-muted">
        <span>{describeGoal(goal, written, Date.now())}</span>
        <button onClick={() => setEditing(true)} className={action}>
          Change
        </button>
      </p>
    </div>
  )
}

/**
 * The book's title page (lib/manuscript bookOf): its title, the folder's name
 * till it's given another, and who it's by, the name last given a book till
 * it's given its own. Kept with the folder (lib/folderSettings); emptied, it's
 * back to those.
 */
function TitlePage({ folder }: { folder: string }) {
  const settings = useFolderSettings()
  const own = settingOf(settings, folder)
  const shown = { title: own?.title ?? bookTitle(folder), author: own?.author ?? rememberedAuthor(settings) ?? '' }
  const field = 'h-[30px] min-w-0 flex-1 rounded-md border border-line bg-paper px-[9px] text-[12px] text-ink outline-none placeholder:text-muted pointer-coarse:h-11 pointer-coarse:text-[16px]'
  const line = (key: 'title' | 'author', label: string, placeholder?: string) => (
    <label className="flex items-center gap-2 text-[11px] text-muted">
      <span className="w-9 shrink-0">{label}</span>
      <input
        // Drawn again from what's kept when that changes, here or by sync.
        key={`${key}:${shown[key]}`}
        defaultValue={shown[key]}
        placeholder={placeholder}
        maxLength={200}
        onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        onBlur={(event) => {
          const value = event.currentTarget.value.trim()
          if (value !== shown[key]) setOwn(folder, { [key]: value || null })
        }}
        className={field}
      />
    </label>
  )
  return (
    <div role="group" aria-label="Title page" className="mt-2.5 flex flex-col gap-1.5">
      {line('title', 'Title')}
      {line('author', 'By', 'Your name')}
    </div>
  )
}

/** One part's chapters, or the book's own: the list, and a chapter moved within it. `before`: how many chapters come before these in the book. */
function Chapters({ name, chapters, before, scroller, onOpen, onMove }: {
  name: string | null
  chapters: Item[]
  before: number
  /** What the panel scrolls in, for a chapter held near its top or bottom. */
  scroller: RefObject<HTMLDivElement | null>
  onOpen: (id: string) => void
  onMove: (places: { id: string; position: number }[]) => void
}) {
  // A move shown before it's stored and comes back, so a dropped chapter
  // stays where it was put; the next list from the store replaces it.
  const ids = chapters.map((item) => item.id).join()
  const [moved, setMoved] = useState<{ over: string; order: string[] } | null>(null)
  if (moved && moved.over !== ids) setMoved(null)
  const byId = new Map(chapters.map((item) => [item.id, item]))
  const order = moved ? moved.order.map((id) => byId.get(id)!) : chapters

  // The chapter in hand: where it came from, where it would go, and how far
  // the pointer has it from that place.
  const [held, setHeld] = useState<{ id: string; from: number; to: number; shift: number } | null>(null)
  const list = useRef<HTMLOListElement>(null)
  // A chapter moved with the keys keeps the focus as its row moves.
  const refocus = useRef<string | null>(null)
  useEffect(() => {
    if (!refocus.current) return
    list.current?.querySelector<HTMLElement>(`[data-chapter="${CSS.escape(refocus.current)}"] [data-handle]`)?.focus()
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

  function grab(event: PointerEvent<HTMLButtonElement>, from: number) {
    if (event.button !== 0 || !list.current || !scroller.current) return
    event.preventDefault()
    const row = event.currentTarget.closest<HTMLElement>('[data-chapter]')!
    const pitch = row.offsetHeight
    // Where on its row the chapter was taken, so it stays under the pointer there.
    const offset = event.clientY - row.getBoundingClientRect().top
    const at = (y: number) => {
      const top = y - list.current!.getBoundingClientRect().top - offset
      const to = Math.min(Math.max(Math.round(top / pitch), 0), order.length - 1)
      return { to, shift: top - to * pitch }
    }
    setHeld({ id: order[from].id, from, ...at(event.clientY) })

    // Near the top or bottom, the list scrolls on, for a book longer than the screen.
    let y = event.clientY
    let speed = 0
    let frame = 0
    const roll = () => {
      frame = 0
      if (!speed || !scroller.current) return
      scroller.current.scrollTop += speed
      setHeld((now) => now && { ...now, ...at(y) })
      frame = requestAnimationFrame(roll)
    }
    const follow = (moving: globalThis.PointerEvent) => {
      y = moving.clientY
      setHeld((now) => now && { ...now, ...at(y) })
      const box = scroller.current!.getBoundingClientRect()
      speed = y < box.top + EDGE ? -SCROLL : y > box.bottom - EDGE ? SCROLL : 0
      if (speed && !frame) frame = requestAnimationFrame(roll)
    }
    const end = (ending: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', follow)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      cancelAnimationFrame(frame)
      setHeld(null)
      if (ending.type === 'pointerup') move(from, at(ending.clientY).to)
    }
    window.addEventListener('pointermove', follow)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  function nudge(event: KeyboardEvent<HTMLButtonElement>, from: number) {
    const to = event.key === 'ArrowUp' ? from - 1 : event.key === 'ArrowDown' ? from + 1 : null
    if (to === null) return
    event.preventDefault()
    if (to < 0 || to >= order.length) return
    refocus.current = order[from].id
    move(from, to)
  }

  // While one is in hand, the rest make room for it where it would go.
  const shown = held ? order.filter((item) => item.id !== held.id) : order
  if (held) shown.splice(held.to, 0, byId.get(held.id)!)

  return (
    <ol ref={list} aria-label={name === null ? 'Chapters' : `Chapters of ${name}`} className="relative flex flex-col px-2 select-none">
      {shown.map((item, index) => {
        const inHand = held?.id === item.id
        const title = shownTitle(item)
        return (
          <li
            key={item.id}
            data-chapter={item.id}
            data-held={inHand || undefined}
            style={inHand ? { transform: `translateY(${held.shift}px)` } : undefined}
            className="flex h-12 items-center gap-1 rounded-md bg-shell hover:bg-item-hover data-held:relative data-held:z-10 data-held:bg-paper data-held:shadow-[0_8px_20px_rgba(0,0,0,0.16)] pointer-coarse:h-14"
          >
            <button
              data-handle
              aria-label={`Move ${title}`}
              onPointerDown={(event) => grab(event, order.indexOf(item))}
              onKeyDown={(event) => nudge(event, order.indexOf(item))}
              className="nib-tap flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-faint hover:text-muted active:cursor-grabbing"
            >
              <Grip />
            </button>
            {/* For VoiceOver, which can't drag or press an arrow key. Off the Tab order: the handle has the arrow keys. */}
            {index > 0 && (
              <button tabIndex={-1} onClick={() => move(order.indexOf(item), order.indexOf(item) - 1)} className="sr-only">
                {title}, move up
              </button>
            )}
            {index < order.length - 1 && (
              <button tabIndex={-1} onClick={() => move(order.indexOf(item), order.indexOf(item) + 1)} className="sr-only">
                {title}, move down
              </button>
            )}
            <button onClick={() => onOpen(item.id)} className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 pr-2 text-left">
              <span className="w-5 shrink-0 text-right text-[11px] text-faint tabular-nums">{before + index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{title}</span>
              <span className="shrink-0 text-[11px] text-muted tabular-nums">{isLocked(item) ? 'Locked' : words(countWords(plainText(item.body)))}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function Grip() {
  return (
    <svg aria-hidden="true" width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
      {[3, 8, 13].map((cy) => [4, 8].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.3" />))}
    </svg>
  )
}
