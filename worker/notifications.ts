import { json, MAX_RECEIPT, readJson, sha256 } from './http'
import { BUNDLE_ID } from './jws'
import { findLibrary, type Libraries } from './library'
import type { ShareRequests } from './share'
import type { SubscriberRequests } from './subscriber'

/**
 * App Store Server Notifications, version 2: how the App Store says a
 * purchase was refunded, or revoked (Family Sharing withdrawn). Without them
 * a receipt went on paying for sync and Plus shares until it expired.
 *
 *   POST /v1/app-store/notifications   { signedPayload }
 *
 * Set in App Store Connect as the app's Production and Sandbox Server URL.
 * The payload, and the transaction inside it, are checked through Apple's
 * chain like any receipt (jws.ts). A refund or revocation marks the
 * subscription (share.ts `Subscriber`), which then takes no receipt for that
 * purchase or an earlier one, and cuts off the libraries and shares it was
 * paying for until a later purchase pays for them again. A refund reversed
 * (REFUND_REVERSED) lets that purchase pay again. Coming twice, as the App
 * Store retries, changes nothing more. A renewal (DID_RENEW) or an end
 * (EXPIRED) says what the subscription is paid to, for the libraries it pays
 * for: their deletion (worker/library KEPT_MONTHS) runs from that date, and
 * there may be no device left to say so. Any other kind is acknowledged and
 * left alone.
 */

export const NOTIFICATIONS_PATH = '/v1/app-store/notifications'
const TAKEN_BACK = new Set(['REFUND', 'REVOKE'])
/** A refund Apple reversed: the purchase it took back is paid for again. */
const GIVEN_BACK = 'REFUND_REVERSED'
const PAID_TO = new Set(['DID_RENEW', 'EXPIRED'])

export type NotificationDeps = {
  verify(jws: string): Promise<Record<string, unknown>>
  subscriber(key: string): SubscriberRequests
  library: Libraries
  share(slug: string): ShareRequests
}

export async function handleNotification(request: Request, deps: NotificationDeps): Promise<Response> {
  if (request.method !== 'POST') return json(request, 404, { error: 'Not found.' })
  const refuse = () => json(request, 400, { error: 'Not a notification from the App Store.' })
  // Its size checked as it is read, as on every other route: read whole
  // first, any amount from anyone was taken in only to be refused.
  const body = await readJson(request, MAX_RECEIPT)
  let notification: Record<string, unknown>
  let transaction: Record<string, unknown>
  try {
    const signedPayload = body?.signedPayload
    if (typeof signedPayload !== 'string') return refuse()
    notification = await deps.verify(signedPayload)
    const data = notification.data as { bundleId?: unknown; signedTransactionInfo?: unknown } | undefined
    if (data?.bundleId !== BUNDLE_ID) return refuse()
    if (!TAKEN_BACK.has(String(notification.notificationType)) && notification.notificationType !== GIVEN_BACK && !PAID_TO.has(String(notification.notificationType))) return json(request, 200, { ok: true })
    if (typeof data.signedTransactionInfo !== 'string') return refuse()
    transaction = await deps.verify(data.signedTransactionInfo)
  } catch {
    return refuse()
  }
  if (transaction.bundleId !== BUNDLE_ID || typeof transaction.originalTransactionId !== 'string') return refuse()
  // What was refunded is this purchase, and so anything bought before it; a
  // renewal or purchase since is filed under the same id, and still pays.
  if (typeof transaction.purchaseDate !== 'number') return refuse()

  const subscription = await sha256(transaction.originalTransactionId)
  if (PAID_TO.has(String(notification.notificationType))) {
    const until = transaction.expiresDate
    if (typeof until !== 'number') return refuse()
    const paid = await deps.subscriber(subscription).paidTo(until, transaction.purchaseDate)
    const { libraries = [] } = (paid.status === 200 ? paid.body : {}) as { libraries?: string[] }
    await Promise.all(libraries.map((id) => findLibrary(deps.library, id).paidTo(until)))
    return json(request, 200, { ok: true })
  }
  if (notification.notificationType === GIVEN_BACK) {
    // Refused no more, and paid for till it was; what it paid for comes back as it's next asked for (share.ts `unrevoke`).
    await deps.subscriber(subscription).unrevoke(transaction.purchaseDate, typeof transaction.expiresDate === 'number' ? transaction.expiresDate : 0)
    return json(request, 200, { ok: true })
  }
  const revoked = await deps.subscriber(subscription).revoke(transaction.purchaseDate)
  const { libraries = [], shares = [] } = (revoked.status === 200 ? revoked.body : {}) as { libraries?: string[]; shares?: string[] }
  await Promise.all([
    ...libraries.map((id) => findLibrary(deps.library, id).revoke(subscription)),
    ...shares.map((slug) => deps.share(slug).unentitle()),
  ])
  return json(request, 200, { ok: true })
}
