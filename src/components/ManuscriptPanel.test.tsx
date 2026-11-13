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
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters: [{ ...chapter('a', 'One'), position: 1 }, { ...chapter('b', 'Two'), position: 2 }] }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={onMove} plus />)
    expect(screen.queryByRole('button', { name: 'One, move up' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Two, move down' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Two, move up' }))
    expect(onMove).toHaveBeenCalledOnce()
  })
})

describe('compiling', () => {
  it('can’t be pressed again while the book is being made', async () => {
    let finish = () => {}
    const onCompile = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters: [chapter('a', 'One')] }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} onCompile={onCompile} plus />)
    const word = screen.getByRole<HTMLButtonElement>('button', { name: 'Compile as Word' })
    await userEvent.click(word)
    expect(word.disabled).toBe(true)
    await userEvent.click(word)
    expect(onCompile).toHaveBeenCalledOnce()
    await act(async () => finish())
    expect(word.disabled).toBe(false)
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
    render(<ManuscriptPanel folder="Novel" parts={book} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} plus onPlus={onPlus} />)
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
    render(<ManuscriptPanel folder="Novel" parts={book} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} plus={false} onPlus={onPlus} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /A word goal for this book/ }))
    expect(onPlus).toHaveBeenCalledWith('A word goal for each book, with a deadline, is part of Nib Plus.')
    expect(readFolderSettings().novel.goal).toEqual({ words: 1000 })
  })

  it('isn’t offered where Plus can’t be had', () => {
    render(<ManuscriptPanel folder="Novel" parts={book} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} plus={false} />)
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
    render(<ManuscriptPanel folder="Novel" parts={book} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} plus onPlus={vi.fn()} onOpenAt={vi.fn()} onRewrite={vi.fn(async () => [])} {...props} />)

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
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} plus onPlus={vi.fn()} onOpenAt={vi.fn()} onRewrite={onRewrite} />)
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
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} plus onPlus={vi.fn()} onOpenAt={vi.fn()} onRewrite={onRewrite} />)
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
    render(<ManuscriptPanel folder="Novel" parts={[{ name: null, folder: 'Novel', chapters }]} onBack={vi.fn()} onOpen={vi.fn()} onMove={vi.fn()} plus onPlus={vi.fn()} onOpenAt={vi.fn()} onRewrite={onRewrite} />)
    await replace('Mara', 'Maren')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find in this book' }), 'n')
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(textOf(stored.get('a')!)).toBe('Mara one.'))
  })
})
