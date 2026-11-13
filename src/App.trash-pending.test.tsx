// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'

/**
 * Its own file because the mock below is module-wide: `onBlur` is deliberately
 * omitted. App.test.tsx wires blur to `flush()`, and `userEvent.click` on the
 * trash button blurs the textarea first — so that file cannot see `destroy()`
 * drop `pending`. The path this covers is a click that does not steal focus,
 * which is how iOS treats a tap on a `<button>` while a contenteditable is
 * focused: the editor never blurs, and the 400ms debounce is still sitting
 * there when × runs.
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
    }: {
      initialBody?: JSONContent
      onChange: (body: JSONContent) => void
    }) => (
      <textarea
        data-testid="editor"
        defaultValue={read(initialBody)}
        onChange={(event) => onChange(write(event.target.value))}
      />
    ),
  }
})

const { App } = await import('./App')
const { db } = await import('./db/db')
const items = await import('./db/items')

const textOf = (body: JSONContent) => body.content?.[0]?.content?.[0]?.text ?? ''
const bodyOf = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
})

describe('App trash of the open document', () => {
  async function openAndEdit(user: ReturnType<typeof userEvent.setup>, title: string) {
    await user.click(await screen.findByText(title))
    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe(title),
    )
  }

  // destroy() used to drop `pending` so a later flush could not recreate the
  // note after remount. That was right when × permanently destroyed the record;
  // now it only moves it to trash, and the last keystrokes have to travel with it.
  it('keeps unflushed keystrokes in the trash copy', async () => {
    await items.create('note', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await openAndEdit(user, 'MINE')

    await user.type(screen.getByTestId('editor'), '!')
    await user.click(screen.getByLabelText(/^Move .* to trash$/))

    await waitFor(async () => expect(await items.listTrash()).toHaveLength(1))
    expect(textOf((await items.listTrash())[0].body)).toBe('MINE!')
    expect(await items.list('note')).toHaveLength(0)
  })

  // The flush-on-trash is scoped to the open document. Trashing a different
  // row must not remount the editor or drop the keystrokes still in `pending`.
  it('leaves the open document alone when a different row is trashed', async () => {
    const keep = await items.create('note', bodyOf('KEEP'))
    await items.create('note', bodyOf('TOSS'))
    const user = userEvent.setup()
    render(<App />)
    await openAndEdit(user, 'KEEP')
    await user.type(screen.getByTestId('editor'), '!')

    const tossRow = screen.getByText('TOSS').closest('[data-id]') as HTMLElement
    await user.click(within(tossRow).getByLabelText(/^Move .* to trash$/))

    await waitFor(async () => expect(await items.listTrash()).toHaveLength(1))
    expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('KEEP!')
    await waitFor(async () => expect(textOf((await items.get(keep))!.body)).toBe('KEEP!'))
    expect((await items.get(keep))?.deletedAt).toBeUndefined()
  })
})
