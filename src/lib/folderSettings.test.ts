// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type Item } from '../db/db'
import { arrange, asFolderSettings, FOLDERS_CHANGED, mergeFolderSettings, readFolderSettings, replaceFolderSettings, setOwn, takeInFolderSettings } from './folderSettings'
import { libraryOf, lookOf, removeFolder, renameFolder, treeOf } from './folders'

const doc = (id: string, folder: string): Item => ({ id, kind: 'note', body: { type: 'doc', content: [] }, version: 1, createdAt: 1, updatedAt: 1, folder, rev: 1 })
/** The folders as they're laid out: each at the top, then those inside it, by whole name. */
const laidOut = (items: Item[]) => treeOf(libraryOf(items, undefined, readFolderSettings())).flatMap(({ folder, inside }) => [folder.name, ...inside.map((one) => one.name)])

beforeEach(async () => {
  replaceFolderSettings({})
  await db.items.clear()
})

describe('asFolderSettings', () => {
  it('keeps each folder once, whatever the case of its name, the one changed last, in one order', () => {
    expect(asFolderSettings({ Novel: { at: 1, place: 2 }, novel: { at: 5, place: 1 }, Blog: { at: 3 } })).toEqual({ blog: { at: 3 }, novel: { at: 5, place: 1 } })
    expect(Object.keys(asFolderSettings({ b: { at: 1 }, a: { at: 1 } })!)).toEqual(['a', 'b'])
  })

  it('passes over what isn’t one, and says nothing for what isn’t an object', () => {
    for (const raw of [null, [], 'x', 7]) expect(asFolderSettings(raw)).toBeUndefined()
    expect(asFolderSettings({ '': { at: 1 }, '  ': { at: 1 }, a: { at: -1 }, b: { place: 1 }, c: 'x', d: { at: 1, place: 'first' }, ['e'.repeat(201)]: { at: 1 } })).toEqual({ d: { at: 1 } })
  })

  it('keeps a colour and an icon by any name a Nib might give, and passes over the rest', () => {
    expect(asFolderSettings({ a: { at: 1, color: 'teal', icon: 'book-open' }, b: { at: 1, color: 'Teal!', icon: 7 }, c: { at: 1, icon: 'x'.repeat(41) } })).toEqual({ a: { at: 1, color: 'teal', icon: 'book-open' }, b: { at: 1 }, c: { at: 1 } })
  })

  it('keeps nothing but `gone` for one gone', () => {
    expect(asFolderSettings({ a: { at: 1, place: 3, gone: true } })).toEqual({ a: { at: 1, gone: true } })
  })

  it('lets the gone go first past the most it keeps, oldest first', () => {
    const many = Object.fromEntries(Array.from({ length: 2001 }, (_, n) => [`f${n}`, n === 0 ? { at: 9 } : { at: n, gone: true }]))
    const kept = asFolderSettings(many)!
    expect(Object.keys(kept)).toHaveLength(2000)
    expect(kept.f0).toEqual({ at: 9 })
    expect(kept.f1).toBeUndefined()
    expect(kept.f2000).toEqual({ at: 2000, gone: true })
  })
})

describe('two devices’', () => {
  it('are merged folder by folder, the one changed last kept, the same on both', () => {
    const iphone = { novel: { at: 5, place: 1 }, blog: { at: 2, place: 2 } }
    const mac = { novel: { at: 3, place: 2 }, blog: { at: 4, place: 1 }, poems: { at: 1 } }
    const both = { blog: { at: 4, place: 1 }, novel: { at: 5, place: 1 }, poems: { at: 1 } }
    expect(mergeFolderSettings(iphone, mac)).toEqual(both)
    expect(mergeFolderSettings(mac, iphone)).toEqual(both)
    // Changed at the same moment: still the same one on both.
    expect(mergeFolderSettings({ a: { at: 1, place: 1 } }, { a: { at: 1, place: 2 } })).toEqual(mergeFolderSettings({ a: { at: 1, place: 2 } }, { a: { at: 1, place: 1 } }))
  })

  it('takes another device’s in without saying so for sync, which has them already', () => {
    const said = vi.fn()
    window.addEventListener(FOLDERS_CHANGED, said)
    takeInFolderSettings({ novel: { at: 5, place: 1 } })
    window.removeEventListener(FOLDERS_CHANGED, said)
    expect(readFolderSettings()).toEqual({ novel: { at: 5, place: 1 } })
    expect(said).not.toHaveBeenCalled()
  })
})

