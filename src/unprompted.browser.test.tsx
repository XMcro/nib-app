import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { localDay } from './lib/time'

/**
 * What Nib asks once (lib/feedback) as it comes in its turn among what Nib
 * brings up unasked (lib/useUnprompted), through the whole app, as on the Mac.
 * Coins and packs have tests of their own (rewards.browser.test).
 */

vi.mock('./lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/platform')>()), nativeApp: true, macApp: true }))
vi.mock('./lib/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/inbox')>()),
  inbox: { list: async () => ({ captures: [] }), ack: async () => {}, addListener: async () => ({ remove: async () => {} }) },
}))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [{ active: true }, () => {}, true],
  store: { products: async () => ({ products: [] }), purchase: vi.fn(), restore: vi.fn(), manage: vi.fn(), entitlement: vi.fn() },
}))
// The Keychain, which outlives the app: what lib/feedback has asked before.
const chain = vi.hoisted(() => ({ kept: new Map<string, string>() }))
vi.mock('./lib/keychain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/keychain')>()),
  keychain: {
    get: async ({ key }: { key: string }) => ({ value: chain.kept.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => void chain.kept.set(key, value),
    remove: async () => {},
    vaultStatus: async () => ({ biometry: 'none', stored: false }),
  },
}))

const { App } = await import('./App')

const COUNTS = 'Help make Nib better?'
const FEEDBACK = 'What should Nib do next?'
const sheet = (name: string) => screen.queryByRole('dialog', { name })
/** Up to the few seconds it waits, and the sync and iCloud looks before them. */
const arrives = (name: string) => screen.findByRole('dialog', { name }, { timeout: 6000 })
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('nib-device-asked', '1') // the welcome, already seen
  localStorage.setItem('nib-daily-asked', 'true') // the daily reminder, already offered
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away (firsts.browser.test)
  chain.kept.clear()
  await db.items.clear()
  await page.viewport(1280, 800)
})
afterEach(cleanup)

