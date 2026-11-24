// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import { readFolderSettings, replaceFolderSettings, setOwn } from '../lib/folderSettings'
import { ManuscriptPanel } from './ManuscriptPanel'

const chapter = (id: string, text: string): Item => ({ id, kind: 'page', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, version: 1, createdAt: 1, updatedAt: 1 })

describe('a chapter', () => {
  it('moves up and down by a button of its own, for VoiceOver, where there’s room', async () => {
    const onMove = vi.fn()
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters: [{ ...chapter('a', 'One'), position: 1 }, { ...chapter('b', 'Two'), position: 2 }] }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={onMove} onSummary={vi.fn()} onStatus={vi.fn()} plus />)
    expect(screen.queryByRole('button', { name: 'One, move up' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Two, move down' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Two, move up' }))
    expect(onMove).toHaveBeenCalledOnce()
  })
})

describe('a chapter that goes while it’s being moved', () => {
  afterEach(cleanup)
  const pages = (...ids: string[]) => [{ name: null, folder: 'Novel', chapters: ids.map((id, at) => ({ ...chapter(id, `Chapter ${id}`), position: at + 1 })) }]
  const panel = (parts: ReturnType<typeof pages>) => <ManuscriptPanel folder="Novel" parts={parts} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus />
  const rows = () => [...document.querySelectorAll('[data-chapter]')].map((row) => row.getAttribute('data-chapter'))

  // Trashed, or moved out by sync: the panel drew the chapter that wasn't there, and Nib showed its error screen.
  it('draws the rest, when the move hasn’t come back from the store yet', async () => {
    const { rerender } = render(panel(pages('a', 'b', 'c')))
    await userEvent.click(screen.getByRole('button', { name: 'Chapter b, move up' }))
    expect(rows()).toEqual(['b', 'a', 'c'])
    rerender(panel(pages('a', 'c')))
    expect(rows()).toEqual(['a', 'c'])
  })

  it('draws the rest, when it was the one in hand', () => {
    const { rerender } = render(panel(pages('a', 'b', 'c')))
    fireEvent.pointerDown(document.querySelector('[data-chapter="b"] [data-handle]')!, { button: 0, clientY: 10 })
    rerender(panel(pages('a', 'c')))
    expect(rows()).toEqual(['a', 'c'])
    fireEvent.pointerCancel(window)
  })
})

describe('compiling', () => {
  it('can’t be pressed again while the book is being made', async () => {
    let finish = () => {}
    const onCompile = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters: [chapter('a', 'One')] }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} onCompile={onCompile} plus />)
    const word = screen.getByRole<HTMLButtonElement>('button', { name: 'Compile as Word' })
    await userEvent.click(word)
    expect(word.disabled).toBe(true)
    await userEvent.click(word)
    expect(onCompile).toHaveBeenCalledOnce()
    await act(async () => finish())
    expect(word.disabled).toBe(false)
  })
})

