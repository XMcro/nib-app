import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { titleOf } from './lib/text'
import manuscript from './lib/__fixtures__/manuscript-pandoc.docx?url'
import { localDay } from './lib/time'

/**
 * The welcome (components/Welcome): shown once, by the app, on a device that
 * opens to an empty library with sync off, with three ways in. Sync itself
 * stays Nib Plus.
 */

vi.mock('./lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/platform')>()),
  nativeApp: true,
}))

vi.mock('./lib/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/inbox')>()),
  inbox: { list: async () => ({ captures: [] }), ack: async () => {}, addListener: async () => ({ remove: async () => {} }) },
}))

const subscriber = vi.hoisted(() => ({ active: false }))
vi.mock('./lib/plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/plus')>()
  return {
    ...actual,
    usePlus: () => [{ active: subscriber.active }, () => {}, true],
    store: { products: async () => ({ products: [] }), purchase: vi.fn(), restore: vi.fn(), manage: vi.fn(), entitlement: vi.fn() },
  }
})

const { App } = await import('./App')
const welcome = () => screen.findByRole('dialog', { name: 'Welcome to Nib' })
// Long enough for the sync code and the library to be read.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 200)))
const texts = async () => (await items.listAll()).map((item) => JSON.stringify(item.body))

beforeEach(async () => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  localStorage.clear()
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  await db.items.clear()
  await page.viewport(1280, 800)
  subscriber.active = false
})
afterEach(() => void vi.useRealTimers())
afterEach(cleanup)

describe('a new device', () => {
  it('is welcomed, and without Plus is asked for it, saying sync is part of it', async () => {
    await act(async () => void render(<App />))
    await welcome()
    await userEvent.click(screen.getByRole('button', { name: 'Sync from another device' }))
    expect(await screen.findByText('Keeping your writing in step with your other devices is part of Nib Plus.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Welcome to Nib' })).toBeNull()
  })

  it('with Plus, goes straight to the code from the other device, not to starting a new library', async () => {
    subscriber.active = true
    await act(async () => void render(<App />))
    await welcome()
    await userEvent.click(screen.getByRole('button', { name: 'Sync from another device' }))
    expect(await screen.findByText('Enter the sync code from your other device.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Turn on sync' })).toBeNull()
  })

  it('starts writing in a new note, ready to type into', async () => {
    await act(async () => void render(<App />))
    await welcome()
    await userEvent.click(screen.getByRole('button', { name: 'Start writing' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await expect.poll(() => document.activeElement?.closest('.ProseMirror')).toBeTruthy()
    await userEvent.keyboard('First line')
    await expect.poll(texts, { timeout: 3000 }).toEqual([expect.stringContaining('First line')])
  })

  // The coins came up 0.7 s after Start writing, then the pack, with the first words still to come.
  it('brings nothing up right after Start writing, till a minute without a key', async () => {
    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'], now })
    onTestFinished(() => void vi.useRealTimers())
    localStorage.removeItem('nib-trades') // today's coins, due
    await act(async () => void render(<App />))
    await welcome()
    await userEvent.click(screen.getByRole('button', { name: 'Start writing' }))
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(screen.queryByRole('dialog', { name: 'Today’s coins' })).toBeNull()
    vi.setSystemTime(now + 61_000)
    expect(await screen.findByRole('dialog', { name: 'Today’s coins' }, { timeout: 3000 })).toBeTruthy()
  })

  it('brings in another app’s notes', async () => {
    await act(async () => void render(<App />))
    await welcome()
    await userEvent.upload(screen.getByLabelText('Import notes'), new File(['# Groceries\n\nEggs and bread'], 'groceries.md', { type: 'text/markdown' }))
    expect(await screen.findByText('Imported one note.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Welcome to Nib' })).toBeNull()
    expect(await texts()).toEqual([expect.stringContaining('Eggs and bread')])
  })

  it('brings in a Word document as one page, its comments notes to self', async () => {
    await act(async () => void render(<App />))
    await welcome()
    const docx = await (await fetch(manuscript)).arrayBuffer()
    await userEvent.upload(screen.getByLabelText('Import notes'), new File([docx], 'The Crossing.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    expect(await screen.findByText('Imported one page.')).toBeTruthy()
    const [page] = await items.listAll()
    expect(page.kind).toBe('page')
    expect(titleOf(page.body)).toBe('The Crossing')
    expect(JSON.stringify(page.body)).toContain('"text":"Ann: Is it ever dark by then?"')
  })

  it('is welcomed in three pages, one at a time: Next, the dots and the arrow keys go through them', async () => {
    await act(async () => void render(<App />))
    const dialog = await welcome()
    const showing = () => [...dialog.querySelectorAll('section')].filter((page) => page.getAttribute('aria-hidden') !== 'true').map((page) => page.getAttribute('aria-label'))
    const dot = () => screen.getAllByRole('button', { name: /^Page \d of 3$/ }).find((one) => one.getAttribute('aria-current') === 'step')!.getAttribute('aria-label')
    const track = dialog.querySelector('section')!.parentElement!
    expect(showing()).toEqual(['1 of 3'])
    expect(screen.getByRole('heading', { name: 'Welcome to Nib' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(showing()).toEqual(['2 of 3'])
    expect(dot()).toBe('Page 2 of 3')
    expect(screen.getByRole('heading', { name: 'A pack of stamps each day' })).toBeTruthy()
    await waitFor(() => expect(track.scrollLeft).toBe(track.clientWidth))

    await userEvent.keyboard('{ArrowRight}')
    expect(showing()).toEqual(['3 of 3'])
    expect(screen.getByRole('heading', { name: 'Yours alone' })).toBeTruthy()
    // Nothing after the last.
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    await userEvent.keyboard('{ArrowRight}')
    expect(dot()).toBe('Page 3 of 3')

    await userEvent.keyboard('{ArrowLeft}')
    expect(dot()).toBe('Page 2 of 3')
    await userEvent.click(screen.getByRole('button', { name: 'Page 1 of 3' }))
    expect(showing()).toEqual(['1 of 3'])
    await waitFor(() => expect(track.scrollLeft).toBe(0))
  })

  it('follows a swipe, and starts writing from any page', async () => {
    await act(async () => void render(<App />))
    const dialog = await welcome()
    const track = dialog.querySelector('section')!.parentElement!
    // A swipe, as it ends: the track scrolled along by two pages.
    await act(async () => {
      track.scrollLeft = track.clientWidth * 2
      track.dispatchEvent(new Event('scroll'))
    })
    expect(screen.getByRole('button', { name: 'Page 3 of 3' }).getAttribute('aria-current')).toBe('step')
    expect(screen.getByText('Export everything as Markdown, free, always.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Start writing' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is welcomed only once', async () => {
    await act(async () => void render(<App />))
    await welcome()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    cleanup()
    await act(async () => void render(<App />))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

it('a device with writing on it is never welcomed', async () => {
  await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Already here' }] }] })
  await act(async () => void render(<App />))
  await settle()
  expect(screen.queryByRole('dialog')).toBeNull()

  // Nor later, once it's empty.
  cleanup()
  await db.items.clear()
  await act(async () => void render(<App />))
  await settle()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('a device that answered the question asked before the welcome is not welcomed', async () => {
  localStorage.setItem('nib-device-asked', '1')
  await act(async () => void render(<App />))
  await settle()
  expect(screen.queryByRole('dialog')).toBeNull()
})
