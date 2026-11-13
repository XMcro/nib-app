// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The fetch itself is native (ios/App/App/NibPicturePlugin.swift): stood in for here.
const native = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => native }))

const { PICTURE_PROBLEMS, PictureError, asPictureAddress, pictureAt } = await import('./pictureLink')

beforeEach(() => native.fetch.mockReset())

describe('a picture’s address', () => {
  it('is a whole https address, tidied, and nothing else', () => {
    expect(asPictureAddress('  https://example.com/a b.png ')).toBe('https://example.com/a%20b.png')
    expect(asPictureAddress('HTTPS://Example.com')).toBe('https://example.com/')
    for (const odd of ['', 'example.com/a.png', 'http://example.com/a.png', 'file:///etc/hosts', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'https://', 'capacitor://localhost/x.png']) {
      expect(asPictureAddress(odd), odd).toBeNull()
    }
  })
})

describe('the picture at an address', () => {
  it('comes back as a file would, of the kind the answer said, with its bytes as they were', async () => {
    native.fetch.mockResolvedValue({ data: btoa('\u0089PNG\u0000ÿ'), type: 'image/png' })
    const blob = await pictureAt(' https://example.com/a.png ')
    expect(native.fetch).toHaveBeenCalledWith({ url: 'https://example.com/a.png' })
    expect(blob.type).toBe('image/png')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
  })

  it('isn’t asked for at an address that isn’t https', async () => {
    await expect(pictureAt('http://example.com/a.png')).rejects.toMatchObject({ problem: 'address', message: PICTURE_PROBLEMS.address })
    expect(native.fetch).not.toHaveBeenCalled()
  })

  // Each stand-in for one call only: one that throws, left in place when its test ends, fails that test here.
  it('says why none came, in the plugin’s own terms, and “couldn’t” for anything else', async () => {
    for (const problem of ['address', 'kind', 'size', 'failed'] as const) {
      native.fetch.mockImplementationOnce(async () => {
        throw Object.assign(new Error('native'), { code: problem })
      })
      const error = await pictureAt('https://example.com/a.png').catch((thrown: unknown) => thrown)
      expect(error).toBeInstanceOf(PictureError)
      expect((error as InstanceType<typeof PictureError>).problem).toBe(problem)
    }
    for (const odd of [new Error('offline'), Object.assign(new Error('x'), { code: 'UNIMPLEMENTED' }), Object.assign(new Error('y'), { code: 7 })]) {
      native.fetch.mockImplementationOnce(async () => {
        throw odd
      })
      const error = await pictureAt('https://example.com/a.png').catch((thrown: unknown) => thrown)
      expect((error as InstanceType<typeof PictureError>).problem).toBe('failed')
    }
  })
})
