import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_FILE } from './fileRef'
import type { JSONContent } from '@tiptap/core'
import { fileUrl, forgetFile, keepFile } from './files'
import { MAX_BYTES, withoutJpegAbout } from './image'
import { fetchOriginalsWith, keepOriginal, keepOriginals, originalUrl, withOriginals } from './originals'

/** A picture's original, kept with Nib Plus (lib/originals): which pictures have one, and what's left behind from it. */

/** A JPEG with an EXIF block saying where it was taken, and `fill` bytes of picture. */
function jpeg(fill = 300 * 1024) {
  const exif = [0xff, 0xe1, 0x00, 0x1c, ...[...'Exif\0\0MM\0*\0\0\0\b\0\0GPS 51.5,-0.12'].map((char) => char.charCodeAt(0))]
  exif[3] = exif.length - 2
  const scan = new Uint8Array(fill).fill(0x55)
  return new Blob([Uint8Array.of(0xff, 0xd8), Uint8Array.from(exif), Uint8Array.of(0xff, 0xda, 0x00, 0x02), scan, Uint8Array.of(0xff, 0xd9)], { type: 'image/jpeg' })
}
/** A PNG of `size` bytes in all: its signature, one chunk of picture, and its end. */
function png(size: number) {
  const data = size - 8 - 12 - 12
  const chunk = (type: string, length: number) => {
    const bytes = new Uint8Array(12 + length)
    new DataView(bytes.buffer).setUint32(0, length)
    bytes.set([...type].map((char) => char.charCodeAt(0)), 4)
    return bytes
  }
  return new Blob([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IDAT', data), chunk('IEND', 0)], { type: 'image/png' })
}
const kept = async (id: string) => new Uint8Array(await (await fetch((await fileUrl(id))!)).arrayBuffer())

afterEach(() => keepOriginals(false))

describe('a picture’s original', () => {
  it('is kept with Nib Plus, as it came but for what it says about itself', async () => {
    keepOriginals(true)
    const file = jpeg()
    const full = (await keepOriginal(file, false))!
    const stripped = withoutJpegAbout(new Uint8Array(await file.arrayBuffer()))!
    expect(full).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), type: 'image/jpeg', size: stripped.length })
    const bytes = await kept(full.id)
    expect(bytes).toEqual(stripped)
    // Where it was taken stays behind; the picture's own bytes don't.
    expect(new TextDecoder('latin1').decode(bytes)).not.toContain('GPS')
    expect(bytes.length).toBeGreaterThan(300 * 1024)
  })

  it('isn’t kept without Plus', async () => {
    expect(await keepOriginal(jpeg(), false)).toBeNull()
  })

  it('isn’t kept for a locked note, whose text is sealed where a file beside the library isn’t', async () => {
    keepOriginals(true)
    expect(await keepOriginal(jpeg(), true)).toBeNull()
    expect(await keepOriginal(png(MAX_BYTES + 1), true)).toBeNull()
  })

  it('isn’t kept when the note’s own picture is already the file untouched: a small PNG, WebP or GIF', async () => {
    keepOriginals(true)
    expect(await keepOriginal(png(MAX_BYTES), false)).toBeNull()
    expect(await keepOriginal(new Blob(['GIF89a…'], { type: 'image/gif' }), false)).toBeNull()
    // Over what a note's picture may be, it was made smaller for the note: kept. And a JPEG is always drawn again for the note: kept.
    expect(await keepOriginal(png(MAX_BYTES + 1), false)).not.toBeNull()
    expect(await keepOriginal(jpeg(1000), false)).not.toBeNull()
  })

  it('isn’t kept over a file’s limit, or for a kind of picture Nib doesn’t keep, or one that isn’t what it says', async () => {
    keepOriginals(true)
    const huge = png(MAX_FILE + 1)
    const read = vi.spyOn(huge, 'arrayBuffer')
    expect(await keepOriginal(huge, false)).toBeNull()
    // Turned away by its size alone: a file that large isn't read into memory to find that out.
    expect(read).not.toHaveBeenCalled()
    // A picture's bytes under another kind's name aren't Nib's to keep either.
    expect(await keepOriginal(new Blob([await png(MAX_BYTES + 1).arrayBuffer()], { type: 'application/pdf' }), false)).toBeNull()
    expect(await keepOriginal(new Blob(['<svg onload="alert(1)"/>'.repeat(20000)], { type: 'image/svg+xml' }), false)).toBeNull()
    expect(await keepOriginal(new Blob(['not a picture at all'.repeat(20000)], { type: 'image/png' }), false)).toBeNull()
  })

  it('is called what its bytes are, not what the file said', async () => {
    keepOriginals(true)
    const really = new Blob([await png(MAX_BYTES + 1).arrayBuffer()], { type: 'image/jpeg' })
    expect((await keepOriginal(really, false))!.type).toBe('image/png')
  })
})

