import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CALLOUT_KINDS } from './lib/callouts'
import { applyTheme, NAMED } from './lib/theme'
import './index.css'

/**
 * Every named theme has its colours in index.css, and they read: the text on
 * its paper at 7:1 or more, the muted text at 4.5:1. Measured from the
 * computed styles, so a misspelt selector or a missing block fails here.
 */

const rgb = (color: string) => color.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number)
const luminance = (color: string) => {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function colours() {
  const probe = (cls: string) => {
    const element = document.createElement('div')
    element.className = cls
    document.body.append(element)
    return element
  }
  const paper = getComputedStyle(probe('bg-paper')).backgroundColor
  const ink = getComputedStyle(probe('text-ink')).color
  const muted = getComputedStyle(probe('text-muted')).color
  return { paper, ink, muted }
}

// The tag index.html has, that a theme paints the window's chrome through.
beforeAll(() => {
  const tag = document.createElement('meta')
  tag.name = 'theme-color'
  document.head.append(tag)
})

afterEach(() => {
  document.body.replaceChildren()
  applyTheme('light')
})

/** A colour as it lands on the paper under it: computed ones can be color(), with alpha, which rgb() above can't read. */
function painted(color: string, under: string) {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  context.fillStyle = under
  context.fillRect(0, 0, 1, 1)
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return `rgb(${r}, ${g}, ${b})`
}

describe('callouts', () => {
  const THEMES = ['light', 'dark', ...NAMED.map((one) => one.id), 'custom'] as const
  it.each(THEMES)('all eight read on %s: the words on the box, and its icon and rule', (theme) => {
    applyTheme(theme)
    const { paper, ink } = colours()
    for (const kind of CALLOUT_KINDS) {
      const box = document.body.appendChild(document.createElement('div'))
      box.className = 'nib-callout'
      box.dataset.callout = kind
      const style = getComputedStyle(box)
      const behind = painted(style.backgroundColor, paper)
      expect(behind, kind).not.toBe(paper)
      expect(contrast(ink, behind), `${kind}: words`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(painted(style.borderInlineStartColor, behind), behind), `${kind}: icon`).toBeGreaterThanOrEqual(3)
    }
  })

  it('are told apart by colour on every theme', () => {
    for (const theme of THEMES.filter((one) => one !== 'custom')) {
      applyTheme(theme)
      const colors = CALLOUT_KINDS.map((kind) => {
        const box = document.body.appendChild(document.createElement('div'))
        box.className = 'nib-callout'
        box.dataset.callout = kind
        return getComputedStyle(box).borderInlineStartColor
      })
      expect(new Set(colors).size, theme).toBe(8)
    }
  })
})

describe('the named themes', () => {
  it.each(NAMED.map((one) => [one.label, one] as const))('%s has its own colours, and they read', (_, one) => {
    applyTheme('light')
    const light = colours()
    applyTheme(one.id)
    expect(document.documentElement.dataset.theme).toBe(one.id)
    expect(document.documentElement.classList.contains('dark')).toBe(one.dark)
    const { paper, ink, muted } = colours()
    expect(paper).not.toBe(light.paper)
    expect(contrast(ink, paper)).toBeGreaterThanOrEqual(7)
    expect(contrast(muted, paper)).toBeGreaterThanOrEqual(4.5)
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe(one.shell)
  })

  it('takes its colours off again for Light', () => {
    applyTheme('alien-pink')
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
