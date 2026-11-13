import { describe, expect, it } from 'vitest'
import { GRACE_MS } from './paid'
import type { Refused } from './answer'
import { MAX_NOTES, NOTES_PER_HOUR, NOTES_PER_MINUTE, readShare, Share } from './share'
import { LIBRARY_IDLE_MS, MAX_LIBRARIES, MAX_LIVE_SHARES, Subscriber } from './subscriber'
import { MAX_NOTE_LENGTH, READ_ONCE_GONE } from './wire.mjs'
import { sqlite } from './testing'

const NOW = Date.UTC(2027, 0, 1)
const DAY = 86_400_000
const OWNER = 'o'.repeat(64)
const SUBSCRIBER = 's'.repeat(64)

function shared({ days = 30, entitledUntil = NOW + 30 * DAY, doc = 'sealed-doc', once = false } = {}) {
  const share = new Share(sqlite())
  share.create({ slug: 'slug', ownerHash: OWNER, subscriber: SUBSCRIBER, days, entitledUntil, doc, ...(once ? { once } : {}) }, NOW)
  return share
}

const status = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return (error as Refused).status
  }
  return 'ok'
}

describe('Share', () => {
  it('serves the sealed document until it expires, then never again', () => {
    const share = shared({ days: 7 })
    expect(share.read(NOW)).toEqual({ doc: 'sealed-doc', expiresAt: NOW + 7 * DAY, notesOn: true, counted: true })
    expect(status(() => share.read(NOW + 7 * DAY))).toBe(410)
  })

  it('keeps a document bigger than one row whole', () => {
    const doc = 'x'.repeat(2_500_000)
    expect(shared({ doc }).read(NOW).doc).toBe(doc)
  })

  it('exists once: a second create with the same slug is refused', () => {
    const share = shared()
    expect(status(() => share.create({ slug: 'slug', ownerHash: 'x', subscriber: 'y', days: 7, entitledUntil: NOW, doc: 'z' }, NOW))).toBe(409)
    expect(share.read(NOW).doc).toBe('sealed-doc')
  })

  it('takes notes, and gives them only to the owner', () => {
    const share = shared()
    share.addNote('sealed-note', NOW)
    expect(share.notes(OWNER, NOW).notes).toEqual([{ id: 1, at: NOW, note: 'sealed-note' }])
    expect(status(() => share.notes('x'.repeat(64), NOW))).toBe(403)
  })

  it('caps a note at 2 KB, a share at 200 notes, and notes at 10 a minute', () => {
    const share = shared()
    expect(status(() => share.addNote('n'.repeat(MAX_NOTE_LENGTH + 1), NOW))).toBe(400)
    for (let i = 0; i < NOTES_PER_MINUTE; i++) share.addNote('n', NOW + i)
    expect(status(() => share.addNote('n', NOW + 100))).toBe(429)
    // Then an hour on, and under forty an hour.
    let at = NOW + 3_600_000
    for (let i = NOTES_PER_MINUTE; i < MAX_NOTES; i++) share.addNote('n', (at += 90_001))
    expect(share.notes(OWNER, at).notes).toHaveLength(MAX_NOTES)
    expect(status(() => share.addNote('n', at + 120_000))).toBe(429)
  })

  // Five networks, each within its own limits, filled a draft's 200 places in about 20 minutes.
  it(`takes ${NOTES_PER_HOUR} notes an hour on one draft, from all its readers together`, () => {
    const share = shared()
    let at = NOW
    for (let i = 0; i < NOTES_PER_HOUR; i++) share.addNote('n', (at += 7_000))
    expect(status(() => share.addNote('n', (at += 7_000)))).toBe(429)
    expect(status(() => share.addNote('n', NOW + 3_600_000 + 7_000))).toBe('ok')
  })

  it('lets the owner delete a note, or turn notes off', () => {
    const share = shared()
    const id = share.addNote('unkind', NOW)
    share.deleteNote(OWNER, id, NOW)
    expect(share.notes(OWNER, NOW).notes).toEqual([])
    share.update(OWNER, { notes: false }, NOW)
    expect(status(() => share.addNote('again', NOW))).toBe(403)
    expect(share.notes(OWNER, NOW).notesOn).toBe(false)
  })

  it('extends from now, for the owner only', () => {
    const share = shared({ days: 7 })
    expect(status(() => share.update('x'.repeat(64), { days: 90 }, NOW))).toBe(403)
    expect(share.update(OWNER, { days: 90 }, NOW + 6 * DAY)).toBe(NOW + 96 * DAY)
    expect(share.read(NOW + 30 * DAY).doc).toBe('sealed-doc')
  })

  it('is gone entirely once revoked, notes and all', () => {
    const share = shared()
    share.addNote('n', NOW)
    expect(status(() => share.revoke('x'.repeat(64), NOW))).toBe(403)
    expect(share.revoke(OWNER, NOW)).toBe(SUBSCRIBER)
    expect(status(() => share.read(NOW))).toBe(404)
    expect(status(() => share.notes(OWNER, NOW))).toBe(404)
  })
})

