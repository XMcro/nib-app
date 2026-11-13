import type { JSONContent } from '@tiptap/react'
import * as items from '../db/items'
import { nodeOf, partsIn, type Part } from './links'

/**
 * Writes the marker `block` on one line of the document `id`, so that a link
 * can go to that line whatever becomes of its words (lib/links Part). It is a
 * change to that document like any other: it is saved, and it syncs.
 *
 * `part` is the line as the list showed it. The document may have been saved
 * since: the line is looked for where it was, then by its words; and if it
 * isn't found, or has a marker, nothing is written and the link opens the
 * document at its top. Nothing is written to a read-only or a locked one.
 */
export function markPart(id: string, part: Part, block: string): Promise<void> {
  return items.amend(id, (stored) => {
    const body = JSON.parse(JSON.stringify(stored)) as JSONContent
    const now = partsIn(body)
    const found = now[part.index]?.text === part.text ? now[part.index] : now.find((one) => one.text === part.text)
    const line = found && !found.block ? nodeOf(body, found) : undefined
    if (!line) return null
    line.attrs = { ...line.attrs, blockId: block }
    return body
  })
}
