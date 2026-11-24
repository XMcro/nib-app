// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { db } from '../db/db'
import * as items from '../db/items'
import { wordsToday } from './writtenHere'
import { plainText } from './text'

// The inbox's native side, stood in for: what the share sheet and Shortcuts left.
const native = vi.hoisted(() => ({ list: vi.fn(), ack: vi.fn(), addListener: vi.fn() }))
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: () => native,
}))

const { captureBody, drainInbox, linkAction, shareTargets } = await import('./inbox')
const vault = await import('./vault')

const ID = 'c0ffee00-0000-4000-8000-000000000001'
const OTHER = 'c0ffee00-0000-4000-8000-000000000002'
const AT = Date.parse('2026-10-05T09:00:00Z')

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
  localStorage.clear()
  native.list = vi.fn()
  native.ack = vi.fn(async () => {})
})

describe('drainInbox', () => {
  it('saves each capture as a note, under its own id and the time it was written', async () => {
    native.list.mockResolvedValue({ captures: [{ id: ID, text: 'Ferry at 9\nBring the tent', createdAt: AT }] })
    expect(await drainInbox()).toBe(1)
    const note = await items.get(ID)
    expect(note?.kind).toBe('note')
    expect(note?.createdAt).toBe(AT)
    expect(plainText(note!.body)).toBe('Ferry at 9\nBring the tent')
  })

  it('deletes captures only once every one is saved', async () => {
    native.list.mockResolvedValue({
      captures: [
        { id: ID, text: 'one', createdAt: AT },
        { id: OTHER, text: 'two', createdAt: AT + 1 },
      ],
    })
    native.ack = vi.fn(async () => {
      // By the time the inbox is told, both are in the library.
      expect(await items.get(ID)).toBeDefined()
      expect(await items.get(OTHER)).toBeDefined()
    })
    await drainInbox()
    expect(native.ack).toHaveBeenCalledWith({ ids: [ID, OTHER] })
  })

  it('saves nothing twice when a crash left a saved capture in the inbox', async () => {
    native.list.mockResolvedValue({ captures: [{ id: ID, text: 'once', createdAt: AT }] })
    native.ack = vi.fn(async () => {
      throw new Error('crashed before the files were deleted')
    })
    await expect(drainInbox()).rejects.toThrow()
    native.ack = vi.fn(async () => {})
    await drainInbox()
    expect((await items.list('note')).filter((note) => note.id === ID)).toHaveLength(1)
    expect(native.ack).toHaveBeenCalledWith({ ids: [ID] })
  })

  it('leaves a malformed capture alone rather than guessing at it', async () => {
    native.list.mockResolvedValue({ captures: [{ id: '../../etc/passwd', text: 'x', createdAt: AT }] })
    expect(await drainInbox()).toBe(0)
    expect(native.ack).not.toHaveBeenCalled()
    expect(await items.list('note')).toHaveLength(0)
  })

  it('does not count a capture as words written today', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') }) // noon: the test's days can't change under it
    onTestFinished(() => void vi.useRealTimers())
    native.list.mockResolvedValue({ captures: [{ id: ID, text: 'twelve words of shared text that were written somewhere else entirely, earlier', createdAt: AT }] })
    await drainInbox()
    expect(wordsToday(await items.list('note'), Date.now())).toBe(0)
  })
})

