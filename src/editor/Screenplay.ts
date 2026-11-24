import { Extension } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { asElement, fromFountain, isCue, nextElement, readLines, type Element, type Line, type Settable } from '../lib/fountain'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    screenplay: {
      /** The line the caret is in made `element` (lib/fountain asElement). */
      setLineElement: (element: Settable) => ReturnType
      /** Tab: the line made the next element, or the one before. */
      cycleElement: (step: 1 | -1) => ReturnType
    }
  }
}

/** The lines the caret is writing (`writer`): the one it came to empty, and the one it's writing, -1 for none. */
type Writer = { arrived: number; fresh: number }

/** Each line as read, the caret's line among them, and how they're drawn. */
export type ScriptState = { lines: Line[]; caret: number; seen: string; decorations: DecorationSet } & Writer
export const screenplayKey = new PluginKey<ScriptState>('screenplay')

/** Set on a transaction that makes the caret's line a character (`setLineElement`). */
const MADE_CHARACTER = 'character'

const words = (state: EditorState) => {
  const lines: string[] = []
  state.doc.forEach((node) => lines.push(node.textContent))
  return lines
}

/** The caret's line and the lines either side, all `writing` reads: a caret moved isn't the whole script read again. */
function near(state: EditorState, caret: number) {
  const lines: string[] = []
  for (let i = Math.max(0, caret - 1); i <= Math.min(state.doc.childCount - 1, caret + 1); i++) lines[i] = state.doc.child(i).textContent
  lines.length = state.doc.childCount
  return lines
}

/** The top-level line the caret is in, or -1 with a range selected. */
function caretLine(state: EditorState): number {
  const { $from, empty } = state.selection
  return empty && $from.depth >= 1 ? $from.index(0) : -1
}

/**
 * Which line the caret is writing: one it came to empty and has typed in, or
 * came to by making it (Return), or made a character with Tab or the bar. A
 * line only clicked into is read as it is, so it doesn't move under the caret.
 */
function writer(tr: Transaction, last: Writer & { caret: number }, state: EditorState, caret: number): Writer {
  let { arrived, fresh } = last
  if (caret !== last.caret) {
    arrived = caret >= 0 && state.doc.child(caret).content.size === 0 ? caret : -1
    fresh = tr.docChanged ? arrived : -1
  } else if (tr.docChanged && caret === arrived) fresh = caret
  if (tr.getMeta(screenplayKey) === MADE_CHARACTER) fresh = caret
  return { arrived, fresh }
}

/**
 * What the caret's line is being written as, which Fountain can't tell yet:
 * an empty line under a cue is where its dialogue goes ('typing'); a cue with
 * nothing under it yet is a character all the same ('cue'). Only the line the
 * caret is writing (`writer`); anything else is read as it is.
 */
function writing(lines: string[], caret: number, fresh: number): 'typing' | 'cue' | null {
  if (caret < 0 || caret !== fresh) return null
  const open = (at: number) => at >= lines.length || lines[at].trim() === ''
  if (lines[caret] === '' && caret > 0 && !open(caret - 1) && open(caret + 1)) return 'typing'
  if (lines[caret].trim() && open(caret + 1) && (caret === 0 || open(caret - 1)) && isCue(lines[caret])) return 'cue'
  return null
}

/** Where a line's forcing marks are, to be shown faint: . ! @ > ~ at its start, a centred line's < at its end, and the ^ of two speaking at once. */
function marks(raw: string, element: Element): [number, number][] {
  const lead = raw.length - raw.trimStart().length
  const first = raw[lead]
  const at = (char: string): [number, number][] => (first === char ? [[lead, lead + 1]] : [])
  if (element === 'scene') return at('.')
  if (element === 'action') return at('!')
  if (element === 'character') return [...at('@'), ...(raw.trimEnd().endsWith('^') ? [[raw.trimEnd().length - 1, raw.trimEnd().length] as [number, number]] : [])]
  if (element === 'transition') return at('>')
  if (element === 'lyric') return at('~')
  if (element === 'centered') return [...at('>'), [raw.trimEnd().length - 1, raw.trimEnd().length]]
  return []
}

/** A set as ProseMirror makes one inside itself: its constructor isn't in the public types. */
const Parts = DecorationSet as unknown as new (local: Decoration[], children: (number | DecorationSet)[]) => DecorationSet

/**
 * The script's decorations, put together in one pass from the two parts
 * ProseMirror keeps a set as: those on the document's own children (`local`,
 * in order: each line's element), and, for each child with any inside it,
 * where the child starts and ends and a set of its own (`children`, in
 * order: a line's forcing marks).
 *
 * ProseMirror's own ways cost with the square of the script's length, on
 * every key, and a film script is 6,000 lines: `create` and `map` look each
 * line up from the top for each line's decoration (64 ms a key there), and
 * drawing asks `forChild` for every line, which reads through every `local`
 * for ones that reach inside the line (21 ms). None here does: a line's
 * element is on the line, and its marks are in its own set, so `forChild`
 * here is that set, looked up.
 *
 * Screenplay.test.ts holds every set made here to the one `create` makes of
 * the same decorations, part for part and child for child: if ProseMirror
 * ever keeps a set another way, that says so.
 */
