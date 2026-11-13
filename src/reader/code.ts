import { codeReader, languageName, MOST_COLOURED } from '../lib/codeReader'

/**
 * A shared draft's code, coloured off the page: the draft is a stranger's, and
 * a grammar can take seconds over the wrong text (editor/codeWorker). The
 * worker is fetched only for a draft that has code in a language, and what it
 * finds is drawn as nodes: no markup is handed to the browser here either.
 */

/** A draft whose blocks keep running out of time is left as it is, rather than keep a reader's device busy with all of them. */
const MOST_STOPPED = 3
let stopped = 0

type Job = { language: string; text: string; code: HTMLElement }
const queue: Job[] = []

const poke = codeReader<Job>(
  () => (stopped < MOST_STOPPED ? (queue[0] ?? null) : null),
  ({ text, code }, found) => {
    queue.shift()
    if (found === null) stopped++
    if (!found?.length) return
    const parts: (globalThis.Node | string)[] = []
    let at = 0
    for (const { from, to, colour } of found) {
      parts.push(text.slice(at, from))
      const stretch = document.createElement('span')
      stretch.className = `nib-code-${colour}`
      stretch.textContent = text.slice(from, to)
      parts.push(stretch)
      at = to
    }
    parts.push(text.slice(at))
    code.replaceChildren(...parts)
  },
)

/** Colours `code`, which already shows `text`, once it has been read. Until then, and if it can't be, it stays as it is. */
export function colourCode(code: HTMLElement, language: unknown, text: string): void {
  const name = languageName(language)
  if (!name || text.length > MOST_COLOURED) return
  queue.push({ language: name, text, code })
  poke()
}
