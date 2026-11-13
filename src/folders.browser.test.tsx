import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import './index.css'
import { App } from './App'
import { db } from './db/db'
import * as items from './db/items'
import { readFolderSettings, replaceFolderSettings } from './lib/folderSettings'
import { removeCategory, removeFolder } from './lib/folders'

/**
 * Folders and categories in the library (lib/folders, components/Places):
 * the row that chooses what the list shows, made in and dropped on
 * (components/cardDrag), and the panel that makes, renames, recolours and
 * removes them.
 */

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const library = () => within(document.querySelector<HTMLElement>('.nib-library')!)
const titles = () => [...document.querySelectorAll('.nib-library [data-id] [data-title]')].map((title) => title.textContent)
const chip = (name: RegExp | string) => within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name })
const show = (name: RegExp) => userEvent.click(chip(name))
// Shown only to a coarse pointer, so found by its text rather than its role.
const openCommands = () => act(async () => [...document.querySelectorAll('button')].find((each) => each.textContent === 'Commands')!.click())
const manage = () => userEvent.click(screen.getByRole('button', { name: 'Edit folders and categories' }))
const card = (id: string) => document.querySelector<HTMLElement>(`[data-id="${id}"] button`)!

let research = ''
let groceries = ''

beforeEach(async () => {
  localStorage.clear()
  replaceFolderSettings({})
  await db.items.clear()
  await page.viewport(1280, 800)
  research = await items.create('note', doc('Research notes'), { folder: 'Novel', categories: [{ name: 'Draft', color: 'blue' }] })
  await items.create('page', doc('Chapter one'), { folder: 'Novel' })
  groceries = await items.create('note', doc('Groceries'))
  await act(async () => void render(<App />))
  await expect.poll(titles).toHaveLength(2)
})

afterEach(async () => {
  cleanup()
  for (const name of ['Novel/Part 1', 'Novel/Part One', 'Book/Part One', 'Novel/Part 2', 'Novel/Letters', 'Letters/Part 1']) await removeFolder(name)
  await removeFolder('Letters')
  await removeFolder('Errands')
  await removeCategory('Weekly')
})

