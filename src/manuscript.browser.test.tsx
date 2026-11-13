import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { chaptersOf } from './lib/manuscript'
import { titleOf } from './lib/text'
import { App } from './App'

/**
 * The manuscript (components/ManuscriptPanel): a folder's pages as chapters,
 * in the order the writer drags them into, from the library's Pages.
 */

const doc = (title: string, text: string) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: title }] },
    { type: 'paragraph', content: [{ type: 'text', text }] },
  ],
})
const libraryEl = () => document.querySelector<HTMLElement>('.nib-library')!
const library = () => within(libraryEl())
const writing = () => within(document.querySelector('main')!)
/** The chapters as the screen lists them, by their handles' names. */
const listed = () => library().queryAllByRole('button', { name: /^Move / }).map((handle) => handle.getAttribute('aria-label')!.slice('Move '.length))
/** The chapters as stored. */
const stored = async () => chaptersOf(await items.listAll(), 'Novel').map((item) => titleOf(item.body))

beforeEach(async () => {
  localStorage.clear()
  await db.items.clear()
  await page.viewport(1280, 800)
  const two = await items.create('page', doc('Chapter two', 'It had been a long season.'), { folder: 'Novel' })
  const one = await items.create('page', doc('Chapter one', 'The boats came in late.'), { folder: 'Novel' })
  await items.setPositions([
    { id: one, position: 1 },
    { id: two, position: 2 },
  ])
  // New to the folder, with no place yet: last.
  await items.create('page', doc('Epilogue', 'She never said.'), { folder: 'Novel' })
  await items.create('note', doc('Research notes', 'Tides, boats, the quay.'), { folder: 'Novel' })
  await items.create('page', doc('Elsewhere', 'Not in the book.'), { folder: 'Poems' })
})
afterEach(cleanup)

async function openManuscript() {
  await act(async () => void render(<App />))
  await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
  await userEvent.click(await library().findByRole('button', { name: /^Novel/ }))
  await userEvent.click(await library().findByRole('button', { name: 'Manuscript' }))
  await expect.poll(listed).toHaveLength(3)
}

