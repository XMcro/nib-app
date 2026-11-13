import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import './index.css'
import { localDay } from './lib/time'

/**
 * Goals and sprints through the whole app, as on the Mac: from the palette to
 * the status line, with and without Plus. Needs a live editor, so a browser.
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

// The status line comes after its panel, which has a toggle of its own.
const line = () => [...document.querySelectorAll<HTMLButtonElement>('main button[aria-expanded]')].at(-1)!
async function command(label: string) {
  await userEvent.keyboard('{Meta>}k{/Meta}')
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label}`) }))
}
async function write(text: string) {
  await userEvent.click(document.querySelector('.ProseMirror')!)
  await userEvent.keyboard(text)
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

describe('with Plus', () => {
  beforeEach(() => {
    subscriber.active = true
  })

  it('runs a sprint from the palette, counting only what is written during it', async () => {
    await act(async () => void render(<App />))
    await newNote()
    await write('Before the sprint starts')
    await command('Start a 25-minute sprint')
    await waitFor(() => expect(line().textContent).toBe('Sprint · 0 words · 25 min left'))

    await write(' two more')
    await waitFor(() => expect(line().textContent).toBe('Sprint · 2 words · 25 min left'))

    await command('End the sprint')
    await waitFor(() => expect(line().textContent).toBe('Sprint done · 2 words in 1 min'))
    await userEvent.click(line())
    expect(line().textContent).not.toMatch(/Sprint/)
  })

  it('sets a document’s goal from the palette, and shows its progress', async () => {
    await act(async () => void render(<App />))
    await newNote()
    await write('Three words here')
    await command('Set a goal…')
    const words = await screen.findByLabelText('Goal, in words')
    await waitFor(() => expect(document.activeElement).toBe(words))
    await userEvent.fill(words, '10')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(line().textContent).toBe('3 of 10'))
  })
})

describe('without Plus', () => {
  beforeEach(() => {
    subscriber.active = false
  })

  it('counts the daily goal, which is free, while a document’s goal and sprints lead to Plus', async () => {
    localStorage.setItem('nib-goal', '5')
    await act(async () => void render(<App />))
    await newNote()
    await write('One two three')
    await waitFor(() => expect(line().textContent).toMatch(/ · 3 of 5 today$/))
    await write(' four five')
    await waitFor(() => expect(line().textContent).toMatch(/ · Goal met · 1 day in a row$/))
    await userEvent.click(line())
    expect(await screen.findByText('1 day in a row')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Deadlines and sprints/ }))
    expect(await screen.findByText('Deadlines and sprints are part of Nib Plus, with a calendar of your writing days.')).toBeTruthy()
  })

  it('lists goals and sprints in the palette marked Plus, asking for Plus', async () => {
    await act(async () => void render(<App />))
    await userEvent.keyboard('{Meta>}k{/Meta}')
    const goal = await screen.findByRole('button', { name: /^Set a goal…/ })
    expect(goal.textContent).toBe('Set a goal…Plus')
    expect(screen.queryByRole('button', { name: /^Start a 25-minute sprint/ })).toBeNull()
    await userEvent.click(goal)
    expect(await screen.findByText('A goal for each note and page, with a deadline, is part of Nib Plus.')).toBeTruthy()
  })
})
