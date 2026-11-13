import type { Answer } from '../search'

/** Words people mix up. */
export const USAGE: Answer[] = [
  {
    id: 'usage-affect-effect',
    topic: 'usage',
    q: 'Affect or effect?',
    also: ['affect vs effect', 'difference between affect and effect'],
    a: 'Mostly, affect is the verb and effect is the noun: the rain affected her mood; the rain had an effect on her mood.\n\nThe exceptions: to effect a change means to bring it about, and affect as a noun is a psychologist’s word for how feeling shows.',
  },
  {
    id: 'usage-its',
    topic: 'usage',
    q: 'Its or it’s?',
    also: ['its vs it’s', 'apostrophe in its'],
    a: 'It’s is short for it is or it has: it’s raining; it’s been a long day. Its is the possessive, with no apostrophe, like his and hers: the boat lost its mast.\n\nA test: if you can say “it is” in its place, write it’s.',
    see: ['punct-apostrophe-plural'],
  },
  {
    id: 'usage-their',
    topic: 'usage',
    q: 'Their, there or they’re?',
    also: ['their vs there vs they’re'],
    a: '- Their belongs to them: their boat.\n- There is a place, or begins a sentence: over there; there is a storm coming.\n- They’re is they are: they’re late.',
  },
  {
    id: 'usage-lie-lay',
    topic: 'usage',
    q: 'Lie or lay?',
    also: ['lie vs lay', 'laid or lain'],
    a: 'Lay takes an object: you lay something down. Lie doesn’t: you lie down.\n\nThe past tenses are the trap. Today I lie down; yesterday I lay down; I have lain down. Today I lay the book down; yesterday I laid it down; I have laid it down.',
  },
  {
    id: 'usage-fewer-less',
    topic: 'usage',
    q: 'Fewer or less?',
    also: ['fewer vs less'],
    a: 'Fewer for things you count, less for things you measure: fewer boats, less water. Money, time and distance usually take less, as amounts: less than ten pounds, less than an hour.',
  },
  {
    id: 'usage-who-whom',
    topic: 'usage',
    q: 'Who or whom?',
    also: ['who vs whom', 'when to use whom'],
    a: 'Who does something; whom has something done to it. Answer the question with he or him: if him fits, whom is right. Who called? He did. To whom did you write? To him.\n\nIn speech and in most fiction dialogue, who is fine everywhere; whom can sound stiff in a character’s mouth.',
  },
  {
    id: 'usage-then-than',
    topic: 'usage',
    q: 'Then or than?',
    also: ['then vs than'],
    a: 'Than compares: taller than her. Then is about time or order: we ate, then we left; if it rains, then we stay.',
  },
]
