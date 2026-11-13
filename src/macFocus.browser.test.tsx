import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import { foldsOf, keepFolds } from './lib/folds'
import { readCalendar } from './lib/goal'
import { localDay } from './lib/time'
import * as vault from './lib/vault'

/**
 * The Mac app is the app, but with a keyboard: focus raises nothing, so a new
 * note has the cursor ready, as in a browser (nativeFocus covers iPhone and
 * iPad). The shortcut hints are the Mac's own: ⌘N, which its menu owns, and
 * ⌃⌘S for the library, since 1Password takes ⌘\ on a Mac.
 */

vi.mock('./lib/platform', async (importOriginal) => {
  const real = await importOriginal<typeof import('./lib/platform')>()
  return { ...real, nativeApp: true, macApp: true, touchApp: false, NEW_NOTE_SHORTCUT: real.shortcut('N'), LIBRARY_SHORTCUT: '⌃⌘S' }
})

const { App } = await import('./App')
const editorFocused = () => document.activeElement?.closest('.ProseMirror') != null
const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)))

// The welcome, already seen: it takes the focus this file is about. And no
// writing left by another file, so the library is empty and offers ⌘N.
beforeEach(async () => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  localStorage.setItem('nib-device-asked', '1')
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  await db.items.clear()
})
afterEach(() => void vi.useRealTimers())
afterEach(cleanup)

