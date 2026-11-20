import { describe, expect, it } from 'vitest'
import { frontDoor, type Routes } from './door'
import { sha256 } from './http'
import { verifySigned } from './jws'
import { Library, libraryRequests } from './library'
import { handleNotification, type NotificationDeps } from './notifications'
import { readShare, Share, shareRequests } from './share'
import { Subscriber, subscriberRequests } from './subscriber'
import { appStoreSigned, sqlite, testRoot } from './testing'

const NOW = Date.UTC(2027, 0, 1)
const DAY = 86_400_000
const AUTH = 'a'.repeat(64)
const SLUG = 'S'.repeat(22)
const TRANSACTION = {
  bundleId: 'app.nib.ios',
  productId: 'app.nib.plus.yearly',
  originalTransactionId: '2000000123456789',
  purchaseDate: NOW - DAY,
  expiresDate: NOW + 30 * DAY,
  environment: 'Production',
}

/** A subscription paying for one library and one share, and the endpoint that hears from the App Store. */
async function world() {
  const key = await sha256(TRANSACTION.originalTransactionId)
  const subscriber = new Subscriber(sqlite())
  subscriber.entitle(TRANSACTION.expiresDate, TRANSACTION.purchaseDate)
  subscriber.claimLibrary('library-1', NOW, TRANSACTION.purchaseDate)
  subscriber.admit(SLUG, NOW + 30 * DAY, NOW, TRANSACTION.purchaseDate)
  const library = new Library(sqlite())
  library.create(AUTH, TRANSACTION.expiresDate, NOW, key)
  const share = new Share(sqlite())
  share.create({ slug: SLUG, ownerHash: 'o'.repeat(64), subscriber: key, days: 30, entitledUntil: TRANSACTION.expiresDate, doc: 'sealed' }, NOW)
  const subscriberStub = subscriberRequests(subscriber, () => NOW)
  const deps: NotificationDeps = {
    verify: (jws) => verifySigned(jws, { roots: [testRoot], now: NOW }),
    subscriber: (of) => (of === key ? subscriberStub : subscriberRequests(new Subscriber(sqlite()), () => NOW)),
    library: () => libraryRequests(library, () => NOW),
    share: () => shareRequests(share, { subscriber: () => subscriberStub, alarm: async () => {} }, () => NOW),
    now: () => NOW,
  }
  const send = async (signedPayload: string) =>
    (await handleNotification(new Request('https://nib.test/v1/app-store/notifications', { method: 'POST', body: JSON.stringify({ signedPayload }) }), deps)).status
  const reading = () => readShare(share, NOW, async () => subscriber.expiresAt()).then(() => 'served', () => 'refused')
  return { send, library, subscriber, reading, deps }
}

const notification = async (type: string, key?: string, transaction: Record<string, unknown> = TRANSACTION) =>
  appStoreSigned(
    {
      notificationType: type,
      notificationUUID: 'b0b5d2a6-0000-4000-8000-000000000001',
      data: { bundleId: 'app.nib.ios', environment: 'Production', signedTransactionInfo: await appStoreSigned({ ...transaction, revocationDate: NOW }) },
      version: '2.0',
      signedDate: NOW,
    },
    key,
  )

