// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'

/**
 * Its own file because the mocks below are module-wide: Plus is on, so the
 * palette offers "Lock this note…"; `items.lock` holds once it has written
 * the lock, until the test lets it return, so a save can land while the
 * command is still finishing; `items.reseal` can be made to fail; and
 * stopping a share is recorded rather than sent.
 */

vi.mock('./editor/Editor', () => {
  const read = (body?: JSONContent) => body?.content?.[0]?.content?.[0]?.text ?? ''
  const write = (text: string): JSONContent => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  })
  return {
    Editor: ({ initialBody, onChange }: { initialBody?: JSONContent; onChange: (body: JSONContent) => void }) => (
      <textarea data-testid="editor" defaultValue={read(initialBody)} onChange={(event) => onChange(write(event.target.value))} />
    ),
  }
})

vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [{ active: true }, () => {}, true],
}))

const locking = vi.hoisted(() => ({
  held: null as Promise<void> | null,
  release: () => {},
  done: false,
  resealFails: false,
  /** Another device's edit, landing once while a lock, unlock or reseal is under way. */
  meanwhile: null as (() => Promise<unknown>) | null,
  /** A document that takes until `until` to read, as a locked one takes to open. */
  slow: null as { id: string; until: Promise<void> } | null,
}))
const landMeanwhile = async () => {
  const edit = locking.meanwhile
  locking.meanwhile = null
  await edit?.()
}
vi.mock('./db/items', async (importOriginal) => {
  const real = await importOriginal<typeof import('./db/items')>()
  return {
    ...real,
    lock: async (...args: Parameters<typeof real.lock>) => {
      await landMeanwhile()
      await real.lock(...args)
      locking.done = true
      await locking.held
    },
    get: async (...args: Parameters<typeof real.get>) => {
      const item = await real.get(...args)
      if (args[0] === locking.slow?.id) await locking.slow.until
      return item
    },
    unlock: async (...args: Parameters<typeof real.unlock>) => {
      await landMeanwhile()
      return real.unlock(...args)
    },
    reseal: async (...args: Parameters<typeof real.reseal>) => {
      if (locking.resealFails) throw new Error('disk full')
      await landMeanwhile()
      return real.reseal(...args)
    },
  }
})

const sharing = vi.hoisted(() => ({ revoke: vi.fn() }))
vi.mock('./share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./share')>()),
  revokeShare: (...args: unknown[]) => sharing.revoke(...args),
}))

const { App } = await import('./App')
const { db } = await import('./db/db')
const items = await import('./db/items')
const vault = await import('./lib/vault')

const textOf = (body: JSONContent) => body.content?.[0]?.content?.[0]?.text ?? ''
const bodyOf = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const MOD = /Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? 'Meta' : 'Control'

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
  locking.done = false
  locking.resealFails = false
  locking.meanwhile = null
  locking.slow = null
  sharing.revoke = vi.fn(async () => {})
  locking.held = new Promise((resolve) => (locking.release = resolve))
})

afterEach(() => vault.closeVault())

describe('App locking the open note', () => {
  // The writer's own typing, saved while the lock was finishing, used to look
  // like a lock from another device: it became a separate locked note.
  it('seals what is typed while the lock finishes into the note itself', async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    await vault.openVault('harbour lights', [])
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('MINE'))

    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^Lock this note/ }))
    await waitFor(() => expect(locking.done).toBe(true))
    await user.type(screen.getByTestId('editor'), '!')
    await waitFor(async () => expect(textOf((await vault.unseal('mine', (await items.get('mine'))!.vault!))!)).toBe('MINE!'))
    act(() => locking.release())

    expect(await screen.findByText(/^Locked\. Only the vault’s passcode opens it now/)).toBeTruthy()
    expect(screen.queryByText(/locked on another device/)).toBeNull()
    expect((await db.items.toArray()).filter((item) => item.id !== 'mine')).toEqual([])
    // And the next save isn't taken for another tab's.
    await user.type(screen.getByTestId('editor'), '?')
    await waitFor(async () => expect(textOf((await vault.unseal('mine', (await items.get('mine'))!.vault!))!)).toBe('MINE!?'))
    expect(screen.queryByText(/Also edited in another tab/)).toBeNull()
  })
})

