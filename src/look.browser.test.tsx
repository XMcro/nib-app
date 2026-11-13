import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { act, cleanup, render, screen } from '@testing-library/react'
import { App } from './App'
import { ACCENTS, DEFAULT_LOOK, HIGHLIGHTS, applyLook, parseLook, resetLook, setLook, type Accent, type Highlight } from './lib/look'
import { applyTheme, NAMED, type Theme } from './lib/theme'
import './index.css'

/**
 * Customize (lib/look) promises that a writer who never opens it sees Nib as
 * it was. These are the values Nib had before it existed, read off the real
 * app, so a default that drifts fails here rather than in someone's library.
 */

const subscriber = vi.hoisted(() => ({ active: false }))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [{ active: subscriber.active }, () => {}, true],
}))

const root = document.documentElement
const editor = () => document.querySelector<HTMLElement>('.ProseMirror')
const column = () => editor()!.closest('[data-scroll]')!.firstElementChild!
const style = (element: Element) => getComputedStyle(element)

async function open(kind: 'note' | 'page') {
  await act(async () => void render(<App />))
  if (kind === 'page') await act(async () => screen.getByRole('tab', { name: 'Pages' }).click())
  await act(async () => screen.getByRole('button', { name: kind === 'note' ? /New note/ : /New page/ }).click())
  await expect.poll(editor).not.toBeNull()
}

beforeEach(() => page.viewport(1280, 800))

afterEach(() => {
  cleanup()
  resetLook()
  subscriber.active = false
  for (const name of Object.keys(root.dataset)) delete root.dataset[name]
  root.classList.remove('dark')
  root.removeAttribute('style')
})

describe('with nothing chosen', () => {
  it('a note looks as it did', async () => {
    await open('note')
    for (const name of ['size', 'width', 'motion', 'notesFont', 'pagesFont', 'accent']) expect(root.dataset[name], name).toBeUndefined()
    expect(style(editor()!).fontSize).toBe('15px')
    expect(style(editor()!).fontFamily).toMatch(/^"IBM Plex Mono"/)
    expect(style(column()).maxWidth).toBe('680px')
    expect(style(root).getPropertyValue('--m').trim()).toBe('1')
    expect(style(root).getPropertyValue('--color-accent').trim()).toBe('#4a7a8c')
    expect(screen.getByRole('button', { name: 'Empty' })).toBeTruthy()
  })

  it('a page looks as it did', async () => {
    await open('page')
    expect(style(editor()!).fontSize).toBe('17px')
    expect(style(editor()!).fontFamily).toMatch(/^"Inter Variable"/)
  })

  it('headings are their old sizes', () => {
    const host = document.createElement('div')
    host.innerHTML = '<div class="nib-editor nib-editor-page"><h1>T</h1><h2>H</h2><h3>S</h3></div>'
    document.body.append(host)
    const sizes = () => [...host.querySelectorAll('h1, h2, h3')].map((heading) => style(heading).fontSize)
    expect(sizes()).toEqual(['28px', '22px', '18px'])
    applyLook(parseLook({ size: 'larger' }))
    expect(sizes()).toEqual(['35px', '27.5px', '22.5px'])
    host.remove()
  })
})

describe('the free options', () => {
  it('change the text, its width, the motion and what shows', async () => {
    await open('note')
    await act(async () => setLook({ size: 'larger', width: 'narrow', motion: 'none', wordCount: false }))
    expect(style(editor()!).fontSize).toBe('18.75px')
    expect(style(column()).maxWidth).toBe('580px')
    expect(style(root).getPropertyValue('--m').trim()).toBe('0')
    expect(screen.queryByRole('button', { name: 'Empty' })).toBeNull()

    await act(async () => setLook({ width: 'wide', motion: 'less' }))
    expect(style(column()).maxWidth).toBe('800px')
    expect(style(root).getPropertyValue('--m').trim()).toBe('0.5')
  })

  // 1.7 of 15px as standard; tight and airy either side.
  it('change the line spacing', async () => {
    await open('note')
    expect(style(editor()!).lineHeight).toBe('25.5px')
    await act(async () => setLook({ spacing: 'tight' }))
    expect(style(editor()!).lineHeight).toBe('22.5px')
    await act(async () => setLook({ spacing: 'airy' }))
    expect(style(editor()!).lineHeight).toBe('29.25px')
  })
})

