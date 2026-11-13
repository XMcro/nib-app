import type { Stretch } from '../editor/codeWorker'

/** A code language's name: what a block's `language` may be, as its class. */
const LANGUAGE = /^[\w+#.-]{1,32}$/
export const languageName = (value: unknown) => (typeof value === 'string' && LANGUAGE.test(value) ? value : null)

/** Longer than this a block stays plain: too many colours to draw again at every keystroke. */
export const MOST_COLOURED = 10_000

/** Far longer than real code takes at that length (tens of milliseconds on a phone), and a stop to what would go on for seconds. */
export const READ_LIMIT_MS = 300

/**
 * Reads blocks of code for their colours, one at a time, in a worker that's
 * stopped if one takes too long (editor/codeWorker says why). `next` says what
 * to read now, and goes on saying so until `done` gets what was found, or null
 * for a read that was stopped. What it returns says there may be something new
 * for `next` to give.
 */
export function codeReader<Job extends { language: string; text: string }>(next: () => Job | null, done: (job: Job, found: Stretch[] | null) => void) {
  let worker: Worker | null = null
  let ready = false
  let reading: Job | null = null
  let limit: ReturnType<typeof setTimeout> | undefined
  let broken = false

  function finish(job: Job, found: Stretch[] | null) {
    clearTimeout(limit)
    reading = null
    done(job, found)
    poke()
  }

  function giveUp(why: unknown) {
    console.warn('Nib: could not start colouring code', why)
    broken = true
    worker?.terminate()
    worker = null
    if (reading) finish(reading, [])
    else poke()
  }

  function start() {
    ready = false
    try {
      worker = new Worker(new URL('../editor/codeWorker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      return giveUp(error)
    }
    worker.onerror = (event) => giveUp(event.message)
    worker.onmessage = ({ data }: MessageEvent<'ready' | Stretch[]>) => {
      if (data !== 'ready') return finish(reading!, data)
      ready = true
      poke()
    }
  }

  function poke() {
    if (reading !== null) return
    // Later, as this may be asked while an editor is still being set up, and what it's told would be sent back there.
    if (broken) {
      return queueMicrotask(() => {
        for (let job = next(); job; job = next()) done(job, [])
      })
    }
    if (!worker) {
      if (next()) start()
      return
    }
    if (!ready) return
    const job = next()
    if (!job) return
    reading = job
    worker.postMessage({ language: job.language, text: job.text })
    limit = setTimeout(() => {
      worker?.terminate()
      worker = null
      finish(job, null)
    }, READ_LIMIT_MS)
  }

  return poke
}
