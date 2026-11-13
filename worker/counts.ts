import { COUNTED, DEVICES, VERSION, type Device } from '../src/lib/reported'
import { ok, type Call } from './answer'
import { cors, isAdmin, isJson, json, networksOf, readJson } from './http'
import type { Sql } from './library'
import type { QuotaRequests } from './quota'
import { realDay } from './wire.mjs'

/**
 * How Nib is used, as totals: for each day, kind of device, version and thing
 * done, how many times, and on how many devices. A writer who said yes sends
 * one day's totals at a time (lib/counts), and the server adds them to what
 * it has and keeps nothing of the request: no id, no address, nothing that
 * could tell two days' totals came from the same device.
 */

const KNOWN = new Set<string>(COUNTED)
/** Over a day's real use of anything, so a forged request can't swamp the totals. */
export const MOST_A_DAY = 5000
/** Sends from one network in a day: a device sends one a day, and catches up after a week away. */
export const SENDS_PER_NETWORK = 200
const DAY_MS = 86_400_000
/** A day this long ago is too old to believe; a day ahead is a time zone. */
const OLDEST_DAYS = 8

export class Counts {
  private sql: Sql

  constructor(sql: Sql) {
    this.sql = sql
    this.sql.run(`CREATE TABLE IF NOT EXISTS counts (
      day TEXT NOT NULL, device TEXT NOT NULL, version TEXT NOT NULL, event TEXT NOT NULL,
      times INTEGER NOT NULL, devices INTEGER NOT NULL,
      PRIMARY KEY (day, device, version, event)
    ) WITHOUT ROWID`)
  }

  add(day: string, device: Device, version: string, counts: [string, number][]) {
    this.sql.transaction(() => {
      for (const [event, times] of counts) {
        this.sql.run(
          `INSERT INTO counts (day, device, version, event, times, devices) VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT (day, device, version, event) DO UPDATE SET times = times + excluded.times, devices = devices + 1`,
          day,
          device,
          version,
          event,
          times,
        )
      }
    })
  }

  since(day: string) {
    return this.sql.all('SELECT day, device, version, event, times, devices FROM counts WHERE day >= ? ORDER BY day, event, device, version', day)
  }
}

/** The totals' requests, for their Durable Object. */
export function countRequests(counts: Counts) {
  return {
    async add(day: string, device: Device, version: string, list: [string, number][]): Promise<Call> {
      counts.add(day, device, version, list)
      return ok({})
    },
    since: async (day: string): Promise<Call> => ok({ rows: counts.since(day) }),
  }
}

type CountRequests = ReturnType<typeof countRequests>

type Deps = {
  counts: CountRequests
  quota(key: string): QuotaRequests
  /** COINS_ADMIN, the Worker's secret: reads the totals, and keys the name of the quota. */
  secret?: string
  now(): number
}

const isRecent = (day: string, now: number) => {
  if (!realDay(day)) return false
  const age = (now - Date.parse(day)) / DAY_MS
  return age >= -1 && age <= OLDEST_DAYS
}

/** A request for the totals, answered. */
export async function handleCounts(request: Request, deps: Deps): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'POST') {
    if (!isJson(request)) return json(request, 415, { error: 'JSON, please.' })
    const body = await readJson(request, 8000)
    const { day, device, version, counts } = body ?? {}
    if (typeof day !== 'string' || !isRecent(day, deps.now()) || !DEVICES.includes(device as Device) || typeof version !== 'string' || !VERSION.test(version) || !counts || typeof counts !== 'object' || Array.isArray(counts)) {
      return json(request, 400, { error: 'A day, a device, a version and its counts, please.' })
    }
    const kept = Object.entries(counts).filter((entry): entry is [string, number] => KNOWN.has(entry[0]) && Number.isInteger(entry[1]) && entry[1] > 0 && entry[1] <= MOST_A_DAY)
    if (!kept.length) return json(request, 400, { error: 'Nothing to count.' })
    const [here] = await networksOf(request, deps.secret, 'nib-quota', (network) => `counts ${network}`)
    const quota = deps.quota(here)
    const spent = await quota.spend(SENDS_PER_NETWORK, 'Too many today.')
    if (spent.status !== 200) return json(request, spent.status, spent.body)
    await deps.counts.add(day, device as Device, version, kept)
    return new Response(null, { status: 204, headers: cors(request) })
  }
  if (request.method === 'GET') {
    if (!(await isAdmin(request, deps.secret))) return json(request, 404, { error: 'Not found.' })
    const from = url.searchParams.get('from') ?? ''
    if (!realDay(from)) return json(request, 400, { error: 'From which day?' })
    const read = await deps.counts.since(from)
    return json(request, read.status, read.body)
  }
  return json(request, 404, { error: 'Not found.' })
}
