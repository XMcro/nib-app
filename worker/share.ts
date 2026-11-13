import { answered, ok, Refused } from './answer'
import type { Sql } from './library'
import { extendsPaid, paidThrough } from './paid'
import type { SubscriberRequests } from './subscriber'
import { MAX_NOTE_LENGTH, READ_ONCE_GONE } from './wire.mjs'

/**
 * Share a draft. A `Share` is one shared document and the notes readers leave
 * on it, in its own Durable Object. A `Subscriber` is one App Store
 * subscription: how long it's paid for, and which shares it has live.
 *
 * With Nib Plus a share can be one to be read once (`once`): asked for, it
 * says only that it's there; its sealed text is handed over to one `reveal`,
 * and deleted in the same step. What's kept after is that it was read, for
 * its owner to be told, and nothing of who by or when.
 *
 * Any other share made with Nib Plus counts how many times it has been handed
 * to a reader (`opens`): a number, for its owner, and nothing of who or when.
 * The reader is told it's counted (`counted`), and their page says so.
 *
 * Without Nib Plus a share is free: no subscription behind it, read-only,
 * for FREE_DAYS and never extended. The app allows one live at a time; the
 * server counts how many each IP address starts in a day (`FreeQuota`).
 *
 * Everything stored is ciphertext the server can't read, sealed on the device
 * with a key that never leaves the link's fragment (src/share/crypto.ts).
 * What the server can see: sizes, times, how many notes, and which shares
 * belong to the same subscription.
 */

/** New free shares a day from one IP address (an IPv6 /64). The app itself keeps one live. */
export const FREE_PER_DAY = 5
/**
 * New free shares a day from one wider network, an IPv6 /48 or an IPv4 /24:
 * a /48 is 65,536 /64s, and one came free from a tunnel broker.
 */
export const FREE_PER_DAY_WIDE = 50
/**
 * New free shares a day from everyone together: a backstop for whoever has
 * addresses to spare. Far above what the app's one-at-a-time habit makes.
 */
export const FREE_PER_DAY_EVERYONE = 2_000
export const MAX_NOTES = 200
export const NOTES_PER_MINUTE = 10
/** New notes an hour on one draft from all its readers together: five networks within their own limits filled its 200 places in about 20 minutes. */
export const NOTES_PER_HOUR = 40
/** New notes a day on one draft from one network (an IPv6 /64), so one reader can't fill its 200 places. */
export const NOTES_PER_READER_PER_DAY = 20
/** The same from one wider network, an IPv6 /48 or IPv4 /24: ten /64s from one /48 filled all 200. */
export const NOTES_PER_WIDE_PER_DAY = 40
const CHUNK = 900_000 // a row stays under SQLite-in-Durable-Objects' 2 MB cap
const DAY_MS = 86_400_000

export type Note = { id: number; at: number; note: string }

export class Share {
  private sql: Sql
  /** Made only once something is kept (create): a slug asked for that was never shared stores nothing, so leaves no object behind. */
  private made: boolean

  constructor(sql: Sql) {
    this.sql = sql
    this.made = sql.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").length > 0
    if (this.made) this.tables()
  }

  private tables() {
    this.sql.run('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v)')
    this.sql.run('CREATE TABLE IF NOT EXISTS chunks (n INTEGER PRIMARY KEY, data TEXT NOT NULL)')
    this.sql.run('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, data TEXT NOT NULL)')
    this.made = true
  }

  private get(key: string) {
    return this.made ? this.sql.all('SELECT v FROM meta WHERE k = ?', key)[0]?.v : undefined
  }

  private set(key: string, value: string | number) {
    if (!this.made) this.tables()
    this.sql.run('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', key, value)
  }

  /** Who pays for this share, for its object to ask about renewals. Null once it's gone. */
  subscriber(): string | null {
    const key = this.get('subscriber')
    return typeof key === 'string' ? key : null
  }

  slug(): string | null {
    const slug = this.get('slug')
    return typeof slug === 'string' ? slug : null
  }

  expiresAt(): number | null {
    const expires = this.get('expires')
    return typeof expires === 'number' ? expires : null
  }

