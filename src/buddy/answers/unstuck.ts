import type { Answer } from '../search'

/** For when the words won't come. */
export const UNSTUCK: Answer[] = [
  {
    id: 'unstuck-blocked',
    topic: 'unstuck',
    q: 'I’m stuck. What do I do?',
    also: ['writer’s block', 'stuck, can’t write', 'no ideas'],
    a: '- Write the next sentence badly, on purpose. A bad sentence is something to work on, and it often leads to a better one.\n- Skip ahead to a scene you want to write, and come back.\n- Ask what the character wants right now, and what’s in the way.\n- Set a ten-minute sprint and don’t stop typing.\n\nOr ask me for a prompt.',
  },
]