describe('the library’s folders and categories', () => {
  it('lists each with how many are in it, and shows one at a time across both tabs', async () => {
    expect(chip(/^Novel/).textContent).toMatch(/Novel 2$/)
    expect(chip(/^Draft/).textContent).toMatch(/Draft 1$/)
    await show(/^Novel/)
    expect(titles()).toEqual(['Research notes'])
    await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
    await expect.poll(titles).toEqual(['Chapter one'])

    await show(/^All/)
    await userEvent.click(library().getByRole('tab', { name: 'Notes' }))
    await expect.poll(titles).toHaveLength(2)
  })

  it('marks a row with its categories’ colours', async () => {
    const row = document.querySelector(`[data-id="${research}"]`)!
    expect(within(row as HTMLElement).getByRole('img', { name: 'Draft' })).toBeTruthy()
  })

  it('files a note written while a folder is shown in that folder', async () => {
    await show(/Novel/)
    await userEvent.click(library().getByRole('button', { name: /New note/ }))
    await expect.poll(() => document.querySelector('.ProseMirror')).toBeTruthy()
    document.querySelector<HTMLElement>('.ProseMirror')!.focus()
    await userEvent.keyboard('Plot twist')
    await expect.poll(async () => (await items.listAll()).find((item) => JSON.stringify(item.body).includes('Plot twist'))?.folder, { timeout: 3000 }).toBe('Novel')
  })

  it('makes a folder, renames one with the list still showing it, and removes one keeping what was in it', async () => {
    await show(/Novel/)
    await manage()
    await userEvent.fill(screen.getByRole('textbox', { name: 'New folder' }), 'Letters')
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    expect(screen.getByText('Letters')).toBeTruthy()

    const novel = screen.getByText('Novel').parentElement!
    await userEvent.click(within(novel).getByRole('button', { name: 'Rename' }))
    await userEvent.fill(screen.getByRole('textbox', { name: 'New name for Novel' }), 'Book')
    await userEvent.keyboard('{Enter}')
    await expect.poll(async () => (await items.get(research))?.folder).toBe('Book')
    await userEvent.click(screen.getByRole('button', { name: '← Back' }))
    expect(chip(/^Book/).getAttribute('aria-pressed')).toBe('true')
    expect(titles()).toEqual(['Research notes'])

    await manage()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Book' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove?' }))
    await expect.poll(async () => (await items.get(research))?.folder).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '← Back' }))
    // Nothing left to show, so everything is.
    await expect.poll(() => chip('All').getAttribute('aria-pressed')).toBe('true')
    await expect.poll(titles).toHaveLength(2)
  })

  it('won’t make a second of the same name', async () => {
    await manage()
    await userEvent.fill(screen.getByRole('textbox', { name: 'New folder' }), 'novel')
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    expect(screen.getByRole('status').textContent).toBe('There’s already a folder called “novel”.')
  })

  it('makes a category in a colour, and recolours one everywhere', async () => {
    await manage()
    await userEvent.fill(screen.getByRole('textbox', { name: 'New category' }), 'Someday')
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Colour of the new category' })).getByRole('radio', { name: 'Pink' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[1])
    expect(screen.getByText('Someday')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Colour of Draft' }))
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Colour of Draft' })).getByRole('radio', { name: 'Orange' }))
    await expect.poll(async () => (await items.get(research))?.categories).toEqual([{ name: 'Draft', color: 'orange' }])
  })

  it('files the open note from the Commands: a folder, categories, and new ones made there, which stay once emptied', async () => {
    const filed = async () => {
      const item = await items.get(groceries)
      return { folder: item?.folder, categories: item?.categories }
    }
    await userEvent.click(library().getByText('Groceries'))
    await openCommands()
    await userEvent.click(await screen.findByRole('button', { name: /^Move to folder…/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Folder and categories' }))

    await userEvent.click(dialog.getByRole('radio', { name: /Novel/ }))
    await userEvent.click(dialog.getByRole('checkbox', { name: /Draft/ }))
    await expect.poll(filed).toEqual({ folder: 'Novel', categories: [{ name: 'Draft', color: 'blue' }] })
    expect(dialog.getByRole('radio', { name: /Novel/ }).getAttribute('aria-checked')).toBe('true')

    await userEvent.fill(dialog.getByRole('textbox', { name: 'New folder' }), 'Errands')
    await userEvent.click(dialog.getAllByRole('button', { name: 'Add' })[0])
    await userEvent.fill(dialog.getByRole('textbox', { name: 'New category' }), 'Weekly')
    await userEvent.click(dialog.getByRole('radio', { name: 'Green' }))
    await userEvent.click(dialog.getAllByRole('button', { name: 'Add' })[1])
    await expect.poll(filed).toEqual({
      folder: 'Errands',
      categories: [
        { name: 'Draft', color: 'blue' },
        { name: 'Weekly', color: 'green' },
      ],
    })

    await userEvent.click(dialog.getByRole('checkbox', { name: /Draft/ }))
    await userEvent.click(dialog.getByRole('radio', { name: 'No folder' }))
    await expect.poll(filed).toEqual({ folder: null, categories: [{ name: 'Weekly', color: 'green' }] })
    await userEvent.click(dialog.getByRole('checkbox', { name: /Weekly/ }))
    await expect.poll(filed).toEqual({ folder: null, categories: [] })
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    // Made on this device, so still there with nothing in them.
    await userEvent.click(within(document.querySelector('main')!).getByRole('button', { name: 'Notes' }))
    await expect.poll(() => chip(/^Errands/).textContent).toMatch(/Errands 0$/)
    await expect.poll(() => chip(/^Weekly/).textContent).toMatch(/Weekly 0$/)
  })

  // Up to 60 characters, it ran under Commands and pushed the pack and first steps away.
  it('keeps a long folder’s name short beside the way back', async () => {
    const folder = 'A folder with a very long name that runs on and on and on'
    await items.create('note', doc('Filed away'), { folder })
    await userEvent.click(await library().findByText('Filed away'))
    await page.viewport(390, 844)
    const name = await within(document.querySelector('main')!).findByText(folder)
    expect(name.getBoundingClientRect().width).toBeLessThanOrEqual(390 * 0.28 + 1)
    await page.viewport(1280, 800)
  })

  it('makes a folder in the row, and shows it', async () => {
    await userEvent.click(chip('+ New folder'))
    await userEvent.fill(screen.getByRole('textbox', { name: 'New folder' }), 'Letters')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => chip(/^Letters/).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('No notes in Letters yet.')).toBeTruthy()
  })

  it('files a card dropped on a folder, or a category, and opens none of them', async () => {
    await userEvent.dragAndDrop(card(groceries), chip(/^Novel/))
    await expect.poll(async () => (await items.get(groceries))?.folder).toBe('Novel')
    await userEvent.dragAndDrop(card(groceries), chip(/^Draft/))
    await expect.poll(async () => (await items.get(groceries))?.categories).toEqual([{ name: 'Draft', color: 'blue' }])
    expect(document.querySelector<HTMLElement>('.nib-library')!.dataset.open).toBe('true')
  })

  it('puts a card dropped on the Archive away, and only shows the Archive once there is something in it', async () => {
    expect(within(screen.getByRole('group', { name: 'Show' })).queryByRole('button', { name: /^Archive/ })).toBeNull()
    await act(async () => void (await items.setArchived(research, true)))
    await expect.poll(() => chip(/^Archive/).textContent).toMatch(/Archive 1$/)
    await userEvent.dragAndDrop(card(groceries), chip(/^Archive/))
    await expect.poll(async () => typeof (await items.get(groceries))?.archivedAt).toBe('number')
    await expect.poll(() => chip(/^Archive/).textContent).toMatch(/Archive 2$/)
    expect(document.querySelector<HTMLElement>('.nib-library')!.dataset.open).toBe('true')
  })

  it('stays on the Archive when the last one leaves it, and says it is empty', async () => {
    await act(async () => void (await items.setArchived(research, true)))
    await show(/^Archive/)
    await expect.poll(titles).toEqual(['Research notes'])
    await act(async () => void (await items.setArchived(research, false)))
    await expect.poll(titles).toEqual([])
    expect(chip(/^Archive/).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('No notes in the archive yet.')).toBeTruthy()
  })

  it('makes a folder for a card dropped on "+ New folder", with the card in it', async () => {
    await userEvent.dragAndDrop(card(groceries), chip('+ New folder'))
    // Once it has flown in (cardDrag's LANDING_MS).
    await userEvent.fill(await screen.findByRole('textbox', { name: 'New folder' }), 'Errands')
    await userEvent.keyboard('{Enter}')
    await expect.poll(async () => (await items.get(groceries))?.folder).toBe('Errands')
    await expect.poll(titles).toEqual(['Groceries'])
  })
})

describe('a folder inside another', () => {
  const part = () => chip(/^Part 1, in Novel/)

  it('is made from the row with its folder shown, is shown, and takes what’s written while it is', async () => {
    expect(screen.queryByRole('button', { name: '+ Subfolder' })).toBeNull()
    await show(/^Novel/)
    // Its ink line written under it while it's under the pointer, as New folder's is (index.css), asked for 2026-11-13.
    expect(chip('+ Subfolder').querySelector('.nib-new-ink')).not.toBeNull()
    await userEvent.click(chip('+ Subfolder'))
    await userEvent.fill(screen.getByRole('textbox', { name: 'New folder in Novel' }), 'Part 1')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => part().getAttribute('aria-pressed')).toBe('true')
    // Its folder is open round it, and not the one chosen.
    expect(chip(/^Novel/).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('No notes in Novel › Part 1 yet.')).toBeTruthy()

    await userEvent.click(library().getByRole('button', { name: /New note/ }))
    await expect.poll(() => document.querySelector('.ProseMirror')).toBeTruthy()
    document.querySelector<HTMLElement>('.ProseMirror')!.focus()
    await userEvent.keyboard('Opening scene')
    await expect.poll(async () => (await items.listAll()).find((item) => JSON.stringify(item.body).includes('Opening scene'))?.folder, { timeout: 3000 }).toBe('Novel/Part 1')
  })

  it('shows with its folder, counts in it, and shows alone when chosen; its chip is there only while its folder is open', async () => {
    const scene = await items.create('note', doc('Opening scene'), { folder: 'Novel/Part 1' })
    await expect.poll(() => chip(/^Novel/).textContent).toMatch(/Novel 3$/)
    expect(screen.queryByRole('button', { name: /^Part 1, in Novel/ })).toBeNull()
    await show(/^Novel/)
    await expect.poll(titles).toEqual(['Opening scene', 'Research notes'])
    expect(part().textContent).toMatch(/Part 1 1$/)
    // Each card says where it is.
    expect(document.querySelector(`[data-id="${scene}"]`)!.textContent).toContain('Novel › Part 1')

    await userEvent.click(part())
    await expect.poll(titles).toEqual(['Opening scene'])
    await show(/^All/)
    expect(screen.queryByRole('button', { name: /^Part 1, in Novel/ })).toBeNull()
  })

  it('takes a card dropped on it, and is in the list to file a note in, set in under its folder', async () => {
    await items.create('note', doc('Opening scene'), { folder: 'Novel/Part 1' })
    await show(/^Novel/)
    await userEvent.dragAndDrop(card(research), part())
    await expect.poll(async () => (await items.get(research))?.folder).toBe('Novel/Part 1')

    await show(/^All/)
    await userEvent.click(library().getByText('Groceries'))
    await openCommands()
    await userEvent.click(await screen.findByRole('button', { name: /^Move to folder…/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Folder and categories' }))
    const folders = within(dialog.getByRole('radiogroup', { name: 'Folder' }))
    expect(folders.getAllByRole('radio').map((radio) => radio.getAttribute('aria-label') ?? radio.textContent)).toEqual(['No folder', 'Novel', 'Part 1, in Novel'])
    await userEvent.click(dialog.getByRole('radio', { name: 'Part 1, in Novel' }))
    await expect.poll(async () => (await items.get(groceries))?.folder).toBe('Novel/Part 1')
    expect(dialog.getByRole('radio', { name: 'Part 1, in Novel' }).getAttribute('aria-checked')).toBe('true')
    // In it, and not in the folder it's inside as far as this list goes.
    expect(dialog.getByRole('radio', { name: 'Novel' }).getAttribute('aria-checked')).toBe('false')
  })

  it('is renamed by its own name, goes with its folder when that’s renamed, and the list goes on showing it', async () => {
    const scene = await items.create('note', doc('Opening scene'), { folder: 'Novel/Part 1' })
    await show(/^Novel/)
    await userEvent.click(part())
    await manage()
    const row = screen.getByText('Part 1').parentElement!
    await userEvent.click(within(row).getByRole('button', { name: 'Rename' }))
    await userEvent.fill(screen.getByRole('textbox', { name: 'New name for Part 1' }), 'Part One')
    await userEvent.keyboard('{Enter}')
    await expect.poll(async () => (await items.get(scene))?.folder).toBe('Novel/Part One')

    await userEvent.click(within(screen.getByText('Novel').parentElement!).getByRole('button', { name: 'Rename' }))
    await userEvent.fill(screen.getByRole('textbox', { name: 'New name for Novel' }), 'Book')
    await userEvent.keyboard('{Enter}')
    await expect.poll(async () => (await items.get(scene))?.folder).toBe('Book/Part One')
    expect((await items.get(research))?.folder).toBe('Book')
    await userEvent.click(screen.getByRole('button', { name: '← Back' }))
    await expect.poll(() => chip(/^Part One, in Book/).getAttribute('aria-pressed')).toBe('true')
    expect(titles()).toEqual(['Opening scene'])
  })

  it('leaves what’s in it in its folder when it’s removed, and says why a name can’t be taken', async () => {
    const scene = await items.create('note', doc('Opening scene'), { folder: 'Novel/Part 1' })
    await manage()
    await userEvent.click(within(screen.getByText('Novel').parentElement!).getByRole('button', { name: 'Rename' }))
    await userEvent.fill(screen.getByRole('textbox', { name: 'New name for Novel' }), 'Shelf/Novel')
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByText('A folder with folders inside it can’t go inside another.')).toBeTruthy()
    expect((await items.get(scene))?.folder).toBe('Novel/Part 1')

    await userEvent.click(screen.getByRole('button', { name: 'Remove Part 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove?' }))
    await expect.poll(async () => (await items.get(scene))?.folder).toBe('Novel')
  })

  it('is moved into another folder, and out again, from the panel, with what’s in it and the list showing it', async () => {
    const letter = await items.create('note', doc('Dear June'), { folder: 'Letters' })
    await expect.poll(() => screen.queryByRole('button', { name: /^Letters/ })).toBeTruthy()
    await show(/^Letters/)
    await manage()
    // Into the folder right above it, as in an outline: Letters comes first, A to Z, so not till it's moved down under Novel.
    await userEvent.click(screen.getByRole('button', { name: 'Move Letters' }))
    const places = () => within(screen.getByRole('group', { name: 'Move Letters' }))
    expect(places().getAllByRole('button').map((button) => button.textContent)).toEqual(['Up', 'Down'])
    await userEvent.click(places().getByRole('button', { name: 'Move Letters down' }))
    await expect.poll(() => places().getAllByRole('button').map((button) => button.textContent)).toEqual(['Up', 'Down', 'Into Novel'])
    await userEvent.click(places().getByRole('button', { name: 'Into Novel' }))
    await expect.poll(async () => (await items.get(letter))?.folder).toBe('Novel/Letters')
    // Novel has one inside it now, and can't go inside another.
    await expect.poll(() => screen.queryByRole('button', { name: 'Move Novel' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '← Back' }))
    await expect.poll(() => chip(/^Letters, in Novel/).getAttribute('aria-pressed')).toBe('true')
    expect(titles()).toEqual(['Dear June'])

    await manage()
    await userEvent.click(screen.getByRole('button', { name: 'Move Letters' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Move Letters' })).getByRole('button', { name: 'Out of Novel' }))
    await expect.poll(async () => (await items.get(letter))?.folder).toBe('Letters')
    await userEvent.click(screen.getByRole('button', { name: '← Back' }))
    await expect.poll(() => chip(/^Letters/).getAttribute('aria-pressed')).toBe('true')
  })

  it('isn’t moved where there’s one of its name already, and says so', async () => {
    const scene = await items.create('note', doc('Opening scene'), { folder: 'Novel/Part 1' })
    await items.create('note', doc('Spare part'), { folder: 'Part 1' })
    await expect.poll(() => screen.queryByRole('button', { name: /^Part 1/ })).toBeTruthy()
    await manage()
    await userEvent.click(screen.getAllByRole('button', { name: 'Move Part 1' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Out of Novel' }))
    expect(await screen.findByText('There’s already a folder called “Part 1” outside Novel.')).toBeTruthy()
    expect((await items.get(scene))?.folder).toBe('Novel/Part 1')
  })
})

describe('folders in an order of one’s own', () => {
  /** The folders' chips in the row, by name, as they're laid out. */
  const inRow = () => [...document.querySelectorAll<HTMLElement>('[role="group"][aria-label="Show"] [data-drop^="folder:"]')].map((chip) => chip.dataset.drop!.slice('folder:'.length))
  /** The folders' rows in the panel, by the Move each has. */
  const inPanel = () => screen.getAllByRole('button', { name: /^Move [^ ]+$/ }).map((button) => button.getAttribute('aria-label')!.slice('Move '.length))

  it('are A to Z till moved up or down in the panel, then laid out so in the row, the focus staying on the button', async () => {
    await items.create('note', doc('A poem'), { folder: 'Poems' })
    await items.create('note', doc('A post'), { folder: 'Blog' })
    await expect.poll(inRow).toEqual(['Blog', 'Novel', 'Poems'])
    await manage()
    await userEvent.click(screen.getByRole('button', { name: 'Move Poems' }))
    const up = () => screen.getByRole('button', { name: 'Move Poems up' })
    await userEvent.click(up())
    await expect.poll(inPanel).toEqual(['Blog', 'Poems', 'Novel'])
    expect(document.activeElement).toBe(up())
    await userEvent.keyboard('{Enter}')
    await expect.poll(inPanel).toEqual(['Poems', 'Blog', 'Novel'])
    expect(document.activeElement).toBe(up())
    // At the top, Up does nothing, and says so.
    expect(up().getAttribute('aria-disabled')).toBe('true')
    await userEvent.keyboard('{Enter}')
    expect(inPanel()).toEqual(['Poems', 'Blog', 'Novel'])
    expect(document.activeElement).toBe(up())
    // Down keeps the focus too, though its row is the one moved.
    await userEvent.click(screen.getByRole('button', { name: 'Move Poems down' }))
    await expect.poll(inPanel).toEqual(['Blog', 'Poems', 'Novel'])
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Poems down' }))

    await userEvent.click(screen.getByRole('button', { name: '← Back' }))
    await expect.poll(inRow).toEqual(['Blog', 'Poems', 'Novel'])
    // A folder made since goes at the end.
    await items.create('note', doc('Dear June'), { folder: 'Letters' })
    await expect.poll(inRow).toEqual(['Blog', 'Poems', 'Novel', 'Letters'])
  })

  // Seen 2026-11-13: "Into" stayed on the first folder it named while the folder was moved under another.
  it('offers to go into the folder right above, following it up and down', async () => {
    await items.create('note', doc('A poem'), { folder: 'Poems' })
    await items.create('note', doc('A post'), { folder: 'Blog' })
    await expect.poll(inRow).toEqual(['Blog', 'Novel', 'Poems'])
    await manage()
    await userEvent.click(screen.getByRole('button', { name: 'Move Poems' }))
    const intos = () => within(screen.getByRole('group', { name: 'Move Poems' })).queryAllByRole('button', { name: /^Into / }).map((button) => button.textContent)
    expect(intos()).toEqual(['Into Novel'])
    await userEvent.click(screen.getByRole('button', { name: 'Move Poems up' }))
    await expect.poll(intos).toEqual(['Into Blog'])
    await userEvent.click(screen.getByRole('button', { name: 'Move Poems up' }))
    await expect.poll(intos).toEqual([])
  })

  it('takes a chip moved along the row, without showing its folder, and keeps the order', async () => {
    await items.create('note', doc('A poem'), { folder: 'Poems' })
    await items.create('note', doc('A post'), { folder: 'Blog' })
    await expect.poll(inRow).toEqual(['Blog', 'Novel', 'Poems'])
    // Let go on the first half of Blog's chip: before it.
    await userEvent.dragAndDrop(chip(/^Poems/), chip(/^Blog/), { targetPosition: { x: 4, y: 8 } })
    await expect.poll(inRow).toEqual(['Poems', 'Blog', 'Novel'])
    // Let go, it settles as a folder takes a card dropped in it (index.css chipGulp), asked for 2026-11-13.
    await expect.poll(() => chip(/^Poems/).hasAttribute('data-landed')).toBe(true)
    expect(chip(/^Poems/).getAttribute('aria-pressed')).toBe('false')
    expect(chip(/^All/).getAttribute('aria-pressed')).toBe('true')
    expect(chip(/^Poems/).dataset.held).toBeUndefined()
    // On the last half of Novel's: after it. And the panel has it so too.
    await userEvent.dragAndDrop(chip(/^Blog/), chip(/^Novel/), { targetPosition: { x: chip(/^Novel/).offsetWidth - 4, y: 8 } })
    await expect.poll(inRow).toEqual(['Poems', 'Novel', 'Blog'])
    await manage()
    expect(inPanel()).toEqual(['Poems', 'Novel', 'Blog'])
  })

  it('moves a subfolder’s chip only among those inside the same folder', async () => {
    await items.create('note', doc('Opening'), { folder: 'Novel/Part 1' })
    await items.create('note', doc('Ending'), { folder: 'Novel/Part 2' })
    await items.create('note', doc('A post'), { folder: 'Blog' })
    await show(/^Novel/)
    await expect.poll(inRow).toEqual(['Blog', 'Novel', 'Novel/Part 1', 'Novel/Part 2'])
    // Over Blog's chip, at the far left: still after Novel, the one it's in.
    await userEvent.dragAndDrop(chip(/^Part 2/), chip(/^Blog/), { targetPosition: { x: 4, y: 8 } })
    await expect.poll(inRow).toEqual(['Blog', 'Novel', 'Novel/Part 2', 'Novel/Part 1'])
    expect(chip(/^Novel/).getAttribute('aria-pressed')).toBe('true')
  })

  it('sorts a folder its own way from the sort button, the folders in it too, and leaves All as it was', async () => {
    const sortButton = () => library().getByRole('button', { name: /^(Recent|Created|A–Z)$/ })
    await items.create('note', doc('Zebra'), { folder: 'Novel' })
    await items.create('note', doc('Apple'), { folder: 'Novel' })
    await items.create('note', doc('Bee'), { folder: 'Novel/Part 1' })
    await items.create('note', doc('Ant'), { folder: 'Novel/Part 1' })
    await show(/^Novel/)
    await expect.poll(titles).toEqual(['Ant', 'Bee', 'Apple', 'Zebra', 'Research notes'])
    expect(sortButton().textContent).toBe('Recent')
    await userEvent.click(sortButton())
    await userEvent.click(sortButton())
    expect(sortButton().textContent).toBe('A–Z')
    await expect.poll(titles).toEqual(['Ant', 'Apple', 'Bee', 'Research notes', 'Zebra'])

    // All keeps the library's.
    await show(/^All/)
    expect(sortButton().textContent).toBe('Recent')
    await expect.poll(titles).toEqual(['Ant', 'Bee', 'Apple', 'Zebra', 'Groceries', 'Research notes'])
    // A folder inside Novel sorts as Novel does.
    await show(/^Novel/)
    await show(/^Part 1/)
    expect(sortButton().textContent).toBe('A–Z')
    await expect.poll(titles).toEqual(['Ant', 'Bee'])
    expect(readFolderSettings().novel.sort).toBe('title')
  })

  it('moves a folder among those inside the same one, and keeps the order once it’s renamed', async () => {
    await items.create('note', doc('Opening'), { folder: 'Novel/Part 1' })
    await items.create('note', doc('Ending'), { folder: 'Novel/Part 2' })
    await show(/^Novel/)
    await expect.poll(inRow).toEqual(['Novel', 'Novel/Part 1', 'Novel/Part 2'])
    await manage()
    await userEvent.click(screen.getByRole('button', { name: 'Move Part 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move Part 2 up' }))
    await userEvent.click(screen.getByRole('button', { name: '← Back' }))
    await expect.poll(inRow).toEqual(['Novel', 'Novel/Part 2', 'Novel/Part 1'])
  })
})
