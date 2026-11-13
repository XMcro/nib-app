import { describe, expect, it } from 'vitest'
import { ANSWERS, PROMPTS } from './answers'
import { ask, know, related, stem, TOPICS, wordsOf, type Answer } from './search'

const knowledge = know(ANSWERS)
const first = (question: string) => ask(knowledge, question)[0]?.id

describe('a question’s words', () => {
  it('lose the words that say nothing, come down to their stems, and are one with words that mean the same', () => {
    expect(wordsOf('How do I remove the password from my notes?')).toEqual(['delete', 'lock', 'note'])
    expect(wordsOf('Locking, locked, locks')).toEqual(['lock', 'lock', 'lock'])
    expect(wordsOf('A writer’s block')).toEqual(['writer', 'stuck'])
    expect(wordsOf('criticism or critique')).toEqual(['feedback', 'feedback'])
    // Not the small words word pairs are about.
    expect(wordsOf('it’s, its, their, there or they’re')).toEqual(['its', 'its', 'their', 'there', 'theyre'])
    expect(wordsOf('Cliché, naïve, rôle')).toEqual(wordsOf('cliche, naive, role'))
    // An e an ending took, given back to a short stem: not to a longer one, nor one that never had it.
    expect([stem('writing'), stem('shared'), stem('hiding'), stem('noted')]).toEqual([stem('write'), stem('share'), stem('hide'), stem('note')])
    expect([stem('editing'), stem('waited'), stem('fixing')]).toEqual(['edit', 'wait', 'fix'])
    expect(stem('stories')).toBe('story')
    expect(stem('bus')).toBe('bus')
  })
})

describe('asking', () => {
  it('finds the answer however it’s put', () => {
    expect(first('how do i lock a note')).toBe('nib-lock')
    expect(first('Can I password protect a page?')).toBe('nib-lock')
    expect(first('take a note out of the vault')).toBe('nib-unlock')
    expect(first('affect vs effect')).toBe('usage-affect-effect')
    expect(first('when do I use a semicolon')).toBe('punct-semicolon')
    expect(first('its or it’s')).toBe('usage-its')
    expect(first('who or whom')).toBe('usage-who-whom')
    expect(first('their or there')).toBe('usage-their')
    expect(first('oxford comma')).toBe('punct-oxford-comma')
    expect(first('I have writer’s block')).toBe('unstuck-blocked')
    expect(first('rename a character in every chapter of my book')).toBe('nib-book-find')
    expect(first('haiku')).toBe('poetry-haiku')
    expect(first('send my novel to an agent')).toBe('nib-manuscript-format')
    // Everyday ones, as they'd be typed.
    expect(first('how do i make a new folder')).toBe('nib-folder-new')
    expect(first('export to word')).toBe('nib-export-word')
    expect(first('my notes disappeared')).toBe('nib-missing-note')
    expect(first('sync my iphone and mac')).toBe('nib-sync-on')
    expect(first('make the text bigger')).toBe('nib-text-size')
    expect(first('share with my editor')).toBe('nib-share-draft')
    expect(first('how much is plus')).toBe('nib-plus-buy')
    expect(first('how many words is my book')).toBe('nib-book-length')
    expect(first('could of')).toBe('usage-could-have-could-of')
    expect(first('quotation marks inside or outside')).toBe('punct-full-stop-quotes')
    expect(first('how do I punctuate dialogue')).toBe('punct-dialogue')
    expect(first('is it ok to start a sentence with and')).toBe('grammar-and-but')
    expect(first('possessive of james')).toBe('punct-name-ending-s')
    expect(first('past perfect in a flashback')).toBe('grammar-flashback')
    // Word pairs of small words, set side by side.
    expect(first('which or that')).toBe('usage-that-which')
    expect(first('what or which')).toBe('usage-what-which')
    expect(first('who or that')).toBe('usage-that-who')
    expect(first('I or me')).toBe('usage-i-me')
    expect(first('between you and I')).toBe('usage-i-me')
    expect(first('a or an')).toBe('usage-a-an')
    expect(first('into or in to')).toBe('usage-in-to-into')
    expect(first('we’re or were')).toBe('usage-were-where')
    expect(first('lets or let’s')).toBe('usage-lets')
    expect(first('been or being')).toBe('usage-been-being')
    // The craft, as it'd be typed.
    expect(first('show don’t tell')).toBe('style-show-tell')
    expect(first('how do I write a villain')).toBe('story-villain')
    expect(first('my middle is boring')).toBe('story-middle-sag')
    expect(first('kill your darlings')).toBe('style-darlings')
    expect(first('unreliable narrator')).toBe('story-unreliable')
    expect(first('iambic pentameter')).toBe('poetry-pentameter')
    expect(first('what rhymes with orange')).toBe('poetry-rhyme-find')
    expect(first('how do I start writing a poem')).toBe('poetry-start')
    expect(first('how do I take criticism')).toBe('style-feedback-take')
    expect(first('i have no time to write')).toBe('unstuck-job')
    expect(first('how do I write a condolence note')).toBe('style-condolence')
  })

  // Inkwell's story (asked for 2026-11-13): asked of Inkwell itself, in words the rest can't place, or would place elsewhere.
  it('tells its own story when asked who it is, and only then', () => {
    for (const question of ['Who are you?', 'who r u', 'What are you?', 'Where do you come from?', 'What’s your story?', "what's your backstory", 'Tell me about yourself', 'What’s your name?', 'Who made you?']) {
      expect(first(question), question).toBe('nib-inkwell-story')
    }
    expect(first('What is a story?')).not.toBe('nib-inkwell-story')
    expect(first('who or whom')).not.toBe('nib-inkwell-story')
    expect(first('how do I write a backstory')).not.toBe('nib-inkwell-story')
    expect(first('how do I tell my story')).not.toBe('nib-inkwell-story')
  })

  it('finds by the beginning of the word still being typed', () => {
    expect(first('semic')).toBe('punct-semicolon')
    expect(first('how do I use a semic')).toBe('punct-semicolon')
  })

  it('finds nothing for what it doesn’t know, nor for words that say nothing', () => {
    expect(ask(knowledge, 'banana smoothie recipe')).toEqual([])
    expect(ask(knowledge, 'how do I')).toEqual([])
    expect(ask(knowledge, '')).toEqual([])
  })
})

