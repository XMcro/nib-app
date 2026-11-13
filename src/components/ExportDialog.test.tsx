// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportDialog } from './ExportDialog'

/** The sheet that asks what the documents picked in the library export as. */

describe('the export sheet', () => {
  it('says how many, and marks HTML and PDF as Plus’s only without it', () => {
    const { rerender } = render(<ExportDialog count={3} plus={false} onExport={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Export' }).textContent).toContain('Export 3 documents')
    expect(screen.getByRole('button', { name: 'Markdown' }).textContent).toBe('Markdown')
    expect(screen.getByRole('button', { name: /^HTML/ }).textContent).toBe('HTMLPlus')
    expect(screen.getByRole('button', { name: /^PDF/ }).textContent).toBe('PDFPlus')
    rerender(<ExportDialog count={1} plus onExport={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog').textContent).toContain('Export one document')
    expect(screen.getByRole('button', { name: /^PDF/ }).textContent).toBe('PDF')
  })

  it('closes with Cancel, Escape, or a press outside', async () => {
    const onClose = vi.fn()
    render(<ExportDialog count={2} plus onExport={vi.fn()} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('stays up while they’re made, saying which it is on, with nothing to press and no way out', async () => {
    const onClose = vi.fn()
    let making: (which: number, of: number) => void = () => {}
    const onExport = vi.fn((_format: string, tell: typeof making) => {
      making = tell
      return new Promise(() => {})
    })
    render(<ExportDialog count={12} plus onExport={onExport} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'PDF' }))
    expect(onExport).toHaveBeenCalledWith('pdf', expect.any(Function))
    expect(screen.getByRole('status').textContent).toBe('Exporting…')
    act(() => making(3, 11))
    expect(screen.getByRole('status').textContent).toBe('Making 3 of 11…')
    for (const name of ['Markdown', 'HTML', 'PDF']) expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(onClose).not.toHaveBeenCalled()
  })
})