// Erasing took the owner with everything else, so the slug could be created
// again: whoever had the link held its key, and could publish their own
// text at the author's old address, which the author could no longer revoke.
describe('a share that has ended', () => {
  const again = (share: Share) => () => share.create({ slug: 'slug', ownerHash: 'x'.repeat(64), subscriber: null, days: 7, entitledUntil: NOW, doc: 'not theirs' }, NOW + DAY)

  it('can’t be made again once revoked, and reads as gone as before', () => {
    const share = shared()
    share.revoke(OWNER, NOW)
    expect(status(again(share))).toBe(409)
    expect(status(() => share.read(NOW + DAY))).toBe(404)
  })

  it('can’t be made again once expired', () => {
    const share = shared({ days: 7 })
    share.erase()
    expect(status(again(share))).toBe(409)
    expect(status(() => share.read(NOW + 8 * DAY))).toBe(404)
  })
})

describe('readShare', () => {
  it('serves while the subscription is paid for, and through the grace period', async () => {
    const share = shared({ entitledUntil: NOW + DAY })
    const never = async () => null
    expect((await readShare(share, NOW + DAY + GRACE_MS - 1, never)).doc).toBe('sealed-doc')
    await expect(readShare(share, NOW + DAY + GRACE_MS, never)).rejects.toMatchObject({ status: 410 })
  })

  it('asks the subscription about a renewal before refusing, and remembers the answer', async () => {
    const share = shared({ entitledUntil: NOW + DAY })
    let asked = 0
    const renewed = async (subscriber: string) => {
      asked++
      expect(subscriber).toBe(SUBSCRIBER)
      return NOW + 60 * DAY
    }
    const later = NOW + 20 * DAY
    expect((await readShare(share, later, renewed)).doc).toBe('sealed-doc')
    expect((await readShare(share, later, renewed)).doc).toBe('sealed-doc')
    expect(asked).toBe(1)
  })
})

