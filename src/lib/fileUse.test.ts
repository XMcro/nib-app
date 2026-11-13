import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { db } from '../db/db'
import * as items from '../db/items'
import * as revisions from '../db/revisions'
import { filesGone } from './fileQueue'
import { sweepFiles } from './fileUse'
import type { Full } from './image'

/**
 * Clearing the files nothing uses (lib/fileUse `sweepFiles`), with the real
 * library and a Map standing in for the file store (lib/files), which has its
 * own tests.
 */

const device = vi.hoisted(() => ({ files: new Map<string, number>() }))
vi.mock('./files', () => ({
  listFiles: async () => [...device.files].map(([id, size]) => ({ id, size })),
  forgetFile: async (id: string) => void device.files.delete(id),
}))

const DAY = 86_400_000
const START = Date.UTC(2027, 0, 1)
const SMALL = `data:image/png;base64,${btoa('the small picture a note holds')}`
const pictured = (text: string, ...fulls: Full[]): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }, ...fulls.map((full) => ({ type: 'image', attrs: { src: SMALL, full } }))] }],
})
function original(): Full {
  const id = crypto.randomUUID()
  device.files.set(id, 4000)
  return { id, type: 'image/png', size: 4000 }
}
const here = () => [...device.files.keys()]

let stored: Map<string, string>

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.revisions.clear()])
  device.files.clear()
  stored = new Map()
  vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v), removeItem: (k: string) => stored.delete(k) })
})
afterEach(() => vi.unstubAllGlobals())

describe('clearing the files nothing uses', () => {
  it('deletes one no document names, from here and from the server, the second day it’s found so and not the first', async () => {
    const used = original()
    const unused = original()
    await items.create('note', pictured('On the hill', used))
    await sweepFiles(START)
    expect(here()).toEqual([used.id, unused.id])
    expect(filesGone()).toEqual([])
    await sweepFiles(START + DAY)
    expect(here()).toEqual([used.id])
    expect(filesGone()).toEqual([unused.id])
    // And nothing more of it the day after.
    await sweepFiles(START + 2 * DAY)
    expect(here()).toEqual([used.id])
  })

  it('looks once a day at most', async () => {
    const unused = original()
    await sweepFiles(START)
    await sweepFiles(START + DAY - 1)
    expect(here()).toEqual([unused.id])
    await sweepFiles(START + DAY)
    expect(here()).toEqual([])
  })

  it('keeps one that’s named again before the second look: cut from one note, pasted into another', async () => {
    const full = original()
    await sweepFiles(START)
    await items.create('note', pictured('Pasted here', full))
    await sweepFiles(START + DAY)
    expect(here()).toEqual([full.id])
    // Out of use again later, its history gone too, it's two looks from then, not one.
    await Promise.all([db.items.clear(), db.revisions.clear()])
    await sweepFiles(START + 2 * DAY)
    expect(here()).toEqual([full.id])
    await sweepFiles(START + 3 * DAY)
    expect(here()).toEqual([])
  })

  it('keeps what a note in the Trash names, a note kept on this device only, and a past version of a note', async () => {
    const [trashed, kept, past] = [original(), original(), original()]
    await items.remove(await items.create('note', pictured('In the Trash', trashed)))
    await items.create('note', pictured('For this device', kept), { deviceOnly: true })
    const note = await items.create('note', pictured('Had a picture once'))
    await revisions.record(note, pictured('Had a picture once', past), { force: true, now: START - DAY })
    await sweepFiles(START)
    await sweepFiles(START + DAY)
    expect(here().sort()).toEqual([trashed.id, kept.id, past.id].sort())
    expect(filesGone()).toEqual([])
  })

  it('keeps an attachment’s file while a note holds the attachment, and clears it once none does', async () => {
    const file = original()
    const attached = (text: string, ...files: Full[]): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...files.map((one) => ({ type: 'attachment', attrs: { file: { ...one, type: 'application/pdf' }, name: 'report.pdf' } }))] })
    const note = await items.create('note', attached('Minutes', file))
    await sweepFiles(START)
    await sweepFiles(START + DAY)
    expect(here()).toEqual([file.id])
    await items.remove(note)
    await items.purge(note)
    await sweepFiles(START + 2 * DAY)
    await sweepFiles(START + 3 * DAY)
    expect(here()).toEqual([])
  })

  it('deletes what only a purged note named', async () => {
    const full = original()
    const note = await items.create('note', pictured('To be deleted for good', full))
    await sweepFiles(START)
    await items.remove(note)
    await items.purge(note)
    await sweepFiles(START + DAY)
    expect(here()).toEqual([full.id])
    await sweepFiles(START + 2 * DAY)
    expect(here()).toEqual([])
  })

  it('goes on looking whatever the device’s storage holds where its list was', async () => {
    const unused = original()
    stored.set('nib-files-unused', '{"not":"a list"}')
    await sweepFiles(START)
    expect(here()).toEqual([unused.id])
    await sweepFiles(START + DAY)
    expect(here()).toEqual([])
    expect(filesGone()).toEqual([unused.id])
  })
})
