import { afterEach, describe, expect, it } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import type { JSONContent } from '@tiptap/react'
import { IMAGE_SRC, allowedImageSrc, toDataUrl } from '../lib/image'
import { Editor } from './Editor'

/**
 * The insert path needs a real editor, a real clipboard event and — for the
 * re-encoding branch — a real canvas and createImageBitmap. None of that exists
 * under jsdom.
 */

const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (character) => character.charCodeAt(0),
)

/** A PNG of `size`x`size`, large enough to force the downscale branch. */
async function bigPng(size: number): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  // A gradient: big enough as a PNG to pass the cap, but something a lossy
  // encoder can actually bring back under it, like a real photograph.
  const gradient = context.createLinearGradient(0, 0, size, size)
  gradient.addColorStop(0, '#2A93FF')
  gradient.addColorStop(0.5, '#184476')
  gradient.addColorStop(1, '#FFFFFF')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  return new File([blob!], 'big.png', { type: 'image/png' })
}

function mount() {
  const bodies: JSONContent[] = []
  const notices: string[] = []
  render(
    <div data-scroll>
      <Editor
        kind="note"
        focus={false}
        onChange={(body) => bodies.push(body)}
        onNotice={(message) => notices.push(message)}
      />
    </div>,
  )
  const dom = document.querySelector<HTMLElement>('.nib-editor')!
  return { bodies, notices, dom }
}

/** Fires a real paste carrying `files` at the editor. */
function paste(dom: HTMLElement, files: File[]) {
  const data = new DataTransfer()
  files.forEach((file) => data.items.add(file))
  dom.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
  )
}

const imagesIn = (body: JSONContent) =>
  (body.content ?? []).flatMap((block) =>
    (block.content ?? []).filter((node) => node.type === 'image'),
  )

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('pasting an image', () => {
  it('inserts it into the document', async () => {
    const { bodies, dom } = mount()
    paste(dom, [new File([PNG_BYTES], 'cat.png', { type: 'image/png' })])

    await waitFor(() => expect(bodies.length).toBeGreaterThan(0))
    const images = imagesIn(bodies.at(-1)!)
    expect(images).toHaveLength(1)
    expect(String(images[0].attrs?.src)).toMatch(IMAGE_SRC)
    // No alt from the file's name, which went into shares and exports (Docs/audit-2026-11-05.md, 25).
    expect(images[0].attrs?.alt).toBe('')
  })

  it('refuses a file it will not store, and says so', async () => {
    const { bodies, notices, dom } = mount()
    paste(dom, [new File(['<svg/>'], 'evil.svg', { type: 'image/svg+xml' })])

    await waitFor(() => expect(notices).toHaveLength(1))
    expect(notices[0]).toContain('evil.svg')
    expect(bodies.flatMap(imagesIn)).toHaveLength(0)
  })

  // Without a handler ProseMirror returns before preventDefault and the browser
  // navigates the window to the dropped file, unloading the app with an edit
  // possibly still inside the save debounce.
  it('swallows a dropped file rather than letting the browser navigate', () => {
    const { dom } = mount()
    const data = new DataTransfer()
    data.items.add(new File(['x'], 'notes.zip', { type: 'application/zip' }))
    // Coordinates matter: prosemirror-view resolves a document position from
    // them and returns before consulting handleDrop if that fails.
    const box = dom.getBoundingClientRect()
    const event = new DragEvent('drop', {
      dataTransfer: data,
      clientX: box.left + box.width / 2,
      clientY: box.top + 4,
      bubbles: true,
      cancelable: true,
    })
    dom.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves an ordinary text paste alone', async () => {
    const { bodies, dom } = mount()
    const data = new DataTransfer()
    data.setData('text/plain', 'just words')
    dom.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )

    await waitFor(() => expect(bodies.length).toBeGreaterThan(0))
    expect(bodies.flatMap(imagesIn)).toHaveLength(0)
  })
})

