import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import { localDay } from './lib/time'

/**
 * The style check through the whole app, as on the Mac: turned on and off
 * for one document from the palette, with and without Plus.
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

// Nib opens on the library, over the text; a new note puts it away.
const newNote = () => userEvent.click(screen.getByRole('button', { name: 'New note' }))

async function write(text: string) {
  const saved = await db.items.count()
  await userEvent.click(document.querySelector('.ProseMirror')!)
  await userEvent.keyboard(text)
  // The first save makes it a document that can be shared.
  await expect.poll(() => db.items.count(), { timeout: 5000 }).toBe(saved + 1)
}

beforeEach(async () => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  localStorage.clear()
  localStorage.setItem('nib-device-asked', '1') // the welcome, already seen
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  await page.viewport(1280, 800)
})
afterEach(() => void vi.useRealTimers())
afterEach(cleanup)

describe('the style check', () => {
  it('with Plus, is turned on and off for the document from the palette', async () => {
    subscriber.active = true
    await act(async () => void render(<App />))
    await newNote()
    await write('It was very quickly written.')
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.click(await screen.findByRole('button', { name: /^Check style$/ }))
    await waitFor(() => expect(document.querySelectorAll('.ProseMirror .nib-style').length).toBeGreaterThan(0))
    expect(JSON.parse(localStorage.getItem('nib-style-docs')!)).toHaveLength(1)

    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.click(await screen.findByRole('button', { name: /^Stop checking style$/ }))
    await waitFor(() => expect(document.querySelectorAll('.ProseMirror .nib-style').length).toBe(0))
  })

  it('without Plus, runs and shows the count, underlining nothing, and the count asks for Plus', async () => {
    subscriber.active = false
    await act(async () => void render(<App />))
    await newNote()
    await write('It was very quickly written.')
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.click(await screen.findByRole('button', { name: /^Check style$/ }))
    const line = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((button) => /words?/.test(button.textContent ?? ''))!
    // "very" is filler, "quickly" an adverb, "was … written" passive.
    await waitFor(() => expect(line().textContent).toMatch(/ · 3 suggestions$/))
    expect(document.querySelectorAll('.ProseMirror .nib-style')).toHaveLength(0)
    expect(document.querySelector('.ProseMirror [title]')).toBeNull()

    await userEvent.click(line())
    await userEvent.click(await screen.findByRole('button', { name: /See them underlined/ }))
    expect(await screen.findByText('With Nib Plus, the style check underlines each suggestion in your text.')).toBeTruthy()
  })
})
