// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Item, ShareRef } from '../db/db'

const NEW: ShareRef = { slug: 'N'.repeat(22), key: 'K'.repeat(43), owner: 'O'.repeat(43), createdAt: Date.now(), expiresAt: Date.now() + 30 * 86_400_000 }
vi.mock('../share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../share')>()),
  createShare: vi.fn(async () => NEW),
  revokeShare: vi.fn(async () => {}),
  extendShare: vi.fn(async () => Date.now() + 90 * 86_400_000),
  shareStatus: vi.fn(async (): Promise<{ read: boolean; opens?: number }> => ({ read: false })),
}))

const shareModule = await import('../share')
const { ShareDialog } = await import('./ShareDialog')

const item = (overrides: Partial<Item> = {}): Item => ({
  id: 'doc',
  kind: 'page',
  body: { type: 'doc' },
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
})

function mount(document: Item, { plus = true, freeHolder }: { plus?: boolean; freeHolder?: string } = {}) {
  const onShares = vi.fn()
  const onPlus = vi.fn()
  render(
    <ShareDialog
      item={document}
      subscribed={plus}
      jws={plus ? 'the-jws' : undefined}
      freeHolder={freeHolder}
      onShares={onShares}
      onOpenNotes={vi.fn()}
      onPlus={onPlus}
      onClose={vi.fn()}
    />,
  )
  return Object.assign(onShares, { onPlus })
}

afterEach(() => vi.restoreAllMocks())

