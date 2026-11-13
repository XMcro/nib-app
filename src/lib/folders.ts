import { useSyncExternalStore } from 'react'
import type { Category, Item } from '../db/db'
import * as items from '../db/items'
import { FOLDER_ICONS } from './folderIcons'
import { readFolderSettings, renameSettings, settingOf, type FolderSettings } from './folderSettings'
import { ACCENTS, type Accent } from './look'
import { SORTS, type Sort } from './sort'
import { isLocked, vaultOpen } from './vault'

/**
 * Folders and categories. A document sits in at most one folder and carries
 * up to MAX_CATEGORIES categories, each a name and one of Customize's accent
 * colours. Notes and pages share them. Both are kept on the document itself,
 * like a pin, so sync and backups carry them with it, and a folder or
 * category is there while something is in it. One made on this device is
 * also kept here (`made`), empty or not, till it's removed here.
 *
 * A folder can be inside another, one level down and no further. There's
 * still no record of a folder: a document in Part 1 of Novel has the folder
 * "Novel/Part 1", both names with a slash between (`within`, `split`), and
 * Novel is there because something is in it or under it. A Nib from before
 * this shows that as one folder, called "Novel/Part 1".
 */

/** Long enough for any title a folder gets; it's a label, not a sentence. */
export const MAX_NAME = 60

/** More than anyone files one document under, and few enough that a list from outside can't hold the app up. */
export const MAX_CATEGORIES = 100

const COLORS: readonly string[] = Object.keys(ACCENTS)

/** Names are one whatever their case: "Novel" and "novel" are one folder. */
export const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase()

/**
 * A folder's own name, and the folder it's inside, if it's inside one: split
 * at its first slash, when there's a name on each side. Anything after a
 * second slash is part of its own name: there's one level, and no more.
 */
export function split(folder: string): { parent: string | null; name: string } {
  const at = folder.indexOf('/')
  const parent = at < 0 ? '' : folder.slice(0, at).trim()
  const name = at < 0 ? '' : folder.slice(at + 1).trim()
  return parent && name ? { parent, name } : { parent: null, name: folder }
}

/** The folder called `name` inside `parent`. */
export const within = (parent: string, name: string) => `${parent}/${name}`

/** Whether what's in `folder` shows when `shown` is chosen: it is that folder, or is inside it. */
export function under(folder: string, shown: string): boolean {
  if (sameName(folder, shown)) return true
  const { parent } = split(folder)
  return parent !== null && sameName(parent, shown)
}

/** A folder as it's said in a line of text: "Novel › Part 1". */
export function saidAs(folder: string): string {
  const { parent, name } = split(folder)
  return parent === null ? name : `${parent} › ${name}`
}

function asName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const name = raw.trim()
  return name && name.length <= MAX_NAME ? name : undefined
}

/**
 * The one check on a document's folder arriving from outside: a backup, or
 * another device. `undefined` means nothing usable, which callers treat as
 * saying nothing, as with `asGoal`; taken out of its folder is `null`.
 */
export function asFolder(raw: unknown): string | null | undefined {
  return raw === null ? null : asName(raw)
}

/**
 * The one check on a document's categories arriving from outside: each
 * well formed, and each name once, whatever its case. Anything but a list
 * says nothing; an empty list is none.
 */
export function asCategories(raw: unknown): Category[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const kept: Category[] = []
  const names = new Set<string>()
  for (const entry of raw) {
    if (kept.length === MAX_CATEGORIES) break
    const { name: rawName, color } = (entry ?? {}) as Partial<Category>
    const name = asName(rawName)
    if (!name || typeof color !== 'string' || !COLORS.includes(color)) continue
    // sameName's key, so one check, not one against each kept.
    const key = name.toLocaleLowerCase()
    if (names.has(key)) continue
    names.add(key)
    kept.push({ name, color: color as Accent })
  }
  return kept
}

