// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'

/**
 * Its own file because the mock below is module-wide: `items.update` is slowed
 * so a write can still be in flight when the export runs. Without that delay
 * the test passes vacuously — the edit is simply still sitting in `pending`,
 * which is a different code path. A test can also hold it there until it says
 * so (`slow.held`), and Plus is on, for the rich exports.
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

const slow = vi.hoisted(() => ({ held: Promise.resolve() as Promise<void> }))
vi.mock('./db/items', async (importOriginal) => {
  const real = await importOriginal<typeof import('./db/items')>()
  return {
    ...real,
    update: async (...args: Parameters<typeof real.update>) => {
      await new Promise((resolve) => setTimeout(resolve, 150))
      await slow.held
      return real.update(...args)
    },
  }
})

vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [{ active: true }, () => {}, true],
}))

const { App } = await import('./App')
const { db } = await import('./db/db')
const items = await import('./db/items')

const bodyOf = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const MOD = /Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? 'Meta' : 'Control'

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
  slow.held = Promise.resolve()
})

/** Captures whatever `download` puts in a Blob. */
function captureDownloads() {
  const blobs: Blob[] = []
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob)
    return 'blob:nib-test'
  }) as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  return blobs
}

describe('App export', () => {
  // flush() used to resolve immediately when nothing was pending, so
  // `await flush()` skipped a write already on the queue. Blurring the editor
  // enqueues that write and clears `pending`, so the export read the database
  // before it landed — and the only backup this app has silently held the
  // previous text.
  it('waits for a write already on the queue', async () => {
    const blobs: Blob[] = []
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob)
      return 'blob:nib-test'
    }) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()

    const id = await items.create('note', bodyOf('ORIGINAL'))

    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('ORIGINAL'))
    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('ORIGINAL'),
    )

    await user.clear(screen.getByTestId('editor'))
    await user.type(screen.getByTestId('editor'), 'EDITED')
    // Blur enqueues the slow write and clears `pending`.
    await user.tab()

    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByText('Export everything as Markdown'))

    await waitFor(() => expect(blobs).toHaveLength(1))
    expect(await blobs[0].text()).toContain('EDITED')
    expect(await blobs[0].text()).not.toContain('ORIGINAL')
    expect((await items.get(id))!.body).toEqual(bodyOf('EDITED'))
  })
})

describe('App, with a write still on the queue', () => {
  // Long enough for what was asked for to have happened, had it not waited.
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 300)))
  const palette = (user: ReturnType<typeof userEvent.setup>) => user.keyboard(`{${MOD}>}k{/${MOD}}`)

  /** ORIGINAL opened, and EDITED on its way to the database, held there until the test lets go. */
  async function editing() {
    await items.create('note', bodyOf('ORIGINAL'))
    let release = () => {}
    slow.held = new Promise((resolve) => (release = resolve))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('ORIGINAL'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('ORIGINAL'))
    await user.clear(screen.getByTestId('editor'))
    await user.type(screen.getByTestId('editor'), 'EDITED')
    await user.tab()
    return { user, release }
  }

  it.each([
    ['Export this one as Markdown'],
    ['Export this one as HTML'],
  ])('%s waits for it', async (command) => {
    const blobs = captureDownloads()
    const { user, release } = await editing()
    await palette(user)
    await user.click(await screen.findByText(command))
    await settle()
    expect(blobs).toEqual([])

    release()
    await waitFor(() => expect(blobs).toHaveLength(1))
    expect(await blobs[0].text()).toContain('EDITED')
    expect(await blobs[0].text()).not.toContain('ORIGINAL')
  })

  it('a backup waits for it', async () => {
    const blobs = captureDownloads()
    const { user, release } = await editing()
    await user.click(within(screen.getByRole('main')).getByLabelText('Settings'))
    await user.click(screen.getByRole('button', { name: /Advanced/ }))
    await user.click(screen.getByRole('button', { name: 'Download a full backup' }))
    await settle()
    expect(blobs).toEqual([])

    release()
    await waitFor(() => expect(blobs).toHaveLength(1))
    expect(await blobs[0].text()).toContain('EDITED')
  })

  it('Duplicate waits for it, and the copy has the words', async () => {
    const { user, release } = await editing()
    await palette(user)
    await user.click(await screen.findByText('Duplicate this'))
    await settle()
    expect(await db.items.count()).toBe(1)

    release()
    await waitFor(async () => expect(await db.items.count()).toBe(2))
    expect((await db.items.toArray()).map((item) => item.body)).toEqual([bodyOf('EDITED'), bodyOf('EDITED')])
  })
})
