// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'

/**
 * Its own file because the mocks below are module-wide: the vault is open, and
 * every unseal waits until the test lets it finish, so a locked document can
 * still be opening when the writer picks another. useSync is wrapped only to
 * hand the test App's "another device changed these" callback.
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

const unsealing = vi.hoisted(() => ({ waiting: [] as ((body: JSONContent) => void)[] }))
vi.mock('./lib/vault', async (importOriginal) => {
  const real = await importOriginal<typeof import('./lib/vault')>()
  return {
    ...real,
    vaultOpen: () => true,
    unseal: () => new Promise<JSONContent>((resolve) => unsealing.waiting.push(resolve)),
  }
})

const synced = vi.hoisted(() => ({ applied: null as ((ids: string[], copies: number) => void) | null }))
vi.mock('./sync', async (importOriginal) => {
  const real = await importOriginal<typeof import('./sync')>()
  return {
    ...real,
    useSync: (...args: Parameters<typeof real.useSync>) => {
      synced.applied = args[1]
      return real.useSync(...args)
    },
  }
})

const { App } = await import('./App')
const { db } = await import('./db/db')
const items = await import('./db/items')
const { LOCKED_BODY } = await import('./lib/vault')

const textOf = (body: JSONContent) => body.content?.[0]?.content?.[0]?.text ?? ''
const bodyOf = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const editor = () => screen.getByTestId<HTMLTextAreaElement>('editor')
// Long enough for anything still on its way to the screen to have landed.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)))

async function lockedNote() {
  const id = await items.create('note', bodyOf('sealed away'))
  await db.items.update(id, { vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) }, body: LOCKED_BODY })
  return id
}

async function finishUnseal(text: string) {
  await waitFor(() => expect(unsealing.waiting.length).toBeGreaterThan(0))
  await act(async () => unsealing.waiting.shift()!(bodyOf(text)))
}

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
  unsealing.waiting.length = 0
})

describe('App opening a locked document slowly', () => {
  it('drops it when another document was picked while it opened', async () => {
    await lockedNote()
    const plain = await items.create('note', bodyOf('PLAIN'))
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByText('Locked'))
    await waitFor(() => expect(unsealing.waiting).toHaveLength(1))
    await user.click(screen.getByText('PLAIN'))
    await waitFor(() => expect(editor().value).toBe('PLAIN'))

    await finishUnseal('SECRET')
    await settle()
    expect(editor().value).toBe('PLAIN')
    await user.type(editor(), '!')
    await waitFor(async () => expect(textOf((await items.get(plain))!.body)).toBe('PLAIN!'))
  })

  // The new draft's text was otherwise flushed into the locked note when it
  // finally opened.
  it('drops it when a new note was started while it opened', async () => {
    const locked = await lockedNote()
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByText('Locked'))
    await waitFor(() => expect(unsealing.waiting).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: /New note/ }))
    await user.type(editor(), 'DRAFT')

    await finishUnseal('SECRET')
    await settle()
    expect(editor().value).toBe('DRAFT')
    await waitFor(async () => expect(await db.items.count()).toBe(2), { timeout: 2000 })
    expect((await items.get(locked))!.body).toEqual(LOCKED_BODY)
  })

  it('drops another device’s change to it when another document was picked while it opened', async () => {
    const locked = await lockedNote()
    const plain = await items.create('note', bodyOf('PLAIN'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('Locked'))
    await finishUnseal('SECRET')
    await waitFor(() => expect(editor().value).toBe('SECRET'))

    // Another device changed it: sync bumps the version and says so.
    await db.items.update(locked, { version: (await items.get(locked))!.version + 1 })
    act(() => synced.applied!([locked], 0))
    await waitFor(() => expect(unsealing.waiting).toHaveLength(1))
    await user.click(screen.getByText('PLAIN'))
    await waitFor(() => expect(editor().value).toBe('PLAIN'))

    await finishUnseal('SECRET, edited elsewhere')
    await settle()
    expect(editor().value).toBe('PLAIN')
    await user.type(editor(), '!')
    await waitFor(async () => expect(textOf((await items.get(plain))!.body)).toBe('PLAIN!'))
  })
})
