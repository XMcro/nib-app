import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import './index.css'
import { App } from './App'
import { db, type Item } from './db/db'
import * as items from './db/items'
import { makeCategory, makeFolder, removeCategory, removeFolder } from './lib/folders'

/** The library's select mode: marking cards, and doing one thing to all of them. */

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const library = () => within(document.querySelector<HTMLElement>('.nib-library')!)
const row = () => within(screen.getByRole('group', { name: 'Show' }))
const titles = () => [...document.querySelectorAll('.nib-library [data-title]')].map((title) => title.textContent)
const card = (id: string) => document.querySelector<HTMLElement>(`.nib-library [data-id="${id}"] > button`)!
const press = (name: string | RegExp) => userEvent.click(library().getByRole('button', { name }))
const stored = async (id: string) => (await db.items.get(id)) as Item
const marked = () => [...document.querySelectorAll('.nib-library [aria-pressed="true"][class*="min-h"]')].length

const NO_LIBRARY = { folders: [], categories: [] }

let one = ''
let two = ''
let three = ''

beforeEach(async () => {
  localStorage.clear()
  await db.items.clear()
  await page.viewport(1280, 800)
  one = await items.create('note', doc('One'))
  two = await items.create('note', doc('Two'))
  three = await items.create('note', doc('Three'))
  await act(async () => void render(<App />))
  await expect.poll(titles).toHaveLength(3)
})

afterEach(() => cleanup())

describe('selecting', () => {
  it('marks a card instead of opening it, counts them, and goes back to opening when done', async () => {
    await press('Select')
    await userEvent.click(card(one))
    expect(card(one).getAttribute('aria-pressed')).toBe('true')
    expect(card(two).getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector<HTMLElement>('.nib-library')!.dataset.open).toBe('true')
    expect(screen.getByRole('status').textContent).toBe('1 selected')
    await userEvent.click(card(two))
    expect(screen.getByRole('status').textContent).toBe('2 selected')
    await userEvent.click(card(one))
    expect(screen.getByRole('status').textContent).toBe('1 selected')
    expect(card(one).getAttribute('aria-pressed')).toBe('false')

    await press('Done')
    expect(card(two).hasAttribute('aria-pressed')).toBe(false)
    expect(library().queryByRole('button', { name: 'Done' })).toBeNull()
    await userEvent.click(card(two))
    await expect.poll(() => document.querySelector<HTMLElement>('.nib-library')!.dataset.open).toBe('false')
  })

  it('takes away each card’s pin and trash while selecting, and offers nothing with none marked', async () => {
    await press('Select')
    expect(library().queryByRole('button', { name: /^Pin One/ })).toBeNull()
    expect(library().queryByRole('button', { name: /to trash$/ })).toBeNull()
    for (const name of ['Pin', 'Move…', 'Archive', 'Trash']) expect(library().getByRole('button', { name }).hasAttribute('disabled')).toBe(true)
  })

  it('picks up no card to drag while selecting', async () => {
    await act(async () => void makeFolder('Novel', NO_LIBRARY))
    await press('Select')
    await expect.poll(() => row().queryByRole('button', { name: /^Novel/ })).not.toBeNull()
    await userEvent.dragAndDrop(card(one), row().getByRole('button', { name: /^Novel/ }))
    // Once it would have flown in (cardDrag's LANDING_MS).
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect((await stored(one)).folder).toBeUndefined()
    await act(async () => void removeFolder('Novel'))
  })

  it('selects all that are showing, and none again', async () => {
    await press('Select')
    await press('Select all')
    expect(screen.getByRole('status').textContent).toBe('3 selected')
    expect(marked()).toBe(3)
    await press('Select none')
    expect(screen.getByRole('status').textContent).toBe('0 selected')
  })

  it('keeps what was marked when a search narrows the list, and Select all adds only what shows', async () => {
    await press('Select')
    await userEvent.click(card(one))
    await userEvent.fill(library().getByRole('textbox', { name: 'Search' }), 'Two')
    await expect.poll(titles).toEqual(['Two'])
    await press('Select all')
    expect(screen.getByRole('status').textContent).toBe('2 selected')
    await press('Trash')
    await expect.poll(async () => (await stored(one)).deletedAt).toBeTypeOf('number')
    expect((await stored(two)).deletedAt).toBeTypeOf('number')
    expect((await stored(three)).deletedAt).toBeUndefined()
    expect(library().queryByRole('button', { name: 'Done' })).toBeNull()
  })

  it('stops counting one that goes from this device while it’s marked', async () => {
    await press('Select')
    await press('Select all')
    await act(async () => void (await items.remove(one)))
    await expect.poll(() => screen.getByRole('status').textContent).toBe('2 selected')
  })

  it('reaches cards too far down to be drawn', async () => {
    const many = await Promise.all(Array.from({ length: 300 }, (_, n) => items.create('note', doc(`Note ${n}`))))
    await expect.poll(titles).not.toHaveLength(3)
    await press('Select')
    await press('Select all')
    expect(screen.getByRole('status').textContent).toBe('303 selected')
    await press('Archive')
    await expect.poll(async () => (await db.items.toArray()).filter((item) => typeof item.archivedAt === 'number').length, { timeout: 5000 }).toBe(303)
    expect(typeof (await stored(many[299])).archivedAt).toBe('number')
  })
})

