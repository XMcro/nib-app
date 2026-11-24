import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import * as items from '../db/items'

/** Backup to a folder (lib/backupFolder): the folder stood in for by one in memory, as NibFolder keeps one. */

const folder = vi.hoisted(() => {
  const files = new Map<string, string>()
  const state = { chosen: true as boolean, lost: false }
  const plugin = {
    folder: async () => (state.lost ? { lost: true } : state.chosen ? { name: 'Backups' } : {}),
    read: async ({ path }: { path: string }) => (files.has(path) ? { data: files.get(path) } : {}),
    write: async ({ files: given = [], remove = [] }: { files?: { path: string; data: string; fresh?: boolean }[]; remove?: string[] }) => {
      if (state.lost) throw Object.assign(new Error('That folder can’t be found.'), { code: 'lost' })
      const taken: string[] = []
      for (const file of given) {
        if (file.fresh && files.has(file.path)) taken.push(file.path)
        else files.set(file.path, file.data)
      }
      for (const path of remove) files.delete(path)
      return { taken }
    },
  }
  return { files, state, plugin }
})
vi.mock('@capacitor/core', async (actual) => ({
  ...(await actual<typeof import('@capacitor/core')>()),
  registerPlugin: (name: string) => (name === 'NibFolder' ? folder.plugin : {}),
}))
const stored = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value), removeItem: (key: string) => void stored.delete(key) })

const { backUp, backUpIfDue, lastBackup, setWhichFolders, BACKUP, LIST } = await import('./backupFolder')

const DAY = Date.UTC(2026, 10, 21, 12)
const page = (title: string, ...lines: string[]) => ({
  type: 'doc',
  content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }, ...lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }))],
})
const names = () => [...folder.files.keys()].sort()

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
  folder.files.clear()
  folder.state.chosen = true
  folder.state.lost = false
  stored.clear()
})

describe('the first backup', () => {
  it('writes each note and page under Notes or Pages and its folders, the backup beside them, and the list, leaving out what mustn’t go', async () => {
    await items.create('note', page('Ideas', 'A lighthouse.'))
    await items.create('page', page('Chapter 1', 'Ninety-one steps.'), { folder: 'The Lighthouse/Part One' })
    const locked = await items.create('note', page('Diary', 'Secret.'))
    await db.items.update(locked, { vault: { v: 1, iv: 'a', data: 'b' } as never })
    const mine = await items.create('note', page('Here only', 'Stays.'))
    await db.items.update(mine, { deviceOnly: true })
    const gone = await items.create('note', page('Binned', 'Old.'))
    await db.items.update(gone, { deletedAt: 1 })
    const template = await items.create('page', page('Template', 'Shape.'))
    await db.items.update(template, { template: true })

    await expect(backUp(DAY)).resolves.toMatchObject({ written: 2, removed: 0 })
    expect(names()).toEqual([BACKUP, LIST, 'Notes/Ideas.md', 'Pages/The Lighthouse/Part One/Chapter 1.md'])
    expect(folder.files.get('Notes/Ideas.md')).toContain('A lighthouse.')
    // The backup holds the locked one, sealed as it is, but not the one kept on this device.
    const backup = JSON.parse(folder.files.get(BACKUP)!)
    expect(backup.items.map((item: { id: string }) => item.id)).toContain(locked)
    expect(backup.items.map((item: { id: string }) => item.id)).not.toContain(mine)
  })
})

describe('a screenplay', () => {
  it('goes as its Fountain, named for its title page’s title', async () => {
    const body = { type: 'doc', content: ['Title: The Keeper', '', 'INT. LAMP ROOM - NIGHT', '', 'The lamp *turns*.'].map((text) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })) }
    await items.create('page', body, { screenplay: true, folder: 'Scripts' })
    await backUp(DAY)
    expect(names()).toContain('Pages/Scripts/The Keeper.fountain')
    expect(folder.files.get('Pages/Scripts/The Keeper.fountain')).toBe('Title: The Keeper\n\nINT. LAMP ROOM - NIGHT\n\nThe lamp \\*turns\\*.\n')
  })
})

describe('each day after', () => {
  it('writes again only what changed, moves one renamed, and takes away one gone', async () => {
    const ideas = await items.create('note', page('Ideas', 'A lighthouse.'))
    const chapter = await items.create('page', page('Chapter 1', 'Steps.'))
    const scrap = await items.create('note', page('Scrap', 'Nothing.'))
    await backUp(DAY)
    await expect(backUp(DAY + 1000)).resolves.toMatchObject({ written: 0, removed: 0 })

    await db.items.update(ideas, { body: page('Ideas', 'A lighthouse, and a keeper.') })
    await db.items.update(chapter, { body: page('The Steps', 'Steps.') })
    await db.items.update(scrap, { deletedAt: 1 })
    await expect(backUp(DAY + 2000)).resolves.toMatchObject({ written: 2, removed: 2 })
    expect(names()).toEqual([BACKUP, LIST, 'Notes/Ideas.md', 'Pages/The Steps.md'])
    expect(folder.files.get('Notes/Ideas.md')).toContain('and a keeper')
  })

  it('never writes over a file that isn’t Nib’s, nor takes one away', async () => {
    folder.files.set('Notes/Ideas.md', 'Someone else’s.')
    folder.files.set('Notes/Other app.md', 'Theirs too.')
    const ideas = await items.create('note', page('Ideas', 'Mine.'))
    await items.create('note', page('Kept', 'Stays.'))
    await backUp(DAY)
    expect(folder.files.get('Notes/Ideas.md')).toBe('Someone else’s.')
    expect(folder.files.get('Notes/Ideas 2.md')).toContain('Mine.')
    await db.items.update(ideas, { deletedAt: 1 })
    await backUp(DAY + 1000)
    expect(names()).toEqual([BACKUP, LIST, 'Notes/Ideas.md', 'Notes/Kept.md', 'Notes/Other app.md'])
  })
})