describe('in the Mac app', () => {
  it('has the cursor ready in a new note, and offers ⌘N for one', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    expect(await screen.findByText(/⌘N\s+new note/)).toBeTruthy()

    await act(async () => screen.getByRole('button', { name: /New note/ }).click())
    await expect.poll(editorFocused).toBe(true)
  })

  it('runs menu bar choices as the matching commands', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    await act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id: 'palette' })))
    expect(screen.getByPlaceholderText(/Type a command/)).toBeTruthy()
    // The library's hint in the palette is the Mac's.
    expect(screen.getByText('⌃⌘S')).toBeTruthy()
    expect(screen.queryByText('⌘\\')).toBeNull()
    // ⌘K is the menu's on the Mac, so the menu has to close it too.
    await act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id: 'palette' })))
    expect(screen.queryByPlaceholderText(/Type a command/)).toBeNull()
  })

  // ⌘N from the library opened the note under it, unseen.
  it.each([
    ['new-note', ''],
    ['new-page', '.nib-editor-page'],
  ])('puts the library away for File → %s', async (id, editor) => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    await act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id })))
    await expect.poll(() => document.querySelector<HTMLElement>('.nib-library')!.dataset.open).toBe('false')
    await expect.poll(() => document.querySelector(`main .ProseMirror${editor}`)).not.toBeNull()
  })

  // Search All Notes in focus mode brought up nothing: the library stayed out of reach.
  it('searches all notes from focus mode, in the box the library shows', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    const menu = (id: string) => act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id })))
    await menu('focus')
    await expect.poll(() => document.querySelector<HTMLElement>('.nib-library')!.dataset.open).toBe('false')
    await menu('search')
    await expect.poll(() => document.querySelector<HTMLElement>('.nib-library')!.dataset.open).toBe('true')
    await expect.poll(() => document.activeElement?.hasAttribute('data-search')).toBe(true)
  })

  it('finds in the document on screen, and in the library while that is what shows', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    const menu = (id: string) => act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id })))
    await menu('find')
    await expect.poll(() => document.activeElement?.hasAttribute('data-search')).toBe(true)
    expect(screen.queryByLabelText('Find in this document')).toBeNull()
    await menu('new-note')
    await expect.poll(() => document.querySelector<HTMLElement>('.nib-library')!.dataset.open).toBe('false')
    await expect.poll(() => document.querySelector('main .ProseMirror')).not.toBeNull()
    // The new note's own focus is a frame behind it (Editor, "cursor ready"), and would take this one's back.
    await act(async () => void (await new Promise(requestAnimationFrame)))
    await act(async () => void (await new Promise(requestAnimationFrame)))
    await menu('find')
    await expect.poll(() => document.activeElement === screen.queryByLabelText('Find in this document')).toBe(true)
    expect(document.querySelector<HTMLElement>('.nib-library')!.dataset.open).toBe('false')
  })

  it('saves what it replaces, with the replace row clear of the first line', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    const menu = (id: string) => act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id })))
    await menu('new-note')
    await expect.poll(() => document.querySelector('main .ProseMirror')).not.toBeNull()
    const writing = document.querySelector<HTMLElement>('main .ProseMirror')!
    await act(async () => void writing.focus())
    await userEvent.keyboard('The lamp and the lamp.')
    await expect.poll(() => db.items.count(), { timeout: 5000 }).toBe(1)
    await menu('find')
    await expect.poll(() => document.activeElement === screen.queryByLabelText('Find in this document')).toBe(true)
    await userEvent.keyboard('lamp')
    await expect.poll(() => screen.getByRole('status').textContent).toBe('1 of 2')
    await userEvent.click(screen.getByRole('button', { name: 'Show replace' }))
    await userEvent.keyboard('torch')
    const bar = screen.getByRole('search').getBoundingClientRect()
    expect(writing.querySelector('p')!.getBoundingClientRect().top).toBeGreaterThanOrEqual(bar.bottom)
    await userEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    await expect.poll(async () => JSON.stringify((await db.items.toArray())[0].body), { timeout: 5000 }).toContain('The torch and the torch.')
  })

  it('moves a note to the archive, out of the lists and search, and back', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    const menu = (id: string) => act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id })))
    const command = async (name: RegExp) => {
      await menu('palette')
      await userEvent.click(await screen.findByRole('button', { name }))
    }
    const cards = () => document.querySelectorAll('.nib-library [data-id]').length
    const search = () => document.querySelector<HTMLInputElement>('input[data-search]')!
    await menu('new-note')
    await expect.poll(() => document.querySelector('main .ProseMirror')).not.toBeNull()
    await act(async () => void document.querySelector<HTMLElement>('main .ProseMirror')!.focus())
    await userEvent.keyboard('Old lighthouse log.')
    await expect.poll(() => db.items.count(), { timeout: 5000 }).toBe(1)
    const today = () => readCalendar()[localDay(Date.now())]
    await expect.poll(today).toBe(3)

    await command(/^Move to the archive/)
    await expect.poll(async () => typeof (await db.items.toArray())[0].archivedAt).toBe('number')
    await expect.poll(() => document.querySelector<HTMLElement>('.nib-library')!.dataset.open).toBe('true')
    await expect.poll(cards).toBe(0)
    expect(today()).toBe(3)

    await userEvent.fill(search(), 'lighthouse')
    await expect.poll(() => document.body.textContent).toMatch(/No matches/)
    await userEvent.fill(search(), '')

    await menu('palette')
    await userEvent.keyboard('lighthouse')
    await expect.poll(() => screen.queryByRole('button', { name: /^Focus mode/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /lighthouse/i })).toBeNull()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: /^Archive/ }))
    await expect.poll(cards).toBe(1)
    await userEvent.fill(search(), 'lighthouse')
    await expect.poll(cards).toBe(1)
    await userEvent.fill(search(), '')

    await userEvent.click(document.querySelector<HTMLElement>('.nib-library [data-id] > button')!)
    await expect.poll(() => document.querySelector<HTMLElement>('.nib-library')!.dataset.open).toBe('false')
    await expect.poll(() => document.body.textContent).toMatch(/Archived/)
    await command(/^Take out of the archive/)
    await expect.poll(async () => (await db.items.toArray())[0].archivedAt).toBeNull()
  })

  it('follows a link to an archived note, which keeps its name', async () => {
    const now = Date.now()
    const para = (content: object) => ({ type: 'doc', content: [{ type: 'paragraph', content: [content] }] })
    await db.items.bulkAdd([
      { id: 'here', kind: 'note', version: 1, createdAt: now, updatedAt: now, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'noteLink', attrs: { id: 'away', title: 'Old name' } }] }] } },
      { id: 'away', kind: 'note', version: 1, createdAt: now, updatedAt: now, archivedAt: now, body: para({ type: 'text', text: 'Kept away' }) },
    ])
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    await userEvent.click(await vi.waitFor(() => document.querySelector<HTMLElement>('.nib-library [data-id="here"] > button')!))
    const link = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('main [data-note-link="away"]')
      expect(found).not.toBeNull()
      return found!
    })
    await expect.poll(() => link.textContent).toBe('Kept away')
    expect(link.hasAttribute('data-missing')).toBe(false)
    await userEvent.click(link)
    await expect.poll(() => document.querySelector('main .ProseMirror')!.textContent).toBe('Kept away')
  })

  it('follows a link to one line of a note, which opens with that line shown', async () => {
    const now = Date.now()
    const line = (text: string, blockId?: string) => ({ type: 'paragraph', ...(blockId && { attrs: { blockId } }), content: [{ type: 'text', text }] })
    await db.items.bulkAdd([
      { id: 'here', kind: 'note', version: 1, createdAt: now, updatedAt: now, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'noteLink', attrs: { id: 'away', title: 'Timetable', block: 'abcd1234', part: 'The last boat' } }] }] } },
      { id: 'away', kind: 'note', version: 1, createdAt: now, updatedAt: now - 1, body: { type: 'doc', content: [line('Timetable'), ...Array.from({ length: 80 }, (_, i) => line(`Boat ${i + 1} leaves on the hour.`, i === 69 ? 'abcd1234' : undefined))] } },
    ])
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    await userEvent.click(await vi.waitFor(() => document.querySelector<HTMLElement>('.nib-library [data-id="here"] > button')!))
    const link = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('main [data-note-link="away"]')
      expect(found).not.toBeNull()
      return found!
    })
    await expect.poll(() => link.textContent).toBe('Timetable › Boat 70 leaves on the hour.')
    await userEvent.click(link)
    const arrived = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('main .ProseMirror .nib-arrived')
      expect(found).not.toBeNull()
      return found!
    })
    expect(arrived.textContent).toBe('Boat 70 leaves on the hour.')
    // Far down the note, and in sight.
    await vi.waitFor(() => {
      const box = arrived.getBoundingClientRect()
      expect(box.top).toBeGreaterThan(0)
      expect(box.bottom).toBeLessThan(window.innerHeight)
    })
    // Nothing is written by following it.
    expect((await db.items.get('away'))!.version).toBe(1)
  })

  it('opens what was folded over the line a link goes to, and leaves the other folds shut', async () => {
    onTestFinished(() => localStorage.removeItem('nib-folds'))
    const now = Date.now()
    const line = (text: string, blockId?: string) => ({ type: 'paragraph', ...(blockId && { attrs: { blockId } }), content: [{ type: 'text', text }] })
    const heading = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
    await db.items.bulkAdd([
      { id: 'here', kind: 'note', version: 1, createdAt: now, updatedAt: now, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'noteLink', attrs: { id: 'away', title: 'Timetable', block: 'abcd1234', part: 'The last boat.' } }] }] } },
      { id: 'away', kind: 'page', version: 1, createdAt: now, updatedAt: now - 1, body: { type: 'doc', content: [heading('Boats'), line('The first boat.'), line('The last boat.', 'abcd1234'), heading('Trains'), line('The first train.')] } },
    ])
    keepFolds('away', ['2 Boats', '2 Trains'])
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    await userEvent.click(await vi.waitFor(() => document.querySelector<HTMLElement>('.nib-library [data-id="here"] > button')!))
    const link = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('main [data-note-link="away"]')
      expect(found).not.toBeNull()
      return found!
    })
    await userEvent.click(link)
    const arrived = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('main .ProseMirror .nib-arrived')
      expect(found).not.toBeNull()
      return found!
    })
    expect(arrived.textContent).toBe('The last boat.')
    expect(arrived.getBoundingClientRect().height).toBeGreaterThan(0)
    expect([...document.querySelectorAll('main .ProseMirror .nib-folded-away')].map((line) => line.textContent)).toEqual(['The first train.'])
    expect(foldsOf('away')).toEqual(['2 Trains'])
  })

  it('aligns a line from the Format menu, and stores nothing about the lines not aligned', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    const menu = (id: string) => act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id })))
    await menu('new-note')
    await expect.poll(() => document.querySelector('main .ProseMirror')).not.toBeNull()
    await act(async () => void document.querySelector<HTMLElement>('main .ProseMirror')!.focus())
    await userEvent.keyboard('A plain line')
    const saved = async () => (await db.items.toArray())[0]?.body.content?.[0]
    await expect.poll(saved, { timeout: 5000 }).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'A plain line' }] })
    await menu('format-align-center')
    await expect.poll(saved, { timeout: 5000 }).toEqual({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'A plain line' }] })
    expect(getComputedStyle(document.querySelector('main .ProseMirror p')!).textAlign).toBe('center')
    await menu('format-align-center')
    await expect.poll(saved, { timeout: 5000 }).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'A plain line' }] })
  })

  it('counts a link shared from an archived note as the free one', async () => {
    const now = Date.now()
    const body = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    const share = { slug: 'S'.repeat(22), key: 'K'.repeat(43), owner: 'O'.repeat(43), createdAt: now, expiresAt: now + 86_400_000, free: true as const }
    await db.items.bulkAdd([
      { id: 'here', kind: 'note', version: 1, createdAt: now, updatedAt: now, body: body('Still writing') },
      { id: 'away', kind: 'note', version: 1, createdAt: now, updatedAt: now, archivedAt: now, shares: [share], body: body('Kept away') },
    ])
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    await userEvent.click(await vi.waitFor(() => document.querySelector<HTMLElement>('.nib-library [data-id="here"] > button')!))
    await expect.poll(() => document.querySelector('main .ProseMirror')?.textContent).toBe('Still writing')
    await act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id: 'palette' })))
    await userEvent.click(await screen.findByRole('button', { name: /^Share a draft/ }))
    await expect.poll(() => document.body.textContent).toMatch(/Your free link is sharing .Kept away./)
  })

  it('makes the open note read-only from Commands, the Format menu saying so, and back', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    const menu = (id: string) => act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id })))
    const command = async (name: RegExp) => {
      await menu('palette')
      await userEvent.click(await screen.findByRole('button', { name }))
    }
    await menu('new-note')
    await expect.poll(() => document.querySelector('main .ProseMirror')).not.toBeNull()
    const writing = () => document.querySelector<HTMLElement>('main .ProseMirror')!
    await act(async () => void writing().focus())
    await userEvent.keyboard('Keep this.')
    await expect.poll(() => db.items.count(), { timeout: 5000 }).toBe(1)

    await command(/^Make read-only/)
    await expect.poll(() => writing().getAttribute('contenteditable')).toBe('false')
    await expect.poll(async () => (await db.items.toArray())[0].readOnly).toBe(true)
    await expect.poll(() => document.body.textContent).toMatch(/Read-only/)

    await menu('format-checklist')
    expect(screen.getByText(/This is read-only/)).toBeTruthy()
    expect(document.querySelector('main ul[data-type="taskList"]')).toBeNull()

    // Commands offers nothing that writes, with words selected or not.
    await userEvent.dblClick(writing().querySelector('p')!, { position: { x: 5, y: 8 } })
    expect(getSelection()!.toString().trim()).toBe('Keep')
    await menu('palette')
    await screen.findByRole('button', { name: /^Allow editing/ })
    expect(screen.queryByRole('button', { name: /Add a note to self/ })).toBeNull()
    await userEvent.keyboard('checklist')
    await expect.poll(() => screen.queryByRole('button', { name: /^Allow editing/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Checklist/ })).toBeNull()
    await userEvent.keyboard('{Escape}')

    await command(/^Allow editing/)
    await expect.poll(() => writing().getAttribute('contenteditable')).toBe('true')
    await expect.poll(async () => (await db.items.toArray())[0].readOnly).toBeNull()
  })

  it('applies Format menu choices to the open note, and says why a note has no headings', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await expect.poll(() => document.querySelector('.ProseMirror')).not.toBeNull()
    const menu = (id: string) => act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id })))
    await menu('format-checklist')
    expect(document.querySelector('.ProseMirror ul[data-type="taskList"]')).not.toBeNull()
    await menu('format-title')
    expect(screen.getByText('Titles and headings are for pages.')).toBeTruthy()
    expect(document.querySelector('.ProseMirror h1')).toBeNull()
    // The bar above the keyboard is for iPhone and iPad; a Mac has a menu bar.
    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull()
    // Its first save, or it lands in the next test, past that test's clearing.
    await expect.poll(() => db.items.count(), { timeout: 5000 }).toBe(1)
  })

  it('makes tables from Format → Table on a page, and says why not elsewhere', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await expect.poll(() => document.querySelector('.ProseMirror')).not.toBeNull()
    const menu = (id: string) => act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id })))
    const rows = () => document.querySelectorAll('.ProseMirror table tr').length

    await menu('table-insert')
    expect(screen.getByText('Tables are for pages.')).toBeTruthy()

    await menu('new-page')
    await expect.poll(() => document.querySelector('.ProseMirror.nib-editor-page')).not.toBeNull()
    await menu('table-add-row')
    expect(screen.getByText('Put the cursor in a table first.')).toBeTruthy()
    await menu('table-insert')
    expect(rows()).toBe(3)
    expect(document.querySelectorAll('.ProseMirror table th')).toHaveLength(3)
    await menu('table-add-row')
    expect(rows()).toBe(4)
    await menu('table-delete')
    expect(document.querySelector('.ProseMirror table')).toBeNull()
    await expect.poll(() => db.items.count(), { timeout: 5000 }).toBe(1)
  })

  it('switches the theme from View → Appearance', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    const menu = (id: string) => act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id })))
    // Put on once the cross-fade has its picture of the old one (App changeTheme).
    const dark = () => document.documentElement.classList.contains('dark')
    await menu('theme-dark')
    await expect.poll(dark).toBe(true)
    await menu('theme-light')
    await expect.poll(dark).toBe(false)
    await menu('theme-system')
    localStorage.removeItem('nib-theme')
  })
})

