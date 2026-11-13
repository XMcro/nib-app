import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import type { Capture } from './lib/inbox'
import { localDay } from './lib/time'

/**
 * In the iOS app, focus raises the keyboard — the web view allows it without a
 * tap, where Safari does not. So there the editor waits to be tapped, and
 * everywhere else it stays "cursor ready". Needs ProseMirror, so a real browser.
 */

// A getter here is read once, when the mock is built, so the flag is fixed for
// this file. Browsers keeping the cursor ready is pinned in phone.browser.test.
vi.mock('./lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/platform')>()),
  nativeApp: true,
  touchApp: true,
  showsShortcuts: false,
}))

// The inbox's native side, under the real lib/inbox: what's waiting in it, what Nib said it had, and a way to send the app a nib:// link.
const links = vi.hoisted(() => ({ open: (_url: string) => {}, listening: false, waiting: [] as Capture[], acked: [] as string[] }))
vi.mock('@capacitor/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@capacitor/core')>()
  const nibInbox = {
    list: async () => ({ captures: links.waiting }),
    ack: async ({ ids }: { ids: string[] }) => {
      links.acked.push(...ids)
      links.waiting = []
    },
    addListener: async (_event: string, listener: (event: { url: string }) => void) => {
      links.open = (url) => listener({ url })
      links.listening = true
      return { remove: async () => {} }
    },
  }
  return { ...real, registerPlugin: ((name, implementations) => (name === 'NibInbox' ? nibInbox : real.registerPlugin(name, implementations))) as typeof real.registerPlugin }
})

// Lock Nib's native side: whether its cover is up, waiting for Face ID.
const cover = vi.hoisted(() => ({ locked: false }))
vi.mock('./lib/lock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/lock')>()),
  coveredNow: async () => cover.locked,
}))

const { App } = await import('./App')
const editorFocused = () => document.activeElement?.closest('.ProseMirror') != null
const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)))

// The welcome, already seen: this file is about the keyboard.
beforeEach(() => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  localStorage.setItem('nib-device-asked', '1')
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  cover.locked = false
  links.listening = false
})
afterEach(() => void vi.useRealTimers())
afterEach(cleanup)