describe('a book for print on demand', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)
  const panel = (props: Partial<Parameters<typeof ManuscriptPanel>[0]> = {}) => {
    const handlers = { onPrint: vi.fn(), onPlus: vi.fn() }
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters: [chapter('a', 'One')] }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus {...handlers} {...props} />)
    return handlers
  }

  it('is made at the trim and with the drop caps chosen, remembered for next time, and not twice at once', async () => {
    let finish = () => {}
    const onPrint = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    panel({ onPrint })
    expect(screen.queryByRole('group', { name: 'Trim size' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Print-ready PDF' }))
    // 6 × 9 and no drop caps, the first time.
    expect(screen.getByRole('button', { name: '6 × 9 in' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Drop caps' }).checked).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: '5 × 8 in' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Drop caps' }))
    const make = screen.getByRole<HTMLButtonElement>('button', { name: 'Make the PDF' })
    await userEvent.click(make)
    expect(onPrint).toHaveBeenCalledWith('5x8', true)
    expect(make.disabled).toBe(true)
    await userEvent.click(make)
    expect(onPrint).toHaveBeenCalledOnce()
    await act(async () => finish())
    expect(make.disabled).toBe(false)
    cleanup()
    panel()
    await userEvent.click(screen.getByRole('button', { name: 'Print-ready PDF' }))
    expect(screen.getByRole('button', { name: '5 × 8 in' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Drop caps' }).checked).toBe(true)
  })

  it('without Plus, asks for it', async () => {
    const { onPrint, onPlus } = panel({ plus: false })
    await userEvent.click(screen.getByRole('button', { name: /^Print-ready PDF/ }))
    expect(onPlus).toHaveBeenCalledWith('A book’s inside, ready to print and sell through Amazon KDP or IngramSpark, is part of Nib Plus.')
    expect(screen.queryByRole('group', { name: 'Trim size' })).toBeNull()
    expect(onPrint).not.toHaveBeenCalled()
  })

  it('isn’t offered where it can’t be printed', () => {
    panel({ onPrint: undefined })
    expect(screen.queryByRole('button', { name: /Print-ready PDF/ })).toBeNull()
  })
})

describe('a book’s word goal', () => {
  // Two chapters, of two words and three.
  const book = [{ name: null, folder: 'Novel', chapters: [chapter('a', 'One two'), chapter('b', 'Three four five')] }]
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T12:00:00') })
    replaceFolderSettings({})
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('with Plus, is set with a date to make it by, kept with the folder, and has the book’s words against it', async () => {
    const onPlus = vi.fn()
    render(<ManuscriptPanel folder="Novel" parts={book} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus onPlus={onPlus} />)
    await userEvent.click(screen.getByRole('button', { name: 'Set a word goal' }))
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Goal, in words' }), '1005')
    fireEvent.change(screen.getByLabelText('Deadline, optional'), { target: { value: '2026-11-29' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(readFolderSettings().novel.goal).toEqual({ words: 1005, deadline: '2026-11-29' })
    // A thousand words to go in ten days, today one of them.
    expect(screen.getByText('5 of 1,005 · 100/day to make Nov 29')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Book goal' }).getAttribute('aria-valuenow')).toBe('5')

    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(readFolderSettings().novel).not.toHaveProperty('goal')
    expect(screen.getByRole('button', { name: 'Set a word goal' })).toBeTruthy()
    expect(onPlus).not.toHaveBeenCalled()
  })

  it('without Plus, asks for it, and a goal kept from before isn’t shown', async () => {
    setOwn('Novel', { goal: { words: 1000 } })
    const onPlus = vi.fn()
    render(<ManuscriptPanel folder="Novel" parts={book} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus={false} onPlus={onPlus} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /A word goal for this book/ }))
    expect(onPlus).toHaveBeenCalledWith('A word goal for each book, with a deadline, is part of Nib Plus.')
    expect(readFolderSettings().novel.goal).toEqual({ words: 1000 })
  })

  it('isn’t offered where Plus can’t be had', () => {
    render(<ManuscriptPanel folder="Novel" parts={book} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus={false} />)
    expect(screen.queryByRole('button', { name: /word goal/ })).toBeNull()
  })
})

describe('finding across a book', () => {
  const page = (id: string, ...lines: string[]): Item => ({ id, kind: 'page', body: { type: 'doc', content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) }, version: 1, createdAt: 1, updatedAt: 1 })
  const locked = { ...page('c', 'Mara in the vault.'), vault: { salt: 's', iv: 'i', data: 'd' } } as unknown as Item
  const book = [
    { name: null, folder: 'Novel', chapters: [page('a', 'Harbour', 'Mara counted the boats. Mara again.'), page('b', 'Shingle', 'Nobody saw her.')] },
    { name: 'Part Two', folder: 'Novel/Part Two', chapters: [locked, page('d', 'Gulls', 'mara, said the gulls.')] },
  ]
  afterEach(() => cleanup())
  const panel = (props: Partial<Parameters<typeof ManuscriptPanel>[0]> = {}) =>
    render(<ManuscriptPanel folder="Novel" parts={book} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus onPlus={vi.fn()} onOpenAt={vi.fn()} onRewrite={vi.fn(async () => [])} {...props} />)

  it('lists every match by chapter, numbered through the book, with the words around each, and opens a chapter at the one tapped', async () => {
    const onOpenAt = vi.fn()
    panel({ onOpenAt })
    await userEvent.click(screen.getByRole('button', { name: 'Find in this book' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find in this book' }), 'Mara')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('3 in 2 chapters'))
    const found = screen.getByRole('list', { name: 'Matches' })
    expect([...found.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual(['1Harbour2', '4Gulls1'])
    expect(screen.queryByRole('list', { name: 'Chapters' })).toBeNull()
    expect(screen.getByText('One locked chapter isn’t looked in. Open the vault to find in them.')).toBeTruthy()
    // The second of the paragraph's two: each is the paragraph's words, in the list's order.
    await userEvent.click(screen.getAllByRole('button', { name: 'Mara counted the boats. Mara again.' })[1])
    expect(onOpenAt).toHaveBeenCalledWith('a', { words: 'Mara', caseSensitive: false, wholeWord: false, regex: false, index: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Match case' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('2 in 1 chapter'))
    await userEvent.click(screen.getByRole('button', { name: 'Close find' }))
    expect(screen.getByRole('list', { name: 'Chapters' })).toBeTruthy()
  })

  it('says when there are none, and when a pattern isn’t one', async () => {
    panel()
    await userEvent.click(screen.getByRole('button', { name: 'Find in this book' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find in this book' }), 'Anna')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('No matches'))
    await userEvent.click(screen.getByRole('button', { name: 'Regular expression' }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Find in this book' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find in this book' }), '(Mara')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Invalid pattern'))
    expect(screen.queryByRole('list', { name: 'Matches' })).toBeNull()
  })

  it('asks for Plus without it, and isn’t offered where Plus can’t be had', async () => {
    const onPlus = vi.fn()
    panel({ plus: false, onPlus })
    await userEvent.click(screen.getByRole('button', { name: /Find in this book/ }))
    expect(onPlus).toHaveBeenCalledWith('Finding and replacing across a book is part of Nib Plus.')
    expect(screen.queryByRole('textbox', { name: 'Find in this book' })).toBeNull()
    cleanup()
    panel({ plus: false, onOpenAt: undefined })
    expect(screen.queryByRole('button', { name: /Find in this book/ })).toBeNull()
  })
})

describe('replacing across a book', () => {
  const page = (id: string, ...lines: string[]): Item => ({ id, kind: 'page', body: { type: 'doc', content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) }, version: 1, createdAt: 1, updatedAt: 1 })
  const textOf = (body: JSONContent) => (body.content ?? []).map((block) => (block.content ?? []).map((run) => run.text).join('')).join('\n')
  afterEach(() => cleanup())

  /** The chapters as stored, and a stand-in for the session's rewrite: each changed in place, its words before and after given back. */
  function bookOf(chapters: Item[]) {
    const stored = new Map(chapters.map((item) => [item.id, item.body]))
    const onRewrite = vi.fn(async (ids: string[], change: (body: JSONContent, id: string) => JSONContent | null) =>
      ids.flatMap((id) => {
        const before = stored.get(id)!
        const after = change(before, id)
        if (!after) return []
        stored.set(id, after)
        return [{ id, before, after }]
      }),
    )
    return { stored, onRewrite }
  }

  async function replace(words: string, replacement: string) {
    await userEvent.click(screen.getByRole('button', { name: 'Find in this book' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find in this book' }), words)
    await userEvent.type(screen.getByRole('textbox', { name: 'Replace with' }), replacement)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Replace all' }).hasAttribute('disabled')).toBe(false))
    await userEvent.click(screen.getByRole('button', { name: 'Replace all' }))
  }

  it('changes every chapter with a match, but a read-only one, and Undo puts them back', async () => {
    const chapters = [page('a', 'Harbour', 'Mara counted the boats. Mara again.'), page('b', 'Shingle', 'Nobody saw her.'), { ...page('c', 'Gulls', 'Mara, said the gulls.'), readOnly: true as const }, page('d', 'Quay', 'and Mara left.')]
    const { stored, onRewrite } = bookOf(chapters)
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus onPlus={vi.fn()} onOpenAt={vi.fn()} onRewrite={onRewrite} />)
    await replace('Mara', 'Maren')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Replaced 3 in 2 chapters · a read-only one left as it is'))
    expect(onRewrite.mock.calls[0][0]).toEqual(['a', 'd'])
    expect(textOf(stored.get('a')!)).toBe('Harbour\nMaren counted the boats. Maren again.')
    expect(textOf(stored.get('c')!)).toBe('Gulls\nMara, said the gulls.')
    expect(textOf(stored.get('b')!)).toBe('Shingle\nNobody saw her.')

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Put back 2 chapters'))
    expect(textOf(stored.get('a')!)).toBe('Harbour\nMara counted the boats. Mara again.')
    expect(textOf(stored.get('d')!)).toBe('Quay\nand Mara left.')
    // Nothing left to undo: still there, greyed.
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true)
  })

  it('puts back only what’s as Replace all left it, and says how many were changed since', async () => {
    const chapters = [page('a', 'Mara one.'), page('b', 'Mara two.')]
    const { stored, onRewrite } = bookOf(chapters)
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus onPlus={vi.fn()} onOpenAt={vi.fn()} onRewrite={onRewrite} />)
    await replace('Mara', 'Maren')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Replaced 2 in 2 chapters'))
    // Written in since, on another device or in its editor.
    stored.set('b', page('b', 'Maren two, and more.').body)
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Put back 1 chapter; one was changed since, and kept as it is'))
    expect(textOf(stored.get('a')!)).toBe('Mara one.')
    expect(textOf(stored.get('b')!)).toBe('Maren two, and more.')
  })

  // Asked 2026-11-13: a button that's always there and doesn't go, so it's easy to find.
  it('keeps Undo while something else is done there, till it’s used, the last Replace all being the one it undoes', async () => {
    const chapters = [page('a', 'Mara one.')]
    const { stored, onRewrite } = bookOf(chapters)
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus onPlus={vi.fn()} onOpenAt={vi.fn()} onRewrite={onRewrite} />)
    await replace('Mara', 'Maren')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find in this book' }), 'n')
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(textOf(stored.get('a')!)).toBe('Mara one.'))
  })
})

describe('the corkboard', () => {
  const card = (id: string, text: string, fields: Partial<Item> = {}): Item => ({ ...chapter(id, text), position: Number(id.charCodeAt(0)), ...fields })
  const locked = { ...card('c', 'Sealed'), vault: { salt: 's', iv: 'i', data: 'd' } } as unknown as Item
  const book = [
    { name: null, folder: 'Novel', chapters: [card('a', 'Harbour lights at dusk', { summary: 'Mara counts the boats.', status: 'done' }), card('b', 'Shingle', { status: 'revised' })] },
    { name: 'Part Two', folder: 'Novel/Part Two', chapters: [locked, card('d', 'Gulls')] },
  ]
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)
  const board = (props: Partial<Parameters<typeof ManuscriptPanel>[0]> = {}) => {
    const handlers = { onMove: vi.fn(), onSummary: vi.fn(), onStatus: vi.fn(), onOpen: vi.fn(), onPlus: vi.fn() }
    render(<ManuscriptPanel folder="Novel" parts={book} onBack={vi.fn()} plus {...handlers} {...props} />)
    return handlers
  }
  const cards = () => screen.getAllByRole('listitem').map((one) => one.getAttribute('data-card'))

  it('shows the chapters as cards with Plus, remembered for next time, with the book’s progress by status', async () => {
    board()
    await userEvent.click(screen.getByRole('button', { name: 'Cards' }))
    expect(cards()).toEqual(['a', 'b', 'c', 'd'])
    expect(screen.getByRole('img', { name: 'Progress: 1 done · 1 revised · 2 drafts' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Change the summary of Harbour lights at dusk: Mara counts the boats/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Part Two' })).toBeTruthy()
    cleanup()
    board()
    expect(screen.getByRole('button', { name: 'Cards' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('changes a status by pressing it, draft to revised to done and back', async () => {
    localStorage.setItem('nib-manuscript-view', '"cards"')
    const { onStatus } = board()
    await userEvent.click(screen.getByRole('button', { name: /^Done: the status of Harbour/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Revised: the status of Shingle/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Draft: the status of Gulls/ }))
    expect(onStatus.mock.calls).toEqual([['a', 'draft'], ['b', 'done'], ['d', 'revised']])
  })

  it('writes a summary on its card: Enter keeps it, Escape doesn’t, and emptied it’s none', async () => {
    localStorage.setItem('nib-manuscript-view', '"cards"')
    const { onSummary } = board()
    await userEvent.click(screen.getByRole('button', { name: 'Add a summary of Shingle' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Summary of Shingle' }), 'Nobody sees her go.{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Add a summary of Gulls' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Summary of Gulls' }), 'Not this{Escape}')
    await userEvent.click(screen.getByRole('button', { name: /Change the summary of Harbour/ }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Summary of Harbour lights at dusk' }))
    await userEvent.keyboard('{Enter}')
    expect(onSummary.mock.calls).toEqual([['b', 'Nobody sees her go.'], ['a', null]])
  })

  it('moves a card with the arrow keys on its handle, or a button for VoiceOver, within its part', async () => {
    localStorage.setItem('nib-manuscript-view', '"cards"')
    const { onMove } = board()
    screen.getByRole('button', { name: 'Move Harbour lights at dusk' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onMove).toHaveBeenLastCalledWith([{ id: 'a', position: 99 }])
    expect(cards().slice(0, 2)).toEqual(['b', 'a'])
    await userEvent.click(screen.getByRole('button', { name: 'Gulls, move earlier' }))
    expect(onMove).toHaveBeenLastCalledWith([{ id: 'd', position: 98 }])
  })

  it('shows a locked chapter’s card as locked, with no summary to write', async () => {
    localStorage.setItem('nib-manuscript-view', '"cards"')
    board()
    const sealed = screen.getAllByRole('listitem').find((one) => one.getAttribute('data-card') === 'c')!
    expect(sealed.textContent).toContain('Locked')
    expect(sealed.querySelector('[aria-label^="Add a summary"]')).toBeNull()
  })

  it('without Plus, asks for it, and the list stays, whatever was chosen with it', async () => {
    localStorage.setItem('nib-manuscript-view', '"cards"')
    const { onPlus } = board({ plus: false })
    expect(screen.queryByRole('img', { name: /Progress/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Cards/ }))
    expect(onPlus).toHaveBeenCalledWith('A book’s chapters as index cards, each with a summary and a status, are part of Nib Plus.')
    expect(document.querySelector('[data-chapter]')).toBeTruthy()
  })

  it('isn’t offered where Plus can’t be had', () => {
    board({ plus: false, onPlus: undefined })
    expect(screen.queryByRole('button', { name: /Cards/ })).toBeNull()
  })

  it('shows a book’s statuses and summaries in the list, editable there, with Plus or without', async () => {
    const { onStatus, onSummary, onOpen } = board({ plus: false })
    // Every chapter of the book, its own given or not; none for a locked one.
    expect(screen.getAllByRole('button', { name: /: the status of / })).toHaveLength(4)
    expect(screen.getByRole('button', { name: /Change the summary of Harbour lights at dusk: Mara counts the boats/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add a summary of Sealed' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Revised: the status of Shingle/ }))
    expect(onStatus).toHaveBeenCalledWith('b', 'done')
    await userEvent.click(screen.getByRole('button', { name: 'Add a summary of Gulls' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Summary of Gulls' }), 'The storm, from above.{Enter}')
    expect(onSummary).toHaveBeenCalledWith('d', 'The storm, from above.')
    // The row still opens its chapter by its number and title.
    await userEvent.click(screen.getByRole('button', { name: /^2\s*Shingle/ }))
    expect(onOpen).toHaveBeenCalledWith('b')
  })

  it('leaves the list as it was for a book with none', () => {
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters: [card('a', 'One'), card('b', 'Two')] }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus={false} onPlus={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /: the status of / })).toBeNull()
    expect(screen.queryByRole('button', { name: /summary/i })).toBeNull()
  })
})

describe('the book as audio', () => {
  afterEach(cleanup)
  const panel = (props: Partial<Parameters<typeof ManuscriptPanel>[0]> = {}) => {
    const handlers = { onListen: vi.fn(), onPlus: vi.fn() }
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters: [chapter('a', 'One')] }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus {...handlers} {...props} />)
    return handlers
  }

  it('is made once at a time, with Plus, and the rest of the book’s files wait for it', async () => {
    let finish = () => {}
    const onListen = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    panel({ onListen, onCompile: vi.fn() })
    const listen = screen.getByRole<HTMLButtonElement>('button', { name: 'Audio to listen to' })
    await userEvent.click(listen)
    expect(onListen).toHaveBeenCalledOnce()
    expect(listen.disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Compile as EPUB' }).disabled).toBe(true)
    await act(async () => finish())
    expect(listen.disabled).toBe(false)
  })

  it('asks for Plus without it, and isn’t offered where it can’t be made', async () => {
    const { onListen, onPlus } = panel({ plus: false })
    await userEvent.click(screen.getByRole('button', { name: /^Audio to listen to/ }))
    expect(onPlus).toHaveBeenCalledWith('Saving your writing as audio, to listen to away from the screen, is part of Nib Plus.')
    expect(onListen).not.toHaveBeenCalled()
    cleanup()
    panel({ onListen: undefined })
    expect(screen.queryByRole('button', { name: /Audio to listen to/ })).toBeNull()
  })
})

describe('the book’s submissions', () => {
  afterEach(cleanup)
  it('say how many have gone and how many are waiting, and open them; without Plus, ask for it', async () => {
    const { addSubmission, replaceSubmissions } = await import('../lib/submissions')
    replaceSubmissions({})
    addSubmission({ book: 'Novel' }, { where: 'An agent', sent: '2026-11-01' })
    addSubmission({ book: 'novel' }, { where: 'Another', sent: '2026-10-01', answer: 'declined' })
    const onSubmissions = vi.fn()
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters: [chapter('a', 'One')] }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus onSubmissions={onSubmissions} />)
    await userEvent.click(screen.getByRole('button', { name: /^Submissions/ }))
    expect(screen.getByText('2 sent, 1 waiting')).toBeTruthy()
    expect(onSubmissions).toHaveBeenCalledOnce()
    cleanup()
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters: [chapter('a', 'One')] }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus={false} onSubmissions={vi.fn()} />)
    // Those already kept are still counted without Plus: they stay to open. A book with none says Plus.
    expect(screen.getByRole('button', { name: /^Submissions/ }).textContent).toBe('Submissions2 sent, 1 waiting')
    cleanup()
    replaceSubmissions({})
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters: [chapter('a', 'One')] }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onSummary={vi.fn()} onStatus={vi.fn()} plus={false} onSubmissions={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Submissions/ }).textContent).toBe('SubmissionsPlus')
  })
})