describe('What Nib asks once', () => {
  it('asks about counts at the second launch, a few seconds in', async () => {
    localStorage.setItem('nib-launches', '2')
    await act(async () => void render(<App />))
    await pause(2500)
    expect(sheet(COUNTS)).toBeNull()
    expect(await arrives(COUNTS)).toBeTruthy()
  })

  // Coins, then the pack, then a question, each 0.7 s after the last.
  it('waits its turn as a third card in a row', async () => {
    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'], now })
    onTestFinished(() => void vi.useRealTimers())
    localStorage.setItem('nib-launches', '2')
    localStorage.removeItem('nib-book')
    localStorage.removeItem('nib-trades')
    await act(async () => void render(<App />))
    const coins = await arrives('Today’s coins')
    await userEvent.click(within(coins).getByRole('button', { name: /^Collect \d/ }))
    await userEvent.click(within(coins).getByRole('button', { name: 'Done' }))
    const pack = await arrives('Today’s pack')
    await userEvent.click(within(pack).getByRole('button', { name: 'Later' }))
    await pause(4500)
    expect(sheet(COUNTS)).toBeNull()

    vi.setSystemTime(now + 11 * 60_000)
    expect(await arrives(COUNTS)).toBeTruthy()
  })

  it('asks nothing at the first launch', async () => {
    localStorage.setItem('nib-launches', '1')
    await act(async () => void render(<App />))
    await pause(5000)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('comes after today’s pack has been dealt with', async () => {
    localStorage.setItem('nib-launches', '2')
    localStorage.removeItem('nib-book')
    await act(async () => void render(<App />))
    const pack = await screen.findByRole('dialog', { name: 'Today’s pack' }, { timeout: 3000 })
    await pause(4500)
    expect(sheet(COUNTS)).toBeNull()
    await userEvent.click(within(pack).getByRole('button', { name: 'Later' }))
    expect(await arrives(COUNTS)).toBeTruthy()
  })

  it('offers feedback from the third launch, once ever, with counts already answered', async () => {
    localStorage.setItem('nib-launches', '3')
    localStorage.setItem('nib-counts-answer', 'no')
    await act(async () => void render(<App />))
    const offer = await arrives(FEEDBACK)
    await userEvent.click(within(offer).getByRole('button', { name: 'Not now' }))
    expect(chain.kept.has('feedback-offered')).toBe(true)
    cleanup()
    await act(async () => void render(<App />))
    await pause(5000)
    expect(sheet(FEEDBACK)).toBeNull()
  })

  it('asks at most one thing a launch', async () => {
    localStorage.setItem('nib-launches', '3')
    await act(async () => void render(<App />))
    const asked = await arrives(COUNTS)
    await userEvent.click(within(asked).getByRole('button', { name: 'No thanks' }))
    await pause(5000)
    expect(sheet(FEEDBACK)).toBeNull()
  })

  it('waits for the caret to leave the text, on a Mac too', async () => {
    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'], now })
    onTestFinished(() => void vi.useRealTimers())
    localStorage.setItem('nib-launches', '2')
    await act(async () => void render(<App />))
    await userEvent.click(screen.getByRole('button', { name: 'New note' }))
    await expect.poll(() => document.activeElement?.closest('.ProseMirror') != null).toBe(true)
    vi.setSystemTime(now + 61_000)
    await pause(4500)
    expect(sheet(COUNTS)).toBeNull()

    act(() => (document.activeElement as HTMLElement).blur())
    expect(await arrives(COUNTS)).toBeTruthy()
  })
})

describe('the writing buddy', () => {
  const OFFER = 'Meet Inkwell?'
  const corner = () => screen.queryByRole('button', { name: 'Inkwell' })
  // Its turn comes after the looks for sync and iCloud, and a pause: longer than the others' wait on a busy machine.
  const offered = () => screen.findByRole('dialog', { name: OFFER }, { timeout: 15_000 })
  /** Launches past counts and feedback, both dealt with, as for a writer who updates. */
  function updated() {
    localStorage.setItem('nib-launches', '9')
    localStorage.setItem('nib-counts-answer', 'no')
    chain.kept.set('feedback-offered', '1')
  }

  it('is offered once, after counts and feedback; Say hello opens it, and leaves it in its corner', async () => {
    updated()
    await act(async () => void render(<App />))
    const offer = await offered()
    expect(corner()).toBeNull()
    await userEvent.click(within(offer).getByRole('button', { name: 'Say hello' }))
    const opened = await screen.findByRole('dialog', { name: 'Inkwell' })
    await userEvent.click(within(opened).getByRole('button', { name: 'Done' }))
    expect(corner()).toBeTruthy()
    expect(localStorage.getItem('nib-buddy')).toBe('on')

    // Opened from its corner. And never offered again.
    await userEvent.click(corner()!)
    expect(await screen.findByRole('dialog', { name: 'Inkwell' })).toBeTruthy()
    cleanup()
    await act(async () => void render(<App />))
    await pause(5000)
    expect(sheet(OFFER)).toBeNull()
    expect(corner()).toBeTruthy()
  })

  it('stays out of the corner after Not now, till it’s turned on in Settings', async () => {
    updated()
    await act(async () => void render(<App />))
    await userEvent.click(within(await offered()).getByRole('button', { name: 'Not now' }))
    expect(corner()).toBeNull()
    expect(localStorage.getItem('nib-buddy')).toBe('off')
    await userEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    const settings = await screen.findByRole('dialog', { name: 'Settings' })
    await userEvent.click(within(settings).getByRole('switch', { name: 'Inkwell' }))
    expect(within(settings).getByRole('switch', { name: 'Inkwell' }).getAttribute('aria-checked')).toBe('true')
    await userEvent.click(within(settings).getByRole('button', { name: 'Done' }))
    expect(corner()).toBeTruthy()
  })

  it('leaves the screen to the writing in focus mode', async () => {
    localStorage.setItem('nib-buddy', 'on')
    await act(async () => void render(<App />))
    expect(corner()).toBeTruthy()
    await act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id: 'focus' })))
    expect(corner()).toBeNull()
    await act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id: 'focus' })))
    expect(corner()).toBeTruthy()
  })

  it('welcomes you back after days away, with the piece last written in, once the screen is clear, and once that day', async () => {
    localStorage.setItem('nib-buddy', 'on')
    localStorage.setItem('nib-goal-calendar', JSON.stringify({ [localDay(Date.now() - 5 * 86_400_000)]: 420 }))
    await items.create('page', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The Crossing' }] }] })
    await act(async () => void render(<App />))
    expect(await screen.findByRole('button', { name: /“The Crossing”/ }, { timeout: 15_000 })).toBeTruthy()

    cleanup()
    await act(async () => void render(<App />))
    await pause(4000)
    expect(screen.getByRole('status').textContent).toBe('')
  }, 30_000)
})
