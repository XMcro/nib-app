import { useSyncExternalStore } from 'react'
import { formatById } from '../editor/formats'
import { DEFAULT_OWN, isColor, OWN_EXTRAS, readable, type OwnColors } from './ownTheme'

/**
 * How Nib looks beyond its theme, chosen in Settings → Customize and kept on
 * this device, as the theme is: it neither syncs nor travels in backups.
 *
 * Every default is Nib as it was before Customize existed, and a default is
 * drawn as nothing at all: no attribute on <html>, no custom property, the
 * same markup. A writer who never opens Customize sees no change.
 *
 * The second half is Nib Plus. Without it those fall back to their defaults,
 * as a Plus theme falls back to System, and the choice is kept for when Plus
 * comes back.
 */
export type Look = {
  size: (typeof SIZES)[number]
  width: (typeof WIDTHS)[number]
  motion: (typeof MOTIONS)[number]
  spacing: (typeof SPACINGS)[number]
  wordCount: boolean
  outline: boolean
  linkedFrom: boolean
  typewriter: boolean
  dim: boolean
  notesFont: (typeof NOTES_FONTS)[number]
  pagesFont: (typeof PAGES_FONTS)[number]
  paragraphs: (typeof PARAGRAPHS)[number]
  align: (typeof ALIGNS)[number]
  accent: 'theme' | Accent
  highlight: 'theme' | Highlight
  /** The colours of a theme of one's own, used while the theme is `custom` (lib/ownTheme). */
  ownTheme: OwnColors
  toolbar: string[]
  keyboardBar: string[]
}

const SIZES = ['small', 'standard', 'large', 'larger'] as const
const WIDTHS = ['narrow', 'standard', 'wide'] as const
const MOTIONS = ['full', 'less', 'none'] as const
const SPACINGS = ['tight', 'standard', 'airy'] as const
const NOTES_FONTS = ['mono', 'sans', 'serif'] as const
const PAGES_FONTS = ['sans', 'serif', 'mono'] as const
export const PARAGRAPHS = ['lines', 'spaced', 'indented'] as const
const ALIGNS = ['ragged', 'justified'] as const

/**
 * Each accent in a shade for light paper and one for dark, every one 4.5:1 or
 * more against every theme's paper of that kind, since links are drawn in it
 * (look.browser.test checks them all).
 */
export const ACCENTS = {
  blue: { label: 'Blue', light: '#1f64bf', dark: '#5895e4' },
  teal: { label: 'Teal', light: '#1c7070', dark: '#2eb8b8' },
  green: { label: 'Green', light: '#267340', dark: '#39ac60' },
  orange: { label: 'Orange', light: '#a15012', dark: '#e67219' },
  red: { label: 'Red', light: '#c3252a', dark: '#e46f73' },
  pink: { label: 'Pink', light: '#b82b71', dark: '#dd6ea6' },
  purple: { label: 'Purple', light: '#8345c9', dark: '#aa81da' },
  graphite: { label: 'Graphite', light: '#606671', dark: '#8e949f' },
} as const
export type Accent = keyof typeof ACCENTS

/**
 * Highlighted text keeps its theme's ink, so each shade is 4.5:1 or more
 * under every ink of its kind (look.browser.test), and about as quiet on the
 * page as the yellow every theme has of its own.
 */
export const HIGHLIGHTS = {
  green: { label: 'Green', light: '#c0edc4', dark: '#1e6925' },
  blue: { label: 'Blue', light: '#b8dbf5', dark: '#156095' },
  pink: { label: 'Pink', light: '#f5b8d1', dark: '#98164c' },
  orange: { label: 'Orange', light: '#f9d6b4', dark: '#8b4b0b' },
} as const
export type Highlight = keyof typeof HIGHLIGHTS

/** A tool that's a style from editor/formats, called what it's called there. */
const style = <Id extends string>(id: Id) => ({ id, label: formatById(id)!.label })

/**
 * What the selection toolbar can hold, in the order its "More" panel lists
 * whatever isn't on the row. Seven fit a 375pt iPhone beside "More".
 */
export const TOOLBAR_TOOLS = [
  style('format-bold'),
  style('format-italic'),
  style('format-strike'),
  { id: 'link' as const, label: 'Link' },
  { id: 'format-heading' as const, label: 'Heading (pages)' },
  style('format-quote'),
  { id: 'code' as const, label: 'Code' },
  style('format-underline'),
  style('format-highlight'),
  style('format-checklist'),
  style('format-bullets'),
  style('format-numbers'),
]
export type ToolbarTool = (typeof TOOLBAR_TOOLS)[number]['id']
export const TOOLBAR_MAX = 7