describe('in the iOS app', () => {
  it('opens on the list, and leaves the keyboard down until the note is tapped', async () => {
    await page.viewport(375, 812)
    await act(async () => void render(<App />))
    await wait()
    expect(document.querySelector<HTMLElement>('.nib-library')!.dataset.open).toBe('true')
    expect(editorFocused()).toBe(false)

    await act(async () => screen.getByRole('button', { name: /New note/ }).click())
    await wait()
    expect(editorFocused()).toBe(false)

    await userEvent.click(document.querySelector('.ProseMirror')!)
    expect(editorFocused()).toBe(true)
    // With the keyboard up comes the formatting bar, as in Notes.
    expect(await screen.findByRole('toolbar', { name: 'Formatting' })).toBeTruthy()
  })

  it('opens a new page from a widget link with the keyboard up, ready to type', async () => {
    await page.viewport(375, 812)
    await act(async () => void render(<App />))
    await expect.poll(() => links.listening).toBe(true)
    await act(async () => links.open('nib://new-page'))
    await expect.poll(() => document.querySelector('.ProseMirror.nib-editor-page')).not.toBeNull()
    await expect.poll(editorFocused).toBe(true)
  })

  // The keyboard sits above Lock Nib's cover, its suggestions words from the note.
  it('starts writing from the welcome with the keyboard up, ready to type', async () => {
    localStorage.removeItem('nib-device-asked')
    await db.items.clear()
    await page.viewport(375, 812)
    await act(async () => void render(<App />))
    await userEvent.click(await screen.findByRole('button', { name: 'Start writing' }))
    await expect.poll(() => document.querySelector<HTMLElement>('.nib-library')!.dataset.open).toBe('false')
    await expect.poll(editorFocused).toBe(true)
  })

  it('leaves the keyboard down for a widget link while Nib is locked', async () => {
    cover.locked = true
    await page.viewport(375, 812)
    await act(async () => void render(<App />))
    await wait()
    await act(async () => links.open('nib://new-note'))
    await wait()
    expect(document.querySelector('.ProseMirror')).not.toBeNull()
    expect(editorFocused()).toBe(false)
  })

  // Every other way to a new note or page was counted.
  it('counts a new note and a new page from a widget link', async () => {
    localStorage.setItem('nib-counts-answer', 'yes')
    onTestFinished(() => {
      localStorage.removeItem('nib-counts-answer')
      localStorage.removeItem('nib-counts')
    })
    await page.viewport(375, 812)
    await act(async () => void render(<App />))
    await expect.poll(() => links.listening).toBe(true)
    await act(async () => links.open('nib://new-note'))
    await act(async () => links.open('nib://new-page'))
    expect(JSON.parse(localStorage.getItem('nib-counts') ?? '{}')[localDay(Date.now())]).toMatchObject({ note_new: 1, page_new: 1 })
  })

  it('offers Remind me among the first commands for an open note, where a phone shows it', async () => {
    await page.viewport(375, 812)
    const saved = await db.items.count()
    await act(async () => void render(<App />))
    await expect.poll(() => links.listening).toBe(true)
    await act(async () => links.open('nib://new-note'))
    await expect.poll(editorFocused).toBe(true)
    await userEvent.keyboard('Ferry at 07:40')
    // Saved, so it is a note with an id that a reminder can name.
    await expect.poll(() => db.items.count(), { timeout: 5000 }).toBe(saved + 1)
    await openCommands()
    await screen.findByRole('button', { name: /^Remind me/ })
    const rows = (await screen.findAllByRole('button')).map((button) => button.textContent)
    const commands = rows.slice(rows.indexOf('New note'))
    expect(commands.indexOf('Remind me…')).toBeGreaterThan(0)
    expect(commands.indexOf('Remind me…')).toBeLessThan(6)
  })

  it('moves focus nowhere for a card, coming or going, so the keyboard stays down', async () => {
    await page.viewport(375, 812)
    await act(async () => void render(<App />))
    await wait()
    await act(async () => links.open('nib://new-note'))
    await wait()
    await userEvent.keyboard('Ferry at 07:40')
    await expect.poll(() => db.items.count(), { timeout: 3000 }).toBeGreaterThan(0)
    await openCommands()
    await userEvent.click(await screen.findByRole('button', { name: 'Move to folder…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Folder and categories' })
    await wait()
    expect(editorFocused()).toBe(false)
    expect(dialog.contains(document.activeElement)).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    await wait()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(editorFocused()).toBe(false)
  })

  // With the keyboard up the cards sat behind it, and the first words went into the note under them.
  it('brings nothing up with the caret in the text, however long it has been', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T23:59:58') })
    onTestFinished(() => void vi.useRealTimers())
    localStorage.setItem('nib-book', JSON.stringify([['2026-11-04', 1]]))
    localStorage.setItem('nib-trades', JSON.stringify([{ id: 'login:2026-11-04', day: '2026-11-04', sold: [], kind: 'login' }]))
    await page.viewport(375, 812)
    await act(async () => void render(<App />))
    await wait()
    await act(async () => links.open('nib://new-note'))
    await wait()
    expect(editorFocused()).toBe(true)
    // Past midnight, today's coins due, but not a minute since the draft was opened to be typed in.
    vi.setSystemTime(new Date('2026-11-05T00:00:30'))
    await act(async () => (document.activeElement as HTMLElement).blur())
    await new Promise((resolve) => setTimeout(resolve, 4500))
    expect(screen.queryByRole('dialog', { name: 'Today’s coins' })).toBeNull()

    // Over a minute, with the caret back in the text.
    vi.setSystemTime(new Date('2026-11-05T00:02:00'))
    await act(async () => document.querySelector<HTMLElement>('.ProseMirror')!.focus())
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(screen.queryByRole('dialog', { name: 'Today’s coins' })).toBeNull()
    expect(editorFocused()).toBe(true)

    await act(async () => (document.activeElement as HTMLElement).blur())
    const coins = await screen.findByRole('dialog', { name: 'Today’s coins' }, { timeout: 3000 })
    expect(editorFocused()).toBe(false)
    // On itself, which raises nothing and is how VoiceOver hears of it.
    await expect.poll(() => document.activeElement).toBe(coins)
  })

  // Left on a note at night and come back to the next morning, iOS put the caret and the keyboard back where they were, and the day's coins and pack never came.
  it('brings a new day’s coins, then its pack, as Nib comes back to the front with the caret left in the text, the keyboard put away for them', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T21:00:00') })
    onTestFinished(() => void vi.useRealTimers())
    localStorage.setItem('nib-book', JSON.stringify([['2026-11-04', 1]]))
    localStorage.setItem('nib-trades', JSON.stringify([{ id: 'login:2026-11-04', day: '2026-11-04', sold: [], kind: 'login' }]))
    await page.viewport(375, 812)
    await act(async () => void render(<App />))
    await wait()
    await act(async () => links.open('nib://new-note'))
    await wait()
    await userEvent.keyboard('Last thing at night')
    const to = (state: DocumentVisibilityState) => act(() => void (Object.defineProperty(document, 'visibilityState', { value: state, configurable: true }), document.dispatchEvent(new Event('visibilitychange'))))
    onTestFinished(() => void delete (document as { visibilityState?: unknown }).visibilityState)

    // Back the same evening, nothing new: the caret stays, and the keyboard with it.
    await to('hidden')
    vi.setSystemTime(new Date('2026-11-04T21:20:00'))
    await to('visible')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(editorFocused()).toBe(true)

    // Back the next morning.
    await to('hidden')
    vi.setSystemTime(new Date('2026-11-05T08:30:00'))
    await to('visible')
    const coins = await screen.findByRole('dialog', { name: 'Today’s coins' }, { timeout: 3000 })
    expect(editorFocused()).toBe(false)
    expect(within(coins).getByText('Day 2 of 7')).toBeTruthy()
    await userEvent.click(within(coins).getByRole('button', { name: 'Collect 20 coins' }))
    await userEvent.click(within(coins).getByRole('button', { name: 'Done' }))
    expect(await screen.findByRole('dialog', { name: 'Today’s pack' }, { timeout: 3000 })).toBeTruthy()
  })

  // The share sheet or Shortcuts, used while Nib stayed open behind them.
  it('brings in what was captured while it was behind another app', async () => {
    const id = '11111111-2222-4333-8444-555555555555'
    onTestFinished(async () => {
      await db.items.delete(id)
      links.acked = []
    })
    await page.viewport(375, 812)
    await act(async () => void render(<App />))
    await wait()
    links.waiting = [{ id, text: 'Picked up from the share sheet', createdAt: Date.UTC(2026, 10, 1) }]
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    expect(await screen.findByText('Picked up from the share sheet')).toBeTruthy()
    expect((await db.items.get(id))?.createdAt).toBe(Date.UTC(2026, 10, 1))
    // Only once it's saved does the inbox let it go.
    await expect.poll(() => links.acked).toEqual([id])
  })

  it('names no keyboard shortcut anywhere, even once a keyboard has been used', async () => {
    localStorage.setItem('nib-keys', '1')
    document.documentElement.dataset.keys = ''
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    expect('keys' in document.documentElement.dataset).toBe(false)
    expect(localStorage.getItem('nib-keys')).toBeNull()

    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect('keys' in document.documentElement.dataset).toBe(false)
    await openCommands()
    expect(await screen.findByPlaceholderText(/Type a command/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/[⌘⌥⌃]|Ctrl\+/)
  })

  it('ignores every key pressed with ⌘ or ⌃: no shortcuts of its own or the editor’s', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await wait()
    await act(async () => links.open('nib://new-note'))
    await wait()
    await userEvent.keyboard('Ferry at 07:40')
    const library = document.querySelector<HTMLElement>('.nib-library')!
    const open = library.dataset.open

    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.keyboard('{Meta>}\\{/Meta}')
    await userEvent.keyboard('{Shift>}{Meta>}f{/Meta}{/Shift}')
    await userEvent.keyboard('{Control>}k{/Control}')
    await userEvent.keyboard('{Meta>}a{/Meta}{Meta>}b{/Meta}')
    await wait()
    expect(screen.queryByPlaceholderText(/Type a command/)).toBeNull()
    expect(library.dataset.open).toBe(open)
    expect(document.querySelector('.ProseMirror strong')).toBeNull()

    // Typing, Return included, is untouched, and so is ⌘ with the system's own keys.
    await userEvent.keyboard('{Meta>}{ArrowRight}{/Meta}{Enter}Pier 4')
    await expect.poll(() => document.querySelector('.ProseMirror')!.textContent).toContain('Pier 4')
  })
})

/** The Commands button: on a touch screen, the way to the palette. */
async function openCommands() {
  // Shown only to a coarse pointer, so found by its text rather than its role.
  const button = [...document.querySelectorAll('button')].find((each) => each.textContent === 'Commands')!
  await act(async () => button.click())
}