describe('App asked to lock a note that has an attachment', () => {
  it('doesn’t, and says why: a lock seals the text, and a file is kept beside the library', async () => {
    const file = { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'application/pdf', size: 3000 }
    await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'MINUTES' }] }, { type: 'attachment', attrs: { file, name: 'report.pdf' } }] }, { id: 'minutes' })
    await vault.openVault('harbour lights', [])
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINUTES'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('MINUTES'))
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^Lock this note/ }))
    expect(await screen.findByText('A note with attachments can’t be locked. Take them out first.')).toBeTruthy()
    expect(locking.done).toBe(false)
    expect((await items.get('minutes'))!.vault).toBeFalsy()
  })
})

describe('App locking a note written in today', () => {
  // Its words leave the screen with the lock, but not today's count.
  it('keeps today’s words in it counted', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') }) // noon: the test's days can't change under it
    onTestFinished(() => void vi.useRealTimers())
    const { wordsToday } = await import('./lib/writtenHere')
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    wordsToday(await items.listAll(), Date.now()) // the day begins with it as it is
    await vault.openVault('harbour lights', [])
    locking.release()
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    await user.type(screen.getByTestId('editor'), ' and more')
    await waitFor(async () => expect(wordsToday(await items.listAll(), Date.now())).toBe(2))

    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^Lock this note/ }))
    await screen.findByText(/^Locked\. Only the vault’s passcode opens it now/)
    expect(wordsToday(await items.listAll(), Date.now())).toBe(2)
  })
})

describe('App locking while another device edits', () => {
  // Each wrote the text it read before sealing or opening it, over the edit
  // sync brought in meanwhile.
  it('locks the newer text', async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    await vault.openVault('harbour lights', [])
    locking.release()
    locking.meanwhile = () => items.update('mine', bodyOf('THEIRS'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^Lock this note/ }))
    await screen.findByText(/^Locked\. Only the vault’s passcode opens it now/)
    expect(await vault.unseal('mine', (await items.get('mine'))!.vault!)).toEqual(bodyOf('THEIRS'))
  })

  it('unlocks the newer text', async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    await vault.openVault('harbour lights', [])
    locking.release()
    await items.lock('mine', bodyOf('MINE'))
    locking.meanwhile = () => items.update('mine', bodyOf('THEIRS'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: 'Remove the lock' }))
    await screen.findByText(/^Unlocked\./)
    expect((await items.get('mine'))!.body).toEqual(bodyOf('THEIRS'))
  })

  it('reseals the newer text under a new passcode', { timeout: 20_000 }, async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    await vault.openVault('harbour lights', [])
    locking.release()
    await items.lock('mine', bodyOf('MINE'))
    locking.meanwhile = () => items.update('mine', bodyOf('THEIRS'))
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('MINE')
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^Change the vault passcode/ }))
    await user.type(await screen.findByLabelText('New passcode'), 'new harbour')
    await user.type(screen.getByLabelText('The same again'), 'new harbour')
    await user.click(screen.getByRole('button', { name: 'Change' }))
    // Argon2id, the new key's, takes a moment, the more so with the rest of the suite running.
    await screen.findByText('The vault’s passcode is changed.', {}, { timeout: 15_000 })

    vault.closeVault()
    const locked = (await items.get('mine'))!.vault!
    await vault.openVault('new harbour', [{ id: 'mine', vault: locked }])
    expect(await vault.unseal('mine', locked)).toEqual(bodyOf('THEIRS'))
  })
})

