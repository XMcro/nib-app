import { answered, ok, Refused, type Call } from './answer'
import type { Sql } from './library'
import { extendsPaid, keptTo } from './paid'

export const MAX_LIVE_SHARES = 50
/** Sync libraries one subscription pays for: a household's worth of devices, several times over. */
export const MAX_LIBRARIES = 5
/**
 * A library that hasn't renewed in this long holds no place: its devices
 * have likely stopped syncing it, and only they have the code to delete it.
 */
export const LIBRARY_IDLE_MS = 60 * 86_400_000
/**
 * New shares, and new sync libraries, one subscription makes in a day. Each one made and then revoked or deleted
 * leaves a mark of itself for good, and nothing bounded how many: revoking a share frees its place at once, and
 * so does deleting a library (the server audit of 2026-11-23). Far past what anyone shares or sets up in a day.
 */
export const NEW_SHARES_PER_DAY = 200
export const NEW_LIBRARIES_PER_DAY = 20
const DAY_MS = 86_400_000
/**
 * Past a refunded purchase's own date, and the newest one's, before the year they're kept is counted: a receipt
 * for the refunded purchase must find this still here to be refused, and its end is a period from a date that
 * Apple may put up to a day either side of where this reckons it.
 */
const PURCHASE_MARGIN_MS = 2 * DAY_MS
/** The longest a purchase's receipt runs past when it was bought: a year's subscription, in a leap year. */
const LONGEST_PERIOD_MS = 366 * DAY_MS
const REVOKED = 'This App Store purchase was refunded or revoked, so it no longer pays for Nib Plus.'

/**
 * One App Store subscription, filed under its original transaction id's hash:
 * how long it's paid for, its live shares, and the sync libraries it pays for.
 * Refunded or revoked (index.ts hears from the App Store), nothing bought up
 * to then pays for anything, whatever receipt from before turns up. A renewal
 * or purchase made since does: Apple files it under the same id.
 *
 * Kept KEPT_MONTHS past the last it was paid to, and then deleted, tables and
 * all (`forgetAt`, `retireSubscriber`): it was kept for ever, for everyone the
 * App Store had ever told of, with the ids of libraries long deleted (the
 * server audit of 2026-11-23). So its tables are made when it's first asked
 * anything, not with the object, and made again if it's asked after.
 */
export class Subscriber {
  private raw: Sql
  private made = false

  constructor(sql: Sql) {
    this.raw = sql
  }

  private get sql(): Sql {
    if (!this.made) this.tables()
    return this.raw
  }

  private tables() {
    const sql = this.raw
    sql.run('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v)')
    sql.run('CREATE TABLE IF NOT EXISTS shares (slug TEXT PRIMARY KEY, expires INTEGER NOT NULL)')
    sql.run('CREATE TABLE IF NOT EXISTS libraries (id TEXT PRIMARY KEY, renewed INTEGER NOT NULL)')
    // Which claim a place was last counted by, and for a library's, when it was last renewed before that claim took
    // it afresh (`release`, `releaseLibrary`). Added to subscriptions from before them.
    const has = (table: string, column: string) => sql.all(`PRAGMA table_info(${table})`).some((one) => one.name === column)
    if (!has('shares', 'claim')) sql.run('ALTER TABLE shares ADD COLUMN claim INTEGER NOT NULL DEFAULT 0')
    if (!has('libraries', 'claim')) sql.run('ALTER TABLE libraries ADD COLUMN claim INTEGER NOT NULL DEFAULT 0')
    if (!has('libraries', 'was')) sql.run('ALTER TABLE libraries ADD COLUMN was INTEGER')
    this.made = true
  }

