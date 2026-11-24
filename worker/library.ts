import { answered, ok, Refused, type Call } from './answer'
import { extendsPaid, KEPT_MONTHS, keptTo, paidThrough } from './paid'
import { inboxCheck, inSignedWindow, verifySignature } from './signing'
import { FILES_LIMIT, INBOX_BYTES, INBOX_DAILY, INBOX_DAYS, INBOX_WAITING, UNENROLLED, utcDay, type FileList, type Inbox, type PushResult, type Status, type Wire } from './wire.mjs'

/**
 * One sync library: everything the server holds for one sync code. It lives
 * in its own Durable Object, which handles one request at a time, so the
 * change counter and the records can never interleave.
 *
 * The server stores ciphertext it cannot read, under keys it cannot read
 * either (the client hashes them). What it can see: how many records, how big
 * to within a size bucket (src/sync/crypto `padded`), and when they changed.
 *
 * Its inbox, if it has one (worker/inbox): the public half of a key its
 * devices made, the hash of the secret in the inbox's address, and the posts
 * waiting for a device, each sealed with that key before it gets here.
 *
 * Its files (worker/files) are too big to keep here: this holds which there
 * are and how big each is sealed, so their room is counted where requests
 * come one at a time, and the bytes are in the file store under this
 * object's own name there.
 */

/** Just what this file needs from SQLite; the Durable Object and the tests each supply one. */
export type Sql = {
  all(query: string, ...args: SqlValue[]): Record<string, SqlValue>[]
  run(query: string, ...args: SqlValue[]): void
  transaction<T>(fn: () => T): T
}
type SqlValue = string | number | null

export const LIBRARY_LIMIT = 1_000_000_000 // bytes stored, and we mean it
const FILES_FULL = 'This library’s files are full.'
const LIBRARY_GONE = 'That code’s library was deleted from the server. Turn sync on again for a new code.'
/**
 * What a file counts for at the least, sealed: so many tiny files can't fill
 * the store with more objects than its room says (the security review of
 * 2026-11-13), and deleting a library's files stays a few thousand requests.
 */
export const FILE_FLOOR = 4096
/** A file's row: kept and listed; booked by `fileRoom` while it's sent, counted and not listed; or going with the library's files (`emptied`), counted and not listed. */
const STORED = 0
const SENDING = 1
const LEAVING = 2
/** Said of no library, no inbox and a wrong address alike: an address that's wrong learns nothing of what's here. */
const NO_INBOX = 'No inbox at that address.'
const INBOX_MS = INBOX_DAYS * 86_400_000
/** Posts in one answer to a device. */
const INBOX_PAGE = 50
/** What a record costs besides its payload: its key, and about this much for its row and index entry. */
const ROW_OVERHEAD = 100
const CHUNK = 900_000 // a row stays under SQLite-in-Durable-Objects' 2 MB cap
const PAGE_BYTES = 8_000_000
/** How long a library outlives what paid for it, grace period and all, before it is deleted (site/privacy.html): worker/paid `keptTo`. */
export { KEPT_MONTHS }

/**
 * A request whose signature checked out (libraryRequests), standing in for
 * the code's hash. It can't come from outside: a Durable Object's callers send
 * only what can be copied, and a symbol can't be.
 */
const SIGNED: unique symbol = Symbol('signed')
type Auth = string | typeof SIGNED

/**
 * How long a file goes with no device naming it (`Library.namedFiles`) before the Worker's check takes it for one
 * nothing uses: as long as the server keeps a document's past versions, which may be all that names it.
 */
export const UNUSED_DAYS = 90
/**
 * And only in a library a device has named all its files for this lately, and devices have gone on doing so for
 * UNUSED_DAYS with never a gap this long: one whose devices have gone quiet, or include a Nib from before they
 * said, has had nothing to say a file is still used.
 */
export const NAMED_LATELY_DAYS = 7
const DAY_MS = 86_400_000

/** The longest a key is held as being cleared by the Worker's check (`Library.unlisted`): as long as one run of it may last. */
export const SWEEP_HOLD_MS = 15 * 60_000
const BEING_CLEARED = 'An old copy of that file is being cleared from the server. It can be sent again in a moment.'


/** How long a signed request's signature is remembered: both sides of the window its time must fall in (worker/signing). */
const REPLAY_MS = 10 * 60_000

export class Library {
  private sql: Sql
  private limit: number
  private filesLimit: number
  /** Its files are being deleted from the store (`emptied`): one that arrives meanwhile isn't taken. */
  private emptying = false
  /**
   * Made only once a library is (create): a code asked for where it has none,
   * as the EU is first for a library made before libraries were kept there
   * (`findLibrary`), stores nothing at all.
   */
  private made: boolean

  constructor(sql: Sql, limit = LIBRARY_LIMIT, filesLimit = FILES_LIMIT) {
    this.sql = sql
    this.limit = limit
    this.filesLimit = filesLimit
    this.made = sql.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").length > 0
    if (this.made && !this.gone()) this.tables()
  }

  private tables() {
    const sql = this.sql
    sql.run('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v)')
    sql.run('CREATE TABLE IF NOT EXISTS records (k TEXT PRIMARY KEY, seq INTEGER NOT NULL, deleted INTEGER NOT NULL, size INTEGER NOT NULL)')
    // Let go of past the history kept (expire). Added to libraries made before it.
    if (!sql.all('PRAGMA table_info(records)').some((column) => column.name === 'expired')) {
      sql.run('ALTER TABLE records ADD COLUMN expired INTEGER NOT NULL DEFAULT 0')
    }
    sql.run('CREATE INDEX IF NOT EXISTS records_seq ON records (seq)')
    sql.run('CREATE TABLE IF NOT EXISTS chunks (k TEXT NOT NULL, n INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (k, n))')
    sql.run('CREATE TABLE IF NOT EXISTS files (k TEXT PRIMARY KEY, size INTEGER NOT NULL)')
    // Booked before it's sent, and going before it's gone (`fileRoom`, `emptied`). Added to libraries made before it.
    if (!sql.all('PRAGMA table_info(files)').some((column) => column.name === 'state')) {
      sql.run(`ALTER TABLE files ADD COLUMN state INTEGER NOT NULL DEFAULT ${STORED}`)
    }
    // When a device last said a document of its own uses it (`namedFiles`). Added to libraries made before it.
    if (!sql.all('PRAGMA table_info(files)').some((column) => column.name === 'named')) sql.run('ALTER TABLE files ADD COLUMN named INTEGER')
    sql.run('CREATE TABLE IF NOT EXISTS inbox (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, p TEXT NOT NULL)')
    // What each subscription has itself paid this library to (`pays`). Added to libraries made before it.
    sql.run('CREATE TABLE IF NOT EXISTS paid (subscription TEXT PRIMARY KEY, until INTEGER NOT NULL)')
    // Keys the Worker's check is clearing from the store just now (`unlisted`). Added to libraries made before it.
    sql.run('CREATE TABLE IF NOT EXISTS sweeping (k TEXT NOT NULL, run TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (k, run))')
    // Signed requests that change something, lately taken (`taken`). Added to libraries made before it.
    sql.run('CREATE TABLE IF NOT EXISTS taken (signature TEXT PRIMARY KEY, request TEXT NOT NULL, at INTEGER NOT NULL)')
  }