/**
 * A locked note's folder and categories are seen only while the vault is
 * open, as its title is: "Lawyer" and "Custody" say what its sealed text is
 * about. Shut, it shows under All alone, filed nowhere anyone can see, and
 * it's filed again only once the vault is open.
 */
export const filingHidden = (item: Item) => isLocked(item) && !vaultOpen()

/** A document's folder and categories, as Nib may show them (filingHidden). */
export const filingOf = (item: Item): Pick<Item, 'folder' | 'categories'> => (filingHidden(item) ? {} : item)

/** What the library shows: everything, one folder's, one category's, the archive, or the templates (lib/templates). */
export type Place = { folder: string } | { category: string } | { archive: true } | { templates: true } | null

/** The archive or the templates: what's apart from the lists, shown from a list of its own. */
export const apart = (place: Place): place is { archive: true } | { templates: true } => place !== null && ('archive' in place || 'templates' in place)

export function inPlace(item: Item, place: Place): boolean {
  if (!place || apart(place)) return true
  const { folder, categories } = filingOf(item)
  if ('folder' in place) return folder ? under(folder, place.folder) : false
  return categories?.some((category) => sameName(category.name, place.category)) ?? false
}

/**
 * A folder by its whole name ("Novel/Part 1" for one inside another), with
 * how many documents show when it's chosen: its own, and those in the folders
 * inside it. `place`: where it goes among those beside it, once they've been
 * put in an order of one's own; `color` and `icon`: what it shows itself as;
 * `sort`: how its list is sorted, when it's not the library's; `template`:
 * the template new documents of its kind start from (lib/templates), if it's
 * still one. A folder inside another takes each of these from that one till
 * it's given its own (lib/folderSettings).
 */
export type Folder = { name: string; count: number; place?: number; color?: Accent; icon?: string; sort?: Sort; template?: string }

/** What a folder shows itself as: its colour, its icon, neither or both. */
export type Look = Pick<Folder, 'color' | 'icon'>

/** The look of the folder called `name` in `library`, as a card's or a header's folder line shows it. */
export function lookOf(library: Library, name: string): Look {
  const folder = library.folders.find((one) => sameName(one.name, name))
  return folder ? { color: folder.color, icon: folder.icon } : {}
}
export type Library = { folders: Folder[]; categories: (Category & { count: number })[] }

/**
 * Every folder and category, A to Z, with how many documents are in each:
 * those `documents` show (filingOf), and those made here not yet used. A
 * folder with one inside it is there too, with nothing of its own in it. A
 * category's colour is the one on the document saved last, as two devices
 * can colour it differently while they're apart. Each folder given a place
 * in `settings` has it (treeOf lays them out by it).
 */
