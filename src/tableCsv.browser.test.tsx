import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { userEvent } from 'vitest/browser'
import type { JSONContent } from '@tiptap/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { localDay } from './lib/time'

/** A page's tables out to CSV and in from it, in the Mac app, from Commands, with Nib Plus. */

const state = vi.hoisted(() => ({ active: true, download: vi.fn(async () => {}), picked: undefined as File | undefined, opened: 0 }))
vi.mock('./lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/platform')>()), nativeApp: true, macApp: true, touchApp: false }))
vi.mock('./lib/download', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/download')>()), download: state.download }))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [...useState({ active: state.active }), true],
  store: { products: async () => ({ products: [] }), purchase: vi.fn(), restore: vi.fn(), manage: vi.fn(), entitlement: vi.fn() },
}))

const { App } = await import('./App')
const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)))
const commands = async () => {
  await act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id: 'palette' })))
  return within(screen.getByRole('dialog', { name: 'Commands' }))
}
const para = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const cell = (type: string, text: string): JSONContent => ({ type, content: [para(text)] })
const TABLE: JSONContent = { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', 'Tide'), cell('tableHeader', 'Time')] }, { type: 'tableRow', content: [cell('tableCell', 'High'), cell('tableCell', '07:40')] }] }
const saved = async () => (await db.items.toArray())[0].body.content!
const csvFile = (text: string) => new File([text], 'tides.csv', { type: 'text/csv' })

async function openFirst(tab = 'Pages') {
  await act(async () => void render(<App />))
  await wait()
  await userEvent.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('tab', { name: tab }))
  await userEvent.click(await vi.waitFor(() => {
    const card = document.querySelector<HTMLElement>('.nib-library [data-id] > button')
    expect(card).not.toBeNull()
    return card!
  }))
  await waitFor(() => expect(document.querySelector('main .ProseMirror')).not.toBeNull())
  await wait()
}
const clickIn = (selector: string) => userEvent.click(document.querySelector<HTMLElement>(`main .ProseMirror ${selector}`)!)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  state.active = true
  state.picked = undefined
  state.opened = 0
  state.download.mockClear()
  localStorage.setItem('nib-device-asked', '1')
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]]))
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }]))
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true }))
  await db.items.clear()
  await page.viewport(1280, 800)
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    if (this.type !== 'file') return
    state.opened++
    expect(this.accept).toBe('.csv,text/csv')
    if (state.picked) Object.defineProperty(this, 'files', { value: [state.picked] })
    this.dispatchEvent(new Event(state.picked ? 'change' : 'cancel'))
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CSV in Commands', () => {
  it('puts a file into the page as a table, with a line after it to carry on writing', async () => {
    await items.create('page', { type: 'doc', content: [{ type: 'paragraph' }] })
    await openFirst()
    await clickIn('p')
    state.picked = csvFile('Tide,Time\nHigh,07:40\n')
    await userEvent.click((await commands()).getByRole('button', { name: /^Insert a table from CSV/ }))
    await waitFor(async () => expect((await saved()).map((block) => block.type)).toEqual(['table', 'paragraph']), { timeout: 5000 })
    expect(document.querySelector('main th')?.textContent).toBe('Tide')
    expect(document.querySelectorAll('main td')).toHaveLength(2)
  })

  it('goes in where the caret is, with no extra line when the page carries on after it', async () => {
    await items.create('page', { type: 'doc', content: [{ type: 'paragraph' }, para('Below')] })
    await openFirst()
    await act(async () => void document.querySelector<HTMLElement>('main .ProseMirror')!.focus())
    await clickIn('p')
    state.picked = csvFile('a,b\n1,2')
    await userEvent.click((await commands()).getByRole('button', { name: /^Insert a table from CSV/ }))
    await waitFor(async () => expect((await saved()).map((block) => block.type)).toEqual(['table', 'paragraph']), { timeout: 5000 })
    expect((await saved())[1].content?.[0].text).toBe('Below')
  })

  it('leaves the page as it was when the picker is cancelled', async () => {
    await items.create('page', { type: 'doc', content: [para('Hello')] })
    await openFirst()
    await clickIn('p')
    await userEvent.click((await commands()).getByRole('button', { name: /^Insert a table from CSV/ }))
    expect(state.opened).toBe(1)
    await wait()
    expect(document.querySelector('main table')).toBeNull()
    expect(document.querySelector('body > input[type="file"]')).toBeNull()
  })

  it('says so, and changes nothing, for a file with nothing in it', async () => {
    await items.create('page', { type: 'doc', content: [para('Hello')] })
    await openFirst()
    await clickIn('p')
    state.picked = csvFile('')
    await userEvent.click((await commands()).getByRole('button', { name: /^Insert a table from CSV/ }))
    await waitFor(() => expect(document.body.textContent).toContain('There’s nothing in that CSV.'))
    expect(document.querySelector('main table')).toBeNull()
  })

  it('offers the table’s export with the caret in a table, named for the page, and no insert', async () => {
    await items.create('page', { type: 'doc', content: [para('Harbour times'), TABLE] })
    await openFirst()
    await clickIn('td')
    const palette = await commands()
    expect(palette.queryByRole('button', { name: /^Insert a table from CSV/ })).toBeNull()
    await userEvent.click(palette.getByRole('button', { name: /^Export this table as CSV/ }))
    await waitFor(() => expect(state.download).toHaveBeenCalledWith('\uFEFFTide,Time\r\nHigh,07:40\r\n', 'Harbour times.csv', 'text/csv;charset=utf-8'))
  })

  it('offers no export with the caret outside a table', async () => {
    await items.create('page', { type: 'doc', content: [para('Harbour times'), TABLE] })
    await openFirst()
    await clickIn('p')
    expect((await commands()).queryByRole('button', { name: /^Export this table as CSV/ })).toBeNull()
  })

  it('asks for Plus without it, and opens no picker', async () => {
    state.active = false
    await items.create('page', { type: 'doc', content: [para('Hello')] })
    await openFirst()
    await clickIn('p')
    await userEvent.click((await commands()).getByRole('button', { name: /^Insert a table from CSV/ }))
    await waitFor(() => expect(document.body.textContent).toContain('are part of Nib Plus'))
    expect(state.opened).toBe(0)
  })

  it('asks for Plus for the export too, and hands nothing over', async () => {
    state.active = false
    await items.create('page', { type: 'doc', content: [para('Harbour times'), TABLE] })
    await openFirst()
    await clickIn('td')
    await userEvent.click((await commands()).getByRole('button', { name: /^Export this table as CSV/ }))
    await waitFor(() => expect(document.body.textContent).toContain('are part of Nib Plus'))
    expect(state.download).not.toHaveBeenCalled()
  })

  it('in a read-only page, inserts nothing, and a table can still go out', async () => {
    const id = await items.create('page', { type: 'doc', content: [para('Harbour times'), TABLE] })
    await items.setReadOnly(id, true)
    await openFirst()
    await clickIn('p')
    expect((await commands()).queryByRole('button', { name: /^Insert a table from CSV/ })).toBeNull()
    await userEvent.keyboard('{Escape}')
    await clickIn('td')
    expect((await commands()).getByRole('button', { name: /^Export this table as CSV/ })).toBeTruthy()
  })

  it('is not in a note, which has no tables', async () => {
    await items.create('note', { type: 'doc', content: [para('A note')] })
    await openFirst('Notes')
    await clickIn('p')
    const palette = await commands()
    expect(palette.queryByRole('button', { name: /CSV/ })).toBeNull()
  })
})
