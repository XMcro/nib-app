import { describe, expect, it } from 'vitest'
import { check, LONG_SENTENCE, RULES, type Rule } from './rules'

const ALL = new Set(RULES.map((rule) => rule.id))
const only = (rule: Rule) => new Set([rule])
/** The flagged text, for one rule. */
const flagged = (text: string, rule: Rule) => check(text, only(rule)).map((flag) => text.slice(flag.from, flag.to))

describe('filler and hedging', () => {
  it('flags filler words and hedges, whole words only, in any case', () => {
    expect(flagged('It was Really very good, I think, and sort of true.', 'filler')).toEqual(['Really', 'very', 'I think', 'sort of'])
  })

  it('leaves words that merely contain them', () => {
    expect(flagged('Justice is quiet; the sorter and Maybelle agree.', 'filler')).toEqual([])
  })

  it('names the phrase alone in its reason, not what comes before it', () => {
    expect(check('It was, really.', only('filler'))[0].reason).toBe('Filler: try it without “really”.')
  })
})

describe('adverbs', () => {
  it('flags -ly adverbs', () => {
    expect(flagged('She ran quickly and spoke softly.', 'adverb')).toEqual(['quickly', 'softly'])
  })

  it('leaves -ly words that aren’t adverbs, and names', () => {
    expect(flagged('My family is friendly, and only Kelly came early on a lovely day.', 'adverb')).toEqual([])
  })

  it('still flags one that starts a sentence', () => {
    expect(flagged('It rained. Suddenly the lamp went out.', 'adverb')).toEqual(['Suddenly'])
  })
})

describe('passive voice', () => {
  it('flags "be" with a participle, regular or irregular, across a word or two', () => {
    expect(flagged('The letter was written. The door is opened. It was not quickly done.', 'passive')).toEqual(['was written', 'is opened', 'was not quickly done'])
  })

  it('leaves "be" with things that aren’t participles', () => {
    expect(flagged('The bed is red. She was hundred years old. He is tall and was indeed happy.', 'passive')).toEqual([])
  })
})

describe('clichés', () => {
  it('flags clichés across spacing and apostrophes', () => {
    expect(flagged('At the end of the  day, it came out of the blue.', 'cliche')).toEqual(['At the end of the  day', 'out of the blue'])
    expect(flagged("She let out a breath she didn't know she was holding.", 'cliche')).toEqual(["a breath she didn't know she was holding"])
  })
})

describe('repeats', () => {
  it(`flags a word used again within about 20 words, but not common ones`, () => {
    expect(flagged('The harbour was quiet, and the harbour lights were out. The the the.', 'repeat')).toEqual(['harbour'])
  })

  it('lets a word come back once it’s far enough away', () => {
    const far = `The harbour ${'and so on '.repeat(8)}then the harbour again.`
    expect(flagged(far, 'repeat')).toEqual([])
  })
})

describe('long sentences', () => {
  it(`flags a sentence over ${LONG_SENTENCE} words, as a whole`, () => {
    const long = `${'word '.repeat(LONG_SENTENCE + 1).trim()}.`
    const text = `Short one. ${long} Another short one.`
    expect(flagged(text, 'long')).toEqual([long])
    expect(check(text, only('long'))[0].reason).toBe(`Long sentence: ${LONG_SENTENCE + 1} words. Could it be two?`)
  })

  it(`leaves one of exactly ${LONG_SENTENCE}`, () => {
    expect(flagged(`${'word '.repeat(LONG_SENTENCE).trim()}.`, 'long')).toEqual([])
  })
})

describe('check', () => {
  it('runs only the rules switched on, and gives each flag a reason', () => {
    const text = 'It was very quickly written.'
    expect(check(text, new Set()).length).toBe(0)
    const flags = check(text, ALL)
    expect(new Set(flags.map((flag) => flag.rule))).toEqual(new Set(['filler', 'adverb', 'passive']))
    for (const flag of flags) expect(flag.reason).toMatch(/^[A-Z][^.]*[.:]/)
  })

  it('treats a footnote or picture in the text as a gap between words', () => {
    expect(flagged('very￼quickly', 'adverb')).toEqual(['quickly'])
  })
})

// Every word sliced off and searched all the text before it: a 40,000-word
// paragraph took 1.7 s, and again after each pause in typing.
describe('a long paragraph', () => {
  it('is checked in time that grows with its length, not its square', () => {
    const sentence = 'The keeper climbed the stair and “very quickly” checked the lamp. '
    // The shortest of several: whatever else the machine is doing can only add to a time.
    const time = (times: number) => {
      const text = sentence.repeat(times)
      let shortest = Infinity
      for (let run = 0; run < 7; run++) {
        const started = performance.now()
        check(text, ALL)
        shortest = Math.min(shortest, performance.now() - started)
      }
      return shortest
    }
    time(200) // warm up
    const small = time(1000)
    const large = time(4000) // about 40,000 words
    expect(large).toBeLessThan(small * 8)
  })
})
