/**
 * Tabs (Nib Plus, on an iPad, a Mac or a wide window): the documents kept open
 * along the top of the writing. One is in front, and it is the open document
 * (lib/useOpenDocument): there is one editor, and a tab is only which document
 * it shows. With one tab there is no strip, and Nib is as it was.
 */

/**
 * A tab: a document's id, or null for a draft nothing is saved of yet. Its key
 * tells it from another draft. A pinned one keeps its document: what's opened
 * while it's in front goes in a tab of its own. The pinned come first.
 */
export type Tab = { key: number; id: string | null; pinned?: true }
export type Tabs = { tabs: Tab[]; front: number; next: number }

export const ONE_TAB: Tabs = { tabs: [{ key: 0, id: null }], front: 0, next: 1 }

const at = (state: Tabs, key: number) => state.tabs.findIndex((tab) => tab.key === key)

/**
 * The open document is now `id`, however it came to be: the tab that has it
 * comes to the front, else the one in front takes it. So what's opened from
 * the library, a link or a new draft goes in the tab in front, and the others
 * stay as they are. A pinned tab in front keeps its own, and what's opened
 * gets a new tab.
 */
export function follow(state: Tabs, id: string | null): Tabs {
  const front = state.tabs[at(state, state.front)]
  if (front.id === id) return state
  const has = id === null ? undefined : state.tabs.find((tab) => tab.id === id)
  if (has) return { ...state, front: has.key }
  if (front.pinned) return inFront(added(state, id), state.next)
  return { ...state, tabs: state.tabs.map((tab) => (tab === front ? { ...tab, id } : tab)) }
}

/**
 * One more tab, still behind: for `id`, unless a tab has that already, or a
 * draft. After the one in front, or after all the pinned when that's one of
 * them. Its key is the `next` there was.
 */
export function added(state: Tabs, id: string | null): Tabs {
  if (id !== null && state.tabs.some((tab) => tab.id === id)) return state
  const tabs = [...state.tabs]
  tabs.splice(Math.max(at(state, state.front) + 1, pinnedIn(state)), 0, { key: state.next, id })
  return { ...state, tabs, next: state.next + 1 }
}

const pinnedIn = (state: Tabs) => state.tabs.filter((tab) => tab.pinned).length

/** The tab `key` pinned, after the others that are, or not pinned any more, before the others that aren't. */
export function pinned(state: Tabs, key: number, on: boolean): Tabs {
  const tab = state.tabs[at(state, key)]
  if (!tab || Boolean(tab.pinned) === on) return state
  const tabs = state.tabs.filter((one) => one !== tab)
  tabs.splice(pinnedIn({ ...state, tabs }), 0, on ? { ...tab, pinned: true } : { key: tab.key, id: tab.id })
  return { ...state, tabs }
}

/** The tab `by` places along from the one in front, round the end to the start. */
export function along(state: Tabs, by: 1 | -1): Tab {
  return state.tabs[(at(state, state.front) + by + state.tabs.length) % state.tabs.length]
}

/** The tab `key` in front. Only for a draft, which there's nothing to open of: a document's tab comes forward as it opens (follow). */
export function inFront(state: Tabs, key: number): Tabs {
  return at(state, key) < 0 || state.front === key ? state : { ...state, front: key }
}

/** Without the tab `key`. Never the one in front, which is the open document: another comes forward first (nextTo). */
export function closed(state: Tabs, key: number): Tabs {
  if (key === state.front || at(state, key) < 0) return state
  return { ...state, tabs: state.tabs.filter((tab) => tab.key !== key) }
}

/** The tab that comes forward as the one in front closes: the one after it, else the one before. None for the only tab. */
export function nextTo(state: Tabs): Tab | undefined {
  const index = at(state, state.front)
  return state.tabs[index + 1] ?? state.tabs[index - 1]
}

/** Without the tabs behind whose documents are `gone`. */
export function without(state: Tabs, gone: (id: string) => boolean): Tabs {
  const tabs = state.tabs.filter((tab) => tab.key === state.front || tab.id === null || !gone(tab.id))
  return tabs.length === state.tabs.length ? state : { ...state, tabs }
}

/** Only the tab in front. */
export function alone(state: Tabs): Tabs {
  return state.tabs.length === 1 ? state : { ...state, tabs: state.tabs.filter((tab) => tab.key === state.front) }
}

const KEY = 'nib-tabs'

/** What is kept of the tabs on this device: the documents, in order, which are pinned, and which was in front. A draft has nothing to keep. */
type Stored = { tabs: { id: string; pinned?: true }[]; front: string | null }

/**
 * Kept on this device, as folds are (lib/folds), for the next time Nib opens.
 * Nothing is kept of one tab alone: Nib then opens on a new note, as it
 * always has.
 */
export function keepTabs(state: Tabs) {
  const tabs = state.tabs.flatMap(({ id, pinned }) => (id === null ? [] : [pinned ? { id, pinned } : { id }]))
  try {
    if (state.tabs.length < 2) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify({ tabs, front: state.tabs[at(state, state.front)].id } satisfies Stored))
  } catch {
    // Storage off or full: the tabs last while Nib is open.
  }
}

/**
 * The tabs kept on this device, less the documents no longer `here`, or null
 * with none kept. The one that was in front is in front again; if that was a
 * draft, or its document has gone, a draft's tab is, at the end.
 */
export function keptTabs(here: (id: string) => boolean): Tabs | null {
  let stored: Partial<Stored> | null
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Stored> | null
  } catch {
    return null
  }
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.tabs)) return null
  const seen = new Set<string>()
  const tabs: Tab[] = []
  for (const one of stored.tabs as unknown[]) {
    const { id, pinned } = (one && typeof one === 'object' ? one : {}) as { id?: unknown; pinned?: unknown }
    if (typeof id !== 'string' || seen.has(id) || !here(id)) continue
    seen.add(id)
    tabs.push(pinned === true ? { key: tabs.length, id, pinned } : { key: tabs.length, id })
  }
  if (!tabs.length) return null
  // As they're kept in order, the pinned are first already, unless what's stored was changed by hand.
  tabs.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
  const front = tabs.find((tab) => tab.id === stored.front)
  if (front) return { tabs, front: front.key, next: tabs.length }
  return { tabs: [...tabs, { key: tabs.length, id: null }], front: tabs.length, next: tabs.length + 1 }
}
