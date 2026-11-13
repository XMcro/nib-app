import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { Editor as Live, JSONContent } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import '../index.css'
import { Editor } from './Editor'
import { openFind } from './FindBar'

const mocks = vi.hoisted(() => ({ copyText: vi.fn(async () => {}) }))
vi.mock('../lib/platform', async (actual) => ({ ...(await actual<typeof import('../lib/platform')>()), nativeApp: true, macApp: true, touchApp: false }))
vi.mock('../lib/clipboard', async (actual) => ({ ...(await actual<typeof import('../lib/clipboard')>()), copyText: mocks.copyText }))

const para = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] })
const DOC: JSONContent = { type: 'doc', content: [para('Keep this as it is.')] }

let live: Live | null = null
const onChange = vi.fn()

const element = (readOnly: boolean, body: JSONContent) => <Editor kind="note" initialBody={body} readOnly={readOnly} focus={false} onChange={onChange} onEditor={(editor) => (live = editor)} />
function open(readOnly = true, body = DOC) {
  onChange.mockClear()
  const view = render(element(readOnly, body))
  return { ...view, again: (next: boolean) => view.rerender(element(next, body)) }
}
const writing = () => document.querySelector<HTMLElement>('.ProseMirror')!
const words = () => writing().textContent
const selectAll = () => act(async () => live!.view.dispatch(live!.state.tr.setSelection(TextSelection.create(live!.state.doc, 1, 8))))

afterEach(() => {
  cleanup()
  live = null
})

describe('a read-only document', () => {
  it('can’t be typed in, and doesn’t count as changed', async () => {
    open()
    await waitFor(() => expect(writing().getAttribute('contenteditable')).toBe('false'))
    await userEvent.click(writing())
    await userEvent.keyboard('more words{Enter}')
    expect(words()).toBe('Keep this as it is.')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('opens at its start, not at the end as something to go on writing', async () => {
    open()
    await waitFor(() => expect(live).not.toBeNull())
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(live!.state.selection.from).toBe(1)
  })

  it('copies, and a cut takes nothing away', async () => {
    open()
    await waitFor(() => expect(live).not.toBeNull())
    await selectAll()
    mocks.copyText.mockClear()
    writing().dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true }))
    expect(mocks.copyText).toHaveBeenCalledTimes(1)
    expect(words()).toBe('Keep this as it is.')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('takes nothing pasted', async () => {
    open()
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', 'pasted over')
    writing().dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
    expect(words()).toBe('Keep this as it is.')
  })

  it.each(['dragover', 'drop'])('keeps a dropped file from opening in Nib’s place, on %s', async (type) => {
    open()
    const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })
    writing().dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(words()).toBe('Keep this as it is.')
  })

  it('doesn’t tick or untick a checklist', async () => {
    const list: JSONContent = { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [para('Lamp')] }] }] }
    open(true, list)
    await waitFor(() => expect(live).not.toBeNull())
    const box = writing().querySelector<HTMLInputElement>('input[type=checkbox]')!
    await userEvent.click(box)
    expect(box.checked).toBe(false)
    expect((live!.getJSON().content![0].content![0] as JSONContent).attrs?.checked).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('says so under the writing', async () => {
    open()
    await waitFor(() => expect(document.body.textContent).toMatch(/Read-only/))
  })

  it('finds, by pattern too, and offers nothing to replace', async () => {
    open()
    await waitFor(() => expect(live).not.toBeNull())
    await act(async () => openFind(live!))
    await userEvent.click(screen.getByRole('button', { name: 'Show options' }))
    expect(screen.getByRole('button', { name: 'Regular expression' })).toBeTruthy()
    expect(screen.queryByLabelText('Replace with')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Replace all' })).toBeNull()
    await act(async () => void (screen.getByLabelText('Find in this document') as HTMLInputElement).focus())
    await userEvent.keyboard('Keep')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('1 of 1'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows a note to self, with no way to change it or take it off', async () => {
    const note = { type: 'noteToSelf', attrs: { id: 'n1', text: 'Check the tide.' } }
    open(true, { type: 'doc', content: [para('A noted passage here.', [note])] })
    await waitFor(() => expect(document.querySelector('.nib-note-to-self')).not.toBeNull())
    const passage = document.querySelector('.nib-note-to-self')!
    await userEvent.click(passage, { position: { x: 1, y: passage.getBoundingClientRect().height / 2 } })
    await screen.findByText('Check the tide.')
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Done, take the note off' })).toBeNull()
  })

  it('can be written in again once it’s taken off, and doing so isn’t a change', async () => {
    const { again } = open()
    await waitFor(() => expect(writing().getAttribute('contenteditable')).toBe('false'))
    again(false)
    await waitFor(() => expect(writing().getAttribute('contenteditable')).toBe('true'))
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => void live!.commands.focus('end'))
    await act(async () => void writing().focus())
    await userEvent.keyboard('!')
    await waitFor(() => expect(words()).toBe('Keep this as it is.!'))
    expect(onChange).toHaveBeenCalled()
  })

  it('stops being writable when it’s turned on with the document open', async () => {
    const { again } = open(false)
    await waitFor(() => expect(writing().getAttribute('contenteditable')).toBe('true'))
    again(true)
    await waitFor(() => expect(writing().getAttribute('contenteditable')).toBe('false'))
  })
})

describe('a document that isn’t read-only', () => {
  it('still cuts', async () => {
    open(false)
    await waitFor(() => expect(writing().getAttribute('contenteditable')).toBe('true'))
    await selectAll()
    writing().dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true }))
    await waitFor(() => expect(words()).toBe('is as it is.'))
  })
})