describe('toDataUrl in a real browser', () => {
  it('re-encodes an image over the cap instead of refusing it', async () => {
    const file = await bigPng(2400)
    expect(file.size).toBeGreaterThan(200 * 1024)

    const src = await toDataUrl(file)
    expect(src).toMatch(IMAGE_SRC)
    // Re-encoded to WebP and brought under the cap.
    expect(src!.startsWith('data:image/webp;base64,')).toBe(true)
    expect(src!.length).toBeLessThan(400 * 1024)
  })

  it('falls back to JPEG where the browser cannot encode WebP, as on iPhone and iPad', async () => {
    const original = HTMLCanvasElement.prototype.toBlob
    // WebKit's behaviour: asked for WebP, it returns a PNG without complaint.
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      original.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality)
    }
    try {
      const src = await toDataUrl(await bigPng(2400))
      expect(src).toMatch(IMAGE_SRC)
      expect(src!.startsWith('data:image/jpeg;base64,')).toBe(true)
      expect(src!.length).toBeLessThan(400 * 1024)
    } finally {
      HTMLCanvasElement.prototype.toBlob = original
    }
  })

  // A photograph full of detail: leaves, water, an old chart. On an iPad one of 3 MB was 310 KB drawn 1000 across, and
  // was refused, where a plainer one five times its size went in. The encoder here is stood in for, so many bytes to
  // the pixel, to say exactly how detailed: what it's handed is what toDataUrl drew.
  describe('one too detailed to fit at the size most are drawn', () => {
    const original = HTMLCanvasElement.prototype.toBlob
    let drawn: number[] = []
    const detailed = (bytesPerPixel: number) => {
      drawn = []
      HTMLCanvasElement.prototype.toBlob = function (callback) {
        drawn.push(this.width)
        callback(new Blob([new Uint8Array(Math.round(this.width * this.height * bytesPerPixel))], { type: 'image/webp' }))
      }
    }
    afterEach(() => void (HTMLCanvasElement.prototype.toBlob = original))

    it('is drawn smaller until it does, rather than refused', async () => {
      const file = await bigPng(2400)
      detailed(0.3)
      expect(await toDataUrl(file)).toMatch(IMAGE_SRC)
      expect(drawn).toEqual([1600, 1000, 700])
      detailed(0.6)
      const src = await toDataUrl(file)
      expect(src).toMatch(IMAGE_SRC)
      expect(drawn).toEqual([1600, 1000, 700, 500])
      // Within a picture's limit, as every picture kept is.
      expect(atob(src!.split(',')[1]).length).toBeLessThanOrEqual(200 * 1024)
    })

    it('is as large as fits: no smaller than it has to be', async () => {
      const file = await bigPng(2400)
      detailed(0.1)
      await toDataUrl(file)
      expect(drawn).toEqual([1600, 1000])
    })

    it('is refused only when the smallest it’s drawn is still too much', async () => {
      const file = await bigPng(2400)
      detailed(1)
      expect(await toDataUrl(file)).toBeNull()
      expect(drawn).toEqual([1600, 1000, 700, 500])
    })
  })

  it('refuses rather than storing something enormous', async () => {
    // Nothing decodable, so every downscale attempt fails and it gives up.
    const junk = new File([new Uint8Array(500 * 1024)], 'junk.png', { type: 'image/png' })
    expect(await toDataUrl(junk)).toBeNull()
  })
})

describe('a hostile src already in the document body', () => {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  function mountWith(body: JSONContent) {
    render(
      <div data-scroll>
        <Editor kind="note" focus={false} initialBody={body} onChange={() => {}} />
      </div>,
    )
    return document.querySelector<HTMLElement>('.nib-editor')!
  }

  const paragraph = (...content: JSONContent[]): JSONContent => ({
    type: 'doc',
    content: [{ type: 'paragraph', content }],
  })

  /** src values that would make the browser fetch. A missing src is not one. */
  const fetchable = (root: HTMLElement) =>
    [...root.querySelectorAll('img')]
      .map((img) => img.getAttribute('src'))
      .filter((src): src is string => src !== null)

  it('still shows one of our own data URIs', () => {
    const dom = mountWith(paragraph({ type: 'image', attrs: { src: PNG, alt: 'a cat' } }))
    expect(fetchable(dom)).toEqual([PNG])
  })

  // IndexedDB is not a trusted renderer input. parseHTML never sees this JSON.
  // ProseMirror also inserts a src-less separator img beside inline atoms —
  // count fetchable srcs, not every img.
  it.each([
    'https://evil.test/pixel.png',
    'javascript:alert(1)',
    'blob:https://evil.test/abc',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  ])('does not put %s on an img', (src) => {
    const dom = mountWith(
      paragraph(
        { type: 'text', text: 'before ' },
        { type: 'image', attrs: { src, alt: 'x' } },
        { type: 'image', attrs: { src: PNG, alt: 'ok' } },
      ),
    )
    expect(fetchable(dom)).toEqual([PNG])
    expect(fetchable(dom).every(allowedImageSrc)).toBe(true)
    expect(dom.innerHTML).not.toContain(src)
  })

  it('does not fetch when the stored body is only a remote src', () => {
    const src = 'https://evil.test/pixel.png'
    const dom = mountWith(paragraph({ type: 'image', attrs: { src, alt: 'x' } }))
    expect(fetchable(dom)).toEqual([])
    expect(dom.innerHTML).not.toContain(src)
  })
})
