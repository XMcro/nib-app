import { describe, expect, it } from 'vitest'
import { FILE_FLOOR, KEPT_MONTHS, Library, libraryRequests, retireLibrary, type LibraryEffects } from './library'
import { GRACE_MS } from './paid'
import { signedMessage } from './signing'
import { emptyFiles } from './files'
import { memoryFiles, sqlite } from './testing'

const NOW = Date.UTC(2027, 0, 1)
const AUTH = 'a'.repeat(64)

function entitled() {
  const library = new Library(sqlite())
  library.create(AUTH, NOW + 30 * 86_400_000, NOW)
  return library
}

describe('Library', () => {
  it('does not exist until a subscription creates it; renewing never does', () => {
    const library = new Library(sqlite())
    expect(() => library.changes(AUTH, 0, NOW)).toThrow('No library for that code')
    expect(() => library.entitle(AUTH, NOW + 1000, NOW)).toThrow('No library for that code')
    library.create(AUTH, NOW + 1000, NOW)
    expect(library.changes(AUTH, 0, NOW).records).toEqual([])
  })

  it('refuses a different code', () => {
    const library = entitled()
    expect(() => library.changes('b'.repeat(64), 0, NOW)).toThrow('does not match')
    expect(() => library.entitle('b'.repeat(64), NOW + 1000, NOW)).toThrow('does not match')
  })

  it('stops syncing once Plus has lapsed past the grace period', () => {
    const library = new Library(sqlite())
    library.create(AUTH, NOW, NOW)
    expect(() => library.changes(AUTH, 0, NOW + GRACE_MS - 1)).not.toThrow()
    expect(() => library.changes(AUTH, 0, NOW + GRACE_MS + 1)).toThrow('not active')
    expect(library.status(AUTH, NOW + GRACE_MS + 1).entitled).toBe(false)
  })

  it('only ever extends the expiry', () => {
    const library = entitled()
    library.entitle(AUTH, NOW + 1000, NOW)
    expect(library.status(AUTH, NOW).expiresAt).toBe(NOW + 30 * 86_400_000)
  })

  it('stores, sequences and returns records in order', () => {
    const library = entitled()
    expect(library.push(AUTH, [{ k: 'x', p: 'one' }, { k: 'y', p: 'two' }], NOW)).toEqual([
      { k: 'x', s: 1 },
      { k: 'y', s: 2 },
    ])
    expect(library.push(AUTH, [{ k: 'x', b: 1, p: 'one, edited' }], NOW)).toEqual([{ k: 'x', s: 3 }])
    const all = library.changes(AUTH, 0, NOW)
    expect(all.records).toEqual([
      { k: 'y', s: 2, p: 'two' },
      { k: 'x', s: 3, p: 'one, edited' },
    ])
    expect(all.seq).toBe(3)
    expect(library.changes(AUTH, 3, NOW).records).toEqual([])
  })

  it('reports a conflict when the writer had not seen the latest version', () => {
    const library = entitled()
    library.push(AUTH, [{ k: 'x', p: 'first' }], NOW)
    library.push(AUTH, [{ k: 'x', b: 1, p: 'from phone' }], NOW)
    // The iPad still thinks version 1 is current.
    expect(library.push(AUTH, [{ k: 'x', b: 1, p: 'from iPad' }], NOW)).toEqual([{ k: 'x', conflict: 2 }])
    // And a brand-new record may not silently replace an existing one.
    expect(library.push(AUTH, [{ k: 'x', p: 'stranger' }], NOW)).toEqual([{ k: 'x', conflict: 2 }])
    expect(library.changes(AUTH, 0, NOW).records[0].p).toBe('from phone')
  })

  it('keeps deletions so other devices learn of them, at the cost of their row alone', () => {
    const library = entitled()
    library.push(AUTH, [{ k: 'x', p: 'doomed' }], NOW)
    library.push(AUTH, [{ k: 'x', b: 1, d: 1 }], NOW)
    expect(library.changes(AUTH, 0, NOW).records).toEqual([{ k: 'x', s: 2, d: 1 }])
    expect(library.status(AUTH, NOW).bytes).toBe('x'.length + 100)
  })

  // A delete was only ever its key, so a server could send one for every
  // record and no device could tell. The device's seal now travels with it.
  it('keeps the seal a delete comes with, passes it on, and counts it', () => {
    const library = entitled()
    library.push(AUTH, [{ k: 'x', p: 'doomed' }, { k: 'y', p: 'kept' }], NOW)
    library.push(AUTH, [{ k: 'x', b: 1, d: 1, p: 'sealed' }, { k: 'y', b: 2, d: 1 }], NOW)
    expect(library.changes(AUTH, 0, NOW).records).toEqual([
      { k: 'x', s: 3, d: 1, p: 'sealed' },
      { k: 'y', s: 4, d: 1 },
    ])
    expect(library.status(AUTH, NOW).bytes).toBe('sealed'.length + 'x'.length + 100 + 'y'.length + 100)
  })

  it('splits and reassembles payloads larger than one row', () => {
    const library = entitled()
    const big = 'q'.repeat(2_500_000)
    library.push(AUTH, [{ k: 'big', p: big }], NOW)
    expect(library.changes(AUTH, 0, NOW).records[0].p).toBe(big)
  })

  it('pages through large libraries without skipping anything', () => {
    const library = entitled()
    library.push(AUTH, Array.from({ length: 7 }, (_, i) => ({ k: `k${i}`, p: String(i) })), NOW)
    const first = library.changes(AUTH, 0, NOW, 3)
    expect(first.records.map((r) => r.k)).toEqual(['k0', 'k1', 'k2'])
    expect(first.more).toBe(true)
    const second = library.changes(AUTH, first.seq, NOW, 3)
    const third = library.changes(AUTH, second.seq, NOW, 3)
    expect([...second.records, ...third.records].map((r) => r.k)).toEqual(['k3', 'k4', 'k5', 'k6'])
    expect(third.more).toBe(false)
  })

  it('refuses writes past the storage limit, record by record', () => {
    const library = new Library(sqlite(), 200)
    library.create(AUTH, NOW + 1000, NOW)
    const results = library.push(AUTH, [{ k: 'fits', p: 'x' }, { k: 'huge', p: 'y'.repeat(100) }], NOW)
    expect(results).toEqual([{ k: 'fits', s: 1 }, { k: 'huge', error: 'full' }])
  })

  // Only payload characters counted, so keys and rows, and deletes, were free.
  it('counts each record’s key and row against the limit, deleted ones too', () => {
    const library = new Library(sqlite(), 1000)
    library.create(AUTH, NOW + 1000, NOW)
    const key = (i: number) => String(i).padStart(43, 'k')
    const results = library.push(AUTH, Array.from({ length: 7 }, (_, i) => (i % 2 ? { k: key(i), d: 1 } : { k: key(i), p: 'AAAA' })), NOW)
    expect(results.map((result) => ('error' in result ? result.error : 'ok'))).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'full'])
  })

  // Adding up every record on every push read the whole library each time a
  // writer paused: rows read, and billed, grew with its size.
  it('keeps its size as it goes, and adds up its records only once', () => {
    const queries: string[] = []
    const sql = sqlite()
    const counted = { ...sql, all: (query: string, ...args: (string | number | null)[]) => (queries.push(query), sql.all(query, ...args)) }
    const recount = () => Number(sql.all('SELECT COALESCE(SUM(size), 0) AS total FROM records')[0].total)
    const library = new Library(counted, 10_000)
    library.create(AUTH, NOW + 1000, NOW)
    library.push(AUTH, [{ k: 'x', p: 'one' }, { k: 'y', p: 'two' }], NOW)
    library.push(AUTH, [{ k: 'x', b: 1, p: 'one, a good deal longer now' }, { k: 'y', b: 2, d: 1 }], NOW)
    expect(library.push(AUTH, [{ k: 'z', p: 'z'.repeat(20_000) }], NOW)).toEqual([{ k: 'z', error: 'full' }])
    expect(library.status(AUTH, NOW).bytes).toBe(recount())
    expect(queries.filter((query) => query.includes('SUM(')).length).toBeLessThanOrEqual(1)

    // A library from before this keeps no size: it's added up once, then kept.
    sql.run("DELETE FROM meta WHERE k = 'bytes'")
    queries.length = 0
    expect(library.status(AUTH, NOW).bytes).toBe(recount())
    library.push(AUTH, [{ k: 'w', p: 'more' }], NOW)
    expect(library.status(AUTH, NOW).bytes).toBe(recount())
    expect(queries.filter((query) => query.includes('SUM(')).length).toBe(1)

    library.wipe(AUTH, NOW)
    expect(() => library.status(AUTH, NOW)).toThrow('No library')
  })

  // So a subscription can count, and cut off, the libraries it pays for. One
  // made before this has none until its next renewal, and syncs meanwhile.
  it('keeps which subscriptions pay for it, and says so when wiped: every one, not only the last', () => {
    const library = new Library(sqlite())
    library.create(AUTH, NOW + 86_400_000, NOW, 'subscription-a')
    expect(library.wipe(AUTH, NOW)).toEqual(['subscription-a'])
    const older = entitled()
    expect(older.status(AUTH, NOW).entitled).toBe(true)
    older.entitle(AUTH, NOW + 2 * 86_400_000, NOW, 'subscription-b')
    expect(older.wipe(AUTH, NOW)).toEqual(['subscription-b'])
    const shared = new Library(sqlite())
    shared.create(AUTH, NOW + 86_400_000, NOW, 'subscription-a')
    shared.entitle(AUTH, NOW + 2 * 86_400_000, NOW, 'subscription-b')
    expect(shared.wipe(AUTH, NOW)).toEqual(['subscription-a', 'subscription-b'])
  })

  it('stops syncing at once when its subscription is refunded', () => {
    const library = entitled()
    library.revoke('subscription-a')
    expect(library.status(AUTH, NOW).entitled).toBe(true) // not what pays for it
    library.entitle(AUTH, NOW + 86_400_000, NOW, 'subscription-a')
    library.revoke('subscription-a')
    expect(library.status(AUTH, NOW).entitled).toBe(false)
    expect(() => library.changes(AUTH, 0, NOW)).toThrow('not active')
  })

  // The library named whichever subscription sent its receipt last, and a refund of any other did nothing: a year
  // refunded went on syncing once a second Apple ID's receipt, a trial's or one long expired, had been sent for it.
  it('is cut off by a refund though another subscription’s receipt has come since, one that pays for nothing now', () => {
    const library = new Library(sqlite())
    library.create(AUTH, NOW + 365 * 86_400_000, NOW, 'subscription-a')
    library.entitle(AUTH, NOW - 30 * 86_400_000, NOW, 'subscription-b')
    library.revoke('subscription-a', NOW)
    expect(library.status(AUTH, NOW).entitled).toBe(false)
  })

  it('runs on after a refund only as far as another subscription has itself paid it', () => {
    const library = new Library(sqlite())
    library.create(AUTH, NOW + 365 * 86_400_000, NOW, 'subscription-a')
    library.entitle(AUTH, NOW + 30 * 86_400_000, NOW, 'subscription-b')
    library.revoke('subscription-a', NOW)
    expect(library.status(AUTH, NOW)).toMatchObject({ entitled: true, expiresAt: NOW + 30 * 86_400_000 })
    // And that one refunded too, nothing pays for it.
    library.revoke('subscription-b', NOW)
    expect(library.status(AUTH, NOW).entitled).toBe(false)
  })

  it('is cut back by a refund of a subscription whose renewal the App Store told it of, whichever sent its receipt last', () => {
    const library = new Library(sqlite())
    library.create(AUTH, NOW + 30 * 86_400_000, NOW, 'subscription-a')
    library.entitle(AUTH, NOW + 30 * 86_400_000, NOW, 'subscription-b')
    library.paidTo(NOW + 400 * 86_400_000, 'subscription-a')
    expect(library.status(AUTH, NOW).expiresAt).toBe(NOW + 400 * 86_400_000)
    library.revoke('subscription-a', NOW)
    expect(library.status(AUTH, NOW)).toMatchObject({ entitled: true, expiresAt: NOW + 30 * 86_400_000 })
  })

  it('gives the one subscription on record what was paid, in a library from before each one’s was kept', () => {
    const sql = sqlite()
    const library = new Library(sql)
    library.create(AUTH, NOW + 365 * 86_400_000, NOW, 'subscription-a')
    // As such a library is: the subscription named, the date it's paid to, and no more.
    sql.run('DELETE FROM paid')
    library.entitle(AUTH, NOW + 30 * 86_400_000, NOW, 'subscription-b')
    library.revoke('subscription-b', NOW)
    expect(library.status(AUTH, NOW)).toMatchObject({ entitled: true, expiresAt: NOW + 365 * 86_400_000 })
    library.revoke('subscription-a', NOW)
    expect(library.status(AUTH, NOW).entitled).toBe(false)
  })

  it('forgets everything when wiped', () => {
    const library = entitled()
    library.push(AUTH, [{ k: 'x', p: 'secret' }], NOW)
    library.wipe(AUTH, NOW)
    expect(() => library.changes(AUTH, 0, NOW)).toThrow('No library for that code')
    expect(() => library.entitle(AUTH, NOW + 1000, NOW)).toThrow('No library for that code')
  })
})