describe('a sheet in the Mac app', () => {
  const words = () => document.querySelector('main .ProseMirror')!.textContent
  const menu = (id: string) => act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id })))

  /** A note with some words in it, saved, and the caret still in it. */
  async function writing() {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    await act(async () => screen.getByRole('button', { name: /New note/ }).click())
    await expect.poll(editorFocused).toBe(true)
    await userEvent.keyboard('Ferry')
    await expect.poll(() => db.items.count(), { timeout: 3000 }).toBe(1)
    await wait()
  }

  /** ⌘K, and a command chosen with the keyboard. */
  async function command(words: string) {
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await expect.poll(() => document.activeElement?.getAttribute('placeholder')).toMatch(/^Type a command/)
    await userEvent.keyboard(`${words}{Enter}`)
  }

  // Typed into the writing behind the light overlay, a passcode was saved after 400 ms, and went into History and sync.
  it('has the keyboard in a dialog Commands opened, and gives it back to the writing', async () => {
    await vault.openVault('harbour lights', [])
    onTestFinished(() => vault.closeVault())
    await writing()
    await command('Change the vault')
    const field = within(await screen.findByRole('dialog', { name: 'Change the vault passcode' })).getByLabelText<HTMLInputElement>('New passcode')
    await expect.poll(() => document.activeElement).toBe(field)
    await userEvent.keyboard('new harbour')
    expect(field.value).toBe('new harbour')
    expect(words()).toBe('Ferry')

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await expect.poll(editorFocused).toBe(true)
  })

  it.each([
    ['Move to folder', 'Folder and categories'],
    ['Remind me', 'Remind me'],
    ['Share a draft', 'Share a draft'],
  ])('%s has the keyboard, so keys stay out of the writing and Escape closes it, and it goes back', async (asked, name) => {
    await writing()
    await command(asked)
    const dialog = await screen.findByRole('dialog', { name })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    await expect.poll(() => document.activeElement).toBe(dialog)
    await userEvent.keyboard('xyz')
    expect(words()).toBe('Ferry')

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name })).toBeNull()
    await expect.poll(editorFocused).toBe(true)
    // The caret where it was: ProseMirror puts it back a moment after it has focus.
    await expect.poll(() => window.getSelection()?.anchorOffset).toBe('Ferry'.length)
    await userEvent.keyboard('!')
    await expect.poll(words).toBe('Ferry!')
  })

  it('gives the keyboard back to the writing when closed by a press outside it too', async () => {
    await writing()
    await command('Move to folder')
    const dialog = await screen.findByRole('dialog', { name: 'Folder and categories' })
    await userEvent.click(dialog.parentElement!, { position: { x: 5, y: 5 } })
    expect(screen.queryByRole('dialog')).toBeNull()
    await expect.poll(editorFocused).toBe(true)
  })

  it('keeps the keyboard after a press on the blank part of it', async () => {
    await writing()
    await command('Move to folder')
    const dialog = await screen.findByRole('dialog', { name: 'Folder and categories' })
    await userEvent.click(within(dialog).getByText('Folder and categories'))
    expect(dialog.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // Drawn beneath what's up, Commands took the keys, and Return ran New note unseen.
  it('opens nothing under it: ⌘K and the Mac menu wait until it has gone', async () => {
    await writing()
    await userEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Settings' }))
    const settings = await screen.findByRole('dialog', { name: 'Settings' })
    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect(screen.queryByPlaceholderText(/Type a command/)).toBeNull()
    await menu('palette')
    expect(screen.queryByPlaceholderText(/Type a command/)).toBeNull()
    await menu('remind')
    expect(screen.queryByRole('dialog', { name: 'Remind me' })).toBeNull()
    expect(screen.getAllByRole('dialog')).toEqual([settings])
    // Nor does the new-note shortcut swap the document behind it.
    const before = document.querySelector('.ProseMirror')
    await userEvent.keyboard('{Meta>}{Alt>}n{/Alt}{/Meta}')
    expect(document.querySelector('.ProseMirror')).toBe(before)

    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect(screen.getByPlaceholderText(/Type a command/)).toBeTruthy()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect(screen.queryByPlaceholderText(/Type a command/)).toBeNull()
  })
})
