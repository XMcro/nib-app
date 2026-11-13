// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Library } from './folders'
import { DEFAULT_START, leftAt, setStart, type Start } from './startAt'
import { useStartAt } from './useStartAt'

const LIBRARY: Library = { folders: [{ name: 'Novel', count: 2 }, { name: 'Novel/Part 1', count: 1 }], categories: [] }

function launch(start: Partial<Start>, given: { ready?: boolean; features?: boolean; untouched?: boolean; has?: boolean; onScreen?: string | null } = {}) {
  setStart({ ...DEFAULT_START, ...start })
  const calls = { changeKind: vi.fn(), setPlace: vi.fn(), open: vi.fn() }
  const props = (now: typeof given) => ({
    start: { ...DEFAULT_START, ...start },
    ready: now.ready ?? true,
    features: now.features ?? true,
    untouched: () => now.untouched ?? true,
    has: () => now.has ?? true,
    library: LIBRARY,
    onScreen: now.onScreen ?? null,
    ...calls,
  })
  const hook = renderHook((now: typeof given) => useStartAt(props(now)), { initialProps: given })
  return { ...calls, again: (now: typeof given) => hook.rerender({ ...given, ...now }) }
}

afterEach(() => {
  setStart(DEFAULT_START)
  localStorage.clear()
})

describe('Nib opening where it was asked to', () => {
  it('does nothing of its own when nothing was chosen', () => {
    const { changeKind, setPlace, open } = launch({})
    expect([changeKind, setPlace, open].some((call) => call.mock.calls.length)).toBe(false)
  })

  it('opens on Pages, and on a folder under the name it has', () => {
    const { changeKind, setPlace, open } = launch({ on: 'pages', folder: 'novel/part 1' })
    expect(changeKind).toHaveBeenCalledWith('page')
    expect(setPlace).toHaveBeenCalledWith({ folder: 'Novel/Part 1' })
    expect(open).not.toHaveBeenCalled()
  })

  it('shows everything if the folder has gone', () => {
    const { changeKind, setPlace } = launch({ folder: 'Letters' })
    expect(setPlace).not.toHaveBeenCalled()
    expect(changeKind).not.toHaveBeenCalled()
  })

  it('opens the document Nib was left at, if it’s still there', () => {
    setStart({ on: 'last' })
    localStorage.setItem('nib-left-at', 'a-note')
    const there = launch({ on: 'last' })
    expect(there.open).toHaveBeenCalledWith('a-note')

    localStorage.setItem('nib-left-at', 'a-note')
    const gone = launch({ on: 'last' }, { has: false })
    expect(gone.open).not.toHaveBeenCalled()

    // Left at the library, it opens there.
    localStorage.removeItem('nib-left-at')
    expect(launch({ on: 'last' }).open).not.toHaveBeenCalled()
    // And what was left at counts for nothing once Nib is to open elsewhere.
    localStorage.setItem('nib-left-at', 'a-note')
    expect(launch({ on: 'pages' }).open).not.toHaveBeenCalled()
  })

  it('waits for the library and for Plus, then does it once', () => {
    const { changeKind, again } = launch({ on: 'pages' }, { ready: false, features: false })
    expect(changeKind).not.toHaveBeenCalled()
    again({ ready: true, features: false })
    expect(changeKind).not.toHaveBeenCalled()
    again({ ready: true, features: true })
    expect(changeKind).toHaveBeenCalledTimes(1)
    // Plus lapsing and coming back is no second launch.
    again({ ready: true, features: false })
    again({ ready: true, features: true })
    expect(changeKind).toHaveBeenCalledTimes(1)
  })

  it('leaves alone what was opened or chosen before then', () => {
    localStorage.setItem('nib-left-at', 'a-note')
    const { changeKind, setPlace, open } = launch({ on: 'last', folder: 'Novel' }, { untouched: false })
    expect([changeKind, setPlace, open].some((call) => call.mock.calls.length)).toBe(false)
  })

  it('keeps what’s on screen for the next launch: from once it has opened, with Plus, and where Nib was left is where it’s to open', () => {
    setStart({ on: 'last' })
    localStorage.setItem('nib-left-at', 'left-yesterday')
    // Before the library is read nothing's on screen yet: that isn't kept over what was left.
    const { again, open } = launch({ on: 'last' }, { ready: false })
    expect(leftAt()).toBe('left-yesterday')
    again({ ready: true })
    expect(open).toHaveBeenCalledWith('left-yesterday')
    again({ ready: true, onScreen: 'another' })
    expect(leftAt()).toBe('another')
    again({ ready: true, onScreen: null })
    expect(leftAt()).toBeNull()

    // Without Plus nothing is kept.
    again({ ready: true, onScreen: 'another' })
    again({ ready: true, features: false, onScreen: 'a-third' })
    expect(leftAt()).toBe('another')
  })
})