// The server keeps 90 days of history: a device asks it to let go of older
// versions (sync/engine expireHistory), which it can't tell apart itself.
describe('Library letting go of old versions', () => {
  it('drops their sealed text and leaves them out of what new devices fetch', () => {
    const library = entitled()
    library.push(AUTH, [{ k: 'old', p: 'an old version' }, { k: 'doc', p: 'the document' }], NOW)
    const before = library.status(AUTH, NOW).bytes
    expect(library.expire(AUTH, ['old', 'unknown'], NOW)).toEqual(['old'])
    expect(library.changes(AUTH, 0, NOW).records).toEqual([{ k: 'doc', s: 2, p: 'the document' }])
    expect(library.status(AUTH, NOW).bytes).toBe(before - 'an old version'.length)
    // Asked again, nothing more to do.
    expect(library.expire(AUTH, ['old'], NOW)).toEqual([])
  })

  it('still takes a delete for one, which every device then hears of', () => {
    const library = entitled()
    library.push(AUTH, [{ k: 'old', p: 'an old version' }], NOW)
    library.expire(AUTH, ['old'], NOW)
    expect(library.push(AUTH, [{ k: 'old', b: 1, d: 1, p: 'seal' }], NOW)).toEqual([{ k: 'old', s: 2 }])
    expect(library.changes(AUTH, 0, NOW).records).toEqual([{ k: 'old', s: 2, d: 1, p: 'seal' }])
  })

  it('takes it back in full if a device writes it again', () => {
    const library = entitled()
    library.push(AUTH, [{ k: 'old', p: 'an old version' }], NOW)
    library.expire(AUTH, ['old'], NOW)
    library.push(AUTH, [{ k: 'old', b: 1, p: 'written again' }], NOW)
    expect(library.changes(AUTH, 0, NOW).records).toEqual([{ k: 'old', s: 2, p: 'written again' }])
  })

  it('refuses a stranger', () => {
    const library = entitled()
    expect(() => library.expire('b'.repeat(64), ['old'], NOW)).toThrow('does not match')
  })

  it('gives a library made before files were kept a place to count them, the first time it’s opened', () => {
    const sql = sqlite()
    new Library(sql).create(AUTH, NOW + 30 * 86_400_000, NOW)
    sql.run('DROP TABLE files')
    const opened = new Library(sql)
    opened.storedFile('a', 10)
    // Counted at FILE_FLOOR at the least (the security review of 2026-11-13).
    expect(opened.files(AUTH, NOW)).toEqual({ files: [{ k: 'a', size: 10 }], bytes: FILE_FLOOR, limit: 2_000_000_000 })
  })

  it('stops counting a file written over by one there turned out to be no room for: both are gone from the store', () => {
    const library = new Library(sqlite(), undefined, 10_000)
    library.create(AUTH, NOW + 30 * 86_400_000, NOW)
    library.storedFile('a', 5000)
    library.storedFile('b', 4500)
    expect(() => library.storedFile('a', 5501)).toThrow('files are full')
    expect(library.files(AUTH, NOW)).toMatchObject({ files: [{ k: 'b', size: 4500 }], bytes: 4500 })
  })

  // The security review of 2026-11-13: its id is in its inbox's address, so a library deleted is never made again, by its code or any other.
  it('makes no library again where one was wiped, under its code or another', () => {
    const library = entitled()
    library.storedFile('a', 6000)
    library.wipe(AUTH, NOW)
    expect(() => library.create(AUTH, NOW + 30 * 86_400_000, NOW)).toThrow('was deleted')
    expect(() => library.create('c'.repeat(64), NOW + 30 * 86_400_000, NOW)).toThrow('was deleted')
    expect(() => library.files(AUTH, NOW)).toThrow('No library')
  })

  // The security review of 2026-11-13: room is booked as a file is sent, so one cut off after the store took it is still counted.
  it('counts a file from when its room is asked for, lists it only once it’s stored, and lets a booking go when the store didn’t take it', () => {
    const library = new Library(sqlite(), undefined, 10_000)
    library.create(AUTH, NOW + 30 * 86_400_000, NOW)
    library.fileRoom(AUTH, 'a', 6000, NOW)
    expect(library.files(AUTH, NOW)).toMatchObject({ files: [], bytes: 6000 })
    expect(() => library.fileRoom(AUTH, 'b', 4001, NOW)).toThrow('files are full')
    library.fileFailed('a')
    expect(library.files(AUTH, NOW)).toMatchObject({ files: [], bytes: 0 })
    library.fileRoom(AUTH, 'a', 6000, NOW)
    library.storedFile('a', 6000)
    expect(library.files(AUTH, NOW)).toMatchObject({ files: [{ k: 'a', size: 6000 }], bytes: 6000 })
    // Sent again, and not taken: the file there before stays, counted.
    library.fileRoom(AUTH, 'a', 6500, NOW)
    library.fileFailed('a')
    expect(library.files(AUTH, NOW)).toMatchObject({ files: [{ k: 'a', size: 6000 }], bytes: 6000 })
  })

  it('counts each file as FILE_FLOOR at the least, so tiny ones can’t fill the store with objects', () => {
    const library = new Library(sqlite(), undefined, 3 * FILE_FLOOR)
    library.create(AUTH, NOW + 30 * 86_400_000, NOW)
    for (const key of ['a', 'b', 'c']) library.storedFile(key, 1)
    expect(() => library.fileRoom(AUTH, 'd', 1, NOW)).toThrow('files are full')
  })

  it('adds the column to a library made before it', () => {
    const sql = sqlite()
    sql.run('CREATE TABLE records (k TEXT PRIMARY KEY, seq INTEGER NOT NULL, deleted INTEGER NOT NULL, size INTEGER NOT NULL)')
    sql.run("INSERT INTO records (k, seq, deleted, size) VALUES ('kept', 1, 0, 3)")
    const library = new Library(sql)
    library.create(AUTH, NOW + 1000, NOW)
    expect(library.changes(AUTH, 0, NOW).records.map((record) => record.k)).toEqual(['kept'])
  })
})

