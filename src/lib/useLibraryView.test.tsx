// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '../db/db'
import { sortItems } from './sort'
import { useLibraryView } from './useLibraryView'

vi.mock('./sort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sort')>()
  return { ...actual, sortItems: vi.fn(actual.sortItems) }
})

const note = (id: string): Item => ({ id, kind: 'note', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }] }, version: 1, createdAt: 1, updatedAt: 1 })
const notes = [note('a'), note('b')]
const pages: Item[] = []
const filingRef = { current: {} }
const archived = [{ ...note('kept away'), archivedAt: 5 }]
const props = (open: boolean) => ({ notes, pages, archived, kind: 'note' as const, open, filingRef })

beforeEach(() => {
  vi.mocked(sortItems).mockClear()
})

describe('useLibraryView', () => {
  it('sorts once for a list, however many times it’s drawn', () => {
    const { rerender } = renderHook((initial) => useLibraryView(initial), { initialProps: props(true) })
    expect(sortItems).toHaveBeenCalledOnce()
    rerender(props(true))
    rerender(props(true))
    expect(sortItems).toHaveBeenCalledOnce()
  })

  it('keeps the archive out of the list and out of search, and shows and searches it when it’s open', () => {
    const { result } = renderHook(() => useLibraryView(props(true)))
    const shown = () => result.current.visible.map((item) => item.id)
    expect(shown()).toEqual(expect.not.arrayContaining(['kept away']))
    act(() => result.current.setQuery('kept'))
    expect(shown()).toEqual([])
    act(() => result.current.setQuery(''))
    act(() => result.current.setPlace({ archive: true }))
    expect(shown()).toEqual(['kept away'])
    act(() => result.current.setQuery('kept'))
    expect(shown()).toEqual(['kept away'])
    act(() => result.current.setQuery('a'))
    expect(shown()).toEqual(['kept away'])
  })

  it('shows only the kind on its tab in the archive', () => {
    const { result } = renderHook(() => useLibraryView({ ...props(true), archived: [{ ...note('a page'), kind: 'page' as const, archivedAt: 5 }] }))
    act(() => result.current.setPlace({ archive: true }))
    expect(result.current.visible).toEqual([])
  })

  // It's put away while the writer types, and every save drew App again.
  it('works nothing out while the library is put away, and does on its return', () => {
    const { rerender, result } = renderHook((initial) => useLibraryView(initial), { initialProps: props(false) })
    expect(sortItems).not.toHaveBeenCalled()
    expect(result.current.visible).toEqual([])
    rerender(props(true))
    expect(sortItems).toHaveBeenCalledOnce()
    expect(result.current.visible.map((item) => item.id).sort()).toEqual(['a', 'b'])
  })
})
