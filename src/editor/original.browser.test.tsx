import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import '../index.css'
import { fileUrl, forgetFile, keepFile } from '../lib/files'
import { IMAGE_SRC, MAX_BYTES } from '../lib/image'
import { fetchOriginalsWith, keepOriginals } from '../lib/originals'
import { addPicture } from './addPicture'
import { nibExtensions } from './extensions'

/**
 * A picture's original, with Nib Plus, in the editor: kept when the picture
 * goes in, named on its node, and what the picture is shown from where it's
 * on this device (editor/NibImage, lib/originals).
 */

/** A photograph's worth of detail: noise, which no encoder makes small. */
async function photo(edge = 900): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = edge
  const pen = canvas.getContext('2d')!
  const pixels = pen.createImageData(edge, edge)
  for (let at = 0; at < pixels.data.length; at++) pixels.data[at] = at % 4 === 3 ? 255 : Math.floor(Math.random() * 256)
  pen.putImageData(pixels, 0, 0)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'))
}

let editor: Editor | undefined
function open() {
  editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: nibExtensions(false), content: { type: 'doc', content: [{ type: 'paragraph' }] } })
  return editor
}
const pictures = () => {
  const found: Record<string, unknown>[] = []
  editor!.state.doc.descendants((node) => void (node.type.name === 'image' && found.push(node.attrs)))
  return found
}
const drawn = () => editor!.view.dom.querySelector<HTMLImageElement>('img:not(.ProseMirror-separator)')!

afterEach(() => {
  keepOriginals(false)
  fetchOriginalsWith(null)
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

describe('a picture’s original in the editor', () => {
  it('is kept when the picture goes in with Plus, and the picture is shown from it', async () => {
    keepOriginals(true)
    const file = await photo()
    expect(file.size).toBeGreaterThan(MAX_BYTES)
    expect(await addPicture(open(), file)).toBe('added')

    const [attrs] = pictures()
    // The note still holds its own picture, small enough to live in it: what's shown everywhere the original isn't.
    expect(String(attrs.src)).toMatch(IMAGE_SRC)
    expect(String(attrs.src).length).toBeLessThan(MAX_BYTES * 1.4)
    expect(attrs.full).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), type: 'image/png', size: file.size })

    // Shown from the store's own address for that file, and at the original's size, not the small one's.
    const address = await fileUrl((attrs.full as { id: string }).id)
    await expect.poll(() => drawn().src).toBe(address)
    await expect.poll(() => drawn().naturalWidth).toBe(900)
    // Showing it is no change to the document: the note's picture is still what's stored.
    expect(pictures()[0].src).toBe(attrs.src)
    expect(JSON.stringify(editor!.getJSON())).toContain(String(attrs.src))
  })

  it('goes in as before without Plus: the note’s picture, and no original', async () => {
    expect(await addPicture(open(), await photo())).toBe('added')
    expect(pictures()[0].full).toBeNull()
    expect(drawn().src).toBe(pictures()[0].src)
  })

  it('shows the note’s own picture where the original isn’t on this device', async () => {
    const src = (await (async () => {
      await addPicture(open(), await photo(40))
      return pictures()[0].src
    })()) as string
    editor!.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src, alt: '', full: { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'image/png', size: 5_000_000 } } }] }] })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(drawn().src).toBe(src)
    // And it's still named on the picture, for when the file comes.
    expect(pictures()[0].full).toMatchObject({ id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d' })
  })

  it('is fetched from the server the first time its picture is shown here, and the picture is then shown from it', async () => {
    const big = await photo(300)
    const full = { id: crypto.randomUUID(), type: 'image/png', size: big.size }
    // As sync fetches one while it runs (sync/files).
    fetchOriginalsWith(async (wanted) => (await keepFile(big, wanted.id)) !== null)
    const src = (await (async () => {
      await addPicture(open(), await photo(40))
      return pictures()[0].src
    })()) as string
    editor!.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src, alt: '', full } }] }] })
    await expect.poll(() => drawn().naturalWidth).toBe(300)
    expect(drawn().src).toBe(await fileUrl(full.id))
    // The document is as it came: showing the original is no edit.
    expect(pictures()[0]).toMatchObject({ src, full })
  })

  it('isn’t asked for by a locked note’s editor, on this device or of the server: a note just locked still names what the lock deleted', async () => {
    keepOriginals(true)
    await addPicture(open(), await photo())
    const { src, full } = pictures()[0] as { src: string; full: { id: string } }
    const asked: string[] = []
    fetchOriginalsWith(async (wanted) => (asked.push(wanted.id), false))
    editor!.storage.image.locked = true
    // Drawn again, as it is whenever its node changes.
    editor!.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src, alt: 'once', full } }] }] })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(drawn().src).toBe(src)
    await forgetFile(full.id)
    editor!.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src, alt: 'again', full } }] }] })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(drawn().src).toBe(src)
    expect(asked).toEqual([])
  })

  it('keeps none for a picture put into a locked note, which its editor says it is', async () => {
    keepOriginals(true)
    open().storage.image.locked = true
    expect(await addPicture(editor!, await photo())).toBe('added')
    expect(pictures()[0].full).toBeNull()
    expect(drawn().src).toBe(pictures()[0].src)
  })

  it('stays with a picture cut and pasted within Nib, and is taken from no other HTML than Nib’s own', async () => {
    keepOriginals(true)
    await addPicture(open(), await photo())
    const full = pictures()[0].full
    const html = editor!.getHTML()
    expect(html).toContain('data-full="')
    editor!.commands.setContent(html)
    expect(pictures()[0].full).toEqual(full)

    // Something that isn't an id, a kind and a size is no original; and never an address.
    const src = pictures()[0].src as string
    for (const not of ['https://example.com/a.png image/png 100', '../index image/png 100', '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d text/html 100', '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d image/png lots']) {
      editor!.commands.setContent(`<p><img src="${src}" data-full="${not}"></p>`)
      expect(pictures()[0].full, not).toBeNull()
      expect(drawn().src).toBe(src)
    }
  })
})
