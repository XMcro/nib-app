import { useSyncExternalStore } from 'react'
import type { Goal } from '../db/db'
import { asCast, type CastCard } from './cast'
import { asGoal } from './documentGoal'
import { readJson, writeJson } from './jsonStorage'

/**
 * What a folder is given besides its name. There's no record of a folder
 * (lib/folders), so this is the one, kept by the folder's whole name in lower
 * case ("novel/part 1"), as names are one whatever their case: its place
 * among those beside it, once they've been put in an order of one's own
 * (Folders and categories → Move), its colour and icon (Nib Plus), and the
 * sort its list has (lib/folders `libraryOf` says what each folder shows,
 * and how it's sorted). Those with no place come
 * after, A to Z as they always were, so a folder made since goes at the end.
 *
 * Kept on this device, carried by sync in a sealed record of its own
 * (sync/engine) and in backups. Two devices' are merged folder by folder, the
 * one changed last kept. A folder renamed, moved or removed leaves its old
 * name `gone`, so another device's older copy can't hand what it had to a new
 * folder given that name. A Nib from before this takes no notice of it, and a
 * folder it renames is a new one here, at the end.
 */
/**
 * `color`: one of Customize's accents (lib/look). `icon`: one of
 * lib/folderIcons. `sort`: one of lib/sort's. Each kept as any name a Nib
 * might give, so one from a later Nib with more isn't lost here. `template`:
 * the id of the template (lib/templates) new documents of its kind start from
 * in this folder. `title` and `author`: its book's, for the title page of
 * the book compiled from it (lib/manuscript). `goal`: its book's word goal,
 * with a date to make it by if it's given one, as a document's own is
 * (lib/documentGoal): Nib Plus. `cast`: its book's characters and places
 * (lib/cast, Nib Plus), with `castAt`, when they were last changed: they go
 * by that rather than by `at`, so a Nib from before them, which sends the
 * folder without them, leaves them as they are (`combine`).
 */
export type FolderSetting = { at: number; place?: number; color?: string; icon?: string; sort?: string; template?: string; title?: string; author?: string; goal?: Goal; cast?: CastCard[]; castAt?: number; gone?: true }

/** What a folder can be given of its own besides its place. */
type Own = 'color' | 'icon' | 'sort' | 'template' | 'title' | 'author' | 'goal'
export type FolderSettings = Record<string, FolderSetting>

/** Longer than any folder's whole name (lib/folders MAX_NAME). */
const MAX_KEY = 200
/** More than anyone has folders, renamed ones included, and few enough that a copy from outside can't hold the app up. */
const MAX_ENTRIES = 2000

const keyOf = (name: string) => name.toLocaleLowerCase()
const asOwnName = (raw: unknown) => (typeof raw === 'string' && /^[a-z0-9-]{1,40}$/.test(raw) ? raw : undefined)
/** A document's id, as Nib makes them (a UUID) or an import may have. */
const asId = (raw: unknown) => (typeof raw === 'string' && /^[\w-]{1,100}$/.test(raw) ? raw : undefined)
/** Words the writer gave it, a line of them. */
const asLine = (raw: unknown) => {
  const line = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  return line && line.length <= 200 ? line : undefined
}
/** How each is checked, arriving from storage, a backup or another device. */
const OWN: { [K in Own]: (raw: unknown) => FolderSetting[K] } = { color: asOwnName, icon: asOwnName, sort: asOwnName, template: asId, title: asLine, author: asLine, goal: (raw) => asGoal(raw) ?? undefined }
const live = (setting: FolderSetting | undefined) => (setting && !setting.gone ? setting : undefined)

function asSetting(raw: unknown): FolderSetting | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const { at, place, gone } = raw as Record<string, unknown>
  if (!Number.isFinite(at) || (at as number) < 0) return undefined
  if (gone === true) return { at: at as number, gone }
  const setting: FolderSetting = { at: at as number, ...(Number.isFinite(place) ? { place: place as number } : {}) }
  for (const own of Object.keys(OWN) as Own[]) {
    const value = OWN[own]((raw as Record<string, unknown>)[own])
    if (value) (setting as Record<Own, unknown>)[own] = value
  }
  const { cast, castAt } = raw as Record<string, unknown>
  const cards = asCast(cast)
  if (cards && Number.isFinite(castAt) && (castAt as number) >= 0) Object.assign(setting, { cast: cards, castAt })
  return setting
}