  /** `subscriber` null makes it free: read-only, served until it expires, and never extended. */
  create(share: { slug: string; ownerHash: string; subscriber: string | null; days: number; entitledUntil?: number; doc: string; once?: boolean; reveal?: string }, now: number): number {
    if (this.get('owner') !== undefined || this.get('ended') !== undefined) throw new Refused(409, 'That share already exists.')
    const expires = now + share.days * DAY_MS
    const free = share.subscriber === null
    if (free && share.once) throw new Refused(403, 'A link that deletes itself after one reading is part of Nib Plus.')
    this.sql.transaction(() => {
      this.tables()
      this.set('slug', share.slug)
      this.set('owner', share.ownerHash)
      if (!free) this.set('subscriber', share.subscriber!)
      this.set('expires', expires)
      // A free share is paid for by nobody, so its own expiry is as far as it goes.
      this.set('entitled', free ? expires : share.entitledUntil!)
      this.set('notes', free ? 0 : 1)
      if (free) this.set('free', 1)
      if (share.once) this.set('once', 1)
      // The hash of the token a reader shows to have it handed over (src/share/crypto `revealToken`).
      if (share.once && share.reveal) this.set('reveal', share.reveal)
      for (let n = 0; n * CHUNK < share.doc.length; n++) {
        this.sql.run('INSERT INTO chunks (n, data) VALUES (?, ?)', n, share.doc.slice(n * CHUNK, (n + 1) * CHUNK))
      }
    })
    return expires
  }

  /** There, and not yet expired. Revoked shares are simply gone. */
  private live(now: number) {
    const expires = this.expiresAt()
    if (expires === null) throw new Refused(404, 'No such share.')
    if (expires <= now) throw new Refused(410, 'This share has expired.')
  }

  private owned(ownerHash: string, now: number) {
    this.live(now)
    if (this.get('owner') !== ownerHash) throw new Refused(403, 'That is not this share’s owner token.')
  }

  /** Whether the subscription paying for it is current, give or take the grace period. */
  entitled(now: number): boolean {
    return paidThrough(Number(this.get('entitled') ?? 0), now)
  }

  /** A renewal, reported through the subscription. Only ever extends. */
  entitle(until: number) {
    if (extendsPaid(this.get('entitled'), until)) this.set('entitled', until)
  }

  /** Its subscription was refunded or revoked: it serves only if asked anew (`readShare`), which says no. */
  unentitle() {
    if (this.get('entitled') !== undefined) this.set('entitled', 0)
  }

  /**
   * The sealed document, for a reader. The caller checks the subscription
   * first; see `readShare`. One to be read once isn't handed over for the
   * asking, which a chat app's preview of the link does too: only that it's
   * there (`once`), until it has been read, and gone after.
   */
  read(now: number): { expiresAt: number; notesOn: boolean; doc?: string; once?: true; counted?: true } {
    this.live(now)
    const about = { expiresAt: this.expiresAt()!, notesOn: Boolean(this.get('notes')) }
    if (this.get('once')) {
      if (this.get('opened')) throw new Refused(410, READ_ONCE_GONE)
      return { once: true, ...about }
    }
    return { doc: this.text(), ...about, ...(this.counts() ? { counted: true as const } : {}) }
  }

  /** Whether its openings are counted: with Nib Plus, and not one to be read once, which says that it was read instead. */
  private counts() {
    return !this.get('free') && !this.get('once')
  }

  /** One more opening, unless it's its owner asking (the app, checking its key against the draft). */
  countOpen(ownerHash: string | null) {
    if (this.counts() && this.get('owner') !== ownerHash) this.set('opens', Number(this.get('opens') ?? 0) + 1)
  }

  private text() {
    return this.sql.all('SELECT data FROM chunks ORDER BY n').map((row) => String(row.data)).join('')
  }

  /**
   * One to be read once, handed to the reader who asked to see it, and its
   * text deleted here in the same step. It stays until it expires, with no
   * text: for its owner to learn it was read, and for the reader's notes.
   */
  reveal(now: number, tokenHash: string | null = null): { doc: string; expiresAt: number; notesOn: boolean } {
    this.live(now)
    if (!this.get('once')) throw new Refused(404, 'Not found.')
    if (this.get('opened')) throw new Refused(410, READ_ONCE_GONE)
    // Only for the token from the link's key: the slug alone, which a log or a scanner on the way may keep, uses nothing up (the security review of 2026-11-13). One made before there were tokens has none to ask for.
    const kept = this.get('reveal')
    if (kept !== undefined && kept !== tokenHash) throw new Refused(404, 'Not found.')
    const doc = this.text()
    this.sql.transaction(() => {
      this.sql.run('DELETE FROM chunks')
      this.set('opened', 1)
    })
    return { doc, expiresAt: this.expiresAt()!, notesOn: Boolean(this.get('notes')) }
  }