describe('a manuscript', () => {
  it('is there for a folder’s pages, not for everything or for notes', async () => {
    await act(async () => void render(<App />))
    await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
    await expect.poll(() => library().queryAllByText(/Chapter/).length).toBeGreaterThan(0)
    expect(library().queryByRole('button', { name: 'Manuscript' })).toBeNull()

    await userEvent.click(library().getByRole('button', { name: /^Novel/ }))
    expect(await library().findByRole('button', { name: 'Manuscript' })).toBeTruthy()

    await userEvent.click(library().getByRole('tab', { name: 'Notes' }))
    await expect.poll(() => library().queryByRole('button', { name: 'Manuscript' })).toBeNull()
  })

  it('lists the folder’s pages as chapters, in book order, with their words and the book’s', async () => {
    await openManuscript()
    expect(listed()).toEqual(['Chapter one', 'Chapter two', 'Epilogue'])
    expect(library().getByText('3 chapters · 19 words')).toBeTruthy()
    expect(library().getByText('7 words')).toBeTruthy()
    expect(library().queryByText('Research notes')).toBeNull()
    expect(library().queryByText('Elsewhere')).toBeNull()
  })

  it('moves a chapter dragged by its handle, and keeps the new order', async () => {
    await openManuscript()
    await userEvent.dragAndDrop(
      library().getByRole('button', { name: 'Move Epilogue' }),
      library().getByRole('button', { name: 'Move Chapter one' }),
    )
    await expect.poll(listed).toEqual(['Epilogue', 'Chapter one', 'Chapter two'])
    await expect.poll(stored).toEqual(['Epilogue', 'Chapter one', 'Chapter two'])
  })

  it('moves a chapter with the arrow keys on its handle', async () => {
    await openManuscript()
    library().getByRole('button', { name: 'Move Chapter one' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.poll(stored).toEqual(['Chapter two', 'Chapter one', 'Epilogue'])
    expect(listed()).toEqual(['Chapter two', 'Chapter one', 'Epilogue'])
    // Still in hand, for the next press.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Move Chapter one')
    await userEvent.keyboard('{ArrowDown}')
    await expect.poll(stored).toEqual(['Chapter two', 'Epilogue', 'Chapter one'])
  })

  it('opens a chapter, and is there again on the way back', async () => {
    await openManuscript()
    await userEvent.click(library().getByRole('button', { name: /^2 Chapter two/ }))
    await expect.poll(() => libraryEl().dataset.open).toBe('false')
    await expect.poll(() => document.querySelector('.ProseMirror')?.textContent).toContain('Chapter two')

    await userEvent.click(writing().getByRole('button', { name: 'Pages' }))
    await expect.poll(() => libraryEl().dataset.open).toBe('true')
    expect(library().getByText('3 chapters · 19 words')).toBeTruthy()
  })
})
describe('a manuscript with folders inside its folder', () => {
  const partOne = async () => chaptersOf(await items.listAll(), 'Novel/Part 1').map((item) => titleOf(item.body))

  beforeEach(async () => {
    const storm = await items.create('page', doc('The storm', 'It broke at noon.'), { folder: 'Novel/Part 1' })
    const calm = await items.create('page', doc('The calm', 'Nothing moved.'), { folder: 'Novel/Part 1' })
    await items.setPositions([
      { id: calm, position: 1 },
      { id: storm, position: 2 },
    ])
    await items.create('page', doc('Landfall', 'They saw the light.'), { folder: 'Novel/Part 2' })
  })

  it('has them as its parts: after its own pages, each under its name, numbered through the book', async () => {
    await act(async () => void render(<App />))
    await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
    await userEvent.click(await library().findByRole('button', { name: /^Novel/ }))
    await userEvent.click(await library().findByRole('button', { name: 'Manuscript' }))
    await expect.poll(listed).toEqual(['Chapter one', 'Chapter two', 'Epilogue', 'The calm', 'The storm', 'Landfall'])
    expect(library().getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Part 1', 'Part 2'])
    expect(library().getAllByRole('list').map((list) => list.getAttribute('aria-label'))).toEqual(['Chapters', 'Chapters of Part 1', 'Chapters of Part 2'])
    expect(library().getByText(/^6 chapters · /)).toBeTruthy()
    const numbers = [...libraryEl().querySelectorAll('[data-chapter] .tabular-nums:first-child')].map((number) => number.textContent)
    expect(numbers).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('moves a chapter within its part, and not out of it', async () => {
    await act(async () => void render(<App />))
    await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
    await userEvent.click(await library().findByRole('button', { name: /^Novel/ }))
    await userEvent.click(await library().findByRole('button', { name: 'Manuscript' }))
    await expect.poll(listed).toHaveLength(6)
    library().getByRole('button', { name: 'Move The calm' }).focus()
    // The first of its part: there's nowhere up for it to go, and the book's own last chapter stays where it is.
    await userEvent.keyboard('{ArrowUp}')
    expect(listed()).toEqual(['Chapter one', 'Chapter two', 'Epilogue', 'The calm', 'The storm', 'Landfall'])
    await userEvent.keyboard('{ArrowDown}')
    await expect.poll(partOne).toEqual(['The storm', 'The calm'])
    expect(listed()).toEqual(['Chapter one', 'Chapter two', 'Epilogue', 'The storm', 'The calm', 'Landfall'])
    // The last of its part now: no further down, into the next.
    await userEvent.keyboard('{ArrowDown}')
    expect(listed()).toEqual(['Chapter one', 'Chapter two', 'Epilogue', 'The storm', 'The calm', 'Landfall'])
    expect(await stored()).toEqual(['Chapter one', 'Chapter two', 'Epilogue'])
  })

  it('is its own book for a folder inside another, named for both', async () => {
    await act(async () => void render(<App />))
    await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
    await userEvent.click(await library().findByRole('button', { name: /^Novel/ }))
    await userEvent.click(await library().findByRole('button', { name: /^Part 1, in Novel/ }))
    await userEvent.click(await library().findByRole('button', { name: 'Manuscript' }))
    await expect.poll(listed).toEqual(['The calm', 'The storm'])
    expect(library().getByRole('heading', { level: 2 }).textContent).toBe('Novel › Part 1')
    expect(library().queryAllByRole('heading', { level: 3 })).toEqual([])
  })

  it('is there for a folder whose pages are all in the folders inside it', async () => {
    await items.create('page', doc('Only here', 'In a part.'), { folder: 'Atlas/North' })
    await act(async () => void render(<App />))
    await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
    await userEvent.click(await library().findByRole('button', { name: /^Atlas/ }))
    await userEvent.click(await library().findByRole('button', { name: 'Manuscript' }))
    await expect.poll(listed).toEqual(['Only here'])
    expect(library().getAllByRole('list').map((list) => list.getAttribute('aria-label'))).toEqual(['Chapters of North'])
  })
})
