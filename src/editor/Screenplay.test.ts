// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { DecorationSet } from '@tiptap/pm/view'
import { fromFountain } from '../lib/fountain'
import { nibEditor } from './extensions'
import { screenplayKey } from './Screenplay'

/**
 * How a screenplay's lines are drawn (./Screenplay). The set of decorations
 * is put together there in one pass, from the parts ProseMirror keeps a set
 * as, since ProseMirror's own `create` costs with the square of the script's
 * length on every key. Its parts aren't in ProseMirror's public types, so
 * every set made is held here to the one `create` makes from the same
 * decorations: if ProseMirror ever keeps them another way, this says so.
 */

const SCRIPT = ['INT. LIGHTHOUSE - NIGHT', '', 'Mara climbs the ninety-one steps.', '', 'MARA', '(quietly)', 'The lamp is cold.', '', 'JOE ^', 'It always is.', '', '> CUT TO:', '', '.the gallery', '', '!ACTION forced', '', '@mara', 'Lower case, forced.', '', '>Centred<', ''].join('\n')

let editor: Editor
afterEach(() => editor?.destroy())
const start = (script: string) => (editor = new Editor({ element: document.createElement('div'), ...nibEditor(true, true), content: fromFountain(script) }))

const kept = () => screenplayKey.getState(editor.state)!.decorations
const said = () =>
  kept()
    .find()
    .map((one) => `${one.from}-${one.to}:${(one as unknown as { type: { attrs: { class: string } } }).type.attrs.class}`)
    .sort()
/** As ProseMirror makes a set of the same decorations itself. */
const itsOwn = () => DecorationSet.create(editor.state.doc, kept().find())
/** A set's two parts, and what it gives each line to draw inside it. */
const parts = (set: DecorationSet) => {
  const { local, children } = set as unknown as { local: unknown[]; children: unknown[] }
  const lines: unknown[] = []
  editor.state.doc.forEach((node, offset) => lines.push(set.forChild(offset, node)))
  return { local, children, lines }
}
const asItsOwn = (hint?: string) => expect(parts(kept()), hint).toEqual(parts(itsOwn()))

/** The same numbers every run. */
function dice(seed: number) {
  return (below: number) => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return Math.floor((seed / 4294967296) * below)
  }
}

describe('a screenplay’s lines, drawn as it’s written', () => {
  it('are drawn for each element, with its forcing marks faint', () => {
    start(SCRIPT)
    const drawn = said()
    for (const element of ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'centered']) expect(drawn.some((one) => one.endsWith(`nib-sp-${element}`) || one.endsWith(`nib-sp-${element} nib-sp-dual`)), element).toBe(true)
    // . ! @ and a transition’s >, both ends of a centred line, and the ^ of two speaking at once.
    expect(drawn.filter((one) => one.endsWith('nib-sp-mark'))).toHaveLength(7)
    asItsOwn()
  })

  it('are a set just as ProseMirror would make it, through typing, new lines, lines joined and taken out, and the caret moved', () => {
    start(SCRIPT)
    const roll = dice(7)
    const WORDS = ['x', ' ', 'MARA', '(', ')', '.', '>', '<', '^', '@', '!', 'INT. ', 'the lamp']
    for (let step = 0; step < 400; step++) {
      const { state, view } = editor
      const lines: { from: number; size: number }[] = []
      state.doc.forEach((node, offset) => lines.push({ from: offset, size: node.content.size }))
      const line = lines[roll(lines.length)]
      const inside = line.from + 1 + roll(line.size + 1)
      const act = roll(10)
      if (act < 4) view.dispatch(state.tr.insertText(WORDS[roll(WORDS.length)], inside))
      else if (act < 5 && line.size > 0) view.dispatch(state.tr.delete(line.from + 1, line.from + 1 + roll(line.size) + 1))
      else if (act < 7) view.dispatch(state.tr.split(inside))
      else if (act < 8 && line.from > 0) view.dispatch(state.tr.join(line.from))
      else if (act < 9 && lines.length > 3) view.dispatch(state.tr.delete(line.from, line.from + line.size + 2))
      else view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, inside)))
      asItsOwn(`after step ${step}`)
    }
  })

  it('with nothing to draw, is the empty set', () => {
    start('')
    expect(kept()).toBe(DecorationSet.empty)
  })
})

describe('the caret’s line, while it’s being written', () => {
  const element = (line: number) => screenplayKey.getState(editor.state)!.lines[line].element
  /** The caret put in `line`, as a click does. */
  const into = (line: number, at = 1) => {
    let from = 0
    editor.state.doc.forEach((node, offset, index) => void (index === line && (from = offset + Math.min(at, node.content.size + 1))))
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from)))
  }
  const type = (text: string) => editor.view.dispatch(editor.state.tr.insertText(text))

  it('isn’t moved by a click: a line in capitals with nothing said under it stays action, and so does a typo put right in it', () => {
    start(['INSIDE OUT', '', 'Dad lifts a spoon.', '', 'CUT TO:', '', '', 'Later.'].join('\n'))
    into(0)
    expect(element(0)).toBe('action')
    type('S')
    expect(element(0)).toBe('action')
    // Nor the line above an empty one clicked into.
    into(5)
    expect(element(4)).toBe('transition')
  })

  it('is a character as a name is typed on a line begun empty, and its line under it is dialogue to come', () => {
    start(['Dad lifts a spoon.', '', '', '', 'Later.'].join('\n'))
    into(2)
    type('JOY')
    expect(element(2)).toBe('character')
    editor.view.dispatch(editor.state.tr.split(editor.state.selection.from))
    expect(element(2)).toBe('character')
    expect(element(3)).toBe('dialogue')
    // Left with nothing said, it's action, as Fountain reads it; clicked into again, it stays so.
    into(0)
    expect(element(2)).toBe('action')
    into(2)
    expect(element(2)).toBe('action')
  })

  it('is a character when Tab makes it one, from action, until the caret leaves it with nothing said under it', () => {
    start(['INSIDE OUT', '', 'Dad lifts a spoon.'].join('\n'))
    into(0)
    editor.commands.cycleElement(1)
    expect(element(0)).toBe('character')
    expect(editor.state.doc.child(0).textContent).toBe('INSIDE OUT')
    into(2)
    expect(element(0)).toBe('action')
  })
})
