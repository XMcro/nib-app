// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { getSchema } from '@tiptap/core'
import { nibExtensions } from '../editor/extensions'
import { IMAGE_SRC, MAX_DRAWING, allowedDrawing, allowedImageSrc, filterBodyImages, imageBytes, mapImageSrcs, toDataUrl, withoutAbout, withoutAboutIn, withoutJpegAbout, withoutPngAbout, withoutWebpAbout, asImageSize, IMAGE_SIZES, IMAGE_SHARE, IMAGE_SIZE_RULES, asFull, filesIn, withoutOriginals } from './image'

/**
 * The re-encoding path needs createImageBitmap and a real canvas, so it is
 * covered in the browser project. What matters here is the policy: which files
 * are refused, and that an accepted one is stored byte-for-byte.
 */

const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (character) => character.charCodeAt(0),
)

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('IMAGE_SRC', () => {
  it.each([
    'data:image/png;base64,iVBORw0KGgo=',
    'data:image/jpeg;base64,AAAA',
    'data:image/gif;base64,AAAA',
    'data:image/webp;base64,AAAA',
  ])('accepts %s', (src) => expect(IMAGE_SRC.test(src)).toBe(true))

  // Nothing remote and nothing scriptable. This is the boundary that stops an
  // imported file making the editor fetch an address, so it must stay tight.
  it.each([
    'https://evil.test/pixel.png',
    'http://evil.test/pixel.png',
    '//evil.test/pixel.png',
    'blob:https://evil.test/abc',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:text/html;base64,PGgxPmhpPC9oMT4=',
    'javascript:alert(1)',
    'photo.jpg',
    '',
  ])('refuses %s', (src) => expect(IMAGE_SRC.test(src)).toBe(false))
})

describe('allowedImageSrc', () => {
  it('is the same allowlist as IMAGE_SRC, and refuses non-strings', () => {
    expect(allowedImageSrc('data:image/png;base64,AAAA')).toBe(true)
    expect(allowedImageSrc('https://evil.test/pixel.png')).toBe(false)
    expect(allowedImageSrc(null)).toBe(false)
    expect(allowedImageSrc({ src: PNG })).toBe(false)
  })
})

