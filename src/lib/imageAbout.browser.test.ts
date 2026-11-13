import { describe, expect, it } from 'vitest'
import { toDataUrl, withoutAbout } from './image'

// A JPEG under 200 KB was kept byte for byte, its EXIF (where and when it was taken) and all.
describe('a small JPEG taken in', () => {
  it('is drawn again, leaving its EXIF behind', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 30
    canvas.getContext('2d')!.fillRect(0, 0, 20, 30)
    const jpeg = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/jpeg'))
    // An APP1 segment with EXIF's mark, put in after the start of the image.
    const bytes = new Uint8Array(await jpeg.arrayBuffer())
    const exif = Uint8Array.from([0xff, 0xe1, 0x00, 0x10, ...new TextEncoder().encode('Exif\0\0GPS 51.5')])
    const withExif = new File([bytes.subarray(0, 2), exif, bytes.subarray(2)], 'here.jpg', { type: 'image/jpeg' })
    const src = (await toDataUrl(withExif))!
    expect(src).toMatch(/^data:image\/(webp|jpeg);base64,/)
    expect(atob(src.slice(src.indexOf(',') + 1))).not.toContain('GPS 51.5')
    const shown = new Image()
    shown.src = src
    await shown.decode()
    expect([shown.width, shown.height]).toEqual([40, 30])
  })
})

// Security finding 7 of the 8 November audit: nothing can be drawn again here, and nothing should be.
describe('a picture imported or pasted', () => {
  const uri = (type: string, bytes: Uint8Array) => `data:${type};base64,${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`
  const blobOf = (canvas: HTMLCanvasElement, type: string) => new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), type))
  const decoded = async (src: string) => {
    const shown = new Image()
    shown.src = src
    await shown.decode()
    return shown
  }

  it('keeps a JPEG’s way up and its compressed picture, and loses where it was taken', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 20
    canvas.getContext('2d')!.fillRect(0, 0, 20, 20)
    const bytes = new Uint8Array(await (await blobOf(canvas, 'image/jpeg')).arrayBuffer())
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]
    const note = [...new TextEncoder().encode('GPS 51.5')]
    const data = [...new TextEncoder().encode('Exif\0\0'), ...tiff, ...note]
    const app1 = Uint8Array.from([0xff, 0xe1, (data.length + 2) >> 8, (data.length + 2) & 255, ...data])
    const photo = new Uint8Array([...bytes.subarray(0, 2), ...app1, ...bytes.subarray(2)])
    const out = withoutAbout(uri('image/jpeg', photo))!
    expect(atob(out.slice(out.indexOf(',') + 1))).not.toContain('GPS 51.5')
    expect(atob(out.slice(out.indexOf(',') + 1))).toContain(String.fromCharCode(...bytes.subarray(bytes.length - 64)))
    // On its side, as EXIF's 6 says, and as it was shown before.
    const shown = await decoded(out)
    expect([shown.naturalWidth, shown.naturalHeight]).toEqual([20, 40])
  })

  it('keeps a PNG’s transparency exactly', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    const context = canvas.getContext('2d')!
    context.fillStyle = 'rgba(200, 10, 10, 0.5)'
    context.fillRect(0, 0, 2, 4)
    const bytes = new Uint8Array(await (await blobOf(canvas, 'image/png')).arrayBuffer())
    const text = new TextEncoder().encode('Author\0Me at home')
    const chunk = new Uint8Array(12 + text.length)
    new DataView(chunk.buffer).setUint32(0, text.length)
    chunk.set([0x74, 0x45, 0x58, 0x74], 4)
    chunk.set(text, 8)
    const out = withoutAbout(uri('image/png', new Uint8Array([...bytes.subarray(0, 33), ...chunk, ...bytes.subarray(33)])))!
    expect(out).toBe(uri('image/png', bytes))
    const again = document.createElement('canvas')
    again.width = 4
    again.height = 4
    const drawn = again.getContext('2d')!
    drawn.drawImage(await decoded(out), 0, 0)
    expect([...drawn.getImageData(0, 0, 1, 1).data]).toEqual([...context.getImageData(0, 0, 1, 1).data])
    expect(drawn.getImageData(3, 0, 1, 1).data[3]).toBe(0)
  })
})
