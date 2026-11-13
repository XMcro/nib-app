// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import type { JSONContent } from '@tiptap/react'
import { db, type Item } from './db/db'
import { fileActions } from './fileActions'
import type { Sort } from './lib/sort'
import { tarOf, type TarFile } from './lib/tarOf'
import { titleOf } from './lib/text'
import type { Theme } from './lib/theme'
import type { OpenDocument } from './lib/useOpenDocument'

/** Joplin's own export brought in whole (lib/importApps reads it): its notes link to each other, and each is in a notebook and has tags. */

const setNotice = vi.fn()
const setImportReport = vi.fn()

function actions(features = false, everything: Item[] = []) {
  const session = { flush: async () => {}, guarded: async (action: () => Promise<unknown>) => action(), currentKind: () => 'note' } as unknown as OpenDocument
  return fileActions({ session, setNotice, features, askPlus: vi.fn(), everything, theme: 'light' as Theme, sort: 'recent' as Sort, setImportReport, onRestored: vi.fn() })
}

const id = (n: number) => n.toString(16).padStart(32, '0')
const [BOOK, TAG] = [101, 103].map(id)
const item = (own: string, lead: string, props: Record<string, string | number>): TarFile => ({ name: `${own}.md`, data: `${lead}${lead ? '\n\n' : ''}${Object.entries({ id: own, ...props }).map(([key, value]) => `${key}: ${value}`).join('\n')}` })
const note = (n: number, title: string, body: string, parent = BOOK) =>
  item(id(n), `${title}\n\n${body}`, { parent_id: parent, user_created_time: '2024-04-13T16:23:00.000Z', user_updated_time: '2024-09-29T11:39:00.000Z', is_todo: 0, encryption_applied: 0, markup_language: 1, deleted_time: 0, type_: 1 })
const exported = () =>
  new File(
    [
      tarOf([
        item(BOOK, 'Harbour', { parent_id: '', type_: 2 }),
        item(TAG, 'boats', { type_: 5 }),
        item(id(50), '', { note_id: id(1), tag_id: TAG, type_: 6 }),
        note(1, 'Log', `Left at seven. See [the tables](:/${id(2)}).`),
        note(2, 'Tide tables', `High at 07:40. Back to [Log](:/${id(1)}).`),
        note(3, 'Loose', 'In no notebook.', ''),
      ]) as BlobPart,
    ],
    'export.jex',
  )

const links = (node: JSONContent): string[] => [...(node.type === 'noteLink' ? [String(node.attrs?.id)] : []), ...(node.content ?? []).flatMap(links)]

beforeEach(async () => {
  await db.items.clear()
  setNotice.mockClear()
  setImportReport.mockClear()
})

describe('importing a Joplin export', () => {
  it('with Nib Plus, links its notes to each other, files each in its notebook as a folder, and makes its tags categories', async () => {
    await actions(true).importFiles([exported()])
    expect(setNotice).toHaveBeenLastCalledWith('Imported 3 notes.')
    expect(setImportReport).not.toHaveBeenCalled()
    const stored = await db.items.toArray()
    const called = (title: string) => stored.find((one) => titleOf(one.body) === title)!
    const [log, tables, loose] = ['Log', 'Tide tables', 'Loose'].map(called)
    expect(links(log.body)).toEqual([tables.id])
    expect(links(tables.body)).toEqual([log.id])
    expect(JSON.stringify(log.body)).not.toContain(':/')
    expect([log.folder, tables.folder, loose.folder]).toEqual(['Harbour', 'Harbour', undefined])
    expect(log.categories?.map((category) => category.name)).toEqual(['boats'])
    expect(tables.categories).toBeUndefined()
    expect(log.createdAt).toBe(Date.parse('2024-04-13T16:23:00.000Z'))
  })

  it('links the notes of its zipped Markdown export too, each named by its file, and files them the same', async () => {
    const folder = zipSync({ _resources: {}, Harbour: { 'Log.md': strToU8('Left at seven. See [the tables](Tide%20tables.md).'), 'Tide tables.md': strToU8('High at 07:40. Back to [Log](Log.md).') } })
    await actions(true).importFiles([new File([folder as BlobPart], 'export.zip')])
    const stored = await db.items.toArray()
    const called = (title: string) => stored.find((one) => titleOf(one.body) === title)!
    expect(links(called('Log').body)).toEqual([called('Tide tables').id])
    expect(links(called('Tide tables').body)).toEqual([called('Log').id])
    expect(stored.map((one) => one.folder)).toEqual(['Harbour', 'Harbour'])
  })

  it('without it, still links them, leaves them unfiled, and says so in Joplin’s words', async () => {
    await actions(false).importFiles([exported()])
    const stored = await db.items.toArray()
    const called = (title: string) => stored.find((one) => titleOf(one.body) === title)!
    expect(links(called('Log').body)).toEqual([called('Tide tables').id])
    expect(stored.every((one) => one.folder === undefined && one.categories === undefined)).toBe(true)
    expect(setImportReport).toHaveBeenLastCalledWith({ imported: ['note', 'note', 'note'], skipped: ['Joplin’s notebooks and tags, which come in with Nib Plus'] })
  })
})
