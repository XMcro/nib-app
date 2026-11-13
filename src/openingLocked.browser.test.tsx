import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import { localDay } from './lib/time'

/**
 * The loading screen (lib/opening) when Nib launches locked: it waits behind
 * Lock Nib's cover with its line held back (index.html), and once that is
 * down it draws the line, once, and goes.
 */

vi.mock('./lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/platform')>()),
  nativeApp: true,
}))

vi.mock('./lib/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/inbox')>()),
  inbox: { list: async () => ({ captures: [] }), ack: async () => {}, addListener: async () => ({ remove: async () => {} }) },
}))

vi.mock('./lib/lock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/lock')>()),
  coveredNow: async () => true,
}))

const { App } = await import('./App')

beforeEach(async () => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  localStorage.clear()
  localStorage.setItem('nib-device-asked', '1') // the welcome, already seen
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  await db.items.clear()
})
afterEach(() => void vi.useRealTimers())
afterEach(() => {
  cleanup()
  document.getElementById('nib-opening')?.remove()
})

it('waits behind Lock Nib’s cover, then draws its line and goes', async () => {
  const cover = document.createElement('div')
  cover.id = 'nib-opening'
  cover.innerHTML = '<svg class="nib-mark"></svg><svg class="nib-line"><path d="M4 13H128" /></svg>'
  document.body.append(cover)
  await act(async () => void render(<App />))
  await expect.poll(() => cover.dataset.ending).toBe('')
  await act(() => new Promise((resolve) => setTimeout(resolve, 1000)))
  expect(cover.classList.contains('opened')).toBe(false)
  expect(cover.classList.contains('drawing')).toBe(false)

  await act(async () => void window.dispatchEvent(new Event('nibunlock')))
  expect(cover.classList.contains('drawing')).toBe(true)
  await expect.poll(() => cover.classList.contains('opened')).toBe(true)
})