describe('Subscriber', () => {
  it('only ever extends', () => {
    const subscriber = new Subscriber(sqlite())
    expect(subscriber.entitle(NOW + 30 * DAY)).toBe(NOW + 30 * DAY)
    expect(subscriber.entitle(NOW + 5 * DAY)).toBe(NOW + 30 * DAY)
    expect(subscriber.entitle(NOW + 60 * DAY)).toBe(NOW + 60 * DAY)
  })

  it(`allows ${MAX_LIVE_SHARES} live shares, counting only live ones`, () => {
    const subscriber = new Subscriber(sqlite())
    for (let i = 0; i < MAX_LIVE_SHARES; i++) subscriber.admit(`slug-${i}`, NOW + (i === 0 ? DAY : 30 * DAY), NOW)
    expect(status(() => subscriber.admit('one-more', NOW + 30 * DAY, NOW))).toBe(429)
    subscriber.release('slug-1')
    subscriber.admit('one-more', NOW + 30 * DAY, NOW)
    // slug-0 expires after a day, which frees its place.
    expect(status(() => subscriber.admit('and-another', NOW + 30 * DAY, NOW + 2 * DAY))).toBe('ok')
  })

  // One receipt paid for any number of sync libraries.
  it(`pays for at most ${MAX_LIBRARIES} sync libraries`, () => {
    const subscriber = new Subscriber(sqlite())
    for (let i = 0; i < MAX_LIBRARIES; i++) expect(subscriber.claimLibrary(`library-${i}`, NOW)).toBe(true)
    expect(subscriber.claimLibrary('library-0', NOW)).toBe(false) // already one of them
    expect(status(() => subscriber.claimLibrary('one-more', NOW))).toBe(403)
    subscriber.releaseLibrary('library-1')
    expect(subscriber.claimLibrary('one-more', NOW)).toBe(true)
  })

  // A place was held until a wipe freed it, and a wipe needs the library's
  // code: turn sync off and start afresh five times, and the subscription
  // could never sync a new library again.
  it('stops counting a library once it has gone 60 days without renewing', () => {
    const subscriber = new Subscriber(sqlite())
    for (let i = 0; i < MAX_LIBRARIES; i++) subscriber.claimLibrary(`library-${i}`, NOW)
    // All but library-0 renew along the way, keeping their places.
    for (let i = 1; i < MAX_LIBRARIES; i++) expect(subscriber.claimLibrary(`library-${i}`, NOW + 30 * DAY)).toBe(false)
    expect(() => subscriber.claimLibrary('sixth', NOW + LIBRARY_IDLE_MS - 1)).toThrow(/60 days/)
    expect(subscriber.claimLibrary('sixth', NOW + LIBRARY_IDLE_MS)).toBe(true)
    expect(status(() => subscriber.claimLibrary('seventh', NOW + LIBRARY_IDLE_MS))).toBe(403)
  })

  it('takes a library back after 60 days like a new one, refused while five others are current', () => {
    const subscriber = new Subscriber(sqlite())
    subscriber.claimLibrary('quiet', NOW)
    const later = NOW + LIBRARY_IDLE_MS
    for (let i = 0; i < MAX_LIBRARIES; i++) expect(subscriber.claimLibrary(`library-${i}`, later)).toBe(true)
    expect(status(() => subscriber.claimLibrary('quiet', later))).toBe(403)
    subscriber.releaseLibrary('library-0')
    expect(subscriber.claimLibrary('quiet', later)).toBe(true)
  })

  // A refund changed nothing: the receipt went on paying until it expired.
  it('pays for nothing bought up to a refund, and says what it was paying for', () => {
    const subscriber = new Subscriber(sqlite())
    subscriber.entitle(NOW + 30 * DAY, NOW)
    subscriber.claimLibrary('library-0', NOW, NOW)
    subscriber.admit('slug-0', NOW + 30 * DAY, NOW, NOW)
    expect(subscriber.revoke(NOW)).toEqual({ libraries: ['library-0'], shares: ['slug-0'] })
    expect(subscriber.revoke(NOW)).toEqual({ libraries: ['library-0'], shares: ['slug-0'] })
    expect(subscriber.expiresAt()).toBe(0)
    expect(status(() => subscriber.entitle(NOW + 60 * DAY, NOW))).toBe(403)
    expect(status(() => subscriber.claimLibrary('library-1', NOW, NOW - DAY))).toBe(403)
    expect(status(() => subscriber.admit('slug-1', NOW + DAY, NOW, NOW))).toBe(403)
  })

  // Apple keeps a subscription's original transaction id when it renews or is
  // bought again, so one refund refused the same subscriber for good.
  it('pays again for a renewal or purchase made after the refund', () => {
    const subscriber = new Subscriber(sqlite())
    subscriber.entitle(NOW + 30 * DAY, NOW)
    subscriber.revoke(NOW)
    expect(subscriber.entitle(NOW + 60 * DAY, NOW + DAY)).toBe(NOW + 60 * DAY)
    expect(subscriber.expiresAt()).toBe(NOW + 60 * DAY)
    expect(subscriber.claimLibrary('library-1', NOW, NOW + DAY)).toBe(true)
    expect(status(() => subscriber.admit('slug-1', NOW + 30 * DAY, NOW + DAY, NOW + DAY))).toBe('ok')
    // The refunded purchase's own receipt still pays for nothing.
    expect(status(() => subscriber.entitle(NOW + 90 * DAY, NOW))).toBe(403)
  })
})

