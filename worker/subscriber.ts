import { answered, ok, Refused } from './answer'
import type { Sql } from './library'
import { extendsPaid } from './paid'

export const MAX_LIVE_SHARES = 50
/** Sync libraries one subscription pays for: a household's worth of devices, several times over. */
export const MAX_LIBRARIES = 5
/**
 * A library that hasn't renewed in this long holds no place: its devices
 * have likely stopped syncing it, and only they have the code to delete it.
 */
export const LIBRARY_IDLE_MS = 60 * 86_400_000
const REVOKED = 'This App Store purchase was refunded or revoked, so it no longer pays for Nib Plus.'

/**
 * One App Store subscription, filed under its original transaction id's hash:
 * how long it's paid for, its live shares, and the sync libraries it pays for.
 * Refunded or revoked (index.ts hears from the App Store), nothing bought up
 * to then pays for anything, whatever receipt from before turns up. A renewal
 * or purchase made since does: Apple files it under the same id.
 */
export class Subscriber {
  private sql: Sql

  constructor(sql: Sql) {
    this.sql = sql
    sql.run('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v)')
    sql.run('CREATE TABLE IF NOT EXISTS shares (slug TEXT PRIMARY KEY, expires INTEGER NOT NULL)')
    sql.run('CREATE TABLE IF NOT EXISTS libraries (id TEXT PRIMARY KEY, renewed INTEGER NOT NULL)')
  }

  private get(key: string) {
    return this.sql.all('SELECT v FROM meta WHERE k = ?', key)[0]?.v
  }

  private set(key: string, value: number) {
    this.sql.run('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', key, value)
  }

  private raise(key: string, value: number) {
    this.sql.run('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = MAX(v, excluded.v)', key, value)
  }

  /**
   * A receipt's purchase time; 0, unknown, counts as before any refund. One
   * that still pays is remembered if it is the newest yet, for `revoke`.
   */
  private payingStill(purchasedAt: number) {
    const through = this.get('revoked')
    if (typeof through === 'number' && purchasedAt <= through) throw new Refused(403, REVOKED)
    this.raise('purchased', purchasedAt)
  }

  expiresAt(): number | null {
    const expires = this.get('expires')
    return typeof expires === 'number' ? expires : null
  }

  /** A verified receipt. Only ever extends: a stale one from another device can't cut a renewal short. */
  entitle(expiresAt: number, purchasedAt = 0): number {
    this.payingStill(purchasedAt)
    if (extendsPaid(this.expiresAt(), expiresAt)) this.set('expires', expiresAt)
    return this.expiresAt()!
  }

  /** What the App Store says this is paid to, renewed or come to its end, and the libraries it pays for, used lately or not, to tell. */
  paidTo(expiresAt: number, purchasedAt: number): string[] {
    this.entitle(expiresAt, purchasedAt)
    return this.sql.all('SELECT id FROM libraries ORDER BY id').map((row) => String(row.id))
  }

  /**
   * Counts a new share against the cap of live ones. True if it took a place
   * just now: one counted already is a share posted again, which keeps its
   * place and its time, and whose refusal must not give the place back.
   */
  admit(slug: string, expires: number, now: number, purchasedAt = 0): boolean {
    this.payingStill(purchasedAt)
    this.sql.run('DELETE FROM shares WHERE expires <= ?', now)
    if (this.sql.all('SELECT 1 FROM shares WHERE slug = ?', slug).length) return false
    const live = Number(this.sql.all('SELECT COUNT(*) AS live FROM shares')[0].live)
    if (live >= MAX_LIVE_SHARES) throw new Refused(429, `You can have ${MAX_LIVE_SHARES} drafts shared at once. Revoke one to share another.`)
    this.sql.run('INSERT INTO shares (slug, expires) VALUES (?, ?)', slug, expires)
    return true
  }

  /** Keeps the count right when a share's expiry moves. */
  extend(slug: string, expires: number) {
    this.sql.run('UPDATE shares SET expires = ? WHERE slug = ?', expires, slug)
  }

  release(slug: string) {
    this.sql.run('DELETE FROM shares WHERE slug = ?', slug)
  }

