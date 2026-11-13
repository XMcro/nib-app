import { InputRule, mergeAttributes, Node, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { NodeView } from '@tiptap/pm/view'
import { drawMath, looksLikeMath } from '../lib/math'

/**
 * A formula: its LaTeX is the node's own text, so a Nib from before formulas
 * shows it as written and loses nothing (fitSchema keeps the words of what it
 * doesn't know). Here it is drawn (lib/math), and tapped or clicked, or Return
 * pressed with it chosen, its LaTeX is shown in a field to change. In a line
 * (`mathInline`, typed as `$…$`) or on one of its own (`mathBlock`, `$$` and
 * a space at the start of a line).
 */

/** Asks the formula drawn at this element to show its field. */
const OPEN = 'nibmathopen'

function view(block: boolean) {
  return ({ node: first, getPos, editor }: { node: PMNode; getPos: () => number | undefined; editor: Editor }): NodeView => {
    let node = first
    const dom = document.createElement(block ? 'div' : 'span')
    dom.className = 'nib-math'
    dom.toggleAttribute('data-block', block)
    const drawn = dom.appendChild(document.createElement('span'))
    drawn.className = 'nib-math-drawn'
    const field = dom.appendChild(document.createElement(block ? 'textarea' : 'input'))
    field.className = 'nib-math-source'
    field.setAttribute('aria-label', 'LaTeX')
    field.spellcheck = false
    field.autocapitalize = 'off'
    field.setAttribute('autocorrect', 'off')
    if (field instanceof HTMLTextAreaElement) field.rows = 1
    field.hidden = true

    const draw = (tex: string) => {
      dom.toggleAttribute('data-empty', !tex.trim())
      void drawMath(tex.trim() || (block ? 'Formula' : 'formula'), drawn, block)
    }
    draw(node.textContent)

    const fit = () => {
      if (field instanceof HTMLTextAreaElement) {
        // As tall as its lines, and as a long line's wrapped ones: on a phone most of a formula's LaTeX wraps, and its first lines were out of sight.
        field.style.height = 'auto'
        field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`
      } else field.size = Math.max(4, field.value.length + 1)
    }
    const open = () => {
      if (!editor.isEditable || !field.hidden) return
      field.value = node.textContent
      field.hidden = false
      fit()
      dom.toggleAttribute('data-editing', true)
      field.focus()
      field.select()
    }
    /** Puts the field's LaTeX in the document, as one change; a formula left empty is taken out. */
    const close = (keep: boolean) => {
      if (field.hidden) return
      field.hidden = true
      dom.removeAttribute('data-editing')
      const at = editor.isDestroyed ? undefined : getPos()
      const tex = field.value.trim()
      if (at === undefined || !keep || tex === node.textContent) return draw(node.textContent)
      const { state } = editor.view
      const tr = tex ? state.tr.replaceWith(at + 1, at + node.nodeSize - 1, state.schema.text(tex)) : state.tr.delete(at, at + node.nodeSize)
      editor.view.dispatch(tr)
    }
    /** Back to the writing, after the formula. */
    const leave = (keep: boolean) => {
      const at = getPos()
      close(keep)
      if (at === undefined) return
      const { state } = editor.view
      const after = Math.min(at + (state.doc.nodeAt(at)?.type === node.type ? state.doc.nodeAt(at)!.nodeSize : 0), state.doc.content.size)
      editor.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(after), 1)))
      editor.view.focus()
    }

    dom.addEventListener(OPEN, open)
    // A press on the drawing chooses the formula, as the editor does for any such thing; the click that follows opens it.
    drawn.addEventListener('click', open)
    field.addEventListener('input', () => {
      fit()
      draw(field.value)
    })
    field.addEventListener('blur', () => close(true))
    ;(field as HTMLElement).addEventListener('keydown', (event) => {
      if (event.key === 'Escape') leave(false)
      // Return ends a formula in a line; one on its own lines can have several, and ⌘Return ends it.
      else if (event.key === 'Enter' && (!block || event.metaKey || event.ctrlKey)) leave(true)
      else return
      event.preventDefault()
    })

    return {
      dom,
      update(updated) {
        if (updated.type !== node.type) return false
        const changed = updated.textContent !== node.textContent
        node = updated
        if (changed && field.hidden) draw(node.textContent)
        return true
      },
      // What's typed in the field is the field's, till it's closed.
      stopEvent: (event) => field.contains(event.target as globalThis.Node),
      ignoreMutation: () => true,
      destroy: () => dom.removeEventListener(OPEN, open),
    }
  }
}

/** Opens the field of the formula at `pos`, once it is drawn. */
function openAt(editor: Editor, pos: number) {
  requestAnimationFrame(() => {
    if (!editor.isDestroyed) editor.view.nodeDOM(pos)?.dispatchEvent(new Event(OPEN))
  })
}

/** Return, with a formula chosen, opens it. */
function openChosen(editor: Editor, name: string): boolean {
  const { selection } = editor.state
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== name) return false
  openAt(editor, selection.from)
  return true
}

const shared = {
  content: 'text*',
  // LaTeX, not prose: no bold in it, no note to self on it.
  marks: '',
  atom: true,
  code: true,
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  ...shared,
  parseHTML: () => [{ tag: 'span[data-math]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-math': '' }), 0],
  addNodeView: () => view(false),
  addKeyboardShortcuts() {
    return { Enter: () => openChosen(this.editor, this.name) }
  },
  addInputRules() {
    return [
      // `$…$`, closed: after a space or at a line's start, with no space inside either dollar.
      // What comes before is matched and put back: iOS 15 has no lookbehind, and wouldn't load the script at all.
      new InputRule({
        find: /(^|[\s(])\$([^\s$](?:[^$\n]*[^\s$])?)\$$/,
        handler: ({ state, range, match }) => {
          if (!looksLikeMath(match[2])) return null
          state.tr.replaceWith(range.from + match[1].length, range.to, this.type.create(null, state.schema.text(match[2])))
        },
      }),
    ]
  },
})

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  ...shared,
  parseHTML: () => [{ tag: 'div[data-math]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-math': '' }), 0],
  addNodeView: () => view(true),
  addKeyboardShortcuts() {
    return { Enter: () => openChosen(this.editor, this.name) }
  },
  addInputRules() {
    return [
      // `$$` and a space, alone at a line's start: a formula on its own lines, opened to be written.
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          // The dollars are all the line holds: the space that ends them isn't in it yet.
          if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size !== range.to - range.from) return null
          // With a line after it where it ends what it's in: nothing else lets the writing go on below a formula, least of all on a phone.
          const last = $from.index(-1) === $from.node(-1).childCount - 1
          state.tr.replaceWith($from.before(), $from.after(), last ? [this.type.create(), $from.parent.type.create()] : this.type.create())
          openAt(this.editor, $from.before())
        },
      }),
    ]
  },
})
