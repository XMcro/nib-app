import { describe, expect, it } from 'vitest'
import { frontDoor, type Routes } from './door'
import { handleSweeps, KEPT_DAYS, MOST_ROWS, sweepRequests, Sweeps, type Gone } from './sweeps'
import { sqlite } from './testing'

/**
 * The paper trail of files the server's own check deletes (worker/sweeps): asked for with the check itself, so
 * that what it deletes, and that it ran, can be read back and not only trusted (the server audit of 2026-11-23, L13).
 */
const DAY = 86_400_000
const NOW = Date.UTC(2026, 11, 1, 3)
const HOME = 'a'.repeat(64)
const file = (at: number, k = 'K'.repeat(43), why: Gone['why'] = 'unused'): Gone => ({ at, why, home: HOME, k, size: 65_564 })

/** The trail, and its route through the front door, with the Worker's secret or without. */
function trail(secret: string | undefined = 'the-secret') {
  const clock = { now: NOW }
  const sql = sqlite()
  const requests = sweepRequests(new Sweeps(sql), () => clock.now)
  const read = async (from: string, headers: Record<string, string> = { Authorization: 'Bearer the-secret' }, method = 'GET') => {
    const response = await frontDoor(new Request(`https://sync.nibprivacy.com/v1/sweeps?from=${from}`, { method, headers }), { sweeps: (asked: Request) => handleSweeps(asked, { sweeps: requests, secret }) } as Routes)
    return { status: response.status, body: (await response.json()) as { checks: unknown[]; deleted: Gone[]; more: boolean } }
  }
  return { clock, sql, requests, read }
}

describe('the trail of files the server’s check deleted', () => {
  it('keeps each run of the check, and each file it deleted with why, to be read back from a day on', async () => {
    const { requests, read, clock } = trail()
    await requests.checked({ at: NOW, looked: 40, found: 0, deleted: 0, bytes: 0, whole: true })
    clock.now = NOW + DAY
    await requests.deleted([file(NOW + DAY, 'A'.repeat(43), 'no library'), { ...file(NOW + DAY, 'B'.repeat(43), 'not listed'), left: true }])
    await requests.checked({ at: NOW + DAY, looked: 42, found: 2, deleted: 1, bytes: 65_564, whole: false })
    expect(await read('2026-12-01')).toEqual({
      status: 200,
      body: {
        checks: [
          { at: NOW, looked: 40, found: 0, deleted: 0, bytes: 0, whole: true },
          { at: NOW + DAY, looked: 42, found: 2, deleted: 1, bytes: 65_564, whole: false },
        ],
        // The second was only found, by a check that was looking: it's still there.
        deleted: [file(NOW + DAY, 'A'.repeat(43), 'no library'), { ...file(NOW + DAY, 'B'.repeat(43), 'not listed'), left: true }],
        more: false,
      },
    })
    // From the second day, only the second day's.
    expect((await read('2026-12-02')).body.checks).toHaveLength(1)
    expect((await read('2026-12-03')).body).toEqual({ checks: [], deleted: [], more: false })
  })

  it('isn’t there without the secret, or with none set, or for anything but a GET; and wants a real day', async () => {
    const { requests, read } = trail()
    await requests.deleted([file(NOW)])
    expect((await read('2026-12-01', {})).status).toBe(404)
    expect((await read('2026-12-01', { Authorization: 'Bearer wrong' })).status).toBe(404)
    expect((await read('2026-12-01', { Authorization: 'Bearer the-secret' }, 'DELETE')).status).toBe(404)
    expect((await trail('').read('2026-12-01', { Authorization: 'Bearer ' })).status).toBe(404)
    expect((await trail(undefined as unknown as string).read('2026-12-01', { Authorization: 'Bearer undefined' })).status).toBe(404)
    expect((await read('yesterday')).status).toBe(400)
    expect((await read('2026-02-31')).status).toBe(400)
    expect((await read('2026-12-01')).body.deleted).toHaveLength(1)
  })

  it(`is kept ${KEPT_DAYS} days, and trimmed as more is written`, async () => {
    const { requests, sql, clock } = trail()
    await requests.deleted([file(NOW)])
    await requests.checked({ at: NOW, looked: 1, found: 1, deleted: 1, bytes: 65_564, whole: true })
    clock.now = NOW + KEPT_DAYS * DAY
    await requests.checked({ at: clock.now, looked: 0, found: 0, deleted: 0, bytes: 0, whole: true })
    expect([sql.all('SELECT at FROM gone'), sql.all('SELECT at FROM checks')]).toEqual([[{ at: NOW }], [{ at: NOW }, { at: clock.now }]])
    clock.now += 1
    await requests.deleted([file(clock.now)])
    expect([sql.all('SELECT at FROM gone'), sql.all('SELECT at FROM checks')]).toEqual([[{ at: clock.now }], [{ at: clock.now - 1 }]])
  })

  it('gives the newest of more deletions than one answer carries, and says there are more', async () => {
    const { requests, read } = trail()
    await requests.deleted(Array.from({ length: MOST_ROWS + 3 }, (_, n) => file(NOW + n)))
    const { body } = await read('2026-12-01')
    expect([body.deleted.length, body.more]).toEqual([MOST_ROWS, true])
    expect([body.deleted[0].at, body.deleted.at(-1)!.at]).toEqual([NOW + 3, NOW + MOST_ROWS + 2])
  })

  it('keeps where the check stopped, for the next run to go on from, and nothing once a run finishes', async () => {
    const { requests, sql } = trail()
    expect((await requests.position()).body).toEqual({ next: '' })
    await requests.checked({ at: NOW, looked: 9, found: 0, deleted: 0, bytes: 0, whole: false }, `${HOME}/${'K'.repeat(43)}`)
    expect((await sweepRequests(new Sweeps(sql)).position()).body).toEqual({ next: `${HOME}/${'K'.repeat(43)}` })
    await requests.checked({ at: NOW, looked: 9, found: 0, deleted: 0, bytes: 0, whole: true })
    expect((await requests.position()).body).toEqual({ next: '' })
  })

  it('keeps nothing but what it’s given, and survives being woken', async () => {
    const { requests, sql } = trail()
    await requests.deleted([file(NOW)])
    expect(Object.keys(sql.all('SELECT * FROM gone')[0]).sort()).toEqual(['at', 'home', 'id', 'k', 'left', 'size', 'why'])
    expect((await sweepRequests(new Sweeps(sql)).since(0)).body).toMatchObject({ deleted: [file(NOW)] })
  })
})
