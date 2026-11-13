import { useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Item, Kind } from '../db/db'
import { setOwn, useFolderSettings } from './folderSettings'
import { filing, inPlace, libraryOf, sameName, stillThere, useMade, type Place } from './folders'
import { readSort, sortItems, writeSort, type Sort } from './sort'
import { searchable } from './text'
import { vaultOpen } from './vault'

/** One empty list while the library is put away. */
const NOTHING: Item[] = []

/** What the library is showing: the search, the sort, the folder or category, the trash, and the list that makes. */
export function useLibraryView({ notes, pages, archived, templates = NOTHING, kind, open, filingRef, newIn = null }: {
  notes: Item[]
  pages: Item[]
  archived: Item[]
  /** lib/templates: apart, as the archive is. */
  templates?: Item[]
  /** The tab open. */
  kind: Kind
  /** On screen. Put away, nothing below is worked out: nothing's drawn from it. */
  open: boolean
  /** Where a draft goes when it's first saved: what the list shows then. */
  filingRef: RefObject<ReturnType<typeof filing>>
  /** The folder for what's written with none showing (lib/startAt), if one is chosen. */
  newIn?: string | null
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>(readSort)
  const [viewingTrash, setViewingTrash] = useState(false)

  // Folders and categories (lib/folders): what the list shows, and every one there is.
  const [place, setPlace] = useState<Place>(null)
  const made = useMade()
  const arranged = useFolderSettings()
  // Folders, and a locked document's filing, show differently with the vault open.
  const opened = vaultOpen()
  const library = useMemo(() => {
    void opened
    return libraryOf([...notes, ...pages], made, arranged)
  }, [notes, pages, made, arranged, opened])
  // Back to everything when the one shown goes, removed or renamed on another
  // device; not before it's there, as one renamed here is till the rename lands.
  const placeThere = stillThere(place, library)
  const placeSeen = useRef(false)
  useEffect(() => {
    placeSeen.current = false
  }, [place])
  useEffect(() => {
    if (placeThere) placeSeen.current = true
    else if (placeSeen.current) setPlace(null)
  }, [place, placeThere])
  useEffect(() => {
    filingRef.current = filing(place, library, newIn)
  })

  // A folder shown is sorted its own way once it's been given one, or as the folder it's in is; the rest, the library's way.
  const shownFolder = place && 'folder' in place ? library.folders.find((folder) => sameName(folder.name, place.folder)) : undefined
  const shownSort = shownFolder?.sort ?? sort

  // The list waits for the field: a letter typed shows at once, its matches when they can.
  const needle = useDeferredValue(query).trim().toLowerCase()
  // Search reaches across both tabs and every folder; browsing stays within
  // the current tab, and the folder or category shown. The archive is apart
  // from both: its documents show, and are searched, only while it's open.
  // Put away it isn't drawn (Library), so the last list stands: it fades out with that.
  const lastList = useRef(NOTHING)
  const visible = useMemo(() => {
    void opened
    if (!open) return lastList.current
    // The templates, as the archive, apart: shown, and searched, only while they're open.
    const own = place !== null && 'archive' in place ? archived : place !== null && 'templates' in place ? templates : null
    const pool = needle ? (own ?? [...notes, ...pages]) : own ? own.filter((item) => item.kind === kind) : (kind === 'note' ? notes : pages).filter((item) => inPlace(item, place))
    return sortItems(needle ? pool.filter((item) => searchable(item.body).includes(needle)) : pool, shownSort)
  }, [open, needle, notes, pages, archived, templates, kind, place, shownSort, opened])
  lastList.current = visible

  /** The sort of the folder shown (lib/folderSettings), or the library's. */
  function changeSort(next: Sort) {
    if (shownFolder) return setOwn(shownFolder.name, { sort: next })
    setSort(next)
    writeSort(next)
  }

  return {
    query,
    setQuery,
    searching: needle.length > 0,
    visible,
    /** The library's, which a backup keeps. */
    sort,
    /** What the list shows is sorted by: the folder's own, or the library's. */
    shownSort,
    changeSort,
    /** A backup has replaced the library: the sort it brought takes effect. */
    rereadSort: () => setSort(readSort()),
    viewingTrash,
    setViewingTrash,
    place,
    setPlace,
    library,
  }
}
