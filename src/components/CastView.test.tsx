// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Item } from '../db/db'
import { castOf, readFolderSettings, replaceFolderSettings, setCast } from '../lib/folderSettings'
import { CAST_PLUS } from './CastView'
import { ManuscriptPanel } from './ManuscriptPanel'

const chapter = (id: string, ...lines: string[]): Item => ({ id, kind: 'page', body: { type: 'doc', content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) }, version: 1, createdAt: 1, updatedAt: 1 })
const book = [chapter('one', 'The Lamp', 'Mara climbs the steps. Mrs Lee, they call her.'), chapter('two', 'The Storm', 'Nobody.'), chapter('three', 'The Boat', 'Mara again. Gran waves from Port Ellen.')]
const panel = (props: { plus: boolean; onPlus?: (reason: string) => void; onOpenAt?: (id: string, seed: unknown) => void; onOpen?: (id: string) => void }) => (
  <ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters: book }]} onBack={vi.fn()} onOpen={props.onOpen ?? vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus={props.plus} onPlus={props.onPlus} onOpenAt={props.onOpenAt} />
)
const mara = { id: 'mara', kind: 'character' as const, name: 'Mara', also: ['Mrs Lee', 'Gran'] }

beforeEach(() => {
  localStorage.clear()
  // Every folder gone first: a book's characters and places outlast a backup without them (replaceFolderSettings).
  replaceFolderSettings(Object.fromEntries(Object.keys(readFolderSettings()).map((name) => [name, { at: 1, gone: true as const }])))
  replaceFolderSettings({})
})
afterEach(cleanup)

describe('a book’s characters and places', () => {
  it('are added by name, with other names and a line, and kept with the book', async () => {
    render(panel({ plus: true }))
    await userEvent.click(screen.getByRole('button', { name: 'People and places' }))
    expect(screen.getByText('No characters yet.')).toBeTruthy()
    expect(screen.getByText('No places yet.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '+ Add a character' }))
    const form = screen.getByRole('form', { name: 'A new character' })
    await userEvent.type(within(form).getByLabelText('Name'), 'Mara')
    await userEvent.type(within(form).getByLabelText('Other names, with commas between'), 'Mrs Lee, Gran')
    await userEvent.type(within(form).getByLabelText('A line about them'), 'Keeps the light.')
    await userEvent.click(within(form).getByRole('button', { name: 'Keep' }))
    expect(castOf(readFolderSettings(), 'Novel')).toEqual([{ id: expect.any(String), kind: 'character', name: 'Mara', also: ['Mrs Lee', 'Gran'], line: 'Keeps the light.' }])
    expect(screen.getByText('Also Mrs Lee, Gran')).toBeTruthy()
    expect(screen.getByText('Keeps the light.')).toBeTruthy()
  })

  it('each list the chapters that name them, in book order, with how many times, and open one with its names found', async () => {
    setCast('Novel', [mara, { id: 'port', kind: 'place', name: 'Port Ellen', also: [] }, { id: 'tom', kind: 'character', name: 'Tom', also: [] }])
    const onOpenAt = vi.fn()
    render(panel({ plus: true, onOpenAt }))
    await userEvent.click(screen.getByRole('button', { name: 'People and places' }))
    const chapters = within(screen.getByRole('list', { name: 'Chapters that name Mara' })).getAllByRole('button')
    expect(chapters.map((one) => one.getAttribute('aria-label'))).toEqual(['1. The Lamp, named 2 times', '3. The Boat, named 2 times'])
    expect(within(screen.getByRole('list', { name: 'Chapters that name Port Ellen' })).getAllByRole('button').map((one) => one.getAttribute('aria-label'))).toEqual(['3. The Boat, named once'])
    expect(screen.getByText('Not named in a chapter yet.')).toBeTruthy()
    await userEvent.click(chapters[1])
    expect(onOpenAt).toHaveBeenCalledWith('three', { words: 'Mrs\\s+Lee|MRS\\s+LEE|Mara|MARA|Gran|GRAN', caseSensitive: true, wholeWord: true, regex: true, index: 0 })
  })

  it('are changed and removed, Remove asking once more', async () => {
    setCast('Novel', [mara])
    render(panel({ plus: true }))
    await userEvent.click(screen.getByRole('button', { name: 'People and places' }))
    await userEvent.click(screen.getByRole('button', { name: 'Change Mara' }))
    const form = screen.getByRole('form', { name: 'Change Mara' })
    await userEvent.clear(within(form).getByLabelText('Name'))
    await userEvent.type(within(form).getByLabelText('Name'), 'Mara Lee')
    await userEvent.click(within(form).getByRole('button', { name: 'Keep' }))
    expect(castOf(readFolderSettings(), 'Novel')).toEqual([{ ...mara, name: 'Mara Lee' }])
    await userEvent.click(screen.getByRole('button', { name: 'Change Mara Lee' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(castOf(readFolderSettings(), 'Novel')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Mara Lee?' }))
    expect(castOf(readFolderSettings(), 'Novel')).toEqual([])
  })

  it('ask for Nib Plus, and without it, a book that has them keeps them to see and change, new ones asking for it', async () => {
    const onPlus = vi.fn()
    const { unmount } = render(panel({ plus: false, onPlus }))
    await userEvent.click(screen.getByRole('button', { name: 'People and placesPlus' }))
    expect(onPlus).toHaveBeenCalledWith(CAST_PLUS)
    expect(screen.queryByText('No characters yet.')).toBeNull()
    unmount()
    setCast('Novel', [mara])
    render(panel({ plus: false, onPlus }))
    await userEvent.click(screen.getByRole('button', { name: 'People and places' }))
    expect(within(screen.getByRole('list', { name: 'Chapters that name Mara' })).getAllByRole('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Change Mara' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '+ Add a placePlus' }))
    expect(onPlus).toHaveBeenLastCalledWith(CAST_PLUS)
    expect(screen.queryByRole('form')).toBeNull()
  })
})
