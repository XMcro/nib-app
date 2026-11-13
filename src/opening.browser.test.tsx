import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import './index.css'
import { App } from './App'
import { db } from './db/db'
import * as items from './db/items'

/**
 * The loading screen (index.html's #nib-opening, lib/opening): faded once
 * App has its lists and its line of ink is drawn, then taken away.
 */

const cover = (line?: string) => {
  const element = document.createElement('div')
  element.id = 'nib-opening'
  if (line) element.innerHTML = `<svg class="nib-line"><path d="${line}" /></svg>`
  document.body.append(element)
  return element
}

beforeEach(async () => {
  localStorage.clear()
  await db.items.clear()
  await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Already here' }] }] })
})
afterEach(() => {
  cleanup()
  document.getElementById('nib-opening')?.remove()
})

it('fades once the lists are in, then goes', async () => {
  const opening = cover()
  await act(async () => void render(<App />))
  await expect.poll(() => opening.classList.contains('opened')).toBe(true)
  expect(document.querySelector('.nib-library')?.textContent).toContain('Already here')
  await expect.poll(() => document.getElementById('nib-opening')).toBeNull()
})

it('doesn’t wait for a line of ink already drawn', async () => {
  const opening = cover('M4 13H128')
  opening.classList.add('drawing')
  await opening.querySelector('path')!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1, fill: 'forwards' }).finished
  await act(async () => void render(<App />))
  await expect.poll(() => opening.dataset.ending).toBe('')
  expect(opening.classList.contains('opened')).toBe(true)
})

it('waits for its line of ink, but not past the moment it should have been drawn', async () => {
  const opening = cover('M4 13H128')
  const drawing = opening.querySelector('path')!.animate([{ opacity: 0 }, { opacity: 1 }], 5000)
  // The wait is counted out by hand, however long App takes to get its lists.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => void vi.useRealTimers())
  await act(async () => void render(<App />))
  await expect
    .poll(async () => {
      await act(async () => void vi.advanceTimersByTime(1))
      return opening.dataset.ending
    })
    .toBe('')
  expect(opening.classList.contains('opened')).toBe(false)
  await act(async () => void vi.advanceTimersByTime(1000))
  expect(opening.classList.contains('opened')).toBe(true)
  expect(drawing.playState).toBe('running')
})
