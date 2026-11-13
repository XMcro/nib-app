import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { localDay } from './lib/time'
import { forget, keptCount } from './editor/kept'

/**
 * Tabs (lib/tabs, components/useTabs), in the Mac app: documents kept open
 * along the top of the writing, from Commands, with Nib Plus and a window
 * wide enough, as Side by side.
 */

const state = vi.hoisted(() => ({ active: true, set: (_: { active: boolean }) => {} }))
vi.mock('./lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/platform')>()), nativeApp: true, macApp: true, touchApp: false }))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => {
    const plus = useState({ active: state.active })
    state.set = plus[1]
    return [...plus, true]
  },
  store: { products: async () => ({ products: [] }), purchase: vi.fn(), restore: vi.fn(), manage: vi.fn(), entitlement: vi.fn() },
}))

const { App } = await import('./App')
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
const strip = () => screen.queryByRole('group', { name: 'Open documents' })
/** Each tab's name, the one in front in brackets. */
const tabs = () => [...strip()!.querySelectorAll('[data-tab]')].map(tabsName)
const tab = (name: string) => within(strip()!).getByRole('button', { name })
/** The same, with ! after a pinned one. */
const pins = () => [...strip()!.querySelectorAll('[data-tab]')].map((one) => tabsName(one) + (within(one as HTMLElement).queryByRole('button', { name: /^Unpin / }) ? '!' : ''))
const tabsName = (one: Element) => {
  const tab = one.querySelector('button')!
  return tab.getAttribute('aria-current') === 'true' ? `[${tab.textContent}]` : (tab.textContent ?? '')
}
const MOD = /Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? 'Meta' : 'Control'
const writing = () => document.querySelector('main [data-scroll] .ProseMirror') as HTMLElement & { editor: Editor }
const written = (text: string) => expect.poll(() => writing()?.textContent).toContain(text)
const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const typing = () => expect.poll(() => document.activeElement?.closest('.ProseMirror') != null).toBe(true)
/** Destroyed for good. Tiptap's own `isDestroyed` is also true of one that's only off the page. */
const gone = (editor: Editor) => editor.schema === null
const stored = async (title: string) => (await items.listAll()).find((item) => JSON.stringify(item.body).includes(title))!

beforeEach(async () => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  state.active = true
  localStorage.setItem('nib-device-asked', '1')
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  localStorage.removeItem('nib-tabs')
  await db.items.clear()
  await items.create('page', doc('Research notes', 'Tides at seven and nine.'))
  await items.create('page', doc('The Crossing', 'The ferry leaves at seven.'))
  await items.create('page', doc('Harbour', 'Nets on the wall.'))
  await page.viewport(1280, 800)
})
afterEach(() => void vi.useRealTimers())
afterEach(cleanup)
afterEach(() => forget(() => false))

async function open() {
  await act(async () => void render(<App />))
  await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
  await userEvent.click(await library().findByText('The Crossing'))
  await written('The ferry leaves at seven.')
}

async function openInNew(title: string) {
  await userEvent.click((await commands()).getByText('Open in a new tab…'))
  const picker = within(screen.getByRole('dialog', { name: 'Commands' }))
  expect(picker.getByPlaceholderText('Open in a new tab: search your writing')).toBeTruthy()
  await userEvent.click(picker.getByText(title))
}

