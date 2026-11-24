// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Web Audio as far as the player uses it: what was made, started, faded and stopped. */
class Param {
  targets: number[][] = []
  value: number
  constructor(value: number) {
    this.value = value
  }
  setTargetAtTime(value: number, at: number, constant: number) {
    this.targets.push([value, at, constant])
    this.value = value
  }
}
class Node {
  connect<T>(next: T): T {
    return next
  }
}
class Gain extends Node {
  gain: Param
  constructor(_context: unknown, options?: { gain?: number }) {
    super()
    this.gain = new Param(options?.gain ?? 1)
    gains.push(this)
  }
}
class Source extends Node {
  buffer?: { url: string }
  loop = false
  loopStart = 0
  loopEnd = 0
  playbackRate = new Param(1)
  started?: number[]
  stopped?: number
  constructor(_context: unknown, options: object) {
    super()
    Object.assign(this, options)
    sources.push(this)
  }
  start(...at: number[]) {
    this.started = at
  }
  stop(at: number) {
    this.stopped = at
  }
}
class Context {
  currentTime = 10
  destination = new Node()
  resume = vi.fn(async () => undefined)
  suspend = vi.fn(async () => undefined)
  decodeAudioData = vi.fn(async (bytes: { url: string }) => ({ url: bytes.url }))
  constructor() {
    contexts.push(this)
  }
}

let gains: Gain[]
let sources: Source[]
let contexts: Context[]
let refused: Set<string>
const fetched = vi.fn()
let audioSession: { type: string }

async function player() {
  vi.resetModules()
  return import('./focusSounds')
}

/** The source playing this file, and its volume. */
const playingOf = (url: string) => {
  const at = sources.findIndex((one) => one.buffer?.url === url)
  return { source: sources[at], gain: gains[at] }
}

const editor = () => {
  const page = document.createElement('div')
  page.className = 'ProseMirror'
  page.setAttribute('contenteditable', 'true')
  page.innerHTML = '<p>Once</p>'
  document.body.append(page)
  return page.querySelector('p')!
}

const pressed = (target: EventTarget, key: string, more: Partial<KeyboardEvent> = {}) => ({ key, metaKey: false, ctrlKey: false, isComposing: false, repeat: false, target, ...more })