describe('filterBodyImages', () => {
  const paragraph = (...content: JSONContent[]): JSONContent => ({
    type: 'doc',
    content: [{ type: 'paragraph', content }],
  })

  it('keeps a data URI Nib stores', () => {
    const body = paragraph({ type: 'image', attrs: { src: PNG, alt: 'a cat' } })
    expect(filterBodyImages(body)).toEqual(body)
  })

  // Hostile JSON in IndexedDB never goes through parseHTML. Dropping the node
  // here is what a restore helper — and editor load — call so a remote src
  // cannot reach render.
  it.each([
    'https://evil.test/pixel.png',
    'javascript:alert(1)',
    'blob:https://evil.test/abc',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  ])('drops an image whose src is %s', (src) => {
    const body = paragraph(
      { type: 'text', text: 'before ' },
      { type: 'image', attrs: { src, alt: 'x' } },
      { type: 'text', text: ' after' },
    )
    expect(filterBodyImages(body)).toEqual(
      paragraph({ type: 'text', text: 'before ' }, { type: 'text', text: ' after' }),
    )
  })

  it('walks nested lists so a dump cannot hide a remote src', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'image', attrs: { src: 'https://evil.test/pixel.png' } },
                    { type: 'image', attrs: { src: PNG, alt: 'ok' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const filtered = filterBodyImages(body)
    const inline = filtered.content?.[0].content?.[0].content?.[0].content ?? []
    expect(inline).toEqual([{ type: 'image', attrs: { src: PNG, alt: 'ok' } }])
  })

  // Every path a stored body takes into the app comes through here. One whose
  // text wasn't a string passed, and threw where the list reads titles: the
  // app drew nothing at all, at every launch.
  it.each([
    ['text that isn’t a string', { type: 'text', text: { toString: 0, valueOf: 0 } }],
    ['empty text', { type: 'text', text: '' }],
    ['no type', { text: 'x' }],
    ['attrs that aren’t an object', { type: 'hardBreak', attrs: ['x'] }],
    ['marks that aren’t a list of marks', { type: 'text', text: 'x', marks: [null] }],
    ['content that isn’t a list', { type: 'paragraph', content: 'x' }],
    ['a node that isn’t an object', null],
  ])('drops a node with %s, keeping the rest', (_, odd) => {
    const body = paragraph({ type: 'text', text: 'kept' }, odd as JSONContent)
    expect(filterBodyImages(body)).toEqual(paragraph({ type: 'text', text: 'kept' }))
  })

  // A cell's width is written into a style; a string there wrote CSS.
  it('keeps a table cell’s column widths only as numbers', () => {
    const cell = (colwidth: unknown): JSONContent => ({ type: 'tableCell', attrs: { colspan: 1, colwidth }, content: [{ type: 'paragraph' }] })
    const table = (colwidth: unknown): JSONContent => ({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [cell(colwidth)] }] }] })
    const width = (colwidth: unknown) => filterBodyImages(table(colwidth)).content?.[0].content?.[0].content?.[0].attrs?.colwidth
    expect(width([120, 80])).toEqual([120, 80])
    expect(width(null)).toBeNull()
    expect(width(['1px;background:url(x)'])).toBeNull()
    expect(width([120, -5])).toBeNull()
    expect(width('120')).toBeNull()
  })

  // A table is drawn a column at a time: a cell spanning ten million froze the page at every opening.
  it('keeps a table cell’s spans to whole numbers up to a hundred', () => {
    const table = (attrs: Record<string, unknown>): JSONContent => ({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs, content: [{ type: 'paragraph' }] }] }] }] })
    const spans = (attrs: Record<string, unknown>) => filterBodyImages(table(attrs)).content?.[0].content?.[0].content?.[0].attrs
    expect(spans({ colspan: 3, rowspan: 100 })).toEqual({ colspan: 3, rowspan: 100 })
    expect(spans({ colspan: 10_000_000, rowspan: 101 })).toEqual({ colspan: 1, rowspan: 1 })
    expect(spans({ colspan: 1e300, rowspan: 0 })).toEqual({ colspan: 1, rowspan: 1 })
    expect(spans({ colspan: '4', rowspan: 2.5 })).toEqual({ colspan: 1, rowspan: 1 })
    expect(spans({ colwidth: null })).toEqual({ colwidth: null })
  })

  it('drops what is nested past any depth Nib writes', () => {
    let deep: JSONContent = { type: 'text', text: 'too deep' }
    for (let i = 0; i < 5000; i++) deep = { type: 'blockquote', content: [deep] }
    const body: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kept' }] }, deep] }
    expect(JSON.stringify(filterBodyImages(body))).not.toContain('too deep')
    expect(filterBodyImages(body).content?.[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'kept' }] })
  })
})

describe('mapImageSrcs', () => {
  it('rewrites src and does not drop a node — filtering is filterBodyImages', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'image', attrs: { src: 'https://evil.test/pixel.png', alt: 'x' } }],
        },
      ],
    }
    expect(mapImageSrcs(body, () => 'rewritten')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'image', attrs: { src: 'rewritten', alt: 'x' } }],
        },
      ],
    })
    expect(filterBodyImages(body).content?.[0].content).toEqual([])
  })
})

describe('toDataUrl', () => {
  it('refuses a file that is not an image Nib stores', async () => {
    expect(await toDataUrl(new Blob(['<svg/>'], { type: 'image/svg+xml' }))).toBeNull()
    expect(await toDataUrl(new Blob(['hello'], { type: 'text/plain' }))).toBeNull()
    expect(await toDataUrl(new Blob([PNG_BYTES], { type: '' }))).toBeNull()
  })

  it('keeps a small image byte-for-byte, so an animated GIF still animates', async () => {
    const src = await toDataUrl(new Blob([PNG_BYTES], { type: 'image/png' }))
    expect(src).toMatch(IMAGE_SRC)
    expect(src).toBe(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    )
  })
})

