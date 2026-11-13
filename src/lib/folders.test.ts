// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type Category, type Item } from '../db/db'
import * as items from '../db/items'
import {
  asCategories,
  asFolder,
  canMake,
  filing,
  filingHidden,
  filingOf,
  inPlace,
  libraryOf,
  makeCategory,
  makeFolder,
  MAX_CATEGORIES,
  MAX_NAME,
  recolorCategory,
  removeCategory,
  removeFolder,
  renameCategory,
  renameFolder,
  cantRename,
  moved,
  movedInto,
  movesFor,
  saidAs,
  split,
  stillThere,
  treeOf,
  under,
  within,
} from './folders'

// Whether the vault is open, for a locked note's filing; shut, as at launch, unless a test opens it.
const vault = vi.hoisted(() => ({ open: false }))
vi.mock('./vault', async (original) => ({ ...(await original<typeof import('./vault')>()), vaultOpen: () => vault.open }))

const doc = (id: string, fields: Partial<Item> = {}): Item => ({
  id,
  kind: 'note',
  body: { type: 'doc', content: [] },
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  ...fields,
})
const draft: Category = { name: 'Draft', color: 'blue' }
const empty = libraryOf([])

describe('asFolder', () => {
  it('takes a name, trimmed, and null as taken out of its folder', () => {
    expect(asFolder('  Novel ')).toBe('Novel')
    expect(asFolder(null)).toBeNull()
  })

  it('says nothing for what no Nib writes, rather than taking it as taken out', () => {
    for (const raw of [undefined, '', '   ', 7, {}, [], 'x'.repeat(MAX_NAME + 1)]) expect(asFolder(raw), String(raw)).toBeUndefined()
  })
})

// "Lawyer" and "Custody" on a locked note's card said what its sealed text was about.
describe('a locked note’s folder and categories', () => {
  const locked = doc('l', { folder: 'Lawyer', categories: [{ name: 'Custody', color: 'red' }], vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) } })
  const open = doc('o', { folder: 'Novel', categories: [{ name: 'Draft', color: 'blue' }] })
  afterEach(() => {
    vault.open = false
  })

  it('are out of sight while the vault is shut: it shows under All alone', () => {
    expect(filingHidden(locked)).toBe(true)
    expect(filingOf(locked)).toEqual({})
    expect(inPlace(locked, { folder: 'Lawyer' })).toBe(false)
    expect(inPlace(locked, { category: 'Custody' })).toBe(false)
    expect(inPlace(locked, null)).toBe(true)
    const library = libraryOf([locked, open])
    expect(library.folders).toEqual([{ name: 'Novel', count: 1 }])
    expect(library.categories).toEqual([{ name: 'Draft', color: 'blue', count: 1 }])
    expect([filingHidden(open), filingOf(open).folder]).toEqual([false, 'Novel'])
  })

  it('show again once the vault is open', () => {
    vault.open = true
    expect(filingOf(locked)).toMatchObject({ folder: 'Lawyer', categories: [{ name: 'Custody', color: 'red' }] })
    expect(inPlace(locked, { folder: 'Lawyer' })).toBe(true)
    expect(libraryOf([locked, open]).folders.map((folder) => folder.name)).toEqual(['Lawyer', 'Novel'])
  })
})

describe('asCategories', () => {
  it('keeps each well-formed category once, by name whatever its case', () => {
    expect(
      asCategories([
        { name: ' Draft ', color: 'blue' },
        { name: 'draft', color: 'red' },
        { name: 'Research', color: 'graphite' },
      ]),
    ).toEqual([
      { name: 'Draft', color: 'blue' },
      { name: 'Research', color: 'graphite' },
    ])
  })

  it('drops a category with no name, too long a name, or a colour Nib doesn’t have', () => {
    expect(
      asCategories([
        { name: '', color: 'blue' },
        { name: 'x'.repeat(MAX_NAME + 1), color: 'blue' },
        { name: 'Odd', color: 'toString' },
        { name: 'Odd', color: '#ff0000' },
        null,
        'Draft',
        { name: 'Kept', color: 'teal' },
      ]),
    ).toEqual([{ name: 'Kept', color: 'teal' }])
  })

  // A doctored backup, or a device with the sync code, could send one document
  // tens of thousands; checking each against the rest froze the app for minutes.
  it('keeps no more than MAX_CATEGORIES, and checks a long list at once', () => {
    const many = Array.from({ length: 50_000 }, (_, i) => ({ name: `Category ${i}`, color: 'blue' }))
    const started = performance.now()
    const kept = asCategories([{ name: 'Draft', color: 'blue' }, { name: 'DRAFT', color: 'red' }, ...many])!
    expect(performance.now() - started).toBeLessThan(2000)
    expect(kept).toHaveLength(MAX_CATEGORIES)
    expect(kept.slice(0, 2)).toEqual([
      { name: 'Draft', color: 'blue' },
      { name: 'Category 0', color: 'blue' },
    ])
  })

  it('takes an empty list as none, and anything but a list as saying nothing', () => {
    expect(asCategories([])).toEqual([])
    for (const raw of [undefined, null, 'Draft', { name: 'Draft', color: 'blue' }]) expect(asCategories(raw)).toBeUndefined()
  })
})

