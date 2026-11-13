import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { check, type Rule } from './rules'

/**
 * The style check, as a ProseMirror plugin that only draws: it adds
 * decorations and never touches the document. It's registered on the live
 * editor (Editor.tsx), never in `nibExtensions`, which is the schema that
 * export, copying and every conversion are built from, so the underlines
 * can't leak into any of them.
 *
 * Only paragraphs that changed are checked again, a moment after typing
 * stops, and never mid-composition (IME, Scribble). A whole document is
 * checked in slices, so a long one never holds up typing.
 *
 * With Nib Plus the flags are underlined. Without it they're only counted
 * (`suggestions`), and nothing is drawn.
 */

type Range = { from: number; to: number }
type Meta = { recheck: true } | { rules: ReadonlySet<Rule> }
type State = { decorations: DecorationSet; dirty: Range[]; rules: ReadonlySet<Rule>; underline: boolean }

export const styleCheckKey = new PluginKey<State>('styleCheck')

/** How long typing must pause before the changed paragraphs are checked. */
export const DEBOUNCE_MS = 300
/** The most one slice of checking takes, so typing is never kept waiting. */
const SLICE_MS = 10

// Code isn't prose, and headings are short labels.
const checked = (node: ProseMirrorNode) => node.isTextblock && node.type.name !== 'codeBlock' && node.type.name !== 'heading'

/** Paragraphs checked so far, for tests to see that only changed ones are. */
export const checks = { count: 0 }

function decorate(node: ProseMirrorNode, pos: number, rules: ReadonlySet<Rule>): Decoration[] {
  checks.count++
  // A picture, footnote or line break counts as one character, as it does as a position.
  const text = node.textBetween(0, node.content.size, undefined, '\ufffc')
  const flags = check(text, rules)
  // ProseMirror merges overlapping decorations into one span with one title,
  // and which title wins isn't up to us. So overlaps are cut into pieces
  // here: each carries every rule that covers it, and the reason of the
  // narrowest, so "quickly" inside a passive says it's an adverb.
  const points = [...new Set(flags.flatMap((flag) => [flag.from, flag.to]))].sort((a, b) => a - b)
  const decorations: Decoration[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const [from, to] = [points[i], points[i + 1]]
    const covering = flags.filter((flag) => flag.from <= from && flag.to >= to)
    if (!covering.length) continue
    const narrowest = covering.reduce((best, flag) => (flag.to - flag.from < best.to - best.from ? flag : best))
    const classes = ['nib-style', ...new Set(covering.map((flag) => `nib-style-${flag.rule}`))].join(' ')
    // Each flag is counted once, in the piece it begins in.
    const starts = covering.filter((flag) => flag.from === from).length
    decorations.push(Decoration.inline(pos + 1 + from, pos + 1 + to, { class: classes, title: narrowest.reason }, { reason: narrowest.reason, starts }))
  }
  return decorations
}

/** Overlapping and touching ranges as one, in order, within the document. */
function merged(ranges: Range[], size: number): Range[] {
  const sorted = ranges
    .map(({ from, to }) => ({ from: Math.max(0, Math.min(from, size)), to: Math.max(0, Math.min(to, size)) }))
    .sort((a, b) => a.from - b.from)
  const out: Range[] = []
  for (const range of sorted) {
    const last = out.at(-1)
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to)
    else out.push({ ...range })
  }
  return out
}

/** Checks the paragraphs in `dirty` until the slice's time is up. Returns what's left. */
function recheck(doc: ProseMirrorNode, state: State): State {
  const started = performance.now()
  const ranges = merged(state.dirty, doc.content.size)
  const remove: Decoration[] = []
  const add: Decoration[] = []
  const left: Range[] = []
  for (const range of ranges) {
    if (left.length) {
      left.push(range)
      continue
    }
    doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (left.length) return false
      if (!node.isTextblock) return true
      if (performance.now() - started > SLICE_MS) {
        left.push({ from: pos, to: range.to })
        return false
      }
      remove.push(...state.decorations.find(pos, pos + node.nodeSize))
      if (checked(node)) add.push(...decorate(node, pos, state.rules))
      return false
    })
  }
  return { ...state, decorations: state.decorations.remove(remove).add(doc, add), dirty: left }
}