describe('an order of one’s own', () => {
  const items = [doc('a', 'Poems'), doc('b', 'Novel'), doc('c', 'Novel/Part 2'), doc('d', 'Novel/Part 10'), doc('e', 'Blog'), doc('f', 'Novel/Notes')]

  it('is A to Z, with Part 2 before Part 10, till it’s given', () => {
    expect(laidOut(items)).toEqual(['Blog', 'Novel', 'Novel/Notes', 'Novel/Part 2', 'Novel/Part 10', 'Poems'])
  })

  it('lays the folders out in it, those inside one among themselves, and kept here and said for sync', () => {
    const said = vi.fn()
    window.addEventListener(FOLDERS_CHANGED, said)
    arrange(['Poems', 'Novel', 'Blog'])
    arrange(['Novel/Part 10', 'Novel/Part 2', 'Novel/Notes'])
    window.removeEventListener(FOLDERS_CHANGED, said)
    expect(laidOut(items)).toEqual(['Poems', 'Novel', 'Novel/Part 10', 'Novel/Part 2', 'Novel/Notes', 'Blog'])
    expect(said).toHaveBeenCalledTimes(2)
    expect(JSON.parse(localStorage.getItem('nib-folder-settings')!)).toEqual(readFolderSettings())
  })

  it('puts a folder given no place after those that have one, A to Z', () => {
    arrange(['Poems', 'Novel'])
    expect(laidOut([...items, doc('g', 'Letters')]).filter((name) => !name.includes('/'))).toEqual(['Poems', 'Novel', 'Blog', 'Letters'])
  })
})

describe('a folder’s colour and icon', () => {
  const items = [doc('a', 'Novel'), doc('b', 'Novel/Part 1'), doc('c', 'Novel/Part 2'), doc('d', 'Blog')]
  const looks = () => Object.fromEntries(libraryOf(items, undefined, readFolderSettings()).folders.map((folder) => [folder.name, lookOf(libraryOf(items, undefined, readFolderSettings()), folder.name)]))

  it('are none till set, then each kept by itself, with its place, and said for sync', () => {
    expect(looks()).toEqual({ Blog: {}, Novel: {}, 'Novel/Part 1': {}, 'Novel/Part 2': {} })
    arrange(['Novel', 'Blog'])
    const said = vi.fn()
    window.addEventListener(FOLDERS_CHANGED, said)
    setOwn('Novel', { color: 'teal' })
    setOwn('novel', { icon: 'book' })
    window.removeEventListener(FOLDERS_CHANGED, said)
    expect(said).toHaveBeenCalledTimes(2)
    expect(readFolderSettings().novel).toEqual({ at: expect.any(Number), place: 1, color: 'teal', icon: 'book' })
    setOwn('Novel', { color: null })
    expect(readFolderSettings().novel).toEqual({ at: expect.any(Number), place: 1, icon: 'book' })
  })

  it('go to the folders inside one, each taken from it till they’re given their own', () => {
    setOwn('Novel', { color: 'teal', icon: 'book' })
    setOwn('Novel/Part 2', { icon: 'sword' })
    expect(looks()).toMatchObject({ Novel: { color: 'teal', icon: 'book' }, 'Novel/Part 1': { color: 'teal', icon: 'book' }, 'Novel/Part 2': { color: 'teal', icon: 'sword' }, Blog: {} })
  })

  it('and its sort, the same way: its own, or the one it’s in, kept for a later Nib if unknown', () => {
    setOwn('Novel', { sort: 'title' })
    setOwn('Blog', { sort: 'by-mood' })
    const sorts = Object.fromEntries(libraryOf(items, undefined, readFolderSettings()).folders.map((folder) => [folder.name, folder.sort]))
    expect(sorts).toEqual({ Blog: undefined, Novel: 'title', 'Novel/Part 1': 'title', 'Novel/Part 2': 'title' })
    expect(readFolderSettings().blog.sort).toBe('by-mood')
    setOwn('Novel/Part 2', { sort: 'created' })
    setOwn('Novel', { sort: null })
    expect(libraryOf(items, undefined, readFolderSettings()).folders.map((folder) => folder.sort)).toEqual([undefined, undefined, undefined, 'created'])
  })

  it('and its template, by the template’s id, the same way', () => {
    const id = crypto.randomUUID()
    expect(asFolderSettings({ a: { at: 1, template: id }, b: { at: 1, template: 'not an id!' } })).toEqual({ a: { at: 1, template: id }, b: { at: 1 } })
    setOwn('Novel', { template: id })
    setOwn('Novel/Part 2', { template: 'other' })
    expect(libraryOf(items, undefined, readFolderSettings()).folders.map((folder) => [folder.name, folder.template])).toEqual([
      ['Blog', undefined],
      ['Novel', id],
      ['Novel/Part 1', id],
      ['Novel/Part 2', 'other'],
    ])
  })

  it('and its book’s title and author, a line of words each, emptied to none', () => {
    expect(asFolderSettings({ a: { at: 1, title: '  The   Long Season ', author: 'Ann Writer' }, b: { at: 1, title: 'x'.repeat(201), author: 7 } })).toEqual({
      a: { at: 1, title: 'The Long Season', author: 'Ann Writer' },
      b: { at: 1 },
    })
    setOwn('Novel', { title: ' The Long\nSeason ', author: 'Ann' })
    expect(readFolderSettings().novel).toMatchObject({ title: 'The Long Season', author: 'Ann' })
    setOwn('Novel', { title: '   ' })
    expect(readFolderSettings().novel.title).toBeUndefined()
  })

  it('and its book’s word goal, checked as a document’s is: its date kept only if there is such a day', () => {
    expect(asFolderSettings({ a: { at: 1, goal: { words: 85000, deadline: '2027-03-01' } }, b: { at: 1, goal: { words: 500, deadline: '2027-02-30' } }, c: { at: 1, goal: { words: 0 } }, d: { at: 1, goal: 85000 } })).toEqual({
      a: { at: 1, goal: { words: 85000, deadline: '2027-03-01' } },
      b: { at: 1, goal: { words: 500 } },
      c: { at: 1 },
      d: { at: 1 },
    })
    setOwn('Novel', { goal: { words: 85000 }, title: 'The Long Season' })
    expect(readFolderSettings().novel).toMatchObject({ goal: { words: 85000 }, title: 'The Long Season' })
    setOwn('Novel', { goal: null })
    expect(readFolderSettings().novel).not.toHaveProperty('goal')
    expect(readFolderSettings().novel.title).toBe('The Long Season')
  })

  it('show as none when they’re a later Nib’s, kept for it all the same', () => {
    replaceFolderSettings({ blog: { at: 1, color: 'gold', icon: 'typewriter' } })
    expect(looks().Blog).toEqual({})
    expect(readFolderSettings().blog).toEqual({ at: 1, color: 'gold', icon: 'typewriter' })
  })

  it('go with the folder when it’s renamed, and to the folders inside it', async () => {
    await db.items.bulkAdd(items)
    setOwn('Novel', { color: 'teal', icon: 'book' })
    await renameFolder('Novel', 'Book')
    const library = libraryOf(await db.items.toArray(), undefined, readFolderSettings())
    expect(lookOf(library, 'Book')).toEqual({ color: 'teal', icon: 'book' })
    expect(lookOf(library, 'Book/Part 1')).toEqual({ color: 'teal', icon: 'book' })
  })
})

