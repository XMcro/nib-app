import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import { App } from './App'

/** A library of thousands draws what the window needs (components/cardWindow), and what isn't drawn is a scroll, a search or a Tab away. */

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const TOTAL = 400
const libraryEl = () => document.querySelector<HTMLElement>('.nib-library')!
const cardEls = () => [...libraryEl().querySelectorAll<HTMLElement>('[data-id]')]
const titles = () => cardEls().map((card) => card.querySelector('[data-title]')!.textContent)
const scroller = () => libraryEl().querySelector<HTMLElement>('.overflow-y-auto')!
const scrollTo = async (top: number) => {
  scroller().scrollTop = top
  scroller().dispatchEvent(new Event('scroll'))
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 60)))
}

beforeEach(async () => {
  localStorage.clear()
  await db.items.clear()
  await page.viewport(1280, 800)
  const now = Date.now()
  await db.items.bulkAdd(Array.from({ length: TOTAL }, (_, i) => ({ id: `n${i}`, kind: 'note' as const, body: doc(`Note ${i}`), version: 1, rev: 1, createdAt: now - i * 1000, updatedAt: now - i * 1000 })))
})
afterEach(cleanup)

describe('a long library', () => {
  it('draws only what the window needs, and the rest as it is scrolled to', async () => {
    await act(async () => void render(<App />))
    await expect.poll(() => cardEls().length).toBeGreaterThan(0)
    expect(cardEls().length).toBeLessThan(TOTAL)
    expect(titles()[0]).toBe('Note 0')
    const room = scroller().scrollHeight
    await scrollTo(room)
    await expect.poll(titles).toContain(`Note ${TOTAL - 1}`)
    // Still only part of it, and the same height.
    expect(cardEls().length).toBeLessThan(TOTAL)
    expect(Math.abs(scroller().scrollHeight - room)).toBeLessThan(400)
    await scrollTo(0)
    await expect.poll(titles).toContain('Note 0')
  })

  it('finds what isn’t drawn', async () => {
    await act(async () => void render(<App />))
    await expect.poll(() => cardEls().length).toBeGreaterThan(0)
    expect(titles()).not.toContain('Note 333')
    await userEvent.fill(libraryEl().querySelector('input[data-search]')!, 'Note 333')
    await expect.poll(titles).toEqual(['Note 333'])
  })

  it('hands Tab from card to card past what was drawn, and keeps a card with the focus when scrolled from', async () => {
    await act(async () => void render(<App />))
    await expect.poll(() => cardEls().length).toBeGreaterThan(0)
    const drawnFirst = cardEls().length
    cardEls()[drawnFirst - 1].querySelector('button')!.focus()
    const focusedCard = () => document.activeElement?.closest<HTMLElement>('[data-id]')?.dataset.id
    const reached = new Set<string>()
    for (let press = 0; press < 12; press++) {
      await userEvent.tab()
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)))
      reached.add(focusedCard() ?? 'nowhere')
    }
    expect(reached.has('nowhere')).toBe(false)
    expect(Number([...reached].at(-1)!.slice(1))).toBeGreaterThanOrEqual(drawnFirst)

    const holding = focusedCard()!
    await scrollTo(0)
    await scrollTo(scroller().scrollHeight)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(focusedCard()).toBe(holding)
  })

  it('rises in only on a new grid, not for cards scrolled to', async () => {
    await act(async () => void render(<App />))
    await expect.poll(() => cardEls().length).toBeGreaterThan(0)
    await expect.poll(() => libraryEl().querySelectorAll('[data-id]:not([data-arrived])').length).toBe(0)
    await scrollTo(scroller().scrollHeight)
    await expect.poll(titles).toContain(`Note ${TOTAL - 1}`)
    expect(libraryEl().querySelectorAll('[data-id]:not([data-arrived])').length).toBe(0)
    await scrollTo(0)
    await expect.poll(titles).toContain('Note 0')
    expect(libraryEl().querySelectorAll('[data-id]:not([data-arrived])').length).toBe(0)
  })

  it('keeps its place across a document and back, with the cards in sight rising in again', async () => {
    await act(async () => void render(<App />))
    await expect.poll(() => cardEls().length).toBeGreaterThan(0)
    await scrollTo(2000)
    await expect.poll(() => scroller().scrollTop).toBe(2000)
    const onScreen = cardEls().find((card) => card.getBoundingClientRect().top > 100)!
    await userEvent.click(onScreen.querySelector('button')!)
    await expect.poll(() => libraryEl().dataset.open).toBe('false')
    await userEvent.keyboard('{Meta>}\\{/Meta}')
    await expect.poll(() => libraryEl().dataset.open).toBe('true')
    expect(scroller().scrollTop).toBe(2000)
    await expect.poll(() => libraryEl().querySelectorAll('[data-id]:not([data-arrived])').length).toBeGreaterThan(0)
  })
})
