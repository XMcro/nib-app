import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { useState } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { localDay } from './lib/time'

/**
 * On the Mac a note to self is added from ⌘K too, on the words selected. The
 * palette takes the focus, and the selection toolbar is away until the text
 * has it back, so its field for the note's words has to take it then.
 */

vi.mock('./lib/platform', async (importOriginal) => {
  const real = await importOriginal<typeof import('./lib/platform')>()
  return { ...real, nativeApp: true, macApp: true, touchApp: false }
})

// Nib Plus, which this has needed since Phase 10 (without it, Commands offers Plus: App.test).
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [...useState({ active: true }), true],
}))

const { App } = await import('./App')
const palette = () => act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id: 'palette' })))

beforeEach(async () => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  localStorage.setItem('nib-device-asked', '1')
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  await db.items.clear()
})
afterEach(() => void vi.useRealTimers())
afterEach(cleanup)

describe('Add a note to self, from ⌘K on the Mac', () => {
  it('asks for the note on the words selected, and is offered only with words selected', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await act(async () => (await screen.findByRole('button', { name: /New note/ })).click())
    await expect.poll(() => document.activeElement?.closest('.ProseMirror') != null).toBe(true)
    await userEvent.keyboard('The ferry leaves at seven sharp.')
    const editor = (document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor

    await palette()
    expect(screen.queryByText('Add a note to self…')).toBeNull()
    await palette()

    // "at seven"
    act(() => void editor.commands.setTextSelection({ from: 18, to: 26 }))
    await palette()
    await userEvent.click(screen.getByText('Add a note to self…'))

    await waitFor(() => expect(document.activeElement?.getAttribute('placeholder')).toBe('Write the note, then press Return'))
    await userEvent.keyboard('Check the tide times.{Enter}')
    const noted = (editor.getJSON() as JSONContent).content?.[0].content?.find((run) => run.marks?.some((mark) => mark.type === 'noteToSelf'))
    expect(noted?.text).toBe('at seven')
    expect(noted?.marks?.[0].attrs?.text).toBe('Check the tide times.')

    // And it's read in the editor.
    act(() => void editor.commands.setTextSelection(21))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Note to self' }).textContent).toContain('Check the tide times.'))
  })
})

describe('Done on a note, then Undo', () => {
  it('puts the note back after more writing, and leaves that writing alone', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await act(async () => (await screen.findByRole('button', { name: /New note/ })).click())
    await expect.poll(() => document.activeElement?.closest('.ProseMirror') != null).toBe(true)
    await userEvent.keyboard('The ferry leaves at seven sharp.')
    const editor = (document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor
    const note = { type: 'noteToSelf', attrs: { id: 'n1', text: 'Check the tide times.' } }
    // "at seven"
    act(() => void editor.chain().setTextSelection({ from: 18, to: 26 }).setMark(note.type, note.attrs).run())
    act(() => void editor.commands.setTextSelection(21))
    await userEvent.click(await screen.findByRole('button', { name: 'Done, take the note off' }))
    const marked = () => (editor.getJSON() as JSONContent).content?.[0].content?.find((run) => run.marks?.some((mark) => mark.type === 'noteToSelf'))?.text
    expect(marked()).toBeUndefined()

    act(() => void editor.chain().setTextSelection(1).insertContent('Today ').run())
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(editor.getText()).toBe('Today The ferry leaves at seven sharp.')
    expect(marked()).toBe('at seven')
  })

  // A note's words live only in its mark, and a mark replaces another of its kind.
  it('leaves a newer note on the same words as it is', async () => {
    await page.viewport(1024, 768)
    await act(async () => void render(<App />))
    await act(async () => (await screen.findByRole('button', { name: /New note/ })).click())
    await expect.poll(() => document.activeElement?.closest('.ProseMirror') != null).toBe(true)
    await userEvent.keyboard('The ferry leaves at seven sharp.')
    const editor = (document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor
    const range = { from: 18, to: 26 }
    act(() => void editor.chain().setTextSelection(range).setMark('noteToSelf', { id: 'n1', text: 'The first note.' }).run())
    act(() => void editor.commands.setTextSelection(21))
    await userEvent.click(await screen.findByRole('button', { name: 'Done, take the note off' }))
    act(() => void editor.chain().setTextSelection(range).setMark('noteToSelf', { id: 'n2', text: 'The newer note.' }).run())
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    const notes = (editor.getJSON() as JSONContent).content?.[0].content?.flatMap((run) => run.marks ?? []).filter((mark) => mark.type === 'noteToSelf')
    expect(notes?.map((mark) => mark.attrs?.id)).toEqual(['n2'])
  })
})

describe('the Notes list', () => {
  const library = () => within(document.querySelector<HTMLElement>('.nib-library')!)
  const live = () => (document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor
  const openList = async () => {
    await palette()
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Commands' })).getByText('Notes to self and TKs'))
  }

  it('lists the notes and TKs from Commands, in order, and goes to each in the text', async () => {
    await page.viewport(1024, 768)
    const note = { type: 'noteToSelf', attrs: { id: 'n1', text: 'Check the tide times.' } }
    await items.create('page', {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'The ferry leaves ' }, { type: 'text', text: 'at seven', marks: [note] }, { type: 'text', text: ' sharp.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Back by TK, they said.' }] },
      ],
    })
    await act(async () => void render(<App />))
    await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
    await userEvent.click(await library().findByText(/The ferry leaves/))
    await expect.poll(() => document.querySelector('.ProseMirror')?.textContent).toContain('The ferry leaves')

    await openList()
    const rows = await library().findAllByRole('button', { name: /tide|TK/ })
    expect(rows.map((row) => row.textContent)).toEqual(['at sevenCheck the tide times.', 'Back by TK, they said.'])

    await userEvent.click(rows[0])
    // The list goes, out of the way of the text.
    await waitFor(() => expect(document.querySelector('.nib-library')!.hasAttribute('inert')).toBe(true))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Note to self' }).textContent).toContain('Check the tide times.'))
    expect(live().state.selection.from).toBe(18)

    await openList()
    await userEvent.click(await library().findByRole('button', { name: /TK/ }))
    await waitFor(() => expect(live().state.doc.textBetween(live().state.selection.from, live().state.selection.to)).toBe('TK'))
  })
})