describe('the folders chosen', () => {
  it('are all that go, with those inside them, and with no backup file, which is only for the whole library', async () => {
    await items.create('page', page('Chapter 1', 'Steps.'), { folder: 'The Lighthouse/Part One' })
    await items.create('page', page('Recipe', 'Bread.'), { folder: 'Kitchen' })
    await items.create('note', page('Loose', 'Unfiled.'))
    await backUp(DAY)
    expect(names()).toContain(BACKUP)
    setWhichFolders(['The Lighthouse'])
    await backUp(DAY + 1000)
    expect(names()).toEqual([LIST, 'Pages/The Lighthouse/Part One/Chapter 1.md'])
    // None chosen is the writer's to say: nothing goes, and that's not a library in doubt.
    setWhichFolders([])
    await expect(backUp(DAY + 2000)).resolves.toMatchObject({ written: 0, removed: 1 })
    expect(names()).toEqual([LIST])
  })
})

describe('a folder with another library’s backup in it', () => {
  // As on a new phone after a lost one, or a second device that doesn't sync with the first: its own storage, its own library.
  const anotherDevice = async () => {
    stored.clear()
    await db.items.clear()
  }

  it('is left exactly as it is: the list there says which files are Nib’s, not whose Nib', async () => {
    await items.create('note', page('Ideas', 'A lighthouse.'))
    await items.create('page', page('Chapter 1', 'Steps.'))
    await backUp(DAY)
    const before = new Map(folder.files)
    await anotherDevice()
    await items.create('note', page('Ideas', 'A first note on the new phone.'))
    await expect(backUp(DAY + 1000)).resolves.toMatchObject({ failed: 'other' })
    expect(new Map(folder.files)).toEqual(before)
  })

  it('is this library’s after all when most of what it lists is here: the same library on another device, or restored', async () => {
    const ideas = await items.create('note', page('Ideas', 'A lighthouse.'))
    await items.create('page', page('Chapter 1', 'Steps.'))
    await backUp(DAY)
    const library = (JSON.parse(folder.files.get(LIST)!) as { library: string }).library
    stored.clear()
    await db.items.update(ideas, { body: page('Ideas', 'A lighthouse, and a keeper.') })
    await expect(backUp(DAY + 1000)).resolves.toMatchObject({ written: 1, removed: 0 })
    expect((JSON.parse(folder.files.get(LIST)!) as { library: string }).library).toBe(library)
    expect(names()).toEqual([BACKUP, LIST, 'Notes/Ideas.md', 'Pages/Chapter 1.md'])
  })
})

describe('a backup cut short', () => {
  it('has named the files it wrote, so the next one writes none of them again beside themselves', async () => {
    await items.create('note', page('Ideas', 'A lighthouse.'))
    await items.create('page', page('Chapter 1', 'Steps.'))
    const write = folder.plugin.write
    let calls = 0
    // The documents land and are named; then the backup file's turn fails, as if Nib were closed there.
    folder.plugin.write = async (options) => {
      if (++calls === 3) throw new Error('cut short')
      return write(options)
    }
    await expect(backUp(DAY)).resolves.toMatchObject({ failed: 'error' })
    folder.plugin.write = write
    await expect(backUp(DAY + 1000)).resolves.toMatchObject({ written: 0, removed: 0 })
    expect(names()).toEqual([BACKUP, LIST, 'Notes/Ideas.md', 'Pages/Chapter 1.md'])
  })
})

describe('when it can’t be done', () => {
  it('takes nothing away from a library that comes up empty', async () => {
    const ideas = await items.create('note', page('Ideas', 'A lighthouse.'))
    await backUp(DAY)
    await db.items.delete(ideas)
    await expect(backUp(DAY + 1000)).resolves.toMatchObject({ failed: 'doubt' })
    expect(names()).toContain('Notes/Ideas.md')
  })

  it('runs once a day, with a folder chosen, and says when the folder is lost', async () => {
    await items.create('note', page('Ideas', 'A lighthouse.'))
    folder.state.chosen = false
    await expect(backUpIfDue(DAY)).resolves.toBeNull()
    folder.state.chosen = true
    await expect(backUpIfDue(DAY)).resolves.toMatchObject({ written: 1 })
    await expect(backUpIfDue(DAY + 3600_000)).resolves.toBeNull()
    folder.state.lost = true
    await expect(backUpIfDue(DAY + 86_400_000)).resolves.toMatchObject({ failed: 'lost' })
    expect(lastBackup()).toMatchObject({ failed: 'lost' })
  })
})
