import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { strFromU8, unzipSync } from 'fflate'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { localDay } from './lib/time'

/** The library's select mode, exporting what's marked as one zip, in the app. The zip's making is lib/exportMany's test, and the printing the system's. */

const state = vi.hoisted(() => ({ active: false, download: vi.fn(async () => {}) }))
vi.mock('./lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/platform')>()), nativeApp: true, macApp: true, touchApp: false }))
vi.mock('./lib/download', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/download')>()), download: state.download }))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [...useState({ active: state.active }), true],
  store: { products: async () => ({ products: [] }), purchase: vi.fn(), restore: vi.fn(), manage: vi.fn(), entitlement: vi.fn() },
}))

const { App } = await import('./App')
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const library = () => within(document.querySelector<HTMLElement>('.nib-library')!)
const titles = () => [...document.querySelectorAll('.nib-library [data-title]')].map((title) => title.textContent)
const card = (id: string) => document.querySelector<HTMLElement>(`.nib-library [data-id="${id}"] > button`)!
const press = (name: string | RegExp) => userEvent.click(library().getByRole('button', { name }))
const sheet = () => within(screen.getByRole('dialog', { name: 'Export' }))
const handed = async () => {
  const [zip, name] = state.download.mock.calls[0] as unknown as [Blob, string]
  return { name, files: unzipSync(new Uint8Array(await zip.arrayBuffer())) }
}

let one = ''
let two = ''

async function start(plus: boolean) {
  state.active = plus
  await act(async () => void render(<App />))
  await expect.poll(titles).toHaveLength(3)
  await press('Select')
  await userEvent.click(card(one))
  await userEvent.click(card(two))
}

beforeEach(async () => {
  // The day's pack, its coins and the first steps are done with: they'd come up over the library.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  localStorage.clear()
  localStorage.setItem('nib-device-asked', '1')
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]]))
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }]))
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true }))
  await db.items.clear()
  state.download.mockClear()
  await page.viewport(1280, 800)
  one = await items.create('note', doc('One'))
  two = await items.create('note', doc('Two'))
  await items.create('note', doc('Three'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('exporting what’s marked', () => {
  it('offers nothing to export with none marked', async () => {
    state.active = false
    await act(async () => void render(<App />))
    await expect.poll(titles).toHaveLength(3)
    await press('Select')
    expect(library().getByRole('button', { name: 'Export…' }).hasAttribute('disabled')).toBe(true)
  })

  it('hands over a zip of Markdown, free, and selecting is over', async () => {
    await start(false)
    await press('Export…')
    expect(screen.getByRole('dialog', { name: 'Export' }).textContent).toContain('Export 2 documents')
    await userEvent.click(sheet().getByRole('button', { name: 'Markdown' }))
    await expect.poll(() => state.download.mock.calls.length).toBe(1)
    const { name, files } = await handed()
    expect(name).toMatch(/^nib-export-\d{4}-\d\d-\d\d\.zip$/)
    expect(Object.keys(files).sort()).toEqual(['One.md', 'Two.md'])
    expect(strFromU8(files['Two.md'])).toBe('Two')
    await expect.poll(() => screen.queryByRole('dialog', { name: 'Export' })).toBeNull()
    expect(library().queryByRole('button', { name: 'Done' })).toBeNull()
    expect(card(one).hasAttribute('aria-pressed')).toBe(false)
    expect(document.querySelector('.nib-library')!.hasAttribute('inert')).toBe(false)
  })

  it('asks for Nib Plus for a PDF without it, exports nothing, and keeps them marked', async () => {
    await start(false)
    await press('Export…')
    expect(sheet().getByRole('button', { name: /^PDF/ }).textContent).toBe('PDFPlus')
    await userEvent.click(sheet().getByRole('button', { name: /^PDF/ }))
    await expect.poll(() => document.querySelector('.nib-plus-sheet')?.textContent ?? '').toContain('Word, PDF and HTML export are part of Nib Plus.')
    expect(screen.queryByRole('dialog', { name: 'Export' })).toBeNull()
    expect(state.download).not.toHaveBeenCalled()
    expect(library().getByRole('status').textContent).toBe('2 selected')
    expect(card(one).getAttribute('aria-pressed')).toBe('true')
  })

  it('hands over a zip of HTML with Nib Plus', async () => {
    await start(true)
    await press('Export…')
    expect(sheet().getByRole('button', { name: 'HTML' }).textContent).toBe('HTML')
    await userEvent.click(sheet().getByRole('button', { name: 'HTML' }))
    await expect.poll(() => state.download.mock.calls.length).toBe(1)
    const { files } = await handed()
    expect(Object.keys(files).sort()).toEqual(['One.html', 'Two.html'])
    expect(strFromU8(files['One.html'])).toContain('<title>One</title>')
    await expect.poll(() => library().queryByRole('button', { name: 'Done' })).toBeNull()
  })

  it('leaves a locked note out with the vault shut, and says so in the foot once selecting is over', async () => {
    await db.items.update(two, { vault: { v: 1, iv: 'a', data: 'b' } as never })
    await start(false)
    await press('Export…')
    await userEvent.click(sheet().getByRole('button', { name: 'Markdown' }))
    await expect.poll(() => state.download.mock.calls.length).toBe(1)
    expect(Object.keys((await handed()).files)).toEqual(['One.md'])
    await expect.poll(() => document.querySelector('.nib-library footer')?.textContent ?? '').toContain('One locked note couldn’t be opened, so it isn’t in the zip.')
  })
})