beforeEach(() => {
  gains = []
  sources = []
  contexts = []
  refused = new Set()
  fetched.mockReset()
  audioSession = { type: 'auto' }
  Object.defineProperty(navigator, 'audioSession', { value: audioSession, configurable: true })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  vi.stubGlobal('AudioContext', Context)
  vi.stubGlobal('GainNode', Gain)
  vi.stubGlobal('AudioBufferSourceNode', Source)
  vi.stubGlobal('DynamicsCompressorNode', class extends Node {})
  vi.stubGlobal('fetch', async (url: string) => {
    fetched(url)
    if (refused.has(url)) throw new Error('offline')
    return { ok: true, arrayBuffer: async () => ({ url }) }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('focus sounds (lib/focusSounds)', () => {
  it('plays a loop over the stretch between its file’s two spare half-seconds, fading in, through the ring switch', async () => {
    const { setMix } = await player()
    await setMix({ rain: 0.5 })

    const { source, gain } = playingOf('/sounds/rain.m4a')
    expect(source).toMatchObject({ loop: true, loopStart: 0.5, loopEnd: 60.5, started: [10, 0.5] })
    // Half on the slider is a quarter of the power, and the rain's own level is half.
    expect(gain.gain.targets).toEqual([[0.125, 10, 0.3]])
    expect(audioSession.type).toBe('playback')
    expect(contexts[0].resume).toHaveBeenCalled()
  })

  it('mixes them, each at its own volume, changed without starting over, and lets one go with a fade', async () => {
    vi.useFakeTimers()
    const { setMix } = await player()
    await setMix({ rain: 1, fire: 1 })
    await setMix({ rain: 0.5, fire: 1 })
    expect(sources).toHaveLength(2)
    expect(playingOf('/sounds/rain.m4a').gain.gain.value).toBe(0.125)

    await setMix({ fire: 1 })
    expect(playingOf('/sounds/rain.m4a').gain.gain.targets.at(-1)).toEqual([0, 10, 0.12])
    expect(playingOf('/sounds/rain.m4a').source.stopped).toBe(10.8)
    expect(playingOf('/sounds/fire.m4a').source.stopped).toBeUndefined()

    // With nothing left on, the sound rests once the last has faded, and the switch is the phone’s again.
    await setMix({})
    expect(audioSession.type).toBe('auto')
    expect(contexts[0].suspend).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(contexts[0].suspend).toHaveBeenCalled()
  })

  it('doesn’t start one that was turned off again while its file was on its way', async () => {
    const { setMix } = await player()
    const asked = setMix({ cafe: 1 })
    await setMix({})
    await asked
    expect(sources).toHaveLength(0)
  })

  it('fetches each file once, and one that failed again the next time', async () => {
    const { setMix } = await player()
    refused.add('/sounds/fire.m4a')
    await expect(setMix({ fire: 1, rain: 1 })).rejects.toThrow('offline')
    expect(playingOf('/sounds/rain.m4a').source).toBeDefined()

    refused.clear()
    await setMix({ fire: 1, rain: 1 })
    expect(playingOf('/sounds/fire.m4a').source).toBeDefined()
    expect(fetched.mock.calls.filter(([url]) => url === '/sounds/rain.m4a')).toHaveLength(1)
    expect(fetched.mock.calls.filter(([url]) => url === '/sounds/fire.m4a')).toHaveLength(2)
  })

  it('strikes a key a quarter-second long, never the same one twice running, and Return its bell and carriage; the keys alone follow the switch', async () => {
    const { setMix, strike } = await player()
    await setMix({ typewriter: 1 })
    expect(audioSession.type).toBe('ambient')

    for (let n = 0; n < 40; n++) strike('key')
    const keys = sources.map((one) => one.started!)
    expect(keys.every(([at, from, length]) => at === 10 && from >= 0 && from <= 2.75 && from % 0.25 === 0 && length === 0.25)).toBe(true)
    expect(keys.every((key, n) => n === 0 || key[1] !== keys[n - 1][1])).toBe(true)
    expect(new Set(keys.map(([, from]) => from)).size).toBeGreaterThan(6)

    strike('return')
    expect(sources.at(-1)!.started).toEqual([10, 3, 2.25])

    await setMix({})
    strike('key')
    expect(sources).toHaveLength(41)
  })

  it('hears a key typed in a document being written in, Return as Return, and nothing else', async () => {
    const { struck } = await player()
    const writing = editor()
    expect(struck(pressed(writing, 'a'))).toBe('key')
    expect(struck(pressed(writing, ' '))).toBe('key')
    expect(struck(pressed(writing, 'é'))).toBe('key')
    expect(struck(pressed(writing, 'Backspace'))).toBe('key')
    expect(struck(pressed(writing, 'Enter'))).toBe('return')
    for (const key of ['ArrowLeft', 'Shift', 'Escape', 'Process']) expect(struck(pressed(writing, key)), key).toBeNull()
    expect(struck(pressed(writing, 's', { metaKey: true }))).toBeNull()
    expect(struck(pressed(writing, 'a', { repeat: true }))).toBeNull()
    expect(struck(pressed(writing, 'a', { isComposing: true }))).toBeNull()

    const search = document.createElement('input')
    document.body.append(search)
    expect(struck(pressed(search, 'a'))).toBeNull()
    writing.parentElement!.setAttribute('contenteditable', 'false')
    expect(struck(pressed(writing, 'a'))).toBeNull()
  })

  it('listens for keys and for Nib leaving the screen, and lets it all go when told to stop', async () => {
    const { listenForFocusSounds, setMix, currentMix } = await player()
    const stop = listenForFocusSounds()
    await setMix({ typewriter: 1, rain: 1 })
    editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(sources).toHaveLength(2)

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(contexts[0].suspend).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    contexts[0].resume.mockClear()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(contexts[0].resume).toHaveBeenCalled()

    stop()
    expect(currentMix()).toEqual({})
    document.querySelector('p')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }))
    expect(sources).toHaveLength(2)
  })
})

describe('the choice this device keeps (lib/focusSounds)', () => {
  it('keeps which are on and how loud, and makes a mix of those that are on', async () => {
    localStorage.clear()
    const { choose, mixOf, asChoice } = await player()
    choose('rain', { on: true })
    choose('fire', { volume: 0.3 })
    choose('typewriter', { on: true, volume: 0.9 })

    const kept = asChoice(JSON.parse(localStorage.getItem('nib-focus-sounds')!))
    expect(kept.rain).toEqual({ on: true, volume: 0.6 })
    expect(kept.fire).toEqual({ on: false, volume: 0.3 })
    expect(mixOf(kept)).toEqual({ rain: 0.6, typewriter: 0.9 })
    // And it's what a Nib opened again starts with.
    expect((await player()).mixOf((await import('./focusSounds')).asChoice(JSON.parse(localStorage.getItem('nib-focus-sounds')!)))).toEqual({ rain: 0.6, typewriter: 0.9 })
  })

  it('takes anything in storage that isn’t a choice as none made', async () => {
    const { asChoice } = await player()
    const none = { on: false, volume: 0.6 }
    expect(asChoice('rain')).toEqual({ rain: none, cafe: none, fire: none, typewriter: none })
    expect(asChoice({ rain: { on: 'yes', volume: 4 }, cafe: { on: true, volume: -1 }, fire: null }).rain).toEqual(none)
    expect(asChoice({ cafe: { on: true, volume: -1 } }).cafe).toEqual({ on: true, volume: 0.6 })
  })
})
