import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import type { PlusProduct } from './lib/plus'
import { replaceFolderSettings } from './lib/folderSettings'
import { removeFolder } from './lib/folders'
import { localDay } from './lib/time'

/**
 * Nib Plus offered of its own accord (lib/upsell, UpgradeDialog), in the app
 * and only without Plus, and the welcome once it's bought.
 */

vi.mock('./lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/platform')>()),
  nativeApp: true,
}))

vi.mock('./lib/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/inbox')>()),
  inbox: { list: async () => ({ captures: [] }), ack: async () => {}, addListener: async () => ({ remove: async () => {} }) },
}))

const PRODUCTS: PlusProduct[] = [
  { id: 'app.nib.plus.monthly', displayName: 'Monthly', displayPrice: '$3.99', price: 3.99, currency: 'USD', period: 'month' },
  { id: 'app.nib.plus.yearly', displayName: 'Yearly', displayPrice: '$29.99', price: 29.99, currency: 'USD', period: 'year' },
]

const state = vi.hoisted(() => ({ active: false, products: [] as unknown[], show: null as null | (() => void), shown: 0, held: null as null | Promise<void>, syncCode: null as string | null }))
const { useState } = await import('react')
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  // Starts as `state` says; a purchase turns it on, as the App Store would.
  usePlus: () => [...useState({ active: state.active }), true],
  store: {
    products: async () => {
      await state.held
      return { products: state.products }
    },
    purchase: async () => ({ status: 'purchased', entitlement: { active: true } }),
    restore: vi.fn(),
    manage: vi.fn(),
    entitlement: vi.fn(),
  },
}))
// A library joined from a device that pays, or with Plus lapsed: it syncs, and the offer is still made.
vi.mock('./sync', async (importOriginal) => {
  const real = await importOriginal<typeof import('./sync')>()
  return { ...real, useSync: (...args: Parameters<typeof real.useSync>) => ({ ...real.useSync(...args), code: state.syncCode }) }
})
// Its timing has its own tests (lib/upsell.test); here, the moment it says.
vi.mock('./lib/upsell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/upsell')>()),
  watchUpsell: (show: (shown: () => void) => void) => {
    state.show = () => show(() => state.shown++)
    return () => (state.show = null)
  },
}))

// The device, as the native lock reports it.
vi.mock('./lib/lock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/lock')>()),
  lock: { status: async () => ({ enabled: false, after: 0, available: true, biometry: 'faceID', device: 'iPhone' }), vault: async () => {} },
}))

const { App } = await import('./App')
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 200)))

beforeEach(async () => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  localStorage.clear()
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  await db.items.clear()
  // Writing already here, so "Using Nib on another device?" isn't asked.
  await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Already here' }] }] })
  await page.viewport(1280, 800)
  Object.assign(state, { active: false, products: PRODUCTS, show: null, shown: 0, held: null, syncCode: null })
})
afterEach(() => void vi.useRealTimers())
afterEach(cleanup)

