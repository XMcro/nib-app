import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { DAILY, DAILY_TITLE } from './lib/dailyReminder'
import { localDay } from './lib/time'

/**
 * The daily reminder (lib/dailyReminder) through the whole app, as on the
 * Mac: offered as the first pack is put away, kept off days whose pack is
 * opened, and on and off in Settings → Goals. The device's notifications are
 * stood in for.
 */

const device = vi.hoisted(() => ({
  pending: [] as { id: string; at: number }[],
  set: [] as { id: string; at: number; title: string }[],
  denied: false,
  open: undefined as undefined | ((data: { id: string }) => void),
}))

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
vi.mock('./lib/reminders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/reminders')>()
  return {
    ...actual,
    reminderPlugin: {
      schedule: async () => {},
      list: async () => ({ reminders: device.pending }),
      cancel: async ({ ids }: { ids: string[] }) => {
        device.pending = device.pending.filter((reminder) => !ids.includes(reminder.id))
      },
      retitle: async () => {},
      addListener: async (_event: string, listener: (data: { id: string }) => void) => {
        device.open = listener
        return { remove: async () => {} }
      },
    },
    setReminder: async (id: string, at: number, title: string) => {
      if (device.denied) throw new actual.ReminderError('denied', 'Notifications are off for Nib. Turn them on in Settings, under Notifications.')
      device.set.push({ id, at, title })
      device.pending = [...device.pending.filter((reminder) => reminder.id !== id), { id, at }]
    },
  }
})

const { App } = await import('./App')

const today = () => localDay(Date.now())
const waiting = () => device.pending.map((reminder) => reminder.id)
const offer = () => screen.queryByRole('dialog', { name: 'A reminder to write' })
const thePack = async () => within(await screen.findByRole('dialog', { name: 'Today’s pack' }, { timeout: 3000 }))
/** Today's pack, come up as Nib opens, torn open to its stamps. */
async function openThePack() {
  const pack = await thePack()
  await userEvent.click(pack.getByRole('button', { name: 'Open the pack' }))
  await waitFor(() => expect(pack.getByRole('button', { name: 'Done' })).toBeTruthy(), { timeout: 5000 })
}
const putAway = () => userEvent.click(within(screen.getByRole('dialog', { name: 'Today’s pack' })).getByRole('button', { name: 'Done' }))

