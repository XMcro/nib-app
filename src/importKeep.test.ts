// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { db, type Item } from './db/db'
import { fileActions } from './fileActions'
import { sortOut } from './db/items'
import type { Sort } from './lib/sort'
import { titleOf } from './lib/text'
import type { Theme } from './lib/theme'
import type { OpenDocument } from './lib/useOpenDocument'

/** Google Keep brought in from a Takeout zip (lib/importApps reads it), and what the library does with what Keep says of each note: pinned, archived, its labels. */

const setNotice = vi.fn()
const setImportReport = vi.fn()

function actions(features = false, everything: Item[] = []) {
  const session = { flush: async () => {}, guarded: async (action: () => Promise<unknown>) => action(), currentKind: () => 'note' } as unknown as OpenDocument
  return fileActions({ session, setNotice, features, askPlus: vi.fn(), everything, theme: 'light' as Theme, sort: 'recent' as Sort, setImportReport, onRestored: vi.fn() })
}

const keep = (note: Record<string, unknown>) =>
  strToU8(JSON.stringify({ color: 'DEFAULT', isTrashed: false, isPinned: false, isArchived: false, title: '', userEditedTimestampUsec: 1711987269581000, createdTimestampUsec: 1711987246954000, ...note }))
const takeout = () =>
  new File(
    [
      zipSync({
        'Takeout/archive_browser.html': strToU8('<html><body>Archive</body></html>'),
        'Takeout/Keep/Labels.txt': strToU8('harbour\nboats\n'),
        'Takeout/Keep/Tides.json': keep({ title: 'Tides', textContent: 'High at 07:40.', isPinned: true, labels: [{ name: 'harbour' }, { name: 'boats' }] }),
        'Takeout/Keep/Tides.html': strToU8('<html><body><div class="content">High at 07:40.</div></body></html>'),
        'Takeout/Keep/Ferry.json': keep({ title: 'Ferry', textContent: 'Weekdays at seven.', isArchived: true, labels: [{ name: 'harbour' }] }),
        'Takeout/Keep/Plain.json': keep({ title: 'Plain', textContent: 'No labels.' }),
      }) as BlobPart,
    ],
    'takeout.zip',
  )

beforeEach(async () => {
  await db.items.clear()
  setNotice.mockClear()
  setImportReport.mockClear()
})

describe('importing Google Keep', () => {
  it('with Nib Plus, keeps a note pinned or archived as Keep had it, and its labels as categories, one colour a label', async () => {
    await actions(true).importFiles([takeout()])
    expect(setNotice).toHaveBeenLastCalledWith('Imported 3 notes.')
    expect(setImportReport).not.toHaveBeenCalled()
    const stored = await db.items.toArray()
    const called = (title: string) => stored.find((item) => titleOf(item.body) === title)!
    const [tides, ferry, plain] = ['Tides', 'Ferry', 'Plain'].map(called)
    expect(typeof tides.pinnedAt).toBe('number')
    expect(tides.archivedAt).toBeUndefined()
    expect(tides.categories?.map((category) => category.name)).toEqual(['harbour', 'boats'])
    expect(ferry.categories?.map((category) => category.name)).toEqual(['harbour'])
    expect(ferry.categories![0].color).toBe(tides.categories![0].color)
    expect(tides.categories![1].color).not.toBe(tides.categories![0].color)
    expect(plain.categories).toBeUndefined()
    // Archived: out of the notes, and in the archive.
    expect(typeof ferry.archivedAt).toBe('number')
    expect(ferry.pinnedAt).toBeUndefined()
    const sorted = sortOut(stored)
    expect(sorted.archived.map((item) => item.id)).toEqual([ferry.id])
    expect(sorted.notes.map((item) => titleOf(item.body)).sort()).toEqual(['Plain', 'Tides'])
    // As old as Keep says.
    expect(tides.createdAt).toBe(1711987246954)
  })

  it('without it, brings every note in, pinned and archived as they were, and says the labels were left out, in Keep’s name', async () => {
    await actions(false).importFiles([takeout()])
    const stored = await db.items.toArray()
    expect(stored).toHaveLength(3)
    expect(stored.every((item) => item.categories === undefined)).toBe(true)
    expect(sortOut(stored).archived.map((item) => titleOf(item.body))).toEqual(['Ferry'])
    expect(typeof stored.find((item) => titleOf(item.body) === 'Tides')!.pinnedAt).toBe('number')
    expect(setImportReport).toHaveBeenLastCalledWith({ imported: ['note', 'note', 'note'], skipped: ['Keep’s labels, which come in with Nib Plus'] })
  })

  it('says nothing was left out when no note had a label', async () => {
    const plain = new File([zipSync({ 'Takeout/Keep/Plain.json': keep({ title: 'Plain', textContent: 'No labels.' }) }) as BlobPart], 'takeout.zip')
    await actions(false).importFiles([plain])
    expect(setImportReport).not.toHaveBeenCalled()
    expect(setNotice).toHaveBeenLastCalledWith('Imported one note.')
  })
})
