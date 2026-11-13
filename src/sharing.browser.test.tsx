import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import { localDay } from './lib/time'

/**
 * Sharing a draft through the whole app, as on the Mac: from the palette to
 * the dialog, with and without Plus. Nothing here reaches a server.
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

describe('sharing a draft', () => {
  it('with Plus, opens the dialog from the palette, saying what will happen first', async () => {
    subscriber.active = true
    await act(async () => void render(<App />))
    await newNote()
    await write('Chapter one')
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.click(await screen.findByRole('button', { name: /^Share a draft…$/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Share a draft' })
    expect(dialog.textContent).toContain('The server stores this encrypted. Anyone with the link can read it and leave notes.')
    expect(screen.getByRole('button', { name: 'Create link' })).toBeTruthy()
  })

  it('without Plus, shares one read-only link at a time, and names the document holding it', async () => {
    subscriber.active = false
    const sent: unknown[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ expiresAt: Date.now() + 7 * 86_400_000 }), { status: 201 })
    })
    try {
      await act(async () => void render(<App />))
      await newNote()
      await write('Chapter one')
      await userEvent.keyboard('{Meta>}k{/Meta}')
      expect((await screen.findByRole('button', { name: /^Share a draft…/ })).textContent).toBe('Share a draft…')
      await userEvent.click(screen.getByRole('button', { name: /^Share a draft…/ }))
      const dialog = await screen.findByRole('dialog', { name: 'Share a draft' })
      expect(dialog.textContent).toContain('Anyone with the link can read it.')
      await userEvent.click(screen.getByRole('button', { name: 'Create link' }))
      expect(await screen.findByLabelText('Link to this draft')).toBeTruthy()
      expect(sent).toEqual([expect.not.objectContaining({ jws: expect.anything() })])
      // Closed from outside it: once the link is made, focus has left the dialog.
      await act(async () => void document.querySelector('.nib-overlay')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))

      // A second document, while the first holds the free link.
      await userEvent.keyboard('{Meta>}{Alt>}n{/Alt}{/Meta}')
      await write('Chapter two')
      await userEvent.keyboard('{Meta>}k{/Meta}')
      await userEvent.click(await screen.findByRole('button', { name: /^Share a draft…/ }))
      expect(await screen.findByText(/Your free link is sharing “Chapter one”/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Create link' })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'See Nib Plus' }))
      expect(await screen.findByText('Restore purchases')).toBeTruthy()
      expect(sent).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
