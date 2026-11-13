import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { Theme } from './lib/theme'
import type { Sort } from './lib/sort'
import type { OpenDocument } from './lib/useOpenDocument'
import { db } from './db/db'
import * as items from './db/items'
import { fileActions } from './fileActions'
import { SaveRefused } from './lib/download'

const mocks = vi.hoisted(() => ({ download: vi.fn(async () => {}) }))
vi.mock('./lib/download', async (actual) => ({ ...(await actual<typeof import('./lib/download')>()), download: mocks.download }))

const body = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

const setNotice = vi.fn()
const askPlus = vi.fn()

function actions(features = true) {
  const session = { flush: async () => {}, guarded: async (action: () => Promise<unknown>) => action() } as unknown as OpenDocument
  return fileActions({ session, setNotice, features, askPlus, everything: [], theme: 'light' as Theme, sort: 'recent' as Sort, setImportReport: vi.fn(), onRestored: vi.fn() })
}

beforeEach(async () => {
  await db.items.clear()
  mocks.download.mockReset().mockResolvedValue(undefined)
  setNotice.mockClear()
  askPlus.mockClear()
})

describe('exporting everything', () => {
  it('takes the archive along, as it’s put away and not left behind', async () => {
    await items.create('note', body('In the open'))
    const kept = await items.create('note', body('Put away for good'))
    await items.setArchived(kept, true)
    await items.setArchived(await items.create('page', body('A page put away')), true)
    await actions().exportAll()
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalled())
    const [content] = mocks.download.mock.calls[0] as unknown as [string]
    expect(content).toContain('In the open')
    expect(content).toContain('Put away for good')
    expect(content).toContain('A page put away')
  })
})

describe('exporting the ones picked', () => {
  /** A lock no passcode here opens: the vault is shut. */
  const lock = (id: string) => db.items.update(id, { vault: { v: 1, iv: 'a', data: 'b' } as never })
  const handed = async () => {
    const [zip, name] = mocks.download.mock.calls[0] as unknown as [Blob, string]
    return { name, files: unzipSync(new Uint8Array(await zip.arrayBuffer())) }
  }

  it('hands over one zip, named for the day, with a Markdown file for each and no other', async () => {
    const one = await items.create('note', body('First of them'))
    const two = await items.create('page', body('Second of them'))
    await items.create('note', body('Not picked'))
    const heard: number[][] = []
    await actions(false).exportMany([one, two], 'md', (which, of) => heard.push([which, of]))
    const { name, files } = await handed()
    expect(name).toMatch(/^nib-export-\d{4}-\d\d-\d\d\.zip$/)
    expect(Object.keys(files)).toEqual(['First of them.md', 'Second of them.md'])
    expect(strFromU8(files['Second of them.md'])).toBe('Second of them')
    expect(heard).toEqual([[1, 2], [2, 2]])
    expect(setNotice).not.toHaveBeenCalled()
    expect(askPlus).not.toHaveBeenCalled()
  })

  it('asks for Nib Plus for HTML and for PDF without it, and exports nothing', async () => {
    const one = await items.create('note', body('First of them'))
    await actions(false).exportMany([one], 'html', () => {})
    await actions(false).exportMany([one], 'pdf', () => {})
    expect(askPlus).toHaveBeenCalledTimes(2)
    expect(askPlus.mock.calls[0][0]).toContain('Markdown export is free')
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('leaves out a locked note with the vault shut, and says so', async () => {
    const one = await items.create('note', body('In the open'))
    const two = await items.create('note', body('Under lock'))
    const three = await items.create('note', body('Under lock too'))
    await lock(two)
    await actions().exportMany([one, two], 'md', () => {})
    expect(Object.keys((await handed()).files)).toEqual(['In the open.md'])
    expect(setNotice).toHaveBeenLastCalledWith('One locked note couldn’t be opened, so it isn’t in the zip.')
    await lock(three)
    await actions().exportMany([one, two, three], 'md', () => {})
    expect(setNotice).toHaveBeenLastCalledWith('2 locked notes couldn’t be opened, so they aren’t in the zip.')
  })

  it('hands nothing over when every one is locked, and says why', async () => {
    const one = await items.create('note', body('Under lock'))
    const two = await items.create('note', body('Under lock too'))
    await lock(one)
    await lock(two)
    await actions().exportMany([one, two], 'md', () => {})
    expect(setNotice).toHaveBeenLastCalledWith('These are locked. Open the vault to export them.')
    await actions().exportMany([one], 'md', () => {})
    expect(setNotice).toHaveBeenLastCalledWith('This is locked. Open the vault to export it.')
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('says so when the zip can’t be handed over, and not that a locked one was left out of it', async () => {
    const one = await items.create('note', body('In the open'))
    const two = await items.create('note', body('Under lock'))
    await lock(two)
    mocks.download.mockRejectedValue(new Error('no room'))
    await actions().exportMany([one, two], 'md', () => {})
    expect(setNotice).toHaveBeenCalledTimes(1)
    expect(setNotice).toHaveBeenLastCalledWith('Couldn’t export those. Your writing is safe here.')
  })
})

// Seen on a Mac, 2026-11-12: with the Desktop in iCloud Drive, macOS wouldn't let Nib save a backup there, and Nib said nothing.
describe('a folder the Mac won’t save into', () => {
  const refused = 'That folder wouldn’t take the file. Try another, such as Downloads.'

  it('says to try another folder, for a backup and for an export', async () => {
    const one = await items.create('note', body('Kept'))
    mocks.download.mockRejectedValue(new SaveRefused())
    await actions().backupAll()
    await vi.waitFor(() => expect(setNotice).toHaveBeenLastCalledWith(refused))
    setNotice.mockClear()
    await actions().exportMany([one], 'md', () => {})
    expect(setNotice).toHaveBeenLastCalledWith(refused)
  })
})