describe('paragraphs on a page', () => {
  it('are lines as standard, spaced or indented as chosen, and justified but for table cells', () => {
    const host = document.createElement('div')
    host.innerHTML =
      '<div class="nib-editor nib-editor-page"><p>One</p><p>Two</p><h2>Head</h2><p>Three</p><ul><li><p>Item</p></li></ul><table><tr><td><p>Cell</p></td></tr></table></div>'
    document.body.append(host)
    const [, two, three, item, cell] = host.querySelectorAll('p')
    const read = (p: Element) => `${style(p).marginTop} ${style(p).textIndent} ${style(p).textAlign}`

    expect([two, three].map(read)).toEqual(['0px 0px start', '0px 0px start'])
    applyLook(parseLook({ paragraphs: 'spaced' }))
    // 0.75em of 17px; none under a heading.
    expect([two, three].map(read)).toEqual(['12.75px 0px start', '0px 0px start'])
    applyLook(parseLook({ paragraphs: 'indented' }))
    expect([two, three].map(read)).toEqual(['0px 25.5px start', '0px 0px start'])
    applyLook(parseLook({ align: 'justified' }))
    expect([two, item, cell].map((p) => style(p).textAlign)).toEqual(['justify', 'justify', 'left'])
    expect(style(two).hyphens).toBe('auto')
    host.remove()
  })
})

describe('the Nib Plus options', () => {
  it('are not drawn without Plus, though they stay chosen', async () => {
    await open('note')
    await act(async () => setLook({ notesFont: 'serif', accent: 'red' }))
    expect(style(editor()!).fontFamily).toMatch(/^"IBM Plex Mono"/)
    expect(root.dataset.accent).toBeUndefined()
  })

  it('change the fonts with Plus', async () => {
    subscriber.active = true
    await open('note')
    await act(async () => setLook({ notesFont: 'serif', pagesFont: 'mono' }))
    expect(style(editor()!).fontFamily).toMatch(/^"Literata Variable"/)
  })
})

// Links are drawn in the accent, so each shade has to read as text; and
// highlighted text keeps the theme's ink, so the ink has to read on each
// highlight.
describe('every accent and highlight', () => {
  const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
  const luminance = (hex: string) => {
    const [r, g, b] = rgb(hex).map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }

  it.each<Theme>(['light', 'dark', ...NAMED.map((theme) => theme.id)])('reads at 4.5:1 or more in %s', (theme) => {
    applyTheme(theme)
    for (const accent of Object.keys(ACCENTS) as Accent[]) {
      applyLook({ ...DEFAULT_LOOK, accent })
      const [ink, paper] = ['--color-accent', '--color-paper'].map((name) => style(root).getPropertyValue(name).trim())
      expect(ink, accent).toBe(root.classList.contains('dark') ? ACCENTS[accent].dark : ACCENTS[accent].light)
      expect(contrast(ink, paper), `${accent} on ${theme}`).toBeGreaterThanOrEqual(4.5)
    }
    for (const highlight of Object.keys(HIGHLIGHTS) as Highlight[]) {
      applyLook({ ...DEFAULT_LOOK, highlight })
      const [mark, ink] = ['--color-highlight', '--color-ink'].map((name) => style(root).getPropertyValue(name).trim())
      expect(mark, highlight).toBe(root.classList.contains('dark') ? HIGHLIGHTS[highlight].dark : HIGHLIGHTS[highlight].light)
      expect(contrast(ink, mark), `${highlight} under ${theme}'s ink`).toBeGreaterThanOrEqual(4.5)
    }
    delete root.dataset.theme
  })

  // Nib's own theme, Christmas Day's present (lib/rewards): its text and accent, before anything is chosen over them.
  it('reads at 4.5:1 or more in Winter’s own colours', () => {
    applyTheme('winter')
    applyLook(DEFAULT_LOOK)
    const paper = style(root).getPropertyValue('--color-paper').trim()
    for (const name of ['--color-ink', '--color-muted', '--color-accent']) {
      expect(contrast(style(root).getPropertyValue(name).trim(), paper), name).toBeGreaterThanOrEqual(4.5)
    }
    delete root.dataset.theme
  })
})
