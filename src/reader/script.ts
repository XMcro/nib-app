import type { JSONContent } from '@tiptap/react'
import { scriptParagraphs, titleLines, type Run, type ScriptParagraph } from '../lib/scriptPages'

/**
 * A shared screenplay (Nib Plus) set out as a script: its title page, then a
 * paragraph an element, each from its own indent (reader.css, as Nib's own
 * HTML of one, lib/scriptExport). What it's drawn from is someone else's, so
 * every word goes in as text, never as markup. Throws on a body it can't read,
 * and the page draws that as it draws any draft.
 */
export function renderScript(body: unknown, into: HTMLElement): void {
  const paragraphs = scriptParagraphs(body as JSONContent)
  const lines = titleLines(body as JSONContent)
  const out: HTMLElement[] = []
  if (lines) {
    const page = document.createElement('section')
    page.className = 'title-page'
    for (const line of lines) page.append(paragraph(`align-${line?.alignment ?? 'left'}`, line?.runs ?? []))
    out.push(page)
  }
  out.push(...paragraphs.map(set))
  into.replaceChildren(...out)
}

function set(one: ScriptParagraph): HTMLElement {
  if ('dual' in one) {
    // The two side by side, each from its own name on.
    const pair = document.createElement('div')
    pair.className = 'dual'
    const second = one.dual.findIndex((each, index) => index > 0 && 'element' in each && each.element === 'character')
    for (const side of second > 0 ? [one.dual.slice(0, second), one.dual.slice(second)] : [one.dual]) {
      const column = document.createElement('div')
      column.append(...side.map(set))
      pair.append(column)
    }
    return pair
  }
  const shown = paragraph(`sp-${one.element}${one.pageBreak ? ' page-break' : ''}`, one.runs)
  if (one.number) {
    for (const side of ['before', 'after']) {
      const number = document.createElement('span')
      number.className = `number ${side}`
      number.textContent = one.number
      shown.prepend(number)
    }
  }
  return shown
}

function paragraph(className: string, runs: Run[]): HTMLElement {
  const shown = document.createElement('p')
  shown.className = className
  for (const run of runs) {
    if (run.text === '\n') {
      shown.append(document.createElement('br'))
      continue
    }
    let node: Node = document.createTextNode(run.text)
    for (const [on, tag] of [[run.underline, 'u'], [run.italic, 'i'], [run.bold, 'b']] as const) {
      if (!on) continue
      const wrap = document.createElement(tag)
      wrap.append(node)
      node = wrap
    }
    shown.append(node)
  }
  return shown
}