/** Whichever of two was changed last; if at once, the same one on every device. */
const later = (a: FolderSetting | undefined, b: FolderSetting) => (!a || b.at > a.at || (b.at === a.at && JSON.stringify(b) > JSON.stringify(a)) ? b : a)

/**
 * Two of a folder's settings as one: the one changed last, with the book's
 * characters and places of whichever changed those last, so one without
 * them (from a Nib before them) leaves them as they are. One gone has none.
 */
function combine(a: FolderSetting | undefined, b: FolderSetting): FolderSetting {
  const kept = later(a, b)
  if (kept.gone) return kept
  const cast = [a, b].filter((one): one is FolderSetting => one?.castAt !== undefined && !one.gone).reduce<FolderSetting | undefined>((best, one) => (!best || one.castAt! > best.castAt! || (one.castAt === best.castAt && JSON.stringify(one.cast) > JSON.stringify(best.cast)) ? one : best), undefined)
  return cast && cast !== kept ? { ...kept, cast: cast.cast, castAt: cast.castAt } : kept
}

/**
 * Taken from storage, a backup or another device: each folder once, whatever
 * the case of its name, and in one order, so the same settings read the same
 * on every device and nothing goes back and forth for nothing. Anything but
 * an object says nothing. Past MAX_ENTRIES, the gone are let go first, oldest
 * first.
 */
