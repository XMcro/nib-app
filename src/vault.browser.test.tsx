import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import * as vault from './lib/vault'
import { localDay } from './lib/time'

/**
 * The vault through the whole app: lock a note from the palette with a new
 * passcode, see it shut when the vault does, open it again, and take the lock
 * off. The encryption is real; only the App Store is stood in for.
 */

vi.mock('./lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/platform')>()),
  nativeApp: true,
}))

vi.mock('./lib/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/inbox')>()),
  inbox: { list: async () => ({ captures: [] }), ack: async () => {}, addListener: async () => ({ remove: async () => {} }) },
}))

const subscriber = vi.hoisted(() => ({ active: true }))
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

async function command(label: string) {
  await userEvent.keyboard('{Meta>}k{/Meta}')
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label}`) }))
}

beforeEach(async () => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  localStorage.clear()
  localStorage.setItem('nib-device-asked', '1') // the welcome, already seen
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  await db.items.clear()
  await db.revisions.clear()
  await page.viewport(1280, 800)
  subscriber.active = true
})
afterEach(() => void vi.useRealTimers())
afterEach(() => {
  vault.closeVault()
  cleanup()
})

describe('the vault', () => {
  it('locks a note behind a passcode of its own, shuts with the vault, and opens again', async () => {
    await act(async () => void render(<App />))
    await newNote()
    await userEvent.click(document.querySelector('.ProseMirror')!)
    await userEvent.keyboard('Ferry at 07:40')

    await command('Lock this note')
    const dialog = await screen.findByRole('dialog', { name: 'Set a vault passcode' })
    expect(dialog.textContent).toContain('If you forget it, no one can open them')
    await userEvent.type(screen.getByLabelText('Passcode'), 'harbour lights')
    await userEvent.type(screen.getByLabelText('The same again'), 'harbour lights')
    await userEvent.click(screen.getByRole('button', { name: 'Lock' }))
    await screen.findByText(/^Locked\. Only the vault’s passcode opens it now/, {}, { timeout: 5000 })

    // Stored sealed: nothing readable is left, in the note or its history.
    const [stored] = await db.items.toArray()
    expect(JSON.stringify(stored)).not.toContain('Ferry')
    expect(await db.revisions.count()).toBe(0)
    // The library knows its title only while the vault is open.
    expect(screen.getAllByText('Ferry at 07:40').length).toBeGreaterThan(0)

    await command('Lock the vault now')
    await screen.findByText('This is locked in the vault.')
    expect(document.querySelector('.ProseMirror')).toBeNull()
    // Nothing to export with the vault shut, and it says so.
    await command('Export this one as Markdown')
    await screen.findByText('This is locked. Open the vault to export it.')
    // Back in the library, its card has no title to give.
    await userEvent.click(within(document.querySelector('main')!).getByRole('button', { name: 'Notes' }))
    const card = screen.getByRole('img', { name: 'Locked' }).parentElement!
    expect(card.textContent).toBe('Locked')
    await userEvent.click(card)

    await userEvent.click(await screen.findByRole('button', { name: 'Open the vault' }))
    await userEvent.type(await screen.findByLabelText('Passcode'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await screen.findByText('That passcode doesn’t open the vault.', {}, { timeout: 5000 })
    await userEvent.clear(screen.getByLabelText('Passcode'))
    await userEvent.type(screen.getByLabelText('Passcode'), 'harbour lights')
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toBe('Ferry at 07:40'), { timeout: 5000 })

    await command('Remove the lock')
    await screen.findByText(/^Unlocked\./)
    await waitFor(async () => expect(JSON.stringify(await db.items.toArray())).toContain('Ferry at 07:40'))
  })

  // Both read "Untitled", even with the vault open: a locked note could be deleted for good as though it were empty.
  it('names a locked note in Commands and the trash as the library does, and only while the vault is open', async () => {
    await act(async () => void render(<App />))
    await newNote()
    await userEvent.click(document.querySelector('.ProseMirror')!)
    await userEvent.keyboard('Ferry at 07:40')
    await command('Lock this note')
    await userEvent.type(await screen.findByLabelText('Passcode'), 'harbour lights')
    await userEvent.type(screen.getByLabelText('The same again'), 'harbour lights')
    await userEvent.click(screen.getByRole('button', { name: 'Lock' }))
    await screen.findByText(/^Locked\. Only the vault’s passcode opens it now/, {}, { timeout: 5000 })

    const search = async (words: string) => {
      await userEvent.keyboard('{Meta>}k{/Meta}')
      await userEvent.keyboard(words)
      return within(await screen.findByRole('dialog', { name: 'Commands' }))
    }
    expect((await search('Ferry')).getByRole('button', { name: /^Ferry at 07:40/ })).toBeTruthy()
    await userEvent.keyboard('{Escape}')

    await command('Move this to trash')
    await command('Open trash')
    const trash = () => document.querySelector<HTMLElement>('.nib-trash-row')!
    await expect.poll(() => trash()?.textContent).toContain('Ferry at 07:40')

    await command('Lock the vault now')
    await expect.poll(() => trash().textContent).toContain('Locked')
    expect(trash().textContent).not.toContain('Ferry')

    // Out of the trash, and looked for with the vault shut: its title is not to be found.
    await userEvent.click(within(trash()).getByRole('button', { name: 'Restore' }))
    await expect.poll(async () => (await db.items.toArray())[0].deletedAt).toBeUndefined()
    expect((await search('Ferry')).getByText('Nothing matches.')).toBeTruthy()
  })

  it('without Plus, offers the lock as a Plus feature', async () => {
    subscriber.active = false
    await act(async () => void render(<App />))
    await newNote()
    await userEvent.click(document.querySelector('.ProseMirror')!)
    await userEvent.keyboard('Plain')
    await userEvent.keyboard('{Meta>}k{/Meta}')
    const lock = await screen.findByRole('button', { name: /^Lock this note/ })
    expect(lock.textContent).toContain('Plus')
  })
})