  /** There, and taking notes: asked before a note is counted against anyone. */
  takesNotes(now: number) {
    this.live(now)
    if (!this.get('notes')) throw new Refused(403, 'The writer has turned notes off.')
  }

  /** A reader's note, sealed. Capped in size, in number, and in pace. */
  addNote(note: string, now: number): number {
    this.takesNotes(now)
    if (note.length > MAX_NOTE_LENGTH) throw new Refused(400, 'That note is too long.')
    const counts = this.sql.all('SELECT COUNT(*) AS total, COALESCE(SUM(at > ?), 0) AS recent, COALESCE(SUM(at > ?), 0) AS hour FROM notes', now - 60_000, now - 3_600_000)[0]
    if (Number(counts.total) >= MAX_NOTES) throw new Refused(429, 'This draft has all the notes it can take.')
    if (Number(counts.recent) >= NOTES_PER_MINUTE) throw new Refused(429, 'Too many notes at once. Try again in a minute.')
    if (Number(counts.hour) >= NOTES_PER_HOUR) throw new Refused(429, 'This draft has had all the notes it can take this hour. Try again later.')
    this.sql.run('INSERT INTO notes (at, data) VALUES (?, ?)', now, note)
    return Number(this.sql.all('SELECT MAX(id) AS id FROM notes')[0].id)
  }

  /** For its owner: readers' notes; of one to be read once, whether it has been; and of one that's counted, how many times it has been opened. */
  notes(ownerHash: string, now: number): { notes: Note[]; notesOn: boolean; expiresAt: number; once: boolean; opened: boolean; opens?: number } {
    this.owned(ownerHash, now)
    const notes = this.sql.all('SELECT id, at, data FROM notes ORDER BY id').map((row) => ({ id: Number(row.id), at: Number(row.at), note: String(row.data) }))
    const about = { notes, notesOn: Boolean(this.get('notes')), expiresAt: this.expiresAt()!, once: Boolean(this.get('once')), opened: Boolean(this.get('opened')) }
    return this.counts() ? { ...about, opens: Number(this.get('opens') ?? 0) } : about
  }

  deleteNote(ownerHash: string, id: number, now: number) {
    this.owned(ownerHash, now)
    this.sql.run('DELETE FROM notes WHERE id = ?', id)
  }

  /** A new expiry, counted from now, or notes on or off. Returns the expiry. */
  update(ownerHash: string, change: { days?: number; notes?: boolean }, now: number): number {
    this.owned(ownerHash, now)
    if (this.get('free')) {
      if (change.days !== undefined) throw new Refused(403, 'A free link can’t be extended. That’s part of Nib Plus.')
      if (change.notes) throw new Refused(403, 'Readers’ notes are part of Nib Plus.')
    }
    if (change.days !== undefined) this.set('expires', now + change.days * DAY_MS)
    if (change.notes !== undefined) this.set('notes', change.notes ? 1 : 0)
    return this.expiresAt()!
  }

  /** Everything, gone at once. Returns who paid for it, so their count goes down. */
  revoke(ownerHash: string, now: number): string | null {
    this.owned(ownerHash, now)
    const subscriber = this.subscriber()
    this.erase()
    return subscriber
  }

  /**
   * Everything goes but a tombstone, so the slug can't be created again:
   * whoever saw the link holds its key, and could otherwise publish their own
   * text at the author's old address, out of the author's reach. Readers find
   * it gone, as they would without one.
   */
  erase() {
    this.sql.transaction(() => {
      this.tables()
      for (const table of ['meta', 'chunks', 'notes']) this.sql.run(`DELETE FROM ${table}`)
      this.set('ended', 1)
    })
  }
}

/**
 * Serves a share to a reader, but only while its subscription is paid for.
 * A share hears about renewals only when asked, so when its own record of
 * the subscription runs out, it asks the subscription once before refusing.
 */
export async function readShare(
  share: Share,
  now: number,
  renewal: (subscriber: string) => Promise<number | null>,
  { reveal = false, tokenHash = null }: { reveal?: boolean; tokenHash?: string | null } = {},
): Promise<ReturnType<Share['read']>> {
  const shared = share.read(now)
  if (!share.entitled(now)) {
    const subscriber = share.subscriber()
    const until = subscriber ? await renewal(subscriber) : null
    if (until !== null) share.entitle(until)
    if (!share.entitled(now)) throw new Refused(410, 'This draft isn’t being shared right now.')
  }
  // One to be read once (`reveal`): only now, with the subscription asked about, or a lapse would use it up unread.
  if (reveal) return share.reveal(now, tokenHash)
  // Counted by whoever asked (worker/shares), once it's been handed over: never while it's lapsed, expired or taken down.
  return shared
}

