// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlusProduct } from '../lib/plus'

// The popup as it behaves inside the app, with the App Store faked.
const store = vi.hoisted(() => ({
  products: vi.fn(),
  purchase: vi.fn(),
  restore: vi.fn(),
}))
vi.mock('../lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/plus')>()),
  store,
}))

const { UpgradeDialog } = await import('./UpgradeDialog')
const { perMonth } = await import('../lib/plus')

const MONTHLY: PlusProduct = { id: 'app.nib.plus.monthly', displayName: 'Monthly', displayPrice: '$3.99', price: 3.99, currency: 'USD', period: 'month' }
const YEARLY: PlusProduct = { id: 'app.nib.plus.yearly', displayName: 'Yearly', displayPrice: '$29.99', price: 29.99, currency: 'USD', period: 'year' }

function setup() {
  const onEntitlement = vi.fn()
  const onClose = vi.fn()
  render(<UpgradeDialog onEntitlement={onEntitlement} onClose={onClose} />)
  return { onEntitlement, onClose }
}

beforeEach(() => {
  vi.resetAllMocks()
  store.products.mockResolvedValue({ products: [MONTHLY, YEARLY] })
})

describe('UpgradeDialog', () => {
  it('prices both plans as the App Store does, yearly chosen, with its saving and a month’s worth', async () => {
    setup()
    const yearly = await screen.findByRole('radio', { name: /Yearly/ })
    expect(yearly.getAttribute('aria-checked')).toBe('true')
    expect(yearly.textContent).toContain('$29.99')
    expect(yearly.textContent).toContain('Save 37%')
    expect(yearly.textContent).toMatch(/Just \$2\.50 a month/)
    expect(screen.getByRole('radio', { name: /Monthly/ }).textContent).toContain('$3.99')
    expect(screen.getByRole('button', { name: 'Get Nib Plus' })).toBeTruthy()
    expect(screen.getByText(/\$29\.99 a year\. Renews automatically/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Terms of Use' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toBeTruthy()
  })

  it('offers the free trial only when Apple says this account can have it', async () => {
    store.products.mockResolvedValue({ products: [{ ...MONTHLY, trialDays: 14 }, { ...YEARLY, trialDays: 14 }] })
    setup()
    expect(await screen.findByRole('button', { name: 'Try it free for 14 days' })).toBeTruthy()
    expect(screen.getByText('Free for 14 days')).toBeTruthy()
    expect(screen.getByText(/Free for 14 days, then \$29\.99 a year/)).toBeTruthy()
  })

  it('makes no guess at a month’s price without the currency', () => {
    expect(perMonth({ ...YEARLY, currency: undefined })).toBeNull()
    expect(perMonth(MONTHLY)).toBeNull()
    expect(perMonth(YEARLY)).toMatch(/2\.50/)
  })

  it('buys the chosen plan and hands on the entitlement', async () => {
    const entitlement = { active: true, productId: MONTHLY.id }
    store.purchase.mockResolvedValue({ status: 'purchased', entitlement })
    const { onEntitlement } = setup()
    await userEvent.click(await screen.findByRole('radio', { name: /Monthly/ }))
    expect(screen.getByText(/\$3\.99 a month\. Renews automatically/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Get Nib Plus' }))
    expect(store.purchase).toHaveBeenCalledWith({ id: MONTHLY.id })
    expect(onEntitlement).toHaveBeenCalledWith(entitlement)
  })

  it('says so when a purchase waits on approval or fails', async () => {
    store.purchase.mockResolvedValueOnce({ status: 'pending' }).mockRejectedValueOnce(new Error('nope'))
    const { onEntitlement } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Get Nib Plus' }))
    expect(screen.getByRole('status').textContent).toMatch(/Waiting for approval/)
    await userEvent.click(screen.getByRole('button', { name: 'Get Nib Plus' }))
    expect(screen.getByRole('status').textContent).toBe('The purchase didn’t go through.')
    expect(onEntitlement).not.toHaveBeenCalled()
  })

  it('restores, and says when there was nothing to restore', async () => {
    store.restore.mockResolvedValue({ active: false })
    const { onEntitlement } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Restore purchases' }))
    expect(onEntitlement).toHaveBeenCalledWith({ active: false })
    expect(screen.getByRole('status').textContent).toMatch(/No Nib Plus subscription/)
  })

  it('says when the App Store can’t be reached, and tries again', async () => {
    store.products.mockRejectedValueOnce(new Error('offline'))
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('radio', { name: /Yearly/ })).toBeTruthy()
  })

  it('closes at Not now, the close button and Escape', async () => {
    const { onClose } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
