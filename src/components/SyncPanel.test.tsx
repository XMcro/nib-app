// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Sync } from '../sync'
import { SyncHttpError } from '../sync/api'
import { CLIPPER_OUT } from '../lib/clipperOut'

const platform = vi.hoisted(() => ({ native: true }))
vi.mock('../lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/platform')>()),
  get nativeApp() {
    return platform.native
  },
}))
const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async () => {}) }))
vi.mock('../lib/clipboard', () => clipboard)

const { SyncPanel } = await import('./SyncPanel')
const CODE = '0123-4567-89AB-CDEF-GHJK-MNPQ'
const NEW_CODE = 'QPNM-KJHG-FEDC-BA98-7654-3210'
const ADDRESS = `https://sync.nib.test/v1/in/${'0123456789abcdef'.repeat(2)}.${'A'.repeat(43)}`
const NEW_ADDRESS = `https://sync.nib.test/v1/in/${'0123456789abcdef'.repeat(2)}.${'B'.repeat(43)}`
/** Where an inbox is, as the app says it: its address, and the address with its key for the browser extension. */
const at = (address: string) => ({ address, clipper: `${address}#${'K'.repeat(87)}` })

function setup({
  code = null,
  active = true,
  native = true,
  signing = null,
  startChanging = false,
  manual = false,
  status = undefined,
  inbox = undefined,
}: { code?: string | null; active?: boolean; native?: boolean; signing?: { device: boolean; required: boolean } | null; startChanging?: boolean; manual?: boolean; status?: Sync['status']; inbox?: string | null } = {}) {
  platform.native = native
  const sync: Sync = {
    status: code ? { state: 'synced', at: Date.now() } : { state: 'off' },
    code,
    known: true,
    create: vi.fn(async () => CODE),
    join: vi.fn(async () => {}),
    turnOff: vi.fn(async () => {}),
    wipe: vi.fn(async () => {}),
    changeCode: vi.fn(async () => NEW_CODE),
    signing: vi.fn(async () => signing),
    requireSigned: vi.fn(async () => {}), filesRoom: async () => null,
    manual,
    setManual: vi.fn(),
    syncNow: vi.fn(),
    refetch: vi.fn(async () => {}),
    inboxAddress: vi.fn(async () => (typeof inbox === 'string' ? at(inbox) : inbox)),
    newInboxAddress: vi.fn(async () => at(NEW_ADDRESS)),
    endInbox: vi.fn(async () => {}),
    ...(status ? { status } : {}),
  }
  const onOpenBilling = vi.fn()
  render(<SyncPanel sync={sync} subscribed={active} startChanging={startChanging} onBack={vi.fn()} onOpenBilling={onOpenBilling} />)
  return { sync, onOpenBilling }
}

