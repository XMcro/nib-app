// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

const read = vi.hoisted(() => vi.fn())
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({ read }) }))
vi.mock('./platform', () => ({ nativeApp: true }))

const { READ_MAX, wordsIn } = await import('./pictureText')

const png = () => new File([Uint8Array.of(137, 80, 78, 71)], 'page.png', { type: 'image/png' })

describe('wordsIn', () => {
  it('hands the picture to the reader and keeps the paragraphs with words in them', async () => {
    read.mockResolvedValueOnce({ paragraphs: [' The boats came in late. ', '', '  ', 'It had been a long season.'] })

    expect(await wordsIn(png())).toEqual(['The boats came in late.', 'It had been a long season.'])
    expect(read).toHaveBeenLastCalledWith({ image: 'data:image/png;base64,iVBORw==' })
  })

  it('finds none in a picture with no words', async () => {
    read.mockResolvedValueOnce({ paragraphs: [] })
    expect(await wordsIn(png())).toBeNull()
  })

  it('finds none when the picture can’t be read', async () => {
    read.mockRejectedValueOnce(new Error('Couldn’t read the picture.'))
    vi.spyOn(console, 'warn').mockImplementationOnce(() => {})
    expect(await wordsIn(png())).toBeNull()
  })

  it('leaves alone a file Nib wouldn’t keep as a picture', async () => {
    read.mockClear()
    expect(await wordsIn(new File(['<svg/>'], 'evil.svg', { type: 'image/svg+xml' }))).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  // Any size was read into memory and sent across as text before anything said it was too large.
  it('leaves alone a picture past the largest a camera makes', async () => {
    read.mockClear()
    const huge = new File([new Uint8Array(1)], 'huge.png', { type: 'image/png' })
    Object.defineProperty(huge, 'size', { value: READ_MAX + 1 })
    expect(await wordsIn(huge)).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })
})