describe('the upgrade popup in the app', () => {
  it('opens when it’s time, and buying from it welcomes', async () => {
    await act(async () => void render(<App />))
    await act(async () => state.show!())
    expect((await screen.findByRole('radio', { name: /Yearly/ })).textContent).toContain('$29.99')
    expect(state.shown).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: 'Get Nib Plus' }))
    expect(await screen.findByText('Welcome to Nib Plus')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says how much is written, once there’s a fair amount, and that it’s all on this device', async () => {
    const words = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(' ')
    await items.create('page', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] })
    await act(async () => void render(<App />))
    await settle()
    await act(async () => state.show!())
    // 1,200 here and "Already here".
    expect(await screen.findByText('1,202 words, all on this iPhone. Nib Plus puts them on your iPad and Mac too, with an encrypted backup.')).toBeTruthy()
  })

  it('doesn’t say it’s all on this device to a library that syncs', async () => {
    state.syncCode = 'a-sync-code'
    const words = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(' ')
    await items.create('page', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] })
    await act(async () => void render(<App />))
    await settle()
    await act(async () => state.show!())
    expect(await screen.findByRole('radio', { name: /Yearly/ })).toBeTruthy()
    expect(screen.queryByText(/words, all on this/)).toBeNull()
  })

  it('says nothing in particular with only a little written', async () => {
    await act(async () => void render(<App />))
    await act(async () => state.show!())
    expect(await screen.findByRole('radio', { name: /Yearly/ })).toBeTruthy()
    expect(screen.queryByText(/words, all on this/)).toBeNull()
  })

  // Its look passed, then it waited on the App Store, and landed on whatever had come up meanwhile.
  it('looks again just before it opens, and stays shut over what came up meanwhile', async () => {
    let answer = () => {}
    state.held = new Promise<void>((resolve) => (answer = resolve))
    await act(async () => void render(<App />))
    await settle()
    await act(async () => state.show!())
    await userEvent.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('button', { name: 'Settings' }))
    await screen.findByRole('dialog', { name: 'Settings' })
    await act(async () => answer())
    await settle()
    expect(screen.queryByRole('radio', { name: /Yearly/ })).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(state.shown).toBe(0)
  })

  it('stays shut when the App Store has nothing to sell', async () => {
    state.products = []
    await act(async () => void render(<App />))
    await act(async () => state.show!())
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(state.shown).toBe(0)
  })

  it('is never looked for with Plus', async () => {
    state.active = true
    await act(async () => void render(<App />))
    await settle()
    expect(state.show).toBeNull()
  })
})

