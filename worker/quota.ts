import { answered, ok, Refused, type Call } from './answer'
import type { Sql } from './library'
import { endOfDay, utcDay } from './wire.mjs'

/** The quota every free share counts against, whoever starts it. Not a hash, so no address's. */
export const EVERYONE = 'everyone'

/**
 * Free shares started from one IP address, by day, in a Durable Object named
 * from a hash of the address keyed with the Worker's secret (worker/shares);
 * or from everyone, in one named for that. The address itself is never
 * stored, and the object is deleted, table and all, at the end of the day
 * (index.ts QuotaObject).
 */
export class FreeQuota {
  private sql: Sql

  constructor(sql: Sql) {
    this.sql = sql
  }

  /** Made when it's needed, so the same object counts again once everything in it has been deleted. */
  private table() {
    this.sql.run('CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, n INTEGER NOT NULL)')
  }

  /** Counts one more today, or refuses with `refusal` once `limit` are used. Earlier days go. */
  spend(now: number, limit: number, refusal: string) {
    this.table()
    const today = utcDay(now)
    this.sql.run('DELETE FROM days WHERE day < ?', today)
    const used = Number(this.sql.all('SELECT n FROM days WHERE day = ?', today)[0]?.n ?? 0)
    if (used >= limit) throw new Refused(429, refusal)
    this.sql.run('INSERT INTO days (day, n) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET n = n + 1', today)
  }

  /** How many today, without counting one: nothing made where nothing's been counted. */
  used(now: number): number {
    if (this.sql.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'days'").length === 0) return 0
    return Number(this.sql.all('SELECT n FROM days WHERE day = ?', utcDay(now))[0]?.n ?? 0)
  }

  /** Gives today's back, for a share that couldn't be made after all. */
  refund(now: number) {
    this.table()
    this.sql.run('UPDATE days SET n = MAX(0, n - 1) WHERE day = ?', utcDay(now))
  }
}

/** A free quota's requests, for its Durable Object. `alarm` is when the object goes: at the end of a day counted in. */
export function quotaRequests(quota: FreeQuota, effects: { alarm(at: number): Promise<void> }, clock: () => number = Date.now) {
  return {
    spend: (limit: number, refusal: string) =>
      answered(async () => {
        const now = clock()
        quota.spend(now, limit, refusal)
        await effects.alarm(endOfDay(now))
        return ok({ spent: true })
      }),
    refund: () =>
      answered(() => {
        quota.refund(clock())
        return ok({ refunded: true })
      }),
    used: () => answered(() => ok({ used: quota.used(clock()) })),
  }
}

export type QuotaRequests = ReturnType<typeof quotaRequests>

/**
 * One more counted against each quota in turn. Refused by one, those before
 * it get theirs back and the refusal is returned; otherwise, a way to give
 * them all back, for something that couldn't be made after all.
 */
export async function spendEach(quotas: [QuotaRequests, number, string][]): Promise<{ refused: Call } | { refund: () => Promise<unknown> }> {
  const spent: QuotaRequests[] = []
  const refund = () => Promise.all(spent.map((quota) => quota.refund()))
  for (const [quota, limit, refusal] of quotas) {
    const result = await quota.spend(limit, refusal)
    if (result.status !== 200) {
      await refund()
      return { refused: result }
    }
    spent.push(quota)
  }
  return { refund }
}
