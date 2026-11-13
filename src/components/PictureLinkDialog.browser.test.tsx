import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import '../index.css'
import { nibExtensions } from '../editor/extensions'
import { DOC_BUDGET, IMAGE_SRC } from '../lib/image'
import { PictureError, pictureAt } from '../lib/pictureLink'
import { PictureLinkDialog } from './PictureLinkDialog'

/**
 * Add a picture from a link: the dialog, and the picture going into the
 * document as a pasted one does. The fetch is native, and stood in for.
 */
vi.mock('../lib/pictureLink', async (original) => ({ ...(await original<typeof import('../lib/pictureLink')>()), pictureAt: vi.fn() }))

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (character) => character.charCodeAt(0))
const picture = () => new Blob([PNG], { type: 'image/png' })

let editor: Editor | undefined
const onClose = vi.fn()

function open(content: object = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before after' }] }] }) {
  const element = document.body.appendChild(document.createElement('div'))
  editor = new Editor({ element, extensions: nibExtensions(false), content })
  editor.commands.setTextSelection(8)
  render(<PictureLinkDialog editor={editor} onClose={onClose} />)
}
const field = () => screen.getByRole('textbox', { name: 'The picture’s address' })
const images = () => {
  const found: { src: string; pos: number }[] = []
  editor!.state.doc.descendants((node, pos) => void (node.type.name === 'image' && found.push({ src: String(node.attrs.src), pos })))
  return found
}

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
  vi.mocked(pictureAt).mockReset()
  onClose.mockReset()
})

describe('adding a picture from a link', () => {
  it('says what it will do, and has nothing to add until there’s an address', () => {
    open()
    expect(screen.getByText('Nib fetches the picture once from that address and keeps a copy in this document.')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(true)
  })

  // On the Mac the dialog itself had it, as a sheet does unless told (Sheet), and an address typed went nowhere.
  it('opens with the address field ready to type in', async () => {
    open()
    await waitFor(() => expect(document.activeElement).toBe(field()))
    await userEvent.keyboard('https://example.com/a.png')
    expect((field() as HTMLInputElement).value).toBe('https://example.com/a.png')
  })

  it('fetches it, puts it in where the cursor was as one of Nib’s own pictures, and closes', async () => {
    vi.mocked(pictureAt).mockResolvedValue(picture())
    open()
    await userEvent.fill(field(), 'https://example.com/harbour.png')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(pictureAt).toHaveBeenCalledWith('https://example.com/harbour.png')
    expect(images()).toHaveLength(1)
    // A copy in the document, never the address: nothing is fetched again when it's shown.
    expect(images()[0].src).toMatch(IMAGE_SRC)
    expect(JSON.stringify(editor!.getJSON())).not.toContain('example.com')
    expect(images()[0].pos).toBe(8)
    // One step to undo.
    editor!.commands.undo()
    expect(images()).toHaveLength(0)
  })

  it('doesn’t ask for anything at an address that isn’t https, and says why', async () => {
    open()
    await userEvent.fill(field(), 'http://example.com/harbour.png')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('alert').textContent).toBe('That isn’t an address Nib can fetch from. It has to start with https://')
    expect(pictureAt).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open and says why when none comes, or what comes is no picture Nib keeps', async () => {
    open()
    vi.mocked(pictureAt).mockRejectedValueOnce(new PictureError('size'))
    await userEvent.fill(field(), 'https://example.com/huge.png')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect((await screen.findByRole('alert')).textContent).toBe('That picture is too large to add.')

    // The answer called it a picture; it's a page of markup. Something did come, so it doesn't say nothing was there:
    // on an iPad a photograph too detailed to be made small enough was answered with "There's no picture at that address."
    vi.mocked(pictureAt).mockResolvedValueOnce(new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Can’t add that picture. It’s a kind Nib doesn’t keep, or it can’t be made small enough.'))
    expect(images()).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()
    // And can be tried again, with what was said of that address gone as another is typed.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(false)
    await userEvent.fill(field(), 'https://example.com/other.png')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('adds none to a document with no room left for pictures', async () => {
    const full = `data:image/png;base64,${'A'.repeat(DOC_BUDGET - 10)}`
    open({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: full, alt: '' } }] }] })
    vi.mocked(pictureAt).mockResolvedValue(picture())
    await userEvent.fill(field(), 'https://example.com/harbour.png')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This document is full — no more images fit'))
    expect(images()).toHaveLength(1)
  })
})
