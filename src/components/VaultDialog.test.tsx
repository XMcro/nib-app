// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VaultError } from '../lib/vault'

// Face ID, as the Keychain would answer (lib/vaultKey): none, till a test says.
const biometric = vi.hoisted(() => ({
  status: vi.fn(async (): Promise<{ name: string; stored: boolean } | null> => null),
  recall: vi.fn(async (): Promise<string | null> => null),
  remember: vi.fn(async (_passcode: string) => {}),
  forget: vi.fn(async () => {}),
}))
vi.mock('../lib/vaultKey', () => ({
  vaultUnlock: biometric.status,
  recallPasscode: biometric.recall,
  rememberPasscode: biometric.remember,
  forgetPasscode: biometric.forget,
}))

const { VaultDialog } = await import('./VaultDialog')
type VaultMode = import('../lib/vault').VaultMode

afterEach(() => {
  cleanup()
  for (const fn of Object.values(biometric)) fn.mockReset()
  biometric.status.mockImplementation(async () => null)
  biometric.recall.mockImplementation(async () => null)
})

const open = (mode: VaultMode) => {
  const onSubmit = vi.fn(async () => {})
  render(<VaultDialog mode={mode} onSubmit={onSubmit} onClose={() => {}} />)
  return onSubmit
}

describe('VaultDialog', () => {
  it('says why length matters when a passcode is chosen', () => {
    for (const mode of ['create', 'change'] as const) {
      open(mode)
      expect(screen.getByText('A longer passcode is harder to guess from a copy of the library.')).toBeTruthy()
      cleanup()
    }
  })

  it('says nothing of length when the vault is opened, whatever its passcode', () => {
    open('open')
    expect(screen.queryByText(/longer passcode/)).toBeNull()
  })

  it('asks for eight characters before a passcode is chosen', async () => {
    const onSubmit = open('create')
    await userEvent.type(screen.getByLabelText('Passcode'), 'seven77')
    await userEvent.type(screen.getByLabelText('The same again'), 'seven77')
    await userEvent.click(screen.getByRole('button', { name: 'Lock' }))
    expect(screen.getByRole('alert').textContent).toBe('At least 8 characters.')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('VaultDialog, while a passcode is being tried', () => {
  // The key takes half a second to make, and the button being off stops a tap, not Return: tried twice, the
  // second ran as the first closed the dialog.
  it('tries it once, however often it’s sent', async () => {
    let finish = () => {}
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const onClose = vi.fn()
    render(<VaultDialog mode="open" onSubmit={onSubmit} onClose={onClose} />)
    await userEvent.type(screen.getByLabelText('Passcode'), 'harbour lights')
    const form = screen.getByLabelText('Passcode').closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    finish()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onSubmit).toHaveBeenCalledOnce()
    // And again after it has answered, as a wrong passcode needs.
    fireEvent.submit(form)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
  })
})

// A long passphrase is what keeps the vault safe, and typing one every
// time Nib comes back is what makes people choose a short one.
describe('VaultDialog with Face ID', () => {
  it('offers to open the vault with Face ID next time, and keeps the passcode for it once it opens', async () => {
    biometric.status.mockImplementation(async () => ({ name: 'Face ID', stored: false }))
    const onSubmit = open('open')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox', { name: 'Use Face ID to open it next time' }))
    await user.type(screen.getByLabelText('Passcode'), 'harbour lights')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(biometric.remember).toHaveBeenCalledWith('harbour lights'))
    expect(onSubmit).toHaveBeenCalledWith('harbour lights')
  })

  it('keeps nothing unless asked', async () => {
    biometric.status.mockImplementation(async () => ({ name: 'Face ID', stored: false }))
    const onSubmit = open('open')
    const user = userEvent.setup()
    await screen.findByRole('checkbox', { name: 'Use Face ID to open it next time' })
    await user.type(screen.getByLabelText('Passcode'), 'harbour lights')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(biometric.remember).not.toHaveBeenCalled()
  })

  it('opens with Face ID at once once it has the passcode', async () => {
    biometric.status.mockImplementation(async () => ({ name: 'Face ID', stored: true }))
    biometric.recall.mockImplementation(async () => 'harbour lights')
    const onSubmit = open('open')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('harbour lights'))
  })

  it('lets the passcode be typed after Face ID is cancelled, and tried again', async () => {
    biometric.status.mockImplementation(async () => ({ name: 'Face ID', stored: true }))
    const onSubmit = open('open')
    const user = userEvent.setup()
    biometric.recall.mockImplementation(async () => 'harbour lights')
    await user.click(await screen.findByRole('button', { name: 'Use Face ID' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('harbour lights'))
  })

  // Changed on another device: the one kept here opens nothing now.
  it('forgets a kept passcode that no longer opens the vault, and says to type the new one', async () => {
    biometric.status.mockImplementation(async () => ({ name: 'Face ID', stored: true }))
    biometric.recall.mockImplementation(async () => 'old harbour')
    const onSubmit = vi.fn(async () => {
      throw new VaultError('That passcode doesn’t open the vault.')
    })
    render(<VaultDialog mode="open" onSubmit={onSubmit} onClose={() => {}} />)
    await waitFor(() => expect(biometric.forget).toHaveBeenCalled())
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The passcode Face ID kept no longer opens the vault. Type the new one.')
  })

  it('keeps the new passcode when it changes, if Face ID had the old one', async () => {
    biometric.status.mockImplementation(async () => ({ name: 'Face ID', stored: true }))
    const onSubmit = open('change')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('New passcode'), 'new harbour')
    await user.type(screen.getByLabelText('The same again'), 'new harbour')
    await user.click(screen.getByRole('button', { name: 'Change' }))
    await waitFor(() => expect(biometric.remember).toHaveBeenCalledWith('new harbour'))
    expect(onSubmit).toHaveBeenCalled()
    expect(biometric.recall).not.toHaveBeenCalled()
  })
})
