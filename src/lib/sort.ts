import type { Item } from '../db/db'
import { titleOf } from './text'

export type Sort = 'updated' | 'created' | 'title'

export const SORTS: Sort[] = ['updated', 'created', 'title']

export const SORT_LABEL: Record<Sort, string> = {
  updated: 'Recent',
  created: 'Created',
  title: 'A–Z',
}

const STORAGE_KEY = 'nib-sort'

/** Guarded for the same reason as readTheme: this runs during the first render. */
export function readSort(): Sort {
  let value: string | null = null
  try {
    value = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* storage blocked: fall back to the default order */
  }
  return SORTS.includes(value as Sort) ? (value as Sort) : 'updated'
}

export function writeSort(sort: Sort): void {
  try {
    localStorage.setItem(STORAGE_KEY, sort)
  } catch {
    /* the preference simply is not remembered */
  }
}

// One, made once: localeCompare given options builds a collator per call,
// and sorting the library calls it tens of thousands of times.
const byTitle = new Intl.Collator(undefined, { sensitivity: 'base' })

function within(sort: Sort) {
  return (a: Item, b: Item) => {
    switch (sort) {
      case 'created':
        return b.createdAt - a.createdAt
      case 'title':
        return byTitle.compare(titleOf(a.body), titleOf(b.body))
      default:
        return b.updatedAt - a.updatedAt
    }
  }
}

/**
 * Pinned items float to the top whatever the sort, most recently pinned first.
 * Returns a new array; never mutates the caller's list.
 */
export function sortItems(items: Item[], sort: Sort): Item[] {
  const compare = within(sort)
  return [...items].sort((a, b) => {
    if (a.pinnedAt !== undefined || b.pinnedAt !== undefined) {
      if (a.pinnedAt === undefined) return 1
      if (b.pinnedAt === undefined) return -1
      return b.pinnedAt - a.pinnedAt
    }
    return compare(a, b)
  })
}
