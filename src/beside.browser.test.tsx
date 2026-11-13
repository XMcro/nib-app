import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { localDay } from './lib/time'

/**
 * Side by side (components/BesidePane), in the Mac app: a second document
 * beside the one being written, read-only, from Commands, with Nib Plus and
 * a window wide enough for two.
 */

const state = vi.hoisted(() => ({ active: true }))
vi.mock('./lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/platform')>()), nativeApp: true, macApp: true, touchApp: false }))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [...useState({ active: state.active }), true],
  store: { products: async () => ({ products: [] }), purchase: vi.fn(), restore: vi.fn(), manage: vi.fn(), entitlement: vi.fn() },
}))

const { App } = await import('./App')
const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)))
const library = () => within(document.querySelector<HTMLElement>('.nib-library')!)
const commands = async () => {
  await act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id: 'palette' })))
  return within(screen.getByRole('dialog', { name: 'Commands' }))
}
const doc = (title: string, text: string) => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
    { type: 'paragraph', content: [{ type: 'text', text }] },
  ],
})
const beside = () => screen.queryByRole('complementary', { name: /^Beside:/ })

beforeEach(async () => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  state.active = true
  localStorage.setItem('nib-device-asked', '1')
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  await db.items.clear()
  await items.create('page', doc('Research notes', 'Tides at seven and nine.'))
  await items.create('page', doc('The Crossing', 'The ferry leaves at seven.'))
  await page.viewport(1280, 800)
})
afterEach(() => void vi.useRealTimers())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function open() {
  await act(async () => void render(<App />))
  await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
  await userEvent.click(await library().findByText('The Crossing'))
  await expect.poll(() => document.querySelector('main [data-scroll] .ProseMirror')?.textContent).toContain('The ferry leaves at seven.')
}

async function openBeside() {
  await userEvent.click((await commands()).getByText('Open beside…'))
  const picker = within(screen.getByRole('dialog', { name: 'Commands' }))
  expect(picker.getByPlaceholderText('Open beside: search your writing')).toBeTruthy()
  // Every other document, listed before anything is typed; not the one being written.
  expect(picker.getAllByRole('button').map((row) => row.textContent)).toEqual(['Research notesPage'])
  await userEvent.click(picker.getByText('Research notes'))
}