type ShareEffects = { subscriber(key: string): SubscriberRequests; alarm(at: number | null): Promise<void> }

/**
 * A share's requests, for its Durable Object. `alarm` schedules the deletion
 * at expiry (null cancels it); `subscriber` reaches the subscription's object.
 */
export function shareRequests(share: Share, effects: ShareEffects, clock: () => number = Date.now) {
  // Taken down by slug or by subscriber. The log line is how a slug from a
  // report leads to its subscriber, and so to the rest of their shares.
  const refuseBlocked = (blocked: string[]) => {
    const slug = share.slug()
    const subscriber = share.subscriber()
    if ((slug && blocked.includes(slug)) || (subscriber && blocked.includes(subscriber))) {
      console.log(`Nib: blocked share ${slug}, subscriber ${subscriber}`)
      throw new Refused(410, 'This draft has been taken down.')
    }
  }
  return {
    create: (request: Parameters<Share['create']>[0]) =>
      answered(async () => {
        const expiresAt = share.create(request, clock())
        await effects.alarm(expiresAt)
        return { status: 201, body: { expiresAt } }
      }),
    read: (blocked: string[]) =>
      answered(async () => {
        refuseBlocked(blocked)
        return ok(await readShare(share, clock(), async (key) => (await effects.subscriber(key).expiry()).body as number | null))
      }),
    /** One more opening, once it's been handed over (worker/shares). `ownerHash`: the owner token the request came with, if any, hashed. */
    countOpen: (ownerHash: string | null) =>
      answered(() => {
        share.countOpen(ownerHash)
        return ok({ counted: true })
      }),
    /** `tokenHash`: the hash of the token the reader showed, if any (src/share/crypto `revealToken`). */
    reveal: (blocked: string[], tokenHash: string | null = null) =>
      answered(async () => {
        refuseBlocked(blocked)
        return ok(await readShare(share, clock(), async (key) => (await effects.subscriber(key).expiry()).body as number | null, { reveal: true, tokenHash }))
      }),
    takesNotes: (blocked: string[]) =>
      answered(() => {
        refuseBlocked(blocked)
        share.takesNotes(clock())
        return ok({})
      }),
    addNote: (note: string, blocked: string[]) =>
      answered(() => {
        refuseBlocked(blocked)
        return { status: 201, body: { id: share.addNote(note, clock()) } }
      }),
    notes: (ownerHash: string) => answered(() => ok(share.notes(ownerHash, clock()))),
    deleteNote: (ownerHash: string, id: number) =>
      answered(() => {
        share.deleteNote(ownerHash, id, clock())
        return ok({ deleted: true })
      }),
    update: (ownerHash: string, change: { days?: number; notes?: boolean }) =>
      answered(async () => {
        const expiresAt = share.update(ownerHash, change, clock())
        const slug = share.slug()
        const subscriber = share.subscriber()
        if (change.days !== undefined) {
          await effects.alarm(expiresAt)
          if (slug && subscriber) await effects.subscriber(subscriber).extend(slug, expiresAt)
        }
        return ok({ expiresAt })
      }),
    unentitle: () =>
      answered(() => {
        share.unentitle()
        return ok({ unentitled: true })
      }),
    revoke: (ownerHash: string) =>
      answered(async () => {
        const slug = share.slug()
        const subscriber = share.revoke(ownerHash, clock())
        await effects.alarm(null)
        if (slug && subscriber) await effects.subscriber(subscriber).release(slug)
        return ok({ revoked: true })
      }),
  }
}

export type ShareRequests = ReturnType<typeof shareRequests>

/** At expiry: everything goes, and the subscription has one share fewer. */
export async function expireShare(share: Share, now: number, effects: ShareEffects) {
  const expiresAt = share.expiresAt()
  if (expiresAt === null) return
  // Extended since this alarm was set: wait for the new expiry instead.
  if (expiresAt > now) return effects.alarm(expiresAt)
  const slug = share.slug()
  const subscriber = share.subscriber()
  share.erase()
  if (slug && subscriber) await effects.subscriber(subscriber).release(slug)
}
