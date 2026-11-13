import { useSyncExternalStore } from 'react'

/**
 * Where Nib opens, and where what's written next goes (Settings → Customize,
 * Nib Plus): on Notes, on Pages, or on the document that was open when Nib
 * was last closed; with one folder showing, or everything; and a folder that
 * a new note or page goes into when no folder is showing. Kept on this
 * device, as the look is: it neither syncs nor travels in backups.
 *
 * The default is Nib as it always opened, and is kept as nothing at all.
 * Without Plus the choice stays, and does nothing (App, useStartAt).
 */
export const STARTS = ['notes', 'pages', 'last'] as const
export type Start = { on: (typeof STARTS)[number]; folder: string | null; newIn: string | null }
export const DEFAULT_START: Start = { on: 'notes', folder: null, newIn: null }

const KEY = 'nib-start'
const LEFT_KEY = 'nib-left-at'

const folderName = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null)

/** Whatever is stored, read as a Start: anything unknown is its default. */
export function parseStart(value: unknown): Start {
  const stored = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return {
    on: STARTS.find((on) => on === stored.on) ?? DEFAULT_START.on,
    folder: folderName(stored.folder),
    newIn: folderName(stored.newIn),
  }
}

export const isDefaultStart = (start: Start) => start.on === DEFAULT_START.on && start.folder === null && start.newIn === null

// Guarded as the look is: storage blocked must not throw during first render.
function read(): Start {
  try {
    return parseStart(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return DEFAULT_START
  }
}

let chosen = read()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useStart = () => useSyncExternalStore(subscribe, () => chosen)

export function setStart(change: Partial<Start>) {
  chosen = parseStart({ ...chosen, ...change })
  try {
    if (isDefaultStart(chosen)) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(chosen))
    // Nothing is kept of what was open unless that's where Nib is to open.
    if (chosen.on !== 'last') localStorage.removeItem(LEFT_KEY)
  } catch {
    // The choice holds until Nib closes.
  }
  for (const listener of listeners) listener()
}

/** The document on screen, or none: kept only while Nib is to open where it was left. */
export function keepLeftAt(id: string | null) {
  if (chosen.on !== 'last') return
  try {
    if (id === null) localStorage.removeItem(LEFT_KEY)
    else localStorage.setItem(LEFT_KEY, id)
  } catch {
    // Nib opens on its library instead.
  }
}

export function leftAt(): string | null {
  try {
    return localStorage.getItem(LEFT_KEY)
  } catch {
    return null
  }
}
