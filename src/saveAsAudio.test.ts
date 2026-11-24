// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Theme } from './lib/theme'
import type { Sort } from './lib/sort'
import type { OpenDocument } from './lib/useOpenDocument'
import { db } from './db/db'
import * as items from './db/items'

/** Commands → Save as audio and the Manuscript's audio (fileActions saveAsAudio, listenToManuscript): the voice itself stood in for (lib/readAloud record). And compiling, which gathers a book the same way. */

const audio = vi.hoisted(() => ({ record: vi.fn(), stop: vi.fn(async () => {}), handed: vi.fn(), downloaded: vi.fn() }))
vi.mock('./lib/readAloud', async (actual) => ({ ...(await actual<typeof import('./lib/readAloud')>()), record: audio.record, stopRecording: audio.stop }))
vi.mock('./lib/exportFile', async (actual) => ({ ...(await actual<typeof import('./lib/exportFile')>()), handOverFile: audio.handed }))
vi.mock('./lib/download', async (actual) => ({ ...(await actual<typeof import('./lib/download')>()), download: audio.downloaded }))

const { AUDIO_PLUS, RecordingStopped } = await import('./lib/readAloud')
const { fileActions } = await import('./fileActions')

const text = (words: string) => ({ type: 'text', text: words })
const page = (title: string, ...lines: string[]) => ({
  type: 'doc',
  content: [{ type: 'heading', attrs: { level: 1 }, content: [text(title)] }, ...lines.map((line) => ({ type: 'paragraph', content: [text(line)] }))],
})
const setNotice = vi.fn()
const askPlus = vi.fn()
const said = () => audio.record.mock.calls.at(-1)![1].flatMap((piece: { say?: string; pause?: number }) => (piece.say ? [piece.say] : ['—']))

function actions(open: string | null, features = true) {
  const session = { flush: async () => {}, guarded: async (action: () => Promise<unknown>) => action(), whenSaved: async (run: (id: string) => Promise<void>) => open && run(open) } as unknown as OpenDocument
  return fileActions({ session, setNotice, features, askPlus, everything: [], theme: 'light' as Theme, sort: 'recent' as Sort, setImportReport: vi.fn(), onRestored: vi.fn() })
}
const lock = (id: string) => db.items.update(id, { vault: { v: 1, iv: 'a', data: 'b' } as never })

beforeEach(async () => {
  await db.items.clear()
  for (const mock of [setNotice, askPlus, audio.record, audio.stop, audio.handed, audio.downloaded]) mock.mockClear()
  audio.record.mockReset()
})

describe('saving the open note or page as audio', () => {
  it('names it for its title, says how far it has got with Stop, then hands it over', async () => {
    const id = await items.create('page', page('Salt and weed', 'The tide came in.'))
    audio.record.mockImplementationOnce(async (_name: string, _pieces: unknown, onProgress: (done: number) => void) => {
      onProgress(0.5)
      return 'file:///caches/exports/Salt%20and%20weed.m4a'
    })
    await actions(id).saveAsAudio()
    expect(audio.record.mock.calls[0][0]).toBe('Salt and weed.m4a')
    expect(said()).toEqual(['Salt and weed', 'The tide came in.'])
    const making = setNotice.mock.calls.map(([notice]) => notice).find((notice) => notice?.text === 'Making the audio… 50%')
    expect(making.action.label).toBe('Stop')
    making.action.run()
    expect(audio.stop).toHaveBeenCalledOnce()
    expect(setNotice).toHaveBeenLastCalledWith(null)
    expect(audio.handed).toHaveBeenCalledWith('file:///caches/exports/Salt%20and%20weed.m4a', expect.any(Function))
  })

  it('asks for Plus without it, says when there’s nothing to read, and keeps nothing of one stopped', async () => {
    const id = await items.create('page', page('Salt and weed', 'The tide came in.'))
    await actions(id, false).saveAsAudio()
    expect(askPlus).toHaveBeenCalledWith(AUDIO_PLUS)
    const empty = await items.create('note', { type: 'doc', content: [{ type: 'paragraph' }] })
    await actions(empty).saveAsAudio()
    expect(setNotice).toHaveBeenLastCalledWith('There’s nothing here to read.')
    audio.record.mockRejectedValueOnce(new RecordingStopped())
    await actions(id).saveAsAudio()
    expect(setNotice).toHaveBeenLastCalledWith('Stopped. No audio was saved.')
    expect(audio.handed).not.toHaveBeenCalled()
  })

  it('won’t make a locked one with the vault shut', async () => {
    const id = await items.create('page', page('Salt and weed', 'The tide came in.'))
    await lock(id)
    await actions(id).saveAsAudio()
    expect(setNotice).toHaveBeenLastCalledWith('This is locked. Open the vault to save it as audio.')
    expect(audio.record).not.toHaveBeenCalled()
  })
})

describe('a book, as the Manuscript makes it', () => {
  async function book() {
    const one = await items.create('page', page('One', 'Steps.'), { folder: 'The Lighthouse' })
    const two = await items.create('page', page('Two', 'Oil.'), { folder: 'The Lighthouse/Later' })
    const three = await items.create('page', page('Three', 'Wind.'), { folder: 'The Lighthouse/Later' })
    await lock(three)
    const get = async (id: string) => (await items.get(id))!
    return [
      { name: null, folder: 'The Lighthouse', chapters: [await get(one)] },
      { name: 'Later', folder: 'The Lighthouse/Later', chapters: [await get(two), await get(three)] },
    ]
  }

  it('is one file for the book: its title page, then each part’s name and its chapters, a pause between, with a locked one left out and said so', async () => {
    const parts = await book()
    audio.record.mockResolvedValueOnce('file:///caches/exports/The%20Lighthouse.m4a')
    await actions(null).listenToManuscript('The Lighthouse', parts)
    expect(audio.record.mock.calls[0][0]).toBe('The Lighthouse.m4a')
    expect(said()).toEqual(['The Lighthouse', '—', 'One', 'Steps.', '—', 'Later', '—', 'Two', 'Oil.'])
    expect(setNotice).toHaveBeenLastCalledWith('One locked page couldn’t be opened, so it isn’t in the audio.')
  })

  it('is compiled from the same pages, as it was', async () => {
    const parts = await book()
    await actions(null).compileManuscript('The Lighthouse', parts, 'epub')
    expect(audio.downloaded.mock.calls[0][1]).toBe('The Lighthouse.epub')
    expect(setNotice).toHaveBeenLastCalledWith('One locked page couldn’t be opened, so it isn’t in the book.')
  })
})