describe('a folder renamed, moved or removed', () => {
  const add = (...items: Item[]) => db.items.bulkAdd(items)

  it('keeps its place under its new name, and leaves its old name gone', async () => {
    await add(doc('a', 'Novel'), doc('b', 'Blog'), doc('c', 'Poems'))
    arrange(['Poems', 'Novel', 'Blog'])
    await renameFolder('Novel', 'Book')
    expect(laidOut(await db.items.toArray())).toEqual(['Poems', 'Book', 'Blog'])
    expect(readFolderSettings().novel).toEqual({ at: expect.any(Number), gone: true })
  })

  it('takes those inside it along, each keeping its place among them', async () => {
    await add(doc('a', 'Novel/Part 1'), doc('b', 'Novel/Part 2'))
    arrange(['Novel/Part 2', 'Novel/Part 1'])
    await renameFolder('Novel', 'Book')
    expect(laidOut(await db.items.toArray())).toEqual(['Book', 'Book/Part 2', 'Book/Part 1'])
  })

  it('goes to the end among the folders it’s moved in with', async () => {
    await add(doc('a', 'Novel/Part 1'), doc('b', 'Novel/Part 2'), doc('c', 'Blog'), doc('d', 'Poems'))
    arrange(['Novel/Part 2', 'Novel/Part 1'])
    arrange(['Poems', 'Novel', 'Blog'])
    await renameFolder('Novel/Part 2', 'Part 2')
    // Out at the top, it has no place there: after those that do.
    expect(laidOut(await db.items.toArray())).toEqual(['Poems', 'Novel', 'Novel/Part 1', 'Blog', 'Part 2'])
  })

  it('merged into one already there, leaves that one as it was', async () => {
    await add(doc('a', 'Novel'), doc('b', 'Blog'), doc('c', 'Poems'))
    arrange(['Poems', 'Novel', 'Blog'])
    await renameFolder('Poems', 'Blog')
    expect(laidOut(await db.items.toArray())).toEqual(['Novel', 'Blog'])
    expect(readFolderSettings().blog).toMatchObject({ place: 3 })
  })

  it('removed, leaves its name gone, and those inside it at the top with no place', async () => {
    await add(doc('a', 'Novel/Part 1'), doc('b', 'Blog'))
    arrange(['Novel', 'Blog'])
    arrange(['Novel/Part 1'])
    await removeFolder('Novel')
    expect(readFolderSettings()).toEqual({ blog: { at: expect.any(Number), place: 2 }, novel: { at: expect.any(Number), gone: true }, 'novel/part 1': { at: expect.any(Number), gone: true }, 'part 1': { at: expect.any(Number) } })
    // Made again, it's a new folder: at the end.
    expect(laidOut([...(await db.items.toArray()), doc('c', 'Novel')])).toEqual(['Blog', 'Novel', 'Part 1'])
  })

  it('writes nothing for folders never given a place', async () => {
    await add(doc('a', 'Novel'))
    const said = vi.fn()
    window.addEventListener(FOLDERS_CHANGED, said)
    await renameFolder('Novel', 'Book')
    window.removeEventListener(FOLDERS_CHANGED, said)
    expect(readFolderSettings()).toEqual({})
    expect(said).not.toHaveBeenCalled()
  })
})