beforeEach(async () => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  localStorage.clear()
  localStorage.setItem('nib-device-asked', '1') // the welcome, already seen
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${today()}`, day: today(), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  device.pending = []
  device.set = []
  device.denied = false
  await db.items.clear()
  await page.viewport(1280, 800)
})
afterEach(() => void vi.useRealTimers())
afterEach(cleanup)

describe('The daily reminder', () => {
  it('is offered as the first pack is put away, and rings from tomorrow at the time chosen', async () => {
    await act(async () => void render(<App />))
    await openThePack()
    await putAway()
    const dialog = within(offer()!)
    await userEvent.fill(dialog.getByLabelText('Remind me at'), '08:30')
    await userEvent.click(dialog.getByRole('button', { name: 'Remind me' }))
    await waitFor(() => expect(offer()).toBeNull())
    // Today's pack is opened already.
    expect(waiting()).not.toContain(DAILY + today())
    expect(waiting()).toHaveLength(13)
    expect(device.pending.every(({ at }) => new Date(at).getHours() === 8 && new Date(at).getMinutes() === 30)).toBe(true)
    expect(new Set(device.set.map((reminder) => reminder.title))).toEqual(new Set([DAILY_TITLE]))
  })

  // A new writer: the coins, the pack, and this, one straight after another.
  it('waits for a pause later as the third card in a row, after the coins and the pack', async () => {
    const now = Date.now()
    localStorage.removeItem('nib-trades')
    await act(async () => void render(<App />))
    const coins = await screen.findByRole('dialog', { name: 'Today’s coins' }, { timeout: 6000 })
    await userEvent.click(within(coins).getByRole('button', { name: /^Collect \d/ }))
    await userEvent.click(within(coins).getByRole('button', { name: 'Done' }))
    await openThePack()
    await putAway()
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(offer()).toBeNull()

    vi.setSystemTime(now + 11 * 60_000)
    await waitFor(() => expect(offer()).not.toBeNull(), { timeout: 3000 })
  })

  // Set meanwhile, and the card still came, offering what was on already.
  it('isn’t offered as that third card once it’s been set in Settings', async () => {
    const now = Date.now()
    localStorage.removeItem('nib-trades')
    await act(async () => void render(<App />))
    const coins = await screen.findByRole('dialog', { name: 'Today’s coins' }, { timeout: 6000 })
    await userEvent.click(within(coins).getByRole('button', { name: /^Collect \d/ }))
    await userEvent.click(within(coins).getByRole('button', { name: 'Done' }))
    await openThePack()
    await putAway()

    await userEvent.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('button', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Goals/ }))
    await userEvent.click(screen.getByRole('switch', { name: 'Daily reminder' }))
    await waitFor(() => expect(localStorage.getItem('nib-daily-asked')).toBe('true'))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    vi.setSystemTime(now + 11 * 60_000)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(offer()).toBeNull()
  })

  it('isn’t offered again after Not now', async () => {
    await act(async () => void render(<App />))
    await openThePack()
    await putAway()
    await userEvent.click(within(offer()!).getByRole('button', { name: 'Not now' }))
    expect(offer()).toBeNull()
    expect(device.set).toEqual([])
    // Another day's pack, put away.
    cleanup()
    for (const key of ['nib-stamps', 'nib-book']) localStorage.removeItem(key)
    await act(async () => void render(<App />))
    await openThePack()
    await putAway()
    expect(offer()).toBeNull()
  })

  it('waits while the pack is put off, or left to write from its prompt', async () => {
    await act(async () => void render(<App />))
    await userEvent.click((await thePack()).getByRole('button', { name: 'Later' }))
    expect(offer()).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'New note' }))
    await userEvent.click(screen.getByRole('button', { name: 'Today’s pack' }))
    await openThePack()
    await userEvent.click(screen.getByRole('button', { name: 'Write from it' }))
    expect(offer()).toBeNull()
    expect(localStorage.getItem('nib-daily-asked')).toBeNull()
  })

  it('says so, and stays off, when notifications are off for Nib', async () => {
    device.denied = true
    await act(async () => void render(<App />))
    await openThePack()
    await putAway()
    await userEvent.click(within(offer()!).getByRole('button', { name: 'Remind me' }))
    expect(await within(offer()!).findByRole('alert')).toHaveProperty('textContent', 'Notifications are off for Nib. Turn them on in Settings, under Notifications.')
    expect(localStorage.getItem('nib-daily-reminder')).toBeNull()
  })

  it('is on and off in Settings, under Goals, at a time of its own', async () => {
    localStorage.setItem('nib-daily-reminder', JSON.stringify('19:00'))
    localStorage.setItem('nib-daily-asked', 'true')
    await act(async () => void render(<App />))
    await waitFor(() => expect(waiting().length).toBeGreaterThanOrEqual(13))
    await userEvent.click((await thePack()).getByRole('button', { name: 'Later' }))
    await userEvent.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('button', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Goals/ }))
    const toggle = screen.getByRole('switch', { name: 'Daily reminder' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await userEvent.click(toggle)
    await waitFor(() => expect(waiting()).toEqual([]))
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(toggle)
    await waitFor(() => expect(waiting().length).toBeGreaterThanOrEqual(13))
    await userEvent.fill(screen.getByLabelText('Daily reminder at'), '06:45')
    await waitFor(() => expect(device.pending.every(({ at }) => new Date(at).getHours() === 6 && new Date(at).getMinutes() === 45)).toBe(true))
    expect(JSON.parse(localStorage.getItem('nib-daily-reminder')!)).toBe('06:45')
  })

  // Today's would ring at 23:59.
  it('takes today’s off once today’s pack is opened', async () => {
    localStorage.setItem('nib-daily-reminder', JSON.stringify('23:59'))
    localStorage.setItem('nib-daily-asked', 'true')
    await act(async () => void render(<App />))
    await waitFor(() => expect(waiting()).toContain(DAILY + today()))
    await openThePack()
    await waitFor(() => expect(waiting()).not.toContain(DAILY + today()))
    expect(waiting()).toHaveLength(13)
  })

  it('opens Nib when tapped, as no note’s reminder', async () => {
    await act(async () => void render(<App />))
    await waitFor(() => expect(device.open).toBeDefined())
    await act(async () => device.open!({ id: `${DAILY}${today()}` }))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(screen.queryByText('That note was deleted.')).toBeNull()
  })
})

describe('A note’s reminder, tapped', () => {
  const library = () => document.querySelector<HTMLElement>('.nib-library')!

  beforeEach(async () => {
    localStorage.setItem('nib-book', JSON.stringify([[today(), 1]])) // today's pack, opened already (rewards.browser.test)
    await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ferry at 07:40' }] }] }, { id: 'ferry' })
  })

  async function tapped(id: string) {
    await act(async () => void render(<App />))
    await waitFor(() => expect(device.open).toBeDefined())
    await act(async () => device.open!({ id }))
  }

  it('opens the note, with the library put away', async () => {
    await tapped('ferry')
    await waitFor(() => expect(document.querySelector('main .ProseMirror')!.textContent).toBe('Ferry at 07:40'))
    expect(library().dataset.open).toBe('false')
  })

  it('says so when the note was deleted', async () => {
    await tapped('gone')
    expect(await screen.findByText('That note was deleted.')).toBeTruthy()
    expect(library().dataset.open).toBe('true')
  })

  it('says so when the note is in the trash, and doesn’t open it', async () => {
    await items.remove('ferry')
    await tapped('ferry')
    expect(await screen.findByText('That note is in the trash.')).toBeTruthy()
    expect(document.querySelector('main .ProseMirror')!.textContent).toBe('')
    expect(library().dataset.open).toBe('true')
  })
})