describe('App opening another note', () => {
  // What was typed into the note on screen while another opened was saved
  // into the one opening, over its text.
  it('saves what is typed meanwhile into the note it was typed in', async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    await items.create('note', bodyOf('OTHER'), { id: 'other' })
    let opens = () => {}
    locking.slow = { id: 'other', until: new Promise<void>((resolve) => (opens = resolve)) }
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('MINE'))

    await user.click(screen.getByText('OTHER'))
    fireEvent.change(screen.getByTestId('editor'), { target: { value: 'MINE!' } })
    act(() => opens())
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('OTHER'))
    await waitFor(async () => expect(textOf((await items.get('mine'))!.body)).toBe('MINE!'))
    await new Promise((resolve) => setTimeout(resolve, 600)) // past the save delay
    expect(textOf((await items.get('other'))!.body)).toBe('OTHER')
  })
})

describe('App changing the vault passcode', () => {
  // The key in use was swapped before the new seals were saved, so when saving
  // them failed, nothing locked would seal or open with the vault as it was.
  it('keeps the passcode in use when the new seals can’t be saved', async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    await vault.openVault('harbour lights', [])
    locking.release()
    await items.lock('mine', bodyOf('MINE'))
    locking.resealFails = true
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('MINE'))

    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^Change the vault passcode/ }))
    await user.type(await screen.findByLabelText('New passcode'), 'new harbour')
    await user.type(screen.getByLabelText('The same again'), 'new harbour')
    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy()
    await user.keyboard('{Escape}')

    await user.type(screen.getByTestId('editor'), '!')
    await waitFor(async () => expect(await vault.unseal('mine', (await items.get('mine'))!.vault!)).toEqual(bodyOf('MINE!')))
    expect(screen.queryByText(/passcode was changed/)).toBeNull()
  })
})

describe('App locking a shared note', () => {
  // A live link kept serving the note as it was when shared, with nothing to
  // say so: the lock stops nothing that is already online.
  it('says its shared draft is still online, and stops sharing it when asked', async () => {
    const live = { slug: 'ferry', key: 'k', owner: 'o', createdAt: 1, expiresAt: Date.now() + 86_400_000, free: true as const }
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    await items.setShares('mine', [live])
    await vault.openVault('harbour lights', [])
    locking.release()
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^Lock this note/ }))

    expect(await screen.findByText(/Its shared draft is still online/)).toBeTruthy()
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }))
    // The question comes after the note is read back, which can be after the
    // click returns, so wait for the notice to go: that is the last step.
    await waitFor(() => expect(screen.queryByText(/Its shared draft is still online/)).toBeNull())
    expect(ask).toHaveBeenCalledWith(expect.stringMatching(/^Stop sharing this draft\?/))
    expect(sharing.revoke).toHaveBeenCalledWith(live)
    expect((await items.get('mine'))!.shares).toEqual([])
    ask.mockRestore()
  })
})

// "Lawyer" above a locked note, or ticked in its filing dialog, said what its
// sealed text was about to anyone at the device (lib/folders filingHidden).
describe('App and a locked note’s folder', () => {
  it('shows it, and files the note, only while the vault is open', async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine', folder: 'Lawyer' })
    await vault.openVault('harbour lights', [])
    locking.release()
    await items.lock('mine', bodyOf('MINE'))
    vault.closeVault()
    const user = userEvent.setup()
    const shut = render(<App />)
    await user.click(await screen.findByText('Locked'))
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await screen.findByRole('button', { name: /Pin this/ })
    expect(screen.queryByRole('button', { name: /Move to folder/ })).toBeNull()
    expect(screen.queryByText('Lawyer')).toBeNull()
    shut.unmount()

    await vault.openVault('harbour lights', [{ id: 'mine', vault: (await items.get('mine'))!.vault! }])
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    expect((await screen.findAllByText('Lawyer')).length).toBeGreaterThan(0)
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    expect(await screen.findByRole('button', { name: /Move to folder/ })).toBeTruthy()
  })
})
