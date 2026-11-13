import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../index.css'
import { cheer, hush } from '../lib/cheers'

// On an iPhone or iPad.
vi.mock('../lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/platform')>()), nativeApp: true, macApp: false, touchApp: true }))

const { BuddyCorner, BuddyPanel } = await import('./Buddy')

afterEach(() => {
  cleanup()
  hush()
  localStorage.clear()
})

describe('the writing buddy’s corner on an iPhone or iPad', () => {
  it('steps aside while the cursor is in the writing, and comes back when it leaves', async () => {
    render(
      <>
        <div className="ProseMirror" contentEditable tabIndex={0} data-testid="writing" />
        <input aria-label="Search" />
        <BuddyCorner onOpen={vi.fn()} />
      </>,
    )
    const corner = () => screen.queryByRole('button', { name: 'Inkwell' })
    expect(corner()).toBeTruthy()
    await act(async () => screen.getByTestId('writing').focus())
    expect(corner()).toBeNull()
    await act(async () => screen.getByRole('textbox', { name: 'Search' }).focus())
    expect(corner()).toBeTruthy()
    await act(async () => screen.getByTestId('writing').focus())
    await act(async () => screen.getByTestId('writing').blur())
    expect(corner()).toBeTruthy()
  })

  it('keeps a cheer till the writing lets go of the keyboard', async () => {
    render(
      <>
        <div className="ProseMirror" contentEditable tabIndex={0} data-testid="writing" />
        <BuddyCorner onOpen={vi.fn()} />
      </>,
    )
    await act(async () => screen.getByTestId('writing').focus())
    act(() => cheer({ kind: 'milestone', words: 5_000 }))
    await new Promise((resolve) => setTimeout(resolve, 1800))
    expect(screen.queryByText(/5,000 words/)).toBeNull()
    // Not said yet, so not spent unseen.
    expect(localStorage.getItem('nib-buddy-spoke')).toBeNull()
    await act(async () => screen.getByTestId('writing').blur())
    expect(await screen.findByText('5,000 words in this one. It’s taking shape.', {}, { timeout: 2500 })).toBeTruthy()
  })
})

// Asked 2026-11-13: the buddy alive, as a companion is, and moved by what happens.
describe('the writing buddy’s face', () => {
  const face = () => document.querySelector<SVGElement>('svg.nib-buddy')!

  it('breathes and blinks, perks up as its panel opens, then goes back to just living', async () => {
    render(<BuddyPanel onClose={vi.fn()} />)
    expect(face().dataset.mood).toBe('perk')
    expect(getComputedStyle(document.querySelector('.nib-buddy-eye')!).animationName).toBe('buddyBlink')
    act(() => void fireEvent.animationEnd(face()))
    expect(face().dataset.mood).toBeUndefined()
    expect(getComputedStyle(face()).animationName).toBe('buddyBreathe')
  })

  // Asked 2026-11-13: Inkwell's story, "The last drop", from a link under its greeting.
  it('tells its own story from My story, written out as an answer is', async () => {
    render(<BuddyPanel onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'My story' }))
    const story = await screen.findByRole('article', { name: 'Who are you?' })
    expect(story.textContent).toMatch(/^Who are you\?I was the last drop of ink in an old inkwell/)
    expect(story.querySelectorAll('.nib-buddy-word').length).toBeGreaterThan(20)
  })

  // Asked 2026-11-13: a stamp of Inkwell's own, for hearing its story, the first time only.
  it('hands over its keepsake the first time it tells its story, and keeps the day', async () => {
    render(<BuddyPanel onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'My story' }))
    const note = await screen.findByRole('note')
    expect(note.querySelector('p')!.textContent).toBe('For listening, my own stamp. It’s with the keepsakes in the Stampbook.')
    expect(note.querySelector('svg')).not.toBeNull()
    expect(localStorage.getItem('nib-inkwell-story')).toMatch(/^\d{4}-\d\d-\d\d$/)
    cleanup()
    render(<BuddyPanel onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'My story' }))
    await screen.findByRole('article', { name: 'Who are you?' })
    expect(screen.queryByRole('note')).toBeNull()
  })

  // Asked 2026-11-13: with Nib Plus, Inkwell in the colours of Plus's badge; without, in the ink's.
  it('wears Nib Plus’s glow with Plus, and the ink’s colour without', async () => {
    render(<BuddyCorner onOpen={vi.fn()} plus />)
    const fill = getComputedStyle(face()).fill
    const glow = face().querySelector('linearGradient')!
    expect(fill).toBe(`url("#${glow.id}")`)
    expect([...glow.querySelectorAll('stop')].map((stop) => stop.getAttribute('stop-color'))).toEqual(['#65aefe', '#8097fc', '#987df8'])
    cleanup()
    render(<BuddyCorner onOpen={vi.fn()} />)
    expect(face().querySelector('linearGradient')).toBeNull()
    expect(getComputedStyle(face()).fill).toBe(getComputedStyle(face()).color)
  })

  it('perks up in its corner as it has something to say', async () => {
    render(<BuddyCorner onOpen={vi.fn()} />)
    expect(face().dataset.mood).toBeUndefined()
    act(() => cheer({ kind: 'milestone', words: 5_000 }, Date.now()))
    await vi.waitFor(() => expect(face().dataset.mood).toBe('perk'), { timeout: 2500 })
  })
})
