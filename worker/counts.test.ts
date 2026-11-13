import { describe, expect, it } from 'vitest'
import { countRequests, Counts, handleCounts, MOST_A_DAY, SENDS_PER_NETWORK } from './counts'
import { frontDoor, type Routes } from './door'
import { sqlite } from './testing'

const NOW = Date.UTC(2026, 10, 10, 12)
const ADMIN = { Authorization: 'Bearer the-secret' }
const BODY = { day: '2026-11-09', device: 'iphone', version: '1.10.10', counts: { opened: 3, export_word: 1 } }

function server() {
  const counts = new Counts(sqlite())
  const used = new Map<string, number>()
  const names: string[] = []
  const ask = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    handleCounts(new Request(`https://sync.nibprivacy.com${path}`, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), {
      counts: countRequests(counts),
      quota: (key) => ({
        used: async () => ({ status: 200, body: { used: used.get(key) ?? 0 } }),
        spend: async (limit, refusal) => {
          names.push(key)
          const n = used.get(key) ?? 0
          if (n >= limit) return { status: 429, body: { error: refusal } }
          used.set(key, n + 1)
          return { status: 200, body: {} }
        },
        refund: async () => ({ status: 200, body: {} }),
      }),
      secret: 'the-secret',
      now: () => NOW,
    })
  const rows = async () => ((await (await ask('GET', '/v1/counts?from=2026-11-01', undefined, ADMIN))!.json()) as { rows: Record<string, unknown>[] }).rows
  return { ask, rows, names }
}

describe('the totals of how Nib is used', () => {
  it('add up across devices, counting times and devices apart', async () => {
    const { ask, rows } = server()
    expect((await ask('POST', '/v1/counts', BODY))!.status).toBe(204)
    expect((await ask('POST', '/v1/counts', { ...BODY, counts: { opened: 2 } }))!.status).toBe(204)
    expect(await rows()).toEqual([
      { day: '2026-11-09', device: 'iphone', version: '1.10.10', event: 'export_word', times: 1, devices: 1 },
      { day: '2026-11-09', device: 'iphone', version: '1.10.10', event: 'opened', times: 5, devices: 2 },
    ])
  })

  it('keep nothing that could tell who sent them', async () => {
    const { ask, rows, names } = server()
    await ask('POST', '/v1/counts', { ...BODY, id: 'device-123', name: 'Ann' })
    const kept = JSON.stringify(await rows())
    expect(kept).not.toContain('device-123')
    expect(kept).not.toContain('198.51.100.7')
    expect(names.join()).not.toContain('198.51.100.7')
  })

  it('drop a name that is not on the list, and a count no day could reach', async () => {
    const { ask, rows } = server()
    await ask('POST', '/v1/counts', { ...BODY, counts: { opened: 1, 'my novel title': 4, export_word: MOST_A_DAY + 1 } })
    expect((await rows()).map((row) => row.event)).toEqual(['opened'])
  })

  it('refuse anything that is not a recent day, a known device and a version', async () => {
    const { ask } = server()
    for (const change of [{ day: '2026-10-01' }, { day: '2026-11-12' }, { day: '2026-02-31' }, { day: 'yesterday' }, { device: 'windows' }, { version: 'x' }, { counts: [] }, { counts: { nothing: 1 } }]) {
      expect((await ask('POST', '/v1/counts', { ...BODY, ...change }))!.status).toBe(400)
    }
  })

  it('say no once a network has sent too many today', async () => {
    const { ask } = server()
    for (let i = 0; i < SENDS_PER_NETWORK; i++) await ask('POST', '/v1/counts', BODY)
    expect((await ask('POST', '/v1/counts', BODY))!.status).toBe(429)
  })

  it('can be read only with the secret', async () => {
    const { ask } = server()
    expect((await ask('GET', '/v1/counts?from=2026-11-01'))!.status).toBe(404)
    expect((await ask('GET', '/v1/counts?from=2026-11-01', undefined, { Authorization: 'Bearer wrong' }))!.status).toBe(404)
    expect((await ask('GET', '/v1/counts?from=2026-11-01', undefined, ADMIN))!.status).toBe(200)
  })

  it('cannot be sent from a page on another site, which can only post text/plain unasked', async () => {
    const { ask, rows } = server()
    expect((await ask('POST', '/v1/counts', BODY, { 'Content-Type': 'text/plain' }))!.status).toBe(415)
    expect(await rows()).toEqual([])
  })

  it('leave other routes alone', async () => {
    const response = await frontDoor(new Request('https://sync.nibprivacy.com/v1/changes', { method: 'POST', body: JSON.stringify(BODY) }), { sync: async () => new Response('sync') } as unknown as Routes)
    expect(await response.text()).toBe('sync')
  })
})
