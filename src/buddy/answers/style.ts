import type { Answer } from '../search'

/** How writing reads. */
export const STYLE: Answer[] = [
  {
    id: 'style-show-tell',
    topic: 'style',
    q: 'What does show, don’t tell mean?',
    also: ['show don’t tell', 'showing vs telling'],
    a: 'Let the reader see what you’d otherwise name. “She was nervous” tells; “she counted the boats again, and lost count” shows.\n\nTelling isn’t wrong: it moves time along and saves words. Show the moments that matter, and tell the ones in between.',
  },
  {
    id: 'style-adverbs',
    topic: 'style',
    q: 'Should I cut adverbs?',
    also: ['too many adverbs', 'ly words'],
    a: 'Cut the ones that prop up a weak verb: “walked slowly” is often “trudged” or “ambled”. Keep the ones that say something the verb can’t: “she agreed, eventually.” In dialogue tags, “said” alone usually does more than “said angrily”.',
  },
]
