import { useEffect, useState } from 'react'
import { store, yearlySaving, type Entitlement, type PlusProduct } from './plus'

type Products = PlusProduct[] | 'loading' | 'unreachable'

/**
 * Buying Plus, the same wherever it's sold (components/Billing,
 * components/UpgradeDialog): the App Store's plans, the one chosen, subscribing
 * and restoring, and what each says back. `sold`: false where there's no App
 * Store to ask, which is Billing in a browser.
 */
export function usePurchase(onEntitlement: (entitlement: Entitlement) => void, sold = true) {
  const [products, setProducts] = useState<Products>('loading')
  const [chosen, setChosen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  function load() {
    setProducts('loading')
    store
      .products()
      .then(({ products }) => setProducts(products))
      .catch(() => setProducts('unreachable'))
  }

  useEffect(() => {
    if (sold) load()
  }, [sold])

  const list = Array.isArray(products) ? products : []
  const monthly = list.find((product) => product.period === 'month')
  const yearly = list.find((product) => product.period === 'year')
  // Yearly is the one to push, per the plan, so it is chosen unless changed.
  const selected = list.find((product) => product.id === chosen) ?? yearly ?? monthly
  const saving = yearlySaving(monthly, yearly)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const subscribe = () =>
    run(async () => {
      if (!selected) return
      try {
        const result = await store.purchase({ id: selected.id })
        if (result.status === 'purchased' && result.entitlement) onEntitlement(result.entitlement)
        if (result.status === 'pending') setMessage('Waiting for approval. Plus turns on as soon as it’s approved.')
      } catch {
        setMessage('The purchase didn’t go through.')
      }
    })

  const restore = () =>
    run(async () => {
      try {
        const next = await store.restore()
        onEntitlement(next)
        if (!next.active) setMessage('No Nib Plus subscription was found for this Apple Account.')
      } catch (error) {
        if ((error as { code?: string }).code === 'cancelled') return
        setMessage('Couldn’t reach the App Store to restore purchases.')
      }
    })

  return { products, load, list, monthly, yearly, selected, saving, setChosen, busy, message, setMessage, run, subscribe, restore }
}