  /**
   * When this is to be deleted if nothing is heard of the subscription again, null for an object holding
   * nothing at all (never asked, or deleted already). KEPT_MONTHS past the latest it knows of (what it's paid
   * to, its newest purchase, the purchase a refund was of, a library's last receipt) and its grace, which is past
   * the end of any receipt it would have to refuse: a subscription's period is a year at most. Not while a draft
   * it shared is still live. One that holds nothing is due at once.
   */
  forgetAt(now: number): number | null {
    if (!this.exists()) return null
    const at = (key: string, margin = 0) => {
      const value = this.get(key)
      return typeof value === 'number' ? value + margin : 0
    }
    const renewed = Number(this.sql.all('SELECT MAX(renewed) AS at FROM libraries')[0].at ?? 0)
    const live = Number(this.sql.all('SELECT MAX(expires) AS at FROM shares WHERE expires > ?', now)[0].at ?? 0)
    // From a refunded purchase's date, the longest its receipt can run: this may never have been told how far it did
    // (`most`: a record from before that was kept, a renewal it heard of only as refunded).
    // And from when a refund came, as a library it paid for counts (worker/library `deletesAt`), so that this is
    // here for as long as that library is: gone first, a receipt of the refunded purchase was taken for the library again.
    const dates = [renewed, at('expires'), at('most'), at('revoked', LONGEST_PERIOD_MS + PURCHASE_MARGIN_MS), at('purchased', PURCHASE_MARGIN_MS), at('refunded', PURCHASE_MARGIN_MS)]
    return Math.max(keptTo(Math.max(0, ...dates)), live)
  }

  /** Its object's storage has been deleted (`retireSubscriber`): asked again, it starts with nothing. */
  forgotten() {
    this.made = false
  }

  /** Whether anything has been kept here: asked only to read, an object that holds nothing is left holding nothing. */
  private exists(): boolean {
    return this.made || this.raw.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").length > 0
  }

  private get(key: string) {
    return this.exists() ? this.sql.all('SELECT v FROM meta WHERE k = ?', key)[0]?.v : undefined
  }

  private set(key: string, value: number) {
    this.sql.run('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', key, value)
  }

  private raise(key: string, value: number) {
    this.sql.run('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = MAX(v, excluded.v)', key, value)
  }

  /** One more of `what` made today (UTC), refused with `refusal` past `most`. */
  private madeToday(what: 'shares' | 'libraries', most: number, now: number, refusal: string) {
    const today = Math.floor(now / DAY_MS)
    const made = this.get(`${what} day`) === today ? Number(this.get(`${what} made`) ?? 0) : 0
    if (made >= most) throw new Refused(429, refusal)
    this.set(`${what} day`, today)
    this.set(`${what} made`, made + 1)
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
    this.paidTill(expiresAt)
    return this.expiresAt()!
  }

  /**
   * Paid to `expiresAt`, if that is further than it was. And the furthest any receipt it took ever ran to (`most`),
   * which a refund doesn't take back as it does `expires`: this is kept past the end of every receipt it has taken
   * (`forgetAt`), so that one of a refunded purchase finds it still here to be refused. Gone sooner, where another
   * subscription kept the library on, that receipt was taken for the library again.
   */
  private paidTill(expiresAt: number) {
    if (extendsPaid(this.expiresAt(), expiresAt)) this.set('expires', expiresAt)
    this.raise('most', expiresAt)
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
    this.madeToday('shares', NEW_SHARES_PER_DAY, now, 'You’ve shared as many drafts as one day takes. Try again tomorrow.')
    this.sql.run('INSERT INTO shares (slug, expires, claim) VALUES (?, ?, 1)', slug, expires)
    return true
  }

  /** Which claim a share's place was last counted by (`admit`), for the one that took it to give back, and no other. */
  placeOf(slug: string): number {
    return Number(this.sql.all('SELECT claim FROM shares WHERE slug = ?', slug)[0]?.claim ?? 0)
  }

  /** Keeps the count right when a share's expiry moves. Of one that holds nothing (deleted, `retireSubscriber`), nothing: asked, it isn't made again. */
  extend(slug: string, expires: number) {
    if (!this.exists()) return
    this.sql.run('UPDATE shares SET expires = ? WHERE slug = ?', expires, slug)
  }

  /**
   * A share's place, freed: revoked or expired, whatever counted it; or, by the request that took it and was then
   * refused, only if no other has counted on it since (`claim`, from `placeOf`). Two at once for one slug: the
   * second's share was made, the first's refused, and the first gave back the place the second's stood in.
   */
  release(slug: string, claim?: number) {
    if (!this.exists()) return
    if (claim === undefined) this.sql.run('DELETE FROM shares WHERE slug = ?', slug)
    else this.sql.run('DELETE FROM shares WHERE slug = ? AND claim = ?', slug, claim)
  }

