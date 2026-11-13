import { BE, BETWEEN, CLICHES, COMMON, FILLER, HEDGES, IRREGULAR, NOT_ADVERBS, NOT_PARTICIPLES } from './lists'

/**
 * The style check's rules: pure functions from one paragraph's text to the
 * ranges worth a second look, each with a one-line reason. Offsets are into
 * the text as given. Suggestions, never corrections: nothing here changes a
 * word.
 */

export type Rule = 'filler' | 'adverb' | 'passive' | 'cliche' | 'repeat' | 'long'
type Flag = { from: number; to: number; rule: Rule; reason: string }

export const RULES: { id: Rule; label: string }[] = [
  { id: 'filler', label: 'Filler and hedging' },
  { id: 'adverb', label: 'Adverbs ending in -ly' },
  { id: 'passive', label: 'Passive voice' },
  { id: 'cliche', label: 'Clichés' },
  { id: 'repeat', label: 'Words repeated close together' },
  { id: 'long', label: 'Long sentences' },
]

export const LONG_SENTENCE = 35
const REPEAT_WINDOW = 20

type Word = { text: string; lower: string; from: number; to: number; sentenceStart: boolean }

// Letters, with apostrophes inside: "didn’t" is one word.
const WORD = /\p{L}+(?:['’]\p{L}+)*/gu
// What may stand between a sentence's end and its first word.
const OPENING = /["'“”‘’()[\]\s]/u

function words(text: string): Word[] {
  const found: Word[] = []
  for (const match of text.matchAll(WORD)) {
    // Back over quotes, brackets and space to what came before: only as far
    // as the gap between words. Slicing off and searching all the text before
    // every word made a 40,000-word paragraph take 1.7 s.
    let before = match.index - 1
    while (before >= 0 && OPENING.test(text[before])) before--
    found.push({
      text: match[0],
      lower: match[0].toLowerCase().replace(/'/g, '’'),
      from: match.index,
      to: match.index + match[0].length,
      sentenceStart: before < 0 || /[.!?…:]/.test(text[before]),
    })
  }
  return found
}

/**
 * One pattern for a list of phrases, matched whole and in any case, with any
 * spacing. What's before a phrase is the first group, matched and not looked
 * behind at: iOS before 16.4 can't read a lookbehind, and one anywhere in the
 * script stops the whole app loading. Every phrase ends in a letter, so what's
 * before one is never the end of the phrase before it.
 */
function phrases(list: string[]): RegExp {
  const escaped = [...list]
    .sort((a, b) => b.length - a.length)
    .map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+').replace(/’/g, "['’]"))
  return new RegExp(`(^|[^\\p{L}])(${escaped.join('|')})(?!\\p{L})`, 'giu')
}

const FILLER_PATTERN = phrases(FILLER)
const HEDGE_PATTERN = phrases(HEDGES)
const CLICHE_PATTERN = phrases(CLICHES)

function matches(text: string, pattern: RegExp, rule: Rule, reason: (found: string) => string): Flag[] {
  return [...text.matchAll(pattern)].map((match) => {
    const from = match.index + match[1].length
    return { from, to: from + match[2].length, rule, reason: reason(match[2]) }
  })
}

function adverbs(list: Word[]): Flag[] {
  return list
    .filter((word) => word.lower.length >= 5 && word.lower.endsWith('ly') && !NOT_ADVERBS.has(word.lower))
    // A capital mid-sentence is a name: Kelly, Emily.
    .filter((word) => word.sentenceStart || word.text[0] === word.text[0].toLowerCase())
    .map((word) => ({ from: word.from, to: word.to, rule: 'adverb' as const, reason: `Adverb: a stronger verb might do the work of “${word.text}”.` }))
}

const participle = (word: Word) =>
  IRREGULAR.has(word.lower) || (word.lower.length > 4 && word.lower.endsWith('ed') && !NOT_PARTICIPLES.has(word.lower))

function passives(list: Word[]): Flag[] {
  const flags: Flag[] = []
  for (let i = 0; i < list.length; i++) {
    if (!BE.has(list[i].lower)) continue
    // Up to two words between: "was not quickly written".
    for (let j = i + 1; j <= i + 3 && j < list.length; j++) {
      const word = list[j]
      if (participle(word)) {
        flags.push({ from: list[i].from, to: word.to, rule: 'passive', reason: 'Passive voice: saying who did it is often stronger.' })
        i = j
        break
      }
      if (!BETWEEN.has(word.lower) && !(word.lower.endsWith('ly') && word.lower.length >= 4)) break
    }
  }
  return flags
}

function repeats(list: Word[]): Flag[] {
  const flags: Flag[] = []
  const seen = new Map<string, number>()
  list.forEach((word, index) => {
    if (word.lower.length < 4 || COMMON.has(word.lower)) return
    const last = seen.get(word.lower)
    if (last !== undefined && index - last <= REPEAT_WINDOW) {
      flags.push({ from: word.from, to: word.to, rule: 'repeat', reason: `Repeated: “${word.text}” is used just before.` })
    }
    seen.set(word.lower, index)
  })
  return flags
}

function longSentences(text: string): Flag[] {
  const flags: Flag[] = []
  for (const match of text.matchAll(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/gu)) {
    const count = match[0].match(WORD)?.length ?? 0
    if (count <= LONG_SENTENCE) continue
    const lead = match[0].length - match[0].trimStart().length
    const from = match.index + lead
    flags.push({ from, to: from + match[0].trim().length, rule: 'long', reason: `Long sentence: ${count} words. Could it be two?` })
  }
  return flags
}

/** Every flag in one paragraph's text, for the rules switched on. */
export function check(text: string, rules: ReadonlySet<Rule>): Flag[] {
  const list = rules.has('adverb') || rules.has('passive') || rules.has('repeat') ? words(text) : []
  const flags: Flag[] = []
  if (rules.has('filler')) {
    flags.push(...matches(text, FILLER_PATTERN, 'filler', (found) => `Filler: try it without “${found}”.`))
    flags.push(...matches(text, HEDGE_PATTERN, 'filler', (found) => `Hedging: “${found}” softens what you mean.`))
  }
  if (rules.has('adverb')) flags.push(...adverbs(list))
  if (rules.has('passive')) flags.push(...passives(list))
  if (rules.has('cliche')) flags.push(...matches(text, CLICHE_PATTERN, 'cliche', (found) => `Cliché: “${found}”. Say it your own way.`))
  if (rules.has('repeat')) flags.push(...repeats(list))
  if (rules.has('long')) flags.push(...longSentences(text))
  return flags.sort((a, b) => a.from - b.from || b.to - a.to)
}
