import { useState, useSyncExternalStore } from 'react'
import type { Item } from '../db/db'
import { useCounted } from '../lib/counts'
import type { OpenDocument } from '../lib/useOpenDocument'
import * as vault from '../lib/vault'
import { BesidePane } from './BesidePane'
import { CommandPalette, type Command } from './CommandPalette'

const BESIDE_PLUS = 'Opening a second document beside the one you’re writing is part of Nib Plus.'

/**
 * A window wide enough for two documents side by side: an iPad, a Mac, a wide
 * browser window. Not an iPhone, even on its side: wide enough there, but a
 * touch screen 400-odd points tall (index.css's phone).
 */
const WIDE = '(min-width: 800px) and (pointer: fine), (min-width: 800px) and (min-height: 501px)'
export const useWide = () =>
  useSyncExternalStore(
    (changed) => {
      const media = matchMedia(WIDE)
      media.addEventListener('change', changed)
      return () => media.removeEventListener('change', changed)
    },
    () => matchMedia(WIDE).matches,
  )

/** Side by side: the document beside the one being written, its picker, its pane and its rows in the palette. */
export function useSideBySide({ session, everything, activeItem, features, focusMode }: {
  session: OpenDocument
  everything: Item[]
  activeItem: Item | undefined
  /** Plus's features are open. */
  features: boolean
  focusMode: boolean
}) {
  const { activeId, select, currentId } = session
  // The document beside the one being written, and its picker while open.
  const [beside, setBeside] = useState<string | null>(null)
  const [picking, setPicking] = useState<'keyboard' | 'touch' | null>(null)
  const wide = useWide()
  useCounted(beside !== null, 'open_beside')
  // Shown while there's room, out of focus mode, and while it's a document of its own that can be read.
  const besideFound = beside === null ? undefined : everything.find((item) => item.id === beside)
  const besideItem = wide && features && !focusMode && besideFound && besideFound.id !== activeId && !vault.isLocked(besideFound) ? besideFound : undefined

  /**
   * Side by side: write in the document beside, and read the one that was
   * being written beside it. A draft not yet saved, or a locked one, can't be
   * read there (BesidePane reads what's stored), so the pane closes instead.
   */
  async function swapBeside() {
    if (!besideItem) return
    const to = besideItem.id
    const was = activeItem && !vault.isLocked(activeItem) ? activeItem.id : null
    await select(to)
    if (currentId() === to) setBeside(was)
  }

  return {
    /** The document beside, while it shows. */
    item: besideItem,
    picker: picking && (
      <CommandPalette
        items={everything.filter((item) => item.id !== activeId && !vault.isLocked(item)).sort((a, b) => b.updatedAt - a.updatedAt)}
        commands={[]}
        listItems
        placeholder="Open beside: search your writing"
        onSelectItem={setBeside}
        onClose={() => setPicking(null)}
        focusSearch={picking === 'keyboard'}
      />
    ),
    pane: besideItem && <BesidePane key={besideItem.id} item={besideItem} onSwap={() => void swapBeside()} onClose={() => setBeside(null)} />,
    /** Its rows in the palette, opened as `palette` says. */
    commands: (plusRow: (row: Command, reason: string) => Command[], palette: 'keyboard' | 'touch' | null): Command[] =>
      !wide
        ? []
        : besideItem
          ? [
              { id: 'beside-swap', label: 'Swap with the document beside', run: () => void swapBeside() },
              { id: 'beside', label: 'Close the document beside', run: () => setBeside(null) },
            ]
          : plusRow({ id: 'beside', label: 'Open beside…', run: () => setPicking(palette === 'touch' ? 'touch' : 'keyboard') }, BESIDE_PLUS),
  }
}