describe('Side by side', () => {
  // Commands took focus back to the writing as it closed: the title went into the text, and Escape and the arrows did nothing.
  it('gives the picker the keyboard, and the writing it back after', async () => {
    await open()
    await userEvent.click(document.querySelector('main .ProseMirror')!)
    await userEvent.click((await commands()).getByText('Open beside…'))
    const field = screen.getByPlaceholderText<HTMLInputElement>('Open beside: search your writing')
    await expect.poll(() => document.activeElement).toBe(field)
    await userEvent.keyboard('Res')
    expect(field.value).toBe('Res')
    expect(document.querySelector('main .ProseMirror')!.textContent).not.toContain('Res')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await expect.poll(() => document.activeElement?.closest('.ProseMirror') != null).toBe(true)
  })

  it('opens another document beside the one being written, to read', async () => {
    await open()
    await openBeside()
    const pane = beside()!
    expect(pane.getAttribute('aria-label')).toBe('Beside: Research notes')
    expect(pane.textContent).toContain('Tides at seven and nine.')
    expect(pane.querySelector('.ProseMirror')!.getAttribute('contenteditable')).toBe('false')
    // The one being written is still the one being written.
    expect(document.querySelector('main [data-scroll] .ProseMirror')!.textContent).toContain('The ferry leaves at seven.')
  })

  // The gesture itself is the browser's, which the test's driver can't start
  // from a selection; what's carried, and taken in, is Nib's.
  it('takes words dragged across into the one being written', async () => {
    await open()
    await openBeside()
    const from = (beside()!.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor
    const to = (document.querySelector('main [data-scroll] .ProseMirror') as HTMLElement & { editor: Editor }).editor
    act(() => void from.commands.setTextSelection({ from: 17, to: 31 }))
    const grip = from.view.coordsAtPos(20)
    const data = new DataTransfer()
    act(() => void from.view.dom.dispatchEvent(new DragEvent('dragstart', { dataTransfer: data, bubbles: true, cancelable: true, clientX: grip.left, clientY: grip.top + 4 })))
    const end = to.view.coordsAtPos(to.state.doc.content.size - 1)
    act(() => void to.view.dom.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: end.left + 1, clientY: end.top + 4 })))
    expect(to.getText()).toBe('The Crossing\n\nThe ferry leaves at seven.Tides at seven')
    // Copied, not taken: the one beside is never changed.
    expect(from.getText()).toBe('Research notes\n\nTides at seven and nine.')
  })

  it('leaves the writing its own count and outline, in its own half', async () => {
    await open()
    const outline = () => getComputedStyle(document.querySelector('.nib-rail')!).display
    expect(outline()).not.toBe('none')
    await openBeside()
    const pane = beside()!.getBoundingClientRect()
    const count = within(document.querySelector('main')!).getByRole('button', { name: /words · / })
    expect(count.getBoundingClientRect().right).toBeLessThanOrEqual(pane.left)
    // No room is left beside the narrower text, so the outline steps aside rather than sit on the words.
    expect(outline()).toBe('none')
  })

  it('reads aloud over the writing’s half, a line above its count', async () => {
    class Utterance {
      rate = 1
      onend = null
      onerror = null
      text: string
      constructor(text: string) {
        this.text = text
      }
    }
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() })
    // An iPad upright: half of it is as narrow as a phone.
    await page.viewport(820, 1180)
    await open()
    await openBeside()
    await userEvent.click((await commands()).getByText('Read aloud'))
    const bar = screen.getByRole('toolbar', { name: 'Reading aloud' }).getBoundingClientRect()
    const count = within(document.querySelector('main')!).getByRole('button', { name: /words · / }).getBoundingClientRect()
    expect(bar.right).toBeLessThanOrEqual(beside()!.getBoundingClientRect().left)
    expect(bar.bottom).toBeLessThanOrEqual(count.top)
  })

  it('can be closed while a notice is showing', async () => {
    await open()
    await openBeside()
    await act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id: 'table-add-row' })))
    expect(screen.getByText('Put the cursor in a table first.')).toBeTruthy()
    const close = screen.getByRole('button', { name: 'Close the document beside' })
    const at = close.getBoundingClientRect()
    expect(document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2)?.closest('button')).toBe(close)
    await userEvent.click(close)
    expect(beside()).toBeNull()
  })

  it('swaps the two: the one beside to write in, the other beside it to read', async () => {
    await open()
    await openBeside()
    await userEvent.click(screen.getByRole('button', { name: 'Swap: write in this one' }))
    await waitFor(() => expect(beside()?.getAttribute('aria-label')).toBe('Beside: The Crossing'))
    const writing = () => document.querySelector('main [data-scroll] .ProseMirror') as HTMLElement & { editor: Editor }
    expect(writing().textContent).toContain('Tides at seven and nine.')
    expect(writing().getAttribute('contenteditable')).toBe('true')
    expect(beside()!.textContent).toContain('The ferry leaves at seven.')
    // What's written goes with it when they swap back: saved, then read beside.
    act(() => void writing().editor.commands.insertContentAt(writing().editor.state.doc.content.size - 1, ' Then eleven.'))
    await userEvent.click((await commands()).getByText('Swap with the document beside'))
    await waitFor(() => expect(beside()?.getAttribute('aria-label')).toBe('Beside: Research notes'))
    expect(writing().textContent).toContain('The ferry leaves at seven.')
    await waitFor(() => expect(beside()!.textContent).toContain('Tides at seven and nine. Then eleven.'))
  })

  it('closes on a swap from a draft not yet saved, which has nothing to read beside', async () => {
    await open()
    await openBeside()
    await userEvent.click((await commands()).getByText('New page'))
    await wait()
    expect(beside()).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Swap: write in this one' }))
    await waitFor(() => expect(beside()).toBeNull())
    expect(document.querySelector('main [data-scroll] .ProseMirror')!.textContent).toContain('Tides at seven and nine.')
    // Closed for good, not hidden: it doesn't come back beside the next one opened.
    await wait()
    await commands()
    await userEvent.keyboard('The Crossing{Enter}')
    await wait()
    expect(document.querySelector('main [data-scroll] .ProseMirror')!.textContent).toContain('The ferry leaves at seven.')
    expect(beside()).toBeNull()
  })

  it('closes from its own button, and from Commands', async () => {
    await open()
    await openBeside()
    await userEvent.click(screen.getByRole('button', { name: 'Close the document beside' }))
    expect(beside()).toBeNull()
    await openBeside()
    await userEvent.click((await commands()).getByText('Close the document beside'))
    expect(beside()).toBeNull()
  })

  it('steps aside for focus mode, and comes back after', async () => {
    await open()
    await openBeside()
    await userEvent.click((await commands()).getByText('Focus mode'))
    expect(beside()).toBeNull()
    await userEvent.click((await commands()).getByText('Leave focus mode'))
    expect(beside()).not.toBeNull()
  })

  it('is for a window with room for two: not offered narrower, and put away as it narrows', async () => {
    await open()
    await openBeside()
    await page.viewport(700, 800)
    await waitFor(() => expect(beside()).toBeNull())
    expect((await commands()).queryByText(/beside/)).toBeNull()
    await userEvent.keyboard('{Escape}')
    await page.viewport(1280, 800)
    await waitFor(() => expect(beside()).not.toBeNull())
  })

  it('asks for Nib Plus without it, saying why', async () => {
    state.active = false
    await open()
    const row = (await commands()).getByText('Open beside…').closest('button')!
    expect(row.textContent).toContain('Plus')
    await userEvent.click(row)
    expect(await screen.findByText(/Opening a second document beside the one you’re writing is part of Nib Plus/)).toBeTruthy()
    expect(beside()).toBeNull()
  })
})
