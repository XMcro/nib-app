import type { Answer } from '../search'

/** Commas, dashes, apostrophes and the rest. */
export const PUNCTUATION: Answer[] = [
  {
    id: 'punct-oxford-comma',
    topic: 'punctuation',
    q: 'Should I use the Oxford comma?',
    also: ['serial comma', 'comma before and in a list'],
    a: 'It’s a choice of style: red, white, and blue, or red, white and blue. Most American book publishers use it, as Chicago does; American newspapers, following AP, mostly don’t, and nor do many British publishers. Use it whenever leaving it out would let a list be misread, and be the same throughout a piece.',
  },
  {
    id: 'punct-semicolon',
    topic: 'punctuation',
    q: 'How do I use a semicolon?',
    also: ['semicolon rules', 'when to use a semicolon'],
    a: 'Two ways:\n\n- Between two sentences close enough to share one: the tide was out; the boats lay on their sides.\n- Between items in a list that already have commas in them: Hull, in Yorkshire; Truro, in Cornwall; and Oban, in Argyll.',
  },
  {
    id: 'punct-dashes',
    topic: 'punctuation',
    q: 'What is the difference between an em dash and an en dash?',
    also: ['em dash vs en dash', 'hyphen vs dash'],
    a: '- A hyphen joins words: well-known.\n- An en dash (–) shows a range: 1990–1995, pages 4–9.\n- An em dash (—) sets off a break in the sentence—like this—or an interruption.\n\nBritish style often uses a spaced en dash – like this – where American style uses a closed em dash.',
  },
  {
    id: 'punct-apostrophe-plural',
    topic: 'punctuation',
    q: 'Do plurals take an apostrophe?',
    also: ['apostrophe in plurals', 'grocer’s apostrophe', '1990s or 1990’s'],
    a: 'Almost never. One boat, two boats. The 1990s, not the 1990’s. The one common exception is small letters, which need one to be read: mind your p’s and q’s.\n\nAn apostrophe shows that something belongs (the boat’s sail) or that letters are missing (don’t).',
    see: ['usage-its'],
  },
]
