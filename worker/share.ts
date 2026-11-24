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
/**
 * Tries at a draft to be read once that asks for a token (worker/shares), from one network in a day, and from the
 * wider one around it. A wrong one was answered as fast as it was asked, uncounted: the password such a draft has
 * could be guessed against the server at its own speed, by anyone the link had reached (the server audit of 2026-11-23).
 */
export const REVEALS_PER_NETWORK_PER_DAY = 20
export const REVEALS_PER_WIDE_PER_DAY = 40
/** Openings of one draft counted from one wider network in a day: each network in it was counted once, 65,536 to a /48. */
export const OPENS_PER_WIDE_PER_DAY = 5
/**
 * How long a draft to be read once is held after it's first handed over, to be handed again to the same link and
 * password: its answer lost on the way (a train, a tab put away), it was gone unread, and its writer told it had
 * been read (the server audit of 2026-11-23).
 */
export const REVEALED_KEPT_MS = 10 * 60_000
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
    // One that has ended keeps the mark of it and nothing else (`erase`).
    if (this.made && this.get('ended') === undefined) this.tables()
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
    if (free && share.once) throw new Refused(403, ONCE_IS_PLUS)
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
    // Here, where every request of a share comes first: the text of one read once and held long enough goes as
    // anything is next asked of it, if its alarm never came. Left to `reveal`, which `read` refuses before it's
    // reached once the hold is over, it stayed till the share expired.
    this.forgetRevealed(now)
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
    // Not of one that has ended meanwhile (revoked while its subscription was asked): its mark stays the mark alone.
    if (this.expiresAt() === null) return
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
      // Read, and no longer held to be handed over again (`reveal`).
      if (this.get('opened') && !this.held(now)) throw new Refused(410, READ_ONCE_GONE)
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
    if (this.expiresAt() !== null && this.counts() && this.get('owner') !== ownerHash) this.set('opens', Number(this.get('opens') ?? 0) + 1)
  }

  private text() {
    return this.sql.all('SELECT data FROM chunks ORDER BY n').map((row) => String(row.data)).join('')
  }

  /** Whether one to be read once, handed over, is still held to be handed to the same reader again (`reveal`). */
  private held(now: number): boolean {
    const revealed = this.get('revealed')
    return typeof revealed === 'number' && now < revealed + REVEALED_KEPT_MS
  }

  /** When the text of one handed over is to be deleted, null if none is held (`forgetRevealed`). */
  revealedDue(): number | null {
    const revealed = this.get('revealed')
    return typeof revealed === 'number' ? revealed + REVEALED_KEPT_MS : null
  }

  /** The text of one handed over REVEALED_KEPT_MS ago, deleted: by its alarm, or as it's next asked for. */
  forgetRevealed(now: number) {
    const due = this.revealedDue()
    if (due === null || due > now) return
    this.sql.transaction(() => {
      this.sql.run('DELETE FROM chunks')
      this.sql.run("DELETE FROM meta WHERE k = 'revealed'")
    })
  }

  /** Whether one to be read once asks for a token before it's handed over: tries at those are counted (worker/shares). Refuses as `reveal` would one that isn't there to be read once. */
  guarded(now: number): boolean {
    this.live(now)
    if (!this.get('once')) throw new Refused(404, 'Not found.')
    return this.get('reveal') !== undefined
  }

  /**
   * One to be read once, handed to the reader who asked to see it. It stays
   * until it expires, with no text: for its owner to learn it was read, and
   * for the reader's notes.
   *
   * Its text is deleted here in the same step if it asks for no token (one
   * made before there were tokens). One that does is held REVEALED_KEPT_MS
   * more, and handed again only to the same token, which takes the link's
   * key and its password: then deleted (`forgetRevealed`).
   */
  reveal(now: number, tokenHash: string | null = null): { doc: string; expiresAt: number; notesOn: boolean } {
    this.live(now)
    if (!this.get('once')) throw new Refused(404, 'Not found.')
    // Only for the token from the link's key: the slug alone, which a log or a scanner on the way may keep, uses nothing up (the security review of 2026-11-13). One made before there were tokens has none to ask for.
    const kept = this.get('reveal')
    const answer = () => ({ doc: this.text(), expiresAt: this.expiresAt()!, notesOn: Boolean(this.get('notes')) })
    if (this.get('opened')) {
      if (kept === undefined || !this.held(now)) throw new Refused(410, READ_ONCE_GONE)
      // While it's held, a token that isn't its own is answered as before it was read: said to be gone, the reader
      // page never tried the token of a draft made by an older Nib, and called a mistyped password "already read".
      if (kept !== tokenHash) throw new Refused(404, 'Not found.')
      return answer()
    }
    if (kept !== undefined && kept !== tokenHash) throw new Refused(404, 'Not found.')
    const revealed = answer()
    this.sql.transaction(() => {
      if (kept === undefined) this.sql.run('DELETE FROM chunks')
      else this.set('revealed', now)
      this.set('opened', 1)
    })
    return revealed
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
  update(ownerHash: string, change: { days?: number; notes?: boolean }, now: number, paid = true): number {
    this.owned(ownerHash, now)
    if (this.get('free')) {
      if (change.days !== undefined) throw new Refused(403, 'A free link can’t be extended. That’s part of Nib Plus.')
      if (change.notes) throw new Refused(403, 'Readers’ notes are part of Nib Plus.')
    }
    // `paid`: whether its subscription is (`paidFor`). Refunded or lapsed, a share served to no one could still be kept, 90 days at a time.
    if (change.days !== undefined && !paid) throw new Refused(402, 'Nib Plus is not active for this draft.')
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
   *
   * In one step, and its tables dropped, not emptied: emptied, they were kept for every share ever revoked or
   * expired (the server audit of 2026-11-23). Not by deleting the object's storage and putting the mark back
   * after: between those two there is a moment with no mark, and the mark is the point.
   */
  erase() {
    this.sql.transaction(() => {
      this.sql.run('DROP TABLE IF EXISTS chunks')
      this.sql.run('DROP TABLE IF EXISTS notes')
      this.sql.run('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v)')
      this.sql.run('DELETE FROM meta')
      this.sql.run("INSERT INTO meta (k, v) VALUES ('ended', 1)")
    })
    this.made = true
  }

  /** When its object next has something to delete: the text of one handed over, or itself at its expiry. Null once it's gone. */
  nextAlarm(): number | null {
    const expires = this.expiresAt()
    if (expires === null) return null
    return Math.min(expires, this.revealedDue() ?? Infinity)
  }
}

/** When a subscription is paid to, asked of its own object: null if to no time at all. */
type Renewal = (subscriber: string) => Promise<number | null>

const NOT_SHARED = 'This draft isn’t being shared right now.'
/** What a free link asked to be read once is refused with, here and before it's counted against anyone (worker/shares). */
export const ONCE_IS_PLUS = 'A link that deletes itself after one reading is part of Nib Plus.'

/**
 * Whether a share's subscription is paid for. A share hears about renewals
 * only when asked, so when its own record of the subscription runs out, it
 * asks the subscription once before saying no.
 */
export async function paidFor(share: Share, now: number, renewal: Renewal): Promise<boolean> {
  if (share.entitled(now)) return true
  const subscriber = share.subscriber()
  const until = subscriber ? await renewal(subscriber) : null
  if (until !== null) share.entitle(until)
  return share.entitled(now)
}

/** Serves a share to a reader, but only while its subscription is paid for (`paidFor`). */
export async function readShare(
  share: Share,
  now: number,
  renewal: Renewal,
  { reveal = false, tokenHash = null }: { reveal?: boolean; tokenHash?: string | null } = {},
): Promise<ReturnType<Share['read']>> {
  const shared = share.read(now)
  if (!(await paidFor(share, now, renewal))) throw new Refused(410, NOT_SHARED)
  // One to be read once (`reveal`): only now, with the subscription asked about, or a lapse would use it up unread.
  if (reveal) return share.reveal(now, tokenHash)
  // Counted by whoever asked (worker/shares), once it's been handed over: never while it's lapsed, expired or taken down.
  return shared
}

type ShareEffects = {
  subscriber(key: string): SubscriberRequests
  alarm(at: number | null): Promise<void>
}

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
  const renewal: Renewal = async (key) => (await effects.subscriber(key).expiry()).body as number | null
  const paid = () => paidFor(share, clock(), renewal)
  return {
    create: (request: Parameters<Share['create']>[0]) =>
      answered(async () => {
        const expiresAt = share.create(request, clock())
        await effects.alarm(share.nextAlarm())
        return { status: 201, body: { expiresAt } }
      }),
    read: (blocked: string[]) =>
      answered(async () => {
        refuseBlocked(blocked)
        return ok(await readShare(share, clock(), renewal))
      }),
    /** One more opening, once it's been handed over (worker/shares). `ownerHash`: the owner token the request came with, if any, hashed. */
    countOpen: (ownerHash: string | null) =>
      answered(() => {
        share.countOpen(ownerHash)
        return ok({ counted: true })
      }),
    /** Whether it's one to be read once that asks for a token, for tries at it to be counted before they're made (worker/shares). */
    guarded: (blocked: string[]) =>
      answered(() => {
        refuseBlocked(blocked)
        return ok({ guarded: share.guarded(clock()) })
      }),
    /** `tokenHash`: the hash of the token the reader showed, if any (src/share/crypto `revealToken`). */
    reveal: (blocked: string[], tokenHash: string | null = null) =>
      answered(async () => {
        refuseBlocked(blocked)
        const revealed = await readShare(share, clock(), renewal, { reveal: true, tokenHash })
        // Its text is deleted when it has been held long enough (`REVEALED_KEPT_MS`), if that comes before it expires.
        await effects.alarm(share.nextAlarm())
        return ok(revealed)
      }),
    // A draft no reader is served takes no notes from one either: refunded, it went on taking them.
    takesNotes: (blocked: string[]) =>
      answered(async () => {
        refuseBlocked(blocked)
        share.takesNotes(clock())
        if (!(await paid())) throw new Refused(410, NOT_SHARED)
        return ok({})
      }),
    addNote: (note: string, blocked: string[]) =>
      answered(async () => {
        refuseBlocked(blocked)
        share.takesNotes(clock())
        if (!(await paid())) throw new Refused(410, NOT_SHARED)
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
        const expiresAt = share.update(ownerHash, change, clock(), change.days === undefined || (await paid()))
        const slug = share.slug()
        const subscriber = share.subscriber()
        if (change.days !== undefined) {
          await effects.alarm(share.nextAlarm())
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

/** At expiry: everything goes, and the subscription has one share fewer. Before it, the alarm may be for the text of one read once, held long enough (`forgetRevealed`). */
export async function expireShare(share: Share, now: number, effects: ShareEffects) {
  const expiresAt = share.expiresAt()
  if (expiresAt === null) return
  share.forgetRevealed(now)
  // Extended since this alarm was set, or it was for that text: wait for the expiry.
  if (expiresAt > now) return effects.alarm(share.nextAlarm())
  const slug = share.slug()
  const subscriber = share.subscriber()
  share.erase()
  if (slug && subscriber) await effects.subscriber(subscriber).release(slug)
}
