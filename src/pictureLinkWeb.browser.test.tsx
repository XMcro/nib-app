import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import './index.css'
import { App } from './App'
import { db } from './db/db'
import * as items from './db/items'

/**
 * Add a picture from a link, outside the app: a browser's page can't fetch
 * from another site (lib/csp), and has no native side to do it for it
 * (lib/pictureLink), so the row isn't there to lead nowhere. The app's own
 * side is pictureLink.browser.test.
 */

beforeEach(async () => {
  localStorage.clear()
  await db.items.clear()
  await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Harbour notes' }] }] })
  await page.viewport(1280, 800)
})
afterEach(cleanup)

describe('Add a picture from a link, outside the app', () => {
  it('isn’t in Commands', async () => {
    await act(async () => void render(<App />))
    await userEvent.click(await within(document.querySelector<HTMLElement>('.nib-library')!).findByText('Harbour notes'))
    await expect.poll(() => document.querySelector('main [data-scroll] .ProseMirror')?.textContent).toContain('Harbour notes')
    await userEvent.keyboard('{Meta>}k{/Meta}{Control>}k{/Control}')
    const rows = within(await screen.findByRole('dialog', { name: 'Commands' }))
    expect(rows.getByText('Focus mode')).toBeTruthy()
    expect(rows.queryByText('Add a picture from a link…')).toBeNull()
  })
})