describe('a capture for a note that’s there already', () => {
  const NOTE = 'ab1e0000-0000-4000-8000-000000000001'
  const doc = (...lines: string[]) => ({ type: 'doc', content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) })
  const into = (id: string, text = 'Shared in') => ({ captures: [{ id: ID, text, url: 'https://example.com/a', createdAt: AT, into: id }] })

  it('is added to the end of it, and makes no note of its own', async () => {
    await items.create('page', doc('Chapter one', 'It began.'), { id: NOTE })
    const before = (await items.get(NOTE))!
    native.list.mockResolvedValue(into(NOTE))
    expect(await drainInbox()).toBe(1)
    const after = (await items.get(NOTE))!
    expect(plainText(after.body)).toBe('Chapter one\nIt began.\nShared in\nhttps://example.com/a')
    expect(after.body.content!.at(-1)!.content![0].marks).toEqual([{ type: 'link', attrs: { href: 'https://example.com/a' } }])
    expect(after.kind).toBe('page')
    expect(after.version).toBeGreaterThan(before.version)
    expect(await db.items.count()).toBe(1)
    expect(native.ack).toHaveBeenCalledExactlyOnceWith({ ids: [ID] })
  })

  it('isn’t counted as words written today, though its note was', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
    onTestFinished(() => void vi.useRealTimers())
    await items.create('note', doc('Mine'), { id: NOTE })
    expect(wordsToday(await items.list('note'), Date.now())).toBe(0)
    await items.update(NOTE, doc('Mine', 'and two more'))
    expect(wordsToday(await items.list('note'), Date.now())).toBe(3)
    native.list.mockResolvedValue(into(NOTE, 'six words that came from elsewhere'))
    await drainInbox()
    expect(wordsToday(await items.list('note'), Date.now())).toBe(3)
  })

  it('goes in through the editor when that note is the one open, and the library isn’t written under it', async () => {
    await items.create('note', doc('Open now'), { id: NOTE })
    const { version } = (await items.get(NOTE))!
    const put = vi.fn((_: string, __: object[]) => true)
    native.list.mockResolvedValue(into(NOTE))
    expect(await drainInbox(put)).toBe(1)
    expect(put).toHaveBeenCalledExactlyOnceWith(NOTE, captureBody(into(NOTE).captures[0]).content)
    expect((await items.get(NOTE))!.version).toBe(version)
    expect(native.ack).toHaveBeenCalledExactlyOnceWith({ ids: [ID] })
    // Not the one open: asked, told no, and written to the library.
    native.list.mockResolvedValue({ captures: [{ id: OTHER, text: 'Later', createdAt: AT, into: NOTE }] })
    await drainInbox(() => false)
    expect(plainText((await items.get(NOTE))!.body)).toBe('Open now\nLater')
  })

  it('is a note of its own when that one has gone, is in the trash, locked, read-only or put away, or isn’t an id at all', async () => {
    const cases: [string, () => Promise<unknown>][] = [
      ['gone', async () => {}],
      ['in the trash', async () => void (await items.create('note', doc('Binned'), { id: NOTE }), await items.remove(NOTE))],
      ['read-only', async () => void (await items.create('note', doc('Fixed'), { id: NOTE }), await db.items.update(NOTE, { readOnly: true }))],
      ['put away', async () => void (await items.create('note', doc('Archived'), { id: NOTE }), await db.items.update(NOTE, { archivedAt: AT }))],
      ['locked', async () => void (await items.create('note', doc('Secret'), { id: NOTE }), await vault.openVault('harbour lights', []), await items.lock(NOTE, doc('Secret')), vault.closeVault())],
    ]
    for (const [why, make] of cases) {
      await db.items.clear()
      native.ack = vi.fn(async () => {})
      await make()
      const before = await items.get(NOTE)
      native.list.mockResolvedValue(into(NOTE))
      expect(await drainInbox(), why).toBe(1)
      expect(plainText((await items.get(ID))!.body), why).toBe('Shared in\nhttps://example.com/a')
      expect(await items.get(NOTE), why).toEqual(before)
      expect(native.ack, why).toHaveBeenCalledExactlyOnceWith({ ids: [ID] })
    }
    await db.items.clear()
    native.list.mockResolvedValue(into('../../etc/passwd'))
    await drainInbox()
    expect(await items.get(ID)).toBeDefined()
  })

  it('is added once when the inbox is emptied twice at the same moment', async () => {
    await items.create('note', doc('Mine'), { id: NOTE })
    const waiting = into(NOTE).captures
    const acked: string[] = []
    native.list = vi.fn(async () => ({ captures: waiting.filter((capture) => !acked.includes(capture.id)) }))
    native.ack = vi.fn(async ({ ids }: { ids: string[] }) => void acked.push(...ids))
    expect(await Promise.all([drainInbox(), drainInbox()])).toEqual([1, 0])
    expect(plainText((await items.get(NOTE))!.body)).toBe('Mine\nShared in\nhttps://example.com/a')
    // And one that failed doesn't stop the next.
    native.list = vi.fn().mockRejectedValueOnce(new Error('the inbox could not be read')).mockResolvedValue({ captures: [] })
    await expect(drainInbox()).rejects.toThrow('could not be read')
    expect(await drainInbox()).toBe(0)
  })

  it('waits in the inbox when it can’t be written, with what came before it kept', async () => {
    await items.create('note', doc('Mine'), { id: NOTE })
    native.list.mockResolvedValue({ captures: [{ id: OTHER, text: 'A note of its own', createdAt: AT }, { id: ID, text: 'Shared in', createdAt: AT + 1, into: NOTE }] })
    const update = vi.spyOn(items, 'update').mockRejectedValueOnce(new Error('changed since it was read'))
    await expect(drainInbox()).rejects.toThrow('changed since')
    // Written only over the version that was read: one changed since is left for the next time.
    expect(update).toHaveBeenCalledExactlyOnceWith(NOTE, expect.anything(), { expectedVersion: 1 })
    expect(native.ack).not.toHaveBeenCalled()
    update.mockRestore()
    expect(await drainInbox()).toBe(2)
    expect(plainText((await items.get(NOTE))!.body)).toBe('Mine\nShared in')
    expect((await items.list('note')).filter((note) => note.id === OTHER)).toHaveLength(1)
  })
})

