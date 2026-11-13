import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { describeExpiry } from './lib/expiry'
import { localDay } from './lib/time'

/**
 * An expiry date (lib/expiry), in the app: set from Commands with Nib Plus,
 * shown under the text and on the card, and taken off again.
 */

const state = vi.hoisted(() => ({ active: true, set: (_: { active: boolean }) => {} }))
vi.mock('./lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/platform')>()), nativeApp: true, macApp: true, touchApp: false }))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => {
    const plus = useState({ active: state.active })
    state.set = plus[1]
    return [...plus, true]
  },
  store: { products: async () => ({ products: [] }), purchase: vi.fn(), restore: vi.fn(), manage: vi.fn(), entitlement: vi.fn() },
}))

const { App } = await import('./App')
const library = () => within(document.querySelector<HTMLElement>('.nib-library')!)
const commands = async () => {
  await act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id: 'palette' })))
  return within(screen.getByRole('dialog', { name: 'Commands' }))
}
const dialog = () => within(screen.getByRole('dialog', { name: 'Expiry date' }))
const stored = async () => (await items.get('harbour'))!

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-10T12:00:00') })
  state.active = true
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

describe('an expiry date, with Nib Plus', () => {
  it('is set from Commands, kept on the note, and shown under its text and on its card', async () => {
    await open()
    await userEvent.click((await commands()).getByText('Set an expiry date…'))
    await userEvent.click(dialog().getByRole('button', { name: /^In a week/ }))
    await waitFor(async () => expect((await stored()).expires).toBe('2026-11-17'))
    expect(screen.queryByRole('dialog', { name: 'Expiry date' })).toBeNull()
    // Nothing has gone anywhere yet.
    expect((await stored()).deletedAt).toBeUndefined()

    const row = await screen.findByRole('button', { name: `Expires · ${describeExpiry('2026-11-17')}` })
    expect(document.querySelector('main')!.contains(row)).toBe(true)
    await userEvent.click((await commands()).getByText('Show library'))
    expect(await library().findByText(`Expires ${describeExpiry('2026-11-17')}`)).toBeTruthy()
  })

  it('is changed or taken off from the row under the text, or from Commands', async () => {
    await act(() => items.setExpiry('harbour', '2026-11-17'))
    await open()
    const rows = await commands()
    expect(rows.queryByText('Set an expiry date…')).toBeNull()
    await userEvent.click(rows.getByText('Change expiry date…'))
    await userEvent.click(dialog().getByRole('button', { name: /^In a year/ }))
    await waitFor(async () => expect((await stored()).expires).toBe('2027-11-10'))

    // Focus mode is the words alone: the row is away with the rest.
    const row = () => screen.queryByRole('button', { name: `Expires · ${describeExpiry('2027-11-10')}` })
    await waitFor(() => expect(row()).toBeTruthy())
    await userEvent.click((await commands()).getByText('Focus mode'))
    await waitFor(() => expect(row()).toBeNull())
    await userEvent.click((await commands()).getByText('Leave focus mode'))
    await waitFor(() => expect(row()).toBeTruthy())

    await userEvent.click(row()!)
    await userEvent.click(dialog().getByText('Remove expiry date'))
    await waitFor(async () => expect((await stored()).expires).toBeNull())
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Expires · / })).toBeNull())
    expect((await commands()).getByText('Set an expiry date…')).toBeTruthy()
  })
})

describe('an expiry date, without Nib Plus', () => {
  beforeEach(() => void (state.active = false))

  it('is offered with what it’s part of, and sets nothing', async () => {
    await open()
    const row = (await commands()).getByText('Set an expiry date…')
    expect(within(row.closest('button')!).getByText('Plus')).toBeTruthy()
    await userEvent.click(row)
    expect(screen.queryByRole('dialog', { name: 'Expiry date' })).toBeNull()
    expect(await screen.findByText(/A date for a note or page to move itself to the trash is part of Nib Plus\./)).toBeTruthy()
    expect((await stored()).expires).toBeUndefined()
  })

  it('still shows a date set while there was Plus, and can take it off, but not change it', async () => {
    await act(() => items.setExpiry('harbour', '2026-11-17'))
    await open()
    // In Commands as a row of the note's own, not one that asks for Plus: taking a date off is always there.
    const rows = await commands()
    expect(within(rows.getByText('Change expiry date…').closest('button')!).queryByText('Plus')).toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(await screen.findByRole('button', { name: `Expires · ${describeExpiry('2026-11-17')}` }))
    expect(dialog().queryByLabelText('Expires on')).toBeNull()
    await userEvent.click(dialog().getByText('Remove expiry date'))
    await waitFor(async () => expect((await stored()).expires).toBeNull())
  })
})

