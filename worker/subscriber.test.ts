import { describe, expect, it } from 'vitest'
import { GRACE_MS, KEPT_MONTHS, keptTo } from './paid'
import { NEW_LIBRARIES_PER_DAY, retireSubscriber, Subscriber, subscriberRequests, type SubscriberEffects } from './subscriber'
import { sqlite } from './testing'

/**
 * What's kept of a subscription, and for how long. It was kept for ever: nothing deleted it, the App Store's word
 * of a renewal made one for every subscriber, synced or not, and it listed libraries long after they were deleted
 * (the server audit of 2026-11-23).
 */
const DAY = 86_400_000
const NOW = Date.UTC(2027, 0, 1)
const ID = '0123456789abcdef0123456789abcdef'

/** A real subscription, its alarm and its clock the test's, and what its object's deleteAll does. */
function object() {
  const sql = sqlite()
  const subscriber = new Subscriber(sql)
  const clock = { now: NOW }
  const state = { alarm: null as number | null, deleted: 0 }
  const tables = () => sql.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => String(row.name))
  const effects: SubscriberEffects = {
    alarm: async (at) => void (state.alarm = at),
    deleteAll: async () => {
      for (const table of tables()) sql.run(`DROP TABLE ${table}`)
      state.deleted++
    },
  }
  const requests = subscriberRequests(subscriber, () => clock.now, effects)
  return { sql, subscriber, clock, state, tables, requests, retire: () => retireSubscriber(subscriber, clock.now, effects) }
}

describe('what’s kept of a subscription', () => {
  it('is due to be deleted 12 months past what it was last paid to and its grace', async () => {
    expect(KEPT_MONTHS).toBe(12)
    const { requests, state } = object()
    await requests.paidTo(NOW + 30 * DAY, NOW - DAY)
    expect(state.alarm).toBe(keptTo(NOW + 30 * DAY))
    expect(state.alarm).toBeGreaterThan(NOW + 30 * DAY + GRACE_MS + 364 * DAY)
  })

  it('is deleted then, tables and all, and takes a later purchase afresh', async () => {
    const { requests, state, clock, retire, tables } = object()
    await requests.paidTo(NOW + 30 * DAY, NOW - DAY)
    await requests.claimLibrary(ID, NOW - DAY)
    clock.now = state.alarm! - 1
    await retire()
    expect(state.deleted).toBe(0)
    clock.now = state.alarm!
    await retire()
    expect(state.deleted).toBe(1)
    expect(tables()).toEqual([])
    // Asked only to read, it stays holding nothing, and has no alarm.
    expect((await requests.expiry()).body).toBeNull()
    expect(tables()).toEqual([])
    expect(state.alarm).toBeNull()
    // A purchase long after starts it again, with nothing of before.
    clock.now += 100 * DAY
    expect((await requests.paidTo(clock.now + 30 * DAY, clock.now)).body).toEqual({ libraries: [] })
    expect(state.alarm).toBe(keptTo(clock.now + 30 * DAY))
  })

  it('stays when it has been paid for again since its alarm was set', async () => {
    const { requests, state, clock, retire } = object()
    await requests.paidTo(NOW + 30 * DAY, NOW - DAY)
    const first = state.alarm!
    await requests.paidTo(NOW + 395 * DAY, NOW + 30 * DAY)
    clock.now = first
    await retire()
    expect(state.deleted).toBe(0)
    expect(state.alarm).toBe(keptTo(NOW + 395 * DAY))
  })

  it('is kept while a draft it shared is still live, and deleted when that has ended', async () => {
    const { requests, state, clock, retire } = object()
    await requests.entitle(NOW + 30 * DAY, NOW - DAY)
    const live = keptTo(NOW + 30 * DAY) + 20 * DAY
    await requests.admit('s'.repeat(22), live, NOW - DAY)
    expect(state.alarm).toBe(live)
    clock.now = keptTo(NOW + 30 * DAY)
    await retire()
    expect(state.deleted).toBe(0)
    expect(state.alarm).toBe(live)
    clock.now = live
    await retire()
    expect(state.deleted).toBe(1)
  })

  it('counts a refunded purchase, with nothing paid, from when it was bought: past the end of any receipt of it', async () => {
    const { sql, requests, state, clock, retire } = object()
    await requests.paidTo(NOW + 365 * DAY, NOW)
    // As one from before the furthest it was paid to was kept (`most`): only when it was bought says how far its receipts run.
    sql.run("DELETE FROM meta WHERE k = 'most'")
    await requests.revoke(NOW)
    // A year's subscription bought at NOW: its receipt ends by a year on, and this is kept a year past that end,
    // and two days: a year from the purchase alone, the receipt was taken again once this had gone, for a library
    // another subscription had kept on (found checking the fix, 2026-11-23).
    expect(state.alarm).toBe(keptTo(NOW + 368 * DAY))
    clock.now = keptTo(NOW + 365 * DAY)
    await retire()
    expect(state.deleted).toBe(0)
    expect((await requests.entitle(NOW + 365 * DAY, NOW)).status).toBe(403)
  })

  // Counted from the refunded purchase's own date alone, this was gone while the library it had paid for was still
  // kept, which counts from when the refund came: a receipt of that purchase was then taken for the library again
  // (found checking the fix, 2026-11-23).
  it('is kept as long as a library is that was refunded when it was: from when the refund came', async () => {
    const { sql, requests, state, clock, retire } = object()
    await requests.paidTo(NOW + 365 * DAY, NOW)
    // As one from before the furthest it was paid to was kept (`most`).
    sql.run("DELETE FROM meta WHERE k = 'most'")
    // A refund that comes late, more than a year after the purchase.
    clock.now = NOW + 400 * DAY
    await requests.revoke(NOW)
    expect(state.alarm).toBe(keptTo(NOW + 402 * DAY))
    // Where the library falls due, and not before it.
    clock.now = keptTo(NOW + 400 * DAY)
    await retire()
    expect(state.deleted).toBe(0)
    expect((await requests.claimLibrary(ID, NOW, NOW + 365 * DAY)).status).toBe(403)
  })

  // In a household, another subscription keeps the library on after this one's refund. Kept only from the refund,
  // this was gone first, and a receipt of the refunded year was then taken for the library again (found checking the fix, 2026-11-23).
  it('is kept past the end of every receipt it has taken, refunded or not', async () => {
    const { requests, state, clock, retire } = object()
    // A receipt that runs further than a year from the date its purchase is refunded by.
    await requests.claimLibrary(ID, NOW - 100 * DAY, NOW + 365 * DAY)
    clock.now = NOW + 30 * DAY
    await requests.revoke(NOW - 100 * DAY)
    expect((await requests.expiry()).body).toBe(0)
    expect(state.alarm).toBe(keptTo(NOW + 365 * DAY))
    // Where the library falls due if another paid it to 300 days on: this is still here, and still refuses.
    clock.now = keptTo(NOW + 300 * DAY)
    await retire()
    expect(state.deleted).toBe(0)
    expect((await requests.claimLibrary(ID, NOW - 100 * DAY, NOW + 365 * DAY)).status).toBe(403)
  })

  it('made by a library’s receipt alone, counts from then', async () => {
    const { requests, state } = object()
    await requests.claimLibrary(ID, NOW - 3 * DAY)
    expect(state.alarm).toBe(keptTo(NOW))
  })

  // Only its purchase and its last receipt were known of one that only synced: deleted a year past those while it
  // still renewed, the App Store's word of a late renewal then reached no library (the server audit of 2026-11-23).
  it('keeps what a library’s receipt is paid to, and counts from that', async () => {
    const { requests, state } = object()
    await requests.claimLibrary(ID, NOW - 300 * DAY, NOW + 65 * DAY)
    expect((await requests.expiry()).body).toBe(NOW + 65 * DAY)
    expect(state.alarm).toBe(keptTo(NOW + 65 * DAY))
    // Only ever extends.
    await requests.claimLibrary(ID, NOW - 300 * DAY, NOW + 5 * DAY)
    expect((await requests.expiry()).body).toBe(NOW + 65 * DAY)
  })

  // Each made its tables, with an alarm to delete them at once (the server audit of 2026-11-23).
  it('holding nothing, makes nothing of being told to let go of a library or a share, or of a share’s new expiry', async () => {
    const { requests, state, retire, tables } = object()
    await requests.releaseLibrary(ID)
    await requests.releaseLibrary(ID, 1)
    await requests.release('s'.repeat(22))
    await requests.release('s'.repeat(22), 1)
    await requests.extend('s'.repeat(22), NOW + DAY)
    expect(tables()).toEqual([])
    expect(state.alarm).toBeNull()
    await retire()
    expect(state.deleted).toBe(0)
  })

  it('never asked, has nothing to delete', async () => {
    const { state, retire, tables } = object()
    await retire()
    expect(state.deleted).toBe(0)
    expect(tables()).toEqual([])
  })
})

