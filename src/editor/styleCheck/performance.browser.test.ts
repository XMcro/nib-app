import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { nibExtensions } from '../extensions'
import { countWords } from '../../lib/stats'
import { checks, styleCheck, styleCheckKey } from './plugin'
import { RULES } from './rules'

/**
 * The style check must never be felt while writing, even on a long page. So a
 * whole document is checked a slice at a time, handing back to the writer in
 * between, and a keystroke checks nothing itself and then only its paragraph.
 * Counted, not timed, so a busy machine can't fail it: the milliseconds are in
 * budget.timing.ts (`npm run timing`).
 */

// About 22 words, with something for most rules to find.
const LINE = 'The keeper climbed the stair and very quickly checked the lamp, which was cleaned every morning before the light came up over the harbour.'
const PARAGRAPHS = Math.ceil(50_000 / countWords(LINE))

let editor: Editor | undefined
afterEach(() => {
  vi.restoreAllMocks()
  editor?.destroy()
  document.body.replaceChildren()
})

it('checks a 50,000-word page in slices, and after a keystroke only its paragraph', { timeout: 60_000 }, async () => {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({ element, extensions: nibExtensions(true), content: `<p>${LINE}</p>`.repeat(PARAGRAPHS) })
  expect(countWords(editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n'))).toBeGreaterThanOrEqual(50_000)
  const view = editor.view

  // How many paragraphs each transaction checked.
  const slices: number[] = []
  const keystrokes: number[] = []
  const send = view.dispatch.bind(view)
  view.dispatch = (tr: Transaction) => {
    const before = checks.count
    send(tr)
    if (tr.getMeta(styleCheckKey)) slices.push(checks.count - before)
    else if (tr.docChanged) keystrokes.push(checks.count - before)
  }

  // A slice is cut by the clock: a clock that moves on each time it's read cuts the same ones on any machine.
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => ++now)

  const live = editor
  const settled = () => expect.poll(() => styleCheckKey.getState(live.state)!.dirty.length, { timeout: 30_000, interval: 5 }).toBe(0)

  editor.registerPlugin(styleCheck(new Set(RULES.map((rule) => rule.id))))
  await settled()
  expect(document.querySelectorAll('.nib-style').length).toBeGreaterThan(PARAGRAPHS)
  expect(slices.reduce((all, one) => all + one)).toBe(PARAGRAPHS)
  // Handed back to the writer again and again, no slice doing more than a few paragraphs.
  expect(slices.length).toBeGreaterThan(1)
  expect(Math.max(...slices)).toBeLessThan(20)
  slices.length = 0

  // Typing in the middle of the page, then pausing.
  const middle = editor.state.doc.resolve(Math.floor(editor.state.doc.content.size / 2))
  editor.commands.setTextSelection(middle.end())
  for (const char of ' really very slowly') view.dispatch(view.state.tr.insertText(char))
  expect(keystrokes.reduce((all, one) => all + one)).toBe(0)
  await settled()
  expect(slices.reduce((all, one) => all + one, 0)).toBe(1)
})
