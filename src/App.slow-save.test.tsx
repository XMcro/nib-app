// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'

/**
 * Its own file because the mock below is module-wide: the first `items.update`
 * waits until the test lets it finish, so a document's save is still being
 * written when its next one is queued, as with a long page on a busy device.
 * Later saves go straight through.
 */

vi.mock('./editor/Editor', () => {
  const read = (body?: JSONContent) => body?.content?.[0]?.content?.[0]?.text ?? ''
  const write = (text: string): JSONContent => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  })
  return {
    Editor: ({
      initialBody,
      onChange,
      onBlur,
    }: {
      initialBody?: JSONContent
      onChange: (body: JSONContent) => void
      onBlur?: () => void
    }) => (
      <textarea
        data-testid="editor"
        defaultValue={read(initialBody)}
        onChange={(event) => onChange(write(event.target.value))}
        onBlur={() => onBlur?.()}
      />
    ),
  }
})

const saving = vi.hoisted(() => ({ calls: 0, held: null as Promise<void> | null, release: () => {} }))
vi.mock('./db/items', async (importOriginal) => {
  const real = await importOriginal<typeof import('./db/items')>()
  return {
    ...real,
    update: async (...args: Parameters<typeof real.update>) => {
      const held = saving.calls++ === 0 ? saving.held : null
      await held
      return real.update(...args)
    },
  }
})

const { App } = await import('./App')
const { db } = await import('./db/db')
const items = await import('./db/items')

const textOf = (body: JSONContent) => body.content?.[0]?.content?.[0]?.text ?? ''
const bodyOf = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
  saving.calls = 0
  saving.held = new Promise((resolve) => (saving.release = resolve))
})

describe('App saving while a save is still being written', () => {
  // The second save was queued at the version the first had yet to move on, and so took the first for another tab's.
  it('doesn’t take its own earlier save for an edit made elsewhere', async () => {
    const id = await items.create('note', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('MINE'))

    await user.type(screen.getByTestId('editor'), '!')
    await user.click(screen.getByPlaceholderText(/Search/)) // a blur saves at once, and is held
    await waitFor(() => expect(saving.calls).toBe(1))
    await user.type(screen.getByTestId('editor'), '?')
    await user.click(screen.getByPlaceholderText(/Search/)) // queued behind it
    act(() => saving.release())

    await waitFor(async () => expect(textOf((await items.get(id))!.body)).toBe('MINE!?'))
    // Long enough for the notice, if one was coming, to have been shown.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(screen.queryByText(/Also edited elsewhere/)).toBeNull()
    expect((await items.get(id))!.version).toBe(3)
  })
})
