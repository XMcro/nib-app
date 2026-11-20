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
    // Which claim a place was last counted by, and for a library's, when it was last renewed before that claim took
    // it afresh (`release`, `releaseLibrary`). Added to subscriptions from before them.
    const has = (table: string, column: string) => sql.all(`PRAGMA table_info(${table})`).some((one) => one.name === column)
    if (!has('shares', 'claim')) sql.run('ALTER TABLE shares ADD COLUMN claim INTEGER NOT NULL DEFAULT 0')
    if (!has('libraries', 'claim')) sql.run('ALTER TABLE libraries ADD COLUMN claim INTEGER NOT NULL DEFAULT 0')
    if (!has('libraries', 'was')) sql.run('ALTER TABLE libraries ADD COLUMN was INTEGER')
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
    if (this.sql.all('SELECT 1 FROM shares WHERE slug = ?', slug).length) {
      // Counted on by this request too: no longer the first one's alone to give back.
      this.sql.run('UPDATE shares SET claim = claim + 1 WHERE slug = ?', slug)
      return false
    }
    const live = Number(this.sql.all('SELECT COUNT(*) AS live FROM shares')[0].live)
    if (live >= MAX_LIVE_SHARES) throw new Refused(429, `You can have ${MAX_LIVE_SHARES} drafts shared at once. Revoke one to share another.`)
    this.sql.run('INSERT INTO shares (slug, expires, claim) VALUES (?, ?, 1)', slug, expires)
    return true
  }

  /** Which claim a share's place was last counted by (`admit`), for the one that took it to give back, and no other. */
  placeOf(slug: string): number {
    return Number(this.sql.all('SELECT claim FROM shares WHERE slug = ?', slug)[0]?.claim ?? 0)
  }

  /** Keeps the count right when a share's expiry moves. */
  extend(slug: string, expires: number) {
    this.sql.run('UPDATE shares SET expires = ? WHERE slug = ?', expires, slug)
  }

  /**
   * A share's place, freed: revoked or expired, whatever counted it; or, by the request that took it and was then
   * refused, only if no other has counted on it since (`claim`, from `placeOf`). Two at once for one slug: the
   * second's share was made, the first's refused, and the first gave back the place the second's stood in.
   */
  release(slug: string, claim?: number) {
    if (claim === undefined) this.sql.run('DELETE FROM shares WHERE slug = ?', slug)
    else this.sql.run('DELETE FROM shares WHERE slug = ? AND claim = ?', slug, claim)
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
      // Counted on by this request too: no longer an earlier one's alone to give back.
      this.sql.run('UPDATE libraries SET renewed = ?, claim = claim + 1, was = NULL WHERE id = ?', now, id)
      return false
    }
    const current = Number(this.sql.all('SELECT COUNT(*) AS n FROM libraries WHERE renewed > ? AND id != ?', since, id)[0].n)
    if (current >= MAX_LIBRARIES) {
      throw new Refused(
        403,
        `One Nib Plus subscription syncs up to ${MAX_LIBRARIES} libraries at a time, and ${MAX_LIBRARIES} others have been in use in the last 60 days. Delete the server copy of one you no longer use, or try again once one has gone 60 days unused.`,
      )
    }
    // One gone idle keeps when it was last renewed, to be put back as it was if this claim is refused.
    this.sql.run(
      'INSERT INTO libraries (id, renewed, claim, was) VALUES (?, ?, 1, NULL) ON CONFLICT (id) DO UPDATE SET was = renewed, renewed = excluded.renewed, claim = claim + 1',
      id,
      now,
    )
    return true
  }

  /** Which claim a library's place was last counted by (`claimLibrary`), for the one that took it to give back, and no other. */
  claimOf(id: string): number {
    return Number(this.sql.all('SELECT claim FROM libraries WHERE id = ?', id)[0]?.claim ?? 0)
  }

  /**
   * A library's place, freed: deleted from the server, whatever counted it; or, by the request that took it and
   * was then refused (`claim`, from `claimOf`), given back as that claim found it, and only if no other has
   * counted on it since. One that had only gone idle goes back to being idle: deleted, it was a library still
   * paid for that no refund could reach, and one receipt with the wrong code did it.
   */
  releaseLibrary(id: string, claim?: number) {
    if (claim === undefined) return void this.sql.run('DELETE FROM libraries WHERE id = ?', id)
    const held = this.sql.all('SELECT claim, was FROM libraries WHERE id = ?', id)[0]
    if (!held || Number(held.claim) !== claim) return
    if (held.was === null) this.sql.run('DELETE FROM libraries WHERE id = ?', id)
    else this.sql.run('UPDATE libraries SET renewed = was, was = NULL WHERE id = ?', id)
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
    admit: (slug: string, expires: number, purchasedAt: number) => answered(() => ok({ admitted: true, added: subscriber.admit(slug, expires, clock(), purchasedAt), claim: subscriber.placeOf(slug) })),
    extend: (slug: string, expires: number) =>
      answered(() => {
        subscriber.extend(slug, expires)
        return ok({ extended: true })
      }),
    release: (slug: string, claim?: number) =>
      answered(() => {
        subscriber.release(slug, claim)
        return ok({ released: true })
      }),
    claimLibrary: (id: string, purchasedAt: number) => answered(() => ok({ added: subscriber.claimLibrary(id, clock(), purchasedAt), claim: subscriber.claimOf(id) })),
    releaseLibrary: (id: string, claim?: number) =>
      answered(() => {
        subscriber.releaseLibrary(id, claim)
        return ok({ released: true })
      }),
    revoke: (through: number) => answered(() => ok(subscriber.revoke(through))),
    unrevoke: (through: number, expiresAt: number) => answered(() => ok({ expiresAt: subscriber.unrevoke(through, expiresAt) })),
  }
}

export type SubscriberRequests = ReturnType<typeof subscriberRequests>
