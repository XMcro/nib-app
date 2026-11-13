import { afterEach, expect, it, vi } from 'vitest'
import { followLargerText } from './textSize'

afterEach(() => vi.restoreAllMocks())

it('does nothing off iPhone and iPad, a Mac among them', () => {
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => (element instanceof HTMLElement && element.hidden ? ({ fontSize: '53px' } as CSSStyleDeclaration) : real(element, pseudo)))
  followLargerText()
  expect(document.documentElement.style.getPropertyValue('-webkit-text-size-adjust')).toBe('')
})
