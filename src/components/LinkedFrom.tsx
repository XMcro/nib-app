import { useState } from 'react'
import type { Item } from '../db/db'
import { linksTo } from '../lib/links'
import { nameOf } from '../lib/fountain'

/** A pointer, not an index: a few, and the rest on request. */
const SHOWN = 5

/** Under a note or page, the ones that link to it. Nothing at all when none do. */
export function LinkedFrom({ id, items, onOpen }: { id: string; items: Item[]; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false)
  const from = linksTo(id, items)
  if (!from.length) return null
  const shown = all ? from : from.slice(0, SHOWN)
  return (
    <section aria-label="Linked from" className="mt-16 border-t border-line pt-3">
      <h2 className="mb-1 text-[11px] text-faint">Linked from</h2>
      <ul>
        {shown.map((item) => (
          <li key={item.id}>
            <button
              onClick={() => onOpen(item.id)}
              className="nib-tap cursor-pointer py-0.5 text-left text-[13px] text-muted hover:text-ink pointer-coarse:py-1.5"
            >
              {nameOf(item)}
            </button>
          </li>
        ))}
      </ul>
      {!all && from.length > SHOWN && (
        <button onClick={() => setAll(true)} className="nib-tap mt-1 cursor-pointer text-[11px] text-faint hover:text-ink">
          {from.length - SHOWN} more
        </button>
      )}
    </section>
  )
}
