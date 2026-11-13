import { useEffect, useState } from 'react'
import { registerPlugin } from '@capacitor/core'
import { SYNC_ORIGIN } from './hosts'
import { nativeApp } from './platform'

/**
 * Nib Plus is sold through the App Store only, so everything here goes through
 * the native plugin in ios/App/App/NibStorePlugin.swift. In a browser there
 * is no store to ask, and Plus reads as inactive.
 */

export type PlusProduct = {
  id: string
  displayName: string
  /** Localised by the App Store, currency and all. Never format it here. */
  displayPrice: string
  price: number
  /** ISO 4217, as the App Store prices it. Without it, a yearly price isn't also put a month at a time. */
  currency?: string
  period: 'month' | 'year'
  /** Present only while Apple says this Apple Account can still have the trial. */
  trialDays?: number
}

export type Entitlement = {
  active: boolean
  productId?: string
  /** Milliseconds since the epoch. */
  expiresAt?: number
  willRenew?: boolean
  /** The App Store's signed transaction, which the sync server verifies itself. */
  jws?: string
}

export type PurchaseResult = { status: 'purchased' | 'pending' | 'cancelled'; entitlement?: Entitlement }

interface NibStore {
  products(): Promise<{ products: PlusProduct[] }>
  purchase(options: { id: string }): Promise<PurchaseResult>
  entitlement(): Promise<Entitlement>
  restore(): Promise<Entitlement>
  manage(): Promise<void>
  addListener(event: 'entitlementChanged', listener: (entitlement: Entitlement) => void): Promise<{ remove: () => Promise<void> }>
}

export const store = registerPlugin<NibStore>('NibStore')

/** Apple asks for this link wherever a subscription is sold. */
export const PRIVACY_URL = 'https://nib.social-alias.workers.dev/privacy'

/** How to send a note to the inbox (site/inbox.html), for whoever sets up the app or service that will. */
export const INBOX_HELP_URL = `${SYNC_ORIGIN}/inbox`

// Apple's standard licence. The App Store requires a link to terms of use on
// any screen that sells a subscription.
export const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'

/** How much cheaper a year is than twelve months, as a whole percentage. */
export function yearlySaving(monthly?: PlusProduct, yearly?: PlusProduct): number {
  return monthly && yearly ? Math.round((1 - yearly.price / (monthly.price * 12)) * 100) : 0
}

/**
 * A yearly price a month at a time ("$2.50"), in the App Store's currency.
 * Null when that currency isn't known, rather than a guess at it.
 */
export function perMonth(product: PlusProduct): string | null {
  if (product.period !== 'year' || !product.currency) return null
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: product.currency }).format(product.price / 12)
  } catch {
    return null
  }
}

/**
 * Who has what of Nib Plus, each by name. `subscribed`, Nib Plus as the App
 * Store has it: sync, shared drafts and Billing go by that. `features` open
 * with it, or for days bought with the stamp market's points (lib/market),
 * here. `known` once the App Store has answered.
 */
export type Entitled = {
  subscribed: boolean
  features: boolean
  known: boolean
  /** When the days from points end, while they run without the subscription. */
  pointsUntil: number | null
}

const INACTIVE: Entitlement = { active: false }

/**
 * The writer's Plus status, kept current as the App Store reports changes.
 * `known` turns true once the App Store has answered (at once in a browser).
 */
export function usePlus(): [Entitlement, (entitlement: Entitlement) => void, boolean] {
  const [entitlement, setEntitlement] = useState<Entitlement>(INACTIVE)
  const [known, setKnown] = useState(!nativeApp)

  useEffect(() => {
    if (!nativeApp) return
    let live = true
    store
      .entitlement()
      .then((next) => live && setEntitlement(next))
      .catch((error: unknown) => console.warn('Nib: could not read Plus status', error))
      .finally(() => live && setKnown(true))
    // Caught: where the plugin is missing (tests, a broken build) the listener
    // rejects, and Plus should simply read as inactive, not throw.
    const listener = store.addListener('entitlementChanged', (next) => live && setEntitlement(next)).catch(() => null)
    // Expiry, and renewal turned off in Settings, create no transaction to
    // hear about. Ask again whenever Nib comes back to the front.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      store
        .entitlement()
        .then((next) => live && setEntitlement(next))
        .catch((error: unknown) => console.warn('Nib: could not read Plus status', error))
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisible)
      void listener.then((handle) => handle?.remove())
    }
  }, [])
  // And as it runs out, with Nib left on the screen, as on a Mac: renewed or not, the App Store says which.
  useEffect(() => {
    if (!entitlement.active || !entitlement.expiresAt) return
    let live = true
    const timer = setTimeout(
      () =>
        store
          .entitlement()
          .then((next) => live && setEntitlement(next))
          .catch((error: unknown) => console.warn('Nib: could not read Plus status', error)),
      Math.min(Math.max(0, entitlement.expiresAt - Date.now()) + 5000, 2 ** 31 - 1),
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [entitlement.active, entitlement.expiresAt])

  return [entitlement, setEntitlement, known]
}

/** `Entitled`, from the App Store's word and the end of any days bought with points. */
export function useEntitled(subscription: Entitlement, known: boolean, plusUntil: number, setNotice: (notice: string) => void): Entitled {
  const pointsUntil = !subscription.active && plusUntil > Date.now() ? plusUntil : null
  // Ending while Nib is open, their features go then, and Nib says so.
  const [, setPlusEnded] = useState(0)
  useEffect(() => {
    if (!pointsUntil) return
    const timer = setTimeout(
      () => {
        setPlusEnded((ended) => ended + 1)
        setNotice('Your days of Nib Plus from coins have ended.')
      },
      Math.min(pointsUntil - Date.now(), 2 ** 31 - 1),
    )
    return () => clearTimeout(timer)
  }, [pointsUntil, setNotice])
  return { subscribed: subscription.active, features: subscription.active || pointsUntil !== null, known, pointsUntil }
}