describe('Tabs', () => {
  it('shows no strip with one document open, and nothing of tabs but the way to a second', async () => {
    await open()
    expect(strip()).toBeNull()
    const rows = await commands()
    expect(rows.getByText('Open in a new tab…')).toBeTruthy()
    expect(rows.queryByText('Close this tab')).toBeNull()
  })

  it('opens another document in a tab of its own, in front, after the one that was', async () => {
    await open()
    await openInNew('Research notes')
    await written('Tides at seven and nine.')
    expect(tabs()).toEqual(['The Crossing', '[Research notes]'])
    // Buttons in a group, the one in front marked current. Not tabs in a tablist: the Mac then calls each one's × a tab too.
    expect(within(strip()!).queryAllByRole('tab')).toEqual([])
    expect(tab('Research notes').getAttribute('aria-current')).toBe('true')
    expect(tab('The Crossing').getAttribute('aria-current')).toBeNull()
    // The picker lists every other document, the one open already among them; choosing that goes to its tab.
    await openInNew('The Crossing')
    await written('The ferry leaves at seven.')
    expect(tabs()).toEqual(['[The Crossing]', 'Research notes'])
  })

  it('goes to a tab when it’s clicked, with what was written in the one left saved', async () => {
    await open()
    await openInNew('Research notes')
    await written('Tides at seven and nine.')
    act(() => void writing().editor.commands.insertContentAt(writing().editor.state.doc.content.size - 1, ' Then eleven.'))
    await userEvent.click(tab('The Crossing'))
    await written('The ferry leaves at seven.')
    expect(tabs()).toEqual(['[The Crossing]', 'Research notes'])
    await userEvent.click(tab('Research notes'))
    await written('Tides at seven and nine. Then eleven.')
  })

  it('starts the writing below the strip, and the strip below the way back to the library', async () => {
    await open()
    const before = document.querySelector('main [data-scroll]')!.getBoundingClientRect().top
    await openInNew('Research notes')
    const bar = strip()!.getBoundingClientRect()
    expect(bar.top).toBeGreaterThanOrEqual(screen.getByRole('button', { name: 'Pages' }).getBoundingClientRect().bottom)
    const scroller = document.querySelector('main [data-scroll]')!.getBoundingClientRect()
    expect(scroller.top).toBeGreaterThanOrEqual(bar.bottom)
    expect(scroller.top).toBe(before + 36)
    expect(scroller.bottom).toBe(document.querySelector('main')!.getBoundingClientRect().bottom)
  })

  it('opens what’s chosen in the library in the tab in front, and goes to the tab of one open already', async () => {
    await open()
    await openInNew('Research notes')
    await userEvent.click(screen.getByRole('button', { name: 'Pages' }))
    await userEvent.click(await library().findByText('Harbour'))
    await written('Nets on the wall.')
    expect(tabs()).toEqual(['The Crossing', '[Harbour]'])
    await userEvent.click(screen.getByRole('button', { name: 'Pages' }))
    await userEvent.click(await library().findByText('The Crossing'))
    await written('The ferry leaves at seven.')
    expect(tabs()).toEqual(['[The Crossing]', 'Harbour'])
  })

  it('closes a tab behind and leaves the writing alone, and the strip goes with the last but one', async () => {
    await open()
    await openInNew('Research notes')
    await openInNew('Harbour')
    await written('Nets on the wall.')
    expect(tabs()).toEqual(['The Crossing', 'Research notes', '[Harbour]'])
    await userEvent.click(screen.getByRole('button', { name: 'Close The Crossing' }))
    expect(tabs()).toEqual(['Research notes', '[Harbour]'])
    expect(writing().textContent).toContain('Nets on the wall.')
    await userEvent.click(screen.getByRole('button', { name: 'Close Research notes' }))
    expect(strip()).toBeNull()
    expect(writing().textContent).toContain('Nets on the wall.')
    // Closed, not thrown away.
    expect((await items.listAll()).length).toBe(3)
  })

  it('closes the tab in front for the next one, or the one before at the end, from its button and from Commands', async () => {
    await open()
    await openInNew('Research notes')
    await openInNew('Harbour')
    await userEvent.click(tab('Research notes'))
    await written('Tides at seven and nine.')
    await userEvent.click(screen.getByRole('button', { name: 'Close Research notes' }))
    await written('Nets on the wall.')
    expect(tabs()).toEqual(['The Crossing', '[Harbour]'])
    await userEvent.click((await commands()).getByText('Close this tab'))
    await written('The ferry leaves at seven.')
    expect(strip()).toBeNull()
  })

  it('opens a new tab on a draft, keeps what’s written there under its first line, and comes back to it', async () => {
    await open()
    await openInNew('Research notes')
    await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(tabs()).toEqual(['The Crossing', 'Research notes', '[New page]']))
    expect(writing().textContent).toBe('')
    await expect.poll(() => document.activeElement?.closest('.ProseMirror') != null).toBe(true)
    await userEvent.keyboard('Low water')
    // Straight to another tab, before the save has come round.
    await userEvent.click(tab('The Crossing'))
    await written('The ferry leaves at seven.')
    await waitFor(() => expect(tabs()).toEqual(['[The Crossing]', 'Research notes', 'Low water']))
    await userEvent.click(tab('Low water'))
    await written('Low water')
  })

  it('keeps a tab for a draft with nothing written, to come back to', async () => {
    await open()
    await openInNew('Research notes')
    await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(tabs()).toEqual(['The Crossing', 'Research notes', '[New page]']))
    await userEvent.click(tab('Research notes'))
    await written('Tides at seven and nine.')
    expect(tabs()).toEqual(['The Crossing', '[Research notes]', 'New page'])
    await userEvent.click(tab('New page'))
    await waitFor(() => expect(tabs()).toEqual(['The Crossing', 'Research notes', '[New page]']))
    expect(writing().textContent).toBe('')
    expect((await items.listAll()).length).toBe(3)
  })

  // Nothing opens to save a draft on the way to another draft, as opening a document does: without a save of its own first, the tab left behind forgot what was written in it.
  it('keeps what was just written in a draft in its tab, on the way to a new tab or to an empty one', async () => {
    await open()
    await userEvent.click((await commands()).getByText('New page'))
    await openInNew('Research notes')
    await waitFor(() => expect(tabs()).toEqual(['New page', '[Research notes]']))
    await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(tabs()).toEqual(['New page', 'Research notes', '[New page]']))
    await expect.poll(() => document.activeElement?.closest('.ProseMirror') != null).toBe(true)
    await userEvent.keyboard('Low water')
    await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(tabs()).toEqual(['New page', 'Research notes', 'Low water', '[New page]']))
    await expect.poll(() => document.activeElement?.closest('.ProseMirror') != null).toBe(true)
    await userEvent.keyboard('High water')
    await userEvent.click(within(strip()!).getAllByRole('button', { name: 'New page' })[0])
    await waitFor(() => expect(tabs()).toEqual(['[New page]', 'Research notes', 'Low water', 'High water']))
    expect(writing().textContent).toBe('')
  })

  it('takes a document put in the trash out of its tab behind', async () => {
    await open()
    await openInNew('Research notes')
    await openInNew('Harbour')
    const crossing = (await items.listAll()).find((item) => item.kind === 'page' && JSON.stringify(item.body).includes('The Crossing'))!
    await act(() => items.remove(crossing.id))
    await waitFor(() => expect(tabs()).toEqual(['Research notes', '[Harbour]']))
  })

  it('steps aside for focus mode with its room kept, and comes back after', async () => {
    await open()
    await openInNew('Research notes')
    const top = () => document.querySelector('main [data-scroll]')!.getBoundingClientRect().top
    const before = top()
    await userEvent.click((await commands()).getByText('Focus mode'))
    expect(strip()!.closest('[data-hidden]')!.getAttribute('data-hidden')).toBe('true')
    expect(top()).toBe(before)
    await userEvent.click((await commands()).getByText('Leave focus mode'))
    expect(strip()!.closest('[data-hidden]')!.getAttribute('data-hidden')).toBe('false')
  })

  it('keeps to the writing’s half with a document beside', async () => {
    await open()
    await openInNew('Research notes')
    await userEvent.click((await commands()).getByText('Open beside…'))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Commands' })).getByText('Harbour'))
    const pane = screen.getByRole('complementary', { name: 'Beside: Harbour' }).getBoundingClientRect()
    expect(screen.getByRole('button', { name: 'New tab' }).getBoundingClientRect().right).toBeLessThanOrEqual(pane.left)
    expect(strip()!.parentElement!.getBoundingClientRect().right).toBeLessThanOrEqual(pane.left)
  })

  it('is for a window with room: not offered narrower, and put away as it narrows, with the tabs kept', async () => {
    await open()
    await openInNew('Research notes')
    const wide = document.querySelector('main [data-scroll]')!.getBoundingClientRect().top
    await page.viewport(700, 800)
    await waitFor(() => expect(strip()).toBeNull())
    expect(document.querySelector('main [data-scroll]')!.getBoundingClientRect().top).toBe(wide - 36)
    expect((await commands()).queryByText(/\btab\b/)).toBeNull()
    await userEvent.keyboard('{Escape}')
    await page.viewport(1280, 800)
    await waitFor(() => expect(tabs()).toEqual(['The Crossing', '[Research notes]']))
  })

  it('is put away when Nib Plus ends, and what’s open goes on as one document', async () => {
    await open()
    await openInNew('Research notes')
    act(() => state.set({ active: false }))
    await waitFor(() => expect(strip()).toBeNull())
    expect(writing().textContent).toContain('Tides at seven and nine.')
    expect((await commands()).queryByText('Close this tab')).toBeNull()
  })

  it('asks for Nib Plus without it, saying why', async () => {
    state.active = false
    await open()
    const row = (await commands()).getByText('Open in a new tab…').closest('button')!
    expect(row.textContent).toContain('Plus')
    await userEvent.click(row)
    expect(await screen.findByText(/Keeping several documents open in tabs is part of Nib Plus/)).toBeTruthy()
    expect(strip()).toBeNull()
  })

  describe('coming back to a tab', () => {
    it('finds it as it was left: the cursor where it was, and what was written there still to undo', async () => {
      await open()
      await openInNew('Research notes')
      await written('Tides at seven and nine.')
      await typing()
      const research = writing().editor
      await userEvent.keyboard(' Then eleven.')
      act(() => void research.commands.setTextSelection(4))
      await userEvent.click(tab('The Crossing'))
      await written('The ferry leaves at seven.')
      expect(keptCount()).toBe(1)

      await userEvent.click(tab('Research notes'))
      await written('Then eleven.')
      expect(writing().editor).toBe(research)
      // The one just left is kept in its turn.
      expect(keptCount()).toBe(1)
      await typing()
      expect(research.state.selection.from).toBe(4)
      await userEvent.keyboard('X')
      expect(research.getText()).toBe('ResXearch notes\n\nTides at seven and nine. Then eleven.')
      expect(research.can().undo()).toBe(true)
      act(() => {
        while (research.can().undo()) research.commands.undo()
      })
      expect(research.getText()).toBe('Research notes\n\nTides at seven and nine.')
      // And what's done there now is saved to it, as ever.
      await userEvent.click(tab('The Crossing'))
      await written('The ferry leaves at seven.')
      expect(JSON.stringify((await stored('Research notes')).body)).not.toContain('Then eleven')
    })

    it('finds it as far down as it was left', async () => {
      const lines = Array.from({ length: 200 }, (_, line) => ({ type: 'paragraph', content: [{ type: 'text', text: `Line ${line}` }] }))
      await items.create('page', { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Log' }] }, ...lines] })
      await open()
      await openInNew('Log')
      await written('Line 199')
      // Once it has the cursor, at its end, and has been scrolled to it, a frame later: only then is it the writer's to scroll.
      await typing()
      await frames()
      const scroller = document.querySelector('main [data-scroll]')!
      scroller.scrollTop = 1200
      await userEvent.click(tab('The Crossing'))
      await written('The ferry leaves at seven.')
      expect(scroller.scrollTop).toBe(0)
      await userEvent.click(tab('Log'))
      await written('Line 199')
      await typing()
      // After the cursor is back in it too, which is at its end and mustn't be scrolled to.
      await frames()
      expect(scroller.scrollTop).toBe(1200)
    })

    it('keeps a draft’s editor too, once what’s written in it is saved', async () => {
      await open()
      await openInNew('Research notes')
      await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
      await waitFor(() => expect(tabs()).toEqual(['The Crossing', 'Research notes', '[New page]']))
      await typing()
      const draft = writing().editor
      await userEvent.keyboard('Low water')
      await userEvent.click(tab('The Crossing'))
      await written('The ferry leaves at seven.')
      await userEvent.click(await within(strip()!).findByRole('button', { name: 'Low water' }))
      await written('Low water')
      expect(writing().editor).toBe(draft)
      expect(draft.can().undo()).toBe(true)
    })

    it('opens what’s stored when its document was changed elsewhere meanwhile, and not what it was left as', async () => {
      await open()
      await openInNew('Research notes')
      await written('Tides at seven and nine.')
      const research = writing().editor
      await userEvent.click(tab('The Crossing'))
      await written('The ferry leaves at seven.')
      await act(async () => void (await items.update((await stored('Research notes')).id, doc('Research notes', 'Tides at eight.'))))
      await userEvent.click(tab('Research notes'))
      await written('Tides at eight.')
      expect(writing().editor).not.toBe(research)
      await waitFor(() => expect(gone(research)).toBe(true))
      // The Crossing's, just left, and not the one that was left for this document.
      expect(keptCount()).toBe(1)
    })

    it('lets a tab’s editor go when the tab closes, and keeps none with one tab, as before there were tabs', async () => {
      await open()
      const crossing = writing().editor
      await openInNew('Research notes')
      await written('Tides at seven and nine.')
      expect(keptCount()).toBe(1)
      expect(gone(crossing)).toBe(false)
      await userEvent.click(screen.getByRole('button', { name: 'Close The Crossing' }))
      await waitFor(() => expect(gone(crossing)).toBe(true))
      expect(keptCount()).toBe(0)

      const research = writing().editor
      await userEvent.click(screen.getByRole('button', { name: 'Pages' }))
      await userEvent.click(await library().findByText('Harbour'))
      await written('Nets on the wall.')
      await waitFor(() => expect(gone(research)).toBe(true))
      expect(keptCount()).toBe(0)
    })
  })

  describe('pinned', () => {
    it('is pinned from Commands: first in the strip, with its pin where its × was', async () => {
      await open()
      await openInNew('Research notes')
      await written('Tides at seven and nine.')
      await userEvent.click((await commands()).getByText('Pin this tab'))
      expect(pins()).toEqual(['[Research notes]!', 'The Crossing'])
      expect(screen.queryByRole('button', { name: 'Close Research notes' })).toBeNull()
      expect((await commands()).getByText('Unpin this tab')).toBeTruthy()
      await userEvent.keyboard('{Escape}')
      // Its pin takes it out again, and it goes back among the rest.
      await userEvent.click(tab('The Crossing'))
      await written('The ferry leaves at seven.')
      await userEvent.click((await commands()).getByText('Pin this tab'))
      expect(pins()).toEqual(['Research notes!', '[The Crossing]!'])
      await userEvent.click(screen.getByRole('button', { name: 'Unpin Research notes' }))
      expect(pins()).toEqual(['[The Crossing]!', 'Research notes'])
      expect(screen.getByRole('button', { name: 'Close Research notes' })).toBeTruthy()
    })

    it('keeps its document: what’s opened from the library, and a new page, get a tab of their own', async () => {
      await open()
      await openInNew('Research notes')
      await written('Tides at seven and nine.')
      await userEvent.click((await commands()).getByText('Pin this tab'))
      await userEvent.click(screen.getByRole('button', { name: 'Pages' }))
      await userEvent.click(await library().findByText('Harbour'))
      await written('Nets on the wall.')
      expect(pins()).toEqual(['Research notes!', '[Harbour]', 'The Crossing'])
      await userEvent.click(tab('Research notes'))
      await written('Tides at seven and nine.')
      await userEvent.click((await commands()).getByText('New page'))
      await waitFor(() => expect(pins()).toEqual(['Research notes!', '[New page]', 'Harbour', 'The Crossing']))
      // Closed all the same, when that's what's asked.
      await userEvent.click(tab('Research notes'))
      await written('Tides at seven and nine.')
      await userEvent.click((await commands()).getByText('Close this tab'))
      await waitFor(() => expect(pins()).toEqual(['[New page]', 'Harbour', 'The Crossing']))
    })

    it('isn’t offered for a draft, which has no document to keep', async () => {
      await open()
      await openInNew('Research notes')
      await userEvent.click(screen.getByRole('button', { name: 'New tab' }))
      await waitFor(() => expect(tabs()).toEqual(['The Crossing', 'Research notes', '[New page]']))
      expect((await commands()).queryByText('Pin this tab')).toBeNull()
    })
  })

  describe('from the keyboard', () => {
    it('goes along the strip with ⌃Tab, back with ⌃⇧Tab, round its ends', async () => {
      await open()
      await openInNew('Research notes')
      await openInNew('Harbour')
      await written('Nets on the wall.')
      await userEvent.keyboard('{Control>}{Tab}{/Control}')
      await written('The ferry leaves at seven.')
      expect(tabs()).toEqual(['[The Crossing]', 'Research notes', 'Harbour'])
      await userEvent.keyboard('{Control>}{Shift>}{Tab}{/Shift}{/Control}')
      await written('Nets on the wall.')
      await userEvent.keyboard('{Control>}{Shift>}{Tab}{/Shift}{/Control}')
      await written('Tides at seven and nine.')
      expect(tabs()).toEqual(['The Crossing', '[Research notes]', 'Harbour'])
      // Named in Commands, where the same rows are.
      const rows = await commands()
      expect(rows.getByText('Next tab').closest('button')!.textContent).toMatch(/⌃⇥|Ctrl\+Tab/)
      expect(rows.getByText('Previous tab')).toBeTruthy()
    })

    it('opens a new tab with ⌘T, the first one too', async () => {
      await open()
      await typing()
      await userEvent.keyboard(`{${MOD}>}t{/${MOD}}`)
      await waitFor(() => expect(tabs()).toEqual(['The Crossing', '[New page]']))
      expect(writing().textContent).toBe('')
    })

    it('leaves ⌃Tab alone with no tabs, and asks for Nib Plus at ⌘T without it', async () => {
      state.active = false
      await open()
      await typing()
      const pressed = new Promise<KeyboardEvent>((resolve) => window.addEventListener('keydown', resolve, { once: true }))
      await userEvent.keyboard('{Control>}{Tab}{/Control}')
      // The first key down is Control's own; Tab's is what matters, and nothing stopped it.
      await pressed
      const tabbed = new Promise<boolean>((resolve) => window.addEventListener('keydown', (event) => event.code === 'Tab' && resolve(event.defaultPrevented), { once: true }))
      await userEvent.keyboard('{Control>}{Tab}{/Control}')
      expect(await Promise.race([tabbed, new Promise((resolve) => setTimeout(() => resolve('none'), 300))])).not.toBe(true)
      await userEvent.click(writing())
      await userEvent.keyboard(`{${MOD}>}t{/${MOD}}`)
      expect(await screen.findByText(/Keeping several documents open in tabs is part of Nib Plus/)).toBeTruthy()
      expect(strip()).toBeNull()
    })
  })

  describe('kept on this device', () => {
    const again = async () => {
      cleanup()
      await act(async () => void render(<App />))
    }

    it('are there the next time Nib opens: the same tabs, the pinned, and the one in front open under the library', async () => {
      await open()
      await openInNew('Research notes')
      await written('Tides at seven and nine.')
      await userEvent.click((await commands()).getByText('Pin this tab'))
      await openInNew('Harbour')
      await written('Nets on the wall.')
      await userEvent.click(tab('The Crossing'))
      await written('The ferry leaves at seven.')
      expect(pins()).toEqual(['Research notes!', 'Harbour', '[The Crossing]'])

      await again()
      await written('The ferry leaves at seven.')
      expect(pins()).toEqual(['Research notes!', 'Harbour', '[The Crossing]'])
      // The library is up, as when Nib opens, on the kind of what's open under it.
      expect(document.querySelector('main')!.inert).toBe(true)
      expect(library().getByRole('tab', { name: 'Pages' }).getAttribute('aria-selected')).toBe('true')
    })

    it('come back without a document put in the trash since, on a new page if that was the one in front', async () => {
      await open()
      await openInNew('Research notes')
      await openInNew('Harbour')
      await written('Nets on the wall.')
      cleanup()
      await items.remove((await stored('Harbour')).id)
      await act(async () => void render(<App />))
      await waitFor(() => expect(tabs()).toEqual(['The Crossing', 'Research notes', '[New note]']))
      expect(writing().textContent).toBe('')
    })

    // Plus can be known late, after the writer has opened something: the tabs kept don't take its place.
    it('don’t come back over a document opened first', async () => {
      await open()
      await openInNew('Research notes')
      await written('Tides at seven and nine.')
      cleanup()
      state.active = false
      await open()
      act(() => state.set({ active: true }))
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(strip()).toBeNull()
      expect(writing().textContent).toContain('The ferry leaves at seven.')
    })

    it('keep nothing once there’s one tab, and bring none back without Nib Plus', async () => {
      await open()
      await openInNew('Research notes')
      await written('Tides at seven and nine.')
      expect(localStorage.getItem('nib-tabs')).toContain((await stored('Research notes')).id)
      state.active = false
      await again()
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(strip()).toBeNull()
      expect(writing().textContent).toBe('')
      // Still kept, for when Plus is back.
      expect(localStorage.getItem('nib-tabs')).not.toBeNull()

      state.active = true
      await again()
      await written('Tides at seven and nine.')
      // Out from under the library, to the strip.
      await userEvent.click(await library().findByText('Research notes'))
      await userEvent.click(screen.getByRole('button', { name: 'Close The Crossing' }))
      await waitFor(() => expect(strip()).toBeNull())
      expect(localStorage.getItem('nib-tabs')).toBeNull()
    })
  })
})