export function libraryOf(documents: Item[], made: Made = MADE_NONE, settings: FolderSettings = {}): Library {
  const folders = new Map<string, { name: string; count: number }>()
  const categories = new Map<string, Category & { count: number; at: number }>()
  for (const item of documents) {
    const filed = filingOf(item)
    if (filed.folder) {
      const key = filed.folder.toLocaleLowerCase()
      const folder = folders.get(key) ?? { name: filed.folder, count: 0 }
      folders.set(key, { ...folder, count: folder.count + 1 })
    }
    for (const category of filed.categories ?? []) {
      const key = category.name.toLocaleLowerCase()
      const known = categories.get(key)
      const newer = !known || item.updatedAt > known.at
      categories.set(key, {
        name: newer ? category.name : known.name,
        color: newer ? category.color : known.color,
        at: newer ? item.updatedAt : known.at,
        count: (known?.count ?? 0) + 1,
      })
    }
  }
  for (const name of made.folders) if (!folders.has(name.toLocaleLowerCase())) folders.set(name.toLocaleLowerCase(), { name, count: 0 })
  // Each one inside another counts in that one too, which is there for it even with nothing of its own.
  for (const folder of [...folders.values()]) {
    const { parent } = split(folder.name)
    if (parent === null) continue
    const key = parent.toLocaleLowerCase()
    const outer = folders.get(key) ?? { name: parent, count: 0 }
    folders.set(key, { ...outer, count: outer.count + folder.count })
  }
  for (const category of made.categories) {
    if (!categories.has(category.name.toLocaleLowerCase())) categories.set(category.name.toLocaleLowerCase(), { ...category, count: 0, at: 0 })
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  // Only a colour, an icon and a sort this Nib has; one from a later Nib with more is as none.
  const shown = (name: string): Pick<Folder, 'color' | 'icon' | 'sort' | 'template'> => {
    const setting = settingOf(settings, name)
    return {
      color: COLORS.includes(setting?.color ?? '') ? (setting!.color as Accent) : undefined,
      icon: setting?.icon && setting.icon in FOLDER_ICONS ? setting.icon : undefined,
      sort: SORTS.find((sort) => sort === setting?.sort),
      template: setting?.template,
    }
  }
  const placed = (folder: Folder): Folder => {
    const place = settingOf(settings, folder.name)?.place
    const own = shown(folder.name)
    const { parent } = split(folder.name)
    const outer = parent === null ? {} : shown(parent)
    const taken = { color: own.color ?? outer.color, icon: own.icon ?? outer.icon, sort: own.sort ?? outer.sort, template: own.template ?? outer.template }
    return {
      ...folder,
      ...(place === undefined ? {} : { place }),
      ...(taken.color ? { color: taken.color } : {}),
      ...(taken.icon ? { icon: taken.icon } : {}),
      ...(taken.sort ? { sort: taken.sort } : {}),
      ...(taken.template ? { template: taken.template } : {}),
    }
  }
  return {
    folders: [...folders.values()].map(placed).sort(byName),
    categories: [...categories.values()].map(({ name, color, count }) => ({ name, color, count })).sort(byName),
  }
}

/** Those given a place first, in its order; then the rest, as they were. */
const byPlace = (a: Folder, b: Folder) => (a.place === b.place ? 0 : a.place === undefined ? 1 : b.place === undefined ? -1 : a.place - b.place)

/**
 * The folders as they're laid out: those inside no other, A to Z, each with
 * the ones inside it, A to Z by their own names; or, once they've been put
 * in an order of one's own, in that, with any not in it after, A to Z.
 */
export function treeOf(library: Library): { folder: Folder; inside: Folder[] }[] {
  // The library's are A to Z already, and a sort keeps that among those with no place.
  const tops = library.folders.filter((folder) => split(folder.name).parent === null).sort(byPlace)
  return tops.map((folder) => ({
    folder,
    inside: library.folders
      .filter((one) => {
        const { parent } = split(one.name)
        return parent !== null && sameName(parent, folder.name)
      })
      // Numbers as numbers: Part 2 before Part 10.
      .sort((a, b) => byPlace(a, b) || split(a.name).name.localeCompare(split(b.name).name, undefined, { numeric: true })),
  }))
}

/**
 * Without Nib Plus: this many folders, and this many categories, made
 * here. Any more, from a device with Plus or from before it ended, stay,
 * and stay usable; it's only making another that waits for Plus. A folder
 * inside another is one of the three, like any other.
 */
export const FREE_FOLDERS = 3
export const FREE_CATEGORIES = 3

export function canMake(kind: 'folder' | 'category', library: Library, plus: boolean): boolean {
  if (plus) return true
  return kind === 'folder' ? library.folders.length < FREE_FOLDERS : library.categories.length < FREE_CATEGORIES
}

/** Whether `place` is still there to show. */
export function stillThere(place: Place, library: Library): boolean {
  if (!place || apart(place)) return true
  if ('folder' in place) return library.folders.some((folder) => sameName(folder.name, place.folder))
  return library.categories.some((category) => sameName(category.name, place.category))
}

/**
 * Where a document written while the library shows `place` goes. `newIn`
 * (lib/startAt) is the folder for one that would otherwise go in none, while
 * that folder is still there. One written while the templates are shown is a
 * template (lib/templates), in no folder.
 */
export function filing(place: Place, library: Library, newIn: string | null = null): { folder?: string; categories?: Category[]; template?: boolean } {
  if (place && 'templates' in place) return { template: true }
  if (place && 'folder' in place) return { folder: place.folder }
  const chosen = newIn === null ? undefined : library.folders.find((folder) => sameName(folder.name, newIn))
  const filed = chosen ? { folder: chosen.name } : {}
  if (!place || apart(place)) return filed
  const category = library.categories.find((known) => sameName(known.name, place.category))
  return category ? { ...filed, categories: [{ name: category.name, color: category.color }] } : filed
}

// ---------------------------------------------------------------------------
// Made here: kept on this device, empty or not, till it's removed here. One
// renamed or removed on another device stays here, empty, under its old name.

export type Made = { folders: string[]; categories: Category[] }
const MADE_KEY = 'nib-folders'
const MADE_NONE: Made = { folders: [], categories: [] }

function readMade(): Made {
  try {
    const raw = JSON.parse(localStorage.getItem(MADE_KEY) ?? 'null') as Partial<Made> | null
    if (!raw) return MADE_NONE
    const folders = Array.isArray(raw.folders) ? raw.folders.map(asName).filter((name) => name !== undefined) : []
    return { folders, categories: asCategories(raw.categories) ?? [] }
  } catch {
    return MADE_NONE
  }
}

let made = readMade()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useMade = () => useSyncExternalStore(subscribe, () => made)

function writeMade(next: Made) {
  made = next
  try {
    localStorage.setItem(MADE_KEY, JSON.stringify(made))
  } catch {
    // Storage off: they last for this session.
  }
  listeners.forEach((listener) => listener())
}

/** A new, empty folder: inside another when its name says so (`within`). False when the name is no name, or one already there. */
export function makeFolder(name: string, library: Library): boolean {
  const named = asName(name)
  if (!named || library.folders.some((folder) => sameName(folder.name, named))) return false
  writeMade({ ...made, folders: [...made.folders, named] })
  return true
}

/** A new category, in `color`. False when the name is no name, or one already there. */
export function makeCategory(name: string, color: Accent, library: Library): boolean {
  const named = asName(name)
  if (!named || library.categories.some((category) => sameName(category.name, named))) return false
  writeMade({ ...made, categories: [...made.categories, { name: named, color }] })
  return true
}

// ---------------------------------------------------------------------------
// Renamed, recoloured, removed: on every document in it, and here if made here.

/** What `folder` becomes when the folder `from` becomes `to`: itself, unless it is `from` or is inside it. `to` null is `from` removed. */
export function moved(folder: string, from: string, to: string | null): string | null {
  const { parent, name } = split(folder)
  if (sameName(folder, from)) return to ?? parent
  return parent !== null && sameName(parent, from) ? (to === null ? name : within(to, name)) : folder
}

/**
 * Why the folder `from` can't be called `to`, or null if it can: no name, a
 * name too long for it or for a folder inside it (a document's folder is
 * both names together, and MAX_NAME is the most that holds), or a name that
 * would put a folder with others inside it inside another.
 */
export function cantRename(from: string, to: string, library: Library): string | null {
  const named = asName(to)
  if (!named) return to.trim() ? `That name is too long. A folder’s name can have ${MAX_NAME} characters, with the name of the folder it’s in.` : 'A folder needs a name.'
  const inside = library.folders.filter((folder) => !sameName(folder.name, from) && under(folder.name, from))
  if (inside.length && split(named).parent !== null) return 'A folder with folders inside it can’t go inside another.'
  if (inside.some((folder) => !asName(moved(folder.name, from, named)!))) return 'That name is too long for the folders inside it.'
  return null
}

/**
 * Where the folder `name` can be moved: out to the top, said as null, when
 * it's inside one, and into each other folder at the top. Nowhere for one
 * with folders inside it, which would then be two deep.
 */
export function movesFor(name: string, library: Library): (string | null)[] {
  if (library.folders.some((folder) => !sameName(folder.name, name) && under(folder.name, name))) return []
  const { parent } = split(name)
  const tops = library.folders.filter((folder) => split(folder.name).parent === null && !sameName(folder.name, name) && !(parent !== null && sameName(folder.name, parent)))
  return [...(parent === null ? [] : [null]), ...tops.map((folder) => folder.name)]
}

/** What the folder `name` is called once it's inside `into`, or out at the top for null: moving it is renaming it that (renameFolder). */
export const movedInto = (name: string, into: string | null) => (into === null ? split(name).name : within(into, split(name).name))

/** Into a folder already there merges the two. The folders inside it go with it. */
export async function renameFolder(from: string, to: string): Promise<void> {
  const named = asName(to)
  if (!named) return
  await refileFolder(from, named)
}

/**
 * Its documents stay: in no folder, or, taken out of a folder it was inside,
 * in that one. The folders inside it stay too, inside nothing.
 */
export async function removeFolder(name: string): Promise<void> {
  await refileFolder(name, null)
}

async function refileFolder(from: string, to: string | null) {
  // The one removed is no longer made here: only its documents go to the folder it was in, which isn't made by that.
  writeMade({ ...made, folders: made.folders.flatMap((name) => (sameName(name, from) ? (to ?? []) : moved(name, from, to)!)) })
  carrySettings(from, to)
  await items.refile(
    (item) => (item.folder ? under(item.folder, from) : false),
    (item) => {
      item.folder = moved(item.folder!, from, to)
    },
  )
}

/**
 * Each folder's settings (lib/folderSettings) to the name it has once `from`
 * is `to`, its place with it while it's among the same folders: `from` only
 * renamed where it is, or one inside it taken along. The one removed leaves
 * its own behind (its documents go to the folder it was in, which keeps its
 * own), and those inside it, at the top now, have no place there.
 */
function carrySettings(from: string, to: string | null) {
  const settings = readFolderSettings()
  const moves = Object.keys(settings)
    .filter((name) => !settings[name].gone && under(name, from))
    .map((name) => {
      const next = to === null && sameName(name, from) ? null : moved(name, from, to)
      const keepPlace = next !== null && (sameName(name, from) ? sameName(split(name).parent ?? '', split(next).parent ?? '') : to !== null)
      return { from: name, to: next, keepPlace }
    })
  renameSettings(moves)
}

/** Into a category already there merges the two. */
export async function renameCategory(from: string, to: string): Promise<void> {
  const named = asName(to)
  if (!named) return
  const rename = (category: Category) => (sameName(category.name, from) ? { ...category, name: named } : category)
  writeMade({ ...made, categories: asCategories(made.categories.map(rename)) ?? [] })
  await changeCategories(from, (categories) => asCategories(categories.map(rename)) ?? [])
}

export async function recolorCategory(name: string, color: Accent): Promise<void> {
  const recolor = (category: Category) => (sameName(category.name, name) ? { ...category, color } : category)
  writeMade({ ...made, categories: made.categories.map(recolor) })
  await changeCategories(name, (categories) => categories.map(recolor))
}

/** Its documents stay, without it. */
export async function removeCategory(name: string): Promise<void> {
  const others = (category: Category) => !sameName(category.name, name)
  writeMade({ ...made, categories: made.categories.filter(others) })
  await changeCategories(name, (categories) => categories.filter(others))
}

function changeCategories(name: string, change: (categories: Category[]) => Category[]) {
  return items.refile(
    (item) => item.categories?.some((category) => sameName(category.name, name)) ?? false,
    (item) => {
      item.categories = change(item.categories ?? [])
    },
  )
}
