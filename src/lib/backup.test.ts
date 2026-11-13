// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { db, type Item, type Revision } from '../db/db'
import * as items from '../db/items'
import {
  BACKUP_KIND,
  BACKUP_VERSION,
  BackupError,
  backupFilename,
  buildBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
  takeBackup,
} from './backup'
import { arrange, readFolderSettings, replaceFolderSettings } from './folderSettings'
import { deleteSavedLook, parseLook, readSavedLooks, replaceSavedLooks, saveLook, setLook } from './look'
import { allowedImageSrc, filterBodyImages } from './image'
import { readSort, writeSort } from './sort'
import { readTheme, writeTheme } from './theme'

/**
 * Restore is an import boundary; dump is an export boundary. Both use
 * `filterBodyImages` / `allowedImageSrc` in `src/lib/image.ts`. These tests
 * fail if either path invents a second policy, dumps each data URI per
 * revision, or drops pins/trash/ids/history.
 */

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const AT = Date.parse('2026-08-13T12:00:00Z')

const para = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const withImage = (text: string, src = PNG): JSONContent => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text },
        { type: 'image', attrs: { src, alt: 'pixel' } },
      ],
    },
  ],
})

const item = (overrides: Partial<Item> & Pick<Item, 'id'>): Item => ({
  kind: 'note',
  body: para('x'),
  version: 1,
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
})

const revision = (overrides: Partial<Revision> & Pick<Revision, 'id' | 'itemId'>): Revision => ({
  body: para('old'),
  createdAt: 1,
  ...overrides,
})

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
  writeTheme('system')
  writeSort('updated')
})

describe('backupFilename', () => {
  it('is dated and ends in .json', () => {
    expect(backupFilename(AT)).toBe('nib-backup-2026-08-13.json')
  })
})

