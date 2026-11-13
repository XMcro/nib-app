/**
 * What the writing buddy knows (components/BuddyAsk), and how a question finds
 * it: written answers, kept in the app and searched on the device. No AI, and
 * nothing asked leaves the device. A question is cut to its words, each to
 * its stem, words that mean the same thing taken as one, and the words that
 * say nothing ("how", "do", "the") left out, unless it sets them side by
 * side ("which or that"); each answer is scored by how
 * rare and how well placed the words it shares are, a match in the question
 * itself counting most, and by how many of them it has.
 */

export type Topic = 'nib' | 'grammar' | 'punctuation' | 'usage' | 'style' | 'story' | 'poetry' | 'unstuck'

/** `q`: the question, as the list and the heading show it. `also`: other ways it's asked. `a`: the answer, its paragraphs apart by a blank line, a line starting "- " a point in a list. `see`: answers to offer after it, by id. */
export type Answer = { id: string; topic: Topic; q: string; also?: string[]; a: string; see?: string[] }

export const TOPICS: { topic: Topic; name: string }[] = [
  { topic: 'nib', name: 'Using Nib' },
  { topic: 'grammar', name: 'Grammar' },
  { topic: 'punctuation', name: 'Punctuation' },
  { topic: 'usage', name: 'Word pairs' },
  { topic: 'style', name: 'Style' },
  { topic: 'story', name: 'Story' },
  { topic: 'poetry', name: 'Poetry' },
  { topic: 'unstuck', name: 'Getting unstuck' },
]

/** Words that say nothing about what's asked. Not its, their, then, who and the like: word pairs are asked about them. */
const QUIET = new Set(
  'a an the i me my mine do does did doing done how what whats when where which why can cant will is are was were be been being to of in on for with it this that these those here and or but you your yours about get got make made use using way ways some any into from at by as if so them they we our ours us one just want wanted need needed please know let lets am very really thing things go going help vs versus difference between'.split(' '),
)

/** Of those, the small words a word pair is about (which or that, I or me, a or an, into or in to): they count in a question that sets words side by side. */
const SMALL = new Set('a an i me which that what can will in on to of into onto were where your you we us any some one as been being lets'.split(' '))
/** A question setting words side by side: this or that, this vs that, between you and me. */
const SIDE_BY_SIDE = /\b(or|vs|versus|between)\b/i

/** Words taken as one, to the first of each group. */
// Not notes and pages, which are two things in Nib; nor rename and replace, or hide and lock, which are asked of other things.
const SAME: string[][] = [
  ['delete', 'remove', 'trash', 'erase', 'bin', 'discard'],
  ['lock', 'vault', 'password', 'passcode', 'secret', 'private', 'protect'],
  ['folder', 'directory'],
  ['export', 'download', 'convert'],
  ['sync', 'device'],
  ['colour', 'color'],
  ['find', 'search', 'locate'],
  ['replace', 'swap', 'substitute'],
  ['book', 'manuscript', 'novel'],
  ['goal', 'target', 'aim'],
  ['price', 'cost', 'much'],
  ['stuck', 'block', 'unstuck', 'motivation', 'inspiration'],
  ['apostrophe', 'possessive'],
  // Not cut to “clich” as “churches” is to “church”.
  ['cliche', 'cliches'],
  ['feedback', 'criticism', 'critique'],
]
const CANON = new Map(SAME.flatMap((group) => group.map((word) => [word, group[0]] as const)))

