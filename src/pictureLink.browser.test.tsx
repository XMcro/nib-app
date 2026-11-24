import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { useState } from 'react'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { localDay } from './lib/time'

/**
 * Add a picture from a link (lib/pictureLink), in Commands: in the app, which
 * is what can fetch one, and for a document that can be written in.
 */

vi.mock('./lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/platform')>()), nativeApp: true, macApp: true, touchApp: false }))

// Nib Plus, which this has needed since Phase 10 (without it, Commands offers Plus: App.test).
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [...useState({ active: true }), true],
}))

const { App } = await import('./App')
const library = () => within(document.querySelector<HTMLElement>('.nib-library')!)
const commands = async () => {
  await act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id: 'palette' })))
  return within(screen.getByRole('dialog', { name: 'Commands' }))
}
const ROW = 'Add a picture from a link…'

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
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

describe('Add a picture from a link, in Commands', () => {
  it('opens its dialog over the document being written', async () => {
    await open()
    await userEvent.click((await commands()).getByText(ROW))
    expect(await screen.findByRole('dialog', { name: 'Add a picture from a link' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Add a picture from a link' })).toBeNull()
  })

  it('isn’t offered for a document that’s only to be read', async () => {
    await act(() => items.setReadOnly('harbour', true))
    await open()
    expect((await commands()).queryByText(ROW)).toBeNull()
  })

  it('isn’t offered with the library up, when there’s no document in front to put it in', async () => {
    await act(async () => void render(<App />))
    expect((await commands()).queryByText(ROW)).toBeNull()
  })
})