// Deleting a library frees its place at once, so making one and deleting it could be done for ever, each leaving
// a mark of itself for good (the server audit of 2026-11-23).
describe('how many new libraries one subscription makes in a day', () => {
  const idOf = (n: number) => n.toString(16).padStart(32, '0')
  /** As worker/sync asks for one being made (POST /v1/library). */
  const making = (requests: ReturnType<typeof object>['requests'], id: string) => requests.claimLibrary(id, NOW - DAY, undefined, true)

  it('is bounded, however many are deleted, and starts again the next day', async () => {
    const { requests, clock } = object()
    const made = []
    for (let n = 0; n < NEW_LIBRARIES_PER_DAY + 2; n++) {
      const claimed = await making(requests, idOf(n))
      made.push(claimed.status)
      await requests.releaseLibrary(idOf(n))
    }
    expect(made).toEqual([...Array(NEW_LIBRARIES_PER_DAY).fill(200), 429, 429])
    clock.now += DAY
    expect((await making(requests, idOf(999))).status).toBe(200)
  })

  // A receipt sent for the same new id at the same moment took its place, uncounted, and the library was then made
  // in a place already held, uncounted too: thirty made in a day (found checking the fix, 2026-11-23).
  it('counts one being made though a receipt has just taken its place', async () => {
    const { requests } = object()
    const made = []
    for (let n = 0; n < NEW_LIBRARIES_PER_DAY + 2; n++) {
      expect((await requests.claimLibrary(idOf(n), NOW - DAY)).body).toMatchObject({ added: true })
      made.push((await making(requests, idOf(n))).status)
      await requests.releaseLibrary(idOf(n))
    }
    expect(made).toEqual([...Array(NEW_LIBRARIES_PER_DAY).fill(200), 429, 429])
  })

  // A device still on a deleted library's code sends its receipt at every look. Each took a place afresh, was
  // counted, found no library and gave the place back: some nineteen looks, and the subscription could make no
  // library that day, nor a household's other device join a new code (the server audit of 2026-11-23).
  it('doesn’t count a receipt sent for a library that isn’t being made', async () => {
    const { requests } = object()
    for (let n = 0; n < NEW_LIBRARIES_PER_DAY + 5; n++) {
      const claimed = await requests.claimLibrary(ID, NOW - DAY)
      expect(claimed.body).toMatchObject({ added: true })
      await requests.releaseLibrary(ID, (claimed.body as { claim: number }).claim)
    }
    expect((await making(requests, idOf(1))).status).toBe(200)
  })
})
