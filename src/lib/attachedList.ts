import type { Item } from '../db/db'
import { attachedIn } from './attachment'
import type { FileRef } from './fileRef'
import { shownTitle } from './vault'

/** One attachment as the manager lists it (components/AttachmentsPanel): the file, what it's called, and the document it's in. */
export type AttachedRow = { key: string; file: FileRef; name: string; item: string; title: string }

/**
 * Every attachment in `items`, the largest first, then by name: a file two
 * documents name is a row in each. `bytes`: the room they take, each file
 * counted once.
 */
export function attachedAcross(items: Item[]): { rows: AttachedRow[]; bytes: number } {
  const rows: AttachedRow[] = []
  const sizes = new Map<string, number>()
  for (const item of items) {
    attachedIn(item.body).forEach(({ file, name }, at) => {
      // Titled as in the library: by its first words, or with none, by what's attached to it.
      rows.push({ key: `${item.id} ${at}`, file, name, item: item.id, title: shownTitle(item) })
      sizes.set(file.id, file.size)
    })
  }
  rows.sort((a, b) => b.file.size - a.file.size || a.name.localeCompare(b.name))
  return { rows, bytes: [...sizes.values()].reduce((sum, size) => sum + size, 0) }
}
