import { afterEach, describe, expect, it, vi } from 'vitest'
import '../index.css'

/** iOS's Larger Text: read from the system's body font, here stood in for, as only iOS has one that moves. */

const ROOT = '-webkit-text-size-adjust'
const set = () => document.documentElement.style.getPropertyValue(ROOT)

vi.mock('./platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./platform')>()), touchApp: true }))
const { followLargerText } = await import('./textSize')

function start(bodySize: string) {
  const real = window.getComputedStyle.bind(window)
  // As iOS does: what it reports for an element is scaled by what's in force there.
  const reported = (probe: HTMLElement) => parseFloat(bodySize) * (probe.style.getPropertyValue(ROOT) === '100%' ? 1 : parseFloat(set() || '100') / 100)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => (element instanceof HTMLElement && element.hidden ? ({ fontSize: `${reported(element)}px` } as CSSStyleDeclaration) : real(element, pseudo)))
  followLargerText()
}

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.style.removeProperty(ROOT)
})

describe('Larger Text', () => {
  it('leaves everything alone at the default size', () => {
    start('17px')
    expect(set()).toBe('')
  })

  it('leaves everything alone below it', () => {
    start('14px')
    expect(set()).toBe('')
  })

  it('scales Nib’s own words by as much as iOS has moved', () => {
    start('19px')
    expect(set()).toBe('112%')
  })

  it('stops at the largest of the ordinary sizes', () => {
    start('53px')
    expect(set()).toBe('135%')
  })

  it('reads iOS’s size each time Nib comes back, not its own scale', () => {
    start('19px')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(set()).toBe('112%')
  })

  it('leaves the writing and the fields as they are', () => {
    start('53px')
    const writing = document.body.appendChild(document.createElement('div'))
    writing.className = 'nib-editor'
    const field = document.body.appendChild(document.createElement('input'))
    expect(window.getComputedStyle(writing).webkitTextSizeAdjust).toBe('100%')
    expect(window.getComputedStyle(field).webkitTextSizeAdjust).toBe('100%')
    writing.remove()
    field.remove()
  })
})
