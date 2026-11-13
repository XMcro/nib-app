// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { ONE_TAB, added, along, alone, closed, follow, inFront, keepTabs, keptTabs, nextTo, pinned, without, type Tabs } from './tabs'

const ids = (state: Tabs) => state.tabs.map((tab) => tab.id)
const front = (state: Tabs) => state.tabs.find((tab) => tab.key === state.front)!.id
/** Tabs for these documents, the first in front. */
const tabsOf = (...of: (string | null)[]): Tabs => ({ tabs: of.map((id, key) => ({ key, id })), front: 0, next: of.length })

describe('tabs', () => {
  it('starts as one tab, a draft', () => {
    expect(ids(ONE_TAB)).toEqual([null])
    expect(front(ONE_TAB)).toBeNull()
  })

  it('puts what opens in the tab in front, and leaves the others', () => {
    const state = follow(tabsOf('a', 'b'), 'c')
    expect(ids(state)).toEqual(['c', 'b'])
    expect(front(state)).toBe('c')
  })

  it('goes to the tab that has a document already, in place of opening it twice', () => {
    const state = follow(tabsOf('a', 'b'), 'b')
    expect(ids(state)).toEqual(['a', 'b'])
    expect(front(state)).toBe('b')
  })

  // The save and the opening can reach the screen as one: each is followed in turn all the same.
  it('gives a draft’s tab its document when it’s first saved, before another comes forward', () => {
    const state = follow(follow(tabsOf(null, 'b'), 'new'), 'b')
    expect(ids(state)).toEqual(['new', 'b'])
    expect(front(state)).toBe('b')
  })

  it('makes the tab in front a draft for a new note, and never goes to another draft’s tab for it', () => {
    const state = follow(tabsOf('a', null), null)
    expect(ids(state)).toEqual([null, null])
    expect(state.front).toBe(0)
  })

  it('is the same object when nothing changes', () => {
    const state = tabsOf('a', 'b')
    expect(follow(state, 'a')).toBe(state)
    expect(inFront(state, 0)).toBe(state)
    expect(inFront(state, 9)).toBe(state)
    expect(closed(state, 9)).toBe(state)
    expect(without(state, () => false)).toBe(state)
    expect(alone(tabsOf('a'))).toEqual(tabsOf('a'))
  })

  it('adds a tab after the one in front, behind it still', () => {
    const state = added({ ...tabsOf('a', 'b', 'c'), front: 1 }, 'd')
    expect(ids(state)).toEqual(['a', 'b', 'd', 'c'])
    expect(front(state)).toBe('b')
    expect(state.tabs[2].key).toBe(3)
    expect(state.next).toBe(4)
  })

  it('adds no second tab for a document, and any number of drafts', () => {
    const state = tabsOf('a', 'b')
    expect(added(state, 'b')).toBe(state)
    expect(ids(added(added(state, null), null))).toEqual(['a', null, null, 'b'])
  })

  it('never gives two tabs one key, after any closing', () => {
    let state = added(tabsOf('a'), 'b')
    state = closed(state, 1)
    state = added(state, 'c')
    expect(state.tabs.map((tab) => tab.key)).toEqual([0, 2])
  })

  it('closes a tab behind, and not the one in front', () => {
    const state = tabsOf('a', 'b', 'c')
    expect(ids(closed(state, 1))).toEqual(['a', 'c'])
    expect(closed(state, 0)).toBe(state)
  })

  it('brings the next tab forward as the one in front closes, or the one before at the end', () => {
    expect(nextTo(tabsOf('a', 'b', 'c'))!.id).toBe('b')
    expect(nextTo({ ...tabsOf('a', 'b', 'c'), front: 2 })!.id).toBe('b')
    expect(nextTo(tabsOf('a'))).toBeUndefined()
  })

  it('drops the tabs behind whose documents are gone, and keeps the one in front and drafts', () => {
    const state = without(tabsOf('a', 'b', null, 'c'), (id) => id === 'a' || id === 'b')
    expect(ids(state)).toEqual(['a', null, 'c'])
    expect(front(state)).toBe('a')
  })

  it('goes back to the one in front alone', () => {
    const state = alone({ ...tabsOf('a', 'b', null), front: 1 })
    expect(ids(state)).toEqual(['b'])
    expect(front(state)).toBe('b')
  })

  describe('pinned', () => {
    const names = (state: Tabs) => state.tabs.map((tab) => (tab.pinned ? `${tab.id}!` : tab.id))

    it('go first, in the order they were pinned, and come back to the head of the rest', () => {
      let state = pinned(tabsOf('a', 'b', 'c', 'd'), 2, true)
      expect(names(state)).toEqual(['c!', 'a', 'b', 'd'])
      state = pinned(state, 3, true)
      expect(names(state)).toEqual(['c!', 'd!', 'a', 'b'])
      state = pinned(state, 2, false)
      expect(names(state)).toEqual(['d!', 'c', 'a', 'b'])
      // The one in front is still the one in front, wherever it went.
      expect(front(state)).toBe('a')
      expect(pinned(state, 3, true)).toBe(state)
      expect(pinned(state, 9, true)).toBe(state)
    })

    it('keep their document: what opens with one in front gets a tab of its own, after the pinned', () => {
      const state = follow(pinned(pinned(tabsOf('a', 'b', 'c'), 0, true), 1, true), 'x')
      expect(names(state)).toEqual(['a!', 'b!', 'x', 'c'])
      expect(front(state)).toBe('x')
      // A new note too.
      const draft = follow(pinned(tabsOf('a', 'b'), 0, true), null)
      expect(names(draft)).toEqual(['a!', null, 'b'])
      expect(front(draft)).toBeNull()
    })

    it('are gone to like any other, when what opens is theirs', () => {
      const state = follow({ ...pinned(tabsOf('a', 'b'), 0, true), front: 1 }, 'a')
      expect(names(state)).toEqual(['a!', 'b'])
      expect(front(state)).toBe('a')
    })

    it('have a tab added after them all, from the first of them', () => {
      const state = added(pinned(pinned(tabsOf('a', 'b', 'c'), 0, true), 1, true), 'x')
      expect(names(state)).toEqual(['a!', 'b!', 'x', 'c'])
    })
  })

  it('goes along the strip either way, round its ends', () => {
    const state = tabsOf('a', 'b', 'c')
    expect(along(state, 1).id).toBe('b')
    expect(along(state, -1).id).toBe('c')
    expect(along({ ...state, front: 2 }, 1).id).toBe('a')
  })

  describe('kept on this device', () => {
    beforeEach(() => localStorage.clear())
    const all = () => true

    it('come back as they were: the documents in order, the pinned, and the one in front', () => {
      keepTabs({ ...pinned(tabsOf('a', 'b', 'c'), 1, true), front: 2 })
      const state = keptTabs(all)!
      expect(state.tabs).toEqual([{ key: 0, id: 'b', pinned: true }, { key: 1, id: 'a' }, { key: 2, id: 'c' }])
      expect(front(state)).toBe('c')
      expect(state.next).toBe(3)
    })

    it('come back on a draft at the end when a draft was in front, with its tab not kept', () => {
      keepTabs({ ...tabsOf('a', null, 'b'), front: 1 })
      const state = keptTabs(all)!
      expect(ids(state)).toEqual(['a', 'b', null])
      expect(front(state)).toBeNull()
    })

    it('come back without the documents gone since, and on a draft if the one in front went', () => {
      keepTabs(tabsOf('a', 'b', 'c'))
      const state = keptTabs((id) => id !== 'a')!
      expect(ids(state)).toEqual(['b', 'c', null])
      expect(front(state)).toBeNull()
      expect(keptTabs(() => false)).toBeNull()
    })

    it('keep nothing of one tab, so Nib opens on a new note as it always has', () => {
      keepTabs(tabsOf('a', 'b'))
      keepTabs(tabsOf('a'))
      expect(localStorage.getItem('nib-tabs')).toBeNull()
      expect(keptTabs(all)).toBeNull()
    })

    it('read nothing from what isn’t theirs, and no document twice', () => {
      for (const stored of ['nonsense', '[]', '{"tabs":"a"}', '{"tabs":[{"id":3},null,"a"]}']) {
        localStorage.setItem('nib-tabs', stored)
        expect(keptTabs(all)).toBeNull()
      }
      localStorage.setItem('nib-tabs', '{"tabs":[{"id":"a"},{"id":"a","pinned":true},{"id":"b","pinned":"yes"}],"front":"b"}')
      const state = keptTabs(all)!
      expect(state.tabs).toEqual([{ key: 0, id: 'a' }, { key: 1, id: 'b' }])
      expect(front(state)).toBe('b')
    })
  })
})