// Letting go of history needed Plus, so a lapsed library kept every version it had, past the 90 days the policy
// says, till it was itself deleted (the server audit of 2026-11-23).
describe('a lapsed library’s history', () => {
  it('is let go of when a device asks, as a file is taken off and an inbox ended without Plus', () => {
    const library = new Library(sqlite())
    library.create(AUTH, NOW + 86_400_000, NOW)
    library.push(AUTH, [{ k: 'K'.repeat(43), p: 'AAAA' }], NOW)
    const lapsed = NOW + 60 * 86_400_000
    expect(() => library.changes(AUTH, 0, lapsed)).toThrow(/not active/)
    expect(() => library.push(AUTH, [{ k: 'L'.repeat(43), p: 'AAAA' }], lapsed)).toThrow(/not active/)
    expect(library.expire(AUTH, ['K'.repeat(43)], lapsed)).toEqual(['K'.repeat(43)])
    // And only by the library's code.
    expect(() => library.expire('another code', ['K'.repeat(43)], lapsed)).toThrow()
  })
})

// The server audit of 2026-11-23.
describe('a library’s inbox, its address changed', () => {
  const DAY = 86_400_000
  it('starts its day afresh at the new address: the old one’s count doesn’t stand against it', () => {
    const library = new Library(sqlite())
    library.create(AUTH, NOW + 30 * DAY, NOW)
    library.setInbox(AUTH, 'K', 'a'.repeat(64), 'kept', NOW)
    for (let n = 0; n < 200; n++) library.addPost('a'.repeat(64), 'p', NOW)
    library.tookPosts(AUTH, Array.from({ length: 200 }, (_, n) => n + 1), NOW)
    expect(() => library.inboxFor('a'.repeat(64), NOW)).toThrow(/all it takes in a day/)
    // The same address set again (its key changed, say) is the same inbox, and the same day.
    library.setInbox(AUTH, 'K2', 'a'.repeat(64), 'kept', NOW)
    expect(() => library.inboxFor('a'.repeat(64), NOW)).toThrow(/all it takes in a day/)
    library.setInbox(AUTH, 'K2', 'b'.repeat(64), 'kept', NOW)
    expect(library.inboxFor('b'.repeat(64), NOW)).toBe('K2')
  })

  // Not the hash of its address's secret: setting an inbox asks for it, so told here, the code alone could keep
  // the writer's address and change only the key posts are sealed with (the server audit of 2026-11-23).
  it('tells a device the key it seals with, with what the devices keep, and never its address’s hash', () => {
    const library = new Library(sqlite())
    library.create(AUTH, NOW + 30 * DAY, NOW)
    expect(library.inbox(AUTH, NOW)).toEqual({ on: false, posts: [], more: false })
    library.setInbox(AUTH, 'K', 'a'.repeat(64), 'kept', NOW)
    expect(library.inbox(AUTH, NOW)).toEqual({ on: true, kept: 'kept', key: 'K', posts: [], more: false })
    expect(JSON.stringify(library.inbox(AUTH, NOW))).not.toContain('a'.repeat(64))
  })
})

