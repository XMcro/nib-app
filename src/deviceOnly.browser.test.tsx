import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { localDay } from './lib/time'
import type { Sync } from './sync'

/**
 * A note kept on this device only (db Item.deviceOnly), in the app: from
 * Commands, with sync on; said under its text and on its card; and synced
 * again from there. What sync then does is sync/engine.test.
 */

const state = vi.hoisted(() => ({ code: 'A-CODE' as string | null }))
vi.mock('./sync', async (importOriginal) => {
  const real = await importOriginal<typeof import('./sync')>()
  const sync = (): Sync => ({
    status: state.code ? { state: 'synced', at: Date.now() } : { state: 'off' },
    code: state.code,
    known: true,
    create: async () => '',
    join: async () => {},
    turnOff: async () => {},
    wipe: async () => {},
    changeCode: async () => '',
    signing: async () => null,
    requireSigned: async () => {}, filesRoom: async () => null,
    manual: false,
    setManual: () => {},
    syncNow: () => {},
    refetch: async () => {}, inboxAddress: async () => undefined, newInboxAddress: async () => ({ address: '', clipper: '' }), endInbox: async () => {},
  })
  return { ...real, useSync: sync }
})

const { App } = await import('./App')
const library = () => within(document.querySelector<HTMLElement>('.nib-library')!)
const MOD = /Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? 'Meta' : 'Control'
const commands = async () => {
  await userEvent.keyboard(`{${MOD}>}k{/${MOD}}`)
  return within(await screen.findByRole('dialog', { name: 'Commands' }))
}
const stored = async () => (await items.get('harbour'))!
const KEEP = 'Keep on this device only'
const AGAIN = 'Sync to my other devices again'
const SAID = 'This note is now on this device only. It comes off your other devices at the next sync, and has no copy anywhere else.'

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-10T12:00:00') })
  state.code = 'A-CODE'
  localStorage.setItem('nib-device-asked', '1')
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]]))
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }]))
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true }))
  await db.items.clear()
  await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Harbour notes' }] }] }, { id: 'harbour' })
  await page.viewport(1280, 800)
})
afterEach(() => void vi.useRealTimers())
afterEach(cleanup)

async function open() {
  await act(async () => void render(<App />))
  await userEvent.click(await library().findByText('Harbour notes'))
  await expect.poll(() => document.querySelector('main [data-scroll] .ProseMirror')?.textContent).toContain('Harbour notes')
}

describe('a note kept on this device only, with sync on', () => {
  it('is kept from Commands, which says what that means and can undo it', async () => {
    await open()
    await userEvent.click((await commands()).getByText(KEEP))
    await waitFor(async () => expect((await stored()).deviceOnly).toBe(true))
    expect(await screen.findByText(SAID)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect((await stored()).deviceOnly).toBeNull())
    expect(screen.queryByText(SAID)).toBeNull()
  })

  it('says so under its text and on its card, and is synced again from Commands, with nothing more said', async () => {
    await items.setDeviceOnly('harbour', true)
    await open()
    expect(await screen.findByText(/^This device only · /)).toBeTruthy()
    const rows = await commands()
    expect(rows.queryByText(KEEP)).toBeNull()
    await userEvent.click(rows.getByText(AGAIN))
    await waitFor(async () => expect((await stored()).deviceOnly).toBeNull())
    await waitFor(() => expect(screen.queryByText(/^This device only · /)).toBeNull())
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('wears it on its card in the library', async () => {
    await items.setDeviceOnly('harbour', true)
    await act(async () => void render(<App />))
    await library().findByText('Harbour notes')
    expect(await library().findByText('This device only')).toBeTruthy()
  })
})

describe('with sync off', () => {
  beforeEach(() => void (state.code = null))

  it('isn’t offered: nothing leaves this device as it is', async () => {
    await open()
    const rows = await commands()
    expect(rows.queryByText(KEEP)).toBeNull()
    expect(rows.queryByText(AGAIN)).toBeNull()
  })

  it('can still be taken off a note that has it, for when sync is on again', async () => {
    await items.setDeviceOnly('harbour', true)
    await open()
    await userEvent.click((await commands()).getByText(AGAIN))
    await waitFor(async () => expect((await stored()).deviceOnly).toBeNull())
  })
})