describe('Dexie restore round-trip', () => {
  const paragraph = (...content: JSONContent[]): JSONContent => ({
    type: 'doc',
    content: [{ type: 'paragraph', content }],
  })

  beforeEach(async () => {
    const { db } = await import('../db/db')
    await db.items.clear()
    await db.revisions.clear()
  })

  it('keeps a src allowedImageSrc accepts and drops ones it refuses', async () => {
    const { restoreBackup, BACKUP_KIND, BACKUP_VERSION } = await import('./backup')
    const { db } = await import('../db/db')

    const kept = paragraph({ type: 'image', attrs: { src: PNG, alt: 'ok' } })
    const file = JSON.stringify({
      kind: BACKUP_KIND,
      version: BACKUP_VERSION,
      exportedAt: 0,
      preferences: {},
      images: {},
      items: [
        {
          id: 'ok',
          kind: 'note',
          body: kept,
          version: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'bad',
          kind: 'note',
          body: paragraph({ type: 'image', attrs: { src: 'https://evil.test/pixel.png' } }),
          version: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      revisions: [],
    })

    await restoreBackup(file)
    const ok = await db.items.get('ok')
    const bad = await db.items.get('bad')
    expect(ok?.body).toEqual(filterBodyImages(kept))
    expect(allowedImageSrc(ok?.body.content?.[0].content?.[0].attrs?.src)).toBe(true)
    expect(bad?.body).toEqual(filterBodyImages(paragraph({ type: 'image', attrs: { src: 'https://evil.test/pixel.png' } })))
    expect(JSON.stringify(bad)).not.toContain('https://evil.test')
  })
})

describe('sketches', () => {
  const SKETCH_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const sketch = (drawing: unknown): JSONContent => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: SKETCH_PNG, alt: 'Sketch', drawing } }] }],
  })
  const drawingOf = (body: JSONContent) => body.content?.[0].content?.[0].attrs?.drawing

  it('keeps a drawing that is plain base64 within the cap', () => {
    expect(allowedDrawing('AAAA+/==')).toBe(true)
    expect(allowedDrawing('A'.repeat(MAX_DRAWING))).toBe(true)
  })

  it('refuses one over 500 KB, one carrying anything but base64, and anything not a string', () => {
    expect(MAX_DRAWING).toBe(500 * 1024)
    expect(allowedDrawing('A'.repeat(MAX_DRAWING + 1))).toBe(false)
    for (const bad of ['<script>', 'AA AA', 'data:image/png;base64,AAAA', '', 42, null, {}]) {
      expect(allowedDrawing(bad)).toBe(false)
    }
  })

  it('drops a drawing that fails the check and keeps the picture', () => {
    const body = filterBodyImages(sketch('<img onerror=alert(1)>'))
    expect(body.content?.[0].content?.[0].attrs?.src).toBe(SKETCH_PNG)
    expect(drawingOf(body)).toBeNull()
  })

  it('leaves a good drawing, and an ordinary picture, as they were', () => {
    expect(drawingOf(filterBodyImages(sketch('AAAA')))).toBe('AAAA')
    const photo: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: SKETCH_PNG } }] }] }
    expect(filterBodyImages(photo)).toEqual(photo)
  })

  it('counts the drawing against the document budget, not just the picture', () => {
    const doc = getSchema(nibExtensions(true)).nodeFromJSON(sketch('A'.repeat(1000)))
    expect(imageBytes(doc)).toBe(SKETCH_PNG.length + 1000)
  })
})

