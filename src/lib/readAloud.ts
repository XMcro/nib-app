import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { JSONContent } from '@tiptap/react'
import { docOf } from '../editor/bookFind'
import { nativeApp } from './platform'

/**
 * Read aloud: the writing read back in the system's voice, a sentence at a
 * time, on the device. It's the web view's own speech (speechSynthesis) where
 * it has it, and the app's on the Mac, where it doesn't: either way the voice
 * chosen in the device's settings for spoken content.
 *
 * And with Nib Plus, in the app, the same voice saved as audio instead
 * (`record`): a document, or a whole book, to proofread by ear away from the
 * screen.
 */

/** A sentence to read, and where it is in the document. */
export type Sentence = { text: string; from: number; to: number }

const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
// A title or short form that a sentence doesn't end at, though the segmenter thinks so.
const SHORT = /(?:^|\s)(?:Mr|Mrs|Ms|Mx|Dr|Prof|St|Mt|vs|e\.g|i\.e)\.\s*$/

/**
 * The sentences between `from` and `to`, a paragraph at a time: headings,
 * list items, quotes and table cells too. Footnotes and pictures aren't read,
 * nor are notes to self, which aren't in the text.
 */
export function sentencesIn(doc: PMNode, from = 0, to = doc.content.size): Sentence[] {
  const found: Sentence[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    const start = pos + 1
    // A space for each footnote or line break, so places in it are places in the document.
    const text = node.textBetween(0, node.content.size, undefined, ' ')
    let open: number | null = null
    for (const { segment, index } of segmenter.segment(text)) {
      const begin: number = open ?? index
      const end = index + segment.length
      open = SHORT.test(segment) && end < text.length ? begin : null
      if (open !== null) continue
      const a = Math.max(start + begin, from)
      const b = Math.min(start + end, to)
      const piece = text.slice(a - start, b - start)
      const words = piece.trim()
      if (a >= b || !/[\p{L}\p{N}]/u.test(words)) continue
      const lead = piece.length - piece.trimStart().length
      found.push({ text: words, from: a + lead, to: a + lead + words.length })
    }
    return false
  })
  return found
}

/**
 * What Read aloud reads: the words selected, or else from the start of the
 * sentence the caret is in to the end. With nothing after the caret, as when
 * the writer has just finished, the whole document. Not what is in `away`:
 * the lines folded out of sight (editor/fold), which are passed over.
 */
export function toRead(doc: PMNode, selection: { from: number; to: number; empty: boolean }, away: { from: number; to: number }[] = []): Sentence[] {
  const showing = (sentences: Sentence[]) => sentences.filter((sentence) => !away.some((gone) => sentence.from >= gone.from && sentence.from < gone.to))
  if (!selection.empty) return showing(sentencesIn(doc, selection.from, selection.to))
  const all = showing(sentencesIn(doc))
  const here = all.findIndex((sentence) => sentence.to > selection.from)
  return here < 0 ? all : all.slice(here)
}

/** How a sentence's speaking ended: read to its end, cut short (paused, stopped), or the voice failed. */
type Spoken = 'end' | 'cut' | 'failed'
type Voice = { speak(text: string, rate: number, then: (how: Spoken) => void): void; cancel(): void }

// Held while it's spoken, or the browser can collect it before it has finished.
const speaking = new Set<SpeechSynthesisUtterance>()
const webVoice: Voice = {
  speak(text, rate, then) {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = rate
    utterance.onend = () => {
      speaking.delete(utterance)
      then('end')
    }
    utterance.onerror = (event) => {
      speaking.delete(utterance)
      then(event.error === 'interrupted' || event.error === 'canceled' ? 'cut' : 'failed')
    }
    speaking.add(utterance)
    speechSynthesis.speak(utterance)
  },
  cancel: () => speechSynthesis.cancel(),
}

const nibSpeech = registerPlugin<{
  speak(options: { text: string; rate: number }): Promise<{ finished: boolean }>
  stop(): Promise<void>
  /** `pieces` as an .m4a named `name` in Caches/exports (lib/exportFile), telling `recording` how far it has got. Answers its place. */
  record(options: { name: string; pieces: Piece[]; rate: number }): Promise<{ path: string }>
  stopRecording(): Promise<void>
  addListener(event: 'recording', listener: (progress: { done: number; of: number }) => void): Promise<PluginListenerHandle>
}>('NibSpeech')
// The Mac's web view has no speech of its own: the app's (ios/App/App/NibSpeechPlugin).
const appVoice: Voice = {
  speak(text, rate, then) {
    nibSpeech.speak({ text, rate }).then(
      ({ finished }) => then(finished ? 'end' : 'cut'),
      () => then('failed'),
    )
  },
  cancel: () => void nibSpeech.stop().catch(() => {}),
}

