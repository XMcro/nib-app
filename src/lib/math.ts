import type { JSONContent } from '@tiptap/react'
import { mathMLMacros } from './mathml'

/**
 * Formulas, written as LaTeX and drawn by KaTeX. Its script, styles and fonts
 * are large and most writers have no formula, so they are fetched the first
 * time one is to be drawn, and not before.
 */

type Katex = typeof import('katex').default

let loading: Promise<Katex> | null = null
/** KaTeX, once it has been fetched: what's written in one go (an export) can't wait for it. */
let fetched: Katex | null = null

function katex(): Promise<Katex> {
  // With its chemistry, which teaches it \ce{H2O} and \pu{25 kJ//mol} by being loaded. Tried again next time if it couldn't be fetched.
  return (loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css'), import('katex/contrib/mhchem')]).then(
    ([library]) => (fetched = library.default),
    (error: unknown) => {
      loading = null
      throw error
    },
  ))
}

const orNothing = (error: unknown) => {
  console.warn('Nib: could not load the formulas', error)
  return null
}

/**
 * Chemistry longer than anyone writes in one formula, which is left as
 * written. KaTeX's chemistry reads its braces in time that grows with the
 * square of what's in them: 50 ms for 1,000 characters, 7 s for 100,000, on
 * the main thread. The rest of KaTeX doesn't. (reader/math has the same rule.)
 */
export const tooLongToDraw = (tex: string) => tex.length > 1000 && (tex.includes('\\ce') || tex.includes('\\pu'))

/**
 * Draws the formula `tex` into `into`, set on a line of its own if `block`.
 * What KaTeX can't read is shown as written, in its error colour, with why
 * in its title; and until it is fetched, or if it can't be, as written.
 */
export async function drawMath(tex: string, into: HTMLElement, block: boolean): Promise<void> {
  into.textContent = tex
  if (tooLongToDraw(tex)) return
  const library = await katex().catch(orNothing)
  try {
    // Drawn into nodes, never as markup: nothing here is text turned into HTML (lib/csp).
    library?.render(tex, into, { displayMode: block, throwOnError: false })
  } catch {
    // Not a fault in the LaTeX, which KaTeX marks itself: braces thousands deep, which it gives up on having emptied `into`.
    into.textContent = tex
  }
}

/**
 * Whether `$…$` just typed is a formula and not two prices: "$20-$30" has
 * nothing between its dollars but digits and what joins them.
 */
export const looksLikeMath = (tex: string) => !/^[\d\s.,;:–—-]*$/.test(tex)

const holdsMath = (node: JSONContent): boolean => node.type === 'mathInline' || node.type === 'mathBlock' || (Array.isArray(node.content) && node.content.some(holdsMath))

/** Before an export of these documents: fetches KaTeX if one of them holds a formula, for `withMathML`. Without it they go out as their LaTeX. */
export async function mathFor(bodies: JSONContent[]): Promise<void> {
  if (bodies.some(holdsMath)) await katex().catch(orNothing)
}

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }
/** The text in a piece of the markup a document is turned into. */
export const fromMarkup = (escaped: string) => escaped.replace(/&(?:lt|gt|amp|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])

/**
 * A document's markup (lib/documentExport) with each formula in it as MathML,
 * which a browser, the page a PDF is printed from and an e-book reader all
 * draw with nothing more: no stylesheet of KaTeX's, no fonts sent along. Its
 * LaTeX stays inside, as MathML's own note of where it came from. One KaTeX
 * can't read, or any of them before KaTeX is fetched (mathFor), stays LaTeX.
 */
export function withMathML(html: string): string {
  const library = fetched
  if (!library) return html
  // As the editor's schema writes a formula (editor/Math): its LaTeX, as text, in a span or a div.
  return html.replace(/<(span|div) data-math="">([^<]*)<\/\1>/g, (whole, tag: string, escaped: string) => {
    const tex = fromMarkup(escaped)
    if (tooLongToDraw(tex)) return whole
    try {
      const drawn = library.renderToString(tex, { output: 'mathml', displayMode: tag === 'div', throwOnError: true, macros: mathMLMacros() })
      // Without the widths Chromium misreads (lib/mathml WIDENED, which the reader takes off by that name).
      return `<${tag} data-math="">${drawn.replace(/(<mpadded) width="\+[^"]*"/g, '$1')}</${tag}>`
    } catch {
      return whole
    }
  })
}