describe('buildBackup', () => {
  it('stores a data-URI image once even when twenty revisions carry it', async () => {
    const id = 'note-with-picture'
    const history = Array.from({ length: 20 }, (_, index) =>
      revision({
        id: `rev-${index}`,
        itemId: id,
        body: withImage(`draft ${index}`),
        createdAt: index + 1,
      }),
    )
    const file = serializeBackup(
      await buildBackup(
        [item({ id, body: withImage('current'), version: 21, pinnedAt: 9 })],
        history,
        { theme: 'dark', sort: 'title' },
        AT,
      ),
    )

    expect(file.split(PNG).length - 1).toBe(1)
    expect(file).toContain('"kind":"nib-backup"')
    expect(file).not.toContain('"src":"data:image')

    const parsed = JSON.parse(file) as { images: Record<string, string>; revisions: Revision[] }
    expect(Object.keys(parsed.images)).toHaveLength(1)
    expect(allowedImageSrc(Object.values(parsed.images)[0])).toBe(true)
    expect(parsed.revisions).toHaveLength(20)
  })

  it.each([
    'https://evil.test/pixel.png',
    'javascript:alert(1)',
    'blob:https://evil.test/abc',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  ])('does not write a src allowedImageSrc refuses into the file (%s)', async (src) => {
    expect(allowedImageSrc(src)).toBe(false)

    const file = serializeBackup(
      await buildBackup(
        [
          item({ id: 'bad', body: withImage('payload', src) }),
          item({ id: 'ok', body: withImage('kept') }),
        ],
        [revision({ id: 'r', itemId: 'bad', body: withImage('old', src) })],
        {},
        AT,
      ),
    )

    expect(file).not.toContain(src)
    expect(file).not.toMatch(/"src":"https:/)
    expect(file).not.toMatch(/"src":"javascript:/)
    expect(file.split(PNG).length - 1).toBe(1)
    expect(file).toContain('"id":"bad"')
    expect(file).toContain('"id":"ok"')
  })
})

describe('restoreBackup', () => {
  it('round-trips ids, pins, trash, history, bodies, theme and sort', async () => {
    const live = item({
      id: 'keep-me',
      kind: 'note',
      body: para('still here'),
      version: 4,
      createdAt: 10,
      updatedAt: 40,
      pinnedAt: 30,
    })
    const trashed = item({
      id: 'in-trash',
      kind: 'page',
      body: para('gone from the list'),
      version: 2,
      createdAt: 11,
      updatedAt: 41,
      deletedAt: 50,
    })
    const pictured = item({
      id: 'pictured',
      body: withImage('now'),
      version: 3,
      createdAt: 12,
      updatedAt: 42,
    })
    const history = [
      revision({ id: 'r1', itemId: 'pictured', body: withImage('then'), createdAt: 20 }),
      revision({ id: 'r2', itemId: 'pictured', body: withImage('now'), createdAt: 42 }),
    ]

    const file = serializeBackup(
      await buildBackup([live, trashed, pictured], history, { theme: 'dark', sort: 'title' }, AT),
    )

    await items.create('note', para('should vanish'))
    await restoreBackup(file)

    const kept = await items.get('keep-me')
    expect(kept?.id).toBe('keep-me')
    expect(kept?.pinnedAt).toBe(30)
    expect(kept?.version).toBe(4)
    expect(kept?.body).toEqual(para('still here'))
    expect(kept?.deletedAt).toBeUndefined()

    expect(await items.list('note')).toHaveLength(2)
    expect(await items.list('page')).toHaveLength(0)
    const dumped = await items.listTrash()
    expect(dumped).toHaveLength(1)
    expect(dumped[0].id).toBe('in-trash')
    expect(dumped[0].deletedAt).toBe(50)
    expect(dumped[0].kind).toBe('page')

    const restoredHistory = await db.revisions.where('itemId').equals('pictured').sortBy('createdAt')
    expect(restoredHistory.map((entry) => entry.id)).toEqual(['r1', 'r2'])
    expect(restoredHistory[0].body).toEqual(withImage('then'))
    expect((await items.get('pictured'))?.body).toEqual(withImage('now'))

    expect(readTheme()).toBe('dark')
    expect(readSort()).toBe('title')
  })

  it('holds a picture as its note has it, and which file its original is: the file itself stays on the device, found again there after a restore', async () => {
    const full = { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'image/jpeg', size: 4000000 }
    const body: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: PNG, alt: 'pixel', full } }] }] }
    const file = serializeBackup(buildBackup([item({ id: 'pictured', body })], [], { theme: 'dark' }, AT))
    expect(Object.values((JSON.parse(file) as { images: Record<string, string> }).images)).toEqual([PNG])
    await restoreBackup(file)
    expect((await items.get('pictured'))?.body).toEqual(body)
  })

  it('round-trips a named theme', async () => {
    writeTheme('system')
    await restoreBackup(serializeBackup(buildBackup([item({ id: 'one' })], [], { theme: 'gruvbox-light' }, AT)))
    expect(readTheme()).toBe('gruvbox-light')
  })

  it('round-trips the folders’ settings, and leaves this device’s for a backup with none', async () => {
    replaceFolderSettings({})
    expect(JSON.parse((await takeBackup()).content).preferences).not.toHaveProperty('folders')
    arrange(['Poems', 'Novel'])
    const arranged = readFolderSettings()
    const file = (await takeBackup({ theme: 'system' })).content
    replaceFolderSettings({ blog: { at: 1, place: 1 } })
    await restoreBackup(file)
    expect(readFolderSettings()).toEqual(arranged)
    // One from before there were any: what's here stays.
    await restoreBackup(serializeBackup(buildBackup([item({ id: 'one' })], [], {}, AT)))
    expect(readFolderSettings()).toEqual(arranged)
    // And what isn't settings is passed over.
    await restoreBackup(serializeBackup(buildBackup([item({ id: 'one' })], [], { folders: 'all of them' as never }, AT)))
    expect(readFolderSettings()).toEqual(arranged)
  })

  it('round-trips the saved looks, a deleted one too, but not the look in use, and leaves this device’s for a backup with none', async () => {
    replaceSavedLooks({})
    expect(JSON.parse((await takeBackup()).content).preferences).not.toHaveProperty('looks')
    setLook({ size: 'large' })
    saveLook('Drafting', 'light')
    deleteSavedLook('Editing')
    const saved = readSavedLooks()
    const file = (await takeBackup({ theme: 'system' })).content
    expect(JSON.parse(file).preferences).not.toHaveProperty('look')
    replaceSavedLooks({ Other: { at: 1, look: parseLook({}), theme: 'dark' } })
    await restoreBackup(file)
    expect(readSavedLooks()).toEqual(saved)
    expect(readSavedLooks().Editing).toMatchObject({ gone: true })
    // One from before there were any: what's here stays.
    await restoreBackup(serializeBackup(buildBackup([item({ id: 'one' })], [], {}, AT)))
    expect(readSavedLooks()).toEqual(saved)
    // And what isn't saved looks is passed over.
    await restoreBackup(serializeBackup(buildBackup([item({ id: 'one' })], [], { looks: 'all of them' as never }, AT)))
    expect(readSavedLooks()).toEqual(saved)
  })

  it('round-trips a document’s goal, a removed one, and none', async () => {
    const file = serializeBackup(
      buildBackup(
        [
          item({ id: 'aimed', goal: { words: 5000, deadline: '2026-11-30' } }),
          item({ id: 'cleared', goal: null }),
          item({ id: 'never' }),
        ],
        [],
        {},
        AT,
      ),
    )
    await restoreBackup(file)
    expect((await items.get('aimed'))?.goal).toEqual({ words: 5000, deadline: '2026-11-30' })
    expect((await items.get('cleared'))?.goal).toBeNull()
    expect(await items.get('never')).not.toHaveProperty('goal')
  })

  it('round-trips folders and categories, taken-out ones, and none, dropping what makes no sense', async () => {
    const file = serializeBackup(
      buildBackup(
        [
          item({ id: 'filed', folder: 'Novel', categories: [{ name: 'Draft', color: 'blue' }] }),
          item({ id: 'taken-out', folder: null, categories: [] }),
          item({ id: 'never' }),
          item({ id: 'odd', folder: '', categories: [{ name: 'Odd', color: '#f00' } as unknown as NonNullable<Item['categories']>[number]] }),
        ],
        [],
        {},
        AT,
      ),
    )
    await restoreBackup(file)
    expect(await items.get('filed')).toMatchObject({ folder: 'Novel', categories: [{ name: 'Draft', color: 'blue' }] })
    expect(await items.get('taken-out')).toMatchObject({ folder: null, categories: [] })
    expect(await items.get('never')).not.toHaveProperty('folder')
    expect(await items.get('never')).not.toHaveProperty('categories')
    // The document itself is kept: only the part that makes no sense goes.
    expect(await items.get('odd')).not.toHaveProperty('folder')
    expect((await items.get('odd'))?.categories).toEqual([])
  })

  it('round-trips a page’s place in its manuscript, a taken-away one, and none, dropping what makes no sense', async () => {
    const file = serializeBackup(
      buildBackup(
        [
          item({ id: 'placed', folder: 'Novel', position: 2.5 }),
          item({ id: 'taken-away', folder: 'Novel', position: null }),
          item({ id: 'never' }),
          item({ id: 'odd', folder: 'Novel', position: '3' as unknown as number }),
        ],
        [],
        {},
        AT,
      ),
    )
    await restoreBackup(file)
    expect((await items.get('placed'))?.position).toBe(2.5)
    expect((await items.get('taken-away'))?.position).toBeNull()
    expect(await items.get('never')).not.toHaveProperty('position')
    expect(await items.get('odd')).not.toHaveProperty('position')
  })

  it('round-trips the stamps put on a document, none put, and none ever, dropping what makes no sense', async () => {
    const file = serializeBackup(
      buildBackup(
        [
          item({ id: 'stamped', stamps: [{ day: '2026-11-04', no: 127 }, { day: '2026-10-31' }] }),
          item({ id: 'taken-off', stamps: [] }),
          item({ id: 'never' }),
          item({ id: 'odd', stamps: [{ day: '2026-11-04', no: 999 }, { day: '2026-11-05' }, { day: 'soon', no: 3 }, { day: '2026-11-06', no: 3 }] }),
        ],
        [],
        {},
        AT,
      ),
    )
    await restoreBackup(file)
    expect((await items.get('stamped'))?.stamps).toEqual([{ day: '2026-11-04', no: 127 }, { day: '2026-10-31' }])
    expect((await items.get('taken-off'))?.stamps).toEqual([])
    expect(await items.get('never')).not.toHaveProperty('stamps')
    // A number past the book's, a day with no holiday, a day that isn't one: only the one that makes sense stays.
    expect((await items.get('odd'))?.stamps).toEqual([{ day: '2026-11-06', no: 3 }])
  })

  it('round-trips a locked document still sealed, an unlocked one, and drops a malformed lock', async () => {
    const sealed = { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) }
    const file = serializeBackup(
      buildBackup(
        [item({ id: 'locked', vault: sealed }), item({ id: 'unlocked', vault: null }), item({ id: 'odd', vault: { salt: 'x', sealed: 'y' } })],
        [],
        {},
        AT,
      ),
    )
    await restoreBackup(file)
    expect((await items.get('locked'))?.vault).toEqual(sealed)
    expect((await items.get('unlocked'))?.vault).toBeNull()
    expect(await items.get('odd')).not.toHaveProperty('vault')
  })

  it('round-trips copies from sync not sealed yet, as text, a box or a seal, and drops a malformed one', async () => {
    const sealed = { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) }
    const file = serializeBackup(
      buildBackup(
        [
          item({ id: 'text', unsealed: { body: withImage('the other edit') } }),
          item({ id: 'box', unsealed: { box: 'C'.repeat(40) } }),
          item({ id: 'seal', unsealed: { vault: sealed, from: 'original' } }),
          item({ id: 'odd', unsealed: { vault: { salt: 'x', sealed: 'y' }, from: 'original' } }),
          item({ id: 'odd box', unsealed: { box: 'not base64url!' } }),
        ],
        [],
        {},
        AT,
      ),
    )
    expect(file.split(PNG).length - 1).toBe(1)
    await restoreBackup(file)
    expect((await items.get('text'))?.unsealed).toEqual({ body: withImage('the other edit') })
    expect((await items.get('box'))?.unsealed).toEqual({ box: 'C'.repeat(40) })
    expect((await items.get('seal'))?.unsealed).toEqual({ vault: sealed, from: 'original' })
    expect(await items.get('odd')).not.toHaveProperty('unsealed')
    expect(await items.get('odd box')).not.toHaveProperty('unsealed')
  })

  it('round-trips a document’s shared drafts, dropping malformed ones', async () => {
    const share = { slug: 'S'.repeat(22), key: 'K'.repeat(43), owner: 'O'.repeat(43), createdAt: 1, expiresAt: 2 }
    const file = serializeBackup(
      buildBackup([item({ id: 'shared', shares: [share, { ...share, slug: 'bad' }] }), item({ id: 'none', shares: [] })], [], {}, AT),
    )
    await restoreBackup(file)
    expect((await items.get('shared'))?.shares).toEqual([share])
    expect((await items.get('none'))?.shares).toEqual([])
  })

  it('drops a goal that makes no sense, and a deadline that isn’t a day, keeping the document', () => {
    const file = JSON.stringify({
      kind: BACKUP_KIND,
      version: BACKUP_VERSION,
      exportedAt: AT,
      preferences: {},
      images: {},
      items: [
        item({ id: 'zero', goal: { words: 0 } }),
        item({ id: 'text', goal: 'lots' as unknown as Item['goal'] }),
        item({ id: 'feb-30', goal: { words: 900, deadline: '2026-02-30' } }),
      ],
      revisions: [],
    })
    const [zero, text, feb30] = parseBackup(file).items
    expect(zero).not.toHaveProperty('goal')
    expect(text).not.toHaveProperty('goal')
    expect(feb30.goal).toEqual({ words: 900 })
  })

  it.each([
    'https://evil.test/pixel.png',
    'javascript:alert(1)',
    'blob:https://evil.test/abc',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  ])('does not persist a src allowedImageSrc refuses (%s)', async (src) => {
    expect(allowedImageSrc(src)).toBe(false)
    expect(filterBodyImages(withImage('payload', src))).toEqual(
      filterBodyImages({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'payload' }] }],
      }),
    )

    const file = JSON.stringify({
      kind: BACKUP_KIND,
      version: BACKUP_VERSION,
      exportedAt: AT,
      preferences: {},
      images: { evil: src },
      items: [
        item({ id: 'safe', body: para('kept') }),
        item({ id: 'bad-image', body: withImage('payload', src) }),
      ],
      revisions: [
        revision({
          id: 'bad-rev',
          itemId: 'bad-image',
          body: withImage('old payload', src),
        }),
      ],
    })

    await restoreBackup(file)

    const stored = JSON.stringify({
      items: await db.items.toArray(),
      revisions: await db.revisions.toArray(),
    })
    expect(stored).not.toContain(src)
    expect(await items.get('safe')).toMatchObject({ id: 'safe' })
    expect(JSON.stringify((await items.get('bad-image'))?.body)).not.toContain('"image"')
    expect((await items.get('bad-image'))?.body).toEqual(filterBodyImages(withImage('payload', src)))
  })

  it('does not persist a data URI allowedImageSrc rejects, even via the images table', async () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
    expect(allowedImageSrc(svg)).toBe(false)

    const file = JSON.stringify({
      kind: BACKUP_KIND,
      version: BACKUP_VERSION,
      exportedAt: AT,
      preferences: {},
      images: { svg },
      items: [item({ id: 'svg', body: withImage('no', `nib-image:svg`) })],
      revisions: [],
    })

    await restoreBackup(file)
    const stored = JSON.stringify(await db.items.toArray())
    expect(stored).not.toContain(svg)
    expect(stored).not.toContain('nib-image:')
    expect((await items.get('svg'))?.body).toEqual(filterBodyImages(withImage('no', svg)))
  })

  it('leaves the database alone when the file is not a backup', async () => {
    const id = await items.create('note', para('untouched'))
    await expect(restoreBackup('not json')).rejects.toBeInstanceOf(BackupError)
    await expect(restoreBackup('{}')).rejects.toBeInstanceOf(BackupError)
    expect((await items.get(id))?.body).toEqual(para('untouched'))
  })

  // Taken, a time past what a number holds came back as null in every later
  // backup, which then wouldn't restore.
  it('refuses a time that isn’t finite', async () => {
    const backup = JSON.parse(serializeBackup(buildBackup([item({ id: 'far' })], [], {}, AT)))
    const text = JSON.stringify(backup).replace(/"updatedAt":\d+/, '"updatedAt":1e400')
    await expect(restoreBackup(text)).rejects.toBeInstanceOf(BackupError)
    // Finite, but past what a Date holds: shown, it threw on every launch.
    await expect(restoreBackup(JSON.stringify(backup).replace(/"updatedAt":\d+/, '"updatedAt":-1e16'))).rejects.toBeInstanceOf(BackupError)
  })
})

