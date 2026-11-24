import { describe, expect, it } from 'vitest'
import type { Item } from '../db/db'
import { forBackup, forSync, keepMissing, readFields } from './documentFields'

const item = (fields: Partial<Item>): Item => ({ id: 'a', kind: 'note', body: { type: 'doc', content: [] }, version: 1, createdAt: 1, updatedAt: 1, ...fields })

describe('the archive, as a document travels', () => {
  it('goes with sync and into a backup', () => {
    expect(forSync(item({ archivedAt: 9 })).archivedAt).toBe(9)
    expect(forBackup(item({ archivedAt: 9 })).archivedAt).toBe(9)
  })

  it('reads a time or null, and nothing else', () => {
    expect(readFields({ archivedAt: 9 }, 'sync').archivedAt).toBe(9)
    expect(readFields({ archivedAt: null }, 'sync').archivedAt).toBeNull()
    for (const odd of ['soon', true, -1, {}]) expect('archivedAt' in readFields({ archivedAt: odd }, 'sync')).toBe(false)
  })

  it('stays when a document arrives from a Nib that has never heard of it, and comes out when it’s taken out', () => {
    const silent = item({})
    keepMissing(silent, item({ archivedAt: 9 }))
    expect(silent.archivedAt).toBe(9)
    const out = item({ archivedAt: null })
    keepMissing(out, item({ archivedAt: 9 }))
    expect(out.archivedAt).toBeNull()
  })
})

describe('read-only, as a document travels', () => {
  it('goes with sync and into a backup', () => {
    expect(forSync(item({ readOnly: true })).readOnly).toBe(true)
    expect(forBackup(item({ readOnly: true })).readOnly).toBe(true)
  })

  it('reads only what it can be', () => {
    expect(readFields({ readOnly: true }, 'sync').readOnly).toBe(true)
    expect(readFields({ readOnly: null }, 'sync').readOnly).toBeNull()
    for (const odd of ['yes', 1, false, {}]) expect('readOnly' in readFields({ readOnly: odd }, 'sync')).toBe(false)
  })

  it('stays when a document arrives from a Nib that has never heard of it', () => {
    const arrived = item({})
    keepMissing(arrived, item({ readOnly: true }))
    expect(arrived.readOnly).toBe(true)
  })

  it('comes off when another device takes it off', () => {
    const arrived = item({ readOnly: null })
    keepMissing(arrived, item({ readOnly: true }))
    expect(arrived.readOnly).toBeNull()
  })
})

describe('an expiry date, as a document travels', () => {
  it('goes with sync and into a backup', () => {
    expect(forSync(item({ expires: '2026-11-17' })).expires).toBe('2026-11-17')
    expect(forBackup(item({ expires: '2026-11-17' })).expires).toBe('2026-11-17')
  })

  it('reads a day or null, and nothing else', () => {
    expect(readFields({ expires: '2026-11-17' }, 'sync').expires).toBe('2026-11-17')
    expect(readFields({ expires: null }, 'sync').expires).toBeNull()
    for (const odd of ['soon', '2026-02-30', 9, true, {}]) expect('expires' in readFields({ expires: odd }, 'sync')).toBe(false)
  })

  it('stays when a document arrives from a Nib that has never heard of it, and goes when it’s taken off', () => {
    const silent = item({})
    keepMissing(silent, item({ expires: '2026-11-17' }))
    expect(silent.expires).toBe('2026-11-17')
    const off = item({ expires: null })
    keepMissing(off, item({ expires: '2026-11-17' }))
    expect(off.expires).toBeNull()
  })
})

describe('a reminder, as a document travels', () => {
  it('goes with sync, for the other devices to ring, and into a backup', () => {
    expect(forSync(item({ reminder: { at: 9 } })).reminder).toEqual({ at: 9 })
    expect(forBackup(item({ reminder: { at: 9 } })).reminder).toEqual({ at: 9 })
  })

  it('reads a time or null, and nothing else', () => {
    expect(readFields({ reminder: { at: 9 } }, 'sync').reminder).toEqual({ at: 9 })
    expect(readFields({ reminder: null }, 'sync').reminder).toBeNull()
    for (const odd of [9, 'soon', {}, { at: 'soon' }, true]) expect('reminder' in readFields({ reminder: odd }, 'sync')).toBe(false)
  })

  it('stays when a document arrives from a Nib that has never heard of it, and goes when it’s taken off', () => {
    const silent = item({})
    keepMissing(silent, item({ reminder: { at: 9 } }))
    expect(silent.reminder).toEqual({ at: 9 })
    const off = item({ reminder: null })
    keepMissing(off, item({ reminder: { at: 9 } }))
    expect(off.reminder).toBeNull()
  })
})

describe('kept on this device only, as a document travels', () => {
  it('doesn’t go with sync, and is in a backup', () => {
    expect('deviceOnly' in forSync(item({ deviceOnly: true }))).toBe(false)
    expect(forBackup(item({ deviceOnly: true })).deviceOnly).toBe(true)
  })

  it('is read back from a backup, on or taken off, and never from another device', () => {
    expect(readFields({ deviceOnly: true }, 'backup').deviceOnly).toBe(true)
    expect(readFields({ deviceOnly: null }, 'backup').deviceOnly).toBeNull()
    for (const odd of ['yes', 1, {}, false]) expect('deviceOnly' in readFields({ deviceOnly: odd }, 'backup')).toBe(false)
    expect('deviceOnly' in readFields({ deviceOnly: true }, 'sync')).toBe(false)
  })

  it('leaves what travels both ways read either way', () => {
    expect(readFields({ archivedAt: 9, expires: '2026-11-17' }, 'backup')).toEqual({ archivedAt: 9, expires: '2026-11-17' })
  })
})