  private get(key: string): SqlValue | undefined {
    return this.made ? this.sql.all('SELECT v FROM meta WHERE k = ?', key)[0]?.v : undefined
  }

  private set(key: string, value: SqlValue) {
    this.sql.run('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', key, value)
  }

  /**
   * Every call names the library by its code's hash, a wrong code a 401, or
   * comes signed (libraryRequests). Once signed sync is required, the hash
   * alone, which a request carries, opens nothing.
   */
  authorise(auth: Auth, now: number, { needPlus = true } = {}) {
    const stored = this.get('auth')
    if (stored === undefined) throw new Refused(404, 'No library for that code.')
    if (auth !== SIGNED) {
      if (stored !== auth) throw new Refused(401, 'That code does not match this library.')
      if (this.get('signedOnly') === 1) {
        throw new Refused(401, 'This library syncs by signed requests only. Update Nib on this device, on iOS 17 or later.')
      }
    }
    if (needPlus && !this.entitled(now)) throw new Refused(402, 'Nib Plus is not active for this library.')
  }

  private entitled(now: number): boolean {
    const expires = this.get('expires')
    return typeof expires === 'number' && paidThrough(expires, now)
  }

  /**
   * A new library, for a fresh code, paid for by a verified subscription. The
   * only way a library comes into being: renewing or joining never creates
   * one, so a mistyped code or a library wiped from another device is a 404,
   * not a new empty library that quietly takes the writing elsewhere.
   */
  create(auth: Auth, expiresAt: number, now: number, subscription?: string, id?: string): Status {
    if (!this.made) {
      this.tables()
      this.made = true
    }
    // Deleted (`wipe`, `bury`), never made again: the id is in its inbox's address, which services may still post to (the security review of 2026-11-13).
    if (this.gone()) throw new Refused(410, LIBRARY_GONE)
    if (this.get('auth') === undefined && typeof auth === 'string') this.set('auth', auth)
    return this.entitle(auth, expiresAt, now, subscription, id)
  }

  /**
   * A verified App Store subscription for an existing library. Only ever
   * extends: a stale receipt from a second device must not cut short a renewal
   * the first one already reported. `subscription` is the hash of the
   * purchase's original transaction id, which a library made before these
   * were kept picks up here, and syncs without meanwhile.
   */
  entitle(auth: Auth, expiresAt: number, now: number, subscription?: string, id?: string): Status {
    this.authorise(auth, now, { needPlus: false })
    if (id) this.set('id', id)
    if (subscription) this.pays(subscription, expiresAt)
    if (extendsPaid(this.get('expires'), expiresAt)) this.set('expires', expiresAt)
    if (subscription) this.set('subscription', subscription)
    return this.status(auth, now)
  }

  /**
   * `subscription` has paid this library to `until`, or further if it had
   * already: each one's own, so a refund takes away what that one paid and
   * no more (`revoke`). The one on record in a library from before these
   * were kept is given, first, what was paid then.
   */
  private pays(subscription: string, until: number) {
    const [named, expires] = [this.get('subscription'), this.get('expires')]
    if (typeof named === 'string' && typeof expires === 'number' && this.sql.all('SELECT 1 FROM paid LIMIT 1').length === 0) {
      this.sql.run('INSERT INTO paid (subscription, until) VALUES (?, ?)', named, expires)
    }
    this.sql.run('INSERT INTO paid (subscription, until) VALUES (?, ?) ON CONFLICT (subscription) DO UPDATE SET until = MAX(until, excluded.until)', subscription, until)
  }

  /**
   * `subscription` was refunded or revoked: what it paid for is gone. The
   * library runs on only as far as another has itself paid it, as one
   * household library used from two Apple IDs is; with none, no more syncing
   * until a current one entitles it again. Not by whichever sent its receipt
   * last: a second Apple ID's, a trial's or one long expired, sent for a
   * library, kept a refunded year syncing to its end.
   */
  revoke(subscription: string, now = Date.now()) {
    if (this.get('auth') === undefined) return
    const paid = this.sql.all('SELECT 1 FROM paid WHERE subscription = ?', subscription).length > 0
    // Never one that paid for it; nor, in a library from before each one's was kept, the one on record.
    if (!paid && this.get('subscription') !== subscription) return
    this.sql.run('DELETE FROM paid WHERE subscription = ?', subscription)
    const other = this.sql.all('SELECT subscription, until FROM paid ORDER BY until DESC, subscription LIMIT 1')[0]
    this.set('expires', other ? Number(other.until) : 0)
    if (other) this.set('subscription', String(other.subscription))
    // Always: what another paid to may be long past, and isn't when this library stopped being paid for (`deletesAt`).
    this.set('revoked', now)
  }

  /**
   * What the App Store says `subscription` has paid to, for a library it pays for, whether or not a device has
   * opened it since. Only ever extends.
   */
  paidTo(expiresAt: number, subscription?: string, id?: string) {
    if (!this.exists()) return
    if (id) this.set('id', id)
    if (subscription) this.pays(subscription, expiresAt)
    if (extendsPaid(this.get('expires'), expiresAt)) this.set('expires', expiresAt)
  }

  /**
   * Every subscription that has paid for this library, the one on record among them: each keeps it in its own
   * list (worker/subscriber), and each is told when the library is deleted (`wipe`, `retireLibrary`). Only the
   * one that sent its receipt last was: another in the household kept the deleted library's id for good, and
   * counted it against its five for sixty days (the server audit of 2026-11-23).
   */
  payers(): string[] {
    if (!this.exists()) return []
    const named = this.get('subscription')
    const paid = this.sql.all('SELECT subscription FROM paid').map((row) => String(row.subscription))
    return [...new Set([...paid, ...(typeof named === 'string' ? [named] : [])])].sort()
  }

  /**
   * This library's own id, as the subscriptions that pay for it list it: told with each receipt and each word
   * from the App Store (`entitle`, `paidTo`), since its object can't know the name it is reached by when its
   * alarm wakes it. Null in one not paid for since this was kept.
   */
  id(): string | null {
    const id = this.get('id')
    return typeof id === 'string' ? id : null
  }