  /**
   * Counts a sync library against the cap, as it is made or renews. Only
   * libraries renewed in the last LIBRARY_IDLE_MS count; one back after that
   * takes a place like a new one. True if it took a place just now.
   *
   * `expiresAt`: what its receipt is paid to, kept as `entitle` keeps a share's. Without it, a subscription that
   * only synced had no date but its purchase's and its last receipt's, was deleted a year past those while still
   * renewing, and the App Store's word of a late renewal then reached no library (the server audit of 2026-11-23).
   * `creating`: the library is being made, which is all the day's count is for: only one made leaves a mark for
   * good. Counted for every claim, a device still sending its receipt for a deleted library used up the day. And
   * counted for every one being made, whether or not its place is held already: a receipt sent for the same id at
   * the same moment took the place uncounted, and the library was then made uncounted too.
   */
  claimLibrary(id: string, now: number, purchasedAt = 0, { expiresAt, creating = false }: { expiresAt?: number; creating?: boolean } = {}): boolean {
    this.payingStill(purchasedAt)
    if (expiresAt !== undefined) this.paidTill(expiresAt)
    const since = now - LIBRARY_IDLE_MS
    const held = this.sql.all('SELECT renewed FROM libraries WHERE id = ?', id)[0]
    const making = () => creating && this.madeToday('libraries', NEW_LIBRARIES_PER_DAY, now, 'Too many new sync libraries for one day. Try again tomorrow.')
    if (held && Number(held.renewed) > since) {
      making()
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
    making()
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
    if (!this.exists()) return
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
  revoke(through: number, now = Date.now()): { libraries: string[]; shares: string[] } {
    this.raise('revoked', through)
    this.raise('refunded', now)
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

/** What a subscription does beyond its own tables: its alarm, for when it's to be deleted (null for none), and deleting it. */
export type SubscriberEffects = { alarm(at: number | null): Promise<void>; deleteAll(): Promise<void> }

/**
 * A subscription's requests, for its Durable Object. Every one sets the alarm for when it's deleted (`forgetAt`),
 * as the date moves with what's paid, and so that one from before there was an alarm gets it the first time it's asked.
 */
export function subscriberRequests(subscriber: Subscriber, clock: () => number = Date.now, effects: Pick<SubscriberEffects, 'alarm'> = { alarm: async () => {} }) {
  async function asked(request: () => Call): Promise<Call> {
    const answer = await answered(request)
    await effects.alarm(subscriber.forgetAt(clock()))
    return answer
  }
  return {
    entitle: (expiresAt: number, purchasedAt: number) => asked(() => ok({ expiresAt: subscriber.entitle(expiresAt, purchasedAt) })),
    paidTo: (expiresAt: number, purchasedAt: number) => asked(() => ok({ libraries: subscriber.paidTo(expiresAt, purchasedAt) })),
    expiry: () => asked(() => ok(subscriber.expiresAt())),
    admit: (slug: string, expires: number, purchasedAt: number) => asked(() => ok({ admitted: true, added: subscriber.admit(slug, expires, clock(), purchasedAt), claim: subscriber.placeOf(slug) })),
    extend: (slug: string, expires: number) =>
      asked(() => {
        subscriber.extend(slug, expires)
        return ok({ extended: true })
      }),
    release: (slug: string, claim?: number) =>
      asked(() => {
        subscriber.release(slug, claim)
        return ok({ released: true })
      }),
    claimLibrary: (id: string, purchasedAt: number, expiresAt?: number, creating = false) =>
      asked(() => ok({ added: subscriber.claimLibrary(id, clock(), purchasedAt, { expiresAt, creating }), claim: subscriber.claimOf(id) })),
    releaseLibrary: (id: string, claim?: number) =>
      asked(() => {
        subscriber.releaseLibrary(id, claim)
        return ok({ released: true })
      }),
    revoke: (through: number) => asked(() => ok(subscriber.revoke(through, clock()))),
    unrevoke: (through: number, expiresAt: number) => asked(() => ok({ expiresAt: subscriber.unrevoke(through, expiresAt) })),
  }
}

/**
 * A subscription's alarm, come due: if nothing has moved the date since (a renewal, a new purchase, a draft
 * shared), what's kept of it is deleted, the object's storage with it. Asked of again, it starts with nothing.
 */
export async function retireSubscriber(subscriber: Subscriber, now: number, effects: SubscriberEffects) {
  const at = subscriber.forgetAt(now)
  if (at === null) return
  if (at > now) return effects.alarm(at)
  await effects.deleteAll()
  subscriber.forgotten()
}

export type SubscriberRequests = ReturnType<typeof subscriberRequests>
