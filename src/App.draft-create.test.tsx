// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'

/**
 * Its own file because the mock below is module-wide: the first `items.create`
 * waits until the test lets it finish, so a draft's first save is still in
 * flight when its next one is queued — as with a slow IndexedDB on a busy
 * device. Later creates go straight through.
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

const creating = vi.hoisted(() => ({ calls: 0, held: null as Promise<void> | null, release: () => {} }))
vi.mock('./db/items', async (importOriginal) => {
  const real = await importOriginal<typeof import('./db/items')>()
  return {
    ...real,
    create: async (...args: Parameters<typeof real.create>) => {
      const held = creating.calls++ === 0 ? creating.held : null
      await held
      return real.create(...args)
    },
  }
})

const { App } = await import('./App')
const { db } = await import('./db/db')

const textOf = (body: JSONContent) => body.content?.[0]?.content?.[0]?.text ?? ''

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
  creating.calls = 0
  creating.held = new Promise((resolve) => (creating.release = resolve))
})

describe('App saving a new draft', () => {
  it('stores it once when a second save is queued before the first lands', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByTestId('editor'), 'Hello')
    // The debounced save has started creating the draft, and is held there.
    await waitFor(() => expect(creating.calls).toBe(1), { timeout: 2000 })

    await user.type(screen.getByTestId('editor'), ' world')
    await user.click(screen.getByPlaceholderText(/Search/)) // a blur saves at once
    act(() => creating.release())

    await waitFor(async () => expect((await db.items.toArray()).map((item) => textOf(item.body))).toContain('Hello world'))
    // Long enough for a second document, if one was coming, to have been stored.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect((await db.items.toArray()).map((item) => textOf(item.body))).toEqual(['Hello world'])
  })
})
