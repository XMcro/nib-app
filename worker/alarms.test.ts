import { describe, expect, it } from 'vitest'
import { armLibrary, handleAlarms, MAX_IDS, type AlarmKind } from './alarms'
import { frontDoor, type Routes } from './door'
import { Library, libraryRequests } from './library'
import { keptTo } from './paid'
import { sqlite } from './testing'

/**
 * The one-off that has every library and subscription asked once, so each gets the alarm it's deleted by
 * (worker/alarms). One nothing reaches again never got one, and was kept for ever (the server audit of 2026-11-23).
 */
const ID = 'a'.repeat(64)
const ADMIN = { Authorization: 'Bearer the-secret' }

/** `secret`: whether the Worker has its secret set at all. */
function server(secret = true) {
  const admin = secret ? 'the-secret' : undefined
  const armed: [AlarmKind, string][] = []
  const call = async (body: unknown, headers: Record<string, string> = ADMIN, method = 'POST') => {
    const response = await frontDoor(new Request('https://sync.nibprivacy.com/v1/alarms', { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(method === 'POST' && { body: JSON.stringify(body) }) }), {
      alarms: (asked: Request) =>
        handleAlarms(asked, {
          admin,
          arm: async (kind, id) => {
            if (id.startsWith('f')) throw new Error('not an id of this kind')
            armed.push([kind, id])
            return !id.startsWith('0')
          },
        }),
    } as Routes)
    return { status: response.status, body: await response.json() }
  }
  return { call, armed }
}

describe('setting the alarms of objects from before they had one', () => {
  it('isn’t there without the secret, or with none set, or for anything but a POST', async () => {
    const { call, armed } = server()
    expect((await call({ kind: 'library', ids: [ID] }, {})).status).toBe(404)
    expect((await call({ kind: 'library', ids: [ID] }, { Authorization: 'Bearer wrong' })).status).toBe(404)
    expect((await call(undefined, ADMIN, 'GET')).status).toBe(404)
    expect((await server(false).call({ kind: 'library', ids: [ID] })).status).toBe(404)
    expect((await server(false).call({ kind: 'library', ids: [ID] }, { Authorization: 'Bearer undefined' })).status).toBe(404)
    expect(armed).toEqual([])
  })

  it('asks each object named, and says which couldn’t be', async () => {
    const { call, armed } = server()
    const ids = [ID, 'b'.repeat(64), '0'.repeat(64), 'f'.repeat(64)]
    expect(await call({ kind: 'subscriber', ids })).toEqual({ status: 200, body: { asked: 2, failed: ['0'.repeat(64), 'f'.repeat(64)] } })
    expect(armed).toEqual(ids.slice(0, 3).map((id) => ['subscriber', id]))
  })

  it('takes only ids as Cloudflare lists them, of a kind it knows, and so many at once', async () => {
    const { call, armed } = server()
    expect((await call({ kind: 'share', ids: [ID] })).status).toBe(400)
    expect((await call({ kind: 'library', ids: ['not-an-id'] })).status).toBe(400)
    expect((await call({ kind: 'library', ids: [] })).status).toBe(400)
    expect((await call({ kind: 'library', ids: Array(MAX_IDS + 1).fill(ID) })).status).toBe(400)
    expect((await call({ kind: 'library', ids: Array(MAX_IDS).fill(ID) })).status).toBe(200)
    expect(armed).toHaveLength(MAX_IDS)
  })
})

// Asked in the EU's place alone, where an id from before was taken for an object holding nothing, it was counted as
// asked and the library itself never was (found checking the fix, 2026-11-23).
describe('a library’s id, asked in each place one may be kept', () => {
  const nothing = async () => ({ status: 200, body: { library: false, gone: false } })
  const refuses = () => {
    throw new TypeError('Invalid Durable Object ID')
  }
  const there = async () => ({ status: 200, body: { library: true, gone: false } })
  const deleted = async () => ({ status: 200, body: { library: false, gone: true } })

  it('is asked of the next when the first refuses it or holds nothing by it', async () => {
    expect(await armLibrary([refuses, there], ID)).toBe(true)
    expect(await armLibrary([nothing, there], ID)).toBe(true)
    expect(await armLibrary([nothing, deleted], ID)).toBe(true)
  })

  it('is asked no further once it’s found, and isn’t one if no place has it', async () => {
    const asked: string[] = []
    expect(await armLibrary([async (id) => (asked.push(`eu ${id}`), there()), async (id) => (asked.push(`before ${id}`), there())], ID)).toBe(true)
    expect(asked).toEqual([`eu ${ID}`])
    expect(await armLibrary([nothing, nothing], ID)).toBe(false)
    expect(await armLibrary([refuses, refuses], ID)).toBe(false)
    expect(await armLibrary([async () => Promise.reject(new Error('away')), nothing], ID)).toBe(false)
  })
})

describe('a library asked nothing but to set its alarm', () => {
  const NOW = Date.UTC(2026, 10, 23)
  const DAY = 86_400_000

  it('gets the alarm it never had: one last used before libraries had them', async () => {
    const library = new Library(sqlite())
    // As it was left: made and paid for, and never asked since alarms came.
    library.create('a'.repeat(64), NOW - 60 * DAY, NOW - 90 * DAY)
    const state = { alarm: undefined as number | null | undefined }
    const requests = libraryRequests(library, () => NOW, { alarm: async (at) => void (state.alarm = at) })
    expect(await requests.arm()).toEqual({ status: 200, body: { library: true, gone: false } })
    expect(state.alarm).toBe(keptTo(NOW - 60 * DAY))
  })

  it('makes nothing of an object that holds no library', async () => {
    const sql = sqlite()
    const state = { alarm: undefined as number | null | undefined }
    const requests = libraryRequests(new Library(sql), () => NOW, { alarm: async (at) => void (state.alarm = at) })
    expect(await requests.arm()).toEqual({ status: 200, body: { library: false, gone: false } })
    expect(state.alarm).toBeNull()
    expect(sql.all("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([])
  })

  // Wiped before a wipe dropped its tables, they stayed emptied, and nothing reached them again.
  it('takes one wiped before down to the mark of it, and it still can’t be made again', async () => {
    const sql = sqlite()
    const made = new Library(sql)
    made.create('a'.repeat(64), NOW + DAY, NOW)
    // As a wipe left one then: every row deleted, and the mark set.
    sql.transaction(() => {
      for (const table of ['meta', 'records', 'chunks', 'files', 'inbox', 'paid', 'taken']) sql.run(`DELETE FROM ${table}`)
      sql.run("INSERT INTO meta (k, v) VALUES ('gone', 1)")
    })
    const tables = () => sql.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((row) => String(row.name))
    expect(tables()).toHaveLength(8)
    const state = { alarm: undefined as number | null | undefined }
    const requests = libraryRequests(new Library(sql), () => NOW, { alarm: async (at: number | null) => void (state.alarm = at) })
    expect(await requests.arm()).toEqual({ status: 200, body: { library: false, gone: true } })
    expect(tables()).toEqual(['meta'])
    expect(state.alarm).toBeNull()
    expect((await requests.create('b'.repeat(64), NOW + DAY)).status).toBe(410)
    // Asked again it changes nothing; and woken again, it's the same.
    let writes = 0
    const run = sql.run
    sql.run = (...args) => (writes++, run(...args))
    await requests.arm()
    expect(writes).toBe(0)
    expect((await libraryRequests(new Library(sql), () => NOW).create('b'.repeat(64), NOW + DAY)).status).toBe(410)
  })
})
