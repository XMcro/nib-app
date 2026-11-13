// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { DEFAULT_LOOK, KEYBOARD_MAX, TOOLBAR_MAX, TOOLBAR_TOOLS, applyLook, asSavedLooks, mergeSavedLooks, parseLook, resetLook, setLook, shownLook, type SavedLooks } from './look'

afterEach(() => {
  resetLook()
  vi.restoreAllMocks()
  const root = document.documentElement
  for (const name of Object.keys(root.dataset)) delete root.dataset[name]
  root.removeAttribute('style')
})

describe('reading a stored look', () => {
  it('is the default when nothing is stored, or nothing usable', () => {
    expect(parseLook(undefined)).toEqual(DEFAULT_LOOK)
    expect(parseLook('large')).toEqual(DEFAULT_LOOK)
    expect(parseLook({ size: 'huge', side: 'top', accent: 'toString', wordCount: 'no' })).toEqual(DEFAULT_LOOK)
  })

  it('keeps what it knows', () => {
    const look = parseLook({ size: 'larger', notesFont: 'serif', accent: 'teal', outline: false })
    expect(look).toMatchObject({ size: 'larger', notesFont: 'serif', accent: 'teal', outline: false })
  })

  // A toolbar is a list from storage: anything unknown, repeated or past the
  // room on the row is dropped rather than drawn.
  it('keeps only the buttons a toolbar can hold, once each and no more than fit', () => {
    const every = TOOLBAR_TOOLS.map((tool) => tool.id)
    expect(parseLook({ toolbar: ['link', 'link', 'format-rocket', 'code'] }).toolbar).toEqual(['link', 'code'])
    expect(parseLook({ toolbar: every }).toolbar).toHaveLength(TOOLBAR_MAX)
    expect(parseLook({ keyboardBar: ['format-bold', 'format-heading'] }).keyboardBar).toEqual(['format-bold'])
    expect(parseLook({ keyboardBar: Array(20).fill('format-bold') }).keyboardBar.length).toBeLessThanOrEqual(KEYBOARD_MAX)
    expect(parseLook({ toolbar: 'bold' }).toolbar).toEqual(DEFAULT_LOOK.toolbar)
  })

  it('keeps a library background and a highlight with one’s own theme only if each is a colour the text reads on', () => {
    const night = { paper: '#14161A', ink: '#e8e4da', accent: '#7fb4d6' }
    const kept = { paper: '#14161a', ink: '#e8e4da', accent: '#7fb4d6' }
    expect(parseLook({ ownTheme: { ...night, shell: '#0B0C0E', highlight: '#3a2f55' } }).ownTheme).toEqual({ ...kept, shell: '#0b0c0e', highlight: '#3a2f55' })
    // One that isn't a colour, or that the text wouldn't read on, is left to be worked out; the rest stays.
    expect(parseLook({ ownTheme: { ...night, shell: 'navy', highlight: '#3a2f55' } }).ownTheme).toEqual({ ...kept, highlight: '#3a2f55' })
    expect(parseLook({ ownTheme: { ...night, shell: 42, highlight: null } }).ownTheme).toEqual(kept)
    expect(parseLook({ ownTheme: { ...night, shell: '#0b0c0e', highlight: '#f5e9a8' } }).ownTheme).toEqual({ ...kept, shell: '#0b0c0e' })
    expect(parseLook({ ownTheme: night }).ownTheme).toEqual(kept)
    // Without three that read there is no theme to keep them with.
    expect(parseLook({ ownTheme: { paper: '#ffffff', ink: '#cccccc', accent: '#1f64bf', shell: '#f0f0f0' } }).ownTheme).toEqual(DEFAULT_LOOK.ownTheme)
  })

  it('is the default with storage blocked, and a change still lasts the session', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    vi.resetModules()
    const fresh = await import('./look')
    expect(() => fresh.setLook({ size: 'large' })).not.toThrow()
  })

  it('is kept between launches', async () => {
    setLook({ width: 'wide', accent: 'red' })
    vi.resetModules()
    const fresh = await import('./look')
    const { result } = renderHook(() => fresh.useChosenLook())
    expect(result.current).toMatchObject({ width: 'wide', accent: 'red' })
  })
})

