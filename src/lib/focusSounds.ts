import { useSyncExternalStore } from 'react'
import { readJson, writeJson } from './jsonStorage'

/**
 * Focus sounds (Nib Plus): rain, a café and a fire, each a loop with its own
 * volume, any of them together; and a typewriter, a key struck for each key
 * typed in the writing, its bell and carriage return for Return. Played on
 * the device with Web Audio, from the recordings in public/sounds (who made
 * each is in credits.txt there, and Acknowledgements).
 *
 * Nothing is fetched until it's asked for, and it's kept once it is. While
 * Nib isn't on the screen, nothing plays.
 */

export const LOOPS = ['rain', 'cafe', 'fire'] as const
export type Loop = (typeof LOOPS)[number]
export type Sound = Loop | 'typewriter'
/** Each one's volume, 0 to 1. One left out, or at 0, is off. */
export type Mix = Partial<Record<Sound, number>>

/**
 * Each loop's file and how long it is. The file has PAD seconds more either
 * side, the end before and the start after, so the stretch looped joins up
 * wherever the decoder puts the beginning (AAC starts with a little silence).
 * `level`: as loud as the others, as near as can be, at the same volume.
 */
const FILES: Record<Loop, { url: string; length: number; level: number }> = {
  rain: { url: 'sounds/rain.m4a', length: 60, level: 0.5 },
  cafe: { url: 'sounds/cafe.m4a', length: 50, level: 0.5 },
  // Crackling, with its pops held down, so quieter on average: it comes up more.
  fire: { url: 'sounds/fire.m4a', length: 28, level: 0.8 },
}
const PAD = 0.5

/** The typewriter's file: KEYS keys a quarter-second apart from its start, then Return, the bell and the carriage return. */
const TYPEWRITER = { url: 'sounds/typewriter.wav', keys: 12, slot: 0.25, returnAt: 3, returnLength: 2.25, level: 0.5 }

/** A volume as heard: a slider halfway is half as loud, not a little quieter. */
const gainOf = (volume: number | undefined) => Math.min(1, Math.max(0, volume ?? 0)) ** 2

/** WebKit's (Safari 17 and on): whether the ring switch silences Nib, and whether others' music goes on. */
type AudioSession = { type: 'auto' | 'playback' | 'ambient' }
const session = () => (navigator as { audioSession?: AudioSession }).audioSession

let context: AudioContext | undefined
let out: AudioNode | undefined
let mix: Mix = {}
const files = new Map<string, Promise<AudioBuffer>>()
const playing = new Map<Loop, { source: AudioBufferSourceNode; gain: GainNode }>()
let typewriter: AudioBuffer | undefined
let lastKey = -1

/** Made when first asked for. The app's web view lets it play straight away, a tap or not (Capacitor's CAPBridgeViewController). */
function audio(): { context: AudioContext; out: AudioNode } {
  if (!context || !out) {
    context = new AudioContext()
    // Everything goes through a limiter at the very end: rain, café, fire and keys at once can peak together.
    out = new DynamicsCompressorNode(context, { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.15 })
    out.connect(context.destination)
  }
  return { context, out }
}

/** A file, decoded once; one that couldn't be is tried again next time. */
function load(url: string): Promise<AudioBuffer> {
  let file = files.get(url)
  if (!file) {
    const { context } = audio()
    // Not asked whether it came back `ok`: the app's web view serves audio files with no
    // status at all (Capacitor's WebViewAssetHandler). One that didn't come won't decode.
    file = fetch(`${import.meta.env.BASE_URL}${url}`)
      .then((response) => response.arrayBuffer())
      .then((bytes) => context.decodeAudioData(bytes))
    file.catch(() => files.delete(url))
    files.set(url, file)
  }
  return file
}

const wanted = (sound: Sound) => gainOf(mix[sound]) > 0

let resting: ReturnType<typeof setTimeout> | undefined

/** Running while there's something to hear and Nib is on the screen. Off it, stopped at once; with nothing left on, once the last has faded. */
function keepRunning() {
  if (!context) return
  const running = context
  clearTimeout(resting)
  const on = [...LOOPS, 'typewriter' as const].some(wanted)
  if (document.visibilityState === 'hidden') void running.suspend()
  else if (on) void running.resume()
  else resting = setTimeout(() => void running.suspend(), 1000)
}

/**
 * Plays what `next` says, each at its volume, the rest let go: a loop fades
 * in from its start, and out. Answers once each it asks for is playing; it
 * rejects if one couldn't be had (the others still play).
 */