  /**
   * When this library is deleted if nothing pays for it again: KEPT_MONTHS
   * past the end of what was paid for and its grace. A refund leaves no end
   * date of its own, so it counts from when it came, or from what another
   * subscription has paid to if that is later: never from one's old date
   * alone, which set a household's library to be deleted the moment the
   * other's purchase was refunded. A refund from before that was kept
   * counts from the first time it's asked. Null for no library.
   */
  deletesAt(now: number): number | null {
    if (!this.exists()) return null
    const [expires, revoked] = [this.get('expires'), this.get('revoked')]
    const paid = typeof expires === 'number' && expires > 0 ? expires : null
    let ended = paid === null ? revoked : typeof revoked === 'number' ? Math.max(paid, revoked) : paid
    if (typeof ended !== 'number') this.set('revoked', (ended = now))
    return keptTo(ended)
  }

  /**
   * Everything deleted but the mark that a library was here (`wipe`, `retireLibrary`): any request still to
   * come finds nothing, and makes nothing, and no new library is ever made under its id. A new code's library has
   * a new id (src/sync `create`), so only someone given its old inbox address would ask, to have the posts still
   * sent there (the security review of 2026-11-13).
   *
   * In one step: its tables dropped, and `meta` left holding the mark alone. The object's whole storage was
   * deleted and the mark put back after, two steps with a moment between them when there was none (the server
   * audit of 2026-11-23). Dropped, not emptied: an emptied table is kept, for every library ever deleted. The
   * database shrinks as its rows go, so nothing more is gained by deleting the object's storage (measured on
   * Cloudflare's local runtime: 3.6 MB to 24 KB, against 12 KB).
   */
  bury() {
    this.sql.transaction(() => {
      for (const table of ['records', 'chunks', 'files', 'inbox', 'paid', 'taken', 'sweeping']) this.sql.run(`DROP TABLE IF EXISTS ${table}`)
      this.sql.run('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v)')
      this.sql.run('DELETE FROM meta')
      this.sql.run("INSERT INTO meta (k, v) VALUES ('gone', 1)")
    })
    this.made = true
  }

  /** Whether a library was here and was deleted (`wipe`, `bury`). */
  gone(): boolean {
    return this.get('gone') === 1
  }

  /** Whether one deleted still has its emptied tables: wiped before a wipe dropped them (`bury`). */
  leftover(): boolean {
    return this.gone() && this.sql.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'records'").length > 0
  }

  status(auth: Auth, now: number): Status {
    this.authorise(auth, now, { needPlus: false })
    const expires = this.get('expires')
    return {
      entitled: this.entitled(now),
      expiresAt: typeof expires === 'number' ? expires : null,
      bytes: this.bytes(),
      signedOnly: this.get('signedOnly') === 1,
    }
  }

  exists(): boolean {
    return this.get('auth') !== undefined
  }

  /** The public half of the key signed requests are checked against. */
  signKey(): string | undefined {
    const key = this.get('sign')
    return typeof key === 'string' ? key : undefined
  }

  /**
   * The key for signed requests, from a device that has proved it holds it
   * (worker/sync). By the code's hash only till signed sync is required, and
   * only where there's none yet, or the same again: every device derives the
   * one key from the code (src/sync/crypto), so another is no device's. The
   * hash, which a request caught in passing carries, put any key in its
   * place, and that key could then require signed requests: the writer's own
   * devices refused for good.
   */
  enroll(auth: Auth, key: string, now: number): { enrolled: true } {
    this.authorise(auth, now, { needPlus: false })
    const held = this.signKey()
    if (auth !== SIGNED && held !== undefined && held !== key) throw new Refused(409, 'This library has its key already, and that isn’t it.')
    this.set('sign', key)
    return { enrolled: true }
  }

  /** Signed requests only, or not: said by a signed request, never by the code's hash, which a request caught in passing would carry. */
  requireSigned(auth: Auth, on: boolean, now: number): Status {
    if (auth !== SIGNED) throw new Refused(403, 'Only a signed request can change how this library is reached.')
    this.authorise(auth, now, { needPlus: false })
    this.set('signedOnly', on ? 1 : 0)
    return this.status(auth, now)
  }

  /**
   * Bytes stored. Kept as it goes (push), so a push needn't add up every
   * record to know it; one from before that is added up once, here.
   */
  private bytes(): number {
    const kept = this.get('bytes')
    if (typeof kept === 'number') return kept
    const total = Number(this.sql.all('SELECT COALESCE(SUM(size), 0) AS total FROM records')[0].total)
    this.set('bytes', total)
    return total
  }

  /** Changes after `since`, oldest first. `seq` is where to resume from. `inbox`: how many posts wait in its inbox, said only when some do, so a device asks for them only then. */
  changes(auth: Auth, since: number, now: number, limit = 500, names = false): { records: Wire[]; seq: number; more: boolean; inbox?: number } {
    this.authorise(auth, now)
    // A device that doesn't say which files it uses (`namedFiles`), a Nib from before they did: kept, a day at a
    // time, so that none of the library's files is taken for unused while such a device still syncs it (`unlisted`).
    if (!names && Number(this.get('quietPull') ?? 0) <= now - DAY_MS) this.set('quietPull', now)
    const rows = this.sql.all('SELECT k, seq, deleted FROM records WHERE seq > ? AND expired = 0 ORDER BY seq LIMIT ?', since, limit + 1)
    const records: Wire[] = []
    let bytes = 0
    for (const row of rows.slice(0, limit)) {
      const record: Wire = { k: String(row.k), s: Number(row.seq) }
      const chunks = this.sql.all('SELECT data FROM chunks WHERE k = ? ORDER BY n', row.k)
      const payload = chunks.map((chunk) => String(chunk.data)).join('')
      if (row.deleted) record.d = 1
      // A delete passes on the seal its device put on it, if it came with one.
      if (!row.deleted || payload) record.p = payload
      bytes += payload.length
      records.push(record)
      // One oversized page would blow the response limit; the rest can wait
      // for the next request. Always at least one record, or nothing moves.
      if (bytes > PAGE_BYTES) break
    }
    const more = records.length < rows.length
    const waiting = Number(this.sql.all('SELECT COUNT(*) AS n FROM inbox')[0].n)
    return { records, seq: records.at(-1)?.s ?? since, more, ...(waiting ? { inbox: waiting } : {}) }
  }