export function styleCheck(rules: ReadonlySet<Rule>, { underline = true }: { underline?: boolean } = {}): Plugin<State> {
  return new Plugin<State>({
    key: styleCheckKey,
    state: {
      init: (_, { doc }) => ({ decorations: DecorationSet.empty, dirty: [{ from: 0, to: doc.content.size }], rules, underline }),
      apply(tr, value, _old, next) {
        let state = value
        if (tr.docChanged) {
          // Underlines move with the text; what changed is marked for checking.
          const dirty = state.dirty.map(({ from, to }) => ({ from: tr.mapping.map(from, -1), to: tr.mapping.map(to, 1) }))
          tr.mapping.maps.forEach((map, index) => {
            const after = tr.mapping.slice(index + 1)
            map.forEach((_oldFrom, _oldTo, from, to) => dirty.push({ from: after.map(from, -1), to: after.map(to, 1) }))
          })
          state = { ...state, decorations: state.decorations.map(tr.mapping, tr.doc), dirty }
        }
        const meta = tr.getMeta(styleCheckKey) as Meta | undefined
        if (meta && 'rules' in meta) state = { ...state, decorations: DecorationSet.empty, dirty: [{ from: 0, to: next.doc.content.size }], rules: meta.rules }
        if (meta && 'recheck' in meta) state = recheck(next.doc, state)
        return state
      },
    },
    props: {
      decorations: (state) => {
        const value = styleCheckKey.getState(state)
        return value?.underline ? value.decorations : undefined
      },
    },
    view(view) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const later = (delay: number) => {
        clearTimeout(timer)
        timer = setTimeout(run, delay)
      }
      function run() {
        if (view.isDestroyed) return
        // Decorations mid-composition can break what's being composed.
        if (view.composing) return later(DEBOUNCE_MS)
        if (!styleCheckKey.getState(view.state)?.dirty.length) return
        view.dispatch(view.state.tr.setMeta(styleCheckKey, { recheck: true } satisfies Meta).setMeta('addToHistory', false))
        // A whole document goes in slices, one after another.
        if (styleCheckKey.getState(view.state)?.dirty.length) later(0)
      }
      later(0)
      return {
        update(view, previous) {
          const rules = styleCheckKey.getState(view.state)?.rules
          if (rules !== styleCheckKey.getState(previous)?.rules) later(0)
          else if (view.state.doc !== previous.doc) later(DEBOUNCE_MS)
        },
        destroy: () => clearTimeout(timer),
      }
    },
  })
}

/** Runs the check again with these rules, for when a rule is switched on or off. */
export const withRules = (rules: ReadonlySet<Rule>) => ({ rules }) satisfies Meta

/** The reason for an underline at `pos`, if any: for the status line, where there's no hover. */
export function reasonAt(state: EditorState, pos: number): string | null {
  const value = styleCheckKey.getState(state)
  if (!value?.underline) return null
  const found = value.decorations.find(pos, pos)
  return (found?.[0]?.spec as { reason?: string } | undefined)?.reason ?? null
}

export const styleChecking = (state: EditorState) => styleCheckKey.getState(state) !== undefined

/** How many flags the check has found so far, underlined or not. */
export function suggestions(state: EditorState): number {
  const found = styleCheckKey.getState(state)?.decorations.find() ?? []
  return found.reduce((total, decoration) => total + ((decoration.spec as { starts?: number }).starts ?? 0), 0)
}

/** Whether the flags are underlined (Nib Plus) or only counted. */
export const styleUnderlined = (state: EditorState) => styleCheckKey.getState(state)?.underline === true
