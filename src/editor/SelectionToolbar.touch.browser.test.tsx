import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import '../index.css'

/**
 * On iPhone and iPad the system's Cut, Copy and Paste menu sits by the
 * selection, over the ••• panel's rows ("Add a note to self" among them), so
 * opening the panel asks the app to put it away (NibWindowPlugin).
 */

const { hideEditMenu } = vi.hoisted(() => ({ hideEditMenu: vi.fn(() => Promise.resolve()) }))
vi.mock('../lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/platform')>()), touchApp: true }))
vi.mock('../lib/keyboard', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/keyboard')>()), nibWindow: { hideEditMenu } }))

const { nibExtensions } = await import('./extensions')
const { SelectionToolbar } = await import('./SelectionToolbar')

let editor: Editor | undefined

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

describe('the selection toolbar on iPhone and iPad', () => {
  it('puts the system’s menu away as ••• opens, and only then', async () => {
    const element = document.createElement('div')
    document.body.append(element)
    editor = new Editor({ element, extensions: nibExtensions(true), content: '<p>at seven</p>' })
    render(<SelectionToolbar editor={editor} showHeading />)
    editor.view.dom.focus()
    editor.commands.setTextSelection({ from: 1, to: 9 })

    await userEvent.click(await screen.findByLabelText('More'))
    expect(await screen.findByText('Add a note to self')).toBeTruthy()
    expect(hideEditMenu).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByLabelText('More'))
    await waitFor(() => expect(screen.queryByText('Add a note to self')).toBeNull())
    expect(hideEditMenu).toHaveBeenCalledOnce()
  })
})