describe('SyncPanel', () => {
  it('sends someone without Plus to Billing', async () => {
    const { onOpenBilling } = setup({ active: false })
    await userEvent.click(screen.getByRole('button', { name: 'See Nib Plus' }))
    expect(onOpenBilling).toHaveBeenCalledOnce()
  })

  it('creates a library and shows its code once', async () => {
    const { sync } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Turn on sync' }))
    expect(sync.create).toHaveBeenCalledOnce()
  })

  it('joins with a code typed however it was copied, and refuses one that is not a code', async () => {
    const { sync } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Use a code from another device' }))
    await userEvent.type(screen.getByLabelText('Sync code'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(sync.join).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toMatch(/isn’t a sync code/)

    await userEvent.clear(screen.getByLabelText('Sync code'))
    await userEvent.type(screen.getByLabelText('Sync code'), '0123 4567 89ab cdef ghjk mnpq')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(sync.join).toHaveBeenCalledWith(CODE)
  })

  // Two lines now, so the whole code shows; Return still connects, and never
  // starts a new line in it.
  it('connects on Return', async () => {
    const { sync } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Use a code from another device' }))
    await userEvent.type(screen.getByLabelText('Sync code'), `${CODE}{Enter}`)
    expect(sync.join).toHaveBeenCalledOnce()
    expect(sync.join).toHaveBeenCalledWith(CODE)
  })

  it('on the website, only offers to join — the library is created in the app', () => {
    setup({ native: false, active: false })
    expect(screen.queryByRole('button', { name: 'Turn on sync' })).toBeNull()
    expect(screen.getByLabelText('Sync code')).toBeTruthy()
    expect(screen.getByText(/sold in the Nib app/)).toBeTruthy()
  })

  it('asks twice before turning off or deleting the server copy', async () => {
    const { sync } = setup({ code: CODE })
    await userEvent.click(screen.getByRole('button', { name: 'Delete everything on the server' }))
    expect(sync.wipe).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete it all from the server?' }))
    expect(sync.wipe).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByRole('button', { name: 'Turn off sync on this device' }))
    await userEvent.click(screen.getByRole('button', { name: 'Turn off on this device?' }))
    expect(sync.turnOff).toHaveBeenCalledOnce()
  })

  // A code that has got out: everything moves to a new one, and the old
  // library goes. The new code is shown as a new library's is.
  it('asks twice before changing the code, then shows the new one, its copy leaving the clipboard', async () => {
    const { sync } = setup({ code: CODE })
    await userEvent.click(screen.getByRole('button', { name: 'Change the sync code' }))
    expect(sync.changeCode).not.toHaveBeenCalled()
    expect(screen.getByText(/stop syncing until you enter the new code/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Change the code for every device?' }))
    expect(sync.changeCode).toHaveBeenCalledOnce()
    expect(await screen.findByText(NEW_CODE)).toBeTruthy()
    expect(screen.getByText(/This is your new sync code/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(clipboard.copyText).toHaveBeenCalledWith(NEW_CODE, undefined, { expires: true })
  })

  it('opens asking to change the code, from the palette', async () => {
    const { sync } = setup({ code: CODE, startChanging: true })
    await userEvent.click(screen.getByRole('button', { name: 'Change the code for every device?' }))
    expect(sync.changeCode).toHaveBeenCalledOnce()
  })

  it('says what went wrong when the code can’t be changed', async () => {
    const { sync } = setup({ code: CODE, startChanging: true })
    vi.mocked(sync.changeCode).mockRejectedValueOnce(new TypeError('Load failed'))
    await userEvent.click(screen.getByRole('button', { name: 'Change the code for every device?' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/Nothing has changed/)
    expect(screen.queryByText(NEW_CODE)).toBeNull()
  })

  it('offers to change the code only in the app, with Plus: a new library needs it', () => {
    setup({ code: CODE, native: false, active: false })
    expect(screen.queryByRole('button', { name: 'Change the sync code' })).toBeNull()
  })

  it('shows the code when asked', async () => {
    setup({ code: CODE })
    expect(screen.queryByText(CODE)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show code' }))
    expect(screen.getByText(CODE)).toBeTruthy()
  })
})

// Every request is signed already, where the device can; required, the
// server takes nothing else, so a request caught in passing is no use.
describe('SyncPanel and signed sync', () => {
  it('lets a device that signs require it, saying every device has to be up to date first', async () => {
    const { sync } = setup({ code: CODE, signing: { device: true, required: false } })
    const box = await screen.findByRole('checkbox', { name: 'Require signed sync' })
    expect(screen.getByText(/once every device that syncs this library is updated/)).toBeTruthy()
    await userEvent.click(box)
    expect(sync.requireSigned).toHaveBeenCalledWith(true)
    expect(await screen.findByRole('checkbox', { name: 'Require signed sync' })).toHaveProperty('checked', true)
  })

  it('says nothing of it on a device that can’t sign', async () => {
    setup({ code: CODE, signing: { device: false, required: false } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('checkbox', { name: 'Require signed sync' })).toBeNull()
  })
})

describe('SyncPanel and syncing only when asked', () => {
  const only = () => screen.getByRole<HTMLInputElement>('checkbox', { name: 'Sync only when I ask' })
  const now = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Sync now' })

  it('has a switch for this device, off as it comes, and says what it does', async () => {
    const { sync } = setup({ code: CODE })
    expect(only().checked).toBe(false)
    expect(screen.getByText('On this device, Nib then sends and fetches your writing only when you choose Sync now.')).toBeTruthy()
    await userEvent.click(only())
    expect(sync.setManual).toHaveBeenCalledWith(true)
  })

  // Asked 2026-11-13: "This device only" was on cards with nothing in Sync to say what it was or where it's set.
  it('says how one note or page is kept off the other devices, and where', () => {
    setup({ code: CODE })
    expect(screen.getByText(/open it and choose Commands → Keep on this device only/)).toBeTruthy()
  })

  it('shows it on, says where things stand, and turns it off again', async () => {
    const { sync } = setup({ code: CODE, manual: true, status: { state: 'manual', message: 'Changes on this device haven’t been sent.' } })
    expect(only().checked).toBe(true)
    expect(screen.getByText('Syncs when you ask')).toBeTruthy()
    expect(screen.getByText('Changes on this device haven’t been sent.')).toBeTruthy()
    await userEvent.click(only())
    expect(sync.setManual).toHaveBeenCalledWith(false)
  })

  it('syncs now when asked, whichever way the switch is, and not while it’s already at it', async () => {
    const { sync } = setup({ code: CODE })
    await userEvent.click(now())
    expect(sync.syncNow).toHaveBeenCalledTimes(1)
    cleanup()
    setup({ code: CODE, status: { state: 'syncing' } })
    expect(now().disabled).toBe(true)
    cleanup()
    // Another tab of this browser has it: this one can't.
    setup({ code: CODE, status: { state: 'elsewhere' } })
    expect(now().disabled).toBe(true)
  })

  it('has neither with sync off', () => {
    setup()
    expect(screen.queryByRole('checkbox', { name: 'Sync only when I ask' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()
  })
})

describe('SyncPanel and fetching everything again', () => {
  it('asks twice, saying what it does and that nothing is lost, then fetches', async () => {
    const { sync } = setup({ code: CODE })
    await userEvent.click(screen.getByRole('button', { name: 'Fetch everything again' }))
    expect(sync.refetch).not.toHaveBeenCalled()
    expect(screen.getByText('This device reads the whole library from the server again and merges it with what’s here. Where the two differ, the newer stays and the other goes into that note’s history. Nothing is deleted.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Fetch it all again?' }))
    expect(sync.refetch).toHaveBeenCalledTimes(1)
  })

  it('says so when it couldn’t', async () => {
    const { sync } = setup({ code: CODE })
    vi.mocked(sync.refetch).mockRejectedValueOnce(new Error('offline'))
    await userEvent.click(screen.getByRole('button', { name: 'Fetch everything again' }))
    await userEvent.click(screen.getByRole('button', { name: 'Fetch it all again?' }))
    expect(await screen.findByText('Couldn’t start fetching it again.')).toBeTruthy()
  })
})


describe('SyncPanel and the inbox', () => {
  const MEANS = 'A note sent to the address reaches Nib’s server readable, because the service sending it can’t encrypt it. The server seals it at once with a key only your devices hold, and keeps nothing it can read. Anyone who has the address can send notes to it.'

  it('says nothing of it until the server has said whether there is one, or when it can’t be asked; nor with sync off', async () => {
    const { sync } = setup({ code: CODE })
    await vi.waitFor(() => expect(sync.inboxAddress).toHaveBeenCalled())
    expect(screen.queryByText('Inbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Turn on the inbox' })).toBeNull()
    cleanup()
    const off = setup()
    expect(off.sync.inboxAddress).not.toHaveBeenCalled()
    expect(screen.queryByText('Inbox')).toBeNull()
  })

  it('asks the server once, however often Nib draws the panel again; and so keeps an address just made', async () => {
    const sync = { status: { state: 'synced', at: 1 }, code: CODE, known: true, signing: async () => null, manual: false, inboxAddress: vi.fn(async () => null), newInboxAddress: vi.fn(async () => at(NEW_ADDRESS)) } as unknown as Sync
    const panel = (drawn: Sync) => <SyncPanel sync={drawn} subscribed onBack={() => {}} onOpenBilling={() => {}} />
    const { rerender } = render(panel(sync))
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on the inbox' }))
    await userEvent.click(screen.getByRole('button', { name: 'Turn on the inbox?' }))
    expect((await screen.findByLabelText('Inbox address')).textContent).toBe(NEW_ADDRESS)
    // As sync's state changes, the app hands the panel a new object with the same doings.
    for (const at of [2, 3, 4]) rerender(panel({ ...sync, status: { state: 'synced', at } }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sync.inboxAddress).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Inbox address').textContent).toBe(NEW_ADDRESS)
    cleanup()
  })

  it('asks twice before turning it on, saying what it means in between, then shows the address', async () => {
    const { sync } = setup({ code: CODE, inbox: null })
    expect(await screen.findByText('An address other apps and services can send notes to. Each one becomes a note here.')).toBeTruthy()
    expect(screen.queryByText(MEANS)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Turn on the inbox' }))
    expect(sync.newInboxAddress).not.toHaveBeenCalled()
    expect(screen.getByText(MEANS)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Turn on the inbox?' }))
    expect(sync.newInboxAddress).toHaveBeenCalledOnce()
    expect((await screen.findByLabelText('Inbox address')).textContent).toBe(NEW_ADDRESS)
    expect(screen.queryByRole('button', { name: 'Turn on the inbox' })).toBeNull()
  })

  it('shows the address of an inbox there is, copies it so it leaves the clipboard again, and says how to send to it', async () => {
    setup({ code: CODE, inbox: ADDRESS })
    const shown = await screen.findByLabelText('Inbox address')
    expect(shown.textContent).toBe(ADDRESS)
    expect(screen.getByText(/^Send it a title, text or url\. Text is read as Markdown\. Anyone who has the address can send notes to it\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'How to send to it' }).getAttribute('href')).toBe('https://sync.nibprivacy.com/inbox')
    clipboard.copyText.mockClear()
    await userEvent.click(shown.parentElement!.querySelector('button')!)
    expect(clipboard.copyText).toHaveBeenCalledWith(ADDRESS, undefined, { expires: true })
  })

  // Held back till the extension's in the browsers' stores (lib/clipperOut, 2026-11-13): no code to copy for one nobody can get.
  it.runIf(!CLIPPER_OUT)('offers no code for the browser extension while it isn’t in the stores', async () => {
    setup({ code: CODE, inbox: ADDRESS })
    await screen.findByRole('button', { name: 'New address' })
    expect(screen.queryByRole('button', { name: 'Copy the code for Nib’s browser extension' })).toBeNull()
  })

  it.runIf(CLIPPER_OUT)('copies the code for the browser extension, which leaves the clipboard again too, and says so of that button alone', async () => {
    setup({ code: CODE, inbox: ADDRESS })
    const button = await screen.findByRole('button', { name: 'Copy the code for Nib’s browser extension' })
    clipboard.copyText.mockClear()
    await userEvent.click(button)
    expect(clipboard.copyText).toHaveBeenCalledWith(at(ADDRESS).clipper, undefined, { expires: true })
    expect(button.textContent).toBe('Copied')
    expect(screen.getByLabelText('Inbox address').parentElement!.querySelector('button')!.textContent).toBe('Copy')
    // The code itself isn't shown: it's the address and a key, for pasting once.
    expect(screen.queryByText(/#K{87}/)).toBeNull()
    cleanup()
    // Nor offered with no inbox.
    setup({ code: CODE, inbox: null })
    await screen.findByRole('button', { name: 'Turn on the inbox' })
    expect(screen.queryByRole('button', { name: 'Copy the code for Nib’s browser extension' })).toBeNull()
  })

  it('asks twice before replacing the address, saying the old one stops, then shows the new one', async () => {
    const { sync } = setup({ code: CODE, inbox: ADDRESS })
    await userEvent.click(await screen.findByRole('button', { name: 'New address' }))
    expect(sync.newInboxAddress).not.toHaveBeenCalled()
    expect(screen.getByText('The address in use now stops working at once.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Replace the address?' }))
    expect(sync.newInboxAddress).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(screen.getByLabelText('Inbox address').textContent).toBe(NEW_ADDRESS))
  })

  it('asks twice before turning it off, saying what goes, then offers to turn it on again', async () => {
    const { sync } = setup({ code: CODE, inbox: ADDRESS })
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off the inbox' }))
    expect(sync.endInbox).not.toHaveBeenCalled()
    expect(screen.getByText('Its address stops working, and notes waiting on the server are deleted.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Turn off the inbox?' }))
    expect(sync.endInbox).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Turn on the inbox' })).toBeTruthy()
    expect(screen.queryByLabelText('Inbox address')).toBeNull()
  })

  it('says what the server said when it refuses, and that nothing changed when it can’t be reached', async () => {
    const { sync } = setup({ code: CODE, inbox: null })
    vi.mocked(sync.newInboxAddress).mockRejectedValueOnce(new SyncHttpError(402, 'Nib Plus is not active for this library.'))
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on the inbox' }))
    await userEvent.click(screen.getByRole('button', { name: 'Turn on the inbox?' }))
    expect(await screen.findByText('Nib Plus is not active for this library.')).toBeTruthy()
    expect(screen.queryByLabelText('Inbox address')).toBeNull()
    cleanup()

    const on = setup({ code: CODE, inbox: ADDRESS })
    vi.mocked(on.sync.endInbox).mockRejectedValueOnce(new TypeError('Load failed'))
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off the inbox' }))
    await userEvent.click(screen.getByRole('button', { name: 'Turn off the inbox?' }))
    expect(await screen.findByText('Couldn’t reach the sync server. Nothing has changed.')).toBeTruthy()
    expect(screen.getByLabelText('Inbox address').textContent).toBe(ADDRESS)
    expect(screen.queryByText('Load failed')).toBeNull()
  })
})
