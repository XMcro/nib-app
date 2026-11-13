// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { PlusWelcome, STAY_MS } from './PlusWelcome'

afterEach(() => vi.useRealTimers())

describe('PlusWelcome', () => {
  it('says so, then goes on its own', async () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    // A new onDone every render, as App passes it, mustn't restart the clock.
    const { rerender } = render(<PlusWelcome onDone={() => onDone()} />)
    expect(screen.getByRole('status').textContent).toContain('Welcome to Nib Plus')
    act(() => vi.advanceTimersByTime(STAY_MS - 1))
    rerender(<PlusWelcome onDone={() => onDone()} />)
    expect(onDone).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('goes at a tap, once however often it’s tapped', async () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    render(<PlusWelcome onDone={onDone} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('status'))
      fireEvent.click(screen.getByRole('status'))
    })
    await act(async () => vi.advanceTimersByTime(STAY_MS))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('keeps the library’s badge unseen only while it’s up', () => {
    const { unmount } = render(<PlusWelcome onDone={() => {}} />)
    expect(document.documentElement.dataset.welcoming).toBe('')
    unmount()
    expect(document.documentElement.dataset.welcoming).toBeUndefined()
  })
})
