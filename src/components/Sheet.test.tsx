// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sheet } from './Sheet'

describe('Sheet', () => {
  it('is a modal dialog, named', () => {
    render(<Sheet label="Remind me" onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Remind me' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('closes with Escape and a press outside it, not a press on it', () => {
    const onClose = vi.fn()
    render(<Sheet label="A sheet" onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    fireEvent.mouseDown(dialog)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(dialog.parentElement!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('stays for a press outside it where that isn’t a way out', () => {
    const onClose = vi.fn()
    render(<Sheet label="A sheet" onClose={onClose} pressOutside={false} />)
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('hears other keys, and Escape as well', () => {
    const onClose = vi.fn()
    const onKeyDown = vi.fn()
    render(<Sheet label="A sheet" onClose={onClose} onKeyDown={onKeyDown} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' })
    expect(onKeyDown).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })

  function focusedField() {
    const field = document.body.appendChild(document.createElement('textarea'))
    field.focus()
    return field
  }

  it('takes the focus, and hands it back as it goes', () => {
    const field = focusedField()
    const { unmount } = render(<Sheet label="A sheet" onClose={() => {}} />)
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    unmount()
    expect(document.activeElement).toBe(field)
    field.remove()
  })

  it('gives the focus to what it’s told to', () => {
    const button = createRef<HTMLButtonElement>()
    render(
      <Sheet label="A sheet" onClose={() => {}} focus={button}>
        <button ref={button}>Close</button>
      </Sheet>,
    )
    expect(document.activeElement).toBe(button.current)
  })

  it('leaves the focus where it has gone since, as a stamp’s page hands it to the stamp', () => {
    const field = focusedField()
    const stamp = document.body.appendChild(document.createElement('button'))
    const { unmount } = render(<Sheet label="A sheet" onClose={() => {}} />)
    act(() => stamp.focus())
    unmount()
    expect(document.activeElement).toBe(stamp)
    field.remove()
    stamp.remove()
  })
})
