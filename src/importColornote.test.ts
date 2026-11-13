// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { db, type Item } from './db/db'
import { sortOut } from './db/items'
import { fileActions } from './fileActions'
import { colornoteOf } from './lib/colornoteOf'
import type { AskPassword } from './lib/importApps'
import type { Sort } from './lib/sort'
import { titleOf } from './lib/text'
import type { Theme } from './lib/theme'
import type { OpenDocument } from './lib/useOpenDocument'

/** A ColorNote backup brought in whole (lib/importApps reads it, lib/colornote opens it), and the password asked for through whoever runs the import. */

const setNotice = vi.fn()
const setImportReport = vi.fn()

function actions(askPassword?: AskPassword, everything: Item[] = []) {
  const session = { flush: async () => {}, guarded: async (action: () => Promise<unknown>) => action(), currentKind: () => 'note' } as unknown as OpenDocument
  return fileActions({ session, setNotice, features: false, askPlus: vi.fn(), everything, theme: 'light' as Theme, sort: 'recent' as Sort, setImportReport, onRestored: vi.fn(), askPassword })
}

const note = (id: number, title: string, text: string, more: Record<string, unknown> = {}) => ({ _id: id, title, note: text, encrypted: 0, modified_date: 1728922218086, active_state: 0, folder_id: 0, space: 0, type: 0, created_date: 1728765229751, ...more })
const NOTES = [note(1, 'Test note', 'Content\n\nNote link: [[Title only]]\n'), note(3, 'Title only', 'Words.'), note(9, 'Archived note', 'Put away.', { space: 16 }), note(10, 'Binned', 'Gone.', { active_state: 16 })]
const backup = async (password?: string) => new File([(await colornoteOf(NOTES, password)) as BlobPart], 'colornote-20241014.backup')

const links = (node: JSONContent): string[] => [...(node.type === 'noteLink' ? [String(node.attrs?.id)] : []), ...(node.content ?? []).flatMap(links)]

beforeEach(async () => {
  await db.items.clear()
  setNotice.mockClear()
  setImportReport.mockClear()
})

describe('importing a ColorNote backup', () => {
  it('brings in a backup ColorNote made by itself with no password asked: its notes, a link between two of them, its archive archived, and its trash said to be left', async () => {
    const ask = vi.fn<AskPassword>(async () => null)
    await actions(ask).importFiles([await backup()])
    expect(ask).not.toHaveBeenCalled()
    const stored = await db.items.toArray()
    const called = (title: string) => stored.find((one) => titleOf(one.body) === title)!
    expect(stored).toHaveLength(3)
    expect(links(called('Test note').body)).toEqual([called('Title only').id])
    expect(sortOut(stored).archived.map((one) => titleOf(one.body))).toEqual(['Archived note'])
    expect(called('Test note').createdAt).toBe(1728765229751)
    expect(setImportReport).toHaveBeenLastCalledWith({ imported: ['note', 'note', 'note'], skipped: ['1 note in ColorNote’s trash'] })
  })

  it('asks whoever runs the import for the password of a backup its owner made, and brings it in with the right one', async () => {
    const ask = vi.fn<AskPassword>().mockResolvedValueOnce('nope').mockResolvedValueOnce('1234')
    await actions(ask).importFiles([await backup('1234')])
    expect(ask.mock.calls.map(([about]) => about)).toEqual([{ name: 'colornote-20241014.backup', again: false }, { name: 'colornote-20241014.backup', again: true }])
    expect(await db.items.count()).toBe(3)
  })

  it('brings nothing in when no password is given, and says the backup wasn’t opened', async () => {
    await actions(vi.fn<AskPassword>(async () => null)).importFiles([await backup('1234')])
    expect(await db.items.count()).toBe(0)
    expect(setImportReport).toHaveBeenLastCalledWith({ imported: [], skipped: ['colornote-20241014.backup: not opened, without its password'] })
  })
})
