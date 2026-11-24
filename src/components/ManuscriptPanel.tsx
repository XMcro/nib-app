import { Fragment, useEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { useCounted } from '../lib/counts'
import type { Item, Placed } from '../db/db'
import { BOOK_FORMATS, FORMAT_NAMES, STANDARD_FORMATS, type BookFormat } from '../lib/documentExport'
import { GoalEditor } from '../editor/EditorStatus'
import type { FindSeed } from '../editor/FindBar'
import { BookFind } from './BookFind'
import { describeGoal } from '../lib/documentGoal'
import { castOf, setOwn, settingOf, useFolderSettings } from '../lib/folderSettings'
import { saidAs } from '../lib/folders'
import { readJson, writeJson } from '../lib/jsonStorage'
import { bookTitle, moveChapter, rememberedAuthor, type Part, type Status } from '../lib/manuscript'
import { PRINT_PLUS, TRIMS, type Trim } from '../lib/printBook'
import { AUDIO_PLUS } from '../lib/readAloud'
import { pending, submissionsOf, useSubmissions } from '../lib/submissions'
import { drawn } from '../lib/rewards'
import { countWords } from '../lib/stats'
import { plainText } from '../lib/text'
import { isLocked, shownTitle } from '../lib/vault'
import { CastView, CAST_PLUS } from './CastView'
import { Corkboard, Grip, StatusChip, Summary } from './Corkboard'
import { StampArt } from './StampArt'

const GOAL_PLUS = 'A word goal for each book, with a deadline, is part of Nib Plus.'
const FIND_PLUS = 'Finding and replacing across a book is part of Nib Plus.'
const CARDS_PLUS = 'A book’s chapters as index cards, each with a summary and a status, are part of Nib Plus.'
/** List, Cards or People and places, as last chosen on this device, for every book. */
const VIEW_KEY = 'nib-manuscript-view'
/** The trim and drop caps of a book for print, as last chosen on this device, for every book. */
const PRINT_KEY = 'nib-print-book'

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
  onPrint,
  onListen,
  onSubmissions,
  plus,
  onPlus,
  onOpenAt,
  onRewrite,
  onSummary,
  onStatus,
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
  /** The book's inside as a PDF ready for print on demand (lib/printBook): Nib Plus. Only in the app, which prints it. */
  onPrint?: (trim: Trim, dropCaps: boolean) => unknown
  /** The book read aloud into one audio file, to proofread by ear (lib/readAloud record): Nib Plus. Only in the app, whose voice makes it. */
  onListen?: () => unknown
  /** Where the book has been sent (lib/submissions): Nib Plus, offered as its goal is. */
  onSubmissions?: () => void
  plus: boolean
  /** Asks for Nib Plus, saying why: for the book's goal. Its goal isn't offered without it, where Plus can't be had. */
  onPlus?: (reason: string) => void
  /** A chapter opened at a match of the book's find, its find bar open on it (components/BookFind): Nib Plus, offered as the goal is. */
  onOpenAt?: (id: string, seed: FindSeed) => void
  /** Chapters given new words by the book's Replace all (lib/useOpenDocument `rewrite`), offered with it. */
  onRewrite?: ComponentProps<typeof BookFind>['onRewrite']
  /** A chapter's summary and status on the corkboard (db/items setSummary, setStatus). */
  onSummary: (id: string, summary: string | null) => void
  onStatus: (id: string, status: Status) => void
  /** Its chapters' stamps, gathered (lib/placed). */
  stamps?: Placed[]
}) {
  useCounted(true, 'manuscript_opened')
  const scroller = useRef<HTMLDivElement>(null)
  const chapters = parts.flatMap((part) => part.chapters)
  // While the book's find is open, its matches are where the chapters were.
  const [finding, setFinding] = useState(false)
  // The chapters as a list, or as cards on a corkboard, or the book's characters and places (each Nib Plus): without Plus, the
  // list, whatever was chosen with it; but a book that has characters and places keeps them to see and change.
  const [chosen, setChosen] = useState(() => readJson<'list' | 'cards' | 'cast'>(VIEW_KEY, 'list'))
  const hasCast = castOf(useFolderSettings(), folder).length > 0
  const cards = plus && chosen === 'cards'
  const people = chosen === 'cast' && (plus || hasCast)
  function show(view: 'list' | 'cards' | 'cast') {
    if (view === 'cards' && !plus) return onPlus?.(CARDS_PLUS)
    if (view === 'cast' && !plus && !hasCast) return onPlus?.(CAST_PLUS)
    setChosen(view)
    writeJson(VIEW_KEY, view)
  }

  // A book can take a while, and a second press would make a second file.
  const [compiling, setCompiling] = useState(false)
  function making(made: unknown) {
    setCompiling(true)
    void Promise.resolve(made).finally(() => setCompiling(false))
  }
  const compile = (format: BookFormat, standard?: boolean) => making(onCompile?.(format, standard))
  // Its trim and drop caps, open to choose: with Plus.
  const [printing, setPrinting] = useState(false)
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
  // A book given a status or a summary on its cards shows them in the list too, editable, with Plus or without.
  const carded = chapters.some((item) => item.status || item.summary)
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
        {/* The inside of a paperback, to sell through Amazon KDP or IngramSpark. */}
        {onPrint && (
          <button
            aria-expanded={plus ? printing : undefined}
            onClick={() => (plus ? setPrinting(!printing) : onPlus?.(PRINT_PLUS))}
            className="nib-tap mt-2 flex w-full cursor-pointer items-center justify-between gap-2 text-left text-[12px] font-medium text-ink hover:underline"
          >
            <span>Print-ready PDF</span>
            {!plus && <span className="text-[10.5px] font-normal text-faint">Plus</span>}
          </button>
        )}
        {onPrint && plus && printing && <PrintReady busy={compiling} onPrint={(trim, dropCaps) => making(onPrint(trim, dropCaps))} />}
        {/* The whole book in the voice Read aloud uses, each chapter's title read at its start. */}
        {onListen && (
          <button
            disabled={compiling}
            onClick={() => (plus ? making(onListen()) : onPlus?.(AUDIO_PLUS))}
            className="nib-tap mt-2 flex w-full cursor-pointer items-center justify-between gap-2 text-left text-[12px] font-medium text-ink hover:underline disabled:cursor-default disabled:opacity-50 disabled:hover:no-underline"
          >
            <span>Audio to listen to</span>
            {!plus && <span className="text-[10.5px] font-normal text-faint">Plus</span>}
          </button>
        )}
        {onSubmissions && <SubmissionsLine folder={folder} plus={plus} onOpen={onSubmissions} />}
        {onOpenAt && onRewrite && !finding && (
          <button onClick={() => (plus ? setFinding(true) : onPlus?.(FIND_PLUS))} className="nib-tap mt-2 flex w-full cursor-pointer items-center justify-between gap-2 text-left text-[12px] font-medium text-ink hover:underline">
            <span>Find in this book</span>
            {!plus && <span className="text-[10.5px] font-normal text-faint">Plus</span>}
          </button>
        )}
      </div>
      {/* Where Plus can be had, or with it. */}
      {!finding && (plus || onPlus) && (
        <div role="group" aria-label="Show chapters as" className="mx-4 mb-2 flex w-fit gap-px rounded-md border border-line p-px text-[11px]">
          {(['list', 'cards', 'cast'] as const).map((view) => (
            <button
              key={view}
              aria-pressed={view === 'cards' ? cards : view === 'cast' ? people : !cards && !people}
              onClick={() => show(view)}
              className="nib-tap cursor-pointer rounded-[4px] px-2.5 py-0.5 text-muted aria-pressed:bg-item-active aria-pressed:text-ink"
            >
              {view === 'list' ? 'List' : view === 'cards' ? 'Cards' : 'People and places'}
              {view !== 'list' && !plus && !(view === 'cast' && hasCast) && <span className="ml-1 text-[10px] text-faint">Plus</span>}
            </button>
          ))}
        </div>
      )}
      {/* On a phone, room at the end to scroll the last chapter clear of New, as the cards have. */}
      {finding && onOpenAt && onRewrite ? (
        <BookFind chapters={chapters.map((item, index) => ({ item, number: index + 1 }))} onOpenAt={onOpenAt} onRewrite={onRewrite} onClose={() => setFinding(false)} />
      ) : cards ? (
        <Corkboard parts={parts} scroller={scroller} onOpen={onOpen} onMove={onMove} onSummary={onSummary} onStatus={onStatus} />
      ) : people ? (
        <CastView folder={folder} chapters={chapters} plus={plus} onPlus={onPlus} onOpen={onOpen} onOpenAt={onOpenAt} />
      ) : (
      <div className="pb-6 phone:pb-24">
        {parts.map((part, index) => (
          <Fragment key={part.folder}>
            {part.name !== null && <h3 className="px-4 pt-4 pb-1 text-[11px] font-medium text-muted">{part.name}</h3>}
            {/* Numbered through the book, not from one in each part. */}
            <Chapters
              name={part.name}
              chapters={part.chapters}
              before={parts.slice(0, index).reduce((sum, earlier) => sum + earlier.chapters.length, 0)}
              carded={carded}
              scroller={scroller}
              onOpen={onOpen}
              onMove={onMove}
              onSummary={onSummary}
              onStatus={onStatus}
            />
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
/** A book's inside for print on demand (lib/printBook): its trim and drop caps, as last chosen on this device, then made. */
function PrintReady({ busy, onPrint }: { busy: boolean; onPrint: (trim: Trim, dropCaps: boolean) => void }) {
  const [chosen, setChosen] = useState(() => readJson<{ trim?: unknown; dropCaps?: unknown }>(PRINT_KEY, {}))
  // 6 × 9 unless another of these was chosen: the trim most often printed.
  const trim: Trim = typeof chosen.trim === 'string' && chosen.trim in TRIMS ? (chosen.trim as Trim) : '6x9'
  const dropCaps = chosen.dropCaps === true
  function choose(next: { trim: Trim; dropCaps: boolean }) {
    setChosen(next)
    writeJson(PRINT_KEY, next)
  }
  return (
    <div role="group" aria-label="Print-ready PDF" className="mt-1.5 flex flex-col gap-2 rounded-md border border-line p-2.5">
      <p className="text-[11px] text-muted">The inside of a paperback, to print and sell through Amazon KDP or IngramSpark. They take its cover as a file of its own.</p>
      <div role="group" aria-label="Trim size" className="flex w-fit gap-px rounded-md border border-line p-px text-[11px]">
        {(Object.keys(TRIMS) as Trim[]).map((one) => (
          <button
            key={one}
            aria-pressed={one === trim}
            onClick={() => choose({ trim: one, dropCaps })}
            className="nib-tap cursor-pointer rounded-[4px] px-2.5 py-0.5 text-muted aria-pressed:bg-item-active aria-pressed:text-ink"
          >
            {TRIMS[one].name}
          </button>
        ))}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-ink">
        <input type="checkbox" checked={dropCaps} onChange={(event) => choose({ trim, dropCaps: event.target.checked })} />
        Drop caps
      </label>
      <button
        disabled={busy}
        onClick={() => onPrint(trim, dropCaps)}
        className="nib-tap w-fit cursor-pointer text-[12px] font-medium text-ink hover:underline disabled:cursor-default disabled:opacity-50 disabled:hover:no-underline"
      >
        Make the PDF
      </button>
    </div>
  )
}

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

/**
 * One part's chapters, or the book's own: the list, and a chapter moved within it. `before`: how many chapters come
 * before these in the book. `carded`: the book has statuses or summaries from its cards, each row shows its own.
 */
function Chapters({ name, chapters, before, carded, scroller, onOpen, onMove, onSummary, onStatus }: {
  name: string | null
  chapters: Item[]
  before: number
  carded: boolean
  /** What the panel scrolls in, for a chapter held near its top or bottom. */
  scroller: RefObject<HTMLDivElement | null>
  onOpen: (id: string) => void
  onMove: (places: { id: string; position: number }[]) => void
  onSummary: (id: string, summary: string | null) => void
  onStatus: (id: string, status: Status) => void
}) {
  // A move shown before it's stored and comes back, so a dropped chapter
  // stays where it was put; the next list from the store replaces it.
  const ids = chapters.map((item) => item.id).join()
  const [moved, setMoved] = useState<{ over: string; order: string[] } | null>(null)
  if (moved && moved.over !== ids) setMoved(null)
  const byId = new Map(chapters.map((item) => [item.id, item]))
  // Only while it's of these chapters: one gone before the move came back was a chapter that isn't there, and no panel at all.
  const order = moved && moved.over === ids ? moved.order.map((id) => byId.get(id)!) : chapters

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
  // If it's still one of them: trashed or moved out on another device while in hand, it's put nowhere.
  const inHand = held && byId.get(held.id)
  const shown = inHand ? order.filter((item) => item !== inHand) : order
  if (inHand) shown.splice(held.to, 0, inHand)

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
            // Every row of a list the same height: a chapter in hand moves a row's height at a time.
            className={`flex items-center gap-1 rounded-md bg-shell hover:bg-item-hover data-held:relative data-held:z-10 data-held:bg-paper data-held:shadow-[0_8px_20px_rgba(0,0,0,0.16)] ${carded ? 'h-16 pointer-coarse:h-[72px]' : 'h-12 pointer-coarse:h-14'}`}
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
            {carded ? (
              // Its status beside it, and its summary under its title, each pressed to change it.
              <div className="flex min-w-0 flex-1 flex-col justify-center pr-2">
                <div className="flex items-center gap-2">
                  <button onClick={() => onOpen(item.id)} className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left">
                    {row(item, before + index + 1, title)}
                  </button>
                  <StatusChip item={item} onStatus={(status) => onStatus(item.id, status)} />
                </div>
                {!isLocked(item) && (
                  <div className="min-w-0 pl-[30px]">
                    <Summary item={item} lines={1} onSummary={(summary) => onSummary(item.id, summary)} />
                  </div>
                )}
              </div>
            ) : (
              <button onClick={() => onOpen(item.id)} className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 pr-2 text-left">
                {row(item, before + index + 1, title)}
              </button>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** A chapter's row as the list has it, to open it by: its number through the book, its title, and its words. */
function row(item: Item, number: number, title: string) {
  return (
    <>
      <span className="w-5 shrink-0 text-right text-[11px] text-faint tabular-nums">{number}</span>
      <span className="min-w-0 flex-1 truncate text-[13px]">{title}</span>
      <span className="shrink-0 text-[11px] text-muted tabular-nums">{isLocked(item) ? 'Locked' : words(countWords(plainText(item.body)))}</span>
    </>
  )
}

/** The book's submissions, by how many and how many still waiting (lib/submissions). */
function SubmissionsLine({ folder, plus, onOpen }: { folder: string; plus: boolean; onOpen: () => void }) {
  const sent = submissionsOf(useSubmissions(), { book: folder })
  const waiting = sent.filter(pending).length
  return (
    <button onClick={onOpen} className="nib-tap mt-2 flex w-full cursor-pointer items-center justify-between gap-2 text-left text-[12px] font-medium text-ink hover:underline">
      <span>Submissions</span>
      <span className="text-[10.5px] font-normal text-faint">
        {sent.length > 0 ? `${sent.length} sent${waiting > 0 ? `, ${waiting} waiting` : ''}` : plus ? 'None yet' : 'Plus'}
      </span>
    </button>
  )
}