describe('doing it to all of them', () => {
  async function mark(...ids: string[]) {
    await press('Select')
    for (const id of ids) await userEvent.click(card(id))
  }

  it('pins them, and leaves select mode', async () => {
    await mark(one, two)
    await press('Pin')
    await expect.poll(async () => (await stored(one)).pinnedAt).toBeTypeOf('number')
    expect((await stored(two)).pinnedAt).toBeTypeOf('number')
    expect((await stored(three)).pinnedAt).toBeUndefined()
    expect(library().queryByRole('button', { name: 'Done' })).toBeNull()
  })

  it('unpins them when they’re all pinned, and pins them all when only some are', async () => {
    await act(async () => void (await items.setPinned([one, two], true)))
    await expect.poll(() => card(one).closest('[data-id]')!.querySelector('[data-pinned]')).not.toBeNull()
    await mark(one, two)
    await press('Unpin')
    await expect.poll(async () => (await stored(one)).pinnedAt).toBeUndefined()

    await act(async () => void (await items.setPinned(one, true)))
    await expect.poll(() => card(one).closest('[data-id]')!.querySelector('[data-pinned]')).not.toBeNull()
    await mark(one, two)
    await press('Pin')
    await expect.poll(async () => (await stored(two)).pinnedAt).toBeTypeOf('number')
    expect((await stored(one)).pinnedAt).toBeTypeOf('number')
  })

  it('puts them in the archive, and takes them out from there', async () => {
    await mark(one, two)
    await press('Archive')
    await expect.poll(titles).toEqual(['Three'])
    await userEvent.click(row().getByRole('button', { name: /^Archive/ }))
    await expect.poll(titles).toHaveLength(2)
    await press('Select')
    await press('Select all')
    await press('Take out')
    await expect.poll(async () => (await stored(one)).archivedAt).toBeNull()
    expect((await stored(two)).archivedAt).toBeNull()
  })

  it('moves them to the trash, the one that’s open too, with what was typed in it', async () => {
    await userEvent.click(card(one))
    await expect.poll(() => document.querySelector('main .ProseMirror')?.textContent).toBe('One')
    await act(async () => void document.querySelector<HTMLElement>('main .ProseMirror')!.focus())
    await userEvent.keyboard('{End} more')
    await userEvent.click(within(document.querySelector('main')!).getByRole('button', { name: 'Notes' }))
    await expect.poll(() => document.querySelector<HTMLElement>('.nib-library')!.dataset.open, { timeout: 3000 }).toBe('true')
    await mark(one, two)
    await press('Trash')
    await expect.poll(async () => (await stored(one)).deletedAt).toBeTypeOf('number')
    expect((await stored(two)).deletedAt).toBeTypeOf('number')
    expect(JSON.stringify((await stored(one)).body)).toContain('more')
    await expect.poll(() => document.querySelector('main .ProseMirror')?.textContent ?? '').toBe('')
  })

  it('files them all in a folder and a category from the one dialog, and shows only what they share', async () => {
    await act(async () => {
      makeFolder('Novel', NO_LIBRARY)
      makeCategory('Draft', 'blue', NO_LIBRARY)
    })
    await act(async () => void (await items.setFolder(one, 'Novel')))
    await act(async () => void (await items.fileInCategory([one], { name: 'Draft', color: 'blue' }, true)))
    await mark(one, two)
    await press('Move…')
    const dialog = within(await screen.findByRole('dialog', { name: 'Folder and categories' }))
    const folder = dialog.getByRole('radio', { name: 'Novel' })
    const category = dialog.getByRole('checkbox', { name: /Draft/ })
    expect(folder.getAttribute('aria-checked')).toBe('false')
    expect(dialog.getByRole('radio', { name: 'No folder' }).getAttribute('aria-checked')).toBe('false')
    expect(category.getAttribute('aria-checked')).toBe('false')

    await userEvent.click(folder)
    await expect.poll(async () => (await stored(two)).folder).toBe('Novel')
    await expect.poll(() => folder.getAttribute('aria-checked')).toBe('true')
    await userEvent.click(category)
    await expect.poll(async () => (await stored(two)).categories?.map((had) => had.name)).toEqual(['Draft'])
    expect((await stored(one)).categories?.map((had) => had.name)).toEqual(['Draft'])
    await expect.poll(() => category.getAttribute('aria-checked')).toBe('true')
    await userEvent.click(category)
    await expect.poll(async () => (await stored(one)).categories).toEqual([])
    expect((await stored(two)).categories).toEqual([])
    expect((await stored(three)).folder).toBeUndefined()

    // Whichever of them has it, the others are given it.
    for (const id of [one, two]) {
      await act(async () => void (await items.fileInCategory([id], { name: 'Draft', color: 'blue' }, true)))
      await userEvent.click(category)
      await expect.poll(async () => [(await stored(one)).categories?.length, (await stored(two)).categories?.length]).toEqual([1, 1])
      await userEvent.click(category)
      await expect.poll(async () => [(await stored(one)).categories?.length, (await stored(two)).categories?.length]).toEqual([0, 0])
    }

    await userEvent.click(dialog.getByRole('radio', { name: 'No folder' }))
    await expect.poll(async () => [(await stored(one)).folder, (await stored(two)).folder]).toEqual([null, null])

    await userEvent.click(dialog.getByRole('button', { name: 'Done' }))
    expect(library().queryByRole('button', { name: 'Select all' })).toBeNull()
    await act(async () => {
      removeFolder('Novel')
      removeCategory('Draft')
    })
  })
})

describe('with the vault shut', () => {
  const lockedOne = async () => {
    // `rev` moved, as every write moves it (db/items `nextRev`): a row with it unmoved is kept as it was (items.keepSame).
    await db.items.update(one, { vault: { v: 1, iv: 'a', data: 'b' } as never, rev: items.nextRev(await items.get(one)) })
  }

  it('leaves a locked note out of Move, and says so', async () => {
    await lockedOne()
    await expect.poll(() => card(one).querySelector('[aria-label="Locked"]')).not.toBeNull()
    await press('Select')
    await userEvent.click(card(one))
    expect(library().getByRole('button', { name: 'Move…' }).hasAttribute('disabled')).toBe(true)
    await userEvent.click(card(two))
    await press('Move…')
    const dialog = within(await screen.findByRole('dialog', { name: 'Folder and categories' }))
    expect(dialog.getByText('Locked notes stay where they are while the vault is shut.')).toBeTruthy()
    await userEvent.click(dialog.getByRole('radio', { name: 'No folder' }))
    await vi.waitFor(async () => expect((await stored(two)).folder).toBeNull())
    expect((await stored(one)).folder).toBeUndefined()
  })
})
