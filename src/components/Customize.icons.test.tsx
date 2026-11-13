// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetLook, setLookPlus } from '../lib/look'
import { Customize } from './Customize'

/** The home-screen icon, on an iPhone or iPad (Customize, Nib Plus). */

vi.mock('../lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/platform')>()), touchApp: true }))
const window = vi.hoisted(() => ({ setIcon: vi.fn(async () => {}), icon: vi.fn(async () => ({ name: 'AppIcon-Blue' })) }))
vi.mock('../lib/keyboard', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/keyboard')>()), nibWindow: window }))

const icons = () => within(screen.getByRole('radiogroup', { name: 'App icon' }))

function show(plus: boolean) {
  setLookPlus({ active: plus, known: true })
  const onOpenBilling = vi.fn()
  render(<Customize plus={plus} theme="light" onThemeChange={vi.fn()} onOpenBilling={onOpenBilling} onBack={vi.fn()} />)
  return onOpenBilling
}

afterEach(() => {
  cleanup()
  resetLook()
  setLookPlus({ active: false, known: false })
  vi.clearAllMocks()
})

describe('the app icon', () => {
  it('shows the one iOS has, and changes it with Plus', async () => {
    show(true)
    await waitFor(() => expect(icons().getByRole('radio', { name: 'Blue' }).getAttribute('aria-checked')).toBe('true'))
    await userEvent.click(icons().getByRole('radio', { name: 'Paper' }))
    expect(window.setIcon).toHaveBeenCalledWith({ name: 'AppIcon-Paper' })
    await waitFor(() => expect(icons().getByRole('radio', { name: 'Paper' }).getAttribute('aria-checked')).toBe('true'))

    // The standard icon is no alternate at all.
    await userEvent.click(icons().getByRole('radio', { name: 'Ink' }))
    expect(window.setIcon).toHaveBeenLastCalledWith({ name: undefined })
  })

  it('leads to Billing without Plus, and changes nothing', async () => {
    const onOpenBilling = show(false)
    await userEvent.click(icons().getByRole('radio', { name: 'Rose' }))
    expect(onOpenBilling).toHaveBeenCalled()
    expect(window.setIcon).not.toHaveBeenCalled()
  })
})
