import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { act, cleanup, render, screen } from '@testing-library/react'
import '../index.css'
import { cheer, hush } from '../lib/cheers'
import { localDay } from '../lib/time'
import { BuddyCorner, SAY_MS } from './Buddy'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  hush()
})

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const status = () => screen.getByRole('status')
const GOAL = /goal met|Goal reached|words are in/

describe('the writing buddy cheering you on', () => {
  it('waits for a clear screen, then says it, by its corner; tapped, it opens the buddy', async () => {
    const onOpen = vi.fn()
    const { rerender } = render(
      <>
        <div role="dialog" aria-label="Today’s pack" />
        <BuddyCorner onOpen={onOpen} />
      </>,
    )
    act(() => cheer({ kind: 'goal' }))
    await pause(2200)
    expect(status().textContent).toBe('')
    expect(localStorage.getItem('nib-buddy-spoke')).toBeNull()

    rerender(<BuddyCorner onOpen={onOpen} />)
    const said = await screen.findByRole('button', { name: GOAL }, { timeout: 2500 })
    expect(localStorage.getItem('nib-buddy-spoke')).toBe(localDay(Date.now()))
    await userEvent.click(said)
    expect(onOpen).toHaveBeenCalled()
    expect(status().textContent).toBe('')
  })

  it('fades by itself after a few seconds, and says nothing more that day', async () => {
    render(<BuddyCorner onOpen={vi.fn()} />)
    act(() => cheer({ kind: 'milestone', words: 1_000 }))
    expect(await screen.findByText('1,000 words in this one. A real start.', {}, { timeout: 2500 })).toBeTruthy()
    await pause(SAY_MS + 800)
    expect(status().textContent).toBe('')
    act(() => cheer({ kind: 'goal' }))
    await pause(1500)
    expect(status().textContent).toBe('')
  }, 20_000)
})
