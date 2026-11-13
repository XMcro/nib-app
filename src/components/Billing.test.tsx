// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlusProduct } from '../lib/plus'

// Billing as it behaves inside the iOS app, with the App Store faked.
vi.mock('../lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/platform')>()),
  nativeApp: true,
}))

const store = vi.hoisted(() => ({
  products: vi.fn(),
  purchase: vi.fn(),
  restore: vi.fn(),
  manage: vi.fn(),
  entitlement: vi.fn(),
}))
vi.mock('../lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/plus')>()),
  store,
}))

const { Billing } = await import('./Billing')

const MONTHLY: PlusProduct = { id: 'app.nib.plus.monthly', displayName: 'Monthly', displayPrice: '$3.99', price: 3.99, period: 'month' }
const YEARLY: PlusProduct = { id: 'app.nib.plus.yearly', displayName: 'Yearly', displayPrice: '$29.99', price: 29.99, period: 'year' }

function setup(active = false) {
  const onEntitlement = vi.fn()
  render(<Billing entitlement={active ? { active: true, productId: YEARLY.id, expiresAt: Date.UTC(2027, 8, 23), willRenew: true } : { active: false }} onEntitlement={onEntitlement} onBack={vi.fn()} onOpenSync={vi.fn()} />)
  return { onEntitlement }
}

beforeEach(() => {
  vi.resetAllMocks()
  store.products.mockResolvedValue({ products: [MONTHLY, YEARLY] })
})

describe('Billing in the app', () => {
  it('shows both plans at the App Store’s prices, yearly chosen, with the saving', async () => {
    setup()
    const yearly = await screen.findByRole('radio', { name: /Yearly/ })
    expect(yearly.textContent).toContain('$29.99')
    expect(yearly.textContent).toContain('Save 37%')
    expect(yearly.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /Monthly/ }).textContent).toContain('$3.99')
    expect(screen.getByRole('link', { name: 'Terms of Use' })).toBeTruthy()
  })

  it('offers the free trial plainly when Apple says this account can have it', async () => {
    store.products.mockResolvedValue({ products: [{ ...MONTHLY, trialDays: 14 }, { ...YEARLY, trialDays: 14 }] })
    setup()
    expect((await screen.findByRole('radio', { name: /Yearly/ })).textContent).toContain('14 days free')
    expect(screen.getByRole('button', { name: 'Start 14-day free trial' })).toBeTruthy()
    expect(screen.getByText(/Free for 14 days, then \$29\.99 a year/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toBeTruthy()
  })

  it('buys the chosen plan and turns Plus on', async () => {
    const entitlement = { active: true, productId: MONTHLY.id }
    store.purchase.mockResolvedValue({ status: 'purchased', entitlement })
    const { onEntitlement } = setup()
    await userEvent.click(await screen.findByRole('radio', { name: /Monthly/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(store.purchase).toHaveBeenCalledWith({ id: MONTHLY.id })
    expect(onEntitlement).toHaveBeenCalledWith(entitlement)
  })

  it('says so when a purchase waits for approval, and stays quiet on cancel', async () => {
    store.purchase.mockResolvedValueOnce({ status: 'pending' }).mockResolvedValueOnce({ status: 'cancelled' })
    const { onEntitlement } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Subscribe' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/Waiting for approval/)
    await userEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(onEntitlement).not.toHaveBeenCalled()
  })

  it('reports a failed purchase', async () => {
    store.purchase.mockRejectedValue(new Error('network'))
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Subscribe' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/didn’t go through/)
  })

  it('restores, and says when there was nothing to restore', async () => {
    store.restore.mockResolvedValue({ active: false })
    const { onEntitlement } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Restore purchases' }))
    expect(onEntitlement).toHaveBeenCalledWith({ active: false })
    expect((await screen.findByRole('status')).textContent).toMatch(/No Nib Plus subscription/)
  })

  it('shows the plan and renewal date to a subscriber, with Manage', async () => {
    setup(true)
    expect(await screen.findByText(/Yearly plan, renews/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Manage subscription' }))
    expect(store.manage).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull()
  })

  it('asks the App Store again when Manage closes, since cancelling there sends no update', async () => {
    const cancelled = { active: true, productId: YEARLY.id, expiresAt: Date.UTC(2027, 8, 23), willRenew: false }
    store.entitlement.mockResolvedValue(cancelled)
    const { onEntitlement } = setup(true)
    await userEvent.click(await screen.findByRole('button', { name: 'Manage subscription' }))
    expect(onEntitlement).toHaveBeenCalledWith(cancelled)
  })

  it('says nothing when the restore sign-in is cancelled', async () => {
    store.restore.mockRejectedValue(Object.assign(new Error('Cancelled.'), { code: 'cancelled' }))
    const { onEntitlement } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Restore purchases' }))
    await waitFor(() => expect(store.restore).toHaveBeenCalledOnce())
    expect(screen.queryByRole('status')).toBeNull()
    expect(onEntitlement).not.toHaveBeenCalled()
  })

  it('still reports a restore that really failed', async () => {
    store.restore.mockRejectedValue(new Error('offline'))
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Restore purchases' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/Couldn’t reach the App Store/)
  })

  it('says Plus is not available when the App Store has no products', async () => {
    store.products.mockResolvedValue({ products: [] })
    setup()
    expect(await screen.findByText(/isn’t available yet/)).toBeTruthy()
  })

  it('offers a retry when the App Store cannot be reached', async () => {
    store.products.mockRejectedValueOnce(new Error('offline'))
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('radio', { name: /Yearly/ })).toBeTruthy()
  })
})