  /**
   * Compare-and-set per record: a write lands only if the client saw the
   * latest version (`b`). Otherwise it is a conflict and the client pulls,
   * merges and tries again — the server never picks a winner, because it
   * cannot read either side.
   */
  push(auth: Auth, records: Wire[], now: number): PushResult[] {
    this.authorise(auth, now)
    return this.sql.transaction(() => {
      const before = this.bytes()
      let total = before
      const results = records.map((record): PushResult => {
        const current = this.sql.all('SELECT seq, size FROM records WHERE k = ?', record.k)[0]
        const currentSeq = current ? Number(current.seq) : 0
        if ((record.b ?? 0) !== currentSeq) return { k: record.k, conflict: currentSeq }
        // Bytes stored: the payload (base64, one byte a character), the key
        // twice over in row and index, and the row itself. A delete keeps its
        // row, and its seal.
        const payload = record.p ?? ''
        const size = payload.length + record.k.length + ROW_OVERHEAD
        const next = total - Number(current?.size ?? 0) + size
        if (next > this.limit) return { k: record.k, error: 'full' }
        total = next
        const seq = Number(this.get('seq') ?? 0) + 1
        this.set('seq', seq)
        this.sql.run(
          'INSERT INTO records (k, seq, deleted, size) VALUES (?, ?, ?, ?) ON CONFLICT (k) DO UPDATE SET seq = excluded.seq, deleted = excluded.deleted, size = excluded.size, expired = 0',
          record.k,
          seq,
          record.d ? 1 : 0,
          size,
        )
        this.sql.run('DELETE FROM chunks WHERE k = ?', record.k)
        for (let n = 0; n * CHUNK < payload.length; n++) {
          this.sql.run('INSERT INTO chunks (k, n, data) VALUES (?, ?, ?)', record.k, n, payload.slice(n * CHUNK, (n + 1) * CHUNK))
        }
        return { k: record.k, s: seq }
      })
      if (total !== before) this.set('bytes', total)
      return results
    })
  }

  /**
   * Lets go of versions past the history the server keeps, as a device asks
   * (sync/engine expireHistory): the server can't tell one record from
   * another. Their sealed text goes; their rows stay, so a delete still
   * lands; and they're left out of `changes`, so a new device doesn't fetch
   * them while those that have them keep them. Returns the keys let go of.
   */
  expire(auth: Auth, keys: string[], now: number): string[] {
    // Without Plus too, as a file is taken off and an inbox ended: it only lets go. Needing it, a lapsed library
    // kept every version it had, past the 90 days the policy says, till it was deleted (the server audit of 2026-11-23).
    this.authorise(auth, now, { needPlus: false })
    return this.sql.transaction(() => {
      const before = this.bytes()
      let total = before
      const done: string[] = []
      for (const k of keys) {
        const row = this.sql.all('SELECT size, deleted, expired FROM records WHERE k = ?', k)[0]
        if (!row || row.deleted || row.expired) continue
        const size = k.length + ROW_OVERHEAD
        this.sql.run('UPDATE records SET expired = 1, size = ? WHERE k = ?', size, k)
        this.sql.run('DELETE FROM chunks WHERE k = ?', k)
        total += size - Number(row.size)
        done.push(k)
      }
      if (total !== before) this.set('bytes', total)
      return done
    })
  }

  /** What its files take in the store, sealed, each FILE_FLOOR at the least, but for the one under `key`. Booked and going ones too. */
  private fileBytes(but = ''): number {
    return Number(this.sql.all('SELECT COALESCE(SUM(MAX(size, ?)), 0) AS total FROM files WHERE k <> ?', FILE_FLOOR, but)[0].total)
  }

  /**
   * Whether a file of `size` may be sent under `key`, asked before any of it
   * is taken, so one there's no room for is never stored; and if so, its room
   * booked. Counted from now, then, not from once it's stored: a request cut
   * off between the store taking it and `storedFile` leaves it counted, never
   * stored and uncounted (the security review of 2026-11-13). One sent again
   * keeps its row: a kept one listed as it is till the new one's stored, one
   * still booked or going at the larger size.
   */
  fileRoom(auth: Auth, key: string, size: number, now: number) {
    this.authorise(auth, now)
    if (this.emptying) throw new Refused(404, 'No library for that code.')
    // The device sends it again at its next look (src/sync/files).
    if (this.beingSwept(key, now)) throw new Refused(409, BEING_CLEARED)
    if (this.fileBytes(key) + Math.max(size, FILE_FLOOR) > this.filesLimit) throw new Refused(507, FILES_FULL)
    this.sql.run(`INSERT INTO files (k, size, state) VALUES (?, ?, ${SENDING}) ON CONFLICT (k) DO UPDATE SET size = CASE WHEN state = ${STORED} THEN size ELSE MAX(size, excluded.size) END`, key, size)
  }

  /** The store didn't take a file sent under `key`: its booking goes, unless it was there already, kept or going. */
  fileFailed(key: string) {
    if (this.exists()) this.sql.run(`DELETE FROM files WHERE k = ? AND state = ${SENDING}`, key)
  }

  /**
   * A file is in the store, `size` bytes of it: counted here. From the
   * Worker alone, once the store has it (worker/files). Refused when the
   * library has gone or is going meanwhile, or two sent at once have come to
   * more than there's room for: whoever asked then deletes it from the store.
   */
  storedFile(key: string, size: number, now = Date.now()) {
    if (!this.exists() || this.emptying) throw new Refused(404, 'No library for that code.')
    // Booked before the check asked, its booking gone since (another send of it failed), and stored as the check
    // deletes: not counted, so whoever asked deletes it, and its device sends it again.
    if (this.beingSwept(key, now)) throw new Refused(409, BEING_CLEARED)
    if (this.fileBytes(key) + Math.max(size, FILE_FLOOR) > this.filesLimit) {
      // What was under this key before was written over, and goes with it.
      this.sql.run('DELETE FROM files WHERE k = ?', key)
      throw new Refused(507, FILES_FULL)
    }
    // Just sent: used, as of now.
    this.sql.run(`INSERT INTO files (k, size, state, named) VALUES (?, ?, ${STORED}, ?) ON CONFLICT (k) DO UPDATE SET size = excluded.size, state = ${STORED}, named = excluded.named`, key, size, now)
  }

