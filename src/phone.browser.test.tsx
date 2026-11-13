// The Playwright provider's types, for cdp()'s send (touch emulation below).
/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { cdp, page } from 'vitest/browser'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { App } from './App'
import './index.css'

/**
 * The library and the text at a phone's size and a desktop's, and where the
 * text starts under the controls above it. Only a real layout can show these.
 */

const library = () => document.querySelector<HTMLElement>('.nib-library')!
const main = () => document.querySelector('main')!
const newNote = () => act(async () => within(library()).getByRole('button', { name: 'New note' }).click())

afterEach(cleanup)

describe('at phone width', () => {
  it('starts a document from the round button, the text the whole screen, and goes back to the list', async () => {
    await page.viewport(375, 812)
    await act(async () => void render(<App />))
    expect(getComputedStyle(within(library()).getByRole('button', { name: 'New note' })).position).toBe('fixed')

    await newNote()
    await expect.poll(() => library().dataset.open).toBe('false')
    expect(main().getBoundingClientRect().width).toBe(375)

    await act(async () => within(main()).getByRole('button', { name: 'Notes' }).click())
    await expect.poll(() => library().dataset.open).toBe('true')
  })
})

describe('at desktop width', () => {
  it('puts the library away for a new note, with the cursor ready', async () => {
    await page.viewport(1280, 800)
    await act(async () => void render(<App />))
    await newNote()
    await expect.poll(() => library().dataset.open).toBe('false')
    // Outside the iOS app a new note is "cursor ready" (nativeFocus.browser.test).
    await expect.poll(() => document.activeElement?.closest('.ProseMirror')).not.toBeNull()
  })
})

describe('a phone on its side', () => {
  // Wider than `sm`, so by width alone it was a desktop, with a desktop's
  // controls to reach by touch.
  it('is a phone too: the phone rules answer to a touch screen under 500px tall', async () => {
    await page.viewport(800, 400)
    const element = document.createElement('div')
    element.className = 'phone:fixed'
    document.body.append(element)
    onTestFinished(() => element.remove())
    expect(getComputedStyle(element).position).toBe('static')

    await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    try {
      expect(getComputedStyle(element).position).toBe('fixed')
    } finally {
      await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: false })
    }
  })
})

describe('the top of the text', () => {
  it.each([
    [375, 812],
    [1280, 800],
  ])('scrolls away under the way back, Commands and Settings rather than behind them, at %ix%i', async (width, height) => {
    await page.viewport(width, height)
    await act(async () => void render(<App />))
    await newNote()
    await expect.poll(() => library().dataset.open).toBe('false')
    const scroller = document.querySelector<HTMLElement>('[data-scroll]')!.getBoundingClientRect()
    for (const name of ['Notes', 'Settings']) expect(within(main()).getByRole('button', { name }).getBoundingClientRect().bottom, name).toBeLessThanOrEqual(scroller.top)
    // Unscrolled, the text starts where it always did: 114px down, once it has arrived.
    document.querySelector('.ProseMirror')!.getAnimations().forEach((animation) => animation.finish())
    const text = document.querySelector('.ProseMirror')!.getBoundingClientRect()
    expect(Math.round(text.top - main().getBoundingClientRect().top)).toBe(114)
  })
})

describe('the settings screen', () => {
  it('scrolls, with Advanced open, rather than running past the top of a short screen', async () => {
    await page.viewport(874, 402)
    await act(async () => void render(<App />))
    await act(async () => within(library()).getByRole('button', { name: 'Settings' }).click())
    await act(async () => screen.getByRole('button', { name: /Advanced/ }).click())
    const sheet = screen.getByRole('dialog', { name: 'Settings' }).getBoundingClientRect()
    expect(sheet.top).toBeGreaterThanOrEqual(0)
    expect(sheet.bottom).toBeLessThanOrEqual(402)
    let scroller: HTMLElement | null = screen.getByRole('button', { name: /Advanced/ })
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && getComputedStyle(scroller).overflowY === 'auto')) scroller = scroller.parentElement
    expect(screen.getByRole('dialog', { name: 'Settings' }).contains(scroller)).toBe(true)
  })
})