describe('App Store Server Notifications', () => {
  // A refund changed nothing: the receipt went on paying for sync and shares until it expired.
  it.each(['REFUND', 'REVOKE'])('take back what a %s purchase was paying for, however often they come', async (type) => {
    const { send, library, subscriber, reading } = await world()
    expect(await reading()).toBe('served')
    expect(await send(await notification(type))).toBe(200)
    expect(library.status(AUTH, NOW).entitled).toBe(false)
    expect(await reading()).toBe('refused')
    expect(() => subscriber.entitle(NOW + 60 * DAY, TRANSACTION.purchaseDate)).toThrow(/refunded/)
    expect(await send(await notification(type))).toBe(200)
    expect(library.status(AUTH, NOW).entitled).toBe(false)
  })

  // Apple keeps the original transaction id across renewals and purchases
  // made again, so one refund used to refuse that subscriber for good.
  it('leave a purchase made after the refunded one paying', async () => {
    const { send, subscriber } = await world()
    expect(await send(await notification('REFUND'))).toBe(200)
    expect(() => subscriber.entitle(NOW + 60 * DAY, TRANSACTION.purchaseDate)).toThrow(/refunded/)
    expect(subscriber.entitle(NOW + 60 * DAY, NOW)).toBe(NOW + 60 * DAY)
  })

  // A refund of last month cut off sync and shares this month's renewal was
  // paying for, until the device happened to send that receipt again: it
  // only sends one when it changes, so not until Nib was next launched.
  it('leave what a later renewal pays for running when an earlier purchase is refunded', async () => {
    const { send, library, subscriber, reading } = await world()
    subscriber.entitle(NOW + 60 * DAY, NOW) // this month's renewal, reported
    expect(await send(await notification('REFUND'))).toBe(200)
    expect(library.status(AUTH, NOW).entitled).toBe(true)
    expect(await reading()).toBe('served')
    expect(() => subscriber.entitle(NOW + 30 * DAY, TRANSACTION.purchaseDate)).toThrow(/refunded/)
  })

  // A library used from two Apple IDs, a household's, is paid by whichever
  // reported last. A refund on the other cut it off.
  it('leave a library another subscription now pays for running', async () => {
    const { send, library } = await world()
    library.entitle(AUTH, NOW + 30 * DAY, NOW, await sha256('another-apple-id'))
    expect(await send(await notification('REVOKE'))).toBe(200)
    expect(library.status(AUTH, NOW).entitled).toBe(true)
  })

  // Told only a date, the library couldn't say whose renewal had moved it: refunded, with another's receipt sent last, it took nothing back.
  it('take back a renewal they told a library of, once it’s refunded, though another subscription’s receipt came last', async () => {
    const { send, library } = await world()
    library.entitle(AUTH, NOW + 30 * DAY, NOW, await sha256('another-apple-id'))
    const renewal = { ...TRANSACTION, purchaseDate: NOW, expiresDate: NOW + 400 * DAY }
    expect(await send(await notification('DID_RENEW', undefined, renewal))).toBe(200)
    expect(library.status(AUTH, NOW).expiresAt).toBe(NOW + 400 * DAY)
    expect(await send(await notification('REFUND', undefined, renewal))).toBe(200)
    // The other still pays, to where its own receipt said.
    expect(library.status(AUTH, NOW)).toMatchObject({ entitled: true, expiresAt: NOW + 30 * DAY })
  })

  // A receipt from Sandbox or TestFlight pays for a day at most, with no grace (worker/jws); told of the same
  // purchase's renewal, a library was paid to its whole length (the red-team review of 2026-11-17).
  it('pay a library no further for a Sandbox renewal than its receipt would', async () => {
    const { send, library, subscriber } = await world()
    const renewal = { ...TRANSACTION, environment: 'Sandbox', purchaseDate: NOW, expiresDate: NOW + 400 * DAY }
    expect(await send(await notification('DID_RENEW', undefined, renewal))).toBe(200)
    expect(library.status(AUTH, NOW).expiresAt).toBe(TRANSACTION.expiresDate)
    expect(subscriber.expiresAt()).toBe(TRANSACTION.expiresDate)
    // A Production one pays to where it says.
    expect(await send(await notification('DID_RENEW', undefined, { ...renewal, environment: 'Production' }))).toBe(200)
    expect(library.status(AUTH, NOW).expiresAt).toBe(NOW + 400 * DAY)
  })

  // Not handled, a refund Apple reversed went on refusing the purchase it had taken back.
  it('let a purchase pay again once its refund is reversed', async () => {
    const { send, library, subscriber, reading } = await world()
    expect(await send(await notification('REFUND'))).toBe(200)
    expect(await reading()).toBe('refused')
    expect(await send(await notification('REFUND_REVERSED'))).toBe(200)
    expect(await reading()).toBe('served')
    // The library comes back as its device sends its receipt again, which is taken now.
    expect(subscriber.claimLibrary('library-1', NOW, TRANSACTION.purchaseDate)).toBe(false)
    library.entitle(AUTH, TRANSACTION.expiresDate, NOW)
    expect(library.status(AUTH, NOW).entitled).toBe(true)
    expect(subscriber.entitle(TRANSACTION.expiresDate, TRANSACTION.purchaseDate)).toBe(TRANSACTION.expiresDate)
    expect(await send(await notification('REFUND_REVERSED'))).toBe(200)
  })

  it('keep a later purchase’s refund when an earlier one’s is reversed', async () => {
    const { send, subscriber } = await world()
    const later = { ...TRANSACTION, purchaseDate: NOW, expiresDate: NOW + 60 * DAY }
    expect(await send(await notification('REFUND', undefined, later))).toBe(200)
    expect(await send(await notification('REFUND_REVERSED'))).toBe(200)
    expect(() => subscriber.entitle(later.expiresDate, later.purchaseDate)).toThrow(/refunded/)
  })

  it('refuse a refund that doesn’t say when its purchase was made', async () => {
    const { send, library } = await world()
    const { purchaseDate: _, ...undated } = TRANSACTION
    expect(await send(await notification('REFUND', undefined, undated))).toBe(400)
    expect(library.status(AUTH, NOW).entitled).toBe(true)
  })

  // Only devices reported renewals, so a subscriber who opened Nib nowhere
  // for a year would have had the library deleted while still paying for it.
  it('carry a renewal to the libraries it pays for, so none is deleted while paid for', async () => {
    const { send, library, subscriber } = await world()
    const renewal = { ...TRANSACTION, purchaseDate: NOW, expiresDate: NOW + 400 * DAY }
    const deletedBefore = library.deletesAt(NOW)!
    expect(await send(await notification('DID_RENEW', undefined, renewal))).toBe(200)
    expect(subscriber.expiresAt()).toBe(renewal.expiresDate)
    expect(library.deletesAt(NOW)!).toBeGreaterThan(deletedBefore + 300 * DAY)
    expect(library.status(AUTH, NOW + 399 * DAY).entitled).toBe(true)
  })

  // A library's alarm was set only when something reached it, so one whose
  // devices had all gone quiet stayed for good.
  it('set a library’s deletion from when its subscription ended, with no device left to say so', async () => {
    const alarms: (number | null)[] = []
    const { send, library, deps } = await world()
    deps.library = () => libraryRequests(library, () => NOW, { alarm: async (at) => void alarms.push(at) })
    expect(await send(await notification('EXPIRED', undefined, { ...TRANSACTION, expiresDate: NOW + DAY }))).toBe(200)
    // Paid for till TRANSACTION.expiresDate, which reached it first: only ever extends.
    expect(alarms.at(-1)).toBe(library.deletesAt(NOW))
    expect(alarms.at(-1)).toBeGreaterThan(TRANSACTION.expiresDate + 300 * DAY)
  })

  it('leave what is paid for as it was when a renewal says less than is known', async () => {
    const { send, library, subscriber } = await world()
    const deletedBefore = library.deletesAt(NOW)
    expect(await send(await notification('DID_RENEW', undefined, { ...TRANSACTION, purchaseDate: NOW, expiresDate: NOW + DAY }))).toBe(200)
    expect(subscriber.expiresAt()).toBe(TRANSACTION.expiresDate)
    expect(library.deletesAt(NOW)).toBe(deletedBefore)
  })

  it('carry no renewal from a purchase since refunded', async () => {
    const { send, library } = await world()
    expect(await send(await notification('REFUND'))).toBe(200)
    expect(await send(await notification('DID_RENEW', undefined, { ...TRANSACTION, expiresDate: NOW + 400 * DAY }))).toBe(200)
    expect(library.status(AUTH, NOW).entitled).toBe(false)
  })

  it('refuse a renewal that doesn’t say when it runs to', async () => {
    const { send } = await world()
    const { expiresDate: _, ...undated } = TRANSACTION
    expect(await send(await notification('DID_RENEW', undefined, undated))).toBe(400)
  })

  it('leave everything as it was for any other kind', async () => {
    const { send, library, reading } = await world()
    expect(await send(await notification('DID_CHANGE_RENEWAL_STATUS'))).toBe(200)
    expect(library.status(AUTH, NOW).entitled).toBe(true)
    expect(await reading()).toBe('served')
  })

  // Read whole before its size was checked, from anyone: 50 MB was taken in
  // only to be refused.
  it('stop reading a body past the limit, however it is sent', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(1_000_000))
    let sent = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 20) controller.enqueue(chunk)
        else controller.close()
      },
    })
    const nobody = () => ({}) as never
    const request = new Request('https://nib.test/v1/app-store/notifications', { method: 'POST', body: endless, duplex: 'half' } as RequestInit)
    const response = await frontDoor(request, { notifications: (asked) => handleNotification(asked, { verify: async () => ({}), subscriber: nobody, library: nobody, share: nobody }) } as Routes)
    expect(response.status).toBe(413)
    expect(sent).toBeLessThan(3)
  })

  it('refuse one not signed by Apple, and change nothing', async () => {
    const { send, library } = await world()
    const stranger = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
    const forged = await notification('REFUND', Buffer.from(await crypto.subtle.exportKey('pkcs8', stranger.privateKey)).toString('base64'))
    expect(await send(forged)).toBe(400)
    expect(await send('not a jws')).toBe(400)
    expect(library.status(AUTH, NOW).entitled).toBe(true)
  })
})
