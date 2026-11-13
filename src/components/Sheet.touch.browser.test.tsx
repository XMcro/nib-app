import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '../index.css'
import { Sheet } from './Sheet'

/** On iPhone and iPad: focus raises and drops the keyboard, so a sheet minds where it is. */

vi.mock('../lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/platform')>()), nativeApp: true, macApp: false, touchApp: true }))

afterEach(cleanup)

function writing() {
  const under = document.body.appendChild(document.createElement('div'))
  under.dataset.underSheets = ''
  const field = under.appendChild(document.createElement('div'))
  field.contentEditable = 'true'
  onTestFinished(() => under.remove())
  return { under, field }
}

describe('a sheet on a touch screen', () => {
  it('with the caret in the writing, leaves it there, and the writing not inert, as that would drop the keyboard', () => {
    const { under, field } = writing()
    field.focus()
    render(<Sheet label="A sheet" onClose={() => {}} />)
    expect(document.activeElement).toBe(field)
    expect(under.hasAttribute('inert')).toBe(false)
  })

  it('with no field in use, moves no focus, and holds what’s under it out of reach', () => {
    const { under } = writing()
    render(<Sheet label="A sheet" onClose={() => {}} />)
    expect(document.activeElement).toBe(document.body)
    expect(under.hasAttribute('inert')).toBe(true)
  })

  it('come up unasked, takes the focus itself, for VoiceOver', () => {
    writing()
    render(<Sheet label="A sheet" onClose={() => {}} focusOnTouch />)
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('doesn’t hand the focus back as it goes, which would raise the keyboard', () => {
    const { field } = writing()
    field.focus()
    const { unmount } = render(<Sheet label="A sheet" onClose={() => {}} focusOnTouch />)
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    unmount()
    expect(document.activeElement).not.toBe(field)
  })
})