describe('where a document went on the writer’s blog, as it travels', () => {
  const post = { site: 'https://blog.example', id: '42', url: 'https://blog.example/?p=42', edit: 'https://blog.example/wp-admin/post.php?post=42&action=edit', pictures: { ['a'.repeat(32)]: 'https://blog.example/uploads/a.png' } }

  it('goes with sync and into a backup, and stays when a document arrives from a Nib before it', () => {
    expect(forSync(item({ posted: [post] })).posted).toEqual([post])
    expect(forBackup(item({ posted: [post] })).posted).toEqual([post])
    const silent = item({})
    keepMissing(silent, item({ posted: [post] }))
    expect(silent.posted).toEqual([post])
  })

  it('reads posts with links and an id, and their pictures by what’s in them, and nothing else', () => {
    expect(readFields({ posted: [post] }, 'sync').posted).toEqual([post])
    // Micro.blog knows its posts by their addresses alone.
    const micro = { ...post, site: 'https://micro.blog', id: '', url: 'https://mara.micro.blog/2026/11/21/salt.html' }
    expect(readFields({ posted: [micro] }, 'sync').posted).toEqual([micro])
    expect(readFields({ posted: [] }, 'sync').posted).toEqual([])
    expect('posted' in readFields({ posted: 'yes' }, 'sync')).toBe(false)
    const odd = [
      { ...post, site: 'javascript:alert(1)' },
      { ...post, id: '42/../../wp-admin' },
      { ...post, edit: 'ftp://blog.example' },
      null,
    ]
    expect(readFields({ posted: odd }, 'sync').posted).toEqual([])
    const pictures = readFields({ posted: [{ ...post, pictures: { short: 'https://blog.example/b.png', ['b'.repeat(32)]: 'data:image/png;base64,AA' } }] }, 'sync').posted
    expect(pictures?.[0].pictures).toEqual({})
  })
})

describe('a chapter’s summary and status on the corkboard, as a document travels', () => {
  it('go with sync and into a backup', () => {
    const card = item({ kind: 'page', summary: 'Mara finds the logbook.', status: 'revised' })
    expect(forSync(card)).toMatchObject({ summary: 'Mara finds the logbook.', status: 'revised' })
    expect(forBackup(card)).toMatchObject({ summary: 'Mara finds the logbook.', status: 'revised' })
  })

  it('read one line of text, a status there is, or null, and nothing else', () => {
    expect(readFields({ summary: '  Mara finds\nthe logbook.  ', status: 'done' }, 'sync')).toMatchObject({ summary: 'Mara finds the logbook.', status: 'done' })
    expect(readFields({ summary: null, status: null }, 'backup')).toMatchObject({ summary: null, status: null })
    // A draft is no status: one sent as 'draft' isn't one there is.
    for (const odd of [3, {}, true]) expect('summary' in readFields({ summary: odd }, 'sync')).toBe(false)
    for (const odd of ['draft', 'Done', 1]) expect('status' in readFields({ status: odd }, 'sync')).toBe(false)
    // Only spaces is none.
    expect(readFields({ summary: '   ' }, 'sync').summary).toBeNull()
  })

  it('stay when a document arrives from a Nib that has never heard of them, and go when they’re taken off', () => {
    const silent = item({})
    keepMissing(silent, item({ summary: 'Mara finds the logbook.', status: 'done' }))
    expect(silent).toMatchObject({ summary: 'Mara finds the logbook.', status: 'done' })
    const off = item({ summary: null, status: null })
    keepMissing(off, item({ summary: 'Mara finds the logbook.', status: 'done' }))
    expect(off).toMatchObject({ summary: null, status: null })
  })
})

describe('a screenplay, as a document travels', () => {
  it('goes with sync and into a backup, reads true or null and nothing else, and stays when an older Nib sends the page without it', () => {
    const script = item({ kind: 'page', screenplay: true })
    expect(forSync(script)).toMatchObject({ screenplay: true })
    expect(forBackup(script)).toMatchObject({ screenplay: true })
    expect(readFields({ screenplay: true }, 'sync')).toMatchObject({ screenplay: true })
    expect(readFields({ screenplay: null }, 'backup')).toMatchObject({ screenplay: null })
    for (const odd of [false, 'yes', 1]) expect('screenplay' in readFields({ screenplay: odd }, 'sync')).toBe(false)
    const silent = item({ kind: 'page' })
    keepMissing(silent, item({ kind: 'page', screenplay: true }))
    expect(silent.screenplay).toBe(true)
    const off = item({ kind: 'page', screenplay: null })
    keepMissing(off, item({ kind: 'page', screenplay: true }))
    expect(off.screenplay).toBeNull()
  })
})

describe('a locked document’s summary', () => {
  const vault = { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) }

  it('is taken off when the lock arrives from a Nib from before summaries, which says nothing of it', () => {
    const locked = item({ vault })
    keepMissing(locked, item({ summary: 'Mara confesses to Joe.', status: 'done' }))
    expect(locked.summary).toBeNull()
    // What isn't words about the text stays.
    expect(locked.status).toBe('done')
  })

  it('is taken off one arriving with both, from another device or a backup', () => {
    expect(readFields({ vault, summary: 'Mara confesses to Joe.' }, 'sync').summary).toBeNull()
    expect(readFields({ vault, summary: 'Mara confesses to Joe.' }, 'backup').summary).toBeNull()
    expect(readFields({ summary: 'Mara confesses to Joe.' }, 'sync').summary).toBe('Mara confesses to Joe.')
  })
})
