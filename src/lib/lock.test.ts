import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { closeVault, openVault } from './vault'

const native = vi.hoisted(() => ({ vault: vi.fn(async (_options: { open: boolean }) => {}) }))
vi.mock('@capacitor/core', async (importOriginal) => ({ ...(await importOriginal<typeof import('@capacitor/core')>()), registerPlugin: () => native }))

const { coverOpenVault, describeUnlock, unavailableReason } = await import('./lock')
type LockStatus = import('./lock').LockStatus

const status = (overrides: Partial<LockStatus>): LockStatus => ({
  enabled: false,
  after: 0,
  available: true,
  biometry: 'none',
  device: 'iPhone',
  ...overrides,
})

describe('the lock, in the words of each device', () => {
  it.each([
    [{ biometry: 'faceID' }, 'With Face ID or your passcode'],
    [{ biometry: 'touchID', device: 'iPad' }, 'With Touch ID or your passcode'],
    [{ biometry: 'opticID' }, 'With Optic ID or your passcode'],
    [{ biometry: 'none' }, 'With your passcode'],
    [{ biometry: 'touchID', device: 'Mac' }, 'With Touch ID or your password'],
    [{ biometry: 'none', device: 'Mac' }, 'With your password'],
  ] as [Partial<LockStatus>, string][])('%o unlocks %s', (overrides, words) => {
    expect(describeUnlock(status(overrides))).toBe(words)
  })

  it('says what to set when there is nothing to unlock with', () => {
    expect(unavailableReason(status({ device: 'iPad' }))).toBe('Set a passcode on this iPad to use this.')
    expect(unavailableReason(status({ device: 'Mac' }))).toBe('Set a login password on this Mac to use this.')
  })
})

// iOS keeps a snapshot of the screen for the app switcher: with the vault
// open, that was a locked note's text, or its title, with Lock Nib off.
describe('an open vault, on the way out of the app', () => {
  it('tells the app to cover Nib while the vault is open, and only then', async () => {
    const stop = coverOpenVault()
    expect(native.vault).toHaveBeenLastCalledWith({ open: false })
    await openVault('harbour lights', [])
    expect(native.vault).toHaveBeenLastCalledWith({ open: true })
    closeVault()
    expect(native.vault).toHaveBeenLastCalledWith({ open: false })
    stop()
    native.vault.mockClear()
    await openVault('harbour lights', [])
    expect(native.vault).not.toHaveBeenCalled()
    closeVault()
  })
})
