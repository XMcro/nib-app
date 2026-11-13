import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import './index.css'
import { App } from './App'
import { db } from './db/db'
import * as items from './db/items'
import { DEFAULT_START, leftAt, setStart } from './lib/startAt'

/**
 * Nib opening where the writer chose (lib/startAt, Customize), in the app:
 * on Pages, on a folder, on the document it was left at; a folder for what's
 * written next; and none of it without Plus.
 */

const subscriber = vi.hoisted(() => ({ active: true }))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [{ active: subscriber.active }, () => {}, true],
}))

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const library = () => within(document.querySelector<HTMLElement>('.nib-library')!)
const titles = () => [...document.querySelectorAll('.nib-library [data-id] [data-title]')].map((title) => title.textContent)
const chip = (name: RegExp | string) => within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name })
const tab = (name: string) => library().getByRole('tab', { name }).getAttribute('aria-selected')
const libraryShowing = () => document.querySelector('main')?.hasAttribute('inert') ?? false
const written = () => document.querySelector('main [data-scroll] .ProseMirror')?.textContent ?? ''
const launch = () => act(async () => void render(<App />))

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('nib-device-asked', '1')
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true }))
  subscriber.active = true
  await db.items.clear()
  await page.viewport(1280, 800)
  await items.create('note', doc('Groceries'), { id: 'groceries' })
  await items.create('note', doc('Research notes'), { id: 'research', folder: 'Novel' })
  await items.create('page', doc('Chapter one'), { id: 'chapter', folder: 'Novel' })
  await items.create('page', doc('A letter home'), { id: 'letter' })
})

afterEach(() => {
  cleanup()
  setStart(DEFAULT_START)
})

describe('Nib opening where it was asked to', () => {
  it('opens on Notes with everything showing, as it always did, when nothing was chosen', async () => {
    await launch()
    await expect.poll(titles).toEqual(expect.arrayContaining(['Groceries', 'Research notes']))
    expect([tab('Notes'), chip('All').getAttribute('aria-pressed')]).toEqual(['true', 'true'])
    expect(libraryShowing()).toBe(true)
  })

  it('opens on Pages, in the folder chosen', async () => {
    setStart({ on: 'pages', folder: 'novel' })
    await launch()
    await expect.poll(titles).toEqual(['Chapter one'])
    expect(tab('Pages')).toBe('true')
    expect(chip(/^Novel/).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens the document it was left at, and keeps where it’s left from then on', async () => {
    setStart({ on: 'last' })
    localStorage.setItem('nib-left-at', 'chapter')
    await launch()
    await expect.poll(written).toBe('Chapter one')
    expect(libraryShowing()).toBe(false)

    // Back at the library, that is where it was left; in another document, that one.
    await userEvent.click(screen.getByRole('button', { name: /Pages$/ }))
    await expect.poll(leftAt).toBeNull()
    await userEvent.click(await library().findByText('A letter home'))
    await expect.poll(leftAt).toBe('letter')
  })

  it('opens on the library when what it was left at is in the trash', async () => {
    setStart({ on: 'last' })
    localStorage.setItem('nib-left-at', 'groceries')
    await items.remove('groceries')
    await launch()
    await expect.poll(titles).toEqual(['Research notes'])
    expect(libraryShowing()).toBe(true)
    expect(written()).toBe('')
  })

  it('files what’s written next in the folder chosen for it', async () => {
    setStart({ newIn: 'Novel' })
    await launch()
    await expect.poll(titles).toHaveLength(2)
    await userEvent.click(library().getByRole('button', { name: /New note/ }))
    await expect.poll(() => document.querySelector('.ProseMirror')).toBeTruthy()
    document.querySelector<HTMLElement>('.ProseMirror')!.focus()
    await userEvent.keyboard('Plot twist')
    await expect.poll(async () => (await items.listAll()).find((item) => JSON.stringify(item.body).includes('Plot twist'))?.folder, { timeout: 3000 }).toBe('Novel')
  })

  it('does none of it without Plus: Notes, everything, no folder for what’s new, and nothing kept of where it was left', async () => {
    subscriber.active = false
    setStart({ on: 'last', folder: 'Novel', newIn: 'Novel' })
    localStorage.setItem('nib-left-at', 'chapter')
    await launch()
    await expect.poll(titles).toEqual(expect.arrayContaining(['Groceries', 'Research notes']))
    expect([tab('Notes'), chip('All').getAttribute('aria-pressed'), libraryShowing()]).toEqual(['true', 'true', true])

    await userEvent.click(library().getByRole('button', { name: /New note/ }))
    await expect.poll(() => document.querySelector('.ProseMirror')).toBeTruthy()
    document.querySelector<HTMLElement>('.ProseMirror')!.focus()
    await userEvent.keyboard('Plot twist')
    const made = () => items.listAll().then((all) => all.find((item) => JSON.stringify(item.body).includes('Plot twist')))
    await expect.poll(async () => (await made()) !== undefined, { timeout: 3000 }).toBe(true)
    expect((await made())!.folder).toBeUndefined()
    expect(leftAt()).toBe('chapter')
  })
})
