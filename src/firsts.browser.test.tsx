import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { localDay } from './lib/time'

/**
 * First steps (lib/firsts, components/FirstSteps) through the whole app, as on
 * the Mac: begun as a new device's welcome ends, each step ticked as it's
 * done, and a stamp of their own at the end.
 */

vi.mock('./lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/platform')>()), nativeApp: true, macApp: true }))
vi.mock('./lib/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/inbox')>()),
  inbox: { list: async () => ({ captures: [] }), ack: async () => {}, addListener: async () => ({ remove: async () => {} }) },
}))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [{ active: false }, () => {}, true],
  store: { products: async () => ({ products: [] }), purchase: vi.fn(), restore: vi.fn(), manage: vi.fn(), entitlement: vi.fn() },
}))

const { App } = await import('./App')

const welcome = () => screen.findByRole('dialog', { name: 'Welcome to Nib' })
const pill = () => screen.queryByRole('button', { name: /^First steps, / })
async function command(label: string) {
  await userEvent.keyboard('{Meta>}k{/Meta}')
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label}`) }))
}
async function write(text: string) {
  await userEvent.click(document.querySelector('main .ProseMirror')!)
  await userEvent.keyboard(text)
}

beforeEach(async () => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  localStorage.clear()
  localStorage.setItem('nib-daily-asked', 'true') // the daily reminder, already offered
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  await db.items.clear()
  await page.viewport(1280, 800)
})
afterEach(() => void vi.useRealTimers())
afterEach(cleanup)

describe('First steps', () => {
  it('begin as the welcome ends, tick off as each is done, and end in a stamp', async () => {
    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'], now })
    onTestFinished(() => void vi.useRealTimers())
    await act(async () => void render(<App />))
    await userEvent.click(within(await welcome()).getByRole('button', { name: 'Start writing' }))
    expect(pill()!.getAttribute('aria-label')).toBe('First steps, 0 of 4 done')

    await write('The ferry')
    await waitFor(() => expect(pill()!.getAttribute('aria-label')).toBe('First steps, 1 of 4 done'))
    // Popped as it was ticked.
    expect(pill()!.hasAttribute('data-ticked')).toBe(true)
    await userEvent.click(pill()!)
    const list = within(screen.getByRole('dialog', { name: 'First steps' }))
    expect(list.getAllByRole('listitem').map((step) => step.textContent)).toEqual([
      'Write a first line, done',
      'Make a pageNotes are for jotting down; pages, in Pages, for writing out. Start one there.',
      'Try focus modePress ⇧⌘F, or choose it after ⌘K. Everything but the words goes.',
      'Open CommandsPress ⌘K. Everything else is there.',
    ])
    await userEvent.click(pill()!)
    expect(screen.queryByRole('dialog', { name: 'First steps' })).toBeNull()

    // On a phone, the list stays on screen however far over the button is.
    await page.viewport(390, 844)
    await userEvent.click(pill()!)
    expect(screen.getByRole('dialog', { name: 'First steps' }).getBoundingClientRect().right).toBeLessThanOrEqual(390 - 12)
    await userEvent.click(pill()!)
    await page.viewport(1280, 800)

    // Commands, and focus mode from it: two at once.
    await command('Focus mode')
    expect(pill()).toBeNull()
    await command('Leave focus mode')
    await waitFor(() => expect(pill()!.getAttribute('aria-label')).toBe('First steps, 3 of 4 done'))

    await command('New page')
    await write('Chapter one')
    // Mid-sentence: its card waits for a pause.
    await waitFor(() => expect(pill()).toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(screen.queryByRole('dialog', { name: 'First steps, done' })).toBeNull()
    vi.setSystemTime(now + 61_000)
    const done = await screen.findByRole('dialog', { name: 'First steps, done' }, { timeout: 3000 })
    expect(within(done).getByRole('img').getAttribute('aria-label')).toMatch(/^Two footprints, for first steps, /)
    await userEvent.click(within(done).getByRole('button', { name: 'Close' }))
    expect(pill()).toBeNull()

    // Kept in the Stampbook.
    await command('Stampbook')
    const stampbook = within(screen.getByRole('dialog', { name: 'Stampbook' }))
    await userEvent.click(stampbook.getByRole('button', { name: /^Keepsakes, / }))
    expect(stampbook.getByRole('button', { name: 'First steps' }).querySelector('svg')?.getAttribute('aria-label')).toMatch(/^Two footprints, for first steps, /)
  })

  // It opened over Commands, and took the keyboard from it.
  it('wait for Commands to close when that was the last of them', async () => {
    localStorage.setItem('nib-device-asked', '1')
    localStorage.setItem('nib-firsts', JSON.stringify({ done: ['write', 'page', 'focus'] }))
    await act(async () => void render(<App />))
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await waitFor(() => expect(JSON.parse(localStorage.getItem('nib-firsts')!).finished).toBeTruthy())
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(screen.queryByRole('dialog', { name: 'First steps, done' })).toBeNull()
    // A press, not Escape: a key in its field counts as typing, for a minute.
    await userEvent.click(screen.getByRole('dialog', { name: 'Commands' }).parentElement!, { position: { x: 5, y: 5 } })
    expect(await screen.findByRole('dialog', { name: 'First steps, done' }, { timeout: 3000 })).toBeTruthy()
  })

  // iOS ended Nib while the card waited for its pause, and it was never shown.
  it('keep their card for the next launch when Nib quits before a pause', async () => {
    localStorage.setItem('nib-device-asked', '1')
    localStorage.setItem('nib-firsts', JSON.stringify({ done: ['write', 'page', 'focus'] }))
    await act(async () => void render(<App />))
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await waitFor(() => expect(JSON.parse(localStorage.getItem('nib-firsts')!).finished).toBeTruthy())
    expect(screen.queryByRole('dialog', { name: 'First steps, done' })).toBeNull()
    cleanup()
    await act(async () => void render(<App />))
    const done = await screen.findByRole('dialog', { name: 'First steps, done' }, { timeout: 3000 })
    await userEvent.click(within(done).getByRole('button', { name: 'Close' }))
    // Shown: owed no more.
    cleanup()
    await act(async () => void render(<App />))
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(screen.queryByRole('dialog', { name: 'First steps, done' })).toBeNull()
  })

  // One tick after what was up has gone, never sooner.
  it('wait a moment after today’s pack has gone', async () => {
    localStorage.removeItem('nib-book')
    await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Already here' }] }] })
    await act(async () => void render(<App />))
    const pack = await screen.findByRole('dialog', { name: 'Today’s pack' }, { timeout: 3000 })
    await userEvent.click(within(pack).getByRole('button', { name: 'Later' }))
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(screen.queryByRole('dialog', { name: 'First steps, done' })).toBeNull()
    expect(await screen.findByRole('dialog', { name: 'First steps, done' }, { timeout: 3000 })).toBeTruthy()
  })

  // It came up over the draft just opened from the day's prompt, with the cursor waiting in it.
  it('wait a minute after a draft is opened from the day’s prompt', async () => {
    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'], now })
    onTestFinished(() => void vi.useRealTimers())
    localStorage.removeItem('nib-book')
    await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Already here' }] }] })
    await act(async () => void render(<App />))
    document.documentElement.dataset.motion = 'none'
    onTestFinished(() => void delete document.documentElement.dataset.motion)
    const pack = await screen.findByRole('dialog', { name: 'Today’s pack' }, { timeout: 3000 })
    await userEvent.click(within(pack).getByRole('button', { name: 'Open the pack' }))
    await userEvent.click(await within(pack).findByRole('button', { name: 'Write from it' }))
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(screen.queryByRole('dialog', { name: 'First steps, done' })).toBeNull()
    vi.setSystemTime(now + 61_000)
    expect(await screen.findByRole('dialog', { name: 'First steps, done' }, { timeout: 3000 })).toBeTruthy()
  })

  it('are put away for good when asked', async () => {
    await act(async () => void render(<App />))
    await userEvent.click(within(await welcome()).getByRole('button', { name: 'Start writing' }))
    await userEvent.click(pill()!)
    await userEvent.click(screen.getByRole('button', { name: 'Put away' }))
    expect(pill()).toBeNull()
    cleanup()
    await act(async () => void render(<App />))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(pill()).toBeNull()
  })

  it('begin when the welcome is put aside too, but not for a library brought by sync', async () => {
    await act(async () => void render(<App />))
    await welcome()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(pill()).not.toBeNull())
    cleanup()
    localStorage.clear()
    localStorage.setItem('nib-daily-asked', 'true')
    await act(async () => void render(<App />))
    await userEvent.click(within(await welcome()).getByRole('button', { name: 'Sync from another device' }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(pill()).toBeNull()
  })

  // Begun only by the welcome, they never came to a writer from before them, nor did their stamp.
  it('come to a device that already had writing on it as their stamp, given once, with its card', async () => {
    await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Already here' }] }] })
    await act(async () => void render(<App />))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(screen.queryByRole('dialog', { name: 'Welcome to Nib' })).toBeNull()
    const done = await screen.findByRole('dialog', { name: 'First steps, done' }, { timeout: 3000 })
    expect(pill()).toBeNull()
    expect(JSON.parse(localStorage.getItem('nib-firsts')!)).toEqual({ done: ['write', 'page', 'focus', 'commands'], finished: localDay(Date.now()) })
    await userEvent.click(within(done).getByRole('button'))
    // Once: not again as Nib opens again.
    cleanup()
    await act(async () => void render(<App />))
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(screen.queryByRole('dialog', { name: 'First steps, done' })).toBeNull()
  })
})