describe('the library', () => {
  it('counts each folder and category once, whatever its case, A to Z', () => {
    const library = libraryOf([
      doc('a', { folder: 'Novel', categories: [draft] }),
      doc('b', { folder: 'novel', kind: 'page' }),
      doc('c', { folder: 'Blog', categories: [{ name: 'draft', color: 'red' }, { name: 'Research', color: 'teal' }], updatedAt: 5 }),
      doc('d'),
    ])
    expect(library.folders).toEqual([
      { name: 'Blog', count: 1 },
      { name: 'Novel', count: 2 },
    ])
    // Coloured as on the document saved last.
    expect(library.categories).toEqual([
      { name: 'draft', color: 'red', count: 2 },
      { name: 'Research', color: 'teal', count: 1 },
    ])
  })

  it('shows a folder or category, by any case, and files a new document there', () => {
    const filed = doc('a', { folder: 'Novel', categories: [draft] })
    const library = libraryOf([filed])
    expect(inPlace(filed, null)).toBe(true)
    expect(inPlace(filed, { folder: 'novel' })).toBe(true)
    expect(inPlace(filed, { category: 'DRAFT' })).toBe(true)
    expect(inPlace(doc('b'), { folder: 'Novel' })).toBe(false)
    expect(filing({ folder: 'Novel' }, library)).toEqual({ folder: 'Novel' })
    expect(filing({ category: 'draft' }, library)).toEqual({ categories: [draft] })
    expect(filing(null, library)).toEqual({})
    expect(stillThere({ folder: 'Gone' }, library)).toBe(false)
    expect(stillThere({ category: 'Draft' }, library)).toBe(true)
    expect(stillThere({ archive: true }, library)).toBe(true)
    expect(filing({ archive: true }, library)).toEqual({})
  })

  // lib/startAt's folder for what's written next.
  it('files a new document in the folder chosen for it, when the library is showing none', () => {
    const library = libraryOf([doc('a', { folder: 'Novel' }), doc('b', { folder: 'Letters', categories: [draft] })])
    // Under the name the folder has, whatever case it was chosen in.
    expect(filing(null, library, 'novel')).toEqual({ folder: 'Novel' })
    expect(filing({ archive: true }, library, 'Novel')).toEqual({ folder: 'Novel' })
    // A category showing still gives the document that category, and the folder with it.
    expect(filing({ category: 'draft' }, library, 'Novel')).toEqual({ folder: 'Novel', categories: [draft] })
    // A folder showing is where it goes, as it always was.
    expect(filing({ folder: 'Letters' }, library, 'Novel')).toEqual({ folder: 'Letters' })
    // One that has gone counts for nothing, and none was asked for by default.
    expect(filing(null, library, 'Gone')).toEqual({})
    expect(filing({ category: 'draft' }, library, 'Gone')).toEqual({ categories: [draft] })
    expect(filing(null, library, null)).toEqual({})
  })
})

