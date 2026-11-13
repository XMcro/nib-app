// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'

/**
 * A reminder on a note, outside the app: a browser can't ring, so it sets
 * none and shows none, and a note's reminder stays with it for the devices
 * that can. Its own file: App.reminders.test stands in for the app.
 */

vi.mock('./editor/Editor', () => {
  const read = (body?: JSONContent) => body?.content?.[0]?.content?.[0]?.text ?? ''
  return { Editor: ({ initialBody }: { initialBody?: JSONContent }) => <textarea data-testid="editor" defaultValue={read(initialBody)} /> }
})

const { App } = await import('./App')
const { db } = await import('./db/db')
const items = await import('./db/items')
const MOD = /Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? 'Meta' : 'Control'

beforeEach(async () => {
  await db.items.clear()
  localStorage.clear()
})
afterEach(cleanup)

describe('a note with a reminder, in a browser', () => {
  it('shows nothing of it, offers none, and keeps it', async () => {
    const at = Date.now() + 3_600_000
    await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ferry at 07:40' }] }] }, { id: 'ferry' })
    await items.setReminder('ferry', { at })
    const user = userEvent.setup()
    render(<App />)
    const card = await screen.findByText('Ferry at 07:40')
    expect(screen.queryByText(/^Reminder /)).toBeNull()
    await user.click(card)
    await screen.findByTestId('editor')
    expect(screen.queryByRole('button', { name: /^Reminder · / })).toBeNull()
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await screen.findByRole('dialog', { name: 'Commands' })
    expect(screen.queryByText('Remind me…')).toBeNull()
    expect(screen.queryByText('Change reminder…')).toBeNull()
    expect((await items.get('ferry'))!.reminder).toEqual({ at })
  })
})
