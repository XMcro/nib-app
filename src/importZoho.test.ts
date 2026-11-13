// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import type { JSONContent } from '@tiptap/react'
import { db, type Item } from './db/db'
import { fileActions } from './fileActions'
import type { Sort } from './lib/sort'
import { tarOf } from './lib/tarOf'
import { titleOf } from './lib/text'
import type { Theme } from './lib/theme'
import type { OpenDocument } from './lib/useOpenDocument'

/** Zoho Notebook's export brought in whole, in each of its two forms (lib/importApps reads them): its cards link to each other, and each has a notebook and tags. */

const setNotice = vi.fn()
const setImportReport = vi.fn()

function actions(features = false, everything: Item[] = []) {
  const session = { flush: async () => {}, guarded: async (action: () => Promise<unknown>) => action(), currentKind: () => 'note' } as unknown as OpenDocument
  return fileActions({ session, setNotice, features, askPlus: vi.fn(), everything, theme: 'light' as Theme, sort: 'recent' as Sort, setImportReport, onRestored: vi.fn() })
}

const [LOG, TABLES, BOOK] = ['ihl6e0001', 'ihl6e0002', 'ihl6e0900']
const attr = (value: unknown) => JSON.stringify(value).replace(/"/g, '&quot;')
const card = (name: string, inner: string, tags?: string[]) =>
  strToU8(`<html><head><title>${name}</title></head><body data-notebook="${attr({ name: 'Harbour' })}" data-notecard="${attr({ name, created_date: '2024-04-13T18:21:59+0200', modified_date: '2024-04-14T17:59:58+0200' })}"${tags ? ` data-tag="${attr(tags)}"` : ''}><content><content>${inner}</content></content></body></html>`)
const asHtml = () =>
  zipSync({
    '2009/index.html': strToU8('<html><title>Notebook Exported data</title><body><h1>Notebook Exported Data</h1></body></html>'),
    [`2009/${LOG}.html`]: card('Log', `<div>Left at seven. See <a href="zohonotebook://notes/${TABLES}">the tables</a>.<br></div>`, ['boats']),
    [`2009/${TABLES}.html`]: card('Tide tables', `<div>High at 07:40. Back to <a href="zohonotebook://notes/${LOG}">Log</a>.<br></div>`),
  })
const znel = (title: string, inner: string, tags: string[] = []) =>
  `<ZNote znelVersion="1"><ZMeta><ZTitle>${title}</ZTitle><ZCreatedDate>2024-04-13T16:21:59+0000</ZCreatedDate><ZModifiedDate>2024-04-13T16:28:44+0000</ZModifiedDate><ZNoteType typeVersion="1">note/mixed</ZNoteType></ZMeta><ZContent><![CDATA[<content>${inner}</content>]]></ZContent><ZTags>${tags.map((tag) => `<ZTag>${tag}</ZTag>`).join('')}</ZTags><ZReminders/></ZNote>`
const asZnote = () =>
  zipSync({
    [`2009/${BOOK}/meta.json`]: strToU8(JSON.stringify({ data_type: 'NOTEBOOK', name: 'Harbour', notebook_id: BOOK })),
    [`2009/${BOOK}/${LOG}.znote`]: tarOf([{ name: `${LOG}/Note.znel`, data: znel('Log', `<div>Left at seven. See <a class="zn-link editor-note-link" href="zohonotebook://notes/${TABLES}" target="_blank">the tables</a>.<br/></div>`, ['boats']) }]),
    [`2009/${BOOK}/${TABLES}.znote`]: tarOf([{ name: `${TABLES}/Note.znel`, data: znel('Tide tables', `<div>High at 07:40. Back to <a class="zn-link editor-note-link" href="zohonotebook://notes/${LOG}" target="_blank">Log</a>.<br/></div>`) }]),
  })

const links = (node: JSONContent): string[] => [...(node.type === 'noteLink' ? [String(node.attrs?.id)] : []), ...(node.content ?? []).flatMap(links)]

beforeEach(async () => {
  await db.items.clear()
  setNotice.mockClear()
  setImportReport.mockClear()
})

describe('importing a Zoho Notebook export', () => {
  for (const [form, exported] of [['HTML', asHtml], ['ZNote', asZnote]] as const) {
    it(`as ${form}, with Nib Plus: links its cards to each other, files each in its notebook as a folder, and makes its tags categories`, async () => {
      await actions(true).importFiles([new File([exported() as BlobPart], 'Notebook.zip')])
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
      expect(log.createdAt).toBe(Date.UTC(2024, 3, 13, 16, 21, 59))
    })

    it(`as ${form}, without it: still links them, leaves them unfiled, and says so in Zoho Notebook’s words`, async () => {
      await actions(false).importFiles([new File([exported() as BlobPart], 'Notebook.zip')])
      const stored = await db.items.toArray()
      const called = (title: string) => stored.find((one) => titleOf(one.body) === title)!
      expect(links(called('Log').body)).toEqual([called('Tide tables').id])
      expect(stored.every((one) => one.folder === undefined && one.categories === undefined)).toBe(true)
      expect(setImportReport).toHaveBeenLastCalledWith({ imported: ['note', 'note'], skipped: ['Zoho Notebook’s notebooks and tags, which come in with Nib Plus'] })
    })
  }
})
