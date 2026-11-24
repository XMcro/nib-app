import { memo, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type Dispatch, type PointerEvent, type ReactNode, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import badge from '../assets/plus-badge.png'
import type { Item, Kind } from '../db/db'
import { setArchived, setCategories, setFolder, setPinned } from '../db/items'
import { canMake, filingHidden, filingOf, lookOf, makeFolder, saidAs, sameName, within, type Library as Filing, type Look, type Place } from '../lib/folders'
import { motion } from '../lib/motion'
import { CANT_SAVE, type NoticeAction } from '../lib/notices'
import { drawn } from '../lib/rewards'
import { forPlus, type ManyFormat } from '../lib/exportMany'
import type { Sort } from '../lib/sort'
import type { Sync } from '../sync'
import { describeSync } from '../sync/status'
import { NEW_NOTE_SHORTCUT, NEW_PAGE_SHORTCUT, showsShortcuts } from '../lib/platform'
import { describeExpiry } from '../lib/expiry'
import { describeReminder, reminderOf, remindersAvailable, repeatWord } from '../lib/reminders'
import { SORTS, SORT_LABEL } from '../lib/sort'
import { previewOf } from '../lib/text'
import { relativeTime } from '../lib/time'
import { isScreenplay, scriptPreview } from '../lib/fountain'
import { isLocked, shownTitle, vaultOpen } from '../lib/vault'
import { Banner } from './Banner'
import { Coin } from './Coin'
import { ExportDialog } from './ExportDialog'
import { FilingDialog } from './FilingDialog'
import { InkLine } from './InkLine'
import { NibMark } from './NibMark'
import { StampArt } from './StampArt'
import { heldAt, useCardDrag } from './cardDrag'
import { around, covers, FIRST_DRAWN, measure, newShape, runsOf, span, type Drawn } from './cardWindow'
import { CategoryDot, FolderMark, PlaceChips } from './Places'

type LibraryProps = {
  kind: Kind
  onKindChange: (kind: Kind) => void
  query: string
  onQueryChange: (query: string) => void
  searching: boolean
  items: Item[]
  activeId: string | null
  onSelect: (id: string) => void
  onDelete: (which: string | string[]) => void
  onTogglePin: (id: string) => void
  onNew: () => void
  /** In Pages: a new page written as a screenplay (lib/fountain). Not offered where Plus can't be had. */
  onNewScreenplay?: () => void
  /** Without Plus, the offer says it's with it. */
  screenplayPlus?: boolean
  /** A new note or page from this template (lib/templates). */
  onUseTemplate?: (id: string) => void
  sort: Sort
  onSortChange: (sort: Sort) => void
  trash: Item[]
  onViewTrash: (viewing: boolean) => void
  saveFailed: boolean
  /** App's notice, which the library would otherwise cover: shown at its foot. */
  notice: string | null
  /** The notice's one thing to do, beside Dismiss, if it has one. */
  noticeAction?: NoticeAction
  onDismissNotice: () => void
  plus: boolean
  sync: Sync
  /** Showing over the text, or put away while a document has the window. */
  open: boolean
  onOpenSettings: () => void
  /** In the app: the Stampbook and its market a tap away, with the coins there are. */
  stamps?: { points: number; onStampbook: () => void; onMarket: () => void }
  /** Shown in place of the list (components/useLibraryPanels): History, the trash, folders, notes on the document. */
  panel?: ReactNode
  onManage: () => void
  /** What the list shows (lib/folders): everything, a folder's, or a category's. */
  place: Place
  onPlaceChange: (place: Place) => void
  library: Filing
  /** How many documents are in the archive, and how many templates (lib/templates). */
  archived: number
  templates?: number
  /** Every document not in the trash, in whichever list: what's selected may not be in the one showing. */
  all: Item[]
  /** A storage action, reported as App reports any. */
  run: (action: () => Promise<unknown>) => void
  /** These as one zip (fileActions exportMany). Without Nib Plus, HTML and PDF ask for it and export nothing. */
  onExport: (ids: string[], format: ManyFormat, making: (which: number, of: number) => void) => Promise<unknown>
  /** Nib Plus: no limit on folders and categories. */
  unlimited: boolean
  onLimit: (kind: 'folder' | 'category') => void
  /** With a folder shown that has pages: them as a manuscript's chapters (components/useLibraryPanels), as the panel for it, given the way back. */
  manuscript?: ((onBack: () => void) => ReactNode) | null
}

/**
 * Notes and Pages as a screen of their own, cards across the window, over
 * the text. Opening one gives the text the whole window (App, with the way
 * back above it). The trash, a document's history, folders and readers'
 * notes show here in place of the cards. Settings is a screen of its own
 * too, from the gear (App).
 *
 * Put away, it isn't drawn again till it's back: hidden and inert, it would
 * otherwise redraw every card after every save while the writer types.
 */
export const Library = memo(LibraryScreen, (before, after) => !before.open && !after.open)

function LibraryScreen(props: LibraryProps) {
  const { kind, query, searching, items, trash, place, manuscript } = props
  const noun = kind === 'note' ? 'note' : 'page'
  const [arranging, setArranging] = useState(false)
  if (arranging && !manuscript) setArranging(false)
  const elsewhere = Boolean(props.panel) || (arranging && Boolean(manuscript))
  const nextSort = SORTS[(SORTS.indexOf(props.sort) + 1) % SORTS.length]

  // "+ New folder" taking a name, and the card dropped on it, if one was. Or "+ Subfolder", for one inside the folder `inside`.
  const [naming, setNaming] = useState<{ file?: Item; inside?: string } | null>(null)
  const startNaming = (file?: Item, inside?: string) => (canMake('folder', props.library, props.unlimited) ? setNaming({ file, inside }) : props.onLimit('folder'))
  function named(name: string) {
    const file = naming?.file
    const inside = naming?.inside
    setNaming(null)
    const trimmed = inside === undefined || !name.trim() ? name.trim() : within(inside, name.trim())
    if (!trimmed) return
    // A name already there is that folder, not a second of it.
    const known = props.library.folders.find((folder) => sameName(folder.name, trimmed))?.name
    const folder = known ?? (makeFolder(trimmed, props.library) ? trimmed : undefined)
    if (!folder) return
    if (!known) flash(setFresh, folder, 900)
    if (file) props.run(() => setFolder(file.id, folder))
    props.onPlaceChange({ folder })
  }

  // New opens out into the new note or page (openOut). It's made at once, so
  // the cursor is ready in it, but the library stays in sight, under the
  // sheet, till it's covered.
  const [covering, setCovering] = useState(false)
  function create(button: HTMLElement) {
    const ms = OPEN_MS * motion()
    if (!ms || typeof button.animate !== 'function') return props.onNew()
    setCovering(true)
    props.onNew()
    void openOut(button, ms, () => setCovering(false))
  }

  // A folder just made, arriving with a burst; the chip a card just landed in, gulping it.
  const [fresh, setFresh] = useState<string | null>(null)
  const [landed, setLanded] = useState<string | null>(null)
  const drag = useCardDrag((item, drop, chip) => {
    flash(setLanded, chip, 600)
    if (drop === 'new') return startNaming(item)
    if (drop === 'archive') return props.run(() => setArchived(item.id, true))
    if ('folder' in drop) return props.run(() => setFolder(item.id, drop.folder))
    const category = props.library.categories.find((known) => sameName(known.name, drop.category))
    if (!category || item.categories?.some((had) => sameName(had.name, category.name))) return
    props.run(() => setCategories(item.id, [...(item.categories ?? []), { name: category.name, color: category.color }]))
  })
  // Selecting: tapping a card marks it, by id, as the list draws only the cards near the window. Null when not.
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null)
  if (selected && !props.open) setSelected(null)
  const [filing, setFiling] = useState(false)
  if (filing && !selected) setFiling(false)
  const [exporting, setExporting] = useState(false)
  if (exporting && !selected) setExporting(false)
  // Gone from this device since it was marked, it's no longer counted.
  const picked = selected ? props.all.filter((item) => selected.has(item.id)) : []
  const ids = picked.map((item) => item.id)
  const toFile = picked.filter((item) => !filingHidden(item))
  const allShownMarked = items.length > 0 && items.every((item) => selected?.has(item.id))
  const allPinned = picked.length > 0 && picked.every((item) => item.pinnedAt !== undefined)
  const allArchived = picked.length > 0 && picked.every((item) => typeof item.archivedAt === 'number')
  function toAll(action: () => Promise<unknown>) {
    props.run(action)
    setSelected(null)
  }

  // The same four for the life of the screen, so a card with nothing new isn't drawn again (Card's memo).
  const latest = useRef({ props, drag, selected })
  latest.current = { props, drag, selected }
  const [handlers] = useState(() => ({
    onPress: (event: PointerEvent<HTMLElement>, item: Item) => {
      if (!latest.current.selected) latest.current.drag.press(event, item, shownTitle(item))
    },
    onSelect: (id: string) => {
      if (latest.current.selected) {
        setSelected((now) => {
          const next = new Set(now)
          if (!next.delete(id)) next.add(id)
          return next
        })
      } else if (!latest.current.drag.justDropped()) latest.current.props.onSelect(id)
    },
    onDelete: (id: string) => latest.current.props.onDelete(id),
    onTogglePin: (id: string) => latest.current.props.onTogglePin(id),
    onUse: (id: string) => latest.current.props.onUseTemplate?.(id),
  }))

  // Cards rise in, one after another, on each return to the library (CardGrid)
  // and each change of tab or folder: a new grid each time.
  const [arrivals, setArrivals] = useState({ open: props.open, count: 0 })
  if (arrivals.open !== props.open) setArrivals({ open: props.open, count: arrivals.count + (props.open ? 1 : 0) })

  return (
    <div
      className="nib-library fixed inset-0 z-30 flex flex-col bg-shell pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
      data-open={props.open || covering}
      inert={!props.open}
    >
      {/* A bar across the top on a wider screen. On a phone the same controls
          stack under a title, and New is a button under the thumb: one of
          each, laid out twice, rather than two copies. Just wider than a
          phone (an iPhone Duo open), search gives way, not New's label. */}
      <header
        className={`grid h-14 shrink-0 items-center gap-4 border-b border-line px-5 phone:h-auto phone:gap-1 phone:border-0 phone:px-4 phone:pt-2 ${props.stamps ? 'grid-cols-[auto_1fr_minmax(0,230px)_auto_auto_auto] phone:grid-cols-[1fr_auto_auto]' : 'grid-cols-[auto_1fr_minmax(0,230px)_auto_auto] phone:grid-cols-[1fr_auto]'}`}
      >
        <span className="flex items-center gap-[7px] text-[15px] font-semibold tracking-[-0.012em] phone:hidden">
          <NibMark className="h-[18px] w-[11px]" />
          Nib
        </span>
        <h1 className="hidden text-[30px] leading-tight font-bold tracking-[-0.02em] phone:block">{kind === 'note' ? 'Notes' : 'Pages'}</h1>
        <KindSwitch kind={kind} onChange={props.onKindChange} className="justify-self-center phone:order-3 phone:col-span-full phone:mt-2 phone:justify-self-stretch" />
        <input
          value={query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={searching ? 'Searching everything' : `Search ${noun}s`}
          aria-label="Search"
          data-search
          className="h-8 w-full min-w-0 rounded-lg border border-line bg-paper px-2.5 text-[13px] outline-none placeholder:text-muted phone:order-4 phone:col-span-full phone:mt-2 phone:h-10 phone:border-0 phone:bg-item-active phone:text-[16px]"
        />
        <button
          aria-label={`New ${noun}`}
          onClick={(event) => create(event.currentTarget)}
          className="nib-tap nib-new flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-ink px-3.5 text-[13px] font-semibold whitespace-nowrap text-paper phone:fixed phone:right-[calc(env(safe-area-inset-right)+1.25rem)] phone:bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] phone:z-10 phone:size-14 phone:rounded-full phone:px-0 phone:shadow-[0_8px_20px_rgba(0,0,0,0.22)]"
        >
          <span className="relative phone:hidden">
            New {noun}
            <InkLine />
          </span>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="hidden phone:block">
            <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16z" />
            <path d="M13.5 6.5l4 4" />
          </svg>
        </button>
        {props.stamps && (
          <span className="flex items-center gap-1 phone:order-2">
            <button aria-label="Stampbook" title="Stampbook" onClick={props.stamps.onStampbook} className="nib-tap flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-ink phone:size-11">
              <StampbookIcon />
            </button>
            <button
              aria-label={`Market, ${props.stamps.points.toLocaleString()} ${props.stamps.points === 1 ? 'coin' : 'coins'}`}
              title="Market"
              onClick={props.stamps.onMarket}
              className="nib-tap flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-lg px-1.5 text-muted hover:text-ink phone:h-11"
            >
              <MarketIcon />
              {props.stamps.points > 0 && <span className="text-[12px] font-medium tabular-nums">{props.stamps.points.toLocaleString()}</span>}
            </button>
          </span>
        )}
        <button aria-label="Settings" onClick={props.onOpenSettings} className="nib-tap nib-gear flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-ink phone:order-2 phone:size-11">
          <Gear />
        </button>
      </header>

      {!elsewhere && (
        <div className="mx-auto flex w-full max-w-[1100px] shrink-0 items-start gap-3 px-5 pt-5 pb-3 phone:px-4 phone:pt-3 phone:pb-2">
          <PlaceChips
            place={place}
            library={props.library}
            archived={props.archived}
            templates={props.templates ?? 0}
            onChange={props.onPlaceChange}
            onManage={props.onManage}
            over={drag.held?.over ?? null}
            landed={landed}
            fresh={fresh}
            naming={naming}
            onName={(inside) => startNaming(undefined, inside)}
            onNamed={named}
          />
          <div className="ml-auto flex shrink-0 items-center gap-4">
            {selected ? (
              <>
                {items.length > 0 && (
                  <button
                    onClick={() => {
                      const next = new Set(selected)
                      for (const { id } of items) {
                        if (allShownMarked) next.delete(id)
                        else next.add(id)
                      }
                      setSelected(next)
                    }}
                    className={controlClass}
                  >
                    {allShownMarked ? 'Select none' : 'Select all'}
                  </button>
                )}
                <button onClick={() => setSelected(null)} className={`${controlClass} font-medium !text-ink`}>
                  Done
                </button>
              </>
            ) : (
              <>
                {kind === 'page' && props.onNewScreenplay && (
                  <button onClick={props.onNewScreenplay} aria-label="New screenplay" className={controlClass}>
                    + Screenplay
                    {props.screenplayPlus && <span className="ml-1 text-[10.5px] text-faint">Plus</span>}
                  </button>
                )}
                {manuscript && (
                  <button onClick={() => setArranging(true)} className={controlClass}>
                    Manuscript
                  </button>
                )}
                {items.length > 0 && (
                  <button onClick={() => setSelected(new Set())} className={controlClass}>
                    Select
                  </button>
                )}
                <button onClick={() => props.onSortChange(nextSort)} className={controlClass}>
                  {SORT_LABEL[props.sort]}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {elsewhere ? (
        // Panels made for a column, kept to one.
        <div className="mx-auto flex min-h-0 w-full max-w-[440px] flex-1 flex-col pt-3">
          {props.panel ?? manuscript!(() => setArranging(false))}
        </div>
      ) : items.length > 0 ? (
        <CardGrid
          key={`${kind}|${place ? JSON.stringify(place) : ''}`}
          items={items}
          arrivals={arrivals.count}
          activeId={props.activeId}
          showKind={searching}
          heldId={drag.held?.item.id}
          selected={selected}
          handlers={handlers}
          library={props.library}
        />
      ) : (
        <div key={kind} className="nib-swap mx-auto flex w-full max-w-[1100px] flex-1 flex-col items-start gap-[5px] px-5 py-4 phone:px-4">
          <span className="text-[13px] text-muted">
            {searching ? 'No matches.' : place && 'templates' in place ? `No ${noun} templates yet.` : place ? `No ${noun}s in ${'archive' in place ? 'the archive' : 'folder' in place ? saidAs(place.folder) : place.category} yet.` : `No ${noun}s yet.`}
          </span>
          {!searching && showsShortcuts && <span className="font-mono text-[11px] whitespace-pre text-faint touch-only:hidden">{`${kind === 'note' ? NEW_NOTE_SHORTCUT : NEW_PAGE_SHORTCUT}  new ${noun}`}</span>}
        </div>
      )}

      {drag.held && (
        <div
          ref={drag.copy}
          aria-hidden
          data-over={drag.held.over !== null || undefined}
          data-landing={drag.held.landing ? (drag.held.landing.into ? 'into' : 'back') : undefined}
          className="nib-held pointer-events-none fixed z-50 max-w-[240px] truncate rounded-lg border border-line bg-paper px-3 py-2 text-[13px] font-semibold shadow-[0_12px_30px_rgba(0,0,0,0.18)]"
          style={heldAt(drag.held)}
        >
          {drag.held.title}
        </div>
      )}

      {/* Selecting on a narrow phone, the five don't always fit beside the count: they go under it whole, not a word of one. */}
      <footer className={`flex shrink-0 items-center gap-[7px] border-t border-line px-5 py-[11px] phone:px-4 ${selected && !elsewhere ? 'flex-wrap gap-y-2' : ''}`}>
        {selected && !elsewhere ? (
          <>
            <span role="status" className="text-[12px] whitespace-nowrap text-muted">
              {picked.length} selected
            </span>
            <div className="ml-auto flex items-center gap-4 phone:gap-3">
              <button disabled={!picked.length} onClick={() => toAll(() => setPinned(ids, !allPinned))} className={actionClass}>
                {allPinned ? 'Unpin' : 'Pin'}
              </button>
              <button disabled={!toFile.length} onClick={() => setFiling(true)} className={actionClass}>
                Move…
              </button>
              <button disabled={!picked.length} onClick={() => toAll(() => setArchived(ids, !allArchived))} className={actionClass}>
                {allArchived ? 'Take out' : 'Archive'}
              </button>
              <button disabled={!picked.length} onClick={() => setExporting(true)} className={actionClass}>
                Export…
              </button>
              <button
                disabled={!picked.length}
                onClick={() => {
                  props.onDelete(ids)
                  setSelected(null)
                }}
                className={actionClass}
              >
                Trash
              </button>
            </div>
          </>
        ) : (
          <>
            {props.notice !== null ? (
              <Banner
                foot
                text={props.notice}
                actions={[
                  ...(props.noticeAction ? [{ label: props.noticeAction.label, run: () => (props.noticeAction!.run(), props.onDismissNotice()) }] : []),
                  { label: 'Dismiss', run: props.onDismissNotice },
                ]}
              />
            ) : (
              <StorageStatus saveFailed={props.saveFailed} plus={props.plus} sync={props.sync} />
            )}
            <span className="flex-1" />
            {!elsewhere && <TrashButton count={trash.length} onOpen={() => props.onViewTrash(true)} />}
          </>
        )}
      </footer>
      {/* Out in the body: a sheet holds everything under it inert (Sheet), and the library is. */}
      {filing && createPortal(<FilingDialog targets={toFile} library={props.library} run={props.run} onClose={() => setSelected(null)} unlimited={props.unlimited} onLimit={props.onLimit} aside={toFile.length < picked.length ? 'Locked notes stay where they are while the vault is shut.' : undefined} />, document.body)}
      {exporting &&
        createPortal(
          <ExportDialog
            count={picked.length}
            plus={props.plus}
            // Asked for Plus, they're still marked for when it's bought. Exported, selecting is over, and what's said of it shows in the foot.
            onExport={(format, making) => props.onExport(ids, format, making).finally(() => (forPlus(format) && !props.plus ? setExporting(false) : setSelected(null)))}
            onClose={() => setExporting(false)}
          />,
          document.body,
        )}
    </div>
  )
}

function KindSwitch({ kind, onChange, className = '' }: { kind: Kind; onChange: (kind: Kind) => void; className?: string }) {
  return (
    <div role="tablist" aria-label="Notes or pages" className={`relative grid w-[210px] shrink-0 grid-cols-2 rounded-[9px] bg-item-active p-[3px] phone:w-full ${className}`}>
      {/* The chosen one's pill, which slides across to the other. */}
      <span aria-hidden data-k={kind === 'page' ? 1 : 0} className="nib-kindknob absolute top-[3px] bottom-[3px] left-[3px] w-[calc(50%-3px)] rounded-[7px] bg-paper shadow-[0_1px_2px_rgba(0,0,0,0.08)]" />
      {(['note', 'page'] as const).map((option) => (
        <button
          key={option}
          role="tab"
          aria-selected={option === kind}
          onClick={() => onChange(option)}
          className={`nib-tap relative h-7 cursor-pointer rounded-[7px] text-[13px] font-medium transition-colors phone:h-[34px] phone:text-[14px] ${option === kind ? 'text-ink' : 'text-muted hover:text-ink'}`}
        >
          {option === 'note' ? 'Notes' : 'Pages'}
        </button>
      ))}
    </div>
  )
}

const controlClass = 'nib-tap flex h-7 cursor-pointer items-center text-[12px] whitespace-nowrap text-muted hover:text-ink pointer-coarse:h-9'
const actionClass = 'nib-tap cursor-pointer text-[13px] font-medium whitespace-nowrap text-ink disabled:cursor-default disabled:text-faint'

// A card gliding to its new place, and one crumpled and tossed in the trash, at Motion's Full.
const GLIDE_MS = 420
const TRASH_MS = 760
/** Cards that rise in on a new grid: as many as a window shows, not the thousands below them. */
const RISING = 30
/** The crumpled card, across (px). */
const BALL = 30

/**
 * A trashed card crumpled into a ball and tossed in an arc into Trash at the
 * library's foot, or where Trash is about to be with the trash empty. A copy
 * flies, on a layer of its own: the card itself is inside the list, which
 * would clip it. Resolves when it's in.
 */
async function toss(card: HTMLElement, ms: number): Promise<unknown> {
  const from = card.getBoundingClientRect()
  const bin = document.querySelector('[data-trash-bin]')?.getBoundingClientRect()
  const foot = document.querySelector('.nib-library footer')?.getBoundingClientRect()
  const to = bin ? { x: bin.left + bin.width / 2, y: bin.top + bin.height / 2 } : foot ? { x: foot.right - 44, y: foot.top + foot.height / 2 } : { x: innerWidth - 44, y: innerHeight - 20 }
  const dx = to.x - (from.left + from.width / 2)
  const dy = to.y - (from.top + from.height / 2)
  // Thrown: up over whichever end is higher, then down into it.
  const apex = Math.min(0, dy) - (70 + Math.min(70, Math.abs(dx) * 0.1))
  const [sx, sy] = [BALL / from.width, BALL / from.height]

  // The ball is the card, its writing giving way to crumpled paper
  // (index.css); its shadow is drawn by a layer that isn't shrunk with it.
  const layer = document.createElement('div')
  layer.className = 'nib-toss'
  layer.setAttribute('aria-hidden', 'true')
  Object.assign(layer.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` })
  const ball = card.cloneNode(true) as HTMLElement
  ball.removeAttribute('data-id')
  ball.removeAttribute('style')
  ball.className = 'nib-ball'
  layer.append(ball)
  document.body.append(layer)
  card.style.visibility = 'hidden'
  // Started once the copy is drawn: on iPhone its first frame can take long
  // enough that the crumple would be over before it was seen.
  for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame)
  for (const writing of ball.children) {
    writing.animate([{ opacity: 1 }, { opacity: 1, offset: 0.16 }, { opacity: 0, offset: 0.36 }], { duration: ms, fill: 'forwards' })
  }

  const flight = ball.animate(
    [
      { transform: 'none', borderRadius: '12px', easing: 'cubic-bezier(0.5, 0, 0.2, 1)' },
      // Crushed in the hand, then balled up. Scaled to a circle before it
      // turns: rotated first, the uneven scale would shear it. Every frame
      // names the same three, so the turns add up rather than cutting short.
      { transform: 'translate(0px, 0px) rotate(-3deg) scale(0.94, 0.84)', borderRadius: '20px', offset: 0.14 },
      { transform: `translate(0px, 0px) rotate(-110deg) scale(${sx * 1.5}, ${sy * 1.5})`, borderRadius: '50%', offset: 0.36 },
      { transform: `translate(0px, 0px) rotate(-150deg) scale(${sx}, ${sy})`, borderRadius: '50%', offset: 0.44, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)' },
      // Up to the top of its arc, then falling in.
      { transform: `translate(${dx * 0.5}px, ${apex}px) rotate(-290deg) scale(${sx}, ${sy})`, borderRadius: '50%', offset: 0.72, easing: 'cubic-bezier(0.55, 0, 0.85, 0.35)' },
      { transform: `translate(${dx}px, ${dy}px) rotate(-420deg) scale(${sx * 0.7}, ${sy * 0.7})`, borderRadius: '50%', opacity: 1, offset: 0.96 },
      { transform: `translate(${dx}px, ${dy}px) rotate(-440deg) scale(0)`, borderRadius: '50%', opacity: 0 },
    ],
    { duration: ms, fill: 'forwards' },
  )
  return flight.finished.finally(() => layer.remove())
}

// New opening out into the new note or page, at Motion's Full.
const OPEN_MS = 380

/**
 * New opening out into the new note or page: a sheet, in the button's colour
 * at first and then the page's, grows from it over the library to fill the
 * window. Covered, `covered` lets the library go, at once rather than in its
 * fade (index.css), which would show through the sheet as it gives way to the
 * page. Resolves when it's gone.
 */
async function openOut(button: HTMLElement, ms: number, covered: () => void): Promise<void> {
  const from = button.getBoundingClientRect()
  const { backgroundColor: ink, borderRadius: round } = getComputedStyle(button)
  // A round button's is near infinite, which would keep the sheet a pill most of the way.
  const borderRadius = `${Math.min(parseFloat(round), from.width / 2, from.height / 2)}px`
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--color-paper').trim()
  const sheet = document.createElement('div')
  sheet.className = 'nib-sheet'
  sheet.setAttribute('aria-hidden', 'true')
  document.body.append(sheet)
  // Started once it's in, as toss is: on iPhone the first frame can be slow.
  for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame)
  const grow = sheet.animate(
    [
      { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, borderRadius, backgroundColor: ink },
      { backgroundColor: paper, offset: 0.3 },
      { left: '0px', top: '0px', width: `${innerWidth}px`, height: `${innerHeight}px`, borderRadius: '0px', backgroundColor: paper },
    ],
    { duration: ms, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
  )
  await grow.finished
  const library = button.closest<HTMLElement>('.nib-library')
  library?.style.setProperty('transition', 'none')
  covered()
  await sheet.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.8, easing: 'ease', fill: 'forwards' }).finished.finally(() => {
    sheet.remove()
    library?.style.removeProperty('transition')
  })
}

/**
 * The cards, as many as the window needs (components/cardWindow), so a library
 * of thousands costs what a screenful does. It stays between returns to the
 * library, and so keeps its place; the first cards in sight rise in again.
 */
function CardGrid({ items, library, arrivals, activeId, showKind, heldId, selected, handlers }: {
  items: Item[]
  /** For each card's folder, its colour and icon. */
  library: Filing
  /** Up by one each time the library comes back. */
  arrivals: number
  activeId: string | null
  showKind: boolean
  heldId: string | undefined
  selected: ReadonlySet<string> | null
  handlers: Pick<Parameters<typeof Card>[0], 'onPress' | 'onSelect' | 'onDelete' | 'onTogglePin' | 'onUse'>
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const [shape] = useState(newShape)
  const [drawn, setDrawn] = useState<Drawn>({ first: 0, last: FIRST_DRAWN })
  const [, reshaped] = useReducer((n: number) => n + 1, 0)
  // Kept in the page however far the list is scrolled from it: the place the keyboard or VoiceOver has in the list.
  const [focused, setFocused] = useState<string | null>(null)
  // After a change of list, its cards going out of reach are in the page till they've glided there.
  const [settled, setSettled] = useState(items)
  const last = useRef({ items, ids: [] as string[] })
  useEffect(() => {
    if (settled === items) return
    const timer = window.setTimeout(() => setSettled(items), GLIDE_MS * motion() + 60)
    return () => clearTimeout(timer)
  }, [settled, items])

  const count = items.length
  const also: number[] = []
  if (focused !== null) {
    const at = items.findIndex((item) => item.id === focused)
    if (at !== -1) also.push(at)
  }
  if (settled !== items) {
    const places = new Map(items.map((item, index) => [item.id, index]))
    for (const id of last.current.ids) {
      const at = places.get(id)
      if (at !== undefined) also.push(at)
    }
  }
  const runs = runsOf(drawn, also, shape.columns, count)
  const order = runs.flatMap(([first, end]) => Array.from({ length: end - first }, (_, offset) => first + offset))

  // What the grid is scrolled to, and whether more of it is wanted.
  const follow = useRef((_reshaped?: boolean) => {})
  follow.current = (changed = false) => {
    if (changed) reshaped()
    const box = grid.current
    const view = scroller.current
    if (!box || !view || !view.clientHeight) return
    const top = view.getBoundingClientRect().top - box.getBoundingClientRect().top
    const height = view.clientHeight
    const need = around(shape, count, top, height, 1)
    setDrawn((now) => (covers(now, need, shape.columns, count) ? now : around(shape, count, top, height, 2)))
  }
  useEffect(() => {
    const view = scroller.current!
    let frame = 0
    const onScroll = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0
        follow.current()
      })
    }
    view.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      view.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  // A card that changes places glides there: pinned to the top, re-sorted, or
  // closing the gap one trashed left. Measured against the grid, so scrolling
  // isn't moving; not across a return to the library, which is a new grid.
  const spots = useRef({ arrivals, at: new Map<string, { x: number; y: number }>() })
  useLayoutEffect(() => {
    const box = grid.current
    if (!box) return
    const sameGrid = spots.current.arrivals === arrivals
    const before = sameGrid ? spots.current.at : new Map<string, { x: number; y: number }>()
    const at = new Map<string, { x: number; y: number }>()
    const cards = [...box.querySelectorAll<HTMLElement>(':scope > [data-id]')]
    // Every place read before any card sets off: each glide started between
    // two reads had the next lay the whole grid out again, which with a few
    // thousand cards held the first letter of a search for seconds.
    for (const card of cards) at.set(card.dataset.id!, { x: card.offsetLeft, y: card.offsetTop })
    spots.current = { arrivals, at }
    const changed = measure(shape, box, cards, order)
    // A card that wasn't in the page: where the list had it.
    const ranks = sameGrid && last.current.items !== items ? new Map(last.current.items.map((item, index) => [item.id, index])) : null
    const lefts: number[] = []
    cards.forEach((card, place) => (lefts[order[place] % shape.columns] ??= card.offsetLeft))
    last.current = { items, ids: order.map((index) => items[index].id) }
    const ms = GLIDE_MS * motion()
    if (ms) {
      // Only what's in the window, coming or going: a search can move thousands.
      const top = -box.getBoundingClientRect().top
      const seen = (y: number) => y > top - 400 && y < top + innerHeight + 400
      for (const card of cards) {
        const id = card.dataset.id!
        const now = at.get(id)!
        const rank = ranks?.get(id)
        const was = before.get(id) ?? (rank === undefined ? undefined : { x: lefts[rank % shape.columns] ?? now.x, y: span(shape, 0, Math.floor(rank / shape.columns)) })
        if (!was || (was.x === now.x && was.y === now.y) || !(seen(was.y) || seen(now.y)) || typeof card.animate !== 'function') continue
        card.animate([{ transform: `translate(${was.x - now.x}px, ${was.y - now.y}px)` }, { transform: 'none' }], { duration: ms, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
      }
    }
    follow.current(changed)
  })

  // Back in the library: the first cards in sight rise in again, as a new grid's do.
  const returned = useRef(arrivals)
  useLayoutEffect(() => {
    if (returned.current === arrivals) return
    returned.current = arrivals
    let risen = 0
    for (const card of grid.current?.querySelectorAll<HTMLElement>(':scope > [data-id]') ?? []) {
      const box = card.getBoundingClientRect()
      if (box.bottom < 0 || box.top > innerHeight || risen >= RISING) continue
      delete card.dataset.arrived
      card.style.setProperty('--i', String(risen++))
    }
  }, [arrivals])

  // Which cards rise in as they're first drawn: the first of a new grid, and one that's new to the list; not one scrolled to.
  const known = useRef<Set<string> | null>(null)
  useLayoutEffect(() => {
    known.current = new Set(items.map((item) => item.id))
  }, [items])
  const [risesIn] = useState(() => (id: string, index: number) => index < RISING && (known.current === null || !known.current.has(id)))

  const rows = (index: number) => Math.ceil(index / shape.columns)
  const empty = (from: number, to: number) => <div key={`to-${to}`} aria-hidden style={{ gridColumn: '1 / -1', height: Math.max(0, span(shape, rows(from), rows(to)) - shape.gap) }} />
  const parts: ReactNode[] = []
  let at = 0
  for (const [first, end] of runs) {
    if (first > at) parts.push(empty(at, first))
    for (let index = first; index < end; index++) {
      const item = items[index]
      const { folder } = filingOf(item)
      const look = folder ? lookOf(library, folder) : {}
      parts.push(
        <Card
          key={item.id}
          item={item}
          folderColor={look.color}
          folderIcon={look.icon}
          index={index}
          active={item.id === activeId}
          showKind={showKind}
          held={heldId === item.id}
          selecting={selected !== null}
          marked={selected?.has(item.id) ?? false}
          when={relativeTime(item.updatedAt)}
          reminder={describeOf(item)}
          expires={item.expires ? describeExpiry(item.expires) : undefined}
          vaultIsOpen={vaultOpen()}
          risesIn={risesIn}
          {...handlers}
        />,
      )
    }
    at = end
  }
  if (at < count) parts.push(empty(at, count))

  return (
    // Room at the top, taken from the row above, for a card lifted under a pointer.
    <div ref={scroller} className="-mt-2 min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-8 phone:px-4 phone:pb-24">
      <div
        ref={grid}
        onFocus={(event) => setFocused((event.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id ?? null)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null)
        }}
        className="relative mx-auto grid max-w-[1100px] grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4"
      >
        {parts}
      </div>
    </div>
  )
}

/** Sets `value` for as long as its animation runs, then clears it, unless another has taken its place. */
function flash(set: Dispatch<SetStateAction<string | null>>, value: string, ms: number) {
  set(value)
  window.setTimeout(() => set((now) => (now === value ? null : now)), ms)
}

/** When the reminder on a document comes, in words. */
function describeOf(item: Item) {
  const at = remindersAvailable ? reminderOf(item) : undefined
  return at === undefined ? undefined : `${describeReminder(at)}${repeatWord(item.reminder) && `, ${repeatWord(item.reminder)}`}`
}

/**
 * The way into the trash, at the library's foot, while there's anything in
 * it. A card tossed in jolts it: each new count is a new span, which jolts
 * once the count has moved at all, so not as it's first drawn.
 */
function TrashButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  const first = useRef(count)
  const moved = useRef(false)
  if (count !== first.current) moved.current = true
  if (count === 0) return null
  return (
    // Whole, on its line: a notice beside it with something to do (Undo) is what wraps, on a phone.
    <button data-trash-bin onClick={onOpen} className="nib-tap shrink-0 cursor-pointer whitespace-nowrap text-[11px] text-muted hover:text-ink">
      <span key={count} data-jolted={moved.current || undefined} className="nib-bin inline-block">
        Trash ({count})
      </span>
    </button>
  )
}

/**
 * One note or page: its title, a little of what follows, and where it's filed,
 * with its pin and trash buttons. Drawn again only for something new: `when`,
 * `reminder` and `expires` are worked out where it's placed, and `vaultIsOpen`, which
 * says what a locked one shows, is passed for that alone.
 */
const Card = memo(function Card({
  item,
  folderColor,
  folderIcon,
  index,
  active,
  showKind,
  held,
  selecting,
  marked,
  when,
  reminder,
  expires,
  risesIn,
  onPress,
  onSelect,
  onDelete,
  onTogglePin,
  onUse,
}: {
  item: Item
  /** Its folder's colour and icon (lib/folders Look), each apart, so a card drawn again is the same card. */
  folderColor: Look['color']
  folderIcon: Look['icon']
  /** Its place in the grid, which sets when it rises in. */
  index: number
  active: boolean
  showKind: boolean
  /** Picked up, to be dropped on a folder or category (components/cardDrag). */
  held: boolean
  /** The library is in its select mode: a tap marks this card rather than opening it. */
  selecting: boolean
  marked: boolean
  /** How long ago it was changed. */
  when: string
  /** When its reminder comes, if it has one. */
  reminder: string | undefined
  /** The day it moves to the trash (lib/expiry), in words, if it has one. */
  expires: string | undefined
  vaultIsOpen: boolean
  /** Whether it rises in, asked as it's first drawn. */
  risesIn: (id: string, index: number) => boolean
  onPress: (event: PointerEvent<HTMLElement>, item: Item) => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onTogglePin: (id: string) => void
  /** For a template: a new note or page from it. */
  onUse: (id: string) => void
}) {
  const pinned = item.pinnedAt !== undefined
  const locked = isLocked(item)
  // A locked note's, only while the vault is open.
  const { folder, categories } = filingOf(item)
  // A locked note's text is sealed with it, so it has no preview.
  const preview = locked ? '' : isScreenplay(item) ? scriptPreview(item.body) : previewOf(item.body)
  // The pin and ×, each its own width, unseen under a pointer till it's over the card or one has the focus; seen always by touch. What's in use while
  // they're unseen (Use, a pin that's in) slides to the card's edge, into their room, and back as they come (index.css .nib-card-tool).
  const tool = 'nib-tap nib-card-tool flex w-7 cursor-pointer items-center justify-center rounded text-[12px] text-muted hover:text-ink pointer-coarse:size-11 pointer-coarse:opacity-100'
  const tucked = 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
  const slid = (by: 'translate-x-7' | 'translate-x-14') => `${by} group-focus-within:translate-x-0 group-hover:translate-x-0 pointer-coarse:translate-x-0`

  // Trashed, it's crumpled and tossed in the trash (toss), then goes, and the
  // cards after it glide up.
  const box = useRef<HTMLDivElement>(null)
  const leaving = useRef(false)
  function trash() {
    const card = box.current
    const ms = TRASH_MS * motion()
    if (leaving.current) return
    if (!ms || !card || typeof card.animate !== 'function') return onDelete(item.id)
    leaving.current = true
    void toss(card, ms).then(() => {
      onDelete(item.id)
      // Still here a moment later, the trash having refused it: back it comes.
      window.setTimeout(() => {
        card.style.visibility = ''
        leaving.current = false
      }, 1000)
    })
  }

  // Too far down to be seen rising, or drawn by being scrolled to, it's there
  // already. Where it was first drawn, only: one moved up later has arrived either way.
  const [rises] = useState(() => risesIn(item.id, index))
  useLayoutEffect(() => {
    if (!rises && box.current) box.current.dataset.arrived = ''
  }, [rises])

  // Pinned, the pin is stood up and pressed in as the card rises to the top;
  // unpinned, it springs out (index.css, data-pinning). Only on a change, and
  // gone once played, or the card would play it again whenever it's moved.
  const wasPinned = useRef(pinned)
  useLayoutEffect(() => {
    if (pinned !== wasPinned.current && box.current) box.current.dataset.pinning = pinned ? 'in' : 'out'
    wasPinned.current = pinned
  }, [pinned])

  return (
    // No text selection or iOS callout: a press is the start of a drag. It
    // rises in once (data-arrived), not again each time it moves.
    <div
      ref={box}
      data-id={item.id}
      data-held={held || undefined}
      onPointerDown={(event) => onPress(event, item)}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return
        event.currentTarget.dataset.arrived = ''
        delete event.currentTarget.dataset.pinning
      }}
      style={{ '--i': index } as CSSProperties}
      className="nib-card group relative select-none [-webkit-touch-callout:none]"
    >
      <button
        aria-pressed={selecting ? marked : undefined}
        onClick={() => onSelect(item.id)}
        className={`flex h-full min-h-[136px] w-full cursor-pointer flex-col gap-2 rounded-xl border px-[18px] pt-4 pb-3.5 text-left phone:min-h-0 ${marked ? 'bg-item-active' : 'bg-paper'} ${
          (selecting ? marked : active) ? 'border-accent' : 'border-line hover:border-faint'
        }`}
      >
        {/* Room on its right for what's showing there: under a pointer only what's in use (Use, a pin that's in) till the pointer's over the card, the
            title giving way as the pin and × open out (index.css .nib-card-tool); by touch all of them, always; the tick while choosing. */}
        <div
          data-title
          className={`w-full truncate text-[15px] font-semibold tracking-[-0.005em] ${
            selecting
              ? 'pr-8'
              : item.template === true
                ? `${pinned ? 'pr-[68px]' : 'pr-10'} group-focus-within:pr-24 group-hover:pr-24 pointer-coarse:pr-32`
                : `${pinned ? 'pr-7' : 'pr-0'} group-focus-within:pr-14 group-hover:pr-14 pointer-coarse:pr-20`
          }`}
        >
          {locked ? (
            // Its title is sealed with it, and known only while the vault is open.
            <>
              <svg role="img" aria-label="Locked" width="9" height="11" viewBox="0 0 9 11" fill="none" className="mr-1.5 inline-block align-[-1px] text-faint">
                <path d="M2 4.6V3a2.5 2.5 0 0 1 5 0v1.6" stroke="currentColor" strokeWidth="1" />
                <rect x=".5" y="4.6" width="8" height="5.9" rx="1.5" stroke="currentColor" strokeWidth="1" />
              </svg>
              {shownTitle(item)}
            </>
          ) : (
            shownTitle(item)
          )}
        </div>
        {preview && <div className="line-clamp-3 flex-1 text-[13px] leading-[1.5] wrap-break-word text-muted phone:line-clamp-2">{preview}</div>}
        <div className="mt-auto flex w-full items-center gap-2 text-[12px] text-muted">
          {/* A screenplay says so, in Pages too (lib/fountain). */}
          {(showKind || isScreenplay(item)) && (
            <>
              <span>{item.kind === 'note' ? 'Note' : isScreenplay(item) ? 'Screenplay' : 'Page'}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="shrink-0 whitespace-nowrap">{when}</span>
          {folder && (
            <span className="flex min-w-0 items-center gap-1">
              <FolderMark look={{ color: folderColor, icon: folderIcon }} />
              <span className="truncate">{saidAs(folder)}</span>
            </span>
          )}
          {reminder && <span>Reminder {reminder}</span>}
          {expires && <span className="shrink-0 whitespace-nowrap">Expires {expires}</span>}
          {item.deviceOnly === true && <span className="shrink-0 whitespace-nowrap">This device only</span>}
          {categories && categories.length > 0 && (
            <span className="ml-auto flex items-center gap-[3px]">
              {categories.map((category) => (
                <CategoryDot key={category.name} color={category.color} name={category.name} />
              ))}
            </span>
          )}
          {/* Its stamps (lib/placed), small, for the eye: they're named on the writing. Sealed with it, while it's locked. */}
          {!locked && item.stamps && item.stamps.length > 0 && (
            <span aria-hidden data-stamps className={`${categories?.length ? '' : 'ml-auto'} flex shrink-0 items-center gap-1.5`}>
              {item.stamps.map((placed) => (
                <span key={placed.no ?? placed.day} className="nib-stamp">
                  <StampArt stamp={drawn(placed)} width={13} />
                </span>
              ))}
            </span>
          )}
        </div>
      </button>
      {selecting ? (
        <span aria-hidden data-tick className={`pointer-events-none absolute top-3.5 right-3.5 flex size-5 items-center justify-center rounded-full border ${marked ? 'border-accent bg-accent text-paper' : 'border-faint'}`}>
          {marked && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      ) : (
      <div className="absolute top-3 right-3 flex items-center pointer-coarse:top-1 pointer-coarse:right-1">
        {/* A template's own: a new note or page from it (lib/templates). The card itself opens the template to change it. */}
        {item.template === true && (
          <button
            aria-label={`Use ${shownTitle(item)}`}
            onClick={() => onUse(item.id)}
            className={`nib-tap nib-card-tool w-10 cursor-pointer rounded-md py-0.5 text-center text-[12px] font-medium text-accent hover:bg-item-hover ${slid(pinned ? 'translate-x-7' : 'translate-x-14')}`}
          >
            Use
          </button>
        )}
        <button
          aria-label={`${pinned ? 'Unpin' : 'Pin'} ${shownTitle(item)}`}
          data-pinned={pinned || undefined}
          onClick={() => onTogglePin(item.id)}
          className={`nib-pin relative ${tool} ${pinned ? slid('translate-x-7') : tucked}`}
        >
          <PinIcon pinned={pinned} />
        </button>
        <button aria-label={`Move ${shownTitle(item)} to trash`} onClick={trash} className={`${tool} ${tucked}`}>
          ×
        </button>
      </div>
      )}
    </div>
  )
})

/** A push pin: leaning and empty, or stood up, filled, its point in the card (index.css's .nib-pin). */
export function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto block">
      <path d="M5.5 1.25h5a.75 .75 0 0 1 0 1.5H10V6c0 1.8 1.1 3.1 2.5 3.5h-9C4.9 9.1 6 7.8 6 6V2.75h-.5a.75 .75 0 0 1 0-1.5z" fill="currentColor" fillOpacity={pinned ? 1 : 0} />
      <path d={pinned ? 'M8 9.5v3' : 'M8 9.5v5.25'} />
    </svg>
  )
}

/** The Stampbook: an album, a perforated stamp on its cover. */
function StampbookIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v16H6.5A1.5 1.5 0 0 0 5 20.5z" />
      <path d="M5 20.5A1.5 1.5 0 0 0 6.5 22H19v-3" />
      <rect x="9.5" y="7" width="6" height="7" rx="0.6" strokeDasharray="1.4 1.2" />
    </svg>
  )
}

/** The market: a Nib coin, the nib on its face (components/Coin). */
function MarketIcon() {
  return <Coin size={19} plain />
}

export function Gear() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

/** Where the writing is kept, or that it can't be: the foot of the library. */
function StorageStatus({ saveFailed, plus, sync }: Pick<LibraryProps, 'saveFailed' | 'plus' | 'sync'>) {
  if (saveFailed) return <Banner foot text={CANT_SAVE} />
  return (
    <>
      {plus || (sync.code && sync.status.state !== 'inactive') ? (
        <img src={badge} alt="Nib Plus" data-plus-badge className="size-3.5 shrink-0" />
      ) : (
        <svg width="9" height="11" viewBox="0 0 9 11" fill="none" className="shrink-0 text-muted">
          <path d="M2 4.6V3a2.5 2.5 0 0 1 5 0v1.6" stroke="currentColor" strokeWidth="1" />
          <rect x=".5" y="4.6" width="8" height="5.9" rx="1.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      )}
      <span className="truncate text-[11px] whitespace-nowrap text-muted">{sync.code ? describeSync(sync.status).split(' —')[0] : 'Stored on this device'}</span>
    </>
  )
}
