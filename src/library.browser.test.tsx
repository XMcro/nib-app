import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Profiler } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { App } from './App'

/**
 * The library (components/Library): Notes and Pages a screen of their own,
 * a document the whole window, and Settings a screen too.
 */

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const textOf = (item: { body: unknown }) => JSON.stringify(item.body).match(/"text":"([^"]*)"/)![1]
const libraryEl = () => document.querySelector<HTMLElement>('.nib-library')
const library = () => within(libraryEl()!)
const writing = () => within(document.querySelector('main')!)
const cards = () => [...document.querySelectorAll('.nib-library [data-id] [data-title]')].map((title) => title.textContent)

beforeEach(async () => {
  localStorage.clear()
  await db.items.clear()
  await page.viewport(1280, 800)
  // A moment apart, so which came first can't tie on the millisecond.
  await items.create('note', doc('Research notes'), { folder: 'Novel', categories: [{ name: 'Draft', color: 'blue' }], createdAt: Date.now() - 1000 })
  await items.create('note', doc('Groceries'))
  await items.create('page', doc('Chapter one'), { folder: 'Novel' })
})
afterEach(cleanup)

describe('the library', () => {
  // Two greys of its own, whatever the theme.
  it('draws the lock at its foot in the theme’s colour, as the words beside it', async () => {
    await act(async () => void render(<App />))
    const words = await library().findByText('Stored on this device')
    expect(getComputedStyle(words.previousElementSibling!).color).toBe(getComputedStyle(words).color)
  })

  it('shows Notes and Pages as cards, and opens one with the whole window to itself', async () => {
    await act(async () => void render(<App />))
    await expect.poll(cards).toHaveLength(2)
    expect(libraryEl()!.dataset.open).toBe('true')

    await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
    await expect.poll(cards).toEqual(['Chapter one'])
    await userEvent.click(library().getByRole('tab', { name: 'Notes' }))
    await expect.poll(cards).toHaveLength(2)

    await userEvent.click(library().getByText('Research notes'))
    await expect.poll(() => libraryEl()!.dataset.open).toBe('false')
    await expect.poll(() => document.querySelector('.ProseMirror')?.textContent).toBe('Research notes')
    // Where it's filed, beside the way back.
    expect(writing().getByText('Novel')).toBeTruthy()

    await userEvent.click(writing().getByRole('button', { name: 'Notes' }))
    await expect.poll(() => libraryEl()!.dataset.open).toBe('true')
  })

  // They changed what was under the library and left it up, so nothing seemed to happen.
  it('goes away for a document chosen in Commands', async () => {
    await act(async () => void render(<App />))
    await expect.poll(cards).toHaveLength(2)
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.keyboard('Groceries')
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Commands' })).getByRole('button', { name: /^Groceries/ }))
    await expect.poll(() => libraryEl()!.dataset.open).toBe('false')
    await expect.poll(() => document.querySelector('.ProseMirror')?.textContent).toBe('Groceries')
  })

  it.each([
    ['New note', ''],
    ['New page', '.nib-editor-page'],
  ])('goes away for Commands’ %s', async (row, editor) => {
    await act(async () => void render(<App />))
    await expect.poll(cards).toHaveLength(2)
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Commands' })).getByRole('button', { name: new RegExp(`^${row}`) }))
    await expect.poll(() => libraryEl()!.dataset.open).toBe('false')
    await expect.poll(() => document.querySelector(`main .ProseMirror${editor}`)?.textContent).toBe('')
  })

  it('goes away for the new note shortcut', async () => {
    await act(async () => void render(<App />))
    await expect.poll(cards).toHaveLength(2)
    await userEvent.keyboard('{Meta>}{Alt>}n{/Alt}{/Meta}')
    await expect.poll(() => libraryEl()!.dataset.open).toBe('false')
  })

  it('comes back from focus mode when Commands’ Show library or the shortcut asks', async () => {
    await act(async () => void render(<App />))
    await expect.poll(cards).toHaveLength(2)
    const command = async (row: string) => {
      await userEvent.keyboard('{Meta>}k{/Meta}')
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Commands' })).getByRole('button', { name: new RegExp(`^${row}`) }))
    }
    await command('Focus mode')
    await expect.poll(() => libraryEl()!.dataset.open).toBe('false')
    await command('Show library')
    await expect.poll(() => libraryEl()!.dataset.open).toBe('true')
    expect(document.querySelector('main')!.inert).toBe(true)

    await command('Focus mode')
    await expect.poll(() => libraryEl()!.dataset.open).toBe('false')
    await userEvent.keyboard('{Meta>}\\{/Meta}')
    await expect.poll(() => libraryEl()!.dataset.open).toBe('true')
    await userEvent.keyboard('{Meta>}\\{/Meta}')
    await expect.poll(() => libraryEl()!.dataset.open).toBe('false')
  })

  it('starts a new note over the library', async () => {
    await act(async () => void render(<App />))
    await expect.poll(cards).toHaveLength(2)
    await userEvent.click(library().getByRole('button', { name: 'New note' }))
    await expect.poll(() => libraryEl()!.dataset.open).toBe('false')
    expect(document.querySelector('.ProseMirror')?.textContent).toBe('')
  })

  // Just wider than a phone, as an iPhone Duo is open (669 points), the bar
  // still fits: New's label on one line and nothing past the edge.
  it('keeps the bar to one line just wider than a phone', async () => {
    await act(async () => void render(<App />))
    await expect.poll(cards).toHaveLength(2)
    const label = () => library().getByRole('button', { name: 'New note' }).querySelector('span')!
    const oneLine = label().offsetHeight
    for (const width of [640, 669]) {
      await page.viewport(width, 951)
      await expect.poll(() => innerWidth).toBe(width)
      expect(label().offsetHeight).toBe(oneLine)
      const header = libraryEl()!.querySelector('header')!
      expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth)
    }
  })

  // Crumpled into a ball and tossed into Trash, which jolts as it lands; the
  // card is gone once it's in, not before.
  // Asked 2026-11-13: room was kept for the pin and × while they were unseen, and the title stopped short of nothing.
  it('runs a title to the card’s edge till its pin and × come under the pointer, then makes room for them', async () => {
    await items.create('note', doc('A loose title long enough to run all the way across its card'))
    await items.create('note', doc('A pinned title long enough to run all the way across its card'), { pinnedAt: Date.now() })
    await act(async () => void render(<App />))
    const title = (start: string) => [...document.querySelectorAll<HTMLElement>('.nib-library [data-title]')].find((one) => one.textContent?.startsWith(start))!
    const room = (start: string) => getComputedStyle(title(start)).paddingRight
    await expect.poll(() => title('A loose')).toBeTruthy()
    expect(room('A loose')).toBe('0px')
    // A pin that's in stays, at the edge, and keeps its room; the × doesn't.
    expect(room('A pinned')).toBe('28px')
    await userEvent.hover(title('A loose'))
    await expect.poll(() => room('A loose')).toBe('56px')
    await expect.poll(() => getComputedStyle(library().getByRole('button', { name: /^Move A loose .* to trash$/ })).opacity).toBe('1')
  })

  it('crumples a trashed card and tosses it into the trash', async () => {
    // Each flight paused as it starts, to be finished by hand: a busy machine could see one out before this looks.
    const animate = Element.prototype.animate
    Element.prototype.animate = function (...args: Parameters<typeof animate>) {
      const animation = animate.apply(this, args)
      animation.pause()
      return animation
    }
    onTestFinished(() => void (Element.prototype.animate = animate))
    await act(async () => void render(<App />))
    await expect.poll(cards).toHaveLength(2)
    expect(library().queryByRole('button', { name: /^Trash/ })).toBeNull()
    await userEvent.click(within(libraryEl()!.querySelector<HTMLElement>('[data-id]')!).getByLabelText(/^Move .* to trash$/))
    const ball = document.querySelector<HTMLElement>('body > .nib-toss > .nib-ball')!
    expect(ball).not.toBeNull()
    // Thrown once it's drawn.
    await expect.poll(() => ball.getAnimations().length).toBeGreaterThan(0)
    expect(await items.listTrash()).toHaveLength(0)
    ball.getAnimations().forEach((animation) => animation.finish())
    await expect.poll(async () => (await items.listTrash()).length).toBe(1)
    await expect.poll(() => library().queryByRole('button', { name: 'Trash (1)' })).toBeTruthy()
    expect(document.querySelector('.nib-toss')).toBeNull()
    await expect.poll(cards).toHaveLength(1)
    expect(libraryEl()!.querySelector('[data-trash-bin] .nib-bin')!.hasAttribute('data-jolted')).toBe(true)
  })

  // Pinned, a card glides to the top over the others as its pin is pressed
  // in; played once, and not again when the card is moved for another.
  // Every move of the pointer drew the whole library again: at 3,000 cards, 4 frames a second.
  it('moves a held card without drawing anything else', async () => {
    let commits = 0
    await act(async () => void render(<Profiler id="app" onRender={() => commits++}><App /></Profiler>))
    await expect.poll(cards).toHaveLength(2)
    const card = libraryEl()!.querySelector<HTMLElement>('[data-id]')!
    const { left, top } = card.getBoundingClientRect()
    const move = (x: number, y: number) => act(async () => void window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true })))
    act(() => void fireEvent.pointerDown(card, { button: 0, pointerType: 'mouse', clientX: left + 20, clientY: top + 20 }))
    await move(left + 40, top + 40)
    await expect.poll(() => document.querySelector('.nib-held')).not.toBeNull()

    const before = commits
    for (let i = 0; i < 5; i++) await move(left + 60 + i * 10, top + 60)
    expect(commits).toBe(before)
    expect(parseFloat(document.querySelector<HTMLElement>('.nib-held')!.style.left)).toBeCloseTo(left + 60 + 40 + 14, 1)
    act(() => void window.dispatchEvent(new PointerEvent('pointercancel')))
  })

  it('lifts a pinned card to the top over the others, pressing its pin in once', async () => {
    // data-pinning lasts as long as the card's animation, 640 ms: paused as it starts, so settle() ends it, not a busy machine.
    const held = document.createElement('style')
    held.textContent = '[data-pinning] { animation-play-state: paused !important; }'
    document.head.append(held)
    onTestFinished(() => held.remove())
    await act(async () => void render(<App />))
    await expect.poll(cards).toEqual(['Groceries', 'Research notes'])
    const card = (title: string) => [...libraryEl()!.querySelectorAll<HTMLElement>('[data-id]')].find((each) => each.textContent!.includes(title))!
    const research = card('Research notes')
    const settle = () => research.getAnimations({ subtree: true }).forEach((animation) => animation.finish())

    await userEvent.click(within(research).getByLabelText(/^Pin /))
    await expect.poll(cards).toEqual(['Research notes', 'Groceries'])
    expect(research.dataset.pinning).toBe('in')
    expect(within(research).getByLabelText(/^Unpin /).hasAttribute('data-pinned')).toBe(true)
    settle()
    await expect.poll(() => research.dataset.pinning).toBeUndefined()

    // Groceries pinned above it moves it in the page: it doesn't press again.
    await userEvent.click(within(card('Groceries')).getByLabelText(/^Pin /))
    await expect.poll(cards).toEqual(['Groceries', 'Research notes'])
    expect(research.dataset.pinning).toBeUndefined()
    expect(research.getAnimations({ subtree: true }).map((animation) => (animation as CSSAnimation).animationName).filter(Boolean)).toEqual([])

    await userEvent.click(within(research).getByLabelText(/^Unpin /))
    await expect.poll(() => research.dataset.pinning).toBe('out')
    expect(within(research).getByLabelText(/^Pin /).hasAttribute('data-pinned')).toBe(false)
  })

  // In the trash: restored, a note lifts out; deleted for good, it's cut into
  // strips that fall away; emptied, they all are. Each happens once it's done.
  it('lifts a restored note out of the trash, and shreds one deleted for good, or all of them', async () => {
    const all = await items.list('note')
    for (const item of all) await items.remove(item.id)
    await act(async () => void render(<App />))
    await userEvent.click(await library().findByRole('button', { name: 'Trash (2)' }))
    const row = (text: string) => [...libraryEl()!.querySelectorAll<HTMLElement>('.nib-trash-row')].find((each) => each.textContent!.includes(text))!
    const settle = (element: Element) => element.getAnimations({ subtree: true }).forEach((animation) => animation.finish())

    await userEvent.click(within(row('Groceries')).getByRole('button', { name: 'Restore' }))
    expect((await items.listTrash()).length).toBe(2)
    settle(row('Groceries'))
    await expect.poll(async () => (await items.listTrash()).map((item) => textOf(item))).toEqual(['Research notes'])

    await items.remove((await items.list('note'))[0].id)
    await expect.poll(() => libraryEl()!.querySelectorAll('.nib-trash-row').length).toBe(2)
    await userEvent.click(within(row('Research')).getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(row('Research')).getByRole('button', { name: 'Delete for good?' }))
    await expect.poll(() => document.querySelectorAll('body > .nib-shreds > .nib-strip').length).toBeGreaterThan(0)
    expect((await items.listTrash()).length).toBe(2)
    settle(document.querySelector('.nib-shreds')!)
    settle(row('Research'))
    await expect.poll(async () => (await items.listTrash()).map((item) => textOf(item))).toEqual(['Groceries'])
    expect(document.querySelector('.nib-shreds')).toBeNull()

    await userEvent.click(library().getByRole('button', { name: 'Empty trash' }))
    await userEvent.click(library().getByRole('button', { name: 'Empty for good?' }))
    expect(document.querySelectorAll('body > .nib-shreds')).toHaveLength(1)
    settle(document.body)
    await expect.poll(async () => (await items.listTrash()).length).toBe(0)
    expect(await library().findByText('Trash is empty.')).toBeTruthy()
  })

  it('opens Settings as a screen of its own, from the library and from the text', async () => {
    await act(async () => void render(<App />))
    await expect.poll(cards).toHaveLength(2)
    await userEvent.click(library().getByRole('button', { name: 'Settings' }))
    const settings = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(settings).getByText('Appearance')).toBeTruthy()
    await userEvent.click(within(settings).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()

    await userEvent.click(library().getByText('Groceries'))
    await expect.poll(() => libraryEl()!.dataset.open).toBe('false')
    await userEvent.click(writing().getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
  })
})

