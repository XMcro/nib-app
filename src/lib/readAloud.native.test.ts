import { describe, expect, it, vi } from 'vitest'

/** Read aloud in the Mac app, whose web view has no speech: the app's own voice (NibSpeechPlugin). */

const { plugin, said } = vi.hoisted(() => {
  const said: { text: string; rate: number; answer: (finished: boolean) => void; fail: () => void }[] = []
  const plugin = {
    speak: vi.fn(
      ({ text, rate }: { text: string; rate: number }) =>
        new Promise<{ finished: boolean }>((resolve, reject) => said.push({ text, rate, answer: (finished) => resolve({ finished }), fail: () => reject(new Error('no voice')) })),
    ),
    stop: vi.fn(() => Promise.resolve()),
  }
  return { plugin, said }
})
vi.mock('./platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./platform')>()), nativeApp: true }))
vi.mock('@capacitor/core', async (importOriginal) => ({ ...(await importOriginal<typeof import('@capacitor/core')>()), registerPlugin: () => plugin }))

const { canReadAloud, readAloud } = await import('./readAloud')
const sentences = [
  { text: 'One goes.', from: 1, to: 10 },
  { text: 'Two goes.', from: 11, to: 20 },
]
const settle = () => new Promise((resolve) => setTimeout(resolve))

describe('Read aloud with the app’s voice', () => {
  it('is there, and reads each sentence in turn to the end', async () => {
    expect(typeof speechSynthesis).toBe('undefined')
    expect(canReadAloud).toBe(true)
    said.length = 0
    const onEnd = vi.fn()
    readAloud(sentences, { rate: 1.5, onSentence: () => {}, onEnd })
    said[0].answer(true)
    await settle()
    said[1].answer(true)
    await settle()
    expect(said.map(({ text, rate }) => [text, rate])).toEqual([['One goes.', 1.5], ['Two goes.', 1.5]])
    expect(onEnd).toHaveBeenCalledWith(true)
  })

  it('stops, and the sentence it cut short doesn’t move it on', async () => {
    said.length = 0
    plugin.stop.mockClear()
    const reader = readAloud(sentences, { onSentence: () => {}, onEnd: () => {} })
    reader.stop()
    expect(plugin.stop).toHaveBeenCalled()
    said[0].answer(false)
    await settle()
    expect(said).toHaveLength(1)
  })

  it('lets a new reading take over, the one it cut short going no further', async () => {
    said.length = 0
    readAloud(sentences, { onSentence: () => {}, onEnd: () => {} })
    readAloud([{ text: 'Three goes.', from: 1, to: 12 }], { onSentence: () => {}, onEnd: () => {} })
    said[0].answer(false)
    await settle()
    expect(said.map(({ text }) => text)).toEqual(['One goes.', 'Three goes.'])
  })

  it('ends, saying so, when the voice fails', async () => {
    said.length = 0
    const onEnd = vi.fn()
    readAloud(sentences, { onSentence: () => {}, onEnd })
    said[0].fail()
    await settle()
    expect(onEnd).toHaveBeenCalledWith(false)
  })
})
