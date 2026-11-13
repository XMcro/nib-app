// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState, type ComponentProps } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LoginItem } from '../lib/keyboard'
import type { Sync } from '../sync'

// Settings as it is inside the Mac app, with macOS's login items stood in for.
const platform = vi.hoisted(() => ({ mac: true }))
vi.mock('../lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/platform')>()),
  nativeApp: true,
  get macApp() {
    return platform.mac
  },
}))
vi.mock('../lib/lock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/lock')>()),
  lock: { status: vi.fn(async () => ({ enabled: false, after: 0, available: true, biometry: 'touchID', device: 'Mac' })) },
}))
const nibWindow = vi.hoisted(() => ({ login: vi.fn(), setLogin: vi.fn() }))
vi.mock('../lib/keyboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/keyboard')>()),
  nibWindow,
}))

const { Settings } = await import('./Settings')

function WithGear(props: ComponentProps<typeof Settings>) {
  const [openTo, setOpenTo] = useState<ComponentProps<typeof Settings>['openTo']>(null)
  return (
    <>
      <button aria-label="Settings" onClick={() => setOpenTo({ view: 'main', at: Date.now() })} />
      <Settings {...props} openTo={props.openTo ?? openTo} />
    </>
  )
}

const SYNC_OFF: Sync = { status: { state: 'off' }, code: null, known: true, create: async () => '', join: async () => {}, turnOff: async () => {}, wipe: async () => {}, changeCode: async () => '', signing: async () => null, requireSigned: async () => {}, filesRoom: async () => null, manual: false, setManual: () => {}, syncNow: () => {}, refetch: async () => {}, inboxAddress: async () => undefined, newInboxAddress: async () => ({ address: '', clipper: '' }), endInbox: async () => {} }
const OFF: LoginItem = { available: true, on: false, approval: false }

async function open() {
  render(
    <WithGear
      theme="system"
      canExportCurrent
      subscription={{ active: false }}
      plus={false}
      sync={SYNC_OFF}
      onThemeChange={vi.fn()}
      onExport={vi.fn()}
      onExportCurrent={vi.fn()}
      onExportCurrentAs={vi.fn()}
      goal={0}
      onGoalChange={vi.fn()}
      onImport={vi.fn()}
      onBackup={vi.fn()}
      onRestore={vi.fn()}
      onPlusChange={vi.fn()}
    />,
  )
  await userEvent.click(screen.getByLabelText('Settings'))
  // The lock's row is there on every device: once it is, the panel has asked what it asks.
  await screen.findByRole('switch', { name: 'Lock Nib' })
}
const login = () => screen.findByRole('switch', { name: 'Open Nib at login' })

beforeEach(() => {
  cleanup()
  platform.mac = true
  nibWindow.login.mockReset().mockResolvedValue(OFF)
  nibWindow.setLogin.mockReset()
})

describe('Open Nib at login, on the Mac', () => {
  it('is off to begin with, as macOS has it, and says when Nib would open', async () => {
    await open()
    expect((await login()).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('When you log in to this Mac.')).toBeTruthy()
  })

  it('asks macOS to add Nib and to take it off, and shows what macOS answers', async () => {
    nibWindow.setLogin.mockResolvedValue({ ...OFF, on: true })
    await open()
    await userEvent.click(await login())
    expect(nibWindow.setLogin).toHaveBeenCalledWith({ on: true })
    await waitFor(async () => expect((await login()).getAttribute('aria-checked')).toBe('true'))

    nibWindow.setLogin.mockResolvedValue(OFF)
    await userEvent.click(await login())
    expect(nibWindow.setLogin).toHaveBeenLastCalledWith({ on: false })
    await waitFor(async () => expect((await login()).getAttribute('aria-checked')).toBe('false'))
  })

  it('shows it on if macOS already opens Nib at login: its list is the one that counts', async () => {
    nibWindow.login.mockResolvedValue({ ...OFF, on: true })
    await open()
    expect((await login()).getAttribute('aria-checked')).toBe('true')
  })

  it('says where to allow it when it was turned off in System Settings, and can be taken off from here', async () => {
    nibWindow.login.mockResolvedValue({ ...OFF, approval: true })
    nibWindow.setLogin.mockResolvedValue(OFF)
    await open()
    // Asked for, though macOS isn't doing it: shown as wanted, with why it isn't happening.
    expect((await login()).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Turned off in System Settings. Allow Nib under General → Login Items there.')).toBeTruthy()
    await userEvent.click(await login())
    expect(nibWindow.setLogin).toHaveBeenCalledWith({ on: false })
    await waitFor(async () => expect((await login()).getAttribute('aria-checked')).toBe('false'))
    expect(screen.getByText('When you log in to this Mac.')).toBeTruthy()
  })

  it('says so, and stays as it was, when macOS doesn’t take the change; and tries again clean', async () => {
    nibWindow.setLogin.mockRejectedValueOnce(new Error('no'))
    await open()
    await userEvent.click(await login())
    expect(await screen.findByText('macOS didn’t take the change. Try it under Login Items in System Settings.')).toBeTruthy()
    expect((await login()).getAttribute('aria-checked')).toBe('false')

    nibWindow.setLogin.mockResolvedValue({ ...OFF, on: true })
    await userEvent.click(await login())
    await waitFor(async () => expect((await login()).getAttribute('aria-checked')).toBe('true'))
    expect(screen.queryByText(/didn’t take the change/)).toBeNull()
  })

  it('isn’t offered on a Mac too old for it, nor where macOS can’t be asked', async () => {
    nibWindow.login.mockResolvedValue({ available: false, on: false, approval: false })
    await open()
    expect(screen.queryByRole('switch', { name: 'Open Nib at login' })).toBeNull()
    cleanup()

    nibWindow.login.mockRejectedValue(new Error('no plugin'))
    await open()
    expect(screen.queryByRole('switch', { name: 'Open Nib at login' })).toBeNull()
  })

  it('isn’t offered on an iPhone or iPad, and macOS isn’t asked there', async () => {
    platform.mac = false
    await open()
    expect(screen.queryByRole('switch', { name: 'Open Nib at login' })).toBeNull()
    expect(nibWindow.login).not.toHaveBeenCalled()
  })
})