describe('a note whose day has come', () => {
  const foot = () => within(document.querySelector<HTMLElement>('.nib-library')!)
  const SAID = '“Harbour notes” expired and is in the trash.'

  it('is in the trash when Nib opens, which says so, and Undo puts it back without its date', async () => {
    await items.setExpiry('harbour', '2026-11-09')
    await act(async () => void render(<App />))
    await waitFor(async () => expect(typeof (await stored()).deletedAt).toBe('number'))
    await waitFor(() => expect(library().queryByText('Harbour notes')).toBeNull())
    expect(await foot().findByText(SAID)).toBeTruthy()

    await userEvent.click(foot().getByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect((await stored()).deletedAt).toBeUndefined())
    expect((await stored()).expires).toBeNull()
    expect(await library().findByText('Harbour notes')).toBeTruthy()
    expect(foot().queryByText(SAID)).toBeNull()
    // And stays back: it isn't due any more.
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    expect((await stored()).deletedAt).toBeUndefined()
  })

  // On an iPhone the notice, with Undo beside Dismiss, squeezed the way into the trash onto two lines.
  it('leaves the way into the trash on one line at a phone’s width, the notice wrapping instead', async () => {
    await page.viewport(390, 800)
    await items.setExpiry('harbour', '2026-11-09')
    await act(async () => void render(<App />))
    expect(await foot().findByText(SAID)).toBeTruthy()
    const bin = document.querySelector<HTMLElement>('[data-trash-bin]')!
    const line = parseFloat(getComputedStyle(bin).lineHeight)
    expect(bin.getBoundingClientRect().height).toBeLessThan(line * 1.5)
  })

  it('goes without Nib Plus too: a date set while there was Plus still stands', async () => {
    state.active = false
    await items.setExpiry('harbour', '2026-11-10')
    await act(async () => void render(<App />))
    await waitFor(async () => expect(typeof (await stored()).deletedAt).toBe('number'))
  })

  it('goes from the archive as well, and what’s already in the trash, or isn’t due, is left as it is', async () => {
    await items.setExpiry('harbour', '2026-11-10')
    await items.setArchived('harbour', true)
    await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thrown out by hand' }] }] }, { id: 'thrown' })
    await items.setExpiry('thrown', '2026-11-01')
    await items.remove('thrown')
    const thrownAt = (await items.get('thrown'))!.deletedAt
    await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'For next week' }] }] }, { id: 'later' })
    await items.setExpiry('later', '2026-11-17')
    await act(async () => void render(<App />))
    await waitFor(async () => expect(typeof (await stored()).deletedAt).toBe('number'))
    // One went, and one is said to have.
    expect(await foot().findByText(SAID)).toBeTruthy()
    expect((await items.get('thrown'))!.deletedAt).toBe(thrownAt)
    expect((await items.get('later'))!.deletedAt).toBeUndefined()
  })

  it('goes when its day comes with Nib open, the one being written too, which can be restored where it is', async () => {
    await items.setExpiry('harbour', '2026-11-11')
    await open()
    expect((await stored()).deletedAt).toBeUndefined()

    vi.setSystemTime(new Date('2026-11-11T08:00:00'))
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(async () => expect(typeof (await stored()).deletedAt).toBe('number'))
    // Its words are still in front, under the banner any document in the trash has, which says why this one is:
    // one banner, not that and a notice saying the same with an Undo beside its Restore.
    expect(document.querySelector('main [data-scroll] .ProseMirror')?.textContent).toContain('Harbour notes')
    expect(await screen.findByText('This expired and is in the trash.')).toBeTruthy()
    expect(screen.queryByText('This was moved to the trash.')).toBeNull()
    expect(screen.queryByText(SAID)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(async () => expect((await stored()).deletedAt).toBeUndefined())
    expect((await stored()).expires).toBeNull()
  })

  it('is said at the library’s foot when the library is over the note it was open in', async () => {
    await items.setExpiry('harbour', '2026-11-11')
    await open()
    await userEvent.click((await commands()).getByText('Show library'))
    await library().findByText('Harbour notes')
    vi.setSystemTime(new Date('2026-11-11T08:00:00'))
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    expect(await foot().findByText(SAID)).toBeTruthy()
    expect(foot().getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('goes with another: the one in front has its banner, and the other is still said', async () => {
    await items.setExpiry('harbour', '2026-11-11')
    await items.create('page', { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Tide tables' }] }] }, { id: 'tides' })
    await items.setExpiry('tides', '2026-11-11')
    await open()
    vi.setSystemTime(new Date('2026-11-11T08:00:00'))
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    // In front: its own banner, and the notice for the other alone.
    expect(await screen.findByText('This expired and is in the trash.')).toBeTruthy()
    expect(await screen.findByText('“Tide tables” expired and is in the trash.')).toBeTruthy()
    await waitFor(async () => expect([typeof (await stored()).deletedAt, typeof (await items.get('tides'))!.deletedAt]).toEqual(['number', 'number']))
  })

  it('thrown out by hand with its day still to come, says only that it was moved', async () => {
    await items.setExpiry('harbour', '2026-11-17')
    await open()
    await act(() => items.remove('harbour'))
    expect(await screen.findByText('This was moved to the trash.')).toBeTruthy()
  })

  it('counts them when several go at once, and Undo puts all of them back', async () => {
    await items.setExpiry('harbour', '2026-11-10')
    await items.create('page', { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Tide tables' }] }] }, { id: 'tides' })
    await items.setExpiry('tides', '2026-11-08')
    await act(async () => void render(<App />))
    expect(await foot().findByText('2 notes and pages expired and are in the trash.')).toBeTruthy()
    await userEvent.click(foot().getByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect([(await stored()).deletedAt, (await items.get('tides'))!.deletedAt]).toEqual([undefined, undefined]))
  })
})