describe('made here', () => {
  afterEach(async () => {
    await removeFolder('Letters')
    await removeCategory('Someday')
  })

  it('keeps a new folder or category, empty or not, till it’s removed here', async () => {
    expect(makeFolder('  Letters ', empty)).toBe(true)
    expect(makeCategory('Someday', 'pink', empty)).toBe(true)
    const made = () => JSON.parse(localStorage.getItem('nib-folders')!)
    expect(libraryOf([], made()).folders).toEqual([{ name: 'Letters', count: 0 }])
    expect(libraryOf([], made()).categories).toEqual([{ name: 'Someday', color: 'pink', count: 0 }])
    expect(libraryOf([doc('a', { folder: 'Letters' })], made()).folders).toEqual([{ name: 'Letters', count: 1 }])

    await removeFolder('Letters')
    await removeCategory('Someday')
    expect(made()).toEqual({ folders: [], categories: [] })
  })

  it('won’t make one with no name, or one already there by any case', () => {
    const library = libraryOf([doc('a', { folder: 'Novel', categories: [draft] })])
    expect(makeFolder('   ', library)).toBe(false)
    expect(makeFolder('NOVEL', library)).toBe(false)
    expect(makeCategory('draft', 'teal', library)).toBe(false)
    expect(makeFolder('x'.repeat(MAX_NAME + 1), library)).toBe(false)
  })
})

describe('renamed, recoloured and removed', () => {
  beforeEach(async () => {
    await db.items.clear()
    await db.items.bulkAdd([
      doc('in', { folder: 'Novel', categories: [draft, { name: 'Research', color: 'teal' }], rev: 1 }),
      doc('trashed', { folder: 'Novel', categories: [draft], deletedAt: 9, rev: 1 }),
      doc('out', { folder: 'Blog', categories: [{ name: 'Final', color: 'green' }], rev: 1 }),
    ])
  })
  const get = async (id: string) => (await items.get(id))!

  it('renames a folder on everything in it, the trash too, and only that', async () => {
    await renameFolder('novel', 'Book')
    expect((await get('in')).folder).toBe('Book')
    expect((await get('trashed')).folder).toBe('Book')
    expect(await get('out')).toMatchObject({ folder: 'Blog', rev: 1 })
    // Sent by sync, not taken for an edit.
    expect(await get('in')).toMatchObject({ rev: 2, version: 1, updatedAt: 1 })
  })

  it('removes a folder, keeping what was in it', async () => {
    await removeFolder('Novel')
    expect((await get('in')).folder).toBeNull()
    expect((await get('out')).folder).toBe('Blog')
  })

  it('renames, recolours and removes a category, merging into one already there', async () => {
    await recolorCategory('draft', 'orange')
    expect((await get('in')).categories).toEqual([{ name: 'Draft', color: 'orange' }, { name: 'Research', color: 'teal' }])
    await renameCategory('Draft', 'research')
    expect((await get('in')).categories).toEqual([{ name: 'research', color: 'orange' }])
    expect((await get('trashed')).categories).toEqual([{ name: 'research', color: 'orange' }])
    await removeCategory('Research')
    expect((await get('in')).categories).toEqual([])
    expect((await get('out')).categories).toEqual([{ name: 'Final', color: 'green' }])
  })
})

describe('the free limit', () => {
  it('makes three folders and three categories without Plus, any number with it', () => {
    const three = libraryOf(['A', 'B', 'C'].map((name) => doc(name, { folder: name, categories: [{ name, color: 'blue' }] })))
    expect(canMake('folder', three, false)).toBe(false)
    expect(canMake('category', three, false)).toBe(false)
    expect(canMake('folder', three, true)).toBe(true)
    expect(canMake('category', three, true)).toBe(true)
    const two = libraryOf(['A', 'B'].map((name) => doc(name, { folder: name })))
    expect(canMake('folder', two, false)).toBe(true)
    expect(canMake('category', two, false)).toBe(true)
  })
})

