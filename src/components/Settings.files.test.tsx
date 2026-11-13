// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Sync } from '../sync'
import { Settings } from './Settings'

/** The room full-quality pictures take, said under Advanced (Settings `FilesLine`): on this device, and on the server with sync on. Each number is kept on a line with its unit (a no-break space), as a phone showed it needs. */

const device = vi.hoisted(() => ({ files: [] as { id: string; size: number }[] }))
vi.mock('../lib/files', () => ({ listFiles: async () => device.files }))

const sync = (room: Awaited<ReturnType<Sync['filesRoom']>>, code: string | null = null): Sync => ({
  status: { state: code ? 'synced' : 'off' },
  code,
  known: true,
  create: async () => '',
  join: async () => {},
  turnOff: async () => {},
  wipe: async () => {},
  changeCode: async () => '',
  signing: async () => null,
  requireSigned: async () => {},
  filesRoom: vi.fn(async () => room),
  manual: false,
  setManual: () => {},
  syncNow: () => {},
  refetch: async () => {}, inboxAddress: async () => undefined, newInboxAddress: async () => ({ address: '', clipper: '' }), endInbox: async () => {},
})

async function advanced(with_: Sync, onAttachments?: () => void) {
  const noop = vi.fn()
  render(<Settings theme="system" canExportCurrent goal={0} subscription={{ active: false }} plus={false} sync={with_} openTo={{ view: 'main', at: 1 }} onThemeChange={noop} onExport={noop} onExportCurrent={noop} onExportCurrentAs={noop} onGoalChange={noop} onImport={noop} onBackup={noop} onRestore={noop} onPlusChange={noop} onAttachments={onAttachments} />)
  await userEvent.click(screen.getByRole('button', { name: /Advanced/ }))
}
const line = () => screen.queryByText(/^Full-quality pictures and attachments take/)

afterEach(() => {
  cleanup()
  device.files = []
})

describe('the room full-quality pictures take', () => {
  it('isn’t spoken of where there are none', async () => {
    const off = sync(null)
    await advanced(off)
    await waitFor(() => expect(off.filesRoom).toHaveBeenCalled())
    expect(line()).toBeNull()
  })

  it('is said for this device, with sync off', async () => {
    device.files = [{ id: 'a', size: 30_400_000 }, { id: 'b', size: 17_800_000 }]
    await advanced(sync(null))
    await waitFor(() => expect(line()).not.toBeNull())
    expect(line()!.textContent).toBe('Full-quality pictures and attachments take 48\u00a0MB on this device.')
  })

  it('is said for the server too, of what they may take there, with sync on', async () => {
    device.files = [{ id: 'a', size: 400_000 }]
    await advanced(sync({ bytes: 1_260_000_000, limit: 2_000_000_000 }, 'a-code'))
    await waitFor(() => expect(line()?.textContent).toContain('server'))
    expect(line()!.textContent).toBe('Full-quality pictures and attachments take 400\u00a0KB on this device, and 1.3\u00a0GB of the 2\u00a0GB they may on Nib’s server.')
  })

  it('leads to the list of what’s attached, closing Settings on the way; and has no such way where there’s none to go', async () => {
    device.files = [{ id: 'a', size: 400_000 }]
    const shown = vi.fn()
    await advanced(sync(null), shown)
    await userEvent.click(await screen.findByRole('button', { name: 'See attachments' }))
    expect(shown).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()
    await advanced(sync(null))
    await waitFor(() => expect(line()).not.toBeNull())
    expect(screen.queryByRole('button', { name: 'See attachments' })).toBeNull()
    // Nor where no file is kept: the line isn't there to carry it.
    cleanup()
    device.files = []
    const off = sync(null)
    await advanced(off, shown)
    await waitFor(() => expect(off.filesRoom).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'See attachments' })).toBeNull()
  })

  it('is said when they’re all on the server and none has been fetched here', async () => {
    await advanced(sync({ bytes: 52_000_000, limit: 2_000_000_000 }, 'a-code'))
    await waitFor(() => expect(line()).not.toBeNull())
    expect(line()!.textContent).toBe('Full-quality pictures and attachments take no room on this device, and 52\u00a0MB of the 2\u00a0GB they may on Nib’s server.')
  })
})
