import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import html from '../index.html?raw'
import { App } from './App'
import { DEFAULT_LOOK, applyLook, resetLook, setLook } from './lib/look'
import { palette, type OwnColors } from './lib/ownTheme'
import { applyTheme, OWN_PALETTE_KEY } from './lib/theme'
import './index.css'

/** A theme of one's own (lib/ownTheme), drawn by index.css, from first paint on. */

const subscriber = vi.hoisted(() => ({ active: true }))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [{ active: subscriber.active }, () => {}, true],
}))

const root = document.documentElement
const NIGHT: OwnColors = { paper: '#14161a', ink: '#e8e4da', accent: '#7fb4d6' }
const color = (name: string) => getComputedStyle(root).getPropertyValue(name).trim()

afterEach(() => {
  cleanup()
  resetLook()
  localStorage.clear()
  subscriber.active = true
  for (const name of Object.keys(root.dataset)) delete root.dataset[name]
  root.classList.remove('dark')
  root.removeAttribute('style')
})

describe('one’s own theme on the page', () => {
  it('draws its colours, dark if its page is, and leaves no trace once another is chosen', () => {
    applyTheme('custom', NIGHT)
    const { vars } = palette(NIGHT)
    expect(root.dataset.theme).toBe('custom')
    expect(root.classList.contains('dark')).toBe(true)
    expect([color('--color-paper'), color('--color-ink'), color('--color-muted'), color('--color-accent')]).toEqual([vars.paper, vars.ink, vars.muted, vars.accent])
    expect(JSON.parse(localStorage.getItem(OWN_PALETTE_KEY)!)).toEqual(palette(NIGHT))

    applyTheme('light')
    expect(root.dataset.theme).toBeUndefined()
    expect(root.style.getPropertyValue('--own-paper')).toBe('')
    expect(color('--color-paper')).toBe('#ffffff')
  })

  it('draws a library background and a highlight that were chosen, and keeps them for the first paint', () => {
    const chosen: OwnColors = { ...NIGHT, shell: '#0b0c0e', highlight: '#3a2f55' }
    applyTheme('custom', chosen)
    expect([color('--color-shell'), color('--color-highlight')]).toEqual(['#0b0c0e', '#3a2f55'])
    expect(JSON.parse(localStorage.getItem(OWN_PALETTE_KEY)!).vars).toMatchObject({ shell: '#0b0c0e', highlight: '#3a2f55' })
    // A highlight chosen in Customize is still chosen over the theme's.
    applyLook({ ...DEFAULT_LOOK, highlight: 'blue' })
    expect(color('--color-highlight')).toBe('#156095')
  })

  // As over any theme: a chosen accent is chosen.
  it('gives way to an accent chosen in Customize', () => {
    applyTheme('custom', NIGHT)
    applyLook({ ...DEFAULT_LOOK, accent: 'orange' })
    expect(color('--color-accent')).toBe('#e67219')
  })
})

describe('the first paint', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
  const run = () => new Function(script)()

  it('draws one’s own theme before Nib’s own script has run', () => {
    localStorage.setItem('nib-theme', 'custom')
    localStorage.setItem(OWN_PALETTE_KEY, JSON.stringify(palette(NIGHT)))
    run()
    expect(root.dataset.theme).toBe('custom')
    expect(root.classList.contains('dark')).toBe(true)
    expect(color('--color-paper')).toBe(NIGHT.paper)
  })

  it('follows the system instead if what is kept is not colours, and carries on past it', () => {
    localStorage.setItem('nib-theme', 'custom')
    localStorage.setItem(OWN_PALETTE_KEY, JSON.stringify({ dark: true, vars: { paper: 'url(x)', ink: '#ffffff' } }))
    localStorage.setItem('nib-keys', '1')
    run()
    expect(root.dataset.theme).toBeUndefined()
    expect(root.style.getPropertyValue('--own-paper')).toBe('')
    expect(root.dataset.keys).toBe('')
  })
})

describe('the app', () => {
  it('opens in one’s own theme with Plus, and in System without', async () => {
    await page.viewport(1280, 800)
    localStorage.setItem('nib-theme', 'custom')
    setLook({ ownTheme: NIGHT })
    await act(async () => void render(<App />))
    expect(root.dataset.theme).toBe('custom')
    expect(color('--color-paper')).toBe(NIGHT.paper)
    await act(async () => within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('button', { name: 'Settings' }).click())
    expect(screen.getByRole('radio', { name: /Your own/ }).getAttribute('aria-checked')).toBe('true')
    cleanup()

    subscriber.active = false
    await act(async () => void render(<App />))
    expect(root.dataset.theme).toBeUndefined()
  })
})