/** A word cut to its stem, as both questions and answers are: "locking", "locked", "locks" all "lock". */
export function stem(word: string): string {
  if (word.length <= 3) return word
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`
  if (word.endsWith('ing') && word.length > 5) return restore(word.slice(0, -3))
  if (word.endsWith('ed') && word.length > 4) return restore(word.slice(0, -2))
  if (word.endsWith('ly') && word.length > 4) return word.slice(0, -2)
  if (/(sses|shes|ches|xes)$/.test(word)) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1)
  return word
}

/** A short stem its -ing or -ed took an e from, given it back: “writing” as “write”, “shared” as “share”, “hiding” as “hide”; not “editing” or “waited”. */
function restore(rest: string): string {
  return /^[^aeiouy]+[aeiouy][^aeiouwxy]$/.test(rest) ? `${rest}e` : rest
}

/** A question's or an answer's words, each as it's matched: "it’s" as "its", "writer’s" as "writer"; with `small`, the small words too. */
export function wordsOf(text: string, small = false): string[] {
  const words = text
    .toLowerCase()
    // “Cliché” as “cliche”, “naïve” as “naive”.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’‘]/g, '')
    .match(/[a-z0-9]+/g)
  return (words ?? []).filter((word) => !QUIET.has(word) || (small && SMALL.has(word))).map((word) => CANON.get(word) ?? CANON.get(stem(word)) ?? stem(word))
}

type Indexed = { answer: Answer; fields: { weight: number; counts: Map<string, number> }[] }

/** How much a word counts in each part of an answer: the question most, then the other ways it's asked, then the answer. */
const WEIGHTS = { q: 3, also: 2.5, a: 1 }

export type Knowledge = { answers: Answer[]; byId: Map<string, Answer>; indexed: Indexed[]; rarity: Map<string, number>; vocabulary: string[] }

const counted = (words: string[]) => words.reduce((counts, word) => counts.set(word, (counts.get(word) ?? 0) + 1), new Map<string, number>())

/** Every answer made ready to search, once, as the buddy opens. */
export function know(answers: Answer[]): Knowledge {
  const indexed = answers.map((answer) => ({
    answer,
    fields: [
      { weight: WEIGHTS.q, counts: counted(wordsOf(answer.q, true)) },
      { weight: WEIGHTS.also, counts: counted(wordsOf((answer.also ?? []).join(' . '), true)) },
      { weight: WEIGHTS.a, counts: counted(wordsOf(answer.a)) },
    ],
  }))
  const having = new Map<string, number>()
  for (const { fields } of indexed) for (const word of new Set(fields.flatMap((field) => [...field.counts.keys()]))) having.set(word, (having.get(word) ?? 0) + 1)
  const rarity = new Map([...having].map(([word, n]) => [word, Math.log(1 + (answers.length - n + 0.5) / (n + 0.5))]))
  return { answers, byId: new Map(answers.map((answer) => [answer.id, answer])), indexed, rarity, vocabulary: [...having.keys()].filter((word) => !QUIET.has(word)) }
}

/**
 * A question put to Inkwell itself, "who are you", "what's your story": in
 * words too small or too common for the rest to place, or that they'd place
 * elsewhere ("who" with who's and whose, "story" with storey), so its own
 * story (answers/nib) comes first, said here.
 */
const ABOUT_ME = /\b(who|what)\s*(are|r|['’]re)\s*(you|u)\b|\bwhere\s+(do|did)\s+you\s+come\s+from\b|\babout\s+yourself\b|\byour\s+(back)?story\b|\byour\s+name\b|\bwho\s+(made|named)\s+you\b/i
export const MY_STORY = 'nib-inkwell-story'

/** The answers to a question, best first; none for a question it can't place. The last word, still being typed, matches as a beginning too. */
export function ask(knowledge: Knowledge, question: string): Answer[] {
  const story = ABOUT_ME.test(question) ? knowledge.byId.get(MY_STORY) : undefined
  if (story) return [story]
  const main = [...new Set(wordsOf(question))]
  const small = SIDE_BY_SIDE.test(question) ? [...new Set(wordsOf(question, true))].filter((word) => !main.includes(word)) : []
  // A question of small words alone ("which or that") is asked by them; with other words, they only count where they're found.
  const words = main.length > 0 ? main : small
  const extra = main.length > 0 ? small : []
  if (words.length === 0) return []
  const typing = question.match(/[a-z0-9]+$/i)?.[0]?.toLowerCase()
  const last = words.at(-1)!
  const sought = words.map((word) => (word === last && typing && typing.length >= 3 && !knowledge.rarity.has(word) ? knowledge.vocabulary.filter((known) => known.startsWith(typing)).slice(0, 8) : [word]))
  const weigh = (word: string, fields: Indexed['fields']) =>
    (knowledge.rarity.get(word) ?? 0) *
    fields.reduce((sum, { weight, counts }) => {
      const n = counts.get(word) ?? 0
      return sum + (weight * n) / (n + 1)
    }, 0)
  const scored = knowledge.indexed.map(({ answer, fields }) => {
    let score = 0
    let matched = 0
    for (const forms of sought) {
      const best = Math.max(...forms.map((word) => weigh(word, fields)), 0)
      if (best > 0) matched += 1
      score += best
    }
    let found = 0
    for (const word of extra) {
      const here = weigh(word, fields)
      if (here > 0) found += 1
      score += here
    }
    // Most of what was asked, not one word of it.
    return { answer, score: score * ((matched + found) / (sought.length + found)) ** 2, matched }
  })
  const kept = scored.filter(({ matched, score }) => score > 0 && matched / sought.length >= 0.5).sort((a, b) => b.score - a.score)
  // Not those far behind the best: one word of the question in passing isn't an answer to it.
  return kept.filter(({ score }) => score >= kept[0]?.score * NEAR).map(({ answer }) => answer)
}

/** How near the best an answer has to score to be offered with it. */
const NEAR = 0.3

/** What to offer after an answer: those it names, then the next best for the question, three at most. */
export function related(knowledge: Knowledge, shown: Answer, found: Answer[] = []): Answer[] {
  const named = (shown.see ?? []).flatMap((id) => knowledge.byId.get(id) ?? [])
  const rest = found.filter((answer) => answer !== shown && !named.includes(answer))
  return [...named, ...rest].slice(0, 3)
}