/**
 * How answers are weighed, on a few made up for it: so what the bank holds,
 * and how its answers are worded, can't change these, nor these how it's written.
 */
describe('weighing answers', () => {
  const answer = (id: string, q: string, a: string, see?: string[]): Answer => ({ id, topic: 'nib', q, a, see })
  const made = know([
    // First, so a tie would put it first: it has "start" only in its text.
    answer('template', 'How do I make a template?', 'Begin with any note, and start from it whenever you like.'),
    answer('folder', 'Can a folder start from a template?', 'Choose one for it in Edit.'),
    answer('both', 'Where do I pick a look?', 'Open Customize, then choose a look.'),
    answer('then', 'Then or than?', 'Than compares, and that is all.'),
    answer('lock', 'How do I lock a note?', 'Use the vault.', ['apart']),
    answer('unlock', 'How do I unlock a note?', 'Open the vault.'),
    answer('mention', 'Where are my notes kept?', 'On this device, every note of them.'),
    answer('apart', 'What is a passcode?', 'Four digits or more.'),
    answer('haiku', 'How do I write a haiku?', 'Three lines.'),
    answer('who-whom', 'Who or whom?', 'Whom has something done to it.'),
    answer('who-that', 'Who or that?', 'For people.'),
    answer('which', 'Which or that?', 'That defines.'),
    answer('a-an', 'A or an?', 'By the sound.'),
  ])
  const ids = (found: Answer[]) => found.map((one) => one.id)

  it('counts a word in an answer’s question over one in its text', () => {
    expect(ids(ask(made, 'start'))[0]).toBe('folder')
  })

  it('counts most of what was asked over one word of it, however rare', () => {
    expect(ids(ask(made, 'then choose'))[0]).toBe('both')
  })

  it('needs at least half the question’s words', () => {
    expect(ask(made, 'banana smoothie haiku recipe')).toEqual([])
    expect(ids(ask(made, 'haiku recipe'))).toEqual(['haiku'])
  })

  it('reads the small words a word pair is about, in a question that sets them side by side', () => {
    expect(ids(ask(made, 'which or that'))).toEqual(['which'])
    expect(ids(ask(made, 'a or an'))[0]).toBe('a-an')
    expect(ids(ask(made, 'who or that'))[0]).toBe('who-that')
    expect(ids(ask(made, 'who or whom'))[0]).toBe('who-whom')
    // Not otherwise: these say nothing yet.
    expect(ask(made, 'how do I')).toEqual([])
    expect(ask(made, 'which one')).toEqual([])
  })

  it('offers next what an answer names, then those near the best, not those sharing a word in passing', () => {
    const found = ask(made, 'how do I lock a note')
    expect(ids(found)[0]).toBe('lock')
    expect(ids(found)).not.toContain('mention')
    const next = related(made, found[0], found)
    expect(ids(next)).toEqual(['apart', 'unlock'])
    expect(ids(ask(made, 'lock note'))).not.toContain('apart')
  })
})

describe('what the buddy knows', () => {
  it('has each answer once, every one it names, and something under every topic', () => {
    const ids = ANSWERS.map((answer) => answer.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const answer of ANSWERS) for (const id of answer.see ?? []) expect(knowledge.byId.has(id), `${answer.id} names ${id}`).toBe(true)
    for (const { topic } of TOPICS) expect(ANSWERS.some((answer) => answer.topic === topic), topic).toBe(true)
    expect(PROMPTS.length).toBeGreaterThan(0)
    expect(new Set(PROMPTS).size).toBe(PROMPTS.length)
  })

  it('finds each answer first by its own question, and near the top by each other way it’s asked', () => {
    for (const answer of ANSWERS) {
      expect(first(answer.q), answer.q).toBe(answer.id)
      for (const also of answer.also ?? []) expect(ask(knowledge, also).slice(0, 3).map((one) => one.id), `${answer.id}: ${also}`).toContain(answer.id)
    }
    // Every question in the bank, some seven thousand: a couple of seconds alone, longer beside the rest of the suite.
  }, 60_000)

  it('is written as Nib writes: curly apostrophes and quotes, no straight ones', () => {
    for (const answer of ANSWERS) for (const text of [answer.q, answer.a, ...(answer.also ?? [])]) expect(text, answer.id).not.toMatch(/['"]/)
    for (const prompt of PROMPTS) expect(prompt).not.toMatch(/['"]/)
  })
})
