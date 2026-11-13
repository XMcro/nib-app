// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { useState, type ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Entitlement } from '../lib/plus'
import type { Sync } from '../sync'

// Settings as it is inside the iOS app, where Plus is sold.
vi.mock('../lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/platform')>()),
  nativeApp: true,
}))
vi.mock('../lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/plus')>()),
  store: { products: vi.fn(async () => ({ products: [] })), purchase: vi.fn(), restore: vi.fn(), manage: vi.fn() },
}))

const { Settings } = await import('./Settings')
const { store } = await import('../lib/plus')

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

const props = (plus: Entitlement) => ({
  theme: 'system' as const,
  canExportCurrent: true,
  subscription: plus,
  plus: plus.active,
  sync: SYNC_OFF,
  onThemeChange: vi.fn(),
  onExport: vi.fn(),
  onExportCurrent: vi.fn(),
  onExportCurrentAs: vi.fn(),
  goal: 0,
  onGoalChange: vi.fn(),
  onImport: vi.fn(),
  onBackup: vi.fn(),
  onRestore: vi.fn(),
  onPlusChange: vi.fn(),
})

async function open(plus: Entitlement, { goal = 0, onGoalChange = vi.fn() } = {}) {
  const onExportCurrentAs = vi.fn()
  render(
    <WithGear
      theme="system"
      canExportCurrent
      subscription={plus}
      plus={plus.active}
      sync={SYNC_OFF}
      onThemeChange={vi.fn()}
      onExport={vi.fn()}
      onExportCurrent={vi.fn()}
      onExportCurrentAs={onExportCurrentAs}
      goal={goal}
      onGoalChange={onGoalChange}
      onImport={vi.fn()}
      onBackup={vi.fn()}
      onRestore={vi.fn()}
      onPlusChange={vi.fn()}
    />,
  )
  await userEvent.click(screen.getByLabelText('Settings'))
  await userEvent.click(screen.getByRole('button', { name: /Advanced/ }))
  return onExportCurrentAs
}

describe('Word, PDF and HTML export in the app', () => {
  it('exports with Plus', async () => {
    const onExportCurrentAs = await open({ active: true })
    await userEvent.click(screen.getByRole('button', { name: 'PDF' }))
    expect(onExportCurrentAs).toHaveBeenCalledWith('pdf')
    await userEvent.click(screen.getByRole('button', { name: 'Word' }))
    expect(onExportCurrentAs).toHaveBeenCalledWith('docx')
  })

  it('without Plus, shows the formats marked Plus and leads to Billing instead of exporting', async () => {
    const onExportCurrentAs = await open({ active: false })
    expect(screen.getByText('Export this one as').parentElement!.textContent).toContain('Plus')
    await userEvent.click(screen.getByRole('button', { name: 'HTML' }))
    expect(onExportCurrentAs).not.toHaveBeenCalled()
    expect(await screen.findByText('Restore purchases')).toBeTruthy()
  })
})

describe('Goals', () => {
  it('sets the daily goal in words with Plus, in the Goals view', async () => {
    const onGoalChange = vi.fn()
    await open({ active: true }, { onGoalChange })
    await userEvent.click(screen.getByRole('button', { name: /Goals/ }))
    await userEvent.type(screen.getByLabelText('Daily goal, in words'), '5')
    expect(onGoalChange).toHaveBeenLastCalledWith(5)
  })

  it('shows the words written each day, from this device’s calendar', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') }) // noon: the test's days can't change under it
    onTestFinished(() => void vi.useRealTimers())
    const today = new Date()
    const day = (back: number) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }
    localStorage.setItem('nib-goal-calendar', JSON.stringify({ [day(0)]: 400, [day(3)]: 1200 }))
    await open({ active: true }, { goal: 500 })
    expect(screen.getByRole('button', { name: /Goals/ }).textContent).toContain('500 a day')
    await userEvent.click(screen.getByRole('button', { name: /Goals/ }))
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('1,600 words on 2 days in the last 26 weeks')
    expect(screen.getByTitle(/: 1,200 words$/)).toBeTruthy()
    localStorage.clear()
  })

  it('without Plus, sets the daily goal, and the calendar leads to Billing', async () => {
    const onGoalChange = vi.fn()
    await open({ active: false }, { onGoalChange })
    await userEvent.click(screen.getByRole('button', { name: /Goals/ }))
    await userEvent.type(screen.getByLabelText('Daily goal, in words'), '5')
    expect(onGoalChange).toHaveBeenLastCalledWith(5)
    expect(screen.queryByRole('img')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Words each day/ }))
    expect(await screen.findByText('Restore purchases')).toBeTruthy()
  })

  it('opens at Billing when asked to from elsewhere', async () => {
    const { rerender } = render(<WithGear {...props({ active: false })} />)
    expect(screen.queryByText('Restore purchases')).toBeNull()
    rerender(<WithGear {...props({ active: false })} openTo={{ view: 'billing', at: 1 }} />)
    expect(await screen.findByText('Restore purchases')).toBeTruthy()
  })

  // Its welcome's badge lands in the library or on the gear, which Settings
  // would otherwise be covering.
  it('makes way for the welcome once Plus is on', async () => {
    vi.mocked(store.restore).mockResolvedValueOnce({ active: true })
    const shown = props({ active: false })
    render(<WithGear {...shown} openTo={{ view: 'billing', at: 1 }} />)
    await userEvent.click(await screen.findByText('Restore purchases'))
    await vi.waitFor(() => expect(shown.onPlusChange).toHaveBeenCalledWith({ active: true }))
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
  })
})

describe('the style check rules', () => {
  it('switch on and off with Plus, on this device', async () => {
    localStorage.clear()
    await open({ active: true })
    expect(screen.getByText('Checked on this device. Turn it on for a document from the palette.')).toBeTruthy()
    const passive = screen.getByLabelText('Passive voice') as HTMLInputElement
    expect(passive.checked).toBe(true)
    await userEvent.click(passive)
    expect((screen.getByLabelText('Passive voice') as HTMLInputElement).checked).toBe(false)
    expect(JSON.parse(localStorage.getItem('nib-style-off')!)).toEqual(['passive'])
    localStorage.clear()
  })

  it('switch on and off without Plus too, which only counts', async () => {
    localStorage.clear()
    await open({ active: false })
    expect(screen.getByText(/It counts what it finds; Nib Plus underlines each one\./)).toBeTruthy()
    await userEvent.click(screen.getByLabelText('Clichés'))
    expect(JSON.parse(localStorage.getItem('nib-style-off')!)).toEqual(['cliche'])
    localStorage.clear()
  })
})