// Small pictures were kept byte for byte, EXIF and all: where and when they were taken went into shared drafts and exports.
describe('a picture’s words about itself', () => {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    new DataView(out.buffer).setUint32(0, data.length)
    out.set([...type].map((c) => c.charCodeAt(0)), 4)
    out.set(data, 8)
    return out
  }
  const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]))

  it('go from a PNG, its pixels kept', () => {
    // The 1×1 PNG: signature, IHDR, IDAT, IEND. EXIF and text put in after IHDR.
    const ihdrEnd = 8 + 12 + 13
    const withAbout = join(PNG_BYTES.subarray(0, ihdrEnd), chunk('eXIf', new TextEncoder().encode('GPS 51.5,-0.1')), chunk('tEXt', new TextEncoder().encode('Author\0Me')), PNG_BYTES.subarray(ihdrEnd))
    expect(withoutPngAbout(withAbout)).toEqual(PNG_BYTES)
    expect(withoutPngAbout(new TextEncoder().encode('not a png'))).toBeNull()
  })

  it('go from a WebP, and its header no longer says it has them', () => {
    const riff = (...chunks: Uint8Array[]) => {
      const body = join(new TextEncoder().encode('WEBP'), ...chunks)
      const out = join(new TextEncoder().encode('RIFF'), new Uint8Array(4), body)
      new DataView(out.buffer).setUint32(4, body.length, true)
      return out
    }
    const webpChunk = (type: string, data: number[]) => {
      const out = new Uint8Array(8 + data.length + (data.length % 2))
      out.set([...type].map((c) => c.charCodeAt(0)))
      new DataView(out.buffer).setUint32(4, data.length, true)
      out.set(data, 8)
      return out
    }
    const vp8x = (flags: number) => webpChunk('VP8X', [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const image = webpChunk('VP8L', [1, 2, 3])
    const withAbout = riff(vp8x(0x0c), image, webpChunk('EXIF', [9, 9, 9, 9]), webpChunk('XMP ', [8, 8]))
    expect(withoutWebpAbout(withAbout)).toEqual(riff(vp8x(0), image))
  })

  describe('in a JPEG', () => {
    const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : part)))
    const segment = (marker: number, ...data: (number[] | string)[]) => {
      const body = bytes(...data)
      return join(Uint8Array.of(0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255), body)
    }
    /** EXIF with one IFD0 entry for its way up, and a GPS note after it. */
    const exif = (orientation: number, little = false) => {
      const short = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255])
      const long = (n: number) => (little ? [n & 255, n >> 8, 0, 0] : [0, 0, n >> 8, n & 255])
      return segment(0xe1, 'Exif\0\0', little ? 'II' : 'MM', short(42), long(8), short(1), short(0x112), short(3), long(1), [...short(orientation), 0, 0], long(0), 'GPS 51.5,-0.1')
    }
    const JFIF = segment(0xe0, 'JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0])
    const ICC = segment(0xe2, 'ICC_PROFILE\0', [1, 1, 9, 9])
    const ADOBE = segment(0xee, 'Adobe', [0, 100, 0, 0, 0, 0, 2])
    const TABLE = segment(0xdb, [0, 1, 2, 3])
    const FRAME = segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0])
    const SCAN = join(segment(0xda, [1, 1, 0, 0, 63, 0]), Uint8Array.of(0x12, 0xff, 0, 0x34, 0xff, 0xd3, 0x56))
    const SOI = Uint8Array.of(0xff, 0xd8)
    const EOI = Uint8Array.of(0xff, 0xd9)
    const about = [segment(0xe1, 'http://ns.adobe.com/xap/1.0/\0', 'GPS in XMP'), segment(0xe2, 'MPF\0', 'GPS in MPF'), segment(0xed, 'Photoshop 3.0\0', 'GPS in IPTC'), segment(0xfe, 'GPS in a comment')]
    const read = (out: Uint8Array | null) => new TextDecoder('latin1').decode(out!)

    it('go, and the picture stays byte for byte, with what says how to show it', () => {
      const out = withoutJpegAbout(join(SOI, JFIF, exif(1), ...about, ICC, ADOBE, TABLE, FRAME, SCAN, EOI))
      expect(out).toEqual(join(SOI, JFIF, ICC, ADOBE, TABLE, FRAME, SCAN, EOI))
      expect(read(out)).not.toContain('GPS')
    })

    it('keep which way up it goes, and nothing else of EXIF', () => {
      for (const little of [false, true]) {
        const out = withoutJpegAbout(join(SOI, JFIF, exif(6, little), TABLE, FRAME, SCAN, EOI))!
        expect(read(out)).not.toContain('GPS')
        expect(withoutJpegAbout(out)).toEqual(out)
        const tiff = out.subarray(SOI.length + JFIF.length + 10)
        const view = new DataView(tiff.buffer, tiff.byteOffset)
        expect([view.getUint16(0), view.getUint16(10), view.getUint16(18)]).toEqual([0x4d4d, 0x0112, 6])
      }
    })

    it('are found between the scans of a progressive one, and what follows its end goes', () => {
      const second = join(segment(0xda, [1, 1, 0, 1, 2, 0]), Uint8Array.of(0x77, 0xff, 0, 0x78))
      const out = withoutJpegAbout(join(SOI, TABLE, FRAME, SCAN, segment(0xc4, [0, 1, 1]), segment(0xfe, 'GPS between'), second, EOI, 'GPS in a second picture' as never as Uint8Array))
      expect(out).toEqual(join(SOI, TABLE, FRAME, SCAN, segment(0xc4, [0, 1, 1]), second, EOI))
    })

    it('go from one cut off short too, and leave one that isn’t a JPEG', () => {
      expect(withoutJpegAbout(join(SOI, exif(1), FRAME, SCAN))).toEqual(join(SOI, FRAME, SCAN))
      expect(withoutJpegAbout(bytes('not a jpeg'))).toBeNull()
      expect(withoutJpegAbout(join(SOI, Uint8Array.of(0xff, 0xe1, 0xff, 0xff)))).toBeNull()
    })

    // Browsers step over them; refused here, such a picture went missing on paste and import.
    it('go from one with stray bytes between its segments, as a browser would step over them', () => {
      const stray = Uint8Array.of(0, 0x41, 0)
      expect(withoutJpegAbout(join(SOI, stray, exif(1), stray, FRAME, SCAN, EOI))).toEqual(join(SOI, FRAME, SCAN, EOI))
      expect(withoutJpegAbout(join(SOI, stray))).toBeNull()
    })

    const uri = (type: string, out: Uint8Array) => `data:image/${type};base64,${btoa(String.fromCharCode(...out))}`
    const photo = join(SOI, exif(1), FRAME, SCAN, EOI)
    const plain = join(SOI, FRAME, SCAN, EOI)

    it('go by what a picture’s bytes are, whatever it’s called', () => {
      expect(withoutAbout(uri('jpeg', photo))).toBe(uri('jpeg', plain))
      expect(withoutAbout(uri('png', photo))).toBe(uri('png', plain))
      const gif = bytes('GIF89a', [1, 2, 3])
      expect(withoutAbout(uri('gif', gif))).toBe(uri('gif', gif))
      expect(withoutAbout('data:image/png;base64,####')).toBeNull()
      expect(withoutAbout(uri('png', Uint8Array.of(0x89, 1, 2)))).toBeNull()
    })

    it('go from every picture in a body leaving Nib, and only there', () => {
      const body: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: uri('jpeg', photo) } }] }] }
      const stored = JSON.stringify(body)
      expect(JSON.stringify(withoutAboutIn(body))).toContain(btoa(String.fromCharCode(...plain)))
      expect(JSON.stringify(body)).toBe(stored)
    })
  })

  it('leave with nothing of where the original is: a file on the writer’s devices is no one else’s to know of', () => {
    const full = { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'image/jpeg', size: 4000000 }
    const body: JSONContent = { type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: PNG, alt: 'A hill', size: 'small', full } }] }] }] }
    const stored = JSON.stringify(body)
    const left = withoutAboutIn(body)
    expect(left.content![0].content![0].content![0]).toEqual({ type: 'image', attrs: { src: PNG, alt: 'A hill', size: 'small' } })
    expect(JSON.stringify(left)).not.toContain('7b0f6f0e')
    expect(JSON.stringify(body)).toBe(stored)
  })

  it('are found wherever a body names them, and only those that are one', () => {
    const one = { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'image/jpeg', size: 4000000 }
    const two = { id: '8c1f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1e', type: 'image/png', size: 300000 }
    const picture = (full: unknown): JSONContent => ({ type: 'image', attrs: { src: PNG, full } })
    const body: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }, picture(one), picture(null), picture({ id: '../index', type: 'image/png', size: 5 })] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [picture(two), picture(one)] }] }] },
      ],
    }
    expect(filesIn(body)).toEqual([one, two, one])
    expect(filesIn({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual([])

    // And a body that names none, for the vault: the pictures as they are, nothing else touched, what's stored as it was.
    const stored = JSON.stringify(body)
    const without = withoutOriginals(body)
    expect(filesIn(without)).toEqual([])
    expect(without.content![1].content![0].content![0].content).toEqual([{ type: 'image', attrs: { src: PNG } }, { type: 'image', attrs: { src: PNG } }])
    expect(without.content![0].content![0]).toEqual({ type: 'text', text: 'Before' })
    expect(JSON.stringify(body)).toBe(stored)
  })

  it('are kept from a small PNG taken in', async () => {
    const ihdrEnd = 8 + 12 + 13
    const withAbout = join(PNG_BYTES.subarray(0, ihdrEnd), chunk('eXIf', new TextEncoder().encode('GPS 51.5,-0.1')), PNG_BYTES.subarray(ihdrEnd))
    expect(await toDataUrl(new File([withAbout], 'here.png', { type: 'image/png' }))).toBe(PNG)
  })
})

