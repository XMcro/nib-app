import { afterEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { nibExtensions } from '../extensions'
import { countWords } from '../../lib/stats'
import { DEBOUNCE_MS, styleCheck, styleCheckKey } from './plugin'
import { RULES } from './rules'

/**
 * The style check must never be felt while writing, even on a long page. On
 * a 50,000-word page in Chromium, every slice of the first full check stays
 * under 50 ms, and a keystroke, and the check after it, each under 8 ms.
 * WebKit on an iPad is slower; the margin is there for it.
 *
 * Not part of `npm test`, where a busy machine would fail it with nothing
 * wrong: run it with `npm run timing`. The test of what the check does, which
 * is counted rather than timed, is performance.browser.test.ts.
 */

// About 22 words, with something for most rules to find.
const LINE = 'The keeper climbed the stair and very quickly checked the lamp, which was cleaned every morning before the light came up over the harbour.'
const PARAGRAPHS = Math.ceil(50_000 / countWords(LINE))
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  document.body.replaceChildren()
})

it('stays within its time budget on a 50,000-word page', { timeout: 60_000 }, async () => {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({ element, extensions: nibExtensions(true), content: `<p>${LINE}</p>`.repeat(PARAGRAPHS) })
  expect(countWords(editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n'))).toBeGreaterThanOrEqual(50_000)
  const view = editor.view

  // Time every transaction as the writer would feel it: state, decorations and DOM.
  const slices: number[] = []
  const keystrokes: number[] = []
  const send = view.dispatch.bind(view)
  view.dispatch = (tr: Transaction) => {
    const started = performance.now()
    send(tr)
    const took = performance.now() - started
    if (tr.getMeta(styleCheckKey)) slices.push(took)
    else if (tr.docChanged) keystrokes.push(took)
  }

  editor.registerPlugin(styleCheck(new Set(RULES.map((rule) => rule.id))))
  while (styleCheckKey.getState(editor.state)!.dirty.length) await new Promise((resolve) => setTimeout(resolve, 5))
  expect(document.querySelectorAll('.nib-style').length).toBeGreaterThan(PARAGRAPHS)
  const firstPass = slices.splice(0)
  expect(Math.max(...firstPass)).toBeLessThan(50)

  // Typing in the middle of the page, then pausing.
  const middle = editor.state.doc.resolve(Math.floor(editor.state.doc.content.size / 2))
  editor.commands.setTextSelection(middle.end())
  for (const char of ' really very slowly') view.dispatch(view.state.tr.insertText(char))
  expect(median(keystrokes)).toBeLessThan(8)
  await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 100))
  expect(slices.length).toBeGreaterThan(0)
  expect(Math.max(...slices)).toBeLessThan(8)

  console.log(
    `style check, ${PARAGRAPHS} paragraphs: first pass ${firstPass.length} slices, longest ${Math.max(...firstPass).toFixed(1)} ms; ` +
      `keystroke median ${median(keystrokes).toFixed(2)} ms; recheck ${Math.max(...slices).toFixed(2)} ms`,
  )
})
