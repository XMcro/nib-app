/**
 * A shared draft's formulas, drawn as MathML, which the reader's own browser
 * sets with nothing more: the page's policy allows no inline styles
 * (worker/shares READER_HEADERS), and KaTeX's other drawing is made of them.
 * KaTeX is fetched only for a draft that has a formula, and builds nodes: no
 * markup is handed to the browser here either.
 */

import { mathMLMacros, WIDENED } from '../lib/mathml'

type Katex = typeof import('katex').default

let loading: Promise<Katex> | null = null

/**
 * KaTeX's chemistry (\ce, \pu) reads its braces in time that grows with the
 * square of what's in them: 50 ms for 1,000 characters, 7 s for 100,000. The
 * draft is a stranger's, so a formula of it longer than anyone writes is left
 * as written (as lib/math leaves it), and so is the chemistry past more of it
 * than a draft has: at the worst, a second of drawing in all.
 */
const LONGEST = 1000
const MOST = 20_000
let chemistry = 0

/** Draws the formula `tex` into `into`. Until KaTeX is here, and if it can't be fetched or can't read it, its LaTeX is what shows. */
export function drawFormula(tex: string, into: HTMLElement, block: boolean): void {
  into.textContent = tex
  if (tex.includes('\\ce') || tex.includes('\\pu')) {
    if (tex.length > LONGEST || chemistry + tex.length > MOST) return
    chemistry += tex.length
  }
  // With its chemistry, which teaches KaTeX \ce and \pu by being loaded.
  loading ??= Promise.all([import('katex'), import('katex/contrib/mhchem')]).then(([library]) => library.default)
  void loading.then(
    (katex) => {
      try {
        // No links, pictures or markup from a formula: KaTeX's own default, said here because the draft is a stranger's.
        katex.render(tex, into, { output: 'mathml', displayMode: block, throwOnError: true, trust: false, macros: mathMLMacros() })
        for (const padded of into.querySelectorAll(WIDENED)) padded.removeAttribute('width')
      } catch {
        into.textContent = tex
      }
    },
    () => {
      loading = null
    },
  )
}