describe('a picture’s size', () => {
  it('is one of four words, and nothing else', () => {
    expect([...IMAGE_SIZES]).toEqual(['small', 'medium', 'large', 'full'])
    for (const size of IMAGE_SIZES) expect(asImageSize(size)).toBe(size)
    for (const odd of [null, undefined, '', 'huge', 'Small', '50%', 300, 'small" onerror="x', {}]) expect(asImageSize(odd)).toBeNull()
  })
})

describe('a picture’s size as it’s drawn', () => {
  // Two stylesheets are files of their own and can't read lib/image: held to it here.
  it('is the same share of the text’s width in the app, in a shared draft and in what’s exported', async () => {
    const { readFileSync } = await import('node:fs')
    const sheets = { app: readFileSync('src/index.css', 'utf8'), reader: readFileSync('src/reader/reader.css', 'utf8') }
    for (const size of IMAGE_SIZES) {
      const share = IMAGE_SHARE[size]
      expect(sheets.app, `index.css, ${size}`).toMatch(new RegExp(`\\.nib-editor img\\[data-size='${size}'\\] \\{\\s*width: ${share}%;`))
      expect(sheets.reader, `reader.css, ${size}`).toMatch(new RegExp(`\\.draft img\\[data-size='${size}'\\] \\{\\s*width: ${share}%;`))
      expect(IMAGE_SIZE_RULES).toContain(`img[data-size="${size}"] { width: ${share}%; }`)
    }
    expect(IMAGE_SHARE).toEqual({ small: 33, medium: 50, large: 75, full: 100 })
  })
})

