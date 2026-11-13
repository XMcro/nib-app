// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'

/**
 * Reminders through the whole app (lib/reminders). Its own file because the
 * mocks below are module-wide: it's the app, which is what can ring; Plus is
 * on, so the palette offers "Lock this note…"; and the device's side of
 * reminders is stood in for.
 */

vi.mock('./editor/Editor', () => {
  const read = (body?: JSONContent) => body?.content?.[0]?.content?.[0]?.text ?? ''
  return {
    Editor: ({ initialBody }: { initialBody?: JSONContent }) => <textarea data-testid="editor" defaultValue={read(initialBody)} />,
  }
})

vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [{ active: true }, () => {}, true],
}))

// The device's side, stood in for: what it has waiting to ring, kept as the calls change it.
const device = vi.hoisted(() => {
  const state = {
    waiting: [] as { id: string; at: number; title?: string; snoozed?: boolean }[],
    schedule: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
    cancel: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
    list: async () => ({ reminders: state.waiting }),
    addListener: async () => ({ remove: async () => {} }),
  }
  return state
})
vi.mock('@capacitor/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@capacitor/core')>()
  return { ...real, registerPlugin: (name: string, ...rest: []) => (name === 'NibReminders' ? device : real.registerPlugin(name, ...rest)) }
})
vi.mock('./lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/platform')>()), nativeApp: true, macApp: true, touchApp: false }))

const { App } = await import('./App')
const { db } = await import('./db/db')
const items = await import('./db/items')
const vault = await import('./lib/vault')

const bodyOf = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const MOD = /Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? 'Meta' : 'Control'

const soon = () => Date.now() + 3_600_000
const rung = () => device.schedule.mock.calls.map(([one]) => `${one.id}: ${one.title}${one.ask ? ' (asked)' : ''}`)
const palette = async (user: ReturnType<typeof userEvent.setup>, row: string | RegExp) => {
  await user.keyboard(`{${MOD}>}k{/${MOD}}`)
  await user.click(await screen.findByRole('button', { name: row }))
}

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
  localStorage.clear()
  localStorage.setItem('nib-device-asked', '1')
  // Taken into their notes already: what an earlier Nib left has its own test.
  localStorage.setItem('nib-reminders-kept', 'true')
  device.waiting = []
  device.schedule = vi.fn(async (one: { id: string; at: number; title: string }) => void (device.waiting = [...device.waiting.filter((kept) => kept.id !== one.id), { id: one.id, at: one.at, title: one.title }]))
  device.cancel = vi.fn(async ({ ids }: { ids: string[] }) => void (device.waiting = device.waiting.filter((kept) => !ids.includes(kept.id))))
})

afterEach(() => vault.closeVault())
afterEach(cleanup)

describe('a reminder on a note', () => {
  it('is set from Commands, kept with the note, and shown under its text', async () => {
    await items.create('note', bodyOf('Ferry at 07:40'), { id: 'ferry' })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('Ferry at 07:40'))
    await palette(user, 'Remind me…')
    expect(await screen.findByText('A notification with this note’s title. It rings on every device your library is on.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^Tomorrow morning/ }))

    await waitFor(async () => expect((await items.get('ferry'))!.reminder?.at).toBeGreaterThan(Date.now()))
    expect(rung()).toEqual(['ferry: Ferry at 07:40 (asked)'])
    expect(await screen.findByRole('button', { name: /^Reminder · Tomorrow / })).toBeTruthy()
  })

  it('repeats when it’s told to, which the row under the text says', async () => {
    await items.create('note', bodyOf('Ferry at 07:40'), { id: 'ferry' })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('Ferry at 07:40'))
    await palette(user, 'Remind me…')
    await user.selectOptions(await screen.findByLabelText('Repeat'), 'Weekly')
    await user.click(screen.getByRole('button', { name: /^Tomorrow morning/ }))
    await waitFor(async () => expect((await items.get('ferry'))!.reminder?.repeat).toBe('week'))
    expect(device.schedule).toHaveBeenCalledWith(expect.objectContaining({ id: 'ferry', repeat: 'week', ask: true }))
    expect(await screen.findByRole('button', { name: /^Reminder · Tomorrow .* · weekly$/ })).toBeTruthy()
  })

  it('shows in its dialog how the one set repeats', async () => {
    await items.create('note', bodyOf('Ferry at 07:40'), { id: 'ferry' })
    await items.setReminder('ferry', { at: soon(), repeat: 'month' })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('Ferry at 07:40'))
    await user.click(await screen.findByRole('button', { name: /^Reminder · .* · monthly$/ }))
    expect(await screen.findByText(/, monthly\. It rings on every device your library is on\.$/)).toBeTruthy()
    expect(screen.getByLabelText<HTMLSelectElement>('Repeat').value).toBe('month')
  })

  it('is taken off the note from its dialog, and this device stops waiting to ring', async () => {
    await items.create('note', bodyOf('Ferry at 07:40'), { id: 'ferry' })
    await items.setReminder('ferry', { at: soon() })
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(device.waiting.map((one) => one.id)).toEqual(['ferry']))
    await user.click(await screen.findByText('Ferry at 07:40'))
    await user.click(await screen.findByRole('button', { name: /^Reminder · / }))
    await user.click(await screen.findByText('Remove reminder'))
    await waitFor(async () => expect((await items.get('ferry'))!.reminder).toBeNull())
    await waitFor(() => expect(device.waiting).toEqual([]))
    expect(screen.queryByRole('button', { name: /^Reminder · / })).toBeNull()
  })
})