export async function setMix(next: Mix): Promise<void> {
  mix = { ...next }
  // On an iPhone, the loops play through the ring switch set to silent, as they've
  // been asked for, and other apps' music pauses for them; keys alone are like
  // the keyboard's own clicks, silenced by it, and heard along with any music.
  const kind = LOOPS.some(wanted) ? 'playback' : wanted('typewriter') ? 'ambient' : 'auto'
  const audioSession = session()
  if (audioSession && audioSession.type !== kind) audioSession.type = kind
  // Nothing to stop, nothing to start.
  if (!context && kind === 'auto') return
  const { context: player, out } = audio()
  keepRunning()
  const now = player.currentTime

  for (const loop of LOOPS) {
    const on = playing.get(loop)
    if (on && !wanted(loop)) {
      on.gain.gain.setTargetAtTime(0, now, 0.12)
      on.source.stop(now + 0.8)
      playing.delete(loop)
    } else if (on) {
      on.gain.gain.setTargetAtTime(gainOf(mix[loop]) * FILES[loop].level, now, 0.08)
    }
  }

  const starting = LOOPS.filter((loop) => wanted(loop) && !playing.has(loop)).map(async (loop) => {
    const buffer = await load(FILES[loop].url)
    // Asked for something else while it was on its way.
    if (!wanted(loop) || playing.has(loop)) return
    const source = new AudioBufferSourceNode(player, { buffer, loop: true, loopStart: PAD, loopEnd: PAD + FILES[loop].length })
    const gain = new GainNode(player, { gain: 0 })
    source.connect(gain).connect(out)
    gain.gain.setTargetAtTime(gainOf(mix[loop]) * FILES[loop].level, player.currentTime, 0.3)
    source.start(player.currentTime, PAD)
    playing.set(loop, { source, gain })
  })
  const typing = wanted('typewriter') && !typewriter ? load(TYPEWRITER.url).then((buffer) => void (typewriter = buffer)) : undefined
  const failed = (await Promise.allSettled([...starting, typing])).find((one) => one.status === 'rejected')
  if (failed) throw failed.reason
}

/** What's playing, as last asked for. */
export const currentMix = (): Mix => ({ ...mix })

/** The typewriter, struck: a key, a different one from the last, or Return. Nothing if it's off or not here yet. */
export function strike(kind: 'key' | 'return') {
  if (!wanted('typewriter') || !typewriter || !context || !out) return
  const source = new AudioBufferSourceNode(context, { buffer: typewriter })
  const gain = new GainNode(context, { gain: gainOf(mix.typewriter) * TYPEWRITER.level })
  source.connect(gain).connect(out)
  if (kind === 'return') {
    source.start(context.currentTime, TYPEWRITER.returnAt, TYPEWRITER.returnLength)
    return
  }
  let key = Math.floor(Math.random() * (lastKey < 0 ? TYPEWRITER.keys : TYPEWRITER.keys - 1))
  if (lastKey >= 0 && key >= lastKey) key += 1
  lastKey = key
  // No two strikes quite alike: a hair higher or lower, a touch louder or softer.
  source.playbackRate.value = 0.96 + Math.random() * 0.08
  gain.gain.value *= 0.8 + Math.random() * 0.2
  source.start(context.currentTime, key * TYPEWRITER.slot, TYPEWRITER.slot)
}

/**
 * What a key pressed in the writing sounds like: Return, a key, or nothing,
 * for a shortcut, a key held down, one an input method is still composing, a
 * key that writes nothing, or anywhere but a document being written in.
 */
export function struck(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'isComposing' | 'repeat' | 'target'>): 'key' | 'return' | null {
  if (event.metaKey || event.ctrlKey || event.isComposing || event.repeat) return null
  if (!(event.target instanceof Element) || !event.target.closest('.ProseMirror[contenteditable="true"]')) return null
  if (event.key === 'Enter') return 'return'
  return [...event.key].length === 1 || ['Backspace', 'Delete', 'Tab'].includes(event.key) ? 'key' : null
}

/**
 * Listening from now: keys typed strike the typewriter, and nothing plays
 * while Nib is off the screen. Answers how to stop listening, which lets all
 * of it go.
 */
export function listenForFocusSounds(): () => void {
  const onKey = (event: KeyboardEvent) => {
    const kind = struck(event)
    if (kind) strike(kind)
  }
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('visibilitychange', keepRunning)
  return () => {
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('visibilitychange', keepRunning)
    void setMix({}).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// This device's choice: which of them, and how loud, kept from one time to the next. Whether they're playing isn't:
// nothing plays until asked to, so rain never starts by itself in a quiet room.

/** Every one, in the order they're offered. */
export const SOUNDS: readonly Sound[] = [...LOOPS, 'typewriter']

export type Choice = Record<Sound, { on: boolean; volume: number }>

/** Why the Plus sheet opened, when focus sounds were asked for without it. */
export const SOUNDS_PLUS = 'Focus sounds, rain, a café, a fire and typewriter keys to write to, are part of Nib Plus.'

const CHOICE = 'nib-focus-sounds'
const VOLUME = 0.6

/** From storage, as it's there or was ever there: anything not a choice is as none made. */
export function asChoice(raw: unknown): Choice {
  const kept = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return Object.fromEntries(
    SOUNDS.map((sound) => {
      const one = (kept[sound] && typeof kept[sound] === 'object' ? kept[sound] : {}) as Record<string, unknown>
      const volume = typeof one.volume === 'number' && one.volume >= 0 && one.volume <= 1 ? one.volume : VOLUME
      return [sound, { on: one.on === true, volume }]
    }),
  ) as Choice
}

/** What a choice plays: those that are on, each at its volume. */
export const mixOf = (choice: Choice): Mix => Object.fromEntries(SOUNDS.filter((sound) => choice[sound].on).map((sound) => [sound, choice[sound].volume]))

let choice = asChoice(readJson<unknown>(CHOICE, null))
const choiceListeners = new Set<() => void>()
const onChoice = (listener: () => void) => {
  choiceListeners.add(listener)
  return () => {
    choiceListeners.delete(listener)
  }
}

export const useFocusChoice = () => useSyncExternalStore(onChoice, () => choice)

/** One sound turned on or off, or louder or softer, and kept. */
export function choose(sound: Sound, changes: Partial<Choice[Sound]>) {
  choice = asChoice({ ...choice, [sound]: { ...choice[sound], ...changes } })
  writeJson(CHOICE, choice)
  choiceListeners.forEach((listener) => listener())
}
