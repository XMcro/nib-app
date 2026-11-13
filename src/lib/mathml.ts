/**
 * For a formula written as MathML (an export: lib/math; a shared draft:
 * reader/math), which the browser sets itself and not KaTeX. Three things
 * LaTeX does to nudge what's drawn come out as MathML no browser sets right,
 * and KaTeX's chemistry writes them around every small number: WebKit shows
 * nothing at all of what `\smash` holds, so H2O read "H O", nor the numbers of
 * an isotope, set with `\mathllap`. Here they are their words alone, and
 * `\vphantom`, which only lines small numbers up, is nothing.
 */

type Expander = { consumeSpaces(): void; future(): { text: string }; popToken(): { text: string }; consumeArgs(count: number): unknown }

/** The `macros` to hand KaTeX with `output: 'mathml'`. A new object each time: KaTeX writes a formula's own `\gdef` into it. */
export const mathMLMacros = () => ({
  '\\smash': (context: object) => {
    const expander = context as Expander
    expander.consumeSpaces()
    // Its `[t]` or `[b]`, which would otherwise be read as words.
    if (expander.future().text === '[') for (let token = ''; token !== ']' && token !== 'EOF'; ) token = expander.popToken().text
    return ''
  },
  '\\vphantom': (context: object) => {
    const expander = context as Expander
    expander.consumeArgs(1)
    return ''
  },
  '\\mathllap': '#1',
})

/**
 * A formula's MathML as KaTeX wrote it, without the widths it gives the words
 * over and under an arrow as "+0.6em", so much more than they take: Chromium
 * reads that as 0.6em in all, and sets the words over whatever comes next.
 */
export const WIDENED = 'mpadded[width^="+"]'
