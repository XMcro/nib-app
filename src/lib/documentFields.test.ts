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

