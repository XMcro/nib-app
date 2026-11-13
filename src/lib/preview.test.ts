import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Opening an attached file (lib/preview): fetched if it isn't here, then the
 * system's viewer in the app, given only the copy made to open; a download in
 * a browser. The files, the server and the viewer are stand-ins here.
 */

const at = vi.hoisted(() => ({
  here: new Set<string>(),
  server: new Set<string>(),
  app: true,
  shown: [] as string[],
  drawn: [] as { uri: string; edge: number }[],
  png: 'iVBORw0KGgo=' as string | null,
  saved: [] as { type: string; size: number; name: string }[],
  calls: [] as string[],
}))
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    show: async ({ uri }: { uri: string }) => {
      if (uri.includes('unshown')) throw new Error('Nib is not on screen.')
      at.shown.push(uri)
    },
    thumbnail: async (asked: { uri: string; edge: number }) => {
      at.drawn.push(asked)
      if (at.png === null) throw new Error('No picture of that file.')
      return { png: at.png }
    },
  }),
}))
vi.mock('./files', () => ({
  hasFile: async (id: string) => at.here.has(id),
  namedFile: async (id: string, name: string) => {
    at.calls.push(`named ${id}`)
    if (!at.here.has(id) || name === 'uncopied') return null
    return at.app ? { uri: `file:///Caches/opened/${id}/${name}`, url: `capacitor://localhost/_capacitor_file_/Caches/opened/${id}/${name}` } : { uri: null, url: 'data:audio/mp4;base64,AAAA' }
  },
  readFile: async (id: string) => (at.here.has(id) ? new Blob(['the file']) : null),
}))
vi.mock('./originals', () => ({
  broughtHere: async (file: { id: string }) => {
    if (file.id === 'unreadable') throw new Error('The database is closed')
    if (at.here.has(file.id)) return true
    at.calls.push(`fetched ${file.id}`)
    if (at.server.has(file.id)) at.here.add(file.id)
    return at.here.has(file.id)
  },
}))
vi.mock('./download', () => ({
  download: async (blob: Blob, name: string) => {
    if (name === 'unsaved.pdf') throw new Error('No room')
    at.saved.push({ type: blob.type, size: blob.size, name })
  },
}))

const { firstPage, openAttached, playable } = await import('./preview')
const file = (id: string, type = 'application/pdf') => ({ id, type, size: 8 })

beforeEach(() => {
  at.here = new Set(['here'])
  at.server = new Set(['there'])
  at.app = true
  at.png = 'iVBORw0KGgo='
  for (const list of [at.shown, at.drawn, at.saved, at.calls]) list.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('opening an attachment', () => {
  it('shows one that’s on this device in the system’s viewer, from the copy under its name, asking nothing of the server', async () => {
    expect(await openAttached(file('here'), 'report.pdf')).toBe('opened')
    expect(at.shown).toEqual(['file:///Caches/opened/here/report.pdf'])
    expect(at.calls).toEqual(['named here'])
    expect(at.saved).toEqual([])
  })

  it('fetches one that isn’t here first, and says it’s away, opening nothing, when it can’t be had', async () => {
    expect(await openAttached(file('there'), 'report.pdf')).toBe('opened')
    expect(at.calls).toEqual(['fetched there', 'named there'])
    expect(at.shown).toEqual(['file:///Caches/opened/there/report.pdf'])
    at.calls.length = 0
    expect(await openAttached(file('nowhere'), 'report.pdf')).toBe('away')
    expect(at.calls).toEqual(['fetched nowhere'])
    expect(at.shown).toHaveLength(1)
  })

  it('says it failed when the viewer couldn’t come up, or the copy couldn’t be made', async () => {
    expect(await openAttached(file('here'), 'unshown.pdf')).toBe('failed')
    expect(await openAttached(file('here'), 'uncopied')).toBe('failed')
    expect(await openAttached(file('unreadable'), 'report.pdf')).toBe('failed')
  })

  it('is a download in a browser, as its own kind and under its own name', async () => {
    at.app = false
    expect(await openAttached(file('here', 'text/csv'), 'tides.csv')).toBe('opened')
    expect(at.saved).toEqual([{ type: 'text/csv', size: 8, name: 'tides.csv' }])
    expect(at.shown).toEqual([])
    expect(await openAttached(file('here'), 'unsaved.pdf')).toBe('failed')
  })
})

describe('what a card shows of a file that’s here', () => {
  it('plays a recording from where the page can, and fetches nothing to find out', async () => {
    expect(await playable(file('here', 'audio/mp4'), 'memo.m4a')).toBe('capacitor://localhost/_capacitor_file_/Caches/opened/here/memo.m4a')
    expect(await playable(file('there', 'audio/mp4'), 'memo.m4a')).toBeNull()
    expect(at.calls).toEqual(['named here'])
    expect(at.here.has('there')).toBe(false)
  })

  it('has the system draw a first page, in the app only, for a file that’s here, and takes nothing but a picture back', async () => {
    expect(await firstPage(file('here'), 'report.pdf', 96)).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(at.drawn).toEqual([{ uri: 'file:///Caches/opened/here/report.pdf', edge: 96 }])
    expect(await firstPage(file('there'), 'report.pdf', 96)).toBeNull()
    expect(at.calls).toEqual(['named here'])
    for (const not of ['', '" onerror="x', 'AAAA,BBBB', 'AA AA']) {
      at.png = not
      expect(await firstPage(file('here'), 'report.pdf', 96), not).toBeNull()
    }
    at.png = null
    expect(await firstPage(file('here'), 'report.pdf', 96)).toBeNull()
    at.app = false
    at.png = 'iVBORw0KGgo='
    at.drawn.length = 0
    expect(await firstPage(file('here'), 'report.pdf', 96)).toBeNull()
    expect(at.drawn).toEqual([])
  })
})