/** What the bar above the iPhone and iPad keyboard can hold, beside Aa. */
export const KEYBOARD_TOOLS = ['format-bold', 'format-italic', 'format-underline', 'format-strike', 'format-highlight', 'format-checklist', 'format-bullets', 'format-numbers', 'format-outdent', 'format-indent'].map(style)
export const KEYBOARD_MAX = 6

export const DEFAULT_LOOK: Look = {
  size: 'standard',
  width: 'standard',
  motion: 'full',
  spacing: 'standard',
  wordCount: true,
  outline: true,
  linkedFrom: true,
  typewriter: false,
  dim: false,
  notesFont: 'mono',
  pagesFont: 'sans',
  paragraphs: 'lines',
  align: 'ragged',
  accent: 'theme',
  highlight: 'theme',
  ownTheme: DEFAULT_OWN,
  toolbar: ['format-bold', 'format-italic', 'format-strike', 'link', 'format-heading', 'format-quote', 'code'],
  keyboardBar: ['format-checklist', 'format-bullets', 'format-numbers'],
}

const PLUS_PARTS = ['notesFont', 'pagesFont', 'paragraphs', 'align', 'accent', 'highlight', 'ownTheme', 'toolbar', 'keyboardBar', 'typewriter', 'dim'] as const

const STORAGE_KEY = 'nib-look'

const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

const tools = (pool: { id: string }[], max: number, value: unknown, fallback: string[]) =>
  Array.isArray(value) ? [...new Set(value)].filter((id) => pool.some((tool) => tool.id === id)).slice(0, max) : fallback

/** Whatever is stored, read as a Look: anything unknown is its default. */
export function parseLook(value: unknown): Look {
  const stored = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const flag = (key: 'wordCount' | 'outline' | 'linkedFrom' | 'typewriter' | 'dim') => (typeof stored[key] === 'boolean' ? (stored[key] as boolean) : DEFAULT_LOOK[key])
  return {
    size: oneOf(SIZES, stored.size, DEFAULT_LOOK.size),
    width: oneOf(WIDTHS, stored.width, DEFAULT_LOOK.width),
    motion: oneOf(MOTIONS, stored.motion, DEFAULT_LOOK.motion),
    spacing: oneOf(SPACINGS, stored.spacing, DEFAULT_LOOK.spacing),
    wordCount: flag('wordCount'),
    outline: flag('outline'),
    linkedFrom: flag('linkedFrom'),
    typewriter: flag('typewriter'),
    dim: flag('dim'),
    notesFont: oneOf(NOTES_FONTS, stored.notesFont, DEFAULT_LOOK.notesFont),
    pagesFont: oneOf(PAGES_FONTS, stored.pagesFont, DEFAULT_LOOK.pagesFont),
    paragraphs: oneOf(PARAGRAPHS, stored.paragraphs, DEFAULT_LOOK.paragraphs),
    align: oneOf(ALIGNS, stored.align, DEFAULT_LOOK.align),
    accent: Object.keys(ACCENTS).includes(stored.accent as string) ? (stored.accent as Accent) : 'theme',
    highlight: Object.keys(HIGHLIGHTS).includes(stored.highlight as string) ? (stored.highlight as Highlight) : 'theme',
    ownTheme: ownColors(stored.ownTheme),
    toolbar: tools(TOOLBAR_TOOLS, TOOLBAR_MAX, stored.toolbar, DEFAULT_LOOK.toolbar),
    keyboardBar: tools(KEYBOARD_TOOLS, KEYBOARD_MAX, stored.keyboardBar, DEFAULT_LOOK.keyboardBar),
  }
}

/**
 * Stored colours, if all three are colours and read together; else the
 * starting point. A library background or highlight is kept with them only
 * if it's a colour the text reads on: without it, that one is worked out.
 */
function ownColors(value: unknown): OwnColors {
  const stored = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  if (!isColor(stored.paper) || !isColor(stored.ink) || !isColor(stored.accent)) return DEFAULT_OWN
  let colors: OwnColors = { paper: stored.paper.toLowerCase(), ink: stored.ink.toLowerCase(), accent: stored.accent.toLowerCase() }
  if (!readable(colors).ok) return DEFAULT_OWN
  for (const [part] of OWN_EXTRAS) {
    const chosen = stored[part]
    if (isColor(chosen) && readable({ ...colors, [part]: chosen.toLowerCase() }).ok) colors = { ...colors, [part]: chosen.toLowerCase() }
  }
  return colors
}

// Guarded as the theme is: storage blocked must not throw during first render.
function read(): Look {
  try {
    return parseLook(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))
  } catch {
    return DEFAULT_LOOK
  }
}