  /**
   * Those of `keys` this library doesn't account for in the store, in any state: kept, booked while it's sent, or
   * going. For the Worker's own check of the store (worker/filecheck), which deletes them. For a `run` of the
   * check that is going to delete, each is held as being cleared by that run till it says it's done (`swept`), and
   * none can be sent or counted meanwhile (`fileRoom`, `storedFile`): sent in the moment between the check asking
   * and deleting, a file was stored, counted, and then deleted from under its library, which went on listing it
   * (found checking the check, 2026-11-23). One another run holds isn't given to this one. Held in the library's
   * own storage, so that it outlasts the object being put to sleep, and no longer than a run can last.
   */
  unlisted(keys: string[], now: number, run?: string): { keys: string[]; unused: string[] } {
    return this.sql.transaction(() => {
      this.sql.run('DELETE FROM sweeping WHERE at <= ?', now - SWEEP_HOLD_MS)
      const rows = new Map(keys.map((key) => [key, this.sql.all('SELECT state, named FROM files WHERE k = ?', key)[0]]))
      const free = keys.filter((key) => !rows.get(key) && !this.beingSwept(key, now))
      // Those it does account for that no device has named in UNUSED_DAYS. Only where its devices have gone on
      // saying which they use for all that time, with never a week's gap, and none that doesn't say has synced
      // in it: the first device back after a long quiet, saying what it uses, had every file only another used
      // deleted that night; and so had a Nib that says, beside one from before that never does (found checking
      // the check, 2026-11-23).
      const long = now - UNUSED_DAYS * DAY_MS
      const lately = Number(this.get('filesNamed') ?? 0) > now - NAMED_LATELY_DAYS * DAY_MS && Number(this.get('namedSince') ?? Infinity) <= long && Number(this.get('quietPull') ?? 0) <= long
      const unused = keys.filter((key) => {
        const row = rows.get(key)
        return lately && row && row.state === STORED && typeof row.named === 'number' && row.named <= long && !this.beingSwept(key, now)
      })
      if (run !== undefined) {
        // Forgotten here before they leave the store: stopped between the two, the check finds them next time as files no library lists.
        for (const key of unused) this.sql.run('DELETE FROM files WHERE k = ?', key)
        for (const key of [...free, ...unused]) this.sql.run('INSERT OR REPLACE INTO sweeping (k, run, at) VALUES (?, ?, ?)', key, run, now)
      }
      return { keys: free, unused }
    })
  }

  /**
   * A device says which files its documents use, in what they hold or in their history, by their keys: each is
   * named as of now. `done`: that's all of them, said in as many goes as it took. What no device names for
   * UNUSED_DAYS, in a library whose devices have gone on saying for as long, is one nothing uses, and the Worker's
   * check deletes it (`unlisted`): only a device can tell, since a document is sealed and the server can't see
   * which files it uses.
   * A file a library's devices no longer used stayed on the server till the library was deleted (the server audit
   * of 2026-11-23, L13). One from before this was kept is taken as named when its library is first told anything.
   */
  namedFiles(auth: Auth, keys: string[], done: boolean, now: number): { named: true } {
    this.authorise(auth, now)
    this.sql.transaction(() => {
      // Once: the rows from before this was kept.
      if (this.get('filesDated') === undefined) {
        this.sql.run('UPDATE files SET named = ? WHERE named IS NULL', now)
        this.set('filesDated', 1)
      }
      // Half a day is near enough: named at every look by every device, each file was written each time.
      for (const key of keys) this.sql.run('UPDATE files SET named = ? WHERE k = ? AND (named IS NULL OR named < ?)', now, key, now - DAY_MS / 2)
      if (done) {
        // Since when they've gone on saying: from now, if it's the first time, or the first in more than a week.
        if (Number(this.get('filesNamed') ?? 0) <= now - NAMED_LATELY_DAYS * DAY_MS) this.set('namedSince', now)
        this.set('filesNamed', now)
      }
    })
    return { named: true }
  }

  /** A run of the check has done with these keys (`unlisted`): they can be sent again. Only its own. */
  swept(keys: string[], run: string) {
    if (!this.exists()) return
    for (const key of keys) this.sql.run('DELETE FROM sweeping WHERE k = ? AND run = ?', key, run)
  }

  /** Whether a run of the check is clearing a file by this key from the store just now. */
  private beingSwept(key: string, now: number): boolean {
    return this.sql.all('SELECT 1 FROM sweeping WHERE k = ? AND at > ?', key, now - SWEEP_HOLD_MS).length > 0
  }

  /**
   * A file this library lists wasn't in the store when it was asked for, after `asked` (worker/files): no longer
   * listed, nor counted. Not one on its way in; nor one stored or named at `asked` or since, which landed while
   * the store was asked and is there. `asked` is by this library's own clock (`authorise`), as `named` is: by the
   * Worker's, one ahead of this forgot a file that had just landed.
   */
  fileMissing(key: string, asked: number) {
    if (this.exists()) this.sql.run(`DELETE FROM files WHERE k = ? AND state = ${STORED} AND (named IS NULL OR named < ?)`, key, asked)
  }

  /** Which files the server has, for a device to know what to send and what to fetch. */
  files(auth: Auth, now: number): FileList {
    this.authorise(auth, now)
    const files = this.sql.all(`SELECT k, size FROM files WHERE state = ${STORED}`).map((row) => ({ k: String(row.k), size: Number(row.size) }))
    return { files, bytes: this.fileBytes(), limit: this.filesLimit }
  }

  /** A file is no longer counted: whoever asked then deletes it from the store. Without Plus too, as the whole library can be deleted without it. */
  removeFile(auth: Auth, key: string, now: number) {
    this.authorise(auth, now, { needPlus: false })
    this.sql.run('DELETE FROM files WHERE k = ?', key)
  }

  /**
   * Its files, all deleted from the store by `act`. They stop being listed
   * first, so if that fails part-way the list never names one that may be
   * gone; but they're counted till it's done, so a failure leaves no file
   * stored and uncounted (the security review of 2026-11-13). None is taken
   * in while it runs, or one stored after the store was listed would outlive
   * the library.
   */
  async emptied(act: () => Promise<void>) {
    this.emptying = true
    try {
      this.sql.run(`UPDATE files SET state = ${LEAVING}`)
      await act()
      // Unless the library went meanwhile, its tables with it (`bury`): asked to delete everything twice at once,
      // the later of the two found no table here.
      if (this.exists()) this.sql.run('DELETE FROM files')
    } finally {
      this.emptying = false
    }
  }

  /**
   * An inbox for this library, or its key or its address changed: the public
   * half of the key posts are sealed with, and the hash of the secret in its
   * address. A new address stops the old one at once; what's waiting stays.
   * `kept`: what its devices keep with it, sealed by one of them, to be given
   * back to any of them: the private half of the key and the secret itself,
   * neither of which the server can read there.
   */
  setInbox(auth: Auth, key: string, address: string, kept: string, now: number): { on: true } {
    this.authorise(auth, now)
    // A new address starts its day afresh: the old one's count stayed, so the address made to get away from one
    // that had leaked, and been sent the day's 200 posts, took none itself till midnight (the server audit of 2026-11-23).
    if (this.get('inboxAddress') !== address) this.sql.run("DELETE FROM meta WHERE k IN ('inboxDay', 'inboxCount')")
    this.set('inboxKey', key)
    this.set('inboxAddress', address)
    this.set('inboxKept', kept)
    return { on: true }
  }

