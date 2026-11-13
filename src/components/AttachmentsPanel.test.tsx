// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import type { Opened } from '../lib/preview'
import { AttachmentsPanel } from './AttachmentsPanel'

/** The list of everything attached (components/AttachmentsPanel): what it says of each, where a row goes, and Open. Opening is a stand-in (lib/preview has its own tests). */

const at = vi.hoisted(() => ({ opened: [] as string[], went: 'opened' as Opened, go: null as (() => void) | null, wait: false }))
vi.mock('../lib/preview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/preview')>()),
  openAttached: async (file: { id: string }, name: string) => {
    at.opened.push(`${name} ${file.id.slice(-2)}`)
    if (at.wait) await new Promise<void>((resolve) => (at.go = resolve))
    return at.went
  },
}))

const file = (n: number, size: number, type = 'application/pdf') => ({ id: `7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c${String(n).padStart(2, '0')}`, type, size })
const attachment = (attrs: Record<string, unknown>): JSONContent => ({ type: 'attachment', attrs })
const item = (id: string, title: string, ...blocks: JSONContent[]): Item => ({ id, kind: 'note', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }, ...blocks] }, version: 1, createdAt: 1, updatedAt: 1 })
const LIBRARY = [item('a', 'Harbour plan', attachment({ file: file(1, 2_000, 'text/csv'), name: 'tides.csv' }), attachment({ file: file(2, 9_000_000), name: 'survey.pdf' })), item('b', 'Voice notes', attachment({ file: file(3, 1_400_000, 'audio/mp4'), name: 'memo.m4a' }))]

function show(items: Item[] = LIBRARY, trash: Item[] = []) {
  const [onBack, onOpen] = [vi.fn(), vi.fn()]
  render(<AttachmentsPanel items={items} trash={trash} onBack={onBack} onOpen={onOpen} />)
  return { onBack, onOpen }
}
const rows = () => screen.getAllByRole('listitem').map((row) => within(row).getAllByRole('button')[0].textContent)

beforeEach(() => {
  at.opened.length = 0
  at.went = 'opened'
  at.wait = false
})
afterEach(cleanup)

describe('the attachments list', () => {
  it('says how many there are and the room they take, and of each its name, kind, size and document, the largest first', () => {
    show()
    expect(screen.getByText(/^3 attachments · 10\sMB$/)).toBeTruthy()
    expect(rows()).toEqual(['survey.pdfPDF · 9\u00a0MB · in Harbour plan', 'memo.m4aAudio · 1\u00a0MB · in Voice notes', 'tides.csvSpreadsheet · 2\u00a0KB · in Harbour plan'])
    cleanup()
    show([LIBRARY[1]])
    expect(screen.getByText(/^1 attachment · 1\sMB$/)).toBeTruthy()
  })

  it('goes to a row’s document, and back to the library', async () => {
    const { onBack, onOpen } = show()
    await userEvent.click(screen.getByText('memo.m4a'))
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('b')
    expect(at.opened).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: '← Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('opens a row’s file from Open, saying so while it does, and going nowhere', async () => {
    const { onOpen } = show()
    at.wait = true
    const open = screen.getByRole('button', { name: 'Open survey.pdf' })
    await userEvent.click(open)
    expect(at.opened).toEqual(['survey.pdf 02'])
    expect(rows()[0]).toBe('survey.pdfOpening…')
    expect(open).toHaveProperty('disabled', true)
    at.go!()
    await waitFor(() => expect(rows()[0]).toBe('survey.pdfPDF · 9\u00a0MB · in Harbour plan'))
    expect(open).toHaveProperty('disabled', false)
    expect(onOpen).not.toHaveBeenCalled()
    // The others are as they were.
    expect(rows()[1]).toContain('Audio')
  })

  it('says which went wrong when one can’t be opened, on its own row', async () => {
    show()
    at.went = 'away'
    await userEvent.click(screen.getByRole('button', { name: 'Open memo.m4a' }))
    await waitFor(() => expect(rows()[1]).toBe('memo.m4aIt isn’t on this device, and couldn’t be fetched.'))
    at.went = 'failed'
    await userEvent.click(screen.getByRole('button', { name: 'Open memo.m4a' }))
    await waitFor(() => expect(rows()[1]).toBe('memo.m4aCouldn’t open it.'))
    expect(rows()[0]).toContain('PDF')
  })

  it('says so when nothing is attached, and how to; and speaks of those in the trash, which still take room', () => {
    show([item('c', 'No files')])
    expect(screen.getByText('Nothing attached. With Nib Plus, Attach a file… in Commands puts any file in a note or a page.')).toBeTruthy()
    expect(screen.queryByRole('listitem')).toBeNull()
    expect(screen.getByText('Attachments')).toBeTruthy()
    expect(screen.queryByText(/in the trash/)).toBeNull()
    cleanup()
    show([LIBRARY[1]], [LIBRARY[0]])
    expect(screen.getByText('2 more are in the trash, and take room until it’s emptied.')).toBeTruthy()
    expect(rows()).toHaveLength(1)
    cleanup()
    show([], [LIBRARY[1]])
    expect(screen.getByText('One more is in the trash, and takes room until it’s emptied.')).toBeTruthy()
  })
})