// A picture's original in the file store (lib/originals): what a document may say of it.
describe('a picture’s original, as a document names it', () => {
  const full = { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'image/jpeg', size: 4_000_000 }
  const src = 'data:image/png;base64,iVBORw0KGgo='
  const picture = (attrs: object) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src, alt: '', ...attrs } }] }] })
  const kept = (body: ReturnType<typeof picture>) => filterBodyImages(body).content![0].content![0].attrs

  it('is an id of the store’s, a kind of picture Nib keeps and a size a file can be, and nothing more', () => {
    expect(asFull(full)).toEqual(full)
    expect(asFull({ ...full, url: 'https://example.com/a.jpg', name: 'x' })).toEqual(full)
    for (const not of [
      null,
      undefined,
      'a file',
      { ...full, id: '../index' },
      { ...full, id: 'https://example.com/a.jpg' },
      { ...full, id: 7 },
      { ...full, type: 'image/svg+xml' },
      { ...full, type: 'text/html' },
      { ...full, size: 0 },
      { ...full, size: -4 },
      { ...full, size: 1.5 },
      { ...full, size: '4000000' },
      { ...full, size: 25 * 1024 * 1024 + 1 },
    ]) {
      expect(asFull(not), JSON.stringify(not)).toBeNull()
    }
  })

  it('stays on its picture when a document is read, and one that isn’t one costs only itself', () => {
    expect(kept(picture({ full }))).toMatchObject({ src, full })
    // The picture stays, as the note has it.
    expect(kept(picture({ full: { ...full, id: '../../etc/passwd' } }))).toMatchObject({ src, full: null })
    expect(kept(picture({ full: 'https://example.com/a.jpg' }))).toMatchObject({ src, full: null })
    // None said, none added.
    expect('full' in kept(picture({}))!).toBe(false)
  })
})