  /** No inbox any more: its key, its address and what was waiting, gone. Without Plus too, as the library itself can be deleted without it. */
  endInbox(auth: Auth, now: number): { on: false } {
    this.authorise(auth, now, { needPlus: false })
    this.sql.transaction(() => {
      this.sql.run("DELETE FROM meta WHERE k IN ('inboxKey', 'inboxAddress', 'inboxKept', 'inboxDay', 'inboxCount')")
      this.sql.run('DELETE FROM inbox')
    })
    return { on: false }
  }

  /** How many posts have come today (UTC). */
  private postsToday(now: number): number {
    return this.get('inboxDay') === utcDay(now) ? Number(this.get('inboxCount')) : 0
  }

  /**
   * The key to seal a post with, for whoever holds the inbox's address: its
   * secret's hash is the only credential. Asked before a post is read, so one
   * there's no place for never is. Plus must be current, as for sync.
   */
  inboxFor(address: string, now: number): string {
    const key = this.get('inboxKey')
    if (typeof key !== 'string' || this.get('inboxAddress') !== address) throw new Refused(404, NO_INBOX)
    if (!this.entitled(now)) throw new Refused(402, 'Nib Plus is not active for this library.')
    this.expireInbox(now)
    if (this.postsToday(now) >= INBOX_DAILY) throw new Refused(429, 'This inbox has taken all it takes in a day.')
    const waiting = this.sql.all('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(p)), 0) AS bytes FROM inbox')[0]
    if (Number(waiting.n) >= INBOX_WAITING || Number(waiting.bytes) >= INBOX_BYTES) throw new Refused(507, 'This inbox is full. Open Nib to take in what’s waiting.')
    return key
  }

  /** A post, sealed by the Worker with the key `inboxFor` gave it, kept until a device takes it. Checked again: the inbox may have gone, or filled, since. */
  addPost(address: string, sealed: string, now: number) {
    this.inboxFor(address, now)
    // Counted here, as records are: an id is never given again, even by an inbox ended and made anew, so a device clearing what it took can't clear one that came since.
    const id = Number(this.get('inboxSeq') ?? 0) + 1
    this.set('inboxSeq', id)
    this.sql.run('INSERT INTO inbox (id, at, p) VALUES (?, ?, ?)', id, now, sealed)
    this.set('inboxCount', this.postsToday(now) + 1)
    this.set('inboxDay', utcDay(now))
  }

  /** What's waiting, oldest first, for a device to open: as many as fit one answer. */
  inbox(auth: Auth, now: number): Inbox {
    this.authorise(auth, now)
    this.expireInbox(now)
    const posts: Inbox['posts'] = []
    let bytes = 0
    const rows = this.sql.all('SELECT id, at, p FROM inbox ORDER BY id LIMIT ?', INBOX_PAGE + 1)
    for (const row of rows.slice(0, INBOX_PAGE)) {
      posts.push({ id: Number(row.id), at: Number(row.at), p: String(row.p) })
      bytes += String(row.p).length
      // As `changes` does: always one, and no more once an answer is this big.
      if (bytes > PAGE_BYTES) break
    }
    // With what's kept, the key posts are sealed with, as the server has it: for a device to see it is its own
    // (src/sync/inbox `own`). The code's hash alone could put another key there, and the devices never knew which
    // the server sealed with (the server audit of 2026-11-23). Not the hash of the address's secret: `setInbox`
    // asks for it, so given here it let whoever had the code keep the writer's address and change only the key.
    const [kept, key] = [this.get('inboxKept'), this.get('inboxKey')]
    return {
      on: key !== undefined,
      ...(typeof kept === 'string' ? { kept } : {}),
      ...(typeof key === 'string' ? { key } : {}),
      posts,
      more: posts.length < rows.length,
    }
  }

  /** The hash of the secret in its inbox's address, as `setInbox` took it; none with no inbox. Never told (`libraryRequests` `inbox`). */
  inboxAt(): string | undefined {
    const address = this.get('inboxAddress')
    return typeof address === 'string' ? address : undefined
  }

  /** Posts a device has made notes of, by their ids: deleted here. */
  tookPosts(auth: Auth, ids: number[], now: number): { taken: true } {
    this.authorise(auth, now)
    this.sql.transaction(() => {
      for (const id of ids) this.sql.run('DELETE FROM inbox WHERE id = ?', id)
    })
    return { taken: true }
  }

  /** Posts no device has taken in INBOX_DAYS, deleted. Of a library that there is. */
  expireInbox(now: number) {
    this.sql.run('DELETE FROM inbox WHERE at <= ?', now - INBOX_MS)
  }

  /** When the oldest post waiting is to be deleted, or null with none waiting. Of a library that there is. */
  inboxDue(): number | null {
    const oldest = this.sql.all('SELECT MIN(at) AS at FROM inbox')[0].at
    return typeof oldest === 'number' ? oldest + INBOX_MS : null
  }

  /**
   * Whether a signed request that changes something has been taken before: by its signature, kept for as long
   * as its time could still pass (worker/signing `inSignedWindow`, either side of now). `request` names the one
   * request it came in, which may ask here more than once. A signature held good for some minutes, with nothing
   * to say it had been used: one caught in passing could end an inbox again after it was made anew, or turn
   * signed-only back off (the red-team review of 2026-11-17).
   */
  taken(signature: string, request: string, now: number): boolean {
    // Deleted while the signature was checked: nothing to keep it in, and the request finds no library next.
    if (!this.exists()) return false
    this.sql.run('DELETE FROM taken WHERE at < ?', now - REPLAY_MS)
    const before = this.sql.all('SELECT request FROM taken WHERE signature = ?', signature)[0]
    if (before) return before.request !== request
    this.sql.run('INSERT INTO taken (signature, request, at) VALUES (?, ?, ?)', signature, request, now)
    return false
  }

  /**
   * Everything, gone. The next request with this code finds no library.
   * Returns every subscription that paid for it (`payers`), so its place in each is freed.
   */
  wipe(auth: Auth, now: number): string[] {
    this.authorise(auth, now, { needPlus: false })
    const subscriptions = this.payers()
    this.bury()
    return subscriptions
  }
}

/**
 * A library's inbox as a device is told of it (`Library.inbox`), with a check of its address (worker/signing
 * `inboxCheck`): enough for a device to see the address is its own, and no use in setting one.
 */
export async function inboxTold(library: Library, auth: Parameters<Library['inbox']>[0], now: number): Promise<Inbox> {
  const inbox = library.inbox(auth, now)
  const address = library.inboxAt()
  return address === undefined ? inbox : { ...inbox, check: await inboxCheck(address) }
}