// A link that deletes itself after one reading (Nib Plus).
describe('a share to be read once', () => {
  it('isn’t handed over for the asking: only that it’s there, and to be read once', () => {
    const share = shared({ once: true })
    expect(share.read(NOW)).toEqual({ once: true, expiresAt: NOW + 30 * DAY, notesOn: true })
    // Asked again, by a chat app's preview or a reload: still there.
    expect(share.read(NOW)).toEqual({ once: true, expiresAt: NOW + 30 * DAY, notesOn: true })
  })

  it('is handed over once, when it’s asked to be revealed, and its text is gone from the server then', () => {
    const sql = sqlite()
    const share = new Share(sql)
    share.create({ slug: 'slug', ownerHash: OWNER, subscriber: SUBSCRIBER, days: 30, entitledUntil: NOW + 30 * DAY, doc: 'sealed-doc', once: true }, NOW)
    expect(share.reveal(NOW)).toEqual({ doc: 'sealed-doc', expiresAt: NOW + 30 * DAY, notesOn: true })
    expect(sql.all('SELECT COUNT(*) AS rows FROM chunks')[0].rows).toBe(0)
    expect(status(() => share.reveal(NOW))).toBe(410)
    expect(status(() => share.read(NOW))).toBe(410)
  })

  // The security review of 2026-11-13: the slug alone, which a log or a scanner on the way may keep, used one up.
  it('is handed over only for the token its hash was kept for, and kept for it otherwise', () => {
    const sql = sqlite()
    const share = new Share(sql)
    share.create({ slug: 'slug', ownerHash: OWNER, subscriber: SUBSCRIBER, days: 30, entitledUntil: NOW + 30 * DAY, doc: 'sealed-doc', once: true, reveal: 'a'.repeat(64) }, NOW)
    expect(status(() => share.reveal(NOW))).toBe(404)
    expect(status(() => share.reveal(NOW, 'b'.repeat(64)))).toBe(404)
    expect(share.read(NOW)).toMatchObject({ once: true })
    expect(share.reveal(NOW, 'a'.repeat(64))).toMatchObject({ doc: 'sealed-doc' })
    expect(status(() => share.reveal(NOW, 'a'.repeat(64)))).toBe(410)
  })

  it('says so to the next to ask, in words the reader’s page knows', () => {
    const share = shared({ once: true })
    share.reveal(NOW)
    try {
      share.read(NOW)
    } catch (error) {
      expect((error as Refused).message).toBe(READ_ONCE_GONE)
    }
    expect.assertions(1)
  })

  it('tells its owner whether it has been read, and still takes the reader’s notes after', () => {
    const share = shared({ once: true })
    expect(share.notes(OWNER, NOW)).toMatchObject({ once: true, opened: false })
    share.reveal(NOW)
    expect(share.notes(OWNER, NOW)).toMatchObject({ once: true, opened: true })
    share.addNote('sealed-note', NOW)
    expect(share.notes(OWNER, NOW).notes).toHaveLength(1)
  })

  it('can’t be revealed if it isn’t one, or once it has expired', () => {
    expect(status(() => shared().reveal(NOW))).toBe(404)
    expect(shared().notes(OWNER, NOW)).toMatchObject({ once: false, opened: false })
    expect(status(() => shared({ once: true, days: 7 }).reveal(NOW + 7 * DAY))).toBe(410)
  })

  it('is part of Nib Plus: a free share can’t be one', () => {
    const share = new Share(sqlite())
    expect(status(() => share.create({ slug: 'slug', ownerHash: OWNER, subscriber: null, days: 7, doc: 'sealed-doc', once: true }, NOW))).toBe(403)
    expect(status(() => share.read(NOW))).toBe(404)
  })

  it('isn’t revealed while its subscription has lapsed: asked first, read after', async () => {
    const share = shared({ once: true, entitledUntil: NOW - GRACE_MS - 1 })
    await expect(readShare(share, NOW, async () => null, { reveal: true })).rejects.toMatchObject({ status: 410 })
    // Renewed: it's still there to be read.
    expect(await readShare(share, NOW, async () => NOW + 30 * DAY, { reveal: true })).toMatchObject({ doc: 'sealed-doc' })
  })
})