/** The look to draw: the Plus half only with Plus, once the App Store has answered. */
export function shownLook(look: Look, plus: { active: boolean; known: boolean }): Look {
  if (!plus.known || plus.active) return look
  return { ...look, ...Object.fromEntries(PLUS_PARTS.map((part) => [part, DEFAULT_LOOK[part]])) }
}

let chosen = read()
let plus = { active: false, known: false }
let shown = shownLook(chosen, plus)
const listeners = new Set<() => void>()

function update() {
  shown = shownLook(chosen, plus)
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** What to draw. Re-renders when the look or Plus changes. */
export const useLook = () => useSyncExternalStore(subscribe, () => shown)

/** What the writer chose, Plus or not: for Customize itself. */
export const useChosenLook = () => useSyncExternalStore(subscribe, () => chosen)

export function setLook(change: Partial<Look>) {
  chosen = parseLook({ ...chosen, ...change })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chosen))
  } catch {
    // Storage off: the look lasts for this session.
  }
  update()
}

export function resetLook() {
  chosen = DEFAULT_LOOK
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing was kept.
  }
  update()
}

/**
 * Saved looks (Nib Plus): a whole setup under a name, the theme with it, to
 * switch between, "Drafting" and "Editing" say. They go to the writer's other
 * devices, as one sealed record of their own (sync/engine), and in backups;
 * the look in use stays this device's. Merged look by look, the one saved
 * last kept; one deleted is kept `gone`, so another device's older copy can't
 * bring it back. A Nib from before this takes no notice of them.
 */
export type SavedLook = { name: string; look: Look; theme: string }
/** A saved look as kept and synced, by its name: when it was last saved, or deleted. */
export type SavedLookEntry = { at: number; look?: Look; theme?: string; gone?: true }
export type SavedLooks = Record<string, SavedLookEntry>
export const SAVED_MAX = 8
/** More than are ever saved, the deleted with them, and few enough that a copy from outside can't hold the app up. */
const KEPT_MAX = 100
const SAVED_KEY = 'nib-saved-looks'
/** Where they were kept before they synced: a list, newest first. Read once, into the record. */
const LISTED_KEY = 'nib-looks'

/** Sent on the window when they're changed here, for sync to send them soon (sync/session). */
export const LOOKS_CHANGED = 'nib-looks-changed'

const asName = (raw: unknown) => (typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 40) : undefined)

function asEntry(raw: unknown): SavedLookEntry | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const { at, look, theme, gone } = raw as Record<string, unknown>
  if (!Number.isFinite(at) || (at as number) < 0) return undefined
  if (gone === true) return { at: at as number, gone }
  return typeof theme === 'string' && theme.length <= 100 ? { at: at as number, look: parseLook(look), theme } : undefined
}

/** Whichever of two was changed last; if at once, the same one on every device. */
const later = (a: SavedLookEntry | undefined, b: SavedLookEntry) => (!a || b.at > a.at || (b.at === a.at && JSON.stringify(b) > JSON.stringify(a)) ? b : a)

/**
 * Taken from storage, a backup or another device: each look once, in one
 * order, so the same looks read the same on every device and nothing goes
 * back and forth for nothing. Past KEPT_MAX, the deleted are let go first,
 * oldest first. Anything but an object says nothing.
 */
