import { createElement, Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Item } from '../db/db'
import { FOLDER_ICONS } from '../lib/folderIcons'
import { arrange, setOwn, settingOf, useFolderSettings } from '../lib/folderSettings'
import { ACCENTS, type Accent } from '../lib/look'
import { motion } from '../lib/motion'
import { shownTitle } from '../lib/vault'
import {
  canMake,
  cantRename,
  FREE_CATEGORIES,
  FREE_FOLDERS,
  makeCategory,
  makeFolder,
  MAX_NAME,
  movedInto,
  movesFor,
  recolorCategory,
  removeCategory,
  removeFolder,
  renameCategory,
  renameFolder,
  sameName,
  split,
  treeOf,
  under,
  within,
  type Folder,
  type Library,
  type Look,
  type Place,
} from '../lib/folders'
import { useChipDrag } from './chipDrag'
import { InkLine } from './InkLine'

/**
 * Folders and categories in the library (lib/folders): the row that chooses
 * what the list shows, and the panel that makes, renames, recolours and
 * removes them. Removing one never removes a document: they stay, unfiled.
 */

/** A category's colour, in the light or dark shade of its accent. */
export function CategoryDot({ color, name, size = 7 }: { color: Accent; name?: string; size?: number }) {
  return (
    <span
      role={name ? 'img' : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : true}
      title={name}
      style={{ '--light': ACCENTS[color].light, '--dark': ACCENTS[color].dark, width: size, height: size } as CSSProperties}
      className="inline-block shrink-0 rounded-full bg-[var(--light)] dark:bg-[var(--dark)]"
    />
  )
}

export function FolderIcon() {
  // Its back and its front, one outline until a folder's chip is under a
  // pointer, when the front tips open and shows its edge (index.css).
  return (
    <svg aria-hidden="true" width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1" className="shrink-0">
      <path d="M1 3.5V2a1 1 0 0 1 1-1h2.6l1.2 1.3H10a1 1 0 0 1 1 1v.2" />
      <g className="nib-folder-front">
        <path d="M1 3.5V8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V3.5" />
        <path d="M1 3.5h10" className="nib-folder-edge" />
      </g>
    </svg>
  )
}

/**
 * A folder as it shows itself (lib/folders Look): its icon, or Nib's own
 * folder, in its colour, in the light or dark shade of its accent, or in the
 * text's. `onInk`: on a chosen chip, whose ground is the text's colour, so
 * the other shade, which reads on it.
 */
export function FolderMark({ look, onInk = false }: { look?: Look; onInk?: boolean }) {
  const icon = look?.icon ? FOLDER_ICONS[look.icon] : undefined
  const mark = icon ? (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {icon.shapes.map(([tag, attributes], index) => createElement(tag, { key: index, ...attributes }))}
    </svg>
  ) : (
    <FolderIcon />
  )
  if (!look?.color) return mark
  return (
    <span style={{ '--light': ACCENTS[look.color][onInk ? 'dark' : 'light'], '--dark': ACCENTS[look.color][onInk ? 'light' : 'dark'] } as CSSProperties} className="flex shrink-0 text-[var(--light)] dark:text-[var(--dark)]">
      {mark}
    </span>
  )
}

/**
 * What the list shows, as a row: everything, a folder's, or a category's.
 * A card dropped on a folder or category is filed there (`data-drop`,
 * components/cardDrag), and "+ New folder" takes a name in place, a card
 * dropped on it going into the folder it makes. The folders inside one show
 * after it while it, or one of them, is what the list shows, with
 * "+ Subfolder" for another. A folder's chip is moved along the row among
 * those beside it to put them in an order of one's own (chipDrag).
 */