describe('what the share sheet may offer to add to', () => {
  const item = (n: number, text: string, more: object = {}) => ({ id: `ab1e0000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, kind: n % 2 ? ('note' as const) : ('page' as const), body: { type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] }, version: 1, createdAt: 1, updatedAt: n * 1000, ...more })

  it('is the ten edited most recently, by title and kind, the latest first', () => {
    const targets = shareTargets(Array.from({ length: 14 }, (_, n) => item(n + 1, `Note ${n + 1}`)))
    expect(targets.map((target) => target.title)).toEqual(['Note 14', 'Note 13', 'Note 12', 'Note 11', 'Note 10', 'Note 9', 'Note 8', 'Note 7', 'Note 6', 'Note 5'])
    expect(targets[0]).toEqual({ id: 'ab1e0000-0000-4000-8000-000000000014', title: 'Note 14', kind: 'page' })
    expect(targets[1].kind).toBe('note')
  })

  it('is never a locked one, nor one that can’t be added to or has no words to know it by; and no more of a title than a line', () => {
    const library = [
      item(1, 'Plain'),
      item(2, '', { vault: { salt: 's', sealed: 'x' } }),
      item(3, '', { unsealed: { box: 'x' } }),
      item(4, 'Fixed', { readOnly: true }),
      item(5, 'Put away', { archivedAt: 5 }),
      item(6, 'Binned', { deletedAt: 6 }),
      item(7, ''),
      item(8, `${'A very long first line '.repeat(8)}`),
    ]
    const targets = shareTargets(library)
    expect(targets.map((target) => target.id.slice(-2))).toEqual(['08', '01'])
    expect(targets[0].title).toHaveLength(80)
    // The library's own list is left in the order it came.
    expect(library[0].id.endsWith('01')).toBe(true)
  })
})

describe('captureBody', () => {
  it('puts the link last, as a link', () => {
    const body = captureBody({ id: ID, text: 'Worth reading', url: 'https://example.com/a', createdAt: AT })
    expect(body.content?.at(-1)).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'https://example.com/a', marks: [{ type: 'link', attrs: { href: 'https://example.com/a' } }] }],
    })
  })

  it('takes no link that is not http or https', () => {
    const body = captureBody({ id: ID, text: 'x', url: 'javascript:alert(1)', createdAt: AT })
    expect(JSON.stringify(body)).not.toContain('javascript')
  })

  it('keeps blank lines as blank paragraphs', () => {
    expect(captureBody({ id: ID, text: 'a\n\nb', createdAt: AT }).content?.map((node) => node.content?.[0]?.text ?? '')).toEqual(['a', '', 'b'])
  })
})

describe('linkAction', () => {
  it('knows the links a widget or Shortcut can send, and nothing else', () => {
    expect(linkAction('nib://new-note')).toBe('new-note')
    expect(linkAction('nib://new-page')).toBe('new-page')
    expect(linkAction('nib://plus')).toBe('plus')
    expect(linkAction('nib://sprint/25')).toEqual({ sprint: 25 })
    expect(linkAction('nib://sprint/45')).toEqual({ sprint: 45 })
    for (const odd of ['nib://sprint/20', 'nib://sprint/', 'nib://sprint/25/x', 'nib://sprint/1000']) expect(linkAction(odd)).toBeNull()
    expect(linkAction('nib://delete-everything')).toBeNull()
    expect(linkAction('https://new-note')).toBeNull()
  })

  it('opens a document by its id, or a book by its folder’s whole name, and nothing that isn’t one', () => {
    expect(linkAction(`nib://open/${ID}`)).toEqual({ open: ID })
    expect(linkAction(`nib://book/${encodeURIComponent('Novel/Part 2')}`)).toEqual({ book: 'Novel/Part 2' })
    expect(linkAction(`nib://book/${encodeURIComponent('Café')}`)).toEqual({ book: 'Café' })
    for (const odd of ['nib://open/', 'nib://open/a b', `nib://open/${ID}/more`, 'nib://book/', 'nib://book/Novel/Part 2', 'nib://book/%E0%A4%A', `nib://book/${encodeURIComponent('   ')}`]) expect(linkAction(odd)).toBeNull()
  })
})