describe('a new device without Plus', () => {
  beforeEach(() => db.items.clear())

  it('asks for Plus from "Sync from another device", then goes on to the code once it’s bought', async () => {
    await act(async () => void render(<App />))
    await userEvent.click(await screen.findByRole('button', { name: 'Sync from another device' }))
    expect(await screen.findByText('Keeping your writing in step with your other devices is part of Nib Plus.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Sync code' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Get Nib Plus' }))
    await userEvent.click(await screen.findByText('Welcome to Nib Plus'))
    expect(await screen.findByRole('textbox', { name: 'Sync code' })).toBeTruthy()
  })

  it('goes nowhere further when the sheet is closed without buying', async () => {
    await act(async () => void render(<App />))
    await userEvent.click(await screen.findByRole('button', { name: 'Sync from another device' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Sync code' })).toBeNull()
  })
})

describe('Word, PDF and HTML export without Plus', () => {
  it('is in the palette marked Plus, and asks for Plus, saying why', async () => {
    await act(async () => void render(<App />))
    await userEvent.click(await screen.findByText('Already here'))
    await expect.poll(() => document.querySelector('.ProseMirror')?.textContent).toBe('Already here')
    await act(async () => [...document.querySelectorAll('button')].find((each) => each.textContent === 'Commands')!.click())
    const word = await screen.findByRole('button', { name: /^Export this one as Word/ })
    expect(word.textContent).toBe('Export this one as WordPlus')
    await userEvent.click(word)
    expect(await screen.findByText('Word, PDF and HTML export are part of Nib Plus. Markdown export is free, always.')).toBeTruthy()
  })
})

describe('the free folders and categories', () => {
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  // Once the library has its folders, which under load can be a moment after the first render.
  const manage = async () => userEvent.click(await screen.findByRole('button', { name: 'Edit folders and categories' }))

  beforeEach(async () => {
    for (const name of ['Novel', 'Blog', 'Letters']) await items.create('note', doc(name), { folder: name, categories: [{ name, color: 'blue' }] })
  })
  afterEach(() => removeFolder('Fourth'))

  it('asks for Plus, saying why, when a fourth folder is made without it', async () => {
    await act(async () => void render(<App />))
    await manage()
    expect(screen.getAllByText('3 free · Plus for more')).toHaveLength(2)
    await userEvent.fill(screen.getByRole('textbox', { name: 'New folder' }), 'Fourth')
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    expect(await screen.findByText('3 folders is the most without Nib Plus. With it, make as many as you like.')).toBeTruthy()
    expect(await screen.findByRole('radio', { name: /Yearly/ })).toBeTruthy()
    expect(screen.queryByText('Fourth')).toBeNull()
  })

  it('asks for Plus from the library’s "+ New folder" too, before a name is typed', async () => {
    await act(async () => void render(<App />))
    await userEvent.click(await screen.findByRole('button', { name: '+ New folder' }))
    expect(await screen.findByText('3 folders is the most without Nib Plus. With it, make as many as you like.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'New folder' })).toBeNull()
  })

  it('asks for Plus when a fourth category is made filing a note, and closes the filing first', async () => {
    await act(async () => void render(<App />))
    // Once the library's there.
    await userEvent.click(await screen.findByText('Already here'))
    await expect.poll(() => document.querySelector('.ProseMirror')?.textContent).toBe('Already here')
    await act(async () => [...document.querySelectorAll('button')].find((each) => each.textContent === 'Commands')!.click())
    await userEvent.click(await screen.findByRole('button', { name: /^Categories…/ }))
    await userEvent.fill(await screen.findByRole('textbox', { name: 'New category' }), 'Fourth')
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[1])
    expect(await screen.findByText('3 categories is the most without Nib Plus. With it, make as many as you like.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Folder and categories' })).toBeNull()
  })

  // The book's drawing (lib/folderIcons), and the folder's colour on what holds it, as FolderMark draws them.
  const book = (within: Element) => within.querySelector('path[d^="M4 19.5v-15"]')
  const tealOf = (within: Element) => within.querySelector<HTMLElement>('[style*="--light"]')?.style.getPropertyValue('--light')

  it('gives a folder a colour and an icon with Plus, shown on its chip and its cards, and on the folders inside it', async () => {
    state.active = true
    replaceFolderSettings({})
    await items.create('note', doc('Part one'), { folder: 'Novel/Part 1' })
    await act(async () => void render(<App />))
    await manage()
    await userEvent.click(screen.getByRole('button', { name: 'Colour and icon of Novel' }))
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Colour of Novel' })).getByRole('radio', { name: 'Teal' }))
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Icon of Novel' })).getByRole('radio', { name: 'Book' }))
    expect(within(screen.getByRole('radiogroup', { name: 'Icon of Novel' })).getByRole('radio', { name: 'Book' }).getAttribute('aria-checked')).toBe('true')
    // A folder inside it has none of its own to choose: "As Novel" is chosen.
    await userEvent.click(screen.getByRole('button', { name: 'Colour and icon of Part 1' }))
    expect(within(screen.getByRole('radiogroup', { name: 'Icon of Part 1' })).getByRole('radio', { name: 'As Novel' }).getAttribute('aria-checked')).toBe('true')

    await userEvent.click(screen.getByRole('button', { name: '← Back' }))
    await expect.poll(() => document.querySelector('[data-drop="folder:Novel"]')).toBeTruthy()
    const chip = document.querySelector<HTMLElement>('[data-drop="folder:Novel"]')!
    expect(book(chip)).toBeTruthy()
    expect(tealOf(chip)).toBe('#1c7070')
    const card = [...document.querySelectorAll('.nib-library [data-id]')].find((one) => one.textContent?.includes('Part one'))!
    expect(book(card)).toBeTruthy()
    await userEvent.click(chip)
    const inside = await screen.findByRole('button', { name: /^Part 1, in Novel/ })
    expect(book(inside)).toBeTruthy()
    expect(tealOf(inside)).toBe('#1c7070')
  })

  it('shows a colour and an icon given with Plus without it, and asks for Plus to change them', async () => {
    replaceFolderSettings({ novel: { at: 1, color: 'teal', icon: 'book' } })
    await act(async () => void render(<App />))
    await expect.poll(() => document.querySelector('[data-drop="folder:Novel"]') && book(document.querySelector('[data-drop="folder:Novel"]')!)).toBeTruthy()
    await manage()
    await userEvent.click(screen.getByRole('button', { name: 'Colour and icon of Novel' }))
    expect(await screen.findByText('A colour and an icon for each folder come with Nib Plus.')).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Icon of Novel' })).toBeNull()
  })

  it('makes as many as asked with Plus', async () => {
    state.active = true
    await act(async () => void render(<App />))
    await manage()
    expect(screen.queryByText('3 free · Plus for more')).toBeNull()
    await userEvent.fill(screen.getByRole('textbox', { name: 'New folder' }), 'Fourth')
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    expect(await screen.findByText('Fourth')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /Yearly/ })).toBeNull()
  })
})

