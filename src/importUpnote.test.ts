// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import type { JSONContent } from '@tiptap/react'
import { db, type Item } from './db/db'
import { fileActions } from './fileActions'
import type { Sort } from './lib/sort'
import { titleOf } from './lib/text'
import type { Theme } from './lib/theme'
import type { OpenDocument } from './lib/useOpenDocument'

/** UpNote's HTML export brought in whole (lib/importApps reads it): its notes link to each other, and each has a notebook and its hashtags. */

const setNotice = vi.fn()
const setImportReport = vi.fn()

function actions(features = false, everything: Item[] = []) {
  const session = { flush: async () => {}, guarded: async (action: () => Promise<unknown>) => action(), currentKind: () => 'note' } as unknown as OpenDocument
  return fileActions({ session, setNotice, features, askPlus: vi.fn(), everything, theme: 'light' as Theme, sort: 'recent' as Sort, setImportReport, onRestored: vi.fn() })
}

const page = (inner: string) => strToU8(`<head><title></title><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"></head><body class="light-theme"><div class="shine-editor">${inner}</div></body>`)
const exported = () =>
  new File(
    [
      zipSync({
        'UpNote/General Space/styles.css': strToU8('body {}'),
        'UpNote/General Space/Log.html': page('<div>Log</div><div>Left at seven. See <a href="Tide%20tables.html" data-note-id="019ecc37-3356-7452-a9f8-107ca6d2bff6">the tables</a>. <a data-upnote-tag="#boats" href="upnote://x-callback-url/tag/view?tag=boats">#boats</a></div>'),
        'UpNote/General Space/Tide tables.html': page('<h2>Tide tables</h2><div>High at 07:40. Back to <a href="Log.html" data-note-id="019ecc37-3356-7452-a9f8-107ca6d2bff7">Log</a>.</div>'),
        'UpNote/General Space/notebooks/Harbour/Log.html': strToU8('../../Log.html'),
        'UpNote/General Space/notebooks/Harbour/Tide tables.html': strToU8('../../Tide tables.html'),
      }) as BlobPart,
    ],
    'UpNote.zip',
  )

const links = (node: JSONContent): string[] => [...(node.type === 'noteLink' ? [String(node.attrs?.id)] : []), ...(node.content ?? []).flatMap(links)]

beforeEach(async () => {
  await db.items.clear()
  setNotice.mockClear()
  setImportReport.mockClear()
})

describe('importing an UpNote export', () => {
  it('with Nib Plus, links its notes to each other, files each in its notebook as a folder, and makes its hashtags categories', async () => {
    await actions(true).importFiles([exported()])
    expect(setNotice).toHaveBeenLastCalledWith('Imported 2 notes.')
    expect(setImportReport).not.toHaveBeenCalled()
    const stored = await db.items.toArray()
    const called = (title: string) => stored.find((one) => titleOf(one.body) === title)!
    const [log, tables] = ['Log', 'Tide tables'].map(called)
    expect(links(log.body)).toEqual([tables.id])
    expect(links(tables.body)).toEqual([log.id])
    expect([log.folder, tables.folder]).toEqual(['Harbour', 'Harbour'])
    expect(log.categories?.map((category) => category.name)).toEqual(['boats'])
    expect(tables.categories).toBeUndefined()
  })

  it('without it, still links them, leaves them unfiled, and says so in UpNote’s words', async () => {
    await actions(false).importFiles([exported()])
    const stored = await db.items.toArray()
    const called = (title: string) => stored.find((one) => titleOf(one.body) === title)!
    expect(links(called('Log').body)).toEqual([called('Tide tables').id])
    expect(stored.every((one) => one.folder === undefined && one.categories === undefined)).toBe(true)
    expect(setImportReport).toHaveBeenLastCalledWith({ imported: ['note', 'note'], skipped: ['UpNote’s notebooks and tags, which come in with Nib Plus'] })
  })
})
