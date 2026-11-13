import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * A pattern can take longer than the age of the universe on an ordinary
 * sentence, `(\w+ ?)+:` for one, and nothing can stop it on the page's own
 * thread: the app would freeze. So it's first run on the document's text in a
 * worker (public/regex-check.js), which can be stopped, and used only if it
 * finishes quickly, as it's going to run again on that thread at every change.
 */

/** Long enough for any reasonable pattern on a long document, and short enough to run again unnoticed. */
const LIMIT_MS = 100

/** Why a pattern isn't used. `unchecked`: the worker wouldn't run, so it's not safe to try. */
export type PatternTrouble = 'slow' | 'empty' | 'unchecked'

/** What a find says of each. */
export const PATTERN_TROUBLE: Record<PatternTrouble, string> = { slow: 'Too slow to run', empty: 'Matches empty text', unchecked: 'Can’t check this' }

/** Each block's text, as the search sees it. */
function textsOf(doc: PMNode) {
  const texts: string[] = []
  doc.descendants((node) => {
    if (!node.inlineContent) return true
    texts.push(node.textBetween(0, node.content.size, undefined, '￼'))
    return false
  })
  return texts
}

/** `done` is what's wrong with the pattern, or null if it's safe, on a document or every chapter of a book. After `cancel` it never settles. */
export function checkPattern(source: string, doc: PMNode | PMNode[]): { done: Promise<PatternTrouble | null>; cancel: () => void } {
  let worker: Worker
  try {
    worker = new Worker('/regex-check.js')
  } catch {
    return { done: Promise.resolve('unchecked'), cancel: () => {} }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    clearTimeout(timer)
    worker.terminate()
  }
  const done = new Promise<PatternTrouble | null>((resolve) => {
    const finish = (answer: PatternTrouble | null) => {
      stop()
      resolve(answer)
    }
    worker.onerror = () => finish('unchecked')
    worker.onmessage = ({ data }: MessageEvent<'started' | 'empty' | 'fine'>) => {
      // From when it starts, not from when it was asked: a phone can take a while to start a worker.
      if (data === 'started') timer = setTimeout(() => finish('slow'), LIMIT_MS)
      else finish(data === 'empty' ? 'empty' : null)
    }
    worker.postMessage({ source, texts: [doc].flat().flatMap(textsOf) })
  })
  return { done, cancel: stop }
}
