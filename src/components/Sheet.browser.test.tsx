import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { cleanup, render, screen } from '@testing-library/react'
import '../index.css'
import { Sheet } from './Sheet'

afterEach(cleanup)

describe('what’s under a sheet', () => {
  function writing() {
    const under = document.body.appendChild(document.createElement('div'))
    under.dataset.underSheets = ''
    const field = under.appendChild(document.createElement('textarea'))
    onTestFinished(() => under.remove())
    return { under, field }
  }

  it('is out of reach while it’s up, and has the focus back after', () => {
    const { under, field } = writing()
    field.focus()
    const { unmount } = render(<Sheet label="A sheet" onClose={() => {}} />)
    expect(under.hasAttribute('inert')).toBe(true)
    field.focus()
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    unmount()
    expect(under.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(field)
  })

  it('comes back with the last of two', () => {
    const { under } = writing()
    const first = render(<Sheet label="First" onClose={() => {}} />)
    const second = render(<Sheet label="Second" onClose={() => {}} />)
    second.unmount()
    expect(under.hasAttribute('inert')).toBe(true)
    first.unmount()
    expect(under.hasAttribute('inert')).toBe(false)
  })
})

describe('the keyboard in a sheet', () => {
  it('goes round with Tab, and stays', async () => {
    render(
      <Sheet label="A sheet" onClose={() => {}}>
        <button>First</button>
        <button>Last</button>
      </Sheet>,
    )
    const first = screen.getByRole('button', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })
    await userEvent.tab()
    expect(document.activeElement).toBe(first)
    await userEvent.tab()
    expect(document.activeElement).toBe(last)
    await userEvent.tab()
    expect(document.activeElement).toBe(first)
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(last)
    ;(document.activeElement as HTMLElement).blur()
    await userEvent.tab()
    expect(document.activeElement).toBe(first)
  })

  it('closes the sheet on top with Escape, with the focus fallen out of it', async () => {
    const lower = vi.fn()
    const upper = vi.fn()
    render(<Sheet label="Lower" onClose={lower} />)
    render(<Sheet label="Upper" onClose={upper} />)
    ;(document.activeElement as HTMLElement).blur()
    await userEvent.keyboard('{Escape}')
    expect(upper).toHaveBeenCalledOnce()
    expect(lower).not.toHaveBeenCalled()
  })

  it('closes once with Escape, with the focus in it', async () => {
    const onClose = vi.fn()
    render(<Sheet label="A sheet" onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('a sheet taller than the window', () => {
  it('scrolls, so what’s at its foot can be reached', async () => {
    await page.viewport(844, 390)
    render(
      <Sheet label="A sheet" onClose={() => {}} className="h-fit w-[300px] bg-paper">
        <div style={{ height: 700 }} />
        <button>At its foot</button>
      </Sheet>,
    )
    const foot = screen.getByRole('button', { name: 'At its foot' })
    foot.scrollIntoView({ block: 'end' })
    expect(foot.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight + 1)
  })
})
