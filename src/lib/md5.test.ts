import { describe, expect, it } from 'vitest'
import { md5 } from './md5'

const ascii = (text: string) => new TextEncoder().encode(text)

describe('md5', () => {
  // The test suite from RFC 1321, appendix A.5.
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    [
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      'd174ab98d277d9f5a5611c2c9f419d9f',
    ],
    [
      '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
      '57edf4a22be3c955ac49da2e2107b67a',
    ],
  ])('hashes %j as the RFC does', (text, hex) => {
    expect(md5(ascii(text))).toBe(hex)
  })

  // Padding is where MD5 implementations go wrong: a message of 55 bytes fits
  // its length in the same block, 56 needs a second one. Expected values are
  // from Node's crypto.
  it.each([
    [55, 'ef1772b6dff9a122358552954ad0df65'],
    [56, '3b0c8ac703f828b04c6c197006d17218'],
    [63, 'b06521f39153d618550606be297466d5'],
    [64, '014842d480b571495a4a0363793f7367'],
    [65, 'c743a45e0d2e6a95cb859adae0248435'],
    [119, '8a7bd0732ed6a28ce75f6dabc90e1613'],
    [120, '5f61c0ccad4cac44c75ff505e1f1e537'],
    [1000, 'cabe45dcc9ae5b66ba86600cca6b8ba8'],
  ])('pads a message of %i bytes correctly', (length, hex) => {
    expect(md5(ascii('a'.repeat(length)))).toBe(hex)
  })

  it('hashes bytes, not text', () => {
    const every = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(md5(every)).toBe('e2c865db4162bed963bfaa9ef6ac18f0')
  })
})