export function PlaceChips({
  place,
  library,
  archived,
  templates,
  onChange,
  onManage,
  over,
  landed,
  fresh,
  naming,
  onName,
  onNamed,
}: {
  place: Place
  library: Library
  /** How many are in the archive, whose chip comes with the first, and how many templates (lib/templates), the same way. */
  archived: number
  templates: number
  onChange: (place: Place) => void
  onManage: () => void
  /** The `data-drop` of the chip a card is held over, and of the one a card just landed in. */
  over: string | null
  landed: string | null
  /** A folder just made here, which arrives with a burst. */
  fresh: string | null
  /** "+ New folder" is a field for the new one's name, or "+ Subfolder" is, in the folder `inside`. */
  naming: { inside?: string } | null
  /** A new folder is to be named: inside `inside`, if that's given. */
  onName: (inside?: string) => void
  /** The name given, or nothing. */
  onNamed: (name: string) => void
}) {
  // `open`: a folder whose own folders are showing, with one of them chosen and not it.
  const chip = (selected: boolean, drop?: string, open = false) =>
    `nib-tap nib-chip relative flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12px] whitespace-nowrap pointer-coarse:h-9 pointer-coarse:text-[13px] ${
      drop !== undefined && over === drop ? 'border-accent bg-accent text-paper' : selected ? 'border-ink bg-ink text-paper' : open ? 'border-ink text-ink' : 'border-line text-muted hover:text-ink'
    }`
  // How wide "+ New folder" was when clicked, for its field to open out from.
  const opened = useRef(0)
  const chipDrag = useChipDrag()
  const { moving, settled } = chipDrag
  // Each chip's motion is index.css's: swelling under a held card, taking one in, arriving new; and a folder's, let go in its new place, settling as one does taking a card.
  const states = (drop: string) => ({
    'data-over': over === drop || undefined,
    'data-landed': landed === drop || (settled !== null && drop.startsWith('folder:') && sameName(drop.slice('folder:'.length), settled)) || undefined,
  })
  // While a chip is moved, the others slide to the places it leaves them, from where they were (FLIP), not jump there.
  const row = useRef<HTMLDivElement>(null)
  const laidOut = useRef(new Map<string, DOMRect>())
  useLayoutEffect(() => {
    const now = new Map<string, DOMRect>()
    for (const one of row.current?.querySelectorAll<HTMLElement>('[data-drop^="folder:"]') ?? []) {
      const box = one.getBoundingClientRect()
      const was = laidOut.current.get(one.dataset.drop!)
      now.set(one.dataset.drop!, box)
      if (!moving || !was || (was.left === box.left && was.top === box.top) || !motion()) continue
      one.animate([{ translate: `${was.left - box.left}px ${was.top - box.top}px` }, { translate: '0 0' }], { duration: 260 * motion(), easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' })
    }
    laidOut.current = now
  })
  // As they're laid out, the folders beside one being moved in the order it's making as it goes.
  const ordered = <T,>(list: T[], nameOf: (one: T) => string) => {
    if (!moving || !list.some((one) => sameName(nameOf(one), moving.name))) return list
    const at = (one: T) => moving.order.findIndex((name) => sameName(name, nameOf(one)))
    return [...list].sort((a, b) => at(a) - at(b))
  }
  const tree = ordered(treeOf(library), ({ folder }) => folder.name).map(({ folder, inside }) => ({ folder, inside: ordered(inside, (one) => one.name) }))
  const tops = tree.map(({ folder }) => folder.name)
  const showingArchive = place !== null && 'archive' in place
  const showingTemplates = place !== null && 'templates' in place
  const showing = (chosen: { folder: string } | { category: string }) =>
    Boolean(place && ('folder' in chosen ? 'folder' in place && sameName(place.folder, chosen.folder) : 'category' in place && sameName(place.category, chosen.category)))

  // A folder's chip, moved among `beside`. One inside another is called by its own name, said to be in the other, with a mark before it in place of the folder.
  const folderChip = (folder: Folder, name: string, open: boolean, beside: string[], inside?: string) => (
    <button
      key={`folder:${folder.name}`}
      data-drop={`folder:${folder.name}`}
      {...states(`folder:${folder.name}`)}
      data-fresh={(fresh !== null && sameName(fresh, folder.name)) || undefined}
      data-held={(moving !== null && sameName(moving.name, folder.name)) || undefined}
      aria-pressed={showing({ folder: folder.name })}
      aria-label={inside === undefined ? undefined : `${name}, in ${inside}, ${folder.count}`}
      onPointerDown={(event) => chipDrag.press(event, folder.name, beside)}
      onClick={() => !chipDrag.justMoved() && onChange({ folder: folder.name })}
      // No text selection or iOS callout: a press may be the start of a move.
      className={`${chip(showing({ folder: folder.name }), `folder:${folder.name}`, open && !showing({ folder: folder.name }))} select-none [-webkit-touch-callout:none]`}
    >
      {inside === undefined ? (
        <FolderMark look={folder} onInk={showing({ folder: folder.name })} />
      ) : (
        <>
          {/* Under the pointer it steps in, as a folder's mark opens (index.css `.nib-sub-mark`). */}
          <span aria-hidden="true" className="nib-sub-mark inline-block opacity-60">
            ›
          </span>
          {(folder.color || folder.icon) && <FolderMark look={folder} onInk={showing({ folder: folder.name })} />}
        </>
      )}
      {name} <Count n={folder.count} />
    </button>
  )

  // Opening out from the chip's width (index.css), with an empty folder.
  const nameField = (label: string, placeholder: string, most: number) => (
    <label style={opened.current ? ({ '--from': `${opened.current}px` } as CSSProperties) : undefined} className="nib-chip-field flex h-7 w-[150px] shrink-0 items-center gap-1.5 overflow-hidden rounded-full border border-accent bg-paper px-3 text-muted pointer-coarse:h-9">
      <FolderIcon />
      {/* Enter or leaving it makes the folder; Escape leaves it unmade. */}
      <input
        autoFocus
        aria-label={label}
        placeholder={placeholder}
        maxLength={Math.max(1, most)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.value = ''
          if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
        }}
        onBlur={(event) => onNamed(event.currentTarget.value)}
        className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-muted pointer-coarse:text-[16px]"
      />
    </label>
  )

  return (
    <div ref={row} role="group" aria-label="Show" className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <button aria-pressed={!place} onClick={() => onChange(null)} className={chip(!place)}>
        All
      </button>
      {tree.map(({ folder, inside }) => {
        const open = place !== null && 'folder' in place && under(place.folder, folder.name)
        const insideNames = inside.map((one) => one.name)
        return (
          <Fragment key={`folder:${folder.name}`}>
            {folderChip(folder, folder.name, open && inside.length > 0, tops)}
            {open && inside.map((one) => folderChip(one, split(one.name).name, false, insideNames, folder.name))}
            {open &&
              (naming?.inside !== undefined && sameName(naming.inside, folder.name) ? (
                nameField(`New folder in ${folder.name}`, 'Subfolder name', MAX_NAME - folder.name.length - 1)
              ) : (
                <button
                  onClick={(event) => {
                    opened.current = event.currentTarget.offsetWidth
                    onName(folder.name)
                  }}
                  className={chip(false)}
                >
                  <span className="relative">
                    + Subfolder
                    <InkLine />
                  </span>
                </button>
              ))}
          </Fragment>
        )
      })}
      {library.categories.map((category) => (
        <button
          key={`category:${category.name}`}
          data-drop={`category:${category.name}`}
          {...states(`category:${category.name}`)}
          aria-pressed={showing({ category: category.name })}
          onClick={() => onChange({ category: category.name })}
          className={chip(showing({ category: category.name }), `category:${category.name}`)}
        >
          <CategoryDot color={category.color} />
          {category.name} <Count n={category.count} />
        </button>
      ))}
      {(archived > 0 || showingArchive) && (
        <button data-drop="archive" {...states('archive')} aria-pressed={showingArchive} onClick={() => onChange({ archive: true })} className={chip(showingArchive, 'archive')}>
          Archive <Count n={archived} />
        </button>
      )}
      {(templates > 0 || showingTemplates) && (
        <button aria-pressed={showingTemplates} onClick={() => onChange({ templates: true })} className={chip(showingTemplates)}>
          Templates <Count n={templates} />
        </button>
      )}
      {naming && naming.inside === undefined ? (
        nameField('New folder', 'Folder name', MAX_NAME)
      ) : (
        <button
          data-drop="new"
          {...states('new')}
          onClick={(event) => {
            opened.current = event.currentTarget.offsetWidth
            onName()
          }}
          className={chip(false, 'new')}
        >
          <span className="relative">
            + New folder
            <InkLine />
          </span>
        </button>
      )}
      {(library.folders.length > 0 || library.categories.length > 0) && (
        <button aria-label="Edit folders and categories" onClick={onManage} className="nib-tap shrink-0 cursor-pointer px-1 text-[12px] text-muted hover:text-ink">
          Edit
        </button>
      )}
    </div>
  )
}

/**
 * How many a chip holds. Each new number is a new span, which rolls in once
 * the count has moved at all: the number it was first drawn with doesn't.
 */
function Count({ n }: { n: number }) {
  const first = useRef(n)
  const moved = useRef(false)
  if (n !== first.current) moved.current = true
  return (
    <span key={n} data-rolled={moved.current || undefined} className="nib-count inline-block text-[11px] opacity-60">
      {n}
    </span>
  )
}

type Editing = { kind: 'folder' | 'category'; name: string; value: string } | null

/** Make, rename, recolour and remove: in place of the list, like Trash. */
export function FoldersPanel({
  library,
  onBack,
  run,
  onRenamed,
  unlimited,
  onLimit,
  templates = [],
}: {
  library: Library
  onBack: () => void
  run: (action: () => Promise<unknown>) => void
  /** So the list showing the one renamed goes on showing it. */
  onRenamed: (from: string, to: string) => void
  /** Nib Plus: no limit on how many (lib/folders FREE_FOLDERS). */
  unlimited: boolean
  /** One more than free Nib makes was asked for. */
  onLimit: (kind: 'folder' | 'category' | 'look') => void
  /** The templates there are to give a folder (lib/templates), the locked left out. */
  templates?: Item[]
}) {
  const [folderName, setFolderName] = useState('')
  const settings = useFolderSettings()
  // The folder whose template is being chosen.
  const [templating, setTemplating] = useState<string | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [color, setColor] = useState<Accent>('blue')
  const [editing, setEditing] = useState<Editing>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [coloring, setColoring] = useState<string | null>(null)
  // The folder whose places to move to are showing under it, and the one whose colour and icon are.
  const [moving, setMoving] = useState<string | null>(null)
  const [dressing, setDressing] = useState<string | null>(null)
  // Up or Down, just pressed, to have the focus again once its folder has moved: WebKit drops it from a row as the rows are put in order (Chromium keeps it).
  const pressed = useRef<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const taken = (kind: 'folder' | 'category', name: string, except?: string) =>
    (kind === 'folder' ? library.folders : library.categories).some((entry) => sameName(entry.name, name) && !(except && sameName(except, name)))

  function rename() {
    if (!editing) return
    const value = editing.value.trim()
    setEditing(null)
    // A folder inside another is renamed by its own name, and stays where it is.
    const { parent, name: was } = editing.kind === 'folder' ? split(editing.name) : { parent: null, name: editing.name }
    if (!value || value === was) return
    const name = parent === null ? value : within(parent, value)
    if (taken(editing.kind, name, editing.name)) return setMessage(`There’s already a ${editing.kind} called “${value}”.`)
    const why = editing.kind === 'folder' ? cantRename(editing.name, name, library) : null
    if (why) return setMessage(why)
    setMessage(null)
    onRenamed(editing.name, name)
    run(() => (editing.kind === 'folder' ? renameFolder(editing.name, name) : renameCategory(editing.name, name)))
  }

  /** Into another folder, or out of the one it's in: by its new name, as a rename is, so what's in it and the list showing it go with it. */
  function move(name: string, into: string | null) {
    const next = movedInto(name, into)
    setMoving(null)
    if (taken('folder', next)) return setMessage(`There’s already a folder called “${split(next).name}” ${into === null ? `outside ${split(name).parent}` : `in ${into}`}.`)
    const why = cantRename(name, next, library)
    if (why) return setMessage(why)
    setMessage(null)
    onRenamed(name, next)
    run(() => renameFolder(name, next))
  }

  // As the list is laid out, and the folders at the top, side by side.
  const tree = treeOf(library)
  const tops = tree.map(({ folder }) => folder.name)

  const field =
    'h-[30px] min-w-0 flex-1 rounded-md border border-line bg-paper px-[9px] text-[12px] outline-none placeholder:text-muted pointer-coarse:h-11 pointer-coarse:text-[16px]'
  const quiet = 'nib-tap cursor-pointer text-[11px] text-muted hover:text-ink disabled:cursor-default disabled:opacity-50'

  // `shown`: what it's called in its row, which for a folder inside another is its own name. `more`: what its row has before Rename.
  const row = (kind: 'folder' | 'category', name: string, count: number, lead: ReactNode, shown = name, more?: ReactNode) => {
    const key = `${kind}:${name}`
    const armed = removing === key
    if (editing && editing.kind === kind && editing.name === name) {
      return (
        <form
          key={key}
          onSubmit={(event) => {
            event.preventDefault()
            rename()
          }}
          className="flex items-center gap-2 px-2 py-1"
        >
          <input
            autoFocus
            aria-label={`New name for ${shown}`}
            value={editing.value}
            maxLength={MAX_NAME}
            onChange={(event) => setEditing({ ...editing, value: event.target.value })}
            onKeyDown={(event) => event.key === 'Escape' && setEditing(null)}
            onBlur={rename}
            className={field}
          />
        </form>
      )
    }
    return (
      <div key={key} className="group flex items-center gap-2 rounded-md px-2 py-[7px] hover:bg-item-hover pointer-coarse:py-2.5">
        {lead}
        <span className="min-w-0 flex-1 truncate text-[13px]">{shown}</span>
        <span className="text-[11px] text-muted">{count}</span>
        {more}
        <button onClick={() => setEditing({ kind, name, value: shown })} className={`${quiet} opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100`}>
          Rename
        </button>
        <button
          aria-label={armed ? undefined : `Remove ${shown}`}
          onClick={() => (armed ? (setRemoving(null), run(() => (kind === 'folder' ? removeFolder(name) : removeCategory(name)))) : setRemoving(key))}
          onBlur={() => setRemoving(null)}
          className={`nib-tap cursor-pointer text-[11px] ${armed ? 'font-medium text-ink' : 'text-muted opacity-0 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 pointer-coarse:opacity-100'}`}
        >
          {armed ? 'Remove?' : '×'}
        </button>
      </div>
    )
  }

  /** One of `beside`, the folders side by side, a place up (-1) or down (1), and from then on all of them in that order (lib/folderSettings). */
  function shift(beside: string[], name: string, by: -1 | 1) {
    const at = beside.findIndex((one) => sameName(one, name))
    if (at + by < 0 || at + by >= beside.length) return
    const order = [...beside]
    ;[order[at], order[at + by]] = [order[at + by], order[at]]
    arrange(order)
  }

  // A folder's row, with Move where there's somewhere for it to go, earlier or later among `beside` or into another, and those under it once that's asked.
  const folderRow = (folder: Folder, beside: string[], shown = folder.name) => {
    const at = beside.findIndex((one) => sameName(one, folder.name))
    const above = at > 0 ? beside[at - 1] : undefined
    // Into the folder right above it, as in an outline, so it follows as Up and Down move it; and out of the one it's in.
    const places = movesFor(folder.name, library).filter((into) => into === null || (above !== undefined && sameName(into, above)))
    const open = moving === folder.name
    const reveal = 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100'
    const step = (by: -1 | 1, label: string) => {
      const id = `${folder.name}:${by}`
      const none = at + by < 0 || at + by >= beside.length
      return (
        <button
          ref={(button) => {
            if (button && pressed.current === id) {
              pressed.current = null
              button.focus()
            }
          }}
          aria-label={`Move ${shown} ${label.toLowerCase()}`}
          aria-disabled={none || undefined}
          onClick={() => {
            if (none) return
            pressed.current = id
            shift(beside, folder.name, by)
          }}
          className={`nib-tap flex h-7 cursor-pointer items-center rounded-full border border-line px-3 text-[12px] text-muted pointer-coarse:h-9 pointer-coarse:text-[13px] ${none ? 'cursor-default opacity-40' : 'hover:text-ink'}`}
        >
          {label}
        </button>
      )
    }
    const dressed = dressing === folder.name
    return (
      <Fragment key={folder.name}>
        {row(
          'folder',
          folder.name,
          folder.count,
          // Nib Plus: without it, what's set stays, and setting more asks for it.
          <button
            aria-label={`Colour and icon of ${shown}`}
            aria-expanded={dressed}
            onClick={() => (unlimited ? setDressing(dressed ? null : folder.name) : onLimit('look'))}
            className="nib-tap flex size-4 cursor-pointer items-center justify-center"
          >
            <FolderMark look={folder} />
          </button>,
          shown,
          <>
            {templates.length > 0 && (
              <button aria-label={`Template for ${shown}`} aria-expanded={templating === folder.name} onClick={() => setTemplating(templating === folder.name ? null : folder.name)} className={`${quiet} ${templating === folder.name ? '' : reveal}`}>
                Template
              </button>
            )}
            {(places.length > 0 || beside.length > 1) && (
              <button aria-label={`Move ${shown}`} aria-expanded={open} onClick={() => setMoving(open ? null : folder.name)} className={`${quiet} ${open ? '' : reveal}`}>
                Move
              </button>
            )}
          </>,
        )}
        {dressed && <LookPicker name={folder.name} shown={shown} />}
        {templating === folder.name && <TemplateChoice name={folder.name} shown={shown} own={settingOf(settings, folder.name)?.template} templates={templates} />}
        {open && (
          <div role="group" aria-label={`Move ${shown}`} className="flex flex-wrap gap-1.5 px-2 pt-0.5 pb-2 pl-7">
            {beside.length > 1 && (
              <>
                {step(-1, 'Up')}
                {step(1, 'Down')}
              </>
            )}
            {places.map((into) => (
              <button
                key={into ?? ''}
                onClick={() => move(folder.name, into)}
                className="nib-tap flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 text-[12px] text-muted hover:text-ink pointer-coarse:h-9 pointer-coarse:text-[13px]"
              >
                {into === null ? `Out of ${split(folder.name).parent}` : `Into ${into}`}
              </button>
            ))}
          </div>
        )}
      </Fragment>
    )
  }

  return (
    <div className="nib-swap flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 pb-2">
        <button onClick={onBack} className={quiet}>
          ← Back
        </button>
        <span className="text-[11px] text-faint">Folders and categories</span>
      </div>

      <p className="px-4 pb-2 text-[11px] leading-[1.5] text-muted">Shared by notes and pages. Removing one keeps everything that was in it. For a folder inside another, give both names, Novel/Part 1, or Move one there.</p>

      <h3 className="flex justify-between px-4 pt-2 pb-1 text-[11px] font-medium text-muted">
        Folders
        {!unlimited && library.folders.length >= FREE_FOLDERS && <span className="font-normal">{FREE_FOLDERS} free · Plus for more</span>}
      </h3>
      <div className="flex flex-col gap-px px-2">
        {tree.map(({ folder, inside }) => (
          <Fragment key={folder.name}>
            {folderRow(folder, tops)}
            {inside.map((one) => (
              <div key={one.name} className="pl-5">
                {folderRow(
                  one,
                  inside.map(({ name }) => name),
                  split(one.name).name,
                )}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (taken('folder', folderName.trim())) return setMessage(`There’s already a folder called “${folderName.trim()}”.`)
          if (!canMake('folder', library, unlimited)) return onLimit('folder')
          if (makeFolder(folderName, library)) {
            setFolderName('')
            setMessage(null)
          }
        }}
        className="flex items-center gap-2 px-4 pt-1.5 pb-3"
      >
        <input value={folderName} maxLength={MAX_NAME} onChange={(event) => setFolderName(event.target.value)} placeholder="New folder" aria-label="New folder" className={field} />
        <button type="submit" disabled={!folderName.trim()} className={quiet}>
          Add
        </button>
      </form>

      <h3 className="flex justify-between px-4 pt-2 pb-1 text-[11px] font-medium text-muted">
        Categories
        {!unlimited && library.categories.length >= FREE_CATEGORIES && <span className="font-normal">{FREE_CATEGORIES} free · Plus for more</span>}
      </h3>
      <div className="flex flex-col gap-px px-2">
        {library.categories.map((category) => (
          <div key={category.name}>
            {row(
              'category',
              category.name,
              category.count,
              <button
                aria-label={`Colour of ${category.name}`}
                aria-expanded={coloring === category.name}
                onClick={() => setColoring(coloring === category.name ? null : category.name)}
                className="nib-tap flex size-4 cursor-pointer items-center justify-center"
              >
                <CategoryDot color={category.color} size={9} />
              </button>,
            )}
            {coloring === category.name && (
              <div className="px-2">
                <Swatches
                  label={`Colour of ${category.name}`}
                  chosen={category.color}
                  onChoose={(next) => {
                    if (!next) return
                    setColoring(null)
                    run(() => recolorCategory(category.name, next))
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (taken('category', categoryName.trim())) return setMessage(`There’s already a category called “${categoryName.trim()}”.`)
          if (!canMake('category', library, unlimited)) return onLimit('category')
          if (makeCategory(categoryName, color, library)) {
            setCategoryName('')
            setMessage(null)
          }
        }}
        className="px-4 pt-1.5 pb-3"
      >
        <div className="flex items-center gap-2">
          <input value={categoryName} maxLength={MAX_NAME} onChange={(event) => setCategoryName(event.target.value)} placeholder="New category" aria-label="New category" className={field} />
          <button type="submit" disabled={!categoryName.trim()} className={quiet}>
            Add
          </button>
        </div>
        <Swatches label="Colour of the new category" chosen={color} onChoose={(next) => next && setColor(next)} />
      </form>

      {message && (
        <p role="status" className="px-4 pb-3 text-[11px] leading-[1.5] text-ink">
          {message}
        </p>
      )}
    </div>
  )
}

/**
 * A folder's template (lib/templates): new documents of its kind written in
 * it start from it. None, for a folder inside another, is that one's.
 */
function TemplateChoice({ name, shown, own, templates }: { name: string; shown: string; own: string | undefined; templates: Item[] }) {
  const { parent } = split(name)
  // A long title gives way, not the kind it's for.
  const choice = (id: string | null, label: string, kind?: string) => (
    <button
      key={id ?? ''}
      type="button"
      role="radio"
      aria-checked={(own ?? null) === id}
      onClick={() => setOwn(name, { template: id })}
      className={`nib-tap flex h-7 max-w-full cursor-pointer items-center rounded-full border px-3 text-[12px] pointer-coarse:h-9 pointer-coarse:text-[13px] ${(own ?? null) === id ? 'border-ink bg-ink text-paper' : 'border-line text-muted hover:text-ink'}`}
    >
      <span className="truncate">{label}</span>
      {kind && <span className="shrink-0 whitespace-pre"> · {kind}</span>}
    </button>
  )
  return (
    <div role="radiogroup" aria-label={`Template for ${shown}`} className="flex flex-wrap gap-1.5 px-2 pt-0.5 pb-2 pl-7">
      {choice(null, parent === null ? 'None' : `As ${parent}`)}
      {templates.map((template) => choice(template.id, shownTitle(template), template.kind === 'note' ? 'notes' : 'pages'))}
    </div>
  )
}

/**
 * A folder's colour and icon (lib/folderSettings), each of its own or none:
 * for a folder inside another, none is that one's.
 */
function LookPicker({ name, shown }: { name: string; shown: string }) {
  const own = settingOf(useFolderSettings(), name)
  const color = own?.color && own.color in ACCENTS ? (own.color as Accent) : null
  const icon = own?.icon && own.icon in FOLDER_ICONS ? own.icon : null
  const { parent } = split(name)
  return (
    <div className="px-2 pb-2 pl-7">
      <Swatches label={`Colour of ${shown}`} chosen={color} none={parent === null ? 'No colour' : `As ${parent}`} onChoose={(next) => setOwn(name, { color: next })} />
      <div role="radiogroup" aria-label={`Icon of ${shown}`} className="grid grid-cols-8 justify-items-center gap-1 pt-1 pb-1 pointer-coarse:grid-cols-6 pointer-coarse:gap-2">
        {[null, ...Object.keys(FOLDER_ICONS)].map((key) => (
          <button
            key={key ?? ''}
            type="button"
            role="radio"
            aria-checked={key === icon}
            aria-label={key === null ? (parent === null ? 'Folder' : `As ${parent}`) : FOLDER_ICONS[key].label}
            onClick={() => setOwn(name, { icon: key })}
            className={`nib-tap flex size-[26px] cursor-pointer items-center justify-center rounded-md text-muted pointer-coarse:size-9 ${key === icon ? 'bg-item-active text-ink ring-1 ring-muted' : 'hover:bg-item-hover hover:text-ink'}`}
          >
            <FolderMark look={{ color: color ?? undefined, icon: key ?? undefined }} />
          </button>
        ))}
      </div>
    </div>
  )
}

/** The accents to choose from, and first, when `none` names it, none. */
function Swatches({ label, chosen, none, onChoose }: { label: string; chosen: Accent | null; none?: string; onChoose: (color: Accent | null) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className={`grid justify-items-center gap-1 pt-2 pb-1 pointer-coarse:gap-2 ${none ? 'grid-cols-9 pointer-coarse:grid-cols-5' : 'grid-cols-8 pointer-coarse:grid-cols-4'}`}>
      {none && (
        <button
          type="button"
          role="radio"
          aria-checked={chosen === null}
          aria-label={none}
          onClick={() => onChoose(null)}
          className={`nib-tap flex size-[22px] cursor-pointer items-center justify-center rounded-full pointer-coarse:size-9 ${chosen === null ? 'ring-2 ring-muted' : ''}`}
        >
          <span className="size-[14px] rounded-full border border-dashed border-muted" />
        </button>
      )}
      {(Object.keys(ACCENTS) as Accent[]).map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === chosen}
          aria-label={ACCENTS[color].label}
          onClick={() => onChoose(color)}
          className={`nib-tap flex size-[22px] cursor-pointer items-center justify-center rounded-full pointer-coarse:size-9 ${color === chosen ? 'ring-2 ring-muted' : ''}`}
        >
          <CategoryDot color={color} size={14} />
        </button>
      ))}
    </div>
  )
}
