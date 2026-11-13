import { describe, expect, it } from 'vitest'
import { countCharacters, countWords, describeLength, readingMinutes } from './stats'

describe('countWords', () => {
  it('counts words separated by any whitespace', () => {
    expect(countWords('one two three')).toBe(3)
    expect(countWords('one\ntwo\tthree')).toBe(3)
  })

  it('ignores surrounding and repeated whitespace', () => {
    expect(countWords('   padded   out   ')).toBe(2)
  })

  it('is zero for nothing at all', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n\t ')).toBe(0)
  })

  it('takes every space \\s does, and nothing else', () => {
    for (const space of ['\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u1680', '\u2000', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff']) {
      expect(`a${space}b`.split(/\s+/)).toHaveLength(2)
      expect(countWords(`${space}a${space}b${space}${space}c${space}`)).toBe(3)
    }
    for (const notSpace of ['\u200b', '\u180e', '\u0085']) {
      expect(`a${notSpace}b`.split(/\s+/)).toHaveLength(1)
      expect(countWords(`a${notSpace}b`)).toBe(1)
    }
  })
})

describe('countCharacters', () => {
  it('counts plain characters', () => {
    expect(countCharacters('hello')).toBe(5)
  })

  it('counts an emoji as one character, not two', () => {
    expect(countCharacters('🙂')).toBe(1)
    expect(countCharacters('hi 🙂')).toBe(4)
  })
})

describe('readingMinutes', () => {
  it('is zero only when there are no words', () => {
    expect(readingMinutes(0)).toBe(0)
  })

  it('never rounds a short document down to zero minutes', () => {
    expect(readingMinutes(1)).toBe(1)
    expect(readingMinutes(40)).toBe(1)
  })

  it('rounds to the nearest minute at 200 wpm', () => {
    expect(readingMinutes(200)).toBe(1)
    expect(readingMinutes(500)).toBe(3)
  })
})

describe('describeLength', () => {
  it('says Empty when there is nothing', () => {
    expect(describeLength('  ')).toBe('Empty')
  })

  it('uses the singular for one word', () => {
    expect(describeLength('solo')).toBe('1 word · 1 min')
  })

  it('groups thousands', () => {
    expect(describeLength('word '.repeat(1500))).toBe('1,500 words · 8 min')
  })
})
