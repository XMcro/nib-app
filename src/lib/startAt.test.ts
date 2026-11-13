// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { DEFAULT_START, isDefaultStart, keepLeftAt, leftAt, parseStart, setStart, useStart } from './startAt'

afterEach(() => {
  setStart(DEFAULT_START)
  localStorage.clear()
})

describe('where Nib opens', () => {
  it('is on Notes, with everything showing and no folder for what’s new, unless something else was kept', () => {
    expect(parseStart(undefined)).toEqual(DEFAULT_START)
    expect(parseStart('pages')).toEqual(DEFAULT_START)
    expect(parseStart({ on: 'trash', folder: 42, newIn: '  ' })).toEqual(DEFAULT_START)
    expect(parseStart({ on: 'last', folder: 'Novel/Part 1', newIn: 'Letters' })).toEqual({ on: 'last', folder: 'Novel/Part 1', newIn: 'Letters' })
    expect(isDefaultStart(DEFAULT_START)).toBe(true)
    for (const other of [{ on: 'pages' }, { folder: 'Novel' }, { newIn: 'Novel' }] as const) expect(isDefaultStart({ ...DEFAULT_START, ...other })).toBe(false)
  })

  it('keeps a choice on this device, part by part, and tells whoever is showing it', () => {
    const shown = renderHook(() => useStart())
    setStart({ on: 'pages' })
    setStart({ newIn: 'Letters' })
    shown.rerender()
    expect(shown.result.current).toEqual({ on: 'pages', folder: null, newIn: 'Letters' })
    expect(JSON.parse(localStorage.getItem('nib-start')!)).toEqual({ on: 'pages', folder: null, newIn: 'Letters' })
    // Back as Nib always opened, nothing is kept at all.
    setStart(DEFAULT_START)
    expect(localStorage.getItem('nib-start')).toBeNull()
  })

  it('keeps what was on screen only while Nib is to open where it was left', () => {
    keepLeftAt('a-note')
    expect(leftAt()).toBeNull()

    setStart({ on: 'last' })
    keepLeftAt('a-note')
    expect(leftAt()).toBe('a-note')
    // Back at the library, there is nothing to come back to.
    keepLeftAt(null)
    expect(leftAt()).toBeNull()

    // Chosen otherwise, what was kept is forgotten then, not left lying.
    keepLeftAt('a-note')
    setStart({ on: 'notes' })
    expect(leftAt()).toBeNull()
    expect(localStorage.getItem('nib-left-at')).toBeNull()
  })
})
