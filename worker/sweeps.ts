import { ok, type Call } from './answer'
import { isAdmin, json } from './http'
import type { Sql } from './library'
import { realDay } from './wire.mjs'

/**
 * The paper trail of the server's own check for files nothing uses: each time the check ran, and each file it
 * deleted from the store, with why. A file a library's devices no longer use stayed on the server till the library
 * was deleted, and nothing but an audit looked (the server audit of 2026-11-23, L13); now a check looks every day,
 * and what it deletes can be read back here (`npm run sweeps`).
 *
 * Nothing of a writer's is in it: a file is named as the server knows it, by its library's object and a key made
 * on the device, neither of which the server can turn into a library's code or a document. Kept KEPT_DAYS, then
 * trimmed as more is written.
 *
 *   GET /v1/sweeps?from=YYYY-MM-DD   with COINS_ADMIN
 */

/**
 * Why a file was deleted: its folder in the store has no library behind it; its library doesn't list it; or its
 * library's devices have none of them named it in a document or its history for as long as that takes.
 */
export const WHY = ['no library', 'not listed', 'unused'] as const
export type Why = (typeof WHY)[number]
/**
 * A file deleted: when, why, the folder it was in (its library's object), its name there, and its size. `left`: the
 * check was only looking (worker/filecheck `looks`), and the file is still there.
 */
export type Gone = { at: number; why: Why; home: string; k: string; size: number; left?: true }
/**
 * One run of the check: when, how many files it looked at, how many it found that nothing accounts for, and how
 * many of those it deleted, with their size. `whole`: it got through the whole store, and every library it asked answered.
 */
export type Checked = { at: number; looked: number; found: number; deleted: number; bytes: number; whole: boolean }

const DAY_MS = 86_400_000
export const KEPT_DAYS = 365
/** The most rows one answer carries, the newest: past it, ask from a later day. */
export const MOST_ROWS = 5000

export class Sweeps {
  private sql: Sql

  constructor(sql: Sql) {
    this.sql = sql
    sql.run('CREATE TABLE IF NOT EXISTS checks (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, looked INTEGER NOT NULL, found INTEGER NOT NULL, deleted INTEGER NOT NULL, bytes INTEGER NOT NULL, whole INTEGER NOT NULL)')
    sql.run('CREATE TABLE IF NOT EXISTS gone (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, why TEXT NOT NULL, home TEXT NOT NULL, k TEXT NOT NULL, size INTEGER NOT NULL, left INTEGER NOT NULL)')
    sql.run('CREATE INDEX IF NOT EXISTS gone_at ON gone (at)')
    // Where in the store the last run of the check stopped, for the next to go on from (`position`).
    sql.run('CREATE TABLE IF NOT EXISTS place (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
  }

  private trim(now: number) {
    const oldest = now - KEPT_DAYS * DAY_MS
    this.sql.run('DELETE FROM checks WHERE at < ?', oldest)
    this.sql.run('DELETE FROM gone WHERE at < ?', oldest)
  }

  /** Files the check is deleting, written down: before they go, so that none goes unwritten (worker/filecheck). */
  deleted(files: Gone[], now: number) {
    this.sql.transaction(() => {
      this.trim(now)
      for (const { at, why, home, k, size, left } of files) {
        // One only found, by a check that's looking, is written down the once: found again each day, it filled the trail.
        if (left && this.sql.all('SELECT 1 FROM gone WHERE home = ? AND k = ? AND why = ? AND left = 1 LIMIT 1', home, k, why).length > 0) continue
        this.sql.run('INSERT INTO gone (at, why, home, k, size, left) VALUES (?, ?, ?, ?, ?, ?)', at, why, home, k, size, left ? 1 : 0)
      }
    })
  }

  /** Files written down as deleted that the store then wouldn't delete: still there, and said so. */
  undeleted(files: Gone[]) {
    this.sql.transaction(() => {
      for (const { at, home, k } of files) this.sql.run('UPDATE gone SET left = 1 WHERE at = ? AND home = ? AND k = ?', at, home, k)
    })
  }

  /** The name in the store the last run stopped after; none if it finished, or there's been no run. */
  position(): string {
    return String(this.sql.all("SELECT v FROM place WHERE k = 'next'")[0]?.v ?? '')
  }

  /**
   * A run of the check, written down, whether or not it deleted anything: that it ran is what the trail is for.
   * `next`: the name in the store it stopped after, for the next run to go on from; none if it finished.
   */
  checked(check: Checked, now: number, next = '') {
    this.sql.transaction(() => {
      this.trim(now)
      this.sql.run("INSERT INTO place (k, v) VALUES ('next', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", next)
      this.sql.run('INSERT INTO checks (at, looked, found, deleted, bytes, whole) VALUES (?, ?, ?, ?, ?, ?)', check.at, check.looked, check.found, check.deleted, check.bytes, check.whole ? 1 : 0)
    })
  }

  /** Everything written since `from`, oldest first; `more` if there were too many deletions for one answer, which then holds the newest. */
  since(from: number): { checks: Checked[]; deleted: Gone[]; more: boolean } {
    const checks = this.sql
      .all('SELECT at, looked, found, deleted, bytes, whole FROM checks WHERE at >= ? ORDER BY at, id', from)
      .map((row) => ({ at: Number(row.at), looked: Number(row.looked), found: Number(row.found), deleted: Number(row.deleted), bytes: Number(row.bytes), whole: row.whole === 1 }))
    const rows = this.sql.all('SELECT at, why, home, k, size, left FROM gone WHERE at >= ? ORDER BY at DESC, id DESC LIMIT ?', from, MOST_ROWS + 1)
    const deleted = rows
      .slice(0, MOST_ROWS)
      .reverse()
      .map((row): Gone => ({ at: Number(row.at), why: String(row.why) as Why, home: String(row.home), k: String(row.k), size: Number(row.size), ...(row.left === 1 ? { left: true as const } : {}) }))
    return { checks, deleted, more: rows.length > MOST_ROWS }
  }
}

/** The trail's requests, for its Durable Object. Written only by the Worker's own check; read only with the secret (`handleSweeps`). */
export function sweepRequests(sweeps: Sweeps, clock: () => number = Date.now) {
  return {
    async deleted(files: Gone[]): Promise<Call> {
      sweeps.deleted(files, clock())
      return ok({})
    },
    async checked(check: Checked, next = ''): Promise<Call> {
      sweeps.checked(check, clock(), next)
      return ok({})
    },
    async undeleted(files: Gone[]): Promise<Call> {
      sweeps.undeleted(files)
      return ok({})
    },
    position: async (): Promise<Call> => ok({ next: sweeps.position() }),
    since: async (from: number): Promise<Call> => ok(sweeps.since(from)),
  }
}

export type SweepRequests = ReturnType<typeof sweepRequests>

/** The trail, read: with the secret, or it's not found, as the codes' own routes are (worker/coins). */
export async function handleSweeps(request: Request, deps: { sweeps: Pick<SweepRequests, 'since'>; secret: string | undefined }): Promise<Response> {
  if (!(await isAdmin(request, deps.secret)) || request.method !== 'GET') return json(request, 404, { error: 'Not found.' })
  const from = new URL(request.url).searchParams.get('from') ?? ''
  if (!realDay(from)) return json(request, 400, { error: 'From which day?' })
  const read = await deps.sweeps.since(Date.parse(from))
  return json(request, read.status, read.body)
}
