import { refractor } from 'refractor/all'

/**
 * Reads code for its colours, off the page's thread. On ordinary code a grammar
 * takes milliseconds, but on a long unbroken run of letters (a base64 blob) many
 * take seconds, and nothing can stop that on the page's own thread.
 */

export type Stretch = { from: number; to: number; colour: string }

/**
 * What each of a grammar's words is coloured as. Nib's own five, and never its
 * words as classes: one is called `table`, another `filter`, and they are
 * Tailwind's too. Punctuation and operators are left the colour of the text.
 */
const COLOURED: Record<string, string[]> = {
  comment: ['comment', 'prolog', 'doctype', 'cdata'],
  keyword: ['keyword', 'atrule', 'rule', 'important'],
  string: ['string', 'char', 'regex', 'attr-value', 'url', 'inserted'],
  number: ['number', 'boolean', 'constant', 'symbol', 'entity', 'deleted'],
  name: ['function', 'class-name', 'builtin', 'tag', 'attr-name', 'selector', 'property', 'variable', 'namespace'],
  '': ['punctuation', 'operator'],
}
const COLOUR = new Map(Object.entries(COLOURED).flatMap(([colour, words]) => words.map((word) => [word, colour] as const)))

type Tree = { type: string; value?: string; properties?: { className?: unknown }; children?: Tree[] }

/** Adds the coloured stretches of a grammar's tree, from offset `at`, and returns where it ended. A word it doesn't know takes the colour it's inside. */
function stretches(tree: Tree[], outer: string, at: number, found: Stretch[]): number {
  for (const part of tree) {
    if (part.type === 'text') {
      const to = at + (part.value ?? '').length
      const last = found.at(-1)
      if (outer && last?.to === at && last.colour === outer) last.to = to
      else if (outer && to > at) found.push({ from: at, to, colour: outer })
      at = to
    } else if (part.children) {
      const words = Array.isArray(part.properties?.className) ? (part.properties.className as string[]) : []
      at = stretches(part.children, words.map((word) => COLOUR.get(word)).find((colour) => colour !== undefined) ?? outer, at, found)
    }
  }
  return at
}

self.onmessage = ({ data: { language, text } }: MessageEvent<{ language: string; text: string }>) => {
  const found: Stretch[] = []
  try {
    if (refractor.registered(language)) stretches(refractor.highlight(text, language).children, '', 0, found)
  } catch (error) {
    console.warn('Nib: could not colour a code block', error)
    found.length = 0
  }
  postMessage(found)
}

// So the time allowed runs from here: a phone can take a while to start a worker.
postMessage('ready')
