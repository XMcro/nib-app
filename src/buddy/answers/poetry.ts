import type { Answer } from '../search'

/** Forms and how they go. */
export const POETRY: Answer[] = [
  {
    id: 'poetry-haiku',
    topic: 'poetry',
    q: 'How do I write a haiku?',
    also: ['haiku', 'five seven five'],
    a: 'In English, three short lines, often counted as five, seven and five syllables, though many poets use fewer. More than the count, it catches one moment, usually in nature, and sets two images side by side so the reader feels the turn between them.',
  },
  {
    id: 'poetry-sonnet',
    topic: 'poetry',
    q: 'What is a sonnet?',
    also: ['sonnet', 'shakespearean sonnet', 'petrarchan sonnet'],
    a: 'Fourteen lines, usually in iambic pentameter.\n\n- Shakespearean: three quatrains and a couplet, ABAB CDCD EFEF GG, with the turn often at the couplet.\n- Petrarchan: an octave (ABBAABBA) and a sestet (CDECDE or CDCDCD), with the turn between them.',
  },
]