export function asFolderSettings(raw: unknown): FolderSettings | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const kept = new Map<string, FolderSetting>()
  for (const [name, value] of Object.entries(raw)) {
    const setting = asSetting(value)
    const key = keyOf(name.trim())
    if (!setting || !key || key.length > MAX_KEY) continue
    kept.set(key, combine(kept.get(key), setting))
  }
  const entries = [...kept]
  const alive = entries.filter(([, setting]) => !setting.gone)
  const gone = entries.filter(([, setting]) => setting.gone).sort(([, a], [, b]) => b.at - a.at)
  const chosen = [...alive.slice(0, MAX_ENTRIES), ...gone.slice(0, Math.max(0, MAX_ENTRIES - alive.length))]
  return Object.fromEntries(chosen.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** A folder's settings but for when, where and its characters and places: what a rename carries whatever Nib made it. */
const carriedBy = ({ at: _at, place: _place, cast: _cast, castAt: _castAt, ...rest }: FolderSetting) => JSON.stringify(rest)

/**
 * `there`, with this device's characters and places put back where a Nib
 * from before them renamed or moved their folder: it leaves the old name gone
 * and the new one without them, at one moment (its `renameSettings`), and
 * taken as they come that would be the end of them on every device. They go
 * to the folder first seen there at that moment: the only one, or the only
 * one with the rest of this folder's settings. A folder removed has no new
 * name, and its book's go with it, as they do removed here.
 */
function withCastCarried(here: FolderSettings, there: FolderSettings): FolderSettings {
  let next = there
  for (const [key, mine] of Object.entries(here)) {
    const theirs = there[key]
    if (mine.gone || mine.castAt === undefined || !theirs?.gone || later(mine, theirs) !== theirs) continue
    const renamed = Object.entries(there).filter(([to, setting]) => !setting.gone && setting.at === theirs.at && setting.castAt === undefined && !live(here[to]))
    const alike = renamed.filter(([, setting]) => carriedBy(setting) === carriedBy(mine))
    const [to] = (renamed.length === 1 ? renamed : alike.length === 1 ? alike : []).map(([name]) => name)
    if (to) next = { ...next, [to]: { ...next[to], cast: mine.cast, castAt: mine.castAt } }
  }
  return next
}

/** Both devices' together: for each folder, the one changed last. */
export function mergeFolderSettings(here: FolderSettings, there: FolderSettings): FolderSettings {
  const both: Record<string, FolderSetting> = { ...here }
  for (const [key, setting] of Object.entries(withCastCarried(here, there))) both[key] = combine(both[key], setting)
  return asFolderSettings(both)!
}

/** What `name` has been given, if anything, and isn't gone. */
export const settingOf = (settings: FolderSettings, name: string) => live(settings[keyOf(name)])

// ---------------------------------------------------------------------------
// This device's.

const KEY = 'nib-folder-settings'

/** Sent on the window when they're changed here, for sync to send them soon (sync/session). */
export const FOLDERS_CHANGED = 'nib-folders-changed'

let settings: FolderSettings = asFolderSettings(readJson<unknown>(KEY, null)) ?? {}
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useFolderSettings = () => useSyncExternalStore(subscribe, () => settings)
export const readFolderSettings = () => settings

/** Kept, in their one order, and with storage off, kept for this session. `here`: changed on this device, so said for sync. */
function keep(next: FolderSettings, here: boolean) {
  settings = asFolderSettings(next)!
  writeJson(KEY, next)
  listeners.forEach((listener) => listener())
  if (here) window.dispatchEvent(new Event(FOLDERS_CHANGED))
}

/** A backup's, in place of this device's (lib/backup putBack); a book's characters and places it hasn't, as a backup from a Nib before them hasn't, kept as they are here. */
export function replaceFolderSettings(next: FolderSettings) {
  const kept = { ...next }
  for (const [key, setting] of Object.entries(settings)) {
    if (setting.castAt === undefined || setting.gone || kept[key]?.gone || kept[key]?.castAt !== undefined) continue
    kept[key] = { ...(kept[key] ?? { at: setting.at }), cast: setting.cast, castAt: setting.castAt }
  }
  keep(kept, false)
}

/** Another device's, merged with this one's, as sync brings them. */
export function takeInFolderSettings(there: FolderSettings) {
  const both = mergeFolderSettings(settings, there)
  if (JSON.stringify(both) !== JSON.stringify(settings)) keep(both, false)
}

/** The folders beside each other, `names`, in this order from now on. */
export function arrange(names: string[]) {
  const at = Date.now()
  const next = { ...settings }
  names.forEach((name, index) => {
    next[keyOf(name)] = { ...live(next[keyOf(name)]), at, place: index + 1 }
  })
  keep(next, true)
}

/** A folder's own colour, icon, sort, template, or book's title, author or goal, each null for none, as is anything that isn't one: one left out stays as it is. */
export function setOwn(name: string, changes: { [K in Own]?: FolderSetting[K] | null }) {
  const next: FolderSetting = { ...live(settings[keyOf(name)]), at: Date.now() }
  for (const own of Object.keys(OWN) as Own[]) {
    const value = changes[own] === undefined || changes[own] === null ? changes[own] : (OWN[own](changes[own]) ?? null)
    if (value === null) delete next[own]
    else if (value !== undefined) (next as Record<Own, unknown>)[own] = value
  }
  keep({ ...settings, [keyOf(name)]: next }, true)
}

/** A book's characters and places, kept with its folder `name` in place of those it had: none is none, and said so for sync. */
export function setCast(name: string, cast: CastCard[]) {
  const at = Date.now()
  keep({ ...settings, [keyOf(name)]: { ...live(settings[keyOf(name)]), at, cast: asCast(cast) ?? [], castAt: at } }, true)
}

/** The characters and places of the book in folder `name`, none if it has none. */
export const castOf = (settings: FolderSettings, name: string): CastCard[] => live(settings[keyOf(name)])?.cast ?? []

/**
 * Folders given new names (lib/folders, as one is renamed, moved or removed):
 * each one's settings go to its new name, with its place if it's still among
 * the same folders (`keepPlace`), and its old name is left gone. `to` null
 * leaves only that. A folder already called `to` keeps its own.
 */
export function renameSettings(moves: { from: string; to: string | null; keepPlace: boolean }[]) {
  if (moves.length === 0) return
  const at = Date.now()
  const next = { ...settings }
  for (const { from } of moves) next[keyOf(from)] = { at, gone: true }
  for (const { from, to, keepPlace } of moves) {
    const was = live(settings[keyOf(from)])
    if (to === null || !was || live(next[keyOf(to)])) continue
    const { place, ...rest } = was
    next[keyOf(to)] = { ...rest, at, ...(keepPlace && place !== undefined ? { place } : {}) }
  }
  keep(next, true)
}