const voice = (): Voice | null => (typeof speechSynthesis !== 'undefined' ? webVoice : nativeApp ? appVoice : null)

/** Whether this device can read aloud. */
export const canReadAloud = voice() !== null

export type Reader = { pause(): void; resume(): void; stop(): void; setRate(rate: number): void }

/** The speeds the reading bar steps through, slower and faster: 1 is the voice's own. */
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]
const RATE_KEY = 'nib-reading-rate'

/** The speed last chosen on this device. */
export function savedRate(): number {
  try {
    const rate = Number(localStorage.getItem(RATE_KEY))
    return RATES.includes(rate) ? rate : 1
  } catch {
    return 1
  }
}

export function saveRate(rate: number) {
  try {
    localStorage.setItem(RATE_KEY, String(rate))
  } catch {
    // Storage off: the speed holds for this reading.
  }
}

/**
 * Reads the sentences one after another, saying which is being read. Paused,
 * it starts that sentence again on resuming: each is spoken on its own, and
 * cutting one short is the same in every browser where pausing isn't.
 * `onEnd` says whether it read to the end (false: the voice failed).
 */
export function readAloud(
  sentences: Sentence[],
  { rate = 1, onSentence, onEnd }: { rate?: number; onSentence: (index: number) => void; onEnd: (finished: boolean) => void },
): Reader {
  const speech = voice()!
  let index = 0
  let stopped = false
  // The sentence now being spoken: what a cut-short one reports afterwards doesn't count.
  let current: object | null = null

  function end(finished: boolean) {
    stopped = true
    current = null
    onEnd(finished)
  }

  function speak() {
    if (index >= sentences.length) return end(true)
    const turn = {}
    current = turn
    onSentence(index)
    speech.speak(sentences[index].text, rate, (how) => {
      if (current !== turn || how === 'cut') return
      if (how === 'failed') {
        speech.cancel()
        return end(false)
      }
      index += 1
      speak()
    })
  }

  speech.cancel()
  speak()
  return {
    pause() {
      current = null
      speech.cancel()
    },
    resume() {
      if (!stopped && !current) speak()
    },
    stop() {
      stopped = true
      current = null
      speech.cancel()
    },
    // At once: the sentence being read starts again at the new speed.
    setRate(next) {
      rate = next
      if (!current) return
      current = null
      speech.cancel()
      speak()
    },
  }
}

/** What a recording says, in order: a sentence, or a pause in seconds. */
export type Piece = { say: string } | { pause: number }

/** The pause between one document and the next: a breath before the next chapter's title. */
const BETWEEN = 1.5

/**
 * What a recording of `bodies` says: a document, or a book's in order (its
 * title page, each part's name, its chapters), each read as Read aloud reads
 * it, from its first line, its title. All of it, folded or not, with a pause
 * between one and the next.
 */
export function piecesOf(bodies: JSONContent[]): Piece[] {
  const pieces: Piece[] = []
  for (const body of bodies) {
    const said = sentencesIn(docOf(body)).map((sentence) => ({ say: sentence.text }))
    if (said.length === 0) continue
    if (pieces.length > 0) pieces.push({ pause: BETWEEN })
    pieces.push(...said)
  }
  return pieces
}

/** A recording stopped before it was done (stopRecording). */
export class RecordingStopped extends Error {}

/** Another recording was already being made: one at a time. */
export class RecordingBusy extends Error {}

/** Why the Plus sheet opened, when audio was asked for without it. */
export const AUDIO_PLUS = 'Saving your writing as audio, to listen to away from the screen, is part of Nib Plus.'

/**
 * `pieces` as audio in the system's voice, at Read aloud's speed (savedRate):
 * an .m4a named `name`, made by the app (ios/App/App/NibSpeechPlugin) on
 * iPhone, iPad and Mac alike. `onProgress` hears how much is done, 0 to 1.
 * Answers its place, to be handed over (lib/exportFile handOverFile).
 * Stopped, it throws RecordingStopped; with another being made, RecordingBusy.
 */
export async function record(name: string, pieces: Piece[], onProgress?: (done: number) => void): Promise<string> {
  const listening = onProgress ? await nibSpeech.addListener('recording', ({ done, of }) => onProgress(of > 0 ? done / of : 0)) : null
  try {
    const { path } = await nibSpeech.record({ name, pieces, rate: savedRate() })
    return path
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 'stopped') throw new RecordingStopped()
    if (code === 'busy') throw new RecordingBusy()
    throw error
  } finally {
    await listening?.remove()
  }
}

/** Ends the recording being made, if there is one: nothing of it is kept. */
export const stopRecording = (): Promise<void> => nibSpeech.stopRecording().catch(() => {})