describe('a reminder snoozed from its notification', () => {
  it('is shown under the note, and removing the reminder cancels it', async () => {
    await items.create('note', bodyOf('Ferry at 07:40'), { id: 'ferry' })
    // It rang a minute ago, and was snoozed for an hour, on this device.
    await items.setReminder('ferry', { at: Date.now() - 60_000 })
    device.waiting = [{ id: 'ferry', at: soon(), title: 'Ferry at 07:40', snoozed: true }]
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('Ferry at 07:40'))
    await user.click(await screen.findByRole('button', { name: /^Reminder · .* · snoozed$/ }))
    expect(await screen.findByText(/^Snoozed on this device until /)).toBeTruthy()
    // Left waiting, so far: the note still has its reminder.
    expect(device.cancel).not.toHaveBeenCalled()
    await user.click(screen.getByText('Remove reminder'))
    await waitFor(() => expect(device.waiting).toEqual([]))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Reminder · / })).toBeNull())
  })
})

describe('a device and its library’s reminders', () => {
  it('rings for one that comes with a note from another device, without asking to be allowed', async () => {
    await items.create('note', bodyOf('Ferry at 07:40'), { id: 'ferry' })
    render(<App />)
    await screen.findByText('Ferry at 07:40')
    expect(device.schedule).not.toHaveBeenCalled()
    await act(() => items.setReminder('ferry', { at: soon() }))
    await waitFor(() => expect(rung()).toEqual(['ferry: Ferry at 07:40']))
  })

  // Before the library is read there are no notes to be seen: taken for a library with none, that would cancel them all.
  it('cancels nothing it’s waiting to ring while the library is still being read', async () => {
    const when = soon()
    await items.create('note', bodyOf('Ferry at 07:40'), { id: 'ferry' })
    await items.setReminder('ferry', { at: when })
    device.waiting = [{ id: 'ferry', at: when, title: 'Ferry at 07:40' }]
    render(<App />)
    await screen.findByText('Ferry at 07:40')
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(device.cancel).not.toHaveBeenCalled()
    expect(device.waiting).toEqual([{ id: 'ferry', at: when, title: 'Ferry at 07:40' }])
  })

  it('stops waiting for a note put in the trash, and waits again for one put back', async () => {
    await items.create('note', bodyOf('Ferry at 07:40'), { id: 'ferry' })
    await items.setReminder('ferry', { at: soon() })
    render(<App />)
    await waitFor(() => expect(device.waiting.map((one) => one.id)).toEqual(['ferry']))
    await act(() => items.remove('ferry'))
    await waitFor(() => expect(device.waiting).toEqual([]))
    await act(() => items.restore('ferry'))
    await waitFor(() => expect(device.waiting.map((one) => one.id)).toEqual(['ferry']))
  })

  it('rings with the note’s title as it is now', async () => {
    await items.create('note', bodyOf('Ferry at 07:40'), { id: 'ferry' })
    await items.setReminder('ferry', { at: soon() })
    render(<App />)
    await waitFor(() => expect(device.waiting.map((one) => one.title)).toEqual(['Ferry at 07:40']))
    await act(() => items.update('ferry', bodyOf('Ferry at 08:10')))
    await waitFor(() => expect(device.waiting.map((one) => one.title)).toEqual(['Ferry at 08:10']))
  })

  it('says in the dialog when this device won’t ring one, its notifications being off', async () => {
    await items.create('note', bodyOf('Ferry at 07:40'), { id: 'ferry' })
    await items.setReminder('ferry', { at: soon() })
    device.schedule = vi.fn(() => Promise.reject(Object.assign(new Error('Notifications are off for Nib.'), { code: 'denied' })))
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(device.schedule).toHaveBeenCalledWith(expect.objectContaining({ id: 'ferry', ask: false })))
    await user.click(await screen.findByText('Ferry at 07:40'))
    // The note still says when: it rings on the others.
    await user.click(await screen.findByRole('button', { name: /^Reminder · / }))
    expect(await screen.findByText(/^Not on this one: notifications are off for Nib here\./)).toBeTruthy()
  })

  it('takes into its note, once, a reminder an earlier Nib kept on this device alone', async () => {
    localStorage.removeItem('nib-reminders-kept')
    const when = soon()
    await items.create('note', bodyOf('Ferry at 07:40'), { id: 'ferry' })
    device.waiting = [{ id: 'ferry', at: when }]
    render(<App />)
    await waitFor(async () => expect((await items.get('ferry'))!.reminder).toEqual({ at: when }))
    expect(localStorage.getItem('nib-reminders-kept')).toBe('true')
  })
})

// A reminder rings with its note's title; a note in the vault has none to show.
describe('reminders on a note locked into the vault', () => {
  it('ring as "A locked note" once it is locked here, the one waiting taken down first', async () => {
    await items.create('note', bodyOf('Ferry at 07:40'), { id: 'ferry' })
    await items.setReminder('ferry', { at: soon() })
    await vault.openVault('harbour lights', [])
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(device.waiting.map((one) => one.title)).toEqual(['Ferry at 07:40']))
    await user.click(await screen.findByText('Ferry at 07:40'))
    await palette(user, /^Lock this note/)

    await waitFor(() => expect(device.waiting.map((one) => one.title)).toEqual(['A locked note']))
    expect(device.cancel).toHaveBeenCalledWith({ ids: ['ferry'] })
  })

  it('ring as "A locked note" once a lock arrives by sync', async () => {
    await items.create('note', bodyOf('Ferry at 07:40'), { id: 'ferry' })
    await items.setReminder('ferry', { at: soon() })
    render(<App />)
    await waitFor(() => expect(device.waiting.map((one) => one.title)).toEqual(['Ferry at 07:40']))

    await act(() => db.items.update('ferry', { vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) }, body: vault.LOCKED_BODY }))
    await waitFor(() => expect(device.waiting.map((one) => one.title)).toEqual(['A locked note']))
  })
})
