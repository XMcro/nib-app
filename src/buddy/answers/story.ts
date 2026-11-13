import type { Answer } from '../search'

/** How stories are built. */
export const STORY: Answer[] = [
  {
    id: 'story-three-acts',
    topic: 'story',
    q: 'What is three-act structure?',
    also: ['three act structure', 'beginning middle end', 'story structure'],
    a: '- Act one sets up a person, what they want, and what stops them, and ends when they can’t go back.\n- Act two raises the cost: they try, fail, learn and are pushed to the worst point.\n- Act three is the last attempt, and what it costs them.\n\nRoughly a quarter, a half and a quarter of the story. It describes what many stories do; it isn’t a rule.',
  },
  {
    id: 'story-pov',
    topic: 'story',
    q: 'Should I write in first or third person?',
    also: ['point of view', 'first person vs third person', 'pov'],
    a: 'First person (I) gives you one voice and closeness, but only what that person knows. Close third (she) gives nearly the same closeness, and lets you move to another character between scenes. Try a page of each: whichever sounds like the story usually is.',
  },
]
