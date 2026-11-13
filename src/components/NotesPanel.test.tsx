// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ShareRef } from '../db/db'
import type { ReaderNote } from '../share'

const server = vi.hoisted(() => ({ notes: [] as ReaderNote[], notesOn: true, fail: false }))
vi.mock('../share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../share')>()),
  readNotes: vi.fn(async () => {
    if (server.fail) throw new Error('offline')
    return { notes: server.notes, notesOn: server.notesOn, expiresAt: 0 }
  }),
  deleteNote: vi.fn(async () => ({})),
  setNotesOn: vi.fn(async () => ({})),
}))

const shareModule = await import('../share')
const { NotesPanel } = await import('./NotesPanel')

const SHARE: ShareRef = { slug: 'S'.repeat(22), key: 'K'.repeat(43), owner: 'O'.repeat(43), createdAt: 1, expiresAt: 2 }

function mount({ current = (quote: string) => quote === 'the lamp', onShow = vi.fn() } = {}) {
  render(<NotesPanel share={SHARE} onBack={vi.fn()} isCurrent={current} onShow={onShow} />)
  return onShow
}

beforeEach(() => {
  server.notes = [
    { id: 1, at: Date.now(), quote: 'the lamp', text: 'Lovely image.', name: 'Sam' },
    { id: 2, at: Date.now(), quote: 'a cut sentence', text: 'This dragged.' },
    { id: 3, at: Date.now(), text: 'Loved all of it.' },
  ]
  server.notesOn = true
  server.fail = false
})

describe('NotesPanel', () => {
  it('shows each note under its passage, and says when the passage has been rewritten', async () => {
    const onShow = mount()
    expect(await screen.findByText('Lovely image.')).toBeTruthy()
    expect(screen.getByText(/^Sam ·/)).toBeTruthy()
    expect(screen.getAllByText('On an earlier draft')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'the lamp' }))
    expect(onShow).toHaveBeenCalledWith('the lamp')
    expect(screen.getByRole('button', { name: /a cut sentence/ }).hasAttribute('disabled')).toBe(true)
  })

  it('deletes a note, and turns notes off', async () => {
    mount()
    await screen.findByText('Lovely image.')
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete this note' })[0])
    await waitFor(() => expect(screen.queryByText('Lovely image.')).toBeNull())
    expect(shareModule.deleteNote).toHaveBeenCalledWith(SHARE, 1)
    await userEvent.click(screen.getByRole('button', { name: 'Turn notes off' }))
    expect(shareModule.setNotesOn).toHaveBeenCalledWith(SHARE, false)
    expect(await screen.findByRole('button', { name: 'Turn notes on' })).toBeTruthy()
  })

  it('says so when there are none', async () => {
    server.notes = []
    mount()
    expect(await screen.findByText('No notes yet. Readers can select a passage and add one.')).toBeTruthy()
  })

  it('says so when Nib can’t be reached', async () => {
    server.fail = true
    mount()
    expect(await screen.findByText(/^Couldn’t reach Nib/)).toBeTruthy()
  })
})