/** What a signed request proves (worker/sync): the message it signed (worker/signing), the time in it, and the signature. */
export type Proof = { message: string; time: number; signature: string; once?: string }

/** Who's asking: the code's hash, or what a signed request proves. Both can be copied to a Durable Object; `SIGNED` can't, so no caller can claim it. */
export type Asker = string | Proof

/** Why no signed request can reach this library, whatever it signed: there's none, or it has no key. */
function unsigned(library: Library): Call | null {
  if (!library.exists()) return { status: 404, body: { error: 'No library for that code.' } }
  if (!library.signKey()) return { status: 401, body: { error: 'This library takes no signed requests yet.', code: UNENROLLED } }
  return null
}

/**
 * What a library does beyond its own tables: its alarm, for when it's to be
 * deleted (null for none); and its files in the store (worker/files), which
 * are kept under `home`, its object's own name there, and deleted by
 * `deleteFiles`.
 */
export type LibraryEffects = {
  alarm(at: number | null): Promise<void>
  home: string
  deleteFiles(): Promise<void>
  /** The library `id`, deleted, let go of by each of the `subscriptions` that paid for it (worker/subscriber `releaseLibrary`). */
  release?(id: string, subscriptions: string[]): Promise<void>
}

/**
 * When a library's object next has something to delete: the oldest post
 * waiting in its inbox, or with none, itself (`deletesAt`). A post is always
 * due first: one is taken only while Plus is current, and the library
 * outlives that by KEPT_MONTHS. Null for no library.
 */
export function nextAlarm(library: Library, now: number): number | null {
  const end = library.deletesAt(now)
  return end === null ? null : (library.inboxDue() ?? end)
}

/**
 * A library's requests, for its Durable Object, each checked in there: by the
 * code's hash, or signed (worker/signing), against the key this library keeps,
 * and then taken as the code's own. `revoke` comes only from the App Store's
 * notifications. Every one sets the alarm for when the library is deleted,
 * as the date moves with what's been paid, and so that a library from before
 * there was one gets it the first time it's opened.
 */
export function libraryRequests(
  library: Library,
  clock: () => number = Date.now,
  effects: Pick<LibraryEffects, 'alarm'> & Partial<Pick<LibraryEffects, 'home' | 'deleteFiles'>> = { alarm: async () => {} },
) {
  const home = effects.home ?? ''
  type Asked = (auth: Auth, now: number) => Call | Promise<Call>
  async function asked(asker: Asker, request: Asked): Promise<Call> {
    const now = clock()
    const answer = await answering(asker, request, now)
    await effects.alarm(nextAlarm(library, now))
    return answer
  }
  async function answering(asker: Asker, request: Asked, now: number): Promise<Call> {
    if (typeof asker === 'string') return answered(() => request(asker, now))
    const refused = unsigned(library)
    if (refused) return refused
    if (!inSignedWindow(asker.time, now)) return { status: 401, body: { error: 'This device’s clock is too far off to sync. Check its date and time.' } }
    if (!(await verifySignature(library.signKey()!, asker.signature, asker.message))) return { status: 401, body: { error: 'That request isn’t signed for this library.' } }
    if (asker.once !== undefined && library.taken(asker.signature, asker.once, now)) return { status: 401, body: { error: 'That request has been taken already.' } }
    return answered(() => request(SIGNED, now))
  }
  return {
    // `id` is the library's own, for it to tell the subscriptions that pay for it when it's deleted (`Library.id`).
    create: (asker: Asker, expiresAt: number, subscription?: string, id?: string) => asked(asker, (auth, now) => ok(library.create(auth, expiresAt, now, subscription, id))),
    entitle: (asker: Asker, expiresAt: number, subscription?: string, id?: string) => asked(asker, (auth, now) => ok(library.entitle(auth, expiresAt, now, subscription, id))),
    status: (asker: Asker) => asked(asker, (auth, now) => ok(library.status(auth, now))),
    // Just the code, and whether Plus is current: nothing read, nothing counted. And where its files are, for whoever
    // fetches one. `needPlus` false for what only lets go (`expire`): asked before its body is read (worker/sync), this
    // refused a lapsed library the request `expire` itself takes.
    authorise: (asker: Asker, needPlus = true) =>
      asked(asker, (auth, now) => {
        library.authorise(auth, now, { needPlus })
        // `at`: this library's clock as it answered, for what is asked of it next about a time (worker/files `fileMissing`).
        return ok({ ok: true, home, at: now })
      }),
    // `names`: the device asking is one that says which files it uses (`namedFiles`).
    changes: (asker: Asker, since: number, names = false) => asked(asker, (auth, now) => ok(library.changes(auth, since, now, undefined, names))),
    push: (asker: Asker, records: Wire[]) => asked(asker, (auth, now) => ok({ results: library.push(auth, records, now) })),
    expire: (asker: Asker, keys: string[]) => asked(asker, (auth, now) => ok({ expired: library.expire(auth, keys, now) })),
    enroll: (asker: Asker, key: string) => asked(asker, (auth, now) => ok(library.enroll(auth, key, now))),
    requireSigned: (asker: Asker, on: boolean) => asked(asker, (auth, now) => ok(library.requireSigned(auth, on, now))),
    // Its files first, from the store: if that fails the library is still here to be asked again.
    wipe: (asker: Asker) =>
      asked(asker, async (auth, now) => {
        library.authorise(auth, now, { needPlus: false })
        await library.emptied(async () => effects.deleteFiles?.())
        return ok({ wiped: true, subscriptions: library.wipe(auth, now) })
      }),
    fileRoom: (asker: Asker, key: string, size: number) =>
      asked(asker, (auth, now) => {
        library.fileRoom(auth, key, size, now)
        return ok({ home })
      }),
    // From the Worker alone, as `revoke` is: the request that sent the file was checked by `fileRoom`.
    fileStored: (key: string, size: number): Promise<Call> =>
      answered(() => {
        library.storedFile(key, size, clock())
        return ok({ stored: true })
      }),
    fileMissing: (key: string, asked: number): Promise<Call> =>
      answered(() => {
        library.fileMissing(key, asked)
        return ok({ forgotten: true })
      }),
    fileFailed: (key: string): Promise<Call> =>
      answered(() => {
        library.fileFailed(key)
        return ok({ released: true })
      }),
    files: (asker: Asker) => asked(asker, (auth, now) => ok(library.files(auth, now))),
    namedFiles: (asker: Asker, keys: string[], done: boolean) => asked(asker, (auth, now) => ok(library.namedFiles(auth, keys, done, now))),
    removeFile: (asker: Asker, key: string) =>
      asked(asker, (auth, now) => {
        library.removeFile(auth, key, now)
        return ok({ home })
      }),
    revoke: async (subscription: string): Promise<Call> => {
      const now = clock()
      library.revoke(subscription, now)
      await effects.alarm(nextAlarm(library, now))
      return ok({ revoked: true })
    },
    // From the Worker's one-off (worker/alarms): asked nothing, so that its alarm is set, as any request sets it.
    // And one wiped before a wipe dropped its tables is taken down to its mark, as one wiped now is.
    arm: async (): Promise<Call> => {
      if (library.leftover()) library.bury()
      await effects.alarm(nextAlarm(library, clock()))
      return ok({ library: library.exists(), gone: library.gone() })
    },
    // Whether there is a library here to tell, or was one: for a subscription to let go of one deleted (worker/notifications).
    paidTo: async (expiresAt: number, subscription?: string, id?: string): Promise<Call> => {
      library.paidTo(expiresAt, subscription, id)
      await effects.alarm(nextAlarm(library, clock()))
      return ok({ told: true, library: library.exists(), gone: library.gone() })
    },
    setInbox: (asker: Asker, key: string, address: string, kept: string) => asked(asker, (auth, now) => ok(library.setInbox(auth, key, address, kept, now))),
    endInbox: (asker: Asker) => asked(asker, (auth, now) => ok(library.endInbox(auth, now))),
    inbox: (asker: Asker) => asked(asker, async (auth, now) => ok(await inboxTold(library, auth, now))),
    tookPosts: (asker: Asker, ids: number[]) => asked(asker, (auth, now) => ok(library.tookPosts(auth, ids, now))),
    // From the Worker (worker/inbox), for whoever holds the inbox's address: no code, no signature.
    inboxFor: (address: string): Promise<Call> => answered(() => ok({ key: library.inboxFor(address, clock()) })),
    addPost: async (address: string, sealed: string): Promise<Call> => {
      const now = clock()
      const answer = await answered(() => {
        library.addPost(address, sealed, now)
        return ok({ received: true })
      })
      await effects.alarm(nextAlarm(library, now))
      return answer
    },
    // From the Worker's own check of the file store (worker/filecheck): which of these keys this library doesn't
    // account for, held as being cleared if it's to delete them; or that there's no library here.
    unlisted: async (keys: string[], run?: string): Promise<Call> => ok({ library: library.exists(), ...(library.exists() ? library.unlisted(keys, clock(), run) : { keys: [], unused: [] }) }),
    swept: async (keys: string[], run: string): Promise<Call> => {
      library.swept(keys, run)
      return ok({})
    },
    // Asked before a signed request's body is read (worker/sync): no more than a signed request is told.
    signs: async (): Promise<Call> => unsigned(library) ?? ok({ signs: true }),
    // Asked before a new code's library is made where libraries were made before (`findLibrary`): only whether one was deleted there.
    gone: async (): Promise<Call> => ok({ gone: library.gone() }),
  }
}