  /**
   * Counts a sync library against the cap, as it is made or renews. Only
   * libraries renewed in the last LIBRARY_IDLE_MS count; one back after that
   * takes a place like a new one. True if it took a place just now.
   */
  claimLibrary(id: string, now: number, purchasedAt = 0): boolean {
    this.payingStill(purchasedAt)
    const since = now - LIBRARY_IDLE_MS
    const held = this.sql.all('SELECT renewed FROM libraries WHERE id = ?', id)[0]
    if (held && Number(held.renewed) > since) {
      this.sql.run('UPDATE libraries SET renewed = ? WHERE id = ?', now, id)
      return false
    }
    const current = Number(this.sql.all('SELECT COUNT(*) AS n FROM libraries WHERE renewed > ? AND id != ?', since, id)[0].n)
    if (current >= MAX_LIBRARIES) {
      throw new Refused(
        403,
        `One Nib Plus subscription syncs up to ${MAX_LIBRARIES} libraries at a time, and ${MAX_LIBRARIES} others have been in use in the last 60 days. Delete the server copy of one you no longer use, or try again once one has gone 60 days unused.`,
      )
    }
    this.sql.run('INSERT INTO libraries (id, renewed) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET renewed = excluded.renewed', id, now)
    return true
  }

  releaseLibrary(id: string) {
    this.sql.run('DELETE FROM libraries WHERE id = ?', id)
  }

  /**
   * A refund or revocation of the purchase made at `through`: it, and anything
   * bought before it, pays for nothing. If it was the newest purchase seen,
   * the time paid for ends too, and it returns what it was paying for, for the
   * caller to cut off; the same again if it comes twice. A purchase seen
   * since, a renewal most often, goes on paying, and nothing is cut off: a
   * refund of last month stopped this month's sync until Nib was relaunched.
   */
  revoke(through: number): { libraries: string[]; shares: string[] } {
    this.raise('revoked', through)
    const newest = Number(this.get('purchased') ?? 0)
    if (newest > through) return { libraries: [], shares: [] }
    this.set('expires', 0)
    return {
      libraries: this.sql.all('SELECT id FROM libraries ORDER BY id').map((row) => String(row.id)),
      shares: this.sql.all('SELECT slug FROM shares ORDER BY slug').map((row) => String(row.slug)),
    }
  }

  /**
   * That refund reversed: the purchase made at `through` pays again, up to
   * `expiresAt`. Only the latest refund is kept, so it's undone if it's this
   * one; a later purchase's stands. Shares ask here again before refusing
   * (`readShare`), and a library's devices send their receipt again till
   * it's taken (src/sync), so both come back.
   */
  unrevoke(through: number, expiresAt: number): number {
    this.sql.run("DELETE FROM meta WHERE k = 'revoked' AND v = ?", through)
    return this.entitle(expiresAt, through)
  }
}

/** A subscription's requests, for its Durable Object. */
export function subscriberRequests(subscriber: Subscriber, clock: () => number = Date.now) {
  return {
    entitle: (expiresAt: number, purchasedAt: number) => answered(() => ok({ expiresAt: subscriber.entitle(expiresAt, purchasedAt) })),
    paidTo: (expiresAt: number, purchasedAt: number) => answered(() => ok({ libraries: subscriber.paidTo(expiresAt, purchasedAt) })),
    expiry: () => answered(() => ok(subscriber.expiresAt())),
    admit: (slug: string, expires: number, purchasedAt: number) => answered(() => ok({ admitted: true, added: subscriber.admit(slug, expires, clock(), purchasedAt) })),
    extend: (slug: string, expires: number) =>
      answered(() => {
        subscriber.extend(slug, expires)
        return ok({ extended: true })
      }),
    release: (slug: string) =>
      answered(() => {
        subscriber.release(slug)
        return ok({ released: true })
      }),
    claimLibrary: (id: string, purchasedAt: number) => answered(() => ok({ added: subscriber.claimLibrary(id, clock(), purchasedAt) })),
    releaseLibrary: (id: string) =>
      answered(() => {
        subscriber.releaseLibrary(id)
        return ok({ released: true })
      }),
    revoke: (through: number) => answered(() => ok(subscriber.revoke(through))),
    unrevoke: (through: number, expiresAt: number) => answered(() => ok({ expiresAt: subscriber.unrevoke(through, expiresAt) })),
  }
}

export type SubscriberRequests = ReturnType<typeof subscriberRequests>