describe('ShareDialog', () => {
  it('says in plain words what sharing does, before doing it', () => {
    mount(item())
    expect(screen.getByText('The server stores this encrypted. Anyone with the link can read it and leave notes.')).toBeTruthy()
    expect(shareModule.createShare).not.toHaveBeenCalled()
  })

  it('shares for the chosen length, and keeps the record with the document', async () => {
    const onShares = mount(item())
    await userEvent.click(screen.getByRole('radio', { name: '7 days' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }))
    expect(shareModule.createShare).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc' }), 7, 'the-jws', { password: '', once: false })
    expect(onShares).toHaveBeenCalledWith([NEW])
  })

  it('shares with a password when one is given, and shows it with the link', async () => {
    mount(item())
    await userEvent.type(screen.getByPlaceholderText('Optional'), ' tide tables ')
    expect(screen.getByText(/Readers need it as well as the link/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }))
    expect(shareModule.createShare).toHaveBeenCalledWith(expect.anything(), expect.any(Number), 'the-jws', { password: 'tide tables', once: false })

    const live = { ...NEW, slug: 'P'.repeat(22), password: 'tide tables' }
    mount(item({ shares: [live] }))
    expect((screen.getByLabelText('Link to this draft') as HTMLInputElement).value).toMatch(new RegExp(`#${live.key}\\.p$`))
    expect(screen.getByText('tide tables')).toBeTruthy()
  })

  it('shows the link with its key, to copy, and stops sharing on request', async () => {
    const live = { ...NEW, slug: 'L'.repeat(22) }
    const onShares = mount(item({ shares: [{ ...NEW, slug: 'E'.repeat(22), expiresAt: 5 }, live] }))
    expect((screen.getByLabelText('Link to this draft') as HTMLInputElement).value).toMatch(new RegExp(`/d/${live.slug}#${live.key}$`))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Stop sharing' }))
    expect(shareModule.revokeShare).toHaveBeenCalledWith(live)
    // The expired record goes too.
    expect(onShares).toHaveBeenCalledWith([])
  })

  it('says why, when the server says no', async () => {
    vi.mocked(shareModule.createShare).mockRejectedValueOnce(new shareModule.ShareError(429, 'You can have 50 drafts shared at once. Revoke one to share another.'))
    mount(item())
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }))
    expect(await screen.findByText('You can have 50 drafts shared at once. Revoke one to share another.')).toBeTruthy()
  })

  describe('a link to be read once', () => {
    const once: ShareRef = { ...NEW, slug: 'R'.repeat(22), once: true }

    it('is made when asked for, and says first what that means', async () => {
      mount(item())
      const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Delete it after one reading' })
      expect(box.checked).toBe(false)
      expect(screen.queryByText(/The first reader to open it sees it/)).toBeNull()
      await userEvent.click(box)
      expect(screen.getByText('The first reader to open it sees it. Then the link stops working for anyone else, and it’s deleted from Nib’s server ten minutes later.')).toBeTruthy()
      // What it says at the top is no longer that anyone with the link can read it.
      expect(screen.getByText('The server stores this encrypted, until one reader opens it. They can leave notes.')).toBeTruthy()
      expect(screen.queryByText(/Anyone with the link/)).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'Create link' }))
      expect(shareModule.createShare).toHaveBeenCalledWith(expect.anything(), expect.any(Number), 'the-jws', { password: '', once: true })
    })

    it('says of a link there already is what that link is, whatever the box was left at', async () => {
      const dialog = (shares?: ShareRef[]) => <ShareDialog item={item({ shares })} subscribed jws="the-jws" onShares={vi.fn()} onOpenNotes={vi.fn()} onPlus={vi.fn()} onClose={vi.fn()} />
      const { rerender } = render(dialog())
      await userEvent.click(screen.getByRole('checkbox', { name: 'Delete it after one reading' }))
      // An ordinary link to it arrives, made on another device.
      rerender(dialog([{ ...NEW, slug: 'L'.repeat(22) }]))
      expect(screen.getByText('The server stores this encrypted. Anyone with the link can read it and leave notes.')).toBeTruthy()
    })

    it('asks the server whether it has been read, and says which', async () => {
      mount(item({ shares: [once] }))
      expect(screen.getByText('The server stores this encrypted, until one reader opens it. They can leave notes.')).toBeTruthy()
      // Until the server answers, only what it is.
      expect(screen.getByText('To be read once.')).toBeTruthy()
      expect(await screen.findByText('To be read once. Not read yet.')).toBeTruthy()
      expect(shareModule.shareStatus).toHaveBeenCalledWith({ slug: once.slug, owner: once.owner })
    })

    it('says so once it has been read', async () => {
      vi.mocked(shareModule.shareStatus).mockResolvedValueOnce({ read: true })
      mount(item({ shares: [once] }))
      expect(await screen.findByText('It has been read, and the link no longer works. Nib’s server deletes its copy ten minutes after the reading.')).toBeTruthy()
    })

    // Left open while the link is sent from another app: on an iPhone it still said "Not read yet" after the reader had read it.
    it('asks again when Nib comes back to the front, and not on its way to the back', async () => {
      const visibility = vi.spyOn(document, 'visibilityState', 'get')
      mount(item({ shares: [once] }))
      expect(await screen.findByText('To be read once. Not read yet.')).toBeTruthy()
      vi.mocked(shareModule.shareStatus).mockClear()

      visibility.mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      expect(shareModule.shareStatus).not.toHaveBeenCalled()

      vi.mocked(shareModule.shareStatus).mockResolvedValueOnce({ read: true })
      visibility.mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      expect(await screen.findByText('It has been read, and the link no longer works. Nib’s server deletes its copy ten minutes after the reading.')).toBeTruthy()

      // And no longer once the dialog has closed.
      cleanup()
      vi.mocked(shareModule.shareStatus).mockClear()
      document.dispatchEvent(new Event('visibilitychange'))
      expect(shareModule.shareStatus).not.toHaveBeenCalled()
    })

    it('says neither when the server can’t be asked', async () => {
      vi.mocked(shareModule.shareStatus).mockRejectedValueOnce(new Error('offline'))
      mount(item({ shares: [once] }))
      await waitFor(() => expect(shareModule.shareStatus).toHaveBeenCalled())
      expect(screen.getByText('To be read once.')).toBeTruthy()
      expect(screen.queryByText(/Not read yet|has been read/)).toBeNull()
    })

    it('doesn’t take one link’s answer for the next one’s', async () => {
      vi.mocked(shareModule.shareStatus).mockResolvedValueOnce({ read: true })
      const { rerender } = render(<ShareDialog item={item({ shares: [once] })} subscribed jws="the-jws" onShares={vi.fn()} onOpenNotes={vi.fn()} onPlus={vi.fn()} onClose={vi.fn()} />)
      await screen.findByText(/It has been read/)
      // The answer for the next is still on its way.
      let answer = (_status: { read: boolean }) => {}
      vi.mocked(shareModule.shareStatus).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      rerender(<ShareDialog item={item({ shares: [{ ...once, slug: 'T'.repeat(22) }] })} subscribed jws="the-jws" onShares={vi.fn()} onOpenNotes={vi.fn()} onPlus={vi.fn()} onClose={vi.fn()} />)
      expect(screen.queryByText(/It has been read/)).toBeNull()
      expect(screen.getByText('To be read once.')).toBeTruthy()
      answer({ read: false })
      expect(await screen.findByText('To be read once. Not read yet.')).toBeTruthy()
    })

    it('keeps the newer link’s answer when the older one’s comes late', async () => {
      const answers: ((status: { read: boolean }) => void)[] = []
      vi.mocked(shareModule.shareStatus).mockImplementation(() => new Promise((resolve) => answers.push(resolve)))
      const dialog = (share: ShareRef) => <ShareDialog item={item({ shares: [share] })} subscribed jws="the-jws" onShares={vi.fn()} onOpenNotes={vi.fn()} onPlus={vi.fn()} onClose={vi.fn()} />
      const { rerender } = render(dialog(once))
      rerender(dialog({ ...once, slug: 'T'.repeat(22) }))
      await waitFor(() => expect(answers).toHaveLength(2))
      answers[1]({ read: false })
      expect(await screen.findByText('To be read once. Not read yet.')).toBeTruthy()
      answers[0]({ read: true })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(screen.getByText('To be read once. Not read yet.')).toBeTruthy()
      vi.mocked(shareModule.shareStatus).mockImplementation(async () => ({ read: false }))
    })

    it('isn’t offered without Plus', () => {
      mount(item(), { plus: false })
      expect(screen.queryByRole('checkbox')).toBeNull()
    })
  })

  describe('how many times a link has been opened', () => {
    const live: ShareRef = { ...NEW, slug: 'C'.repeat(22) }
    const told = (opens: number) => vi.mocked(shareModule.shareStatus).mockResolvedValueOnce({ read: false, opens })

    it('is said before sharing: Nib counts, and readers are told', async () => {
      mount(item())
      expect(screen.getByText(/Nib counts how many times the link is opened, and tells readers so\./)).toBeTruthy()
      // One to be read once isn't counted: its writer is told that it was read.
      await userEvent.click(screen.getByRole('checkbox', { name: 'Delete it after one reading' }))
      expect(screen.queryByText(/Nib counts how many times/)).toBeNull()
    })

    it('is asked of the server and shown, with what readers are told', async () => {
      told(3)
      mount(item({ shares: [live] }))
      expect(screen.queryByText(/Opened|opened yet/)).toBeNull()
      expect(await screen.findByText('Opened 3 times. Readers are told that Nib counts this.')).toBeTruthy()
      expect(shareModule.shareStatus).toHaveBeenCalledWith({ slug: live.slug, owner: live.owner })
    })

    it('says none and one in plain words', async () => {
      told(0)
      mount(item({ shares: [live] }))
      expect(await screen.findByText('Not opened yet. Readers are told that Nib counts this.')).toBeTruthy()
      cleanup()
      told(1)
      mount(item({ shares: [live] }))
      expect(await screen.findByText('Opened once. Readers are told that Nib counts this.')).toBeTruthy()
    })

    it('says nothing when the server gives no number, or can’t be asked', async () => {
      mount(item({ shares: [live] }))
      await waitFor(() => expect(shareModule.shareStatus).toHaveBeenCalled())
      expect(screen.queryByText(/Opened|opened yet|counts this/)).toBeNull()
      cleanup()
      vi.mocked(shareModule.shareStatus).mockRejectedValueOnce(new Error('offline'))
      mount(item({ shares: [live] }))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(screen.queryByText(/Opened|opened yet|counts this/)).toBeNull()
    })

    it('isn’t shown on one to be read once, even if a number came', async () => {
      told(4)
      mount(item({ shares: [{ ...live, once: true }] }))
      expect(await screen.findByText('To be read once. Not read yet.')).toBeTruthy()
      expect(screen.queryByText(/Opened/)).toBeNull()
    })

    it('asks nothing of the server for a free link, which isn’t counted', () => {
      vi.mocked(shareModule.shareStatus).mockClear()
      mount(item({ shares: [{ ...live, free: true }] }), { plus: false })
      expect(shareModule.shareStatus).not.toHaveBeenCalled()
      expect(screen.queryByText(/Opened|counts/)).toBeNull()
    })
  })

  describe('without Plus', () => {
    it('makes one read-only link for 7 days, with no choice of length and no password', async () => {
      const onShares = mount(item(), { plus: false })
      expect(screen.getByText('The server stores this encrypted. Anyone with the link can read it.')).toBeTruthy()
      expect(screen.getByText(/for 7 days/)).toBeTruthy()
      expect(screen.queryByRole('radio')).toBeNull()
      expect(screen.queryByPlaceholderText('Optional')).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'Create link' }))
      expect(shareModule.createShare).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc' }), 7, undefined)
      expect(onShares).toHaveBeenCalledWith([NEW])
    })

    it('says what Plus adds, and leads there', async () => {
      const { onPlus } = mount(item(), { plus: false })
      await userEvent.click(screen.getByRole('button', { name: /A password, readers’ notes, longer links and more than one at a time are part of Nib Plus/ }))
      expect(onPlus).toHaveBeenCalledWith('A password, readers’ notes, longer links and more than one at a time are part of Nib Plus.')
    })

    it('shares one document at a time: names the one holding the free link', async () => {
      const { onPlus } = mount(item(), { plus: false, freeHolder: 'Chapter one' })
      expect(screen.getByText(/Your free link is sharing “Chapter one”/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Create link' })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'See Nib Plus' }))
      expect(onPlus).toHaveBeenCalledWith('With Nib Plus, share as many drafts as you like at once.')
    })

    it('shows a live free link without notes or extending, and stops it on request', async () => {
      const live: ShareRef = { ...NEW, slug: 'F'.repeat(22), free: true }
      const onShares = mount(item({ shares: [live] }), { plus: false })
      expect(screen.getByText('The server stores this encrypted. Anyone with the link can read it.')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Notes from readers' })).toBeNull()
      expect(screen.queryByLabelText('Keep it shared for')).toBeNull()
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      await userEvent.click(screen.getByRole('button', { name: 'Stop sharing' }))
      expect(confirm).toHaveBeenCalledWith('Stop sharing this draft? The link stops working for everyone.')
      expect(onShares).toHaveBeenCalledWith([])
    })
  })
})
