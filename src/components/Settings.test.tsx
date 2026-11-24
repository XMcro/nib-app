// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState, type ComponentProps } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Sync } from '../sync'
import { Settings } from './Settings'

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

function setup(overrides: Partial<Parameters<typeof Settings>[0]> = {}) {
  const handlers = {
    onThemeChange: vi.fn(),
    onExport: vi.fn(),
    onExportCurrent: vi.fn(),
    onExportCurrentAs: vi.fn(),
    onGoalChange: vi.fn(),
    onImport: vi.fn(),
    onBackup: vi.fn(),
    onRestore: vi.fn(),
    onPlusChange: vi.fn(),
  }
  render(
    <WithGear theme="system" canExportCurrent goal={0} subscription={{ active: false }} plus={false} sync={SYNC_OFF} {...handlers} {...overrides} />,
  )
  return handlers
}

const openPanel = () => userEvent.click(screen.getByLabelText('Settings'))
const advancedToggle = () => screen.getByRole('button', { name: /Advanced/ })
const openAdvanced = async () => {
  await openPanel()
  await userEvent.click(advancedToggle())
}

afterEach(() => vi.restoreAllMocks())

describe('Settings', () => {
  it('stays closed until asked', () => {
    setup()
    expect(screen.queryByText('Appearance')).toBeNull()
  })

  it('marks the active theme and reports a change', async () => {
    const { onThemeChange } = setup({ theme: 'dark' })
    await openPanel()

    expect(screen.getByText('Dark').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Light').getAttribute('aria-pressed')).toBe('false')

    await userEvent.click(screen.getByText('Light'))
    expect(onThemeChange).toHaveBeenCalledWith('light')
  })

  it('offers the named themes, a free one at once', async () => {
    const { onThemeChange } = setup({ theme: 'gruvbox-light' })
    await openPanel()
    // The seventeen named (Winter waits for Christmas Day), and one's own.
    expect(screen.getAllByRole('radio')).toHaveLength(18)
    expect(screen.getByRole('radio', { name: /Gruvbox Light/ }).getAttribute('aria-checked')).toBe('true')
    // None of Light, Dark and System is the choice.
    for (const mode of ['Light', 'Dark', 'System']) expect(screen.getByText(mode).getAttribute('aria-pressed')).toBe('false')

    await userEvent.click(screen.getByRole('radio', { name: /Midnight Blue/ }))
    expect(onThemeChange).toHaveBeenCalledWith('midnight-blue')
  })

  it('leads a Plus theme to Billing without Plus, and chooses it with', async () => {
    const { onThemeChange } = setup()
    await openPanel()
    await userEvent.click(screen.getByRole('radio', { name: /Alien Pink/ }))
    expect(onThemeChange).not.toHaveBeenCalled()
    expect(screen.queryByText('Appearance')).toBeNull()
  })

  it('leads one’s own theme to Billing without Plus, and chooses it with', async () => {
    const { onThemeChange } = setup()
    await openPanel()
    await userEvent.click(screen.getByRole('radio', { name: /Your own/ }))
    expect(onThemeChange).not.toHaveBeenCalled()
    expect(screen.queryByText('Appearance')).toBeNull()
    cleanup()

    const plus = setup({ subscription: { active: true }, plus: true })
    await openPanel()
    await userEvent.click(screen.getByRole('radio', { name: /Your own/ }))
    expect(plus.onThemeChange).toHaveBeenCalledWith('custom')
  })

  it('chooses a Plus theme with Plus', async () => {
    const { onThemeChange } = setup({ subscription: { active: true }, plus: true })
    await openPanel()
    await userEvent.click(screen.getByRole('radio', { name: /Alien Pink/ }))
    expect(onThemeChange).toHaveBeenCalledWith('alien-pink')
  })

  it('offers Plus through Billing, and promises free Markdown export', async () => {
    setup()
    await openPanel()
    expect(screen.getByText(/Markdown export is free forever/)).toBeTruthy()
    expect(screen.queryByText('Planned')).toBeNull()
    // The lock is native; a browser has nothing to lock it with.
    expect(screen.queryByRole('switch', { name: 'Lock Nib' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /Nib Plus/ }))
    expect(screen.getByText('Billing')).toBeTruthy()
    // jsdom is a browser, not the iOS app, so nothing is for sale here.
    expect(screen.getByText(/sold in the Nib app for iPhone, iPad and Mac/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.getByText('Appearance')).toBeTruthy()
  })

  it('shows Plus as active once bought', async () => {
    setup({ subscription: { active: true }, plus: true })
    await openPanel()
    expect(screen.getByRole('button', { name: /Nib Plus/ }).textContent).toContain('Active')
  })

  it('keeps Advanced collapsed by default — the calm state', async () => {
    setup()
    await openPanel()
    expect(advancedToggle().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Export everything as Markdown')).toBeNull()

    await userEvent.click(advancedToggle())
    expect(screen.getByText('Export everything as Markdown')).toBeTruthy()
  })

  it('exports everything and the open document separately', async () => {
    const { onExport, onExportCurrent } = setup()
    await openAdvanced()

    await userEvent.click(screen.getByText('Export everything as Markdown'))
    expect(onExport).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByText('Export this one as Markdown'))
    expect(onExportCurrent).toHaveBeenCalledOnce()
  })

  it('disables Export this one when nothing is open', async () => {
    setup({ canExportCurrent: false })
    await openAdvanced()
    const button = screen.getByText('Export this one as Markdown') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('hands over the chosen files and clears the input for a repeat pick', async () => {
    const { onImport } = setup()
    await openAdvanced()

    const input = screen.getByLabelText(/^Import notes…/) as HTMLInputElement
    const file = new File(['# hi'], 'note.md', { type: 'text/markdown' })
    await userEvent.upload(input, file)

    expect(onImport).toHaveBeenCalledOnce()
    expect(onImport.mock.calls[0][0][0].name).toBe('note.md')
    // Cleared, so choosing the same file twice still fires a change.
    expect(input.value).toBe('')
  })

  it('downloads a full backup from Advanced', async () => {
    const { onBackup } = setup()
    await openAdvanced()
    await userEvent.click(screen.getByText('Download a full backup'))
    expect(onBackup).toHaveBeenCalledOnce()
    // And says what isn't in it: a picture's original, which is a file beside the library (lib/files).
    expect(screen.getByText(/A backup keeps ids/).textContent).toMatch(/each picture as its note has it\.\s+Full-quality originals and attached files, kept with Nib Plus,\s+aren’t in it: they stay on this device, and are in the device’s\s+own backups\./)
  })

  it('asks before restoring, and does nothing if the answer is no', async () => {
    const { onRestore } = setup()
    await openAdvanced()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    const input = screen.getByLabelText('Restore from a backup…') as HTMLInputElement
    const file = new File(['{}'], 'nib-backup-2026-08-13.json', { type: 'application/json' })
    await userEvent.upload(input, file)

    expect(confirm).toHaveBeenCalledOnce()
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('hands over the backup file once restore is confirmed', async () => {
    const { onRestore } = setup()
    await openAdvanced()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const input = screen.getByLabelText('Restore from a backup…') as HTMLInputElement
    const file = new File(['{}'], 'nib-backup-2026-08-13.json', { type: 'application/json' })
    await userEvent.upload(input, file)

    expect(onRestore).toHaveBeenCalledOnce()
    expect(onRestore.mock.calls[0][0].name).toBe('nib-backup-2026-08-13.json')
    expect(input.value).toBe('')
  })

  it('shows the notices of what Nib is built with, from the file the build writes beside it', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('react 19.2.8 (MIT)', { headers: { 'content-type': 'text/plain; charset=utf-8' } }))
    setup()
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledgements ›' }))

    expect(await screen.findByText('react 19.2.8 (MIT)')).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('/licences.txt')
    await userEvent.click(screen.getByRole('button', { name: '← Back' }))
    expect(screen.getByText('Appearance')).toBeTruthy()
  })

  // The dev server answers with the app's page.
  it('says so where the build wrote no notices', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }))
    setup()
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledgements ›' }))

    expect(await screen.findByText('This copy of Nib was built without its notices.')).toBeTruthy()
  })

  it('shows the build version', async () => {
    setup()
    await openPanel()
    // Split across two text nodes, so match on the element's whole content.
    expect(
      screen.getByText((_, element) => element?.textContent === 'Nib test'),
    ).toBeTruthy()
  })
})
