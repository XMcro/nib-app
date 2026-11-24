// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'

/**
 * Its own file because the mock below is module-wide: History lists the
 * versions of the note called "first" whichever note is open, as it can for a
 * moment after the writer switches notes, before the panel catches up.
 */

vi.mock('./editor/Editor', () => {
  const read = (body?: JSONContent) => body?.content?.[0]?.content?.[0]?.text ?? ''
  return {
    Editor: ({ initialBody }: { initialBody?: JSONContent }) => <textarea data-testid="editor" defaultValue={read(initialBody)} />,
  }
})

vi.mock('./db/revisions', async (importOriginal) => {
  const real = await importOriginal<typeof import('./db/revisions')>()
  return { ...real, latest: (_itemId: string, limit: number) => real.latest('first', limit) }
})

const { App } = await import('./App')
const { db } = await import('./db/db')
const items = await import('./db/items')

const textOf = (body: JSONContent) => body.content?.[0]?.content?.[0]?.text ?? ''
const bodyOf = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const MOD = /Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? 'Meta' : 'Control'

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
})

describe('App restoring from history', () => {
  // It wrote into whichever note was open, not the version's own.
  it('restores a version only into its own note', async () => {
    await items.create('note', bodyOf('FIRST, OLD'), { id: 'first', createdAt: Date.now() - 3_600_000 })
    await items.update('first', bodyOf('FIRST, NOW'))
    await items.create('note', bodyOf('SECOND'), { id: 'second' })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('SECOND'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('SECOND'))

    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^Version history/ }))
    const versions = await screen.findByRole('list', { name: 'Versions' })
    await user.click(within(versions).getAllByRole('button')[0])
    await user.click(await screen.findByText('Restore this whole version'))

    expect(await screen.findByText('That version is of another note.')).toBeTruthy()
    expect(textOf((await items.get('second'))!.body)).toBe('SECOND')
    expect(textOf((await items.get('first'))!.body)).toBe('FIRST, NOW')
  })

  const openFirstVersion = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByText('FIRST, NOW'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('FIRST, NOW'))
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^Version history/ }))
    const versions = await screen.findByRole('list', { name: 'Versions' })
    await user.click(within(versions).getAllByRole('button').at(-1)!)
  }

  // Stamped in the same millisecond, the two came back in either order, and the next save could fold into the wrong one.
  it('keeps the text before a restore and the text restored as two versions, in that order', async () => {
    await items.create('note', bodyOf('FIRST, OLD'), { id: 'first', createdAt: Date.now() - 3_600_000 })
    await items.update('first', bodyOf('FIRST, NOW'))
    const user = userEvent.setup()
    render(<App />)
    await openFirstVersion(user)
    await user.click(await screen.findByText('Restore this whole version'))

    await waitFor(async () => expect(textOf((await items.get('first'))!.body)).toBe('FIRST, OLD'))
    await waitFor(async () => expect(await db.revisions.where('itemId').equals('first').count()).toBe(3))
    const kept = await db.revisions.where('itemId').equals('first').sortBy('createdAt')
    expect(kept.map((one) => textOf(one.body))).toEqual(['FIRST, OLD', 'FIRST, NOW', 'FIRST, OLD'])
    expect(kept[2].createdAt).toBeGreaterThan(kept[1].createdAt)
  })

  // Its versions are from before the lock, in the clear: put back, the text was in the locked note's history again.
  it('restores nothing into a note locked on another device while History was open', async () => {
    await items.create('note', bodyOf('FIRST, OLD'), { id: 'first', createdAt: Date.now() - 3_600_000 })
    await items.update('first', bodyOf('FIRST, NOW'))
    const user = userEvent.setup()
    render(<App />)
    await openFirstVersion(user)
    const restore = await screen.findByText('Restore this whole version')
    const before = await db.revisions.where('itemId').equals('first').count()
    await db.items.update('first', { vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) }, body: { type: 'doc', content: [] }, version: 3 })
    await user.click(restore)

    expect(await screen.findByText('This note was locked on another device. Open it from the vault to change it.')).toBeTruthy()
    expect((await items.get('first'))!.body).toEqual({ type: 'doc', content: [] })
    expect(await db.revisions.where('itemId').equals('first').count()).toBe(before)
  })
})
