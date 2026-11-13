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

/** An Obsidian vault brought in whole (lib/importApps reads it): its notes link to each other by what their files are called. Written from Obsidian's own account of its format, not by Obsidian. */

const setNotice = vi.fn()
const setImportReport = vi.fn()

function actions(features = false, everything: Item[] = []) {
  const session = { flush: async () => {}, guarded: async (action: () => Promise<unknown>) => action(), currentKind: () => 'note' } as unknown as OpenDocument
  return fileActions({ session, setNotice, features, askPlus: vi.fn(), everything, theme: 'light' as Theme, sort: 'recent' as Sort, setImportReport, onRestored: vi.fn() })
}

const links = (node: JSONContent): string[] => [...(node.type === 'noteLink' ? [String(node.attrs?.id)] : []), ...(node.content ?? []).flatMap(links)]

beforeEach(async () => {
  await db.items.clear()
  setNotice.mockClear()
  setImportReport.mockClear()
})

describe('importing an Obsidian vault', () => {
  it('links its notes by their file names: plainly, by folder, by another name, to a heading, and where one was shown inside another', async () => {
    const vault = zipSync({
      'Vault/.obsidian/app.json': strToU8('{}'),
      'Vault/Harbour log.md': strToU8('Left at seven. See [[Tide tables]], [[Notes/Ferry times|the timetable]] and [[tide tables#Spring tides]].\n\n![[Ferry times]]\n\nNot [[Nowhere]].'),
      'Vault/Tide tables.md': strToU8('High at 07:40.'),
      'Vault/Notes/Ferry times.md': strToU8('Weekdays at seven. Back to [[Harbour log]].'),
    })
    await actions(true).importFiles([new File([vault as BlobPart], 'Vault.zip')])
    expect(setNotice).toHaveBeenLastCalledWith('Imported 3 notes.')
    expect(setImportReport).not.toHaveBeenCalled()
    const stored = await db.items.toArray()
    const called = (title: string) => stored.find((item) => titleOf(item.body) === title)!
    const [log, tides, ferry] = ['Harbour log', 'Tide tables', 'Ferry times'].map(called)
    expect(links(log.body)).toEqual([tides.id, ferry.id, tides.id, ferry.id])
    expect(links(ferry.body)).toEqual([log.id])
    expect(JSON.stringify(log.body)).toContain('Not [[Nowhere]].')
  })

  it('links to a heading and to a line by its ^id, and leaves no id in the words', async () => {
    const vault = zipSync({
      'Vault/.obsidian/app.json': strToU8('{}'),
      'Vault/Log.md': strToU8('See [[Trips#Buses]] and [[Trips#^last-train|the last one]].'),
      'Vault/Trips.md': strToU8('# Buses\n\nAt six.\n\nThe last train. ^last-train\n\n- On a list, no link to it ^orphan1\n'),
    })
    await actions(true).importFiles([new File([vault as BlobPart], 'Vault.zip')])
    const stored = await db.items.toArray()
    const called = (title: string) => stored.find((item) => titleOf(item.body).startsWith(title))!
    const walk = (node: JSONContent): JSONContent[] => [node, ...(node.content ?? []).flatMap(walk)]
    const trips = walk(called('Trips').body)
    const line = (words: string) => trips.find((node) => (node.type === 'paragraph' || node.type === 'heading') && node.content?.[0]?.text === words)!
    const [buses, train] = walk(called('Log').body).filter((node) => node.type === 'noteLink')
    expect(buses.attrs).toMatchObject({ id: called('Trips').id, block: line('Buses').attrs!.blockId, part: 'Buses' })
    expect(train.attrs).toMatchObject({ id: called('Trips').id, block: line('The last train.').attrs!.blockId, part: 'The last train.' })
    expect(JSON.stringify(called('Trips').body)).not.toContain('^')
    expect(line('On a list, no link to it').attrs?.blockId).toBeUndefined()
  })

  it('reads Nib’s own Markdown back, a link to a heading going to its heading, in files that are no vault', async () => {
    const files = zipSync({ 'Log.md': strToU8('See [[Trips#Buses]].'), 'Trips.md': strToU8('# Trips\n\n## Buses\n\nAt six.') })
    await actions(true).importFiles([new File([files as BlobPart], 'Files.zip')])
    const stored = await db.items.toArray()
    const log = stored.find((item) => titleOf(item.body).startsWith('See'))!
    const trips = stored.find((item) => titleOf(item.body) === 'Trips')!
    const heading = trips.body.content!.find((node) => node.content?.[0]?.text === 'Buses')!
    expect(log.body.content![0].content!.find((node) => node.type === 'noteLink')!.attrs).toMatchObject({ id: trips.id, block: heading.attrs!.blockId, part: 'Buses' })
  })

  const filed = () =>
    zipSync({
      'Vault/.obsidian/app.json': strToU8('{}'),
      'Vault/Log.md': strToU8('---\ntags: [sailing, Log]\n---\nAt the top. #SAILING again, and #boats.'),
      'Vault/Projects/Novel/Chapter 1.md': strToU8('# Chapter 1\n\n## Morning\n\nTwo deep. #log'),
      [`Vault/${'x'.repeat(61)}/Deep.md`]: strToU8(`In a folder with too long a name. #${'y'.repeat(61)}`),
    })
  const kept = async () => Object.fromEntries((await db.items.toArray()).map((item) => [titleOf(item.body), [item.kind, item.folder, item.categories]]))

  it('files them with Nib Plus: each in its folder, each tag a category, one colour to a name, the one it has here already', async () => {
    const here = { id: 'h', kind: 'note', body: { type: 'doc' }, version: 1, createdAt: 1, updatedAt: 1, categories: [{ name: 'Boats', color: 'pink' }] } as Item
    await actions(true, [here]).importFiles([new File([filed() as BlobPart], 'Vault.zip')])
    expect(setNotice).toHaveBeenLastCalledWith('Imported 3 notes and pages.')
    expect(setImportReport).not.toHaveBeenCalled()
    expect(await kept()).toEqual({
      // "Boats" is pink here already; the others take the next of Customize's colours: teal, then green.
      Log: ['note', undefined, [{ name: 'sailing', color: 'teal' }, { name: 'Log', color: 'green' }, { name: 'boats', color: 'pink' }]],
      'Chapter 1': ['page', 'Novel', [{ name: 'log', color: 'green' }]],
      // A name longer than a folder's or a category's can be is left off, and the note still comes in.
      Deep: ['note', undefined, undefined],
    })
  })

  it('leaves them unfiled without it, and says so', async () => {
    await actions(false).importFiles([new File([filed() as BlobPart], 'Vault.zip')])
    expect(await kept()).toEqual({ Log: ['note', undefined, undefined], 'Chapter 1': ['page', undefined, undefined], Deep: ['note', undefined, undefined] })
    expect(setImportReport).toHaveBeenCalledWith({ imported: ['note', 'page', 'note'], skipped: ['The vault’s folders and tags, which come in with Nib Plus'] })
  })

  it('says nothing of Nib Plus for a vault with neither', async () => {
    const plain = zipSync({ 'Vault/.obsidian/app.json': strToU8('{}'), 'Vault/Log.md': strToU8('At the top.') })
    await actions(false).importFiles([new File([plain as BlobPart], 'Vault.zip')])
    expect(setNotice).toHaveBeenLastCalledWith('Imported one note.')
    expect(setImportReport).not.toHaveBeenCalled()
  })
})