describe('a body with its pictures’ originals, for an export', () => {
  const SMALL = `data:image/jpeg;base64,${btoa('the small picture the note holds')}`
  const picture = (attrs: Record<string, unknown>): JSONContent => ({ type: 'image', attrs: { src: SMALL, alt: 'A hill', size: 'medium', ...attrs } })
  const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
  const src = (bytes: Uint8Array, type: string) => `data:${type};base64,${btoa(String.fromCharCode(...bytes))}`

  it('has each original in place of the note’s own picture, wherever in the document it is, and nothing else changed', async () => {
    keepOriginals(true)
    const file = jpeg(2000)
    const full = (await keepOriginal(file, false))!
    const stripped = withoutJpegAbout(new Uint8Array(await file.arrayBuffer()))!
    const body = doc(
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }, picture({ full })] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [picture({ full })] }] }] },
    )
    const stored = JSON.stringify(body)
    const whole = await withOriginals(body)
    const expected = { type: 'image', attrs: { src: src(stripped, 'image/jpeg'), alt: 'A hill', size: 'medium', full } }
    expect(whole.content![0].content).toEqual([{ type: 'text', text: 'Before' }, expected])
    expect(whole.content![1].content![0].content![0].content).toEqual([expected])
    // What's stored is as it was.
    expect(JSON.stringify(body)).toBe(stored)
  })

  it('is called the kind the note has for it: a file read back in the app comes without one', async () => {
    const bytes = new Uint8Array(await png(500).arrayBuffer())
    const id = (await keepFile(new Blob([bytes])))!
    const whole = await withOriginals(doc(picture({ full: { id, type: 'image/png', size: bytes.length } })))
    expect(whole.content![0].attrs!.src).toBe(src(bytes, 'image/png'))
  })

  it('keeps the note’s own picture where the original isn’t on this device, or what’s said of it isn’t an original’s', async () => {
    const id = (await keepFile(await png(500)))!
    const good = { id, type: 'image/png', size: 500 }
    await forgetFile(id)
    const other = (await keepFile(await png(500)))!
    const body = doc(
      picture({ full: good }),
      picture({}),
      picture({ full: null }),
      picture({ full: { id: other, type: 'image/svg+xml', size: 500 } }),
      picture({ full: { id: '../index', type: 'image/png', size: 500 } }),
      picture({ full: other }),
    )
    expect(await withOriginals(body)).toEqual(body)
  })
})

describe('an original that isn’t on this device', () => {
  const SMALL = `data:image/jpeg;base64,${btoa('the small picture the note holds')}`
  const bytes = Uint8Array.from({ length: 900 }, (_, at) => at % 233)
  const elsewhere = () => ({ id: crypto.randomUUID(), type: 'image/png', size: bytes.length })
  const doc = (full: unknown): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: SMALL, full } }] }] })
  /** As sync fetches one (sync/files): kept under its id, and said to be here. */
  const arriving = () => {
    const asked: string[] = []
    const fetch = async (full: { id: string; type: string }) => {
      asked.push(full.id)
      await new Promise((resolve) => setTimeout(resolve, 20))
      return (await keepFile(new Blob([bytes], { type: full.type }), full.id)) !== null
    }
    fetchOriginalsWith(fetch)
    return { asked, fetch }
  }
  afterEach(() => fetchOriginalsWith(null))

  it('is fetched the first time it’s shown, once however many ask, and shown from this device after', async () => {
    const { asked } = arriving()
    const full = elsewhere()
    const [one, two] = await Promise.all([originalUrl(full), originalUrl(full)])
    expect(one).toBe(two)
    expect(new Uint8Array(await (await fetch(one!)).arrayBuffer())).toEqual(bytes)
    expect(asked).toEqual([full.id])
    // Here now: not asked of the server again.
    expect(await originalUrl(full)).toBe(one)
    expect(asked).toEqual([full.id])
  })

  it('is fetched for an export that wants it', async () => {
    const { asked } = arriving()
    const full = elsewhere()
    const whole = await withOriginals(doc(full))
    expect(whole.content![0].content![0].attrs!.src).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`)
    expect(asked).toEqual([full.id])
  })

  it('stays as its note has it when it can’t be fetched, and is asked for again the next time', async () => {
    const asked: string[] = []
    fetchOriginalsWith(async (full) => (asked.push(full.id), false))
    const full = elsewhere()
    expect(await originalUrl(full)).toBeNull()
    expect(await withOriginals(doc(full))).toEqual(doc(full))
    expect(asked).toEqual([full.id, full.id])
  })

  it('is asked of no one while sync isn’t running, and a session that stops takes away only its own way of fetching', async () => {
    const full = elsewhere()
    expect(await originalUrl(full)).toBeNull()
    const earlier = arriving()
    const later = arriving()
    // The earlier session's stopping leaves the later one's in place.
    fetchOriginalsWith(null, earlier.fetch)
    expect(await originalUrl(full)).not.toBeNull()
    expect([earlier.asked, later.asked]).toEqual([[], [full.id]])
    fetchOriginalsWith(null, later.fetch)
    expect(await originalUrl(elsewhere())).toBeNull()
  })
})
