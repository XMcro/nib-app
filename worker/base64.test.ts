import { describe, expect, it } from 'vitest'
import { isBase64 } from './base64'

/** As the pattern it replaced read it, which threw on long strings: groups of four, the last padded or not. */
const AS_BEFORE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

describe('isBase64', () => {
  it('says of every short string what the pattern it replaced said', () => {
    const ALPHABET = ['A', 'z', '0', '+', '/', '=', '-', '_', ' ', 'é']
    // Every string of these up to five long, and some longer.
    let all = ['']
    const tried = ['']
    for (let length = 1; length <= 5; length++) {
      all = all.flatMap((text) => ALPHABET.map((char) => text + char))
      tried.push(...all)
    }
    tried.push('QUJD'.repeat(9), `${'QUJD'.repeat(9)}QQ==`, `${'QUJD'.repeat(9)}QUI=`, `${'QUJD'.repeat(9)}Q===`, `QQ==${'QUJD'.repeat(9)}`, `${'QUJD'.repeat(9)}\n`)
    const differing = tried.filter((text) => isBase64(text) !== AS_BEFORE.test(text))
    expect(tried.length).toBeGreaterThan(100_000)
    expect(differing).toEqual([])
  })

  it('answers for sixteen million characters, well formed or not, where that pattern threw', () => {
    const long = 'QUJD'.repeat(4_000_000)
    expect(() => AS_BEFORE.test(long)).toThrow(RangeError)
    expect(isBase64(long)).toBe(true)
    expect(isBase64(`${long.slice(0, -2)}==`)).toBe(true)
    expect(isBase64(`${long}A`)).toBe(false)
    expect(isBase64(`${long.slice(0, 8_000_000)}=${long.slice(8_000_001)}`)).toBe(false)
    expect(isBase64(`${long}é`)).toBe(false)
  })
})
