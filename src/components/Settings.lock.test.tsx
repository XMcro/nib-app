// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState, type ComponentProps } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LockStatus } from '../lib/lock'
import type { Sync } from '../sync'

// Settings as it is inside the iPhone app, with the native lock stood in for.
vi.mock('../lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/platform')>()),
  nativeApp: true,
}))
const lock = vi.hoisted(() => ({ status: vi.fn(), set: vi.fn(), privacy: vi.fn() }))
vi.mock('../lib/lock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/lock')>()),
  lock,
}))

const { Settings } = await import('./Settings')

/** Settings opens from a gear elsewhere (App's \`openTo\`); this stands in for it. */
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
const OFF: LockStatus = { enabled: false, after: 0, available: true, biometry: 'faceID', device: 'iPhone' }

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
  return screen.findByRole('switch', { name: 'Lock Nib' })
}

beforeEach(() => {
  lock.status.mockReset().mockResolvedValue(OFF)
  lock.set.mockReset()
  lock.privacy.mockReset()
})

describe('Lock Nib', () => {
  it('is off to begin with, and says what unlocks it', async () => {
    const toggle = await open()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('With Face ID or your passcode')).toBeTruthy()
    expect(screen.queryByLabelText('When Nib locks')).toBeNull()
  })

  it('turns on through the device, then offers when it locks', async () => {
    lock.set.mockResolvedValue({ ...OFF, enabled: true })
    await userEvent.click(await open())
    expect(lock.set).toHaveBeenCalledWith({ enabled: true, after: 0 })
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Lock Nib' }).getAttribute('aria-checked')).toBe('true'))
    const when = screen.getByLabelText('When Nib locks') as HTMLSelectElement
    expect([...when.options].map((option) => option.textContent)).toEqual([
      'Immediately',
      'After 1 minute',
      'After 5 minutes',
      'After 15 minutes',
      'After 1 hour',
    ])

    lock.set.mockResolvedValue({ ...OFF, enabled: true, after: 300 })
    await userEvent.selectOptions(when, 'After 5 minutes')
    expect(lock.set).toHaveBeenLastCalledWith({ enabled: true, after: 300 })
  })

  it('stays off when Face ID or the passcode is cancelled', async () => {
    lock.set.mockRejectedValue(Object.assign(new Error('Cancelled.'), { code: 'cancelled' }))
    const toggle = await open()
    await userEvent.click(toggle)
    expect(lock.set).toHaveBeenCalled()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('cannot be turned on without a passcode, and says why', async () => {
    lock.status.mockResolvedValue({ ...OFF, available: false, biometry: 'none' })
    const toggle = await open()
    expect((toggle as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Set a passcode on this iPhone to use this.')).toBeTruthy()
  })
})

describe('Privacy mode', () => {
  const privacy = () => screen.findByRole('switch', { name: 'Privacy mode' })

  it('is off to begin with, and says what it does and what it can’t', async () => {
    lock.status.mockResolvedValue({ ...OFF, privacy: false })
    await open()
    expect((await privacy()).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Covers Nib in the app switcher, and while the screen is being recorded or shared. iOS doesn’t let an app stop a screenshot.')).toBeTruthy()
  })

  it('turns on and off with no Face ID asked for, and shows which it is', async () => {
    lock.status.mockResolvedValue({ ...OFF, privacy: false })
    lock.privacy.mockResolvedValue({ ...OFF, privacy: true })
    await open()
    await userEvent.click(await privacy())
    expect(lock.privacy).toHaveBeenCalledWith({ on: true })
    await waitFor(async () => expect((await privacy()).getAttribute('aria-checked')).toBe('true'))
    expect(lock.set).not.toHaveBeenCalled()

    lock.privacy.mockResolvedValue({ ...OFF, privacy: false })
    await userEvent.click(await privacy())
    expect(lock.privacy).toHaveBeenLastCalledWith({ on: false })
    await waitFor(async () => expect((await privacy()).getAttribute('aria-checked')).toBe('false'))
  })

  it('stays as it was if the device doesn’t take the change', async () => {
    lock.status.mockResolvedValue({ ...OFF, privacy: false })
    lock.privacy.mockRejectedValue(new Error('no'))
    await open()
    await userEvent.click(await privacy())
    await waitFor(() => expect(lock.privacy).toHaveBeenCalled())
    expect((await privacy()).getAttribute('aria-checked')).toBe('false')
  })

  it('is for iPhone and iPad: a Mac has no app switcher to be covered in', async () => {
    lock.status.mockResolvedValue({ ...OFF, device: 'Mac', privacy: false })
    await open()
    expect(screen.queryByRole('switch', { name: 'Privacy mode' })).toBeNull()
  })

  it('isn’t offered where the app says nothing of it', async () => {
    await open()
    expect(screen.queryByRole('switch', { name: 'Privacy mode' })).toBeNull()
  })
})