describe('how many times a share has been opened', () => {
  const never = async () => null
  const opens = (share: Share) => share.notes(OWNER, NOW).opens

  it('is counted each time it’s handed to a reader, and told to its owner as a number', async () => {
    const share = shared()
    expect(opens(share)).toBe(0)
    // The reader is told it's counted, for their page to say so; whoever asked counts it (worker/shares).
    expect((await readShare(share, NOW, never)).counted).toBe(true)
    expect(opens(share)).toBe(0)
    share.countOpen(null)
    share.countOpen(null)
    expect(opens(share)).toBe(2)
  })

  it('keeps a number and nothing else: not when, and nothing of who', async () => {
    const sql = sqlite()
    const share = new Share(sql)
    share.create({ slug: 'slug', ownerHash: OWNER, subscriber: SUBSCRIBER, days: 30, entitledUntil: NOW + 30 * DAY, doc: 'sealed-doc' }, NOW)
    const before = sql.all('SELECT k, v FROM meta ORDER BY k')
    await readShare(share, NOW + 12_345, never)
    share.countOpen(null)
    await readShare(share, NOW + 67_890, never)
    share.countOpen(null)
    expect(sql.all('SELECT k, v FROM meta ORDER BY k')).toEqual([...before, { k: 'opens', v: 2 }].sort((a, b) => String(a.k).localeCompare(String(b.k))))
    expect(sql.all('SELECT COUNT(*) AS rows FROM notes')[0].rows).toBe(0)
  })

  it('doesn’t count its owner’s own asking, which is the app checking its key', async () => {
    const share = shared()
    share.countOpen(OWNER)
    expect(opens(share)).toBe(0)
    // Someone else's token is no one's.
    share.countOpen('x'.repeat(64))
    expect(opens(share)).toBe(1)
  })

  it('doesn’t count an asking that was refused: lapsed, or expired', async () => {
    const share = shared({ entitledUntil: NOW + DAY })
    await expect(readShare(share, NOW + DAY + GRACE_MS, never)).rejects.toMatchObject({ status: 410 })
    await expect(readShare(share, NOW + 31 * DAY, never)).rejects.toMatchObject({ status: 410 })
    expect(opens(share)).toBe(0)
  })

  it('is part of Nib Plus: a free share isn’t counted, says nothing of counting, and tells its owner no number', async () => {
    const sql = sqlite()
    const share = new Share(sql)
    share.create({ slug: 'slug', ownerHash: OWNER, subscriber: null, days: 7, doc: 'sealed-doc' }, NOW)
    const read = await readShare(share, NOW, never)
    expect(read.doc).toBe('sealed-doc')
    expect('counted' in read).toBe(false)
    expect('opens' in share.notes(OWNER, NOW)).toBe(false)
    // And nothing was kept.
    expect(sql.all("SELECT v FROM meta WHERE k = 'opens'")).toEqual([])
  })

  it('isn’t kept for one to be read once, whose owner is told that it was read instead', async () => {
    const sql = sqlite()
    const share = new Share(sql)
    share.create({ slug: 'slug', ownerHash: OWNER, subscriber: SUBSCRIBER, days: 30, entitledUntil: NOW + 30 * DAY, doc: 'sealed-doc', once: true }, NOW)
    expect('counted' in (await readShare(share, NOW, never))).toBe(false)
    await readShare(share, NOW, never, { reveal: true })
    expect(share.notes(OWNER, NOW)).toMatchObject({ opened: true })
    expect('opens' in share.notes(OWNER, NOW)).toBe(false)
    expect(sql.all("SELECT v FROM meta WHERE k = 'opens'")).toEqual([])
  })

  it('goes with the share when it’s stopped', async () => {
    const sql = sqlite()
    const share = new Share(sql)
    share.create({ slug: 'slug', ownerHash: OWNER, subscriber: SUBSCRIBER, days: 30, entitledUntil: NOW + 30 * DAY, doc: 'sealed-doc' }, NOW)
    await readShare(share, NOW, never)
    share.revoke(OWNER, NOW)
    expect(sql.all('SELECT k FROM meta')).toEqual([{ k: 'ended' }])
  })
})
