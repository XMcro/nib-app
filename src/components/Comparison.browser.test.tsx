import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { JSONContent } from '@tiptap/react'
import '../index.css'
import { applyTheme, NAMED, type Theme } from '../lib/theme'
import { Comparison } from './Comparison'

/**
 * What changed, readable on every theme: words taken out struck through and
 * still legible on the library's background, words put in on a colour of
 * their own that the text stands out from, and that stands apart from the
 * page.
 */

const para = (value: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text: value }] })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

const rgb = (color: string) => {
  const [r, g, b] = color.match(/[\d.]+/g)!.map(Number)
  return [r, g, b]
}
const luminance = (color: string) => {
  const [r, g, b] = rgb(color).map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

afterEach(() => {
  cleanup()
  applyTheme('light')
})

const THEMES: Theme[] = ['light', 'dark', ...NAMED.map((one) => one.id)]

describe('a comparison on every theme', () => {
  for (const theme of THEMES) {
    it(`marks what changed readably on ${theme}`, () => {
      applyTheme(theme)
      const { container } = render(
        <div className="bg-shell text-ink">
          <Comparison then={doc(para('The boats came in late.'))} now={doc(para('The boats came in early.'))} at={Date.now()} onBack={() => {}} onRestore={() => {}} onBringBack={() => {}} />
        </div>,
      )
      const shell = getComputedStyle(container.firstElementChild!).backgroundColor
      const removed = getComputedStyle(screen.getByText('late'))
      const added = getComputedStyle(screen.getByText('early'))
      expect(removed.textDecorationLine).toBe('line-through')
      expect(contrast(removed.color, shell)).toBeGreaterThanOrEqual(4.5)
      expect(added.textDecorationLine).toBe('none')
      expect(contrast(added.color, added.backgroundColor)).toBeGreaterThanOrEqual(4.5)
      // Light's yellow is the closest to its page, at 1.18: apart more by its hue than its lightness.
      expect(contrast(added.backgroundColor, shell)).toBeGreaterThanOrEqual(1.15)
    })
  }
})
