import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import type { Item } from '../db/db'

/**
 * In the app, copying goes through the native pasteboard (lib/clipboard),
 * because WebKit kept the plain text of a page's own copy where other Mac
 * apps could not paste it. Its own file: the platform mock is module-wide.
 */
const copyText = vi.hoisted(() => vi.fn(async (_text: string, _html?: string, _options?: object) => {}))
vi.mock('../lib/clipboard', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/clipboard')>()), copyText }))
vi.mock('../lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/platform')>()),
  nativeApp: true,
}))

const { Editor } = await import('./Editor')

afterEach(() => {
  cleanup()
  copyText.mockClear()
  document.body.replaceChildren()
})

async function open(item?: Item) {
  let editor: TiptapEditor | null = null
  render(
    <div data-scroll>
      <Editor
        kind="page"
        item={item}
        focus={false}
        onChange={() => {}}
        onEditor={(live) => (editor = live)}
        initialBody={{
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'The ferry leaves at ' }, { type: 'text', marks: [{ type: 'bold' }], text: '07:40' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Bring the tickets.' }] },
          ],
        }}
      />
    </div>,
  )
  await waitFor(() => expect(editor).not.toBeNull())
  return editor! as TiptapEditor
}

function clipboardEvent(editor: TiptapEditor, type: 'copy' | 'cut') {
  const event = new ClipboardEvent(type, { clipboardData: new DataTransfer(), bubbles: true, cancelable: true })
  editor.view.dom.dispatchEvent(event)
  return event
}

describe('copying in the app', () => {
  it('hands the native pasteboard plain text and HTML, and keeps WebKit out of it', async () => {
    const editor = await open()
    editor.commands.selectAll()
    const event = clipboardEvent(editor, 'copy')

    expect(event.defaultPrevented).toBe(true)
    expect(copyText).toHaveBeenCalledTimes(1)
    const [text, html] = copyText.mock.calls[0]
    expect(text).toBe('The ferry leaves at 07:40\n\nBring the tickets.')
    expect(html).toContain('<strong>07:40</strong>')
    expect(editor.getText()).toContain('Bring the tickets.')
  })

  it('cuts: copies the same way, then removes the selection', async () => {
    const editor = await open()
    editor.commands.setTextSelection({ from: 1, to: 21 })
    clipboardEvent(editor, 'cut')

    expect(copyText.mock.calls[0][0]).toBe('The ferry leaves at ')
    expect(editor.getText()).not.toContain('The ferry leaves at')
    expect(editor.getText()).toContain('07:40')
  })

  it('copies from a locked note for this device alone, and only for a while', async () => {
    const locked = { id: 'l', kind: 'page', body: { type: 'doc', content: [] }, version: 1, createdAt: 0, updatedAt: 0, vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) } } as Item
    const editor = await open(locked)
    editor.commands.selectAll()
    clipboardEvent(editor, 'copy')
    expect(copyText.mock.calls[0][2]).toEqual({ expires: true, thisDeviceOnly: true })
    copyText.mockClear()
    cleanup()
    const plain = await open()
    plain.commands.selectAll()
    clipboardEvent(plain, 'copy')
    expect(copyText.mock.calls[0][2]).toBeUndefined()
  })

  it('leaves an empty selection alone', async () => {
    const editor = await open()
    editor.commands.setTextSelection(3)
    const event = clipboardEvent(editor, 'copy')
    expect(event.defaultPrevented).toBe(false)
    expect(copyText).not.toHaveBeenCalled()
  })
})
