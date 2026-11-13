import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Item } from '../db/db'
import { shortcut, showsShortcuts } from '../lib/platform'
import { shownTitle } from '../lib/vault'
import { Sheet } from './Sheet'

export type Command = {
  id: string
  label: string
  hint?: string
  /** Listed only once something is typed. The formats live here, and twenty of them would bury an empty palette. */
  searchOnly?: boolean
  /** Shown on every device, unlike `hint`, which is a keyboard shortcut. "Plus" for what needs Nib Plus. */
  badge?: string
  run: () => void
}

type Row =
  | { kind: 'command'; command: Command }
  | { kind: 'item'; item: Item }

/** Stable across re-renders, so the highlight can follow a row rather than a slot. */
const keyOf = (row: Row) => (row.kind === 'command' ? row.command.id : row.item.id)

export function CommandPalette({
  items,
  commands,
  onSelectItem,
  onClose,
  focusSearch = true,
  placeholder = 'Type a command, or search your writing',
  listItems = false,
}: {
  items: Item[]
  commands: Command[]
  onSelectItem: (id: string) => void
  onClose: () => void
  focusSearch?: boolean
  placeholder?: string
  /** Choosing a document (Open beside): the documents listed before anything is typed, in the order given. */
  listItems?: boolean
}) {
  const [query, setQuery] = useState('')
  const [cursorKey, setCursorKey] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // The field names the row the arrow keys are on, which VoiceOver then reads, as the focus stays in the field.
  const listId = useId()
  const rowId = (index: number) => `${listId}-${index}`

  const rows = useMemo<Row[]>(() => {
    const needle = query.trim().toLowerCase()
    const matched = commands.filter(
      (command) => (needle || !command.searchOnly) && command.label.toLowerCase().includes(needle),
    )
    // Documents only appear once you type — an empty palette is a menu.
    const documents = needle
      ? items.filter((item) => shownTitle(item).toLowerCase().includes(needle)).slice(0, 8)
      : listItems
        ? items.slice(0, 50)
        : []
    return [
      ...matched.map((command) => ({ kind: 'command' as const, command })),
      ...documents.map((item) => ({ kind: 'item' as const, item })),
    ]
  }, [commands, items, query, listItems])

  // The rows are rebuilt on every render, and the item-scoped commands appear
  // partway down the list the moment a draft becomes a real document. A bare
  // index would then slide onto a different command — including "Move this to
  // trash" — so the highlight tracks a row's identity and its position is
  // derived. A row that disappears falls back to the first.
  const cursor = Math.max(
    0,
    rows.findIndex((row) => keyOf(row) === cursorKey),
  )

  // Any change to the result set invalidates where the cursor was pointing.
  useEffect(() => setCursorKey(null), [query])

  const search = useRef<HTMLInputElement>(null)

  // Opened by touch, nothing here takes focus: on iOS the keyboard would rise
  // over half the commands. The editor lets go too, or its keyboard stays up
  // for the same reason; closing hands focus back (Sheet).
  useEffect(() => {
    if (!focusSearch) (document.activeElement as HTMLElement | null)?.blur()
  }, [focusSearch])

  // Where the pointer was last seen over the rows. A row that opens under a
  // pointer that never moved gets mouse events too, and the highlight used to
  // follow them: ⌘K then Enter ran whatever lay under a resting pointer,
  // "Move this to trash" over the middle of the text. Only a pointer seen to
  // move takes the highlight: by its movement, or, where that isn't
  // reported, by a position other than the last one seen.
  const pointer = useRef<string | null>(null)
  function pointedAt(event: React.MouseEvent, row: Row) {
    const at = `${event.clientX},${event.clientY}`
    const moved = event.movementX !== 0 || event.movementY !== 0 || (pointer.current !== null && pointer.current !== at)
    if (moved) setCursorKey(keyOf(row))
    pointer.current = at
  }

  function move(delta: number) {
    if (!rows.length) return
    setCursorKey(keyOf(rows[(cursor + delta + rows.length) % rows.length]))
  }

  function choose(row: Row | undefined) {
    if (!row) return
    if (row.kind === 'command') row.command.run()
    else onSelectItem(row.item.id)
    onClose()
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault()
      move(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(rows[cursor])
    }
  }

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  return (
    <Sheet label="Commands" onClose={onClose} focus={focusSearch ? search : null} className="nib-pop h-fit w-[min(520px,90vw)] overflow-hidden rounded-lg border border-line bg-paper">
      <input
        ref={search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-label={placeholder}
        aria-expanded={rows.length > 0}
        aria-controls={listId}
        aria-activedescendant={rows.length > 0 ? rowId(cursor) : undefined}
        className="w-full border-b border-line bg-transparent px-4 py-3 text-[14px] outline-none placeholder:text-faint pointer-coarse:text-[16px]"
      />

      <div ref={listRef} id={listId} role="listbox" aria-label={placeholder} className="max-h-[46vh] overflow-y-auto p-1">
        {rows.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-muted">Nothing matches.</div>
        ) : (
          rows.map((row, index) => {
            const active = index === cursor
            const label = row.kind === 'command' ? row.command.label : shownTitle(row.item)
            const hint =
              row.kind === 'command'
                ? showsShortcuts
                  ? row.command.hint
                  : undefined
                : row.item.kind === 'note'
                  ? 'Note'
                  : 'Page'
            return (
              <div key={keyOf(row)} id={rowId(index)} role="option" aria-selected={active}>
              <button
                data-active={active}
                onMouseMove={(event) => pointedAt(event, row)}
                onClick={() => choose(row)}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left text-[13px] transition-colors duration-100 pointer-coarse:min-h-11 ${
                  active ? 'bg-item-active' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {row.kind === 'command' && row.command.badge && (
                  <span className="shrink-0 text-[10.5px] text-faint">{row.command.badge}</span>
                )}
                {hint && (
                  <span
                    className={`shrink-0 font-mono text-[11px] text-muted ${row.kind === 'command' ? 'touch-only:hidden' : ''}`}
                  >
                    {hint}
                  </span>
                )}
              </button>
              </div>
            )
          })
        )}
      </div>

      {showsShortcuts && (
        <div className="flex gap-3 border-t border-line px-4 py-2 font-mono text-[10.5px] text-faint touch-only:hidden">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="flex-1" />
          <span>{shortcut('K')}</span>
        </div>
      )}
    </Sheet>
  )
}