class ScriptSet extends Parts {
  private readonly inside = new Map<number, DecorationSet>()
  constructor(local: Decoration[], children: (number | DecorationSet)[]) {
    super(local, children)
    for (let i = 0; i < children.length; i += 3) this.inside.set(children[i] as number, children[i + 2] as DecorationSet)
  }
  override forChild(offset: number): DecorationSet {
    return this.inside.get(offset) ?? DecorationSet.empty
  }
}

/** A line's forcing marks shown faint, as a set of the line's own, by where they are in it: a script has only a few kinds. */
const faintSets = new Map<string, DecorationSet>()

function read(state: EditorState, at: Writer): ScriptState {
  const raw = words(state)
  const caret = caretLine(state)
  const how = writing(raw, caret, at.fresh)
  const lines = readLines(how === 'typing' ? raw.map((line, i) => (i === caret ? 'x' : line)) : raw)
  if (how === 'typing') lines[caret] = { ...lines[caret], text: '' }
  if (how === 'cue' && lines[caret].element === 'action') lines[caret] = { element: 'character', text: raw[caret].trim() }
  const local: Decoration[] = []
  const children: (number | DecorationSet)[] = []
  state.doc.forEach((node, offset, index) => {
    const line = lines[index]
    if (!line || line.element === 'blank') return
    local.push(Decoration.node(offset, offset + node.nodeSize, { class: `nib-sp-${line.element}${line.dual ? ' nib-sp-dual' : ''}` }))
    // Only where the line is its text alone, so its positions are its characters'.
    if (node.content.size !== raw[index].length) return
    const faint = marks(raw[index], line.element)
    if (faint.length === 0) return
    const key = faint.join(';')
    let set = faintSets.get(key)
    if (!set) faintSets.set(key, (set = new Parts(faint.map(([from, to]) => Decoration.inline(from, to, { class: 'nib-sp-mark' })), [])))
    children.push(offset, offset + node.nodeSize, set)
  })
  return { lines, caret, seen: how ? `${caret}:${how}` : '', decorations: local.length === 0 ? DecorationSet.empty : new ScriptSet(local, children), ...at }
}

/**
 * A page written as a screenplay (lib/fountain, Nib Plus): each line drawn
 * as what it is, by Fountain's rules, as it's typed. Tab makes the caret's
 * line the next element (`nextElement`), Shift-Tab the one before, and the
 * keyboard bar any (editor/FormatBar). Plain text pasted in keeps its lines,
 * empty ones too, which Fountain needs; its emphasis becomes the page's.
 *
 * Only in a screenplay's editor (extensions `nibEditor`), where the Markdown
 * shortcuts for blocks are off: #, >, - and = are Fountain's.
 */
export const Screenplay = Extension.create({
  name: 'screenplay',

  addCommands() {
    return {
      setLineElement:
        (element) =>
        ({ state, tr, dispatch }) => {
          const index = caretLine(state)
          const { $from } = state.selection
          if (index < 0 || $from.parent.type.name !== 'paragraph' || $from.depth !== 1) return false
          if (!dispatch) return true
          const old = $from.parent.textContent
          const { text, caret, before, after } = asElement(words(state), index, element)
          const start = $from.start(1)
          if ($from.parent.content.size !== old.length) tr.replaceWith(start, $from.end(1), text ? state.schema.text(text) : [])
          else {
            // Only what differs, so bold or italic elsewhere in the line stays.
            let same = 0
            while (same < old.length && same < text.length && old[same] === text[same]) same++
            let tail = 0
            while (tail < old.length - same && tail < text.length - same && old[old.length - 1 - tail] === text[text.length - 1 - tail]) tail++
            tr.insertText(text.slice(same, text.length - tail), start + same, start + old.length - tail)
          }
          const paragraph = state.schema.nodes.paragraph
          if (after) tr.insert(tr.mapping.map($from.after(1)), paragraph.create())
          if (before) tr.insert($from.before(1), paragraph.create())
          tr.setSelection(TextSelection.create(tr.doc, start + (before ? 2 : 0) + caret))
          if (element === 'character') tr.setMeta(screenplayKey, MADE_CHARACTER)
          dispatch(tr.scrollIntoView())
          return true
        },
      cycleElement:
        (step) =>
        ({ state, commands }) => {
          const read = screenplayKey.getState(state)
          const index = caretLine(state)
          if (!read || index < 0) return false
          return commands.setLineElement(nextElement(read.lines[index]?.element ?? 'action', step))
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.cycleElement(1),
      'Shift-Tab': () => this.editor.commands.cycleElement(-1),
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<ScriptState>({
        key: screenplayKey,
        state: {
          init: (_, state) => {
            const caret = caretLine(state)
            return read(state, { arrived: caret >= 0 && state.doc.child(caret).content.size === 0 ? caret : -1, fresh: -1 })
          },
          apply: (tr, last, _old, state) => {
            const caret = caretLine(state)
            const at = writer(tr, last, state, caret)
            if (tr.docChanged) return read(state, at)
            const how = writing(near(state, caret), caret, at.fresh)
            const seen = how ? `${caret}:${how}` : ''
            if (seen !== last.seen) return read(state, at)
            return caret === last.caret && at.arrived === last.arrived && at.fresh === last.fresh ? last : { ...last, caret, ...at }
          },
        },
        props: {
          decorations: (state) => screenplayKey.getState(state)?.decorations,
          clipboardTextParser: (text, _context, _plain, view) => new Slice(view.state.schema.nodeFromJSON(fromFountain(text)).content, 1, 1),
        },
      }),
    ]
  },
})
