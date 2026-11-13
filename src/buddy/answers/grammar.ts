import type { Answer } from '../search'

/** How sentences go together. */
export const GRAMMAR: Answer[] = [
  {
    id: 'grammar-dangling',
    topic: 'grammar',
    q: 'What is a dangling modifier?',
    also: ['dangling participle', 'misplaced modifier'],
    a: 'A phrase that opens a sentence but belongs to someone the sentence doesn’t name next. “Walking home, the rain started” says the rain was walking.\n\nPut the one doing it straight after the phrase: walking home, she felt the rain start.',
  },
  {
    id: 'grammar-preposition-end',
    topic: 'grammar',
    q: 'Can I end a sentence with a preposition?',
    also: ['ending with a preposition'],
    a: 'Yes. The rule against it was borrowed from Latin and never fitted English. “What are you looking at?” is better than “At what are you looking?” Move it only when the sentence reads better without it at the end.',
  },
  {
    id: 'grammar-split-infinitive',
    topic: 'grammar',
    q: 'Is it wrong to split an infinitive?',
    also: ['split infinitive', 'to boldly go'],
    a: 'No. “To really understand” is good English. Keep the word in the middle when moving it would change the meaning or make the sentence clumsy; move it when it reads as well elsewhere.',
  },
]