describe('parseBackup', () => {
  it('runs filterBodyImages before returning items, so a write cannot skip the gate', () => {
    const src = 'https://evil.test/skip.png'
    const hostile = withImage('no', src)
    const backup = parseBackup(
      JSON.stringify({
        kind: BACKUP_KIND,
        version: BACKUP_VERSION,
        exportedAt: AT,
        preferences: {},
        images: {},
        items: [item({ id: 'x', body: hostile })],
        revisions: [],
      }),
    )
    expect(backup.items[0].body).toEqual(filterBodyImages(hostile))
    expect(JSON.stringify(backup.items)).not.toContain(src)
    expect(allowedImageSrc(src)).toBe(false)
  })
})

describe('sketches', () => {
  const sketch = (drawing: string): JSONContent => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: PNG, alt: 'Sketch', drawing } }] }],
  })
  const drawingIn = (body: JSONContent | undefined) => body?.content?.[0].content?.[0].attrs?.drawing

  it('keep their drawing through a backup and a restore, in the document and in its history', async () => {
    const file = serializeBackup(
      await buildBackup(
        [item({ id: 'sketched', body: sketch('QUJD') })],
        [revision({ id: 'r1', itemId: 'sketched', body: sketch('REVG') })],
        {},
        AT,
      ),
    )
    await restoreBackup(file)
    expect(drawingIn((await items.get('sketched'))?.body)).toBe('QUJD')
    expect(drawingIn((await db.revisions.get('r1'))?.body)).toBe('REVG')
  })

  it('lose a drawing that fails the check on the way in, and keep the picture', async () => {
    const file = serializeBackup(await buildBackup([item({ id: 'sketched', body: sketch('QUJD') })], [], {}, AT))
    await restoreBackup(file.replace('QUJD', '<svg onload=alert(1)>'))
    const body = (await items.get('sketched'))?.body
    expect(body?.content?.[0].content?.[0].attrs?.src).toBe(PNG)
    expect(drawingIn(body)).toBeNull()
  })
})
