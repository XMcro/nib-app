import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import './index.css'
import { App } from './App'
import { db } from './db/db'

/**
 * Changing the theme (lib/useTheme's changeTheme): one cross-fade of the whole page,
 * a view transition, with the new theme on the page for its new picture.
 * Not colour transitions on every element, which WebKit runs late for text
 * that takes its colour from its parent.
 */

const original = document.startViewTransition

beforeEach(async () => {
  localStorage.clear()
  await db.items.clear()
  await page.viewport(1280, 800)
})
afterEach(() => {
  cleanup()
  document.startViewTransition = original
  document.documentElement.classList.remove('dark')
})

const toDark = async () => {
  await act(async () => void render(<App />))
  await userEvent.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('button', { name: 'Settings' }))
  await userEvent.click(screen.getByRole('button', { name: 'Light' }))
  await userEvent.click(screen.getByRole('button', { name: 'Dark' }))
}

it('cross-fades the whole page into the new theme', async () => {
  const started = vi.fn()
  document.startViewTransition = ((update: () => void) => {
    started()
    return original.call(document, update)
  }) as typeof document.startViewTransition
  await toDark()
  expect(started).toHaveBeenCalled()
  await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(true)
})

it('simply changes where there are no view transitions', async () => {
  // @ts-expect-error: iOS before 18 has none.
  document.startViewTransition = undefined
  await toDark()
  expect(document.documentElement.classList.contains('dark')).toBe(true)
})