describe('saved looks', () => {
  afterEach(() => {
    localStorage.removeItem('nib-looks')
    localStorage.removeItem('nib-saved-looks')
  })
  const names = (looks: { name: string }[]) => looks.map((entry) => entry.name)

  it('keep a name, the look and the theme; a name saved again replaces it; eight at most; a deleted one kept gone', async () => {
    vi.resetModules()
    const fresh = await import('./look')
    const said = vi.fn()
    window.addEventListener(fresh.LOOKS_CHANGED, said)
    const { result } = renderHook(() => fresh.useSavedLooks())
    fresh.setLook({ size: 'large' })
    act(() => fresh.saveLook('  Drafting  ', 'cream-soda'))
    fresh.setLook({ size: 'small' })
    act(() => fresh.saveLook('Drafting', 'dark'))
    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({ name: 'Drafting', theme: 'dark', look: { size: 'small' } })
    expect(said).toHaveBeenCalledTimes(2)

    for (let n = 0; n < 12; n++) act(() => fresh.saveLook(`Look ${n}`, 'light'))
    expect(result.current).toHaveLength(fresh.SAVED_MAX)
    act(() => fresh.deleteSavedLook('Drafting'))
    expect(names(result.current)).not.toContain('Drafting')
    expect(fresh.readSavedLooks().Drafting).toMatchObject({ gone: true })
    expect(JSON.parse(localStorage.getItem('nib-saved-looks')!).Drafting).toMatchObject({ gone: true })
    window.removeEventListener(fresh.LOOKS_CHANGED, said)
  })

  it('kept as a list before they synced, are read once into the record, in their order, only the well-formed', async () => {
    localStorage.setItem('nib-looks', JSON.stringify([{ name: 'Newer', theme: 'light', look: { size: 'huge' } }, { name: '', theme: 'light' }, { name: 'No theme' }, 'nonsense', { name: 'Older', theme: 'dark', look: { size: 'large' } }]))
    vi.resetModules()
    const fresh = await import('./look')
    const { result } = renderHook(() => fresh.useSavedLooks())
    expect(names(result.current)).toEqual(['Newer', 'Older'])
    expect(result.current[0].look.size).toBe('standard')
    expect(localStorage.getItem('nib-looks')).toBeNull()
    expect(Object.keys(JSON.parse(localStorage.getItem('nib-saved-looks')!))).toEqual(['Newer', 'Older'])
  })
})

describe('saved looks between devices', () => {
  const look = (size: string) => parseLook({ size })
  const iphone: SavedLooks = { Drafting: { at: 5, look: look('large'), theme: 'light' }, Editing: { at: 2, look: look('small'), theme: 'dark' } }
  const mac: SavedLooks = { Drafting: { at: 3, look: look('small'), theme: 'dark' }, Editing: { at: 4, gone: true }, Night: { at: 6, look: look('standard'), theme: 'dark' } }

  it('merge look by look, the one saved or deleted last kept, in one order', () => {
    const both = mergeSavedLooks(iphone, mac)
    expect(both).toEqual({ Drafting: iphone.Drafting, Editing: { at: 4, gone: true }, Night: mac.Night })
    expect(Object.keys(both)).toEqual(['Drafting', 'Editing', 'Night'])
    expect(mergeSavedLooks(mac, iphone)).toEqual(both)
  })

  it('take only what’s well formed from outside, and nothing that isn’t an object', () => {
    for (const raw of [null, [], 'x', 7]) expect(asSavedLooks(raw)).toBeUndefined()
    expect(asSavedLooks({ '  Drafting ': { at: 1, theme: 'light', look: { size: 'large' } }, '': { at: 1, theme: 'light' }, Bad: { at: -1, theme: 'light' }, NoTheme: { at: 1 }, Gone: { at: 2, gone: true, look: {} } })).toEqual({
      Drafting: { at: 1, theme: 'light', look: look('large') },
      Gone: { at: 2, gone: true },
    })
  })
})

describe('the look without Nib Plus', () => {
  const chosen = parseLook({ size: 'large', motion: 'less', notesFont: 'serif', accent: 'pink', toolbar: ['link'] })

  it('keeps the free half and draws the Plus half as it always was', () => {
    const shown = shownLook({ ...chosen, spacing: 'airy', highlight: 'green', paragraphs: 'indented', align: 'justified' }, { active: false, known: true })
    expect(shown).toMatchObject({ size: 'large', motion: 'less', spacing: 'airy' })
    expect(shown).toMatchObject({ notesFont: 'mono', paragraphs: 'lines', align: 'ragged', accent: 'theme', highlight: 'theme', toolbar: DEFAULT_LOOK.toolbar })
  })

  // As with a Plus theme: a subscriber's look mustn't flicker through the
  // default while the App Store is still answering.
  it('draws all of it until the App Store has answered, and with Plus', () => {
    expect(shownLook(chosen, { active: false, known: false })).toEqual(chosen)
    expect(shownLook(chosen, { active: true, known: true })).toEqual(chosen)
  })
})

describe('putting the look on the page', () => {
  it('puts nothing on <html> for the default', () => {
    applyLook(DEFAULT_LOOK)
    expect({ ...document.documentElement.dataset }).toEqual({})
    expect(document.documentElement.getAttribute('style')).toBeNull()
  })

  it('marks each choice that differs, and takes it off again', () => {
    const root = document.documentElement
    applyLook(parseLook({ size: 'small', width: 'narrow', motion: 'none', spacing: 'tight', notesFont: 'sans', pagesFont: 'serif', accent: 'green', highlight: 'blue' }))
    expect({ ...root.dataset }).toEqual({ size: 'small', width: 'narrow', motion: 'none', spacing: 'tight', notesFont: 'sans', pagesFont: 'serif', accent: 'green', highlight: 'blue' })

    applyLook(DEFAULT_LOOK)
    expect({ ...root.dataset }).toEqual({})
    expect(root.style.getPropertyValue('--nib-accent-light')).toBe('')
    expect(root.style.getPropertyValue('--nib-highlight-light')).toBe('')
  })

  it('leaves the theme’s own attribute alone', () => {
    document.documentElement.dataset.theme = 'cream-soda'
    applyLook(parseLook({ accent: 'blue' }))
    applyLook(DEFAULT_LOOK)
    expect(document.documentElement.dataset.theme).toBe('cream-soda')
  })
})
