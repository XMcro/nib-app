import { describe, expect, it } from 'vitest'
import { COLORNOTE_AUTOMATIC, isColornote, openColornote } from './colornote'
import { colornoteOf, sealedOf } from './colornoteOf'

// A note as ColorNote keeps one, from real backups of 2024 and 2026 (public samples, read 2026-11-11).
const note = (id: number, title: string, text: string, more: Record<string, unknown> = {}) => ({ _id: id, title, note: text, encrypted: 0, modified_date: 1728922218086, active_state: 0, folder_id: 0, status: 0, space: 0, type: 0, note_ext: '', color_index: 3, created_date: 1728765229751, tags: '', uuid: `c2ddffef-eff3-418b-9c01-${String(id).padStart(12, '0')}`, ...more })

describe('opening a ColorNote backup', () => {
  it('knows one by how it opens, whatever it is called', async () => {
    expect(isColornote(await colornoteOf([note(1, 'Tides', 'High.')]))).toBe(true)
    expect(isColornote(new TextEncoder().encode('NOTE: this is some other backup, of plain words, and long enough.'))).toBe(false)
    expect(isColornote(new Uint8Array([0, 0x4e, 0, 0x4f, 0, 0x54, 0, 0x45]))).toBe(false)
  })

  it('reads its notes with the password it was made with: the one ColorNote’s own backups have, or the owner’s', async () => {
    const notes = [note(1, 'Tides', 'High at 07:40.\nLow at 13:55.'), note(2, 'Ünïcode ✓', '[ ] Rope\n[V] Lamp oil\n', { type: 16 })]
    expect(COLORNOTE_AUTOMATIC).toBe('0000')
    expect(await openColornote(await colornoteOf(notes), COLORNOTE_AUTOMATIC)).toEqual(notes)
    expect(await openColornote(await colornoteOf(notes, 'hunter2 ✓'), 'hunter2 ✓')).toEqual(notes)
  })

  it('says a password that doesn’t open it doesn’t, and gives no notes', async () => {
    const backup = await colornoteOf([note(1, 'Tides', 'High.')], '1234')
    expect(await openColornote(backup, COLORNOTE_AUTOMATIC)).toBeNull()
    expect(await openColornote(backup, '12345')).toBeNull()
    expect(await openColornote(backup, '')).toBeNull()
    expect(await openColornote(backup, '1234')).toHaveLength(1)
  })

  it('takes the notes and not what a newer backup says of the account before them, which opens as a note does', async () => {
    const backup = await colornoteOf([note(1, 'Tides', 'High.'), note(2, 'Ferry', 'At seven.')], '0000', { _id: 5912793510838272, client_uuid: '30857d1b-eaa5-423d-8b00-000000000000', auth_token: 'what signs the account in', title: 'not a note' })
    const notes = (await openColornote(backup, '0000'))!
    expect(notes.map((one) => one.title)).toEqual(['Tides', 'Ferry'])
    expect(JSON.stringify(notes)).not.toContain('auth_token')
  })

  it('gives what it could read of a backup cut short or damaged, and nothing for one with no notes in it', async () => {
    const whole = await colornoteOf([note(1, 'Tides', 'High.'), note(2, 'Ferry', 'At seven.'), note(3, 'Log', 'x'.repeat(400))])
    // Cut inside its last blocks: the end no longer adds up, as with the wrong password.
    expect(await openColornote(whole.subarray(0, whole.length - 20), '0000')).toBeNull()
    // One that opens and holds no notes is that, and not a wrong password.
    expect(await openColornote(await colornoteOf([]), '0000')).toEqual([])
    expect(await openColornote(await colornoteOf([], '1234'), '0000')).toBeNull()
    // And one that decrypts to what holds no section of notes at all wasn't opened: a wrong password can do that by chance.
    expect(await openColornote(await sealedOf(new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0])), '0000')).toBeNull()
    expect(await openColornote(await sealedOf(new TextEncoder().encode('Sixteen bytes or more of something else.')), '0000')).toBeNull()
    // A length that runs past the end, or words that are no note, end the reading there.
    const odd = await colornoteOf([note(1, 'Tides', 'High.'), 'not a note', note(3, 'Never reached', '')])
    expect((await openColornote(odd, '0000'))!.map((one) => one.title)).toEqual(['Tides'])
    const long = await colornoteOf([note(1, 'Tides', 'High.'), new Uint8Array([0, 0, 0x27, 0x0f, ...new TextEncoder().encode('{"_id":2,"title":"Says it is longer than it is"}')])])
    expect((await openColornote(long, '0000'))!.map((one) => one.title)).toEqual(['Tides'])
    const garbled = await colornoteOf([note(1, 'Tides', 'High.'), new Uint8Array([0, 0, 0, 5, ...new TextEncoder().encode('{"_id')]), note(3, 'Never reached', '')])
    expect((await openColornote(garbled, '0000'))!.map((one) => one.title)).toEqual(['Tides'])
  })
})