// Security finding 12 of the 8 November audit: a lapsed library was kept for ever, and could have no one left who could delete it.
describe('a library that has lapsed', () => {
  const DAY = 86_400_000
  const yearOn = (ended: number) => {
    const date = new Date(ended + GRACE_MS)
    date.setUTCMonth(date.getUTCMonth() + KEPT_MONTHS)
    return date.getTime()
  }
  /** A real library, its alarm and its clock the test's. `deleted`: down to the mark that it was here. */
  function object(expires = NOW + 30 * DAY) {
    const sql = sqlite()
    const library = new Library(sql)
    const clock = { now: NOW }
    const state = {
      alarm: null as number | null,
      get deleted() {
        return library.gone()
      },
    }
    const files = memoryFiles()
    const released: [string, string[]][] = []
    const effects: LibraryEffects = {
      release: async (id, subscriptions) => void released.push([id, subscriptions]),
      alarm: async (at) => void (state.alarm = at),
      home: 'its-home',
      deleteFiles: () => emptyFiles(files, 'its-home'),
    }
    const requests = libraryRequests(library, () => clock.now, effects)
    const retire = () => retireLibrary(library, clock.now, effects)
    return { sql, library, clock, state, files, requests, retire, released, create: () => requests.create(AUTH, expires, 'subscription-a'), expires }
  }

  it('is due to be deleted 12 months past what was paid and its grace', async () => {
    expect(KEPT_MONTHS).toBe(12)
    const { create, state, expires } = object()
    await create()
    expect(state.alarm).toBe(yearOn(expires))
    expect(state.alarm).toBeGreaterThan(expires + GRACE_MS + 364 * DAY)
  })

  it('keeps everything when renewed before the alarm, and the alarm moves with it', async () => {
    const { create, requests, retire, state, clock, library, expires } = object()
    await create()
    library.push(AUTH, [{ k: 'x', p: 'kept' }], NOW)
    const renewed = expires + 400 * DAY
    await requests.entitle(AUTH, renewed, 'subscription-a')
    expect(state.alarm).toBe(yearOn(renewed))
    clock.now = yearOn(expires) + 1
    await retire()
    expect(state.deleted).toBe(false)
    expect(library.changes(AUTH, 0, clock.now).records.map(({ k }) => k)).toEqual(['x'])
  })

  it('is deleted, whole, by an alarm after the period', async () => {
    const { create, retire, state, clock, requests, expires, sql } = object()
    await create()
    clock.now = yearOn(expires)
    await retire()
    expect(state.deleted).toBe(true)
    // Nothing kept but that one was here, so none is made there again (the security review of 2026-11-13).
    expect(sql.all("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([{ name: 'meta' }])
    expect(sql.all('SELECT k, v FROM meta')).toEqual([{ k: 'gone', v: 1 }])
    // The object may answer again before it's gone from memory: as a library that isn't there.
    expect((await requests.status(AUTH)).status).toBe(404)
    expect((await requests.create(AUTH, clock.now + DAY)).status).toBe(410)
    expect(sql.all("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([{ name: 'meta' }])
  })

  it('does nothing when an alarm comes early because the expiry moved, but set it again for the new date', async () => {
    const { create, retire, state, clock, library, expires } = object()
    await create()
    library.push(AUTH, [{ k: 'x', p: 'kept' }], NOW)
    const later = expires + 90 * DAY
    library.entitle(AUTH, later, NOW)
    state.alarm = null
    clock.now = yearOn(expires) + 1
    await retire()
    expect(state.deleted).toBe(false)
    expect(state.alarm).toBe(yearOn(later))
    expect(library.status(AUTH, clock.now).expiresAt).toBe(later)
  })

  it('gets its alarm the first time it’s opened, lapsed or not', async () => {
    const { library, requests, state, clock, expires } = object()
    library.create(AUTH, expires, NOW, 'subscription-a')
    expect(state.alarm).toBeNull()
    clock.now = expires + GRACE_MS + DAY
    expect((await requests.changes(AUTH, 0)).status).toBe(402)
    expect(state.alarm).toBe(yearOn(expires))
  })

  it('counts a refund from when it came, not from before the library was made', async () => {
    const { create, requests, state, clock, library, retire } = object()
    await create()
    clock.now = NOW + 10 * DAY
    await requests.revoke('subscription-a')
    expect(state.alarm).toBe(yearOn(NOW + 10 * DAY))
    expect(library.status(AUTH, clock.now).expiresAt).toBe(0)
    await retire()
    expect(state.deleted).toBe(false)
  })

  // With another subscription's old receipt on record (a second Apple ID in the house, long stopped), a refund put
  // the library's paid date back to that one's, perhaps years past, and the twelve months counted from there: its
  // alarm fell due in the past, and it was deleted that moment, files and all, with no later purchase able to
  // bring it back (the server audit of 2026-11-23).
  it('counts a refund from when it came though another subscription paid long before', async () => {
    const { requests, state, clock, retire } = object()
    clock.now = NOW - 500 * DAY
    await requests.create(AUTH, NOW - 470 * DAY, 'subscription-a')
    await requests.entitle(AUTH, NOW + 30 * DAY, 'subscription-b')
    clock.now = NOW
    await requests.revoke('subscription-b')
    expect(state.alarm).toBe(yearOn(NOW))
    await retire()
    expect(state.deleted).toBe(false)
    // And bought again the day after, it syncs.
    clock.now = NOW + DAY
    expect((await requests.entitle(AUTH, NOW + 31 * DAY, 'subscription-b')).status).toBe(200)
    expect((await requests.changes(AUTH, 0)).status).toBe(200)
    expect(state.alarm).toBe(yearOn(NOW + 31 * DAY))
  })

  it('still counts from what another has paid to, when that is later than the refund', async () => {
    const { requests, state, clock } = object()
    await requests.create(AUTH, NOW + 60 * DAY, 'subscription-a')
    await requests.entitle(AUTH, NOW + 30 * DAY, 'subscription-b')
    clock.now = NOW + DAY
    await requests.revoke('subscription-b')
    expect(state.alarm).toBe(yearOn(NOW + 60 * DAY))
  })

  // Wiped, its emptied tables stayed (the server audit of 2026-11-23).
  it('deleted by its writer, keeps the mark that it was here alone, and is never made again', async () => {
    const { create, requests, state, sql } = object()
    await create()
    await requests.push(AUTH, [{ k: 'K'.repeat(43), p: 'AAAA' }])
    expect((await requests.wipe(AUTH)).body).toEqual({ wiped: true, subscriptions: ['subscription-a'] })
    expect(state.deleted).toBe(true)
    expect(sql.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name)).toEqual(['meta'])
    expect(state.alarm).toBeNull()
    expect((await requests.create(AUTH, NOW + 30 * DAY, 'subscription-a')).status).toBe(410)
    expect((await requests.changes(AUTH, 0)).status).toBe(404)
  })

  // Its storage was deleted, and the mark put back after: two steps, with a moment between them when a new library
  // could be made under the old id, which its old inbox address still names (found checking the fix, 2026-11-23).
  it('deleted by its writer, is marked in the same step its tables go, and the mark is all that’s left of it', async () => {
    const { create, requests, sql, library } = object()
    await create()
    await requests.setInbox(AUTH, 'K', 'a'.repeat(64), 'kept')
    let steps = 0
    const real = sql.transaction
    sql.transaction = (fn) => (steps++, real(fn))
    expect((await requests.wipe(AUTH)).status).toBe(200)
    expect(steps).toBe(1)
    expect(sql.all('SELECT k, v FROM meta')).toEqual([{ k: 'gone', v: 1 }])
    expect(library.leftover()).toBe(false)
    // Woken again, the same.
    expect((await libraryRequests(new Library(sql)).create(AUTH, NOW + 30 * DAY, 'subscription-a')).status).toBe(410)
  })

  // Its tables go with it now, and what came back to one after waiting found none: the second of two "Delete
  // everything" at once was answered with an error, where it had been told there's no library (found checking the fix, 2026-11-23).
  it('asked to delete everything twice at once, deletes once and tells the other there’s no library', async () => {
    const { library, clock, state, files } = object()
    const effects = {
      alarm: async (at: number | null) => void (state.alarm = at),
      home: 'its-home',
      // As the file store answers: after a moment.
      deleteFiles: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        await emptyFiles(files, 'its-home')
      },
    }
    const requests = libraryRequests(library, () => clock.now, effects)
    await requests.create(AUTH, NOW + 30 * DAY, 'subscription-a')
    const answers = await Promise.all([requests.wipe(AUTH), requests.wipe(AUTH)])
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 404])
    expect(library.gone()).toBe(true)
    // And what a signed request's signature is kept in is gone with it: asked, nothing.
    expect(library.taken('a-signature', 'a-request', clock.now)).toBe(false)
  })

  it('is left alone by its alarm when its writer deletes it while the alarm deletes its files', async () => {
    const { sql, library, clock, state, expires } = object()
    const alarms: (number | null)[] = []
    const effects: LibraryEffects = {
      alarm: async (at) => void alarms.push(at),
      home: 'its-home',
      deleteFiles: async () => void library.wipe(AUTH, clock.now),
    }
    await libraryRequests(library, () => clock.now, effects).create(AUTH, expires, 'subscription-a')
    clock.now = yearOn(expires)
    alarms.length = 0
    let steps = 0
    const real = sql.transaction
    sql.transaction = (fn) => (steps++, real(fn))
    await retireLibrary(library, clock.now, effects)
    expect(library.gone()).toBe(true)
    // Deleted the once, by its writer: the alarm found it done, and wrote nothing more.
    expect(steps).toBe(1)
    expect(alarms).toEqual([])
    expect(state.alarm).toBeNull()
  })

  // Asked first whether the code is right (worker/sync), a lapsed library was refused what it takes without Plus.
  it('says whether a code is its own without Plus, when asked so, as for what only lets go', async () => {
    const { create, requests, clock, expires } = object()
    await create()
    clock.now = expires + GRACE_MS + DAY
    expect((await requests.authorise(AUTH)).status).toBe(402)
    expect((await requests.authorise(AUTH, false)).status).toBe(200)
    expect((await requests.authorise('b'.repeat(64), false)).status).toBe(401)
  })

  // Deleted at its date, it told no subscription: each went on listing its id (the server audit of 2026-11-23).
  it('is let go of by every subscription that paid for it, when it’s deleted', async () => {
    const { requests, clock, state, retire, released } = object()
    await requests.create(AUTH, NOW + 30 * DAY, 'subscription-a', 'the-library-id')
    await requests.entitle(AUTH, NOW + 20 * DAY, 'subscription-b', 'the-library-id')
    clock.now = state.alarm! - 1
    await retire()
    expect(released).toEqual([])
    clock.now = state.alarm!
    await retire()
    expect(state.deleted).toBe(true)
    expect(released).toEqual([['the-library-id', ['subscription-a', 'subscription-b']]])
  })

  // Told first, a subscription that couldn't be reached kept the library past its date; and a receipt that came
  // while they were told was answered as paid, and the library deleted all the same (the server audit of 2026-11-23).
  it('is deleted before they’re told, and whether or not they can be', async () => {
    const { library, clock, state, files } = object()
    const told: boolean[] = []
    const effects: LibraryEffects = {
      alarm: async (at) => void (state.alarm = at),
      home: 'its-home',
      deleteFiles: () => emptyFiles(files, 'its-home'),
      release: async () => {
        told.push(library.gone())
        throw new Error('The subscription is away')
      },
    }
    await libraryRequests(library, () => clock.now, effects).create(AUTH, NOW + 30 * DAY, 'subscription-a', 'the-library-id')
    clock.now = state.alarm!
    await retireLibrary(library, clock.now, effects)
    expect(told).toEqual([true])
    expect(state.deleted).toBe(true)
    expect(library.gone()).toBe(true)
  })

  it('told of its id by the App Store’s word of a renewal too', async () => {
    const { create, requests, clock, state, retire, released } = object()
    await create()
    await requests.paidTo(NOW + 60 * DAY, 'subscription-a', 'the-library-id')
    clock.now = state.alarm!
    await retire()
    expect(released).toEqual([['the-library-id', ['subscription-a']]])
  })

  it('counts a refund from before this was kept from the first time it’s seen, and only once', async () => {
    const { create, sql, requests, state, clock } = object()
    await create()
    sql.run("UPDATE meta SET v = 0 WHERE k = 'expires'")
    clock.now = NOW + 40 * DAY
    await requests.status(AUTH)
    expect(state.alarm).toBe(yearOn(NOW + 40 * DAY))
    clock.now = NOW + 80 * DAY
    await requests.status(AUTH)
    expect(state.alarm).toBe(yearOn(NOW + 40 * DAY))
  })

  it('takes its files out of the store before it goes, and no other library’s', async () => {
    const { create, requests, files, state, clock, retire, expires } = object()
    await create()
    files.kept.set('its-home/a', new Uint8Array(3))
    files.kept.set('its-home/b', new Uint8Array(3))
    files.kept.set('another-home/a', new Uint8Array(3))
    await requests.fileStored('a', 3)
    clock.now = yearOn(expires) + 1
    await retire()
    expect(state.deleted).toBe(true)
    expect([...files.kept.keys()]).toEqual(['another-home/a'])
  })

  it('is still there for the alarm to come again when the store fails, and goes then', async () => {
    const { create, files, state, clock, retire, expires } = object()
    await create()
    files.kept.set('its-home/a', new Uint8Array(3))
    const real = files.delete
    files.delete = async () => {
      throw new Error('The store is away')
    }
    clock.now = yearOn(expires) + 1
    await expect(retire()).rejects.toThrow('The store is away')
    expect(state.deleted).toBe(false)
    files.delete = real
    await retire()
    expect(state.deleted).toBe(true)
    expect(files.kept.size).toBe(0)
  })

  it('stays, without its files, when it’s paid for while they’re being deleted: a renewal still wins', async () => {
    const { create, requests, library, files, state, clock, retire, expires } = object()
    await create()
    files.kept.set('its-home/a', new Uint8Array(3))
    await requests.fileStored('a', 3)
    const later = expires + 400 * DAY
    const real = files.delete
    files.delete = async (names) => {
      library.entitle(AUTH, later, clock.now)
      await real(names)
    }
    clock.now = yearOn(expires) + 1
    await retire()
    expect(state.deleted).toBe(false)
    expect(state.alarm).toBe(yearOn(later))
    // Its files are gone from the store, and it says so: its devices send them again.
    expect(files.kept.size).toBe(0)
    expect(library.files(AUTH, clock.now)).toMatchObject({ files: [], bytes: 0 })
  })

  it('has no alarm once wiped, and a code asked for where there is no library stores none', async () => {
    const { create, requests, state } = object()
    await create()
    await requests.wipe(AUTH)
    expect(state.alarm).toBeNull()
    const none = object()
    await none.requests.status(AUTH)
    await none.requests.revoke('subscription-a')
    expect(none.state.alarm).toBeNull()
    expect(none.sql.all("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([])
  })
})

// New libraries are kept in the EU; asked first there, a library made
// before isn't found, and that has to leave nothing behind (worker/library findLibrary).
describe('Library asked for a code it has no library for', () => {
  it('answers 404 and stores nothing at all', async () => {
    const sql = sqlite()
    const library = new Library(sql)
    const requests = libraryRequests(library, () => NOW)
    expect((await requests.changes(AUTH, 0)).status).toBe(404)
    expect((await requests.status(AUTH)).status).toBe(404)
    expect((await requests.revoke('subscription-a')).status).toBe(200)
    expect(sql.all("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([])
    library.create(AUTH, NOW + 1000, NOW)
    expect(library.status(AUTH, NOW).entitled).toBe(true)
  })
})

// Signed sync: a key made from the sync code signs each request, and the
// server keeps only its public half. Switched on, the old way is refused,
// so a request caught in passing can't be sent again to read or delete.
describe('Library and signed requests', () => {
  const base64url = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64url')
  const ID = '0'.repeat(32)
  async function signer() {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const publicKey = base64url(await crypto.subtle.exportKey('raw', pair.publicKey))
    const proof = async (method: string, path: string, time = NOW) => {
      const message = signedMessage({ id: ID, method, path, time, bodyHash: 'e3b0' })
      return { message, time, signature: base64url(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(message))) }
    }
    return { publicKey, proof }
  }

  it('takes a signed request once its key is known, and nothing else signed', async () => {
    const library = entitled()
    const requests = libraryRequests(library, () => NOW)
    const key = await signer()
    const other = await signer()
    expect(await requests.status(await key.proof('GET', '/v1/status'))).toMatchObject({ status: 401, body: { code: 'unenrolled' } })
    expect((await requests.enroll(AUTH, key.publicKey)).status).toBe(200)
    expect(library.status(AUTH, NOW)).toMatchObject({ signedOnly: false })
    expect(await requests.status(await key.proof('GET', '/v1/status'))).toMatchObject({ status: 200 })
    expect((await requests.status(await other.proof('GET', '/v1/status'))).status).toBe(401)
    expect((await requests.status(await key.proof('GET', '/v1/status', NOW - 10 * 60_000))).status).toBe(401)
    const tampered = { ...(await key.proof('GET', '/v1/status')), message: 'something else' }
    expect((await requests.status(tampered)).status).toBe(401)
  })

  it('answers 404 to a signed request for a code it has no library for, as to any', async () => {
    const key = await signer()
    expect((await libraryRequests(new Library(sqlite()), () => NOW).status(await key.proof('GET', '/v1/status'))).status).toBe(404)
  })

  it('refuses the old way once signed sync is required, which only a signed request can say', async () => {
    const requests = libraryRequests(entitled(), () => NOW)
    const key = await signer()
    await requests.enroll(AUTH, key.publicKey)
    expect((await requests.requireSigned(AUTH, true)).status).toBe(403)
    expect((await requests.requireSigned(await key.proof('POST', '/v1/signed-only'), true)).status).toBe(200)
    const another = (await signer()).publicKey
    for (const refused of [requests.changes(AUTH, 0), requests.push(AUTH, [{ k: 'x', p: 'y' }]), requests.wipe(AUTH), requests.entitle(AUTH, NOW + 1000), requests.enroll(AUTH, another)]) {
      expect(await refused).toMatchObject({ status: 401, body: { error: expect.stringContaining('signed requests only') } })
    }
    expect((await requests.changes(await key.proof('GET', '/v1/changes?since=0'), 0)).status).toBe(200)
    expect((await requests.requireSigned(await key.proof('POST', '/v1/signed-only'), false)).status).toBe(200)
    expect((await requests.changes(AUTH, 0)).status).toBe(200)
  })
})
