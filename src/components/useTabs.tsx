import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { Item, Kind } from '../db/db'
import { forget } from '../editor/kept'
import { NEW_TAB_SHORTCUT, NEXT_TAB_SHORTCUT, PREVIOUS_TAB_SHORTCUT } from '../lib/platform'
import { ONE_TAB, added, along, alone, closed, follow, inFront, keepTabs, keptTabs, nextTo, pinned, without, type Tab } from '../lib/tabs'
import type { OpenDocument } from '../lib/useOpenDocument'
import { shownTitle } from '../lib/vault'
import { CommandPalette, type Command } from './CommandPalette'
import { TabStrip } from './TabStrip'
import { useWide } from './useSideBySide'

const TABS_PLUS = 'Keeping several documents open in tabs is part of Nib Plus.'

/** Tabs (lib/tabs): the documents kept open, their strip, the picker for one more, and their rows in the palette. */
export function useTabs({ session, ready, everything, archived, trash, kind, features, focusMode, newDraft }: {
  session: OpenDocument
  /** The library has been read: which documents are still here is known. */
  ready: boolean
  everything: Item[]
  archived: Item[]
  trash: Item[]
  /** What a draft's tab is called: a new note, or a new page. */
  kind: Kind
  /** Plus's features are open. */
  features: boolean
  focusMode: boolean
  /** A new draft in the tab in front, as New note or New page makes one. */
  newDraft: () => void
}) {
  const { activeId, select, flush, resetToDraft } = session
  const [state, setState] = useState(ONE_TAB)
  const [picking, setPicking] = useState<'keyboard' | 'touch' | null>(null)
  const wide = useWide()
  // Shown with room for it, as Side by side is, and once there's a second.
  const shown = wide && features && state.tabs.length > 1

  // Kept on this device for the next time Nib opens (lib/tabs keepTabs), from once the ones kept last time are back:
  // written first here, so the pass that brings those back doesn't write over them with the one tab it began with.
  const back = useRef(false)
  useEffect(() => {
    if (back.current) keepTabs(state)
  }, [state])

  // The tabs kept on this device, once: when the library has been read, so the documents gone since are known, and with Plus.
  // Not over something opened or begun before then. The document that was in front opens again, under the library.
  const bringBack = useEffectEvent(() => {
    const kept = session.idle() ? keptTabs((id) => everything.some((item) => item.id === id) || archived.some((item) => item.id === id)) : null
    if (!kept) return
    setState(kept)
    const front = kept.tabs.find((tab) => tab.key === kept.front)!
    if (front.id !== null) void select(front.id)
  })
  useEffect(() => {
    if (back.current || !ready || !features) return
    back.current = true
    bringBack()
  }, [ready, features])

  // A document put in the trash leaves its tab. Not the one in front, which says where it went (App's banner).
  useEffect(() => {
    if (trash.length) setState((now) => (now.tabs.length > 1 ? without(now, (id) => trash.some((item) => item.id === id)) : now))
  }, [trash])

  // An editor is kept for each tab behind, to come back to as it was left (editor/kept), and for nothing else:
  // after every change of tabs, and of what's open, which is when one is put away.
  useEffect(() => forget((id) => state.tabs.some((tab) => tab.id === id && tab.key !== state.front)), [state, session.doc.key])

  const found = useMemo(
    () => state.tabs.map((tab) => (tab.id === null ? undefined : (everything.find((item) => item.id === tab.id) ?? archived.find((item) => item.id === tab.id)))),
    [state.tabs, everything, archived],
  )
  // A document saved a moment ago is in its tab before it is in the lists.
  const label = (tab: Tab, index: number) => (found[index] ? shownTitle(found[index]) : tab.id !== null ? 'Untitled' : kind === 'page' ? 'New page' : 'New note')

  async function openInNew(id: string) {
    setState((now) => added(now, id))
    // Comes to the front as it opens (follow).
    await select(id)
  }

  /**
   * To a tab behind. A document's comes forward as it opens (follow). A
   * draft's has nothing stored to open, so it's a new draft there: after the
   * save, so that a draft just typed has its document by then, and the tab
   * being left has that.
   */
  async function goTo({ key, id }: Tab) {
    if (id !== null) return select(id)
    await flush()
    setState((now) => inFront(now, key))
    resetToDraft()
  }

  async function newTab() {
    await flush() // as in goTo
    setState((now) => inFront(added(now, null), now.next))
    newDraft()
  }

  function show(key: number) {
    const tab = state.tabs.find((one) => one.key === key)
    if (tab && key !== state.front) void goTo(tab)
  }

  const front = state.tabs.find((tab) => tab.key === state.front)!

  async function close(key: number) {
    const to = key === state.front ? nextTo(state) : undefined
    if (to) await goTo(to)
    // Not the one in front (lib/tabs closed): if the next couldn't be opened, this one stays.
    setState((now) => closed(now, key))
  }

  return {
    /** The strip is showing, and the writing starts below it. */
    shown,
    /** For lib/useOpenDocument to say what the open document now is. */
    follow: (id: string | null) => setState((now) => follow(now, id)),
    /** Back to the one in front, when the library has been replaced whole. */
    reset: () => setState(alone),
    picker: picking && (
      <CommandPalette
        items={everything.filter((item) => item.id !== activeId).sort((a, b) => b.updatedAt - a.updatedAt)}
        commands={[]}
        listItems
        placeholder="Open in a new tab: search your writing"
        onSelectItem={(id) => void openInNew(id)}
        onClose={() => setPicking(null)}
        focusSearch={picking === 'keyboard'}
      />
    ),
    strip: shown && (
      <TabStrip
        tabs={state.tabs.map((tab, index) => ({ key: tab.key, label: label(tab, index), pinned: tab.pinned === true }))}
        front={state.front}
        hidden={focusMode}
        onShow={show}
        onClose={(key) => void close(key)}
        onUnpin={(key) => setState((now) => pinned(now, key, false))}
        onNew={() => void newTab()}
      />
    ),
    /** Their rows in the palette, opened as `palette` says. */
    commands: (plusRow: (row: Command, reason: string) => Command[], palette: 'keyboard' | 'touch' | null): Command[] =>
      !wide
        ? []
        : [
            ...plusRow({ id: 'tab-open', label: 'Open in a new tab…', run: () => setPicking(palette === 'touch' ? 'touch' : 'keyboard') }, TABS_PLUS),
            ...plusRow({ id: 'tab-new', label: 'New tab', hint: NEW_TAB_SHORTCUT, run: () => void newTab() }, TABS_PLUS),
            ...(shown
              ? [
                  { id: 'tab-next', label: 'Next tab', hint: NEXT_TAB_SHORTCUT, run: () => void goTo(along(state, 1)) },
                  { id: 'tab-previous', label: 'Previous tab', hint: PREVIOUS_TAB_SHORTCUT, run: () => void goTo(along(state, -1)) },
                  // A draft has no document to keep.
                  ...(front.id === null ? [] : [{ id: 'tab-pin', label: front.pinned ? 'Unpin this tab' : 'Pin this tab', run: () => setState((now) => pinned(now, front.key, !front.pinned)) }]),
                  { id: 'tab-close', label: 'Close this tab', run: () => void close(state.front) },
                ]
              : []),
          ],
  }
}
