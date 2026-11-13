import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState, type ComponentProps } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { page, userEvent } from 'vitest/browser'
import type { Sync } from '../sync'
import { Settings } from './Settings'
import '../index.css'

/** Settings as a screen of its own: a sheet on a wider screen, the whole of a phone's. Needs layout, so a browser. */

/** Settings opens from a gear elsewhere (App's \`openTo\`); this stands in for it. */
function WithGear(props: ComponentProps<typeof Settings>) {
  const [openTo, setOpenTo] = useState<ComponentProps<typeof Settings>['openTo']>(null)
  return (
    <>
      <button aria-label="Settings" className="size-4" onClick={() => setOpenTo({ view: 'main', at: Date.now() })} />
      <Settings {...props} openTo={props.openTo ?? openTo} />
    </>
  )
}

const SYNC_OFF: Sync = { status: { state: 'off' }, code: null, known: true, create: async () => '', join: async () => {}, turnOff: async () => {}, wipe: async () => {}, changeCode: async () => '', signing: async () => null, requireSigned: async () => {}, filesRoom: async () => null, manual: false, setManual: () => {}, syncNow: () => {}, refetch: async () => {}, inboxAddress: async () => undefined, newInboxAddress: async () => ({ address: '', clipper: '' }), endInbox: async () => {} }

afterEach(cleanup)

describe('Settings, as a screen', () => {
  // display:none, they could be reached only by a pointer on their labels.
  it('keeps Import and Restore where the keyboard and VoiceOver can reach them', async () => {
    render(<WithGear theme="system" canExportCurrent goal={0} subscription={{ active: false }} plus={false} sync={SYNC_OFF} onThemeChange={vi.fn()} onExport={vi.fn()} onExportCurrent={vi.fn()} onExportCurrentAs={vi.fn()} onGoalChange={vi.fn()} onImport={vi.fn()} onBackup={vi.fn()} onRestore={vi.fn()} onPlusChange={vi.fn()} />)
    await userEvent.click(screen.getByLabelText('Settings'))
    await userEvent.click(screen.getByRole('button', { name: /Advanced/ }))
    for (const input of [screen.getByLabelText(/^Import notes…/), screen.getByLabelText('Restore from a backup…')]) expect(getComputedStyle(input).display).not.toBe('none')
  })

  // Each name had 54 pixels and needed up to 73: every one but drcl was cut
  // short, and Gruvbox Dark and Gruvbox Light both read "Gruvbo…".
  it('shows every theme’s whole name, on a phone', async () => {
    await page.viewport(375, 812)
    render(
      <div>
        <WithGear theme="system" canExportCurrent goal={0} subscription={{ active: false }} plus={false} sync={SYNC_OFF} onThemeChange={vi.fn()} onExport={vi.fn()} onExportCurrent={vi.fn()} onExportCurrentAs={vi.fn()} onGoalChange={vi.fn()} onImport={vi.fn()} onBackup={vi.fn()} onRestore={vi.fn()} onPlusChange={vi.fn()} />
      </div>,
    )
    await userEvent.click(screen.getByLabelText('Settings'))
    const names = screen.getAllByRole('radio').map((tile) => tile.querySelector<HTMLElement>('span:not([aria-hidden])')!)
    // The ten named, and one's own.
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) expect(name.scrollWidth, name.textContent!).toBeLessThanOrEqual(name.clientWidth)
  })

  // Where a name takes two lines, Purple Green beside its Plus lock, its row
  // stood taller than the rest, and Cream Soda beside it.
  it.each([[1280, 800, 'a Mac'], [375, 812, 'an iPhone']])('keeps every theme tile one size at %ix%i (%s)', async (width, height) => {
    await page.viewport(width, height)
    render(
      <div>
        <WithGear theme="system" canExportCurrent goal={0} subscription={{ active: false }} plus={false} sync={SYNC_OFF} onThemeChange={vi.fn()} onExport={vi.fn()} onExportCurrent={vi.fn()} onExportCurrentAs={vi.fn()} onGoalChange={vi.fn()} onImport={vi.fn()} onBackup={vi.fn()} onRestore={vi.fn()} onPlusChange={vi.fn()} />
      </div>,
    )
    await userEvent.click(screen.getByLabelText('Settings'))
    const sizes = screen.getAllByRole('radio').map((tile) => `${Math.round(tile.getBoundingClientRect().width)}×${Math.round(tile.getBoundingClientRect().height)}`)
    expect(new Set(sizes), sizes.join(' ')).toHaveProperty('size', 1)
  })

  // One line held about four of a code's six groups, so a pasted code couldn't
  // be checked by eye before connecting. On a phone the text must stay 16px,
  // or iOS zooms in, so no single line holds it there either.
  it('shows the whole of a sync code being entered', async () => {
    await page.viewport(375, 812)
    render(
      <div>
        <WithGear theme="system" canExportCurrent goal={0} subscription={{ active: false }} plus={false} sync={SYNC_OFF} openTo={{ view: 'sync', at: 1 }} onThemeChange={vi.fn()} onExport={vi.fn()} onExportCurrent={vi.fn()} onExportCurrentAs={vi.fn()} onGoalChange={vi.fn()} onImport={vi.fn()} onBackup={vi.fn()} onRestore={vi.fn()} onPlusChange={vi.fn()} />
      </div>,
    )
    const field = screen.getByLabelText<HTMLInputElement | HTMLTextAreaElement>('Sync code')
    await userEvent.type(field, 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ23')
    expect(field.scrollWidth).toBeLessThanOrEqual(field.clientWidth)
    expect(field.scrollHeight).toBeLessThanOrEqual(field.clientHeight)
  })
})