export function asSavedLooks(raw: unknown): SavedLooks | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const kept = new Map<string, SavedLookEntry>()
  for (const [key, value] of Object.entries(raw)) {
    const name = asName(key)
    const entry = asEntry(value)
    if (name && entry) kept.set(name, later(kept.get(name), entry))
  }
  const newest = (a: [string, SavedLookEntry], b: [string, SavedLookEntry]) => b[1].at - a[1].at
  const alive = [...kept].filter(([, entry]) => !entry.gone).sort(newest)
  const gone = [...kept].filter(([, entry]) => entry.gone).sort(newest)
  const chosen = [...alive.slice(0, KEPT_MAX), ...gone.slice(0, Math.max(0, KEPT_MAX - alive.length))]
  return Object.fromEntries(chosen.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** Both devices' together: for each look, the one saved or deleted last. */
export function mergeSavedLooks(here: SavedLooks, there: SavedLooks): SavedLooks {
  const both = new Map(Object.entries(here))
  for (const [name, entry] of Object.entries(there)) both.set(name, later(both.get(name), entry))
  return asSavedLooks(Object.fromEntries(both))!
}

/** Those not deleted, newest first, as Customize lists them. */
const listOf = (looks: SavedLooks): SavedLook[] =>
  Object.entries(looks)
    .filter(([, entry]) => !entry.gone)
    .sort(([, a], [, b]) => b.at - a.at)
    .map(([name, entry]) => ({ name, look: entry.look!, theme: entry.theme! }))

function readSaved(): SavedLooks {
  try {
    const kept = localStorage.getItem(SAVED_KEY)
    if (kept !== null) return asSavedLooks(JSON.parse(kept)) ?? {}
    // Kept as a list before they synced, newest first: each given a time in that order, and kept so from now on.
    const listed: unknown = JSON.parse(localStorage.getItem(LISTED_KEY) ?? '[]')
    if (!Array.isArray(listed) || listed.length === 0) return {}
    const now = Date.now()
    const looks = asSavedLooks(Object.fromEntries([...listed].reverse().map((entry, i) => [entry?.name, { at: now - listed.length + 1 + i, look: entry?.look, theme: entry?.theme }]))) ?? {}
    localStorage.setItem(SAVED_KEY, JSON.stringify(looks))
    localStorage.removeItem(LISTED_KEY)
    return looks
  } catch {
    return {}
  }
}

let savedLooks = readSaved()
let saved = listOf(savedLooks)

/** The saved looks, newest first. */
export const useSavedLooks = () => useSyncExternalStore(subscribe, () => saved)

/** As kept and synced, the deleted with them. */
export const readSavedLooks = () => savedLooks

/** Kept, in their one order, and with storage off, kept for this session. `here`: changed on this device, so said for sync. */
function keepSaved(next: SavedLooks, here: boolean) {
  savedLooks = asSavedLooks(next) ?? {}
  saved = listOf(savedLooks)
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(savedLooks))
  } catch {
    // Storage off: they last for this session.
  }
  listeners.forEach((listener) => listener())
  if (here) window.dispatchEvent(new Event(LOOKS_CHANGED))
}

/** A backup's, in place of this device's (lib/backup putBack). */
export const replaceSavedLooks = (next: SavedLooks) => keepSaved(next, false)

/** Another device's, merged with this one's, as sync brings them. */
export function takeInSavedLooks(there: SavedLooks) {
  const both = mergeSavedLooks(savedLooks, there)
  if (JSON.stringify(both) !== JSON.stringify(savedLooks)) keepSaved(both, false)
}

/** Saves the look as it is, with `theme`, under `name`, in place of one already so named. */
export function saveLook(name: string, theme: string) {
  const named = asName(name)
  if (!named) return
  const others = saved.filter((entry) => entry.name !== named)
  if (others.length >= SAVED_MAX) return
  keepSaved({ ...savedLooks, [named]: { at: Date.now(), look: chosen, theme } }, true)
}

/** Deleted here, and so on the writer's other devices. */
export const deleteSavedLook = (name: string) => keepSaved({ ...savedLooks, [name]: { at: Date.now(), gone: true } }, true)

/** lib/useTheme tells the look whether Plus is on, as it tells the theme. */
export function setLookPlus(next: { active: boolean; known: boolean }) {
  if (next.active === plus.active && next.known === plus.known) return
  plus = next
  update()
}

/**
 * The parts drawn by index.css, as attributes on <html>. A default is no
 * attribute, so the stylesheet's own rules, the ones Nib always had, apply.
 */
export function applyLook(look: Look, root = document.documentElement) {
  const set = (name: string, value: string, fallback: string) => {
    if (value === fallback) delete root.dataset[name]
    else root.dataset[name] = value
  }
  set('size', look.size, DEFAULT_LOOK.size)
  set('width', look.width, DEFAULT_LOOK.width)
  set('motion', look.motion, DEFAULT_LOOK.motion)
  set('spacing', look.spacing, DEFAULT_LOOK.spacing)
  set('notesFont', look.notesFont, DEFAULT_LOOK.notesFont)
  set('pagesFont', look.pagesFont, DEFAULT_LOOK.pagesFont)
  set('paragraphs', look.paragraphs, DEFAULT_LOOK.paragraphs)
  set('align', look.align, DEFAULT_LOOK.align)
  set('accent', look.accent, DEFAULT_LOOK.accent)
  set('highlight', look.highlight, DEFAULT_LOOK.highlight)
  shades(root, 'accent', look.accent === 'theme' ? null : ACCENTS[look.accent])
  shades(root, 'highlight', look.highlight === 'theme' ? null : HIGHLIGHTS[look.highlight])
}

/** A colour's two shades, for index.css to choose between by the page's darkness. */
function shades(root: HTMLElement, name: string, colors: { light: string; dark: string } | null) {
  for (const kind of ['light', 'dark'] as const) {
    if (colors) root.style.setProperty(`--nib-${name}-${kind}`, colors[kind])
    else root.style.removeProperty(`--nib-${name}-${kind}`)
  }
}
