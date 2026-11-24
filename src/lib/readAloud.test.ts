import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSchema } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import type { JSONContent } from '@tiptap/react'
import { nibExtensions } from '../editor/extensions'
import { piecesOf, readAloud, sentencesIn, toRead, type Sentence } from './readAloud'

const schema = getSchema(nibExtensions(true))
const run = (text: string): JSONContent => ({ type: 'text', text })
const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const doc = (...content: JSONContent[]) => PMNode.fromJSON(schema, { type: 'doc', content })
const texts = (sentences: Sentence[]) => sentences.map((sentence) => sentence.text)

describe('sentencesIn', () => {
  it('gives each sentence and where it is, a paragraph at a time', () => {
    const page = doc(
      { type: 'heading', attrs: { level: 1 }, content: [run('The crossing')] },
      para(run('The ferry leaves at seven. It takes an hour!')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [para(run('Tickets'))] }] },
    )
    const sentences = sentencesIn(page)
    expect(texts(sentences)).toEqual(['The crossing', 'The ferry leaves at seven.', 'It takes an hour!', 'Tickets'])
    for (const sentence of sentences) expect(page.textBetween(sentence.from, sentence.to)).toBe(sentence.text)
  })

  it('reads past Mr. and Dr., not a footnote, a picture or an empty line', () => {
    const page = doc(
      para(run('Mr. Smith met Dr. Jones'), { type: 'footnote', attrs: { text: 'Pevensie 1950' } }, run(' at the quay.')),
      para(),
      para(run('—')),
      { type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'The quay' } },
    )
    expect(texts(sentencesIn(page))).toEqual(['Mr. Smith met Dr. Jones  at the quay.'])
  })
})

describe('toRead', () => {
  const page = doc(para(run('One goes. Two goes.')), para(run('Three goes.')))
  const at = (pos: number) => toRead(page, { from: pos, to: pos, empty: true })

  it('reads from the start of the sentence the caret is in', () => {
    expect(texts(at(14))).toEqual(['Two goes.', 'Three goes.'])
    // Right after a sentence: the next one.
    expect(texts(at(10))).toEqual(['Two goes.', 'Three goes.'])
  })

  it('reads the whole document from the very end, as when just written', () => {
    expect(texts(at(page.content.size - 1))).toEqual(['One goes.', 'Two goes.', 'Three goes.'])
  })

  it('reads only the words selected', () => {
    expect(texts(toRead(page, { from: 5, to: 15, empty: false }))).toEqual(['goes.', 'Two'])
  })

  it('passes over the lines folded out of sight', () => {
    // The second paragraph, put away.
    const away = [{ from: page.child(0).nodeSize, to: page.content.size }]
    expect(texts(toRead(page, { from: 1, to: 1, empty: true }, away))).toEqual(['One goes.', 'Two goes.'])
    expect(texts(toRead(page, { from: 0, to: page.content.size, empty: false }, away))).toEqual(['One goes.', 'Two goes.'])
    // All of it put away: nothing to read.
    expect(toRead(page, { from: 1, to: 1, empty: true }, [{ from: 0, to: page.content.size }])).toEqual([])
  })
})

/** The browser's voice, as far as Read aloud uses it: a cancelled utterance still reports, as Safari's does. */
class Utterance {
  rate = 1
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  text: string
  constructor(text: string) {
    this.text = text
  }
}
function voice() {
  const spoken: Utterance[] = []
  const synth = {
    speak: vi.fn((utterance: Utterance) => void spoken.push(utterance)),
    cancel: vi.fn(() => spoken.at(-1)?.onerror?.({ error: 'canceled' })),
  }
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('speechSynthesis', synth)
  return { spoken, synth, finish: () => spoken.at(-1)!.onend!() }
}

afterEach(() => vi.unstubAllGlobals())

describe('readAloud', () => {
  const sentences = sentencesIn(doc(para(run('One goes. Two goes.'))))

  it('reads each sentence in turn at the speed asked for, saying which, to the end', () => {
    const { spoken, finish } = voice()
    const onSentence = vi.fn()
    const onEnd = vi.fn()
    readAloud(sentences, { rate: 1.25, onSentence, onEnd })
    finish()
    expect(onEnd).not.toHaveBeenCalled()
    finish()
    expect(spoken.map((utterance) => [utterance.text, utterance.rate])).toEqual([['One goes.', 1.25], ['Two goes.', 1.25]])
    expect(onSentence.mock.calls).toEqual([[0], [1]])
    expect(onEnd).toHaveBeenCalledWith(true)
  })

  it('pauses, and starts that sentence again on resuming', () => {
    const { spoken, synth } = voice()
    const reader = readAloud(sentences, { onSentence: () => {}, onEnd: () => {} })
    reader.pause()
    // The paused one's last word, reported late, doesn't move it on.
    spoken[0].onend!()
    expect(synth.speak).toHaveBeenCalledOnce()
    reader.resume()
    expect(spoken.map((utterance) => utterance.text)).toEqual(['One goes.', 'One goes.'])
  })

  it('stops, and reads no more', () => {
    const { spoken, synth } = voice()
    const onEnd = vi.fn()
    const reader = readAloud(sentences, { onSentence: () => {}, onEnd })
    reader.stop()
    spoken[0].onend!()
    reader.resume()
    expect(synth.speak).toHaveBeenCalledOnce()
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('changes speed at once, the sentence being read starting again; paused, on resuming', () => {
    const { spoken } = voice()
    const reader = readAloud(sentences, { onSentence: () => {}, onEnd: () => {} })
    reader.setRate(1.5)
    reader.pause()
    reader.setRate(2)
    expect(spoken.map((utterance) => [utterance.text, utterance.rate])).toEqual([['One goes.', 1], ['One goes.', 1.5]])
    reader.resume()
    expect(spoken.at(-1)!.rate).toBe(2)
  })

  it('ends, saying so, when the voice fails', () => {
    const { spoken } = voice()
    const onEnd = vi.fn()
    readAloud(sentences, { onSentence: () => {}, onEnd })
    spoken[0].onerror!({ error: 'interrupted' })
    expect(onEnd).not.toHaveBeenCalled()
    spoken[0].onerror!({ error: 'synthesis-failed' })
    expect(onEnd).toHaveBeenCalledWith(false)
  })
})

describe('what a recording says', () => {
  const body = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

  it('says a document from its title, every sentence, folded ones too, but not its footnotes', () => {
    const page = body(
      { type: 'heading', attrs: { level: 1, folded: true }, content: [run('Salt and weed')] },
      para(run('The tide came in. She would not go back.'), { type: 'footnote', attrs: { text: 'Her father’s rule.' } }),
    )
    expect(piecesOf([page])).toEqual([{ say: 'Salt and weed' }, { say: 'The tide came in.' }, { say: 'She would not go back.' }])
  })

  it('says a book in order, with a pause before each next one that has words, and none at the start or the end', () => {
    const pieces = piecesOf([
      body({ type: 'heading', attrs: { level: 1 }, content: [run('The Lighthouse')] }, para(run('by Mara Wells'))),
      body(),
      body({ type: 'heading', attrs: { level: 1 }, content: [run('One')] }, para(run('Steps.'))),
      body({ type: 'heading', attrs: { level: 1 }, content: [run('Two')] }),
    ])
    expect(pieces).toEqual([
      { say: 'The Lighthouse' },
      { say: 'by Mara Wells' },
      { pause: 1.5 },
      { say: 'One' },
      { say: 'Steps.' },
      { pause: 1.5 },
      { say: 'Two' },
    ])
  })
})