describe('a folder inside another', () => {
  it('is both names with a slash between, one level and no more', () => {
    expect(within('Novel', 'Part 1')).toBe('Novel/Part 1')
    expect(split('Novel/Part 1')).toEqual({ parent: 'Novel', name: 'Part 1' })
    expect(split('Novel')).toEqual({ parent: null, name: 'Novel' })
    // Spaces round the slash are no part of either name; a second slash is part of its own.
    expect(split('Novel / Part 1')).toEqual({ parent: 'Novel', name: 'Part 1' })
    expect(split('Novel/Part 1/Draft')).toEqual({ parent: 'Novel', name: 'Part 1/Draft' })
    // A slash with nothing on one side of it is only part of a name.
    expect(split('/Notes')).toEqual({ parent: null, name: '/Notes' })
    expect(split('Either/')).toEqual({ parent: null, name: 'Either/' })
    expect(saidAs('Novel/Part 1')).toBe('Novel › Part 1')
    expect(saidAs('Novel')).toBe('Novel')
  })

  it('shows with the folder it’s in, and alone when it’s the one chosen', () => {
    expect(under('Novel/Part 1', 'novel')).toBe(true)
    expect(under('Novel', 'Novel')).toBe(true)
    expect(under('Novel', 'Novel/Part 1')).toBe(false)
    expect(under('Novel Ideas', 'Novel')).toBe(false)
    const own = doc('a', { folder: 'Novel' })
    const part = doc('b', { folder: 'Novel/Part 1' })
    expect([own, part].map((item) => inPlace(item, { folder: 'Novel' }))).toEqual([true, true])
    expect([own, part].map((item) => inPlace(item, { folder: 'Novel/Part 1' }))).toEqual([false, true])
  })

  it('counts in the folder it’s in, which is there for it with nothing of its own', () => {
    const library = libraryOf([doc('a', { folder: 'Novel/Part 1' }), doc('b', { folder: 'novel/Part 1' }), doc('c', { folder: 'Novel/Part 2' }), doc('d', { folder: 'Blog' })])
    expect(library.folders).toEqual([
      { name: 'Blog', count: 1 },
      { name: 'Novel', count: 3 },
      { name: 'Novel/Part 1', count: 2 },
      { name: 'Novel/Part 2', count: 1 },
    ])
    expect(stillThere({ folder: 'Novel' }, library)).toBe(true)
    expect(filing({ folder: 'Novel/Part 2' }, library)).toEqual({ folder: 'Novel/Part 2' })
  })

  it('is laid out under its folder, by its own name, whatever sorts between them', () => {
    // "Novel Ideas" sorts between "Novel" and "Novel/Part 1" in one list.
    const library = libraryOf([doc('a', { folder: 'Novel/Part 2' }), doc('b', { folder: 'Novel Ideas' }), doc('c', { folder: 'Novel/Part 1' }), doc('d', { folder: 'Novel' })])
    expect(treeOf(library).map(({ folder, inside }) => [folder.name, folder.count, inside.map((one) => one.name)])).toEqual([
      ['Novel', 3, ['Novel/Part 1', 'Novel/Part 2']],
      ['Novel Ideas', 1, []],
    ])
  })

  it('is one of the three free folders, like any other, and so is the folder it’s in', () => {
    const two = libraryOf([doc('a', { folder: 'Novel/Part 1' })])
    expect(two.folders).toHaveLength(2)
    expect(canMake('folder', two, false)).toBe(true)
    const three = libraryOf([doc('a', { folder: 'Novel/Part 1' }), doc('b', { folder: 'Novel/Part 2' })])
    expect(canMake('folder', three, false)).toBe(false)
    expect(canMake('folder', three, true)).toBe(true)
  })

  it('is kept under a name no longer than any folder’s, both names together', () => {
    expect(asFolder('Novel/Part 1')).toBe('Novel/Part 1')
    expect(asFolder(`${'a'.repeat(MAX_NAME - 1)}/b`)).toBeUndefined()
  })

  it('is laid out by its own name with numbers as numbers', () => {
    const library = libraryOf(['Novel/Part 10', 'Novel/Part 2', 'Novel/Part 1'].map((folder) => doc(folder, { folder })))
    expect(treeOf(library)[0].inside.map((one) => one.name)).toEqual(['Novel/Part 1', 'Novel/Part 2', 'Novel/Part 10'])
  })

  describe('made, renamed and removed', () => {
    beforeEach(async () => {
      await db.items.clear()
      await db.items.bulkAdd([
        doc('own', { folder: 'Novel', rev: 1 }),
        doc('one', { folder: 'Novel/Part 1', rev: 1 }),
        doc('two', { folder: 'novel/Part 2', rev: 1 }),
        doc('out', { folder: 'Blog', rev: 1 }),
      ])
    })
    afterEach(async () => {
      for (const name of ['Novel/Drafts', 'Book/Drafts', 'Drafts', 'Novel', 'Book']) await removeFolder(name)
    })
    const folders = async () => Object.fromEntries((await items.listAll()).map((item) => [item.id, item.folder]))

    it('is made empty inside a folder, and stays till it’s removed here', () => {
      const library = libraryOf([doc('a', { folder: 'Novel' })])
      expect(makeFolder(within('Novel', 'Drafts'), library)).toBe(true)
      // Not twice, by any case.
      expect(makeFolder('novel/drafts', libraryOf([doc('a', { folder: 'Novel' })], { folders: ['Novel/Drafts'], categories: [] }))).toBe(false)
      // And its folder is there for it, even one nothing else is in.
      expect(libraryOf([], { folders: ['Novel/Drafts'], categories: [] }).folders).toEqual([
        { name: 'Novel', count: 0 },
        { name: 'Novel/Drafts', count: 0 },
      ])
    })

    it('is no longer made here once removed, and leaves the folder it was in no more made than it was', async () => {
      const madeHere = () => (JSON.parse(localStorage.getItem('nib-folders') ?? '{"folders":[]}') as { folders: string[] }).folders
      makeFolder('Shelf/Drafts', libraryOf([]))
      expect(madeHere()).toContain('Shelf/Drafts')
      await removeFolder('Shelf/Drafts')
      expect(madeHere().filter((name) => name.startsWith('Shelf'))).toEqual([])
      // And one made inside a folder that's removed moves up, still made here.
      makeFolder('Shelf/Drafts', libraryOf([]))
      await removeFolder('Shelf')
      expect(madeHere().filter((name) => name === 'Drafts' || name.startsWith('Shelf'))).toEqual(['Drafts'])
    })

    it('goes with its folder when that’s renamed, and is renamed alone by its own name', async () => {
      await renameFolder('Novel', 'Book')
      expect(await folders()).toEqual({ own: 'Book', one: 'Book/Part 1', two: 'Book/Part 2', out: 'Blog' })
      await renameFolder('Book/Part 1', 'Book/Opening')
      expect(await folders()).toEqual({ own: 'Book', one: 'Book/Opening', two: 'Book/Part 2', out: 'Blog' })
      expect(moved('Book/Part 2', 'Book', 'Novel')).toBe('Novel/Part 2')
      expect(moved('Blog', 'Book', 'Novel')).toBe('Blog')
    })

    it('moves up when its folder is removed, and leaves what’s in it in that folder when it is', async () => {
      await removeFolder('Novel/Part 1')
      expect(await folders()).toEqual({ own: 'Novel', one: 'Novel', two: 'novel/Part 2', out: 'Blog' })
      await removeFolder('Novel')
      expect(await folders()).toEqual({ own: null, one: null, two: 'Part 2', out: 'Blog' })
    })

    it('can be moved out to the top, or into another folder at the top; one with folders inside it, nowhere', () => {
      const library = libraryOf([doc('a', { folder: 'Novel/Part 1' }), doc('b', { folder: 'Blog' }), doc('c', { folder: 'Letters' })])
      expect(movesFor('Novel/Part 1', library)).toEqual([null, 'Blog', 'Letters'])
      expect(movesFor('Blog', library)).toEqual(['Letters', 'Novel'])
      expect(movesFor('Novel', library)).toEqual([])
      expect(movesFor('Only', libraryOf([doc('a', { folder: 'Only' })]))).toEqual([])
      expect(movedInto('Blog', 'Novel')).toBe('Novel/Blog')
      expect(movedInto('Novel/Part 1', null)).toBe('Part 1')
      expect(movedInto('Novel/Part 1', 'Blog')).toBe('Blog/Part 1')
    })

    it('says why a folder can’t take a name: too long with what’s inside it, or one that would put folders two deep', () => {
      const library = libraryOf([doc('a', { folder: 'Novel/Part 1' }), doc('b', { folder: 'Blog' })])
      expect(cantRename('Novel', 'Book', library)).toBeNull()
      expect(cantRename('Novel/Part 1', 'Novel/Opening', library)).toBeNull()
      expect(cantRename('Blog', 'Novel/Blog', library)).toBeNull()
      expect(cantRename('Novel', 'Blog/Novel', library)).toMatch(/can’t go inside another/)
      expect(cantRename('Novel', 'a'.repeat(MAX_NAME - 3), library)).toMatch(/too long for the folders inside it/)
      expect(cantRename('Blog', 'a'.repeat(MAX_NAME + 1), library)).toMatch(/too long/)
      expect(cantRename('Blog', '  ', library)).toMatch(/needs a name/)
    })
  })
})
