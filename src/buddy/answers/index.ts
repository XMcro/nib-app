import { CLIPPER_OUT } from '../../lib/clipperOut'
import type { Answer } from '../search'
import { GRAMMAR } from './grammar'
import { GRAMMAR_SENTENCES } from './grammar-sentences'
import { GRAMMAR_WORDS } from './grammar-words'
import { NIB } from './nib'
import { NIB_BOOKS } from './nib-books'
import { NIB_DEVICES } from './nib-devices'
import { NIB_ORGANISING } from './nib-organising'
import { NIB_WRITING } from './nib-writing'
import { POETRY } from './poetry'
import { POETRY_CRAFT } from './poetry-craft'
import { PUNCTUATION } from './punctuation'
import { PUNCTUATION_MARKS } from './punctuation-marks'
import { PUNCTUATION_PAUSES } from './punctuation-pauses'
import { PROMPTS_MORE } from './prompts-more'
import { PROMPTS as SEED_PROMPTS } from './prompts'
import { STORY } from './story'
import { STORY_PEOPLE } from './story-people'
import { STORY_SHAPE } from './story-shape'
import { STORY_WORLD } from './story-world'
import { STYLE } from './style'
import { STYLE_SENTENCES } from './style-sentences'
import { STYLE_VOICE } from './style-voice'
import { UNSTUCK } from './unstuck'
import { UNSTUCK_HABITS } from './unstuck-habits'
import { USAGE } from './usage'
import { USAGE_A_C } from './usage-a-c'
import { USAGE_D_L } from './usage-d-l'
import { USAGE_M_Z } from './usage-m-z'

/** Word pairs, in the order of the alphabet, to look through. */
const WORD_PAIRS = [...USAGE, ...USAGE_A_C, ...USAGE_D_L, ...USAGE_M_Z].sort((a, b) => a.q.localeCompare(b.q))

/** Nib Web Clipper's answers, the extension's, and what names them: out of what Inkwell knows till it's in the browsers' stores (lib/clipperOut). */
const CLIPPER = (answer: Answer) => answer.id.startsWith('nib-clipper')
const held = (answers: Answer[]) =>
  CLIPPER_OUT ? answers : answers.filter((answer) => !CLIPPER(answer)).map((answer) => (answer.see?.some((id) => id.startsWith('nib-clipper')) ? { ...answer, see: answer.see.filter((id) => !id.startsWith('nib-clipper')) } : answer))

/** Everything the writing buddy knows, loaded only once it's opened (components/BuddyAsk). */
export const ANSWERS: Answer[] = held([
  ...NIB,
  ...NIB_WRITING,
  ...NIB_ORGANISING,
  ...NIB_BOOKS,
  ...NIB_DEVICES,
  ...WORD_PAIRS,
  ...GRAMMAR,
  ...GRAMMAR_WORDS,
  ...GRAMMAR_SENTENCES,
  ...PUNCTUATION,
  ...PUNCTUATION_PAUSES,
  ...PUNCTUATION_MARKS,
  ...STYLE,
  ...STYLE_SENTENCES,
  ...STYLE_VOICE,
  ...STORY,
  ...STORY_PEOPLE,
  ...STORY_SHAPE,
  ...STORY_WORLD,
  ...POETRY,
  ...POETRY_CRAFT,
  ...UNSTUCK,
  ...UNSTUCK_HABITS,
])

/** Something to write from, when one's asked for. */
export const PROMPTS: string[] = [...SEED_PROMPTS, ...PROMPTS_MORE]