export type LibraryRequests = ReturnType<typeof libraryRequests>

/**
 * A library's alarm. Posts kept in its inbox past their time go. Then what's
 * been paid is read again, so a renewal always wins: paid for since, it waits for the new date. Past it, everything
 * goes: its files from the store, then all it keeps but the mark that it was here (`bury`).
 */
export async function retireLibrary(library: Library, now: number, effects: LibraryEffects) {
  const at = library.deletesAt(now)
  if (at === null) return
  // The alarm may be for a post no device took in time (`nextAlarm`): those go first.
  library.expireInbox(now)
  if (at > now) return effects.alarm(nextAlarm(library, now))
  await library.emptied(effects.deleteFiles)
  // Paid for while its files went? Then it stays, without them: its devices have them to send again.
  const still = library.deletesAt(now)
  // Deleted by its writer while its files went: done already.
  if (still === null) return
  if (still > now) return effects.alarm(nextAlarm(library, now))
  // Deleted, and then each subscription that paid for it told to let go of it. Told first, a receipt that came
  // while they were asked was answered as paid and the library deleted all the same, and one that couldn't be
  // reached kept the library past its date for as long as it couldn't (the server audit of 2026-11-23). One not
  // told keeps the id till the App Store next says a word of it (worker/notifications), or till its own date.
  const [id, payers] = [library.id(), library.payers()]
  library.bury()
  if (id && payers.length > 0) await effects.release?.(id, payers).catch((error: Error) => console.warn('Nib: a deleted library’s subscriptions weren’t all told', error.name))
}


/** Where a library's object is: Cloudflare's EU jurisdiction, or wherever libraries were made before they were kept there. */
export type Region = 'eu' | 'before'
export type Libraries = (id: string, region: Region) => LibraryRequests

/**
 * A library, wherever it is. One made from now on is kept in the EU, where
 * Cloudflare runs and stores it; one made before stays where it was made,
 * and is found there once the EU has none by its id (which stores nothing:
 * `made` above). Which one answered is kept for the rest of the
 * request. What the App Store says of a subscription reaches both, as either may be the one.
 */
export function findLibrary(library: Libraries, id: string) {
  const eu = library(id, 'eu')
  const before = library(id, 'before')
  let found: LibraryRequests | null = null
  async function both(ask: (stub: LibraryRequests) => Promise<Call>): Promise<Call> {
    const [inEu, earlier] = await Promise.all([ask(eu), ask(before)])
    return inEu.status === 200 ? earlier : inEu
  }
  async function reach(ask: (stub: LibraryRequests) => Promise<Call>): Promise<Call> {
    if (found) return ask(found)
    const answer = await ask(eu)
    if (answer.status !== 404) {
      found = eu
      return answer
    }
    found = before
    return ask(before)
  }
  return {
    reach,
    async create(asker: Asker, expiresAt: number, subscription?: string): Promise<Call> {
      // A new code's library is made in the EU, unless the code already has one.
      if (!found && typeof asker === 'string') {
        const there = await before.status(asker)
        // One deleted there isn't made again in the EU either.
        if (there.status === 404 && ((await before.gone()).body as { gone: boolean }).gone) return { status: 410, body: { error: LIBRARY_GONE } }
        found = there.status === 404 ? eu : before
      }
      return reach((stub) => stub.create(asker, expiresAt, subscription, id))
    },
    revoke: (subscription: string) => both((stub) => stub.revoke(subscription)),
    /**
     * Told in both regions. True if the library is gone: deleted from one, and in neither. Not one that is only
     * nowhere yet, as a new library is between its place being counted and its being made (worker/sync).
     */
    async paidTo(expiresAt: number, subscription?: string): Promise<boolean> {
      const told = (await Promise.all([eu, before].map((stub) => stub.paidTo(expiresAt, subscription, id)))).map((answer) => answer.body as { library?: boolean; gone?: boolean })
      return !told.some((one) => one.library) && told.some((one) => one.gone === true)
    },
  }
}
