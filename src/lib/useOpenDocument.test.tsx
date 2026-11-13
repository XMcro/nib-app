// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { JSONContent } from '@tiptap/react'

// A write held until the test lets it go, so another document can open while a restore is under way.
const write = vi.hoisted(() => ({ held: Promise.resolve() as Promise<void> }))
vi.mock('../db/items', async (importOriginal) => {
  const real = await importOriginal<typeof import('../db/items')>()
  return {
    ...real,
    update: async (...args: Parameters<typeof real.update>) => {
      await write.held
      return real.update(...args)
    },
  }
})

const { useOpenDocument } = await import('./useOpenDocument')
const { db } = await import('../db/db')
const items = await import('../db/items')

const bodyOf = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const textOf = (body?: JSONContent) => body?.content?.[0]?.content?.[0]?.text

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
  write.held = Promise.resolve()
})

describe('useOpenDocument', () => {
  // A book's Replace all (components/BookFind), with the writer's last words in the one on screen not yet saved.
  it('rewrites documents with what was just typed in the one on screen, shows it its new words, and keeps each one’s before in History', async () => {
    await items.create('page', bodyOf('A, Mara'), { id: 'a' })
    await items.create('page', bodyOf('B, Mara'), { id: 'b' })
    const { result } = renderHook(() => useOpenDocument({ setNotice: vi.fn(), filingRef: { current: {} }, onDraft: vi.fn() }))
    await act(() => result.current.select('a'))
    act(() => result.current.handleChange(bodyOf('A, Mara typed')))

    const swap = (body: JSONContent) => bodyOf(textOf(body)!.replace('Mara', 'Maren'))
    let changed: Awaited<ReturnType<typeof result.current.rewrite>> = []
    await act(async () => void (changed = await result.current.rewrite(['a', 'b'], swap)))

    expect(changed.map(({ id, before, after }) => [id, textOf(before), textOf(after)])).toEqual([
      ['a', 'A, Mara typed', 'A, Maren typed'],
      ['b', 'B, Mara', 'B, Maren'],
    ])
    expect(textOf((await items.get('a'))!.body)).toBe('A, Maren typed')
    expect(textOf(result.current.doc.body)).toBe('A, Maren typed')
    expect((await db.revisions.where('itemId').equals('a').toArray()).map((revision) => textOf(revision.body))).toContain('A, Mara typed')

    // Typed on, it saves over its new words, at their version: no conflict.
    act(() => result.current.handleChange(bodyOf('A, Maren typed on')))
    await act(() => result.current.flush())
    expect(textOf((await items.get('a'))!.body)).toBe('A, Maren typed on')
    expect(result.current.conflict).toBeNull()
  })

  // The restored text went on screen under the document just opened, and the next keystroke saved it there.
  it('keeps a restore off a document opened during its writes', async () => {
    await items.create('note', bodyOf('A'), { id: 'a' })
    await items.create('note', bodyOf('B'), { id: 'b' })
    const { result } = renderHook(() => useOpenDocument({ setNotice: vi.fn(), filingRef: { current: {} }, onDraft: vi.fn() }))
    await act(() => result.current.select('a'))

    let release = () => {}
    write.held = new Promise<void>((resolve) => (release = resolve))
    const restoring = result.current.putBack('a', await items.get('a'), bodyOf('RESTORED'))
    await act(() => result.current.select('b'))
    await act(async () => {
      release()
      await restoring
    })

    expect(textOf((await items.get('a'))!.body)).toBe('RESTORED')
    expect(result.current.activeId).toBe('b')
    expect(textOf(result.current.doc.body)).toBe('B')

    // Saved at B's own version, not at the one the restore gave A.
    act(() => result.current.handleChange(bodyOf('B, typed')))
    await act(() => result.current.flush())
    expect(textOf((await items.get('b'))!.body)).toBe('B, typed')
    expect(result.current.conflict).toBeNull()
  })

  describe('what a document left for another is kept as', () => {
    const opened = () => renderHook(() => useOpenDocument({ setNotice: vi.fn(), filingRef: { current: {} }, onDraft: vi.fn() }))

    it('is the version it was last saved at, said once, to the editor that was on screen', async () => {
      await items.create('note', bodyOf('A'), { id: 'a' })
      await items.create('note', bodyOf('B'), { id: 'b' })
      const { result } = opened()
      await act(() => result.current.select('a'))
      const was = result.current.doc.key
      act(() => result.current.handleChange(bodyOf('A, typed')))
      await act(() => result.current.select('b'))
      expect(result.current.keptAs(result.current.doc.key)).toBeNull()
      expect(result.current.keptAs(was)).toEqual({ key: 'a:2', id: 'a' })
      expect(result.current.keptAs(was)).toBeNull()
      // And is what it's opened as when it's come back to.
      await act(() => result.current.select('a'))
      expect(result.current.doc.key).toBe('a:2')
    })

    it('is said for a new draft too, and for a draft once it has been saved', async () => {
      await items.create('note', bodyOf('A'), { id: 'a' })
      const { result } = opened()
      await act(() => result.current.select('a'))
      const was = result.current.doc.key
      act(() => result.current.resetToDraft())
      expect(result.current.keptAs(was)).toEqual({ key: 'a:1', id: 'a' })
      const draft = result.current.doc.key
      act(() => result.current.handleChange(bodyOf('New')))
      await act(() => result.current.select('a'))
      const made = (await items.listAll()).find((item) => item.id !== 'a')!
      expect(result.current.keptAs(draft)).toEqual({ key: `${made.id}:1`, id: made.id })
    })

    it('is nothing for a draft never saved, or a document opened again as it changed', async () => {
      await items.create('note', bodyOf('A'), { id: 'a' })
      const { result } = opened()
      const draft = result.current.doc.key
      await act(() => result.current.select('a'))
      expect(result.current.keptAs(draft)).toBeNull()
      const was = result.current.doc.key
      await items.update('a', bodyOf('A, changed elsewhere'))
      await act(() => result.current.select('a'))
      expect(result.current.doc.key).toBe('a:2')
      expect(result.current.keptAs(was)).toBeNull()
    })

    // Its words would outlast the vault being shut.
    it('is nothing for a locked document', async () => {
      const vault = await import('./vault')
      await items.create('note', bodyOf('A'), { id: 'a' })
      await items.create('note', bodyOf('B'), { id: 'b' })
      await vault.openVault('harbour lights', [])
      await items.lock('a', bodyOf('A'), 1)
      const { result } = opened()
      await act(() => result.current.select('a'))
      expect(textOf(result.current.doc.body)).toBe('A')
      const was = result.current.doc.key
      await act(() => result.current.select('b'))
      expect(result.current.keptAs(was)).toBeNull()
      vault.closeVault()
    })
  })
})
