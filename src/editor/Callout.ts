import { mergeAttributes, Node } from '@tiptap/core'
import { Plugin, Selection } from '@tiptap/pm/state'
import { asCalloutKind, CALLOUT_KINDS, CALLOUT_NAMES, type CalloutKind } from '../lib/callouts'

const CIRCLE = 'M8 1.75a6.25 6.25 0 1 0 0 12.5a6.25 6.25 0 1 0 0-12.5z'
const ICONS: Record<CalloutKind, string> = {
  note: 'M4.5 1.75h5l3 3v9.5h-8z M9.5 1.75v3h3 M6.5 8.25h3.5 M6.5 10.75h3.5',
  info: `${CIRCLE} M8 7.25v4 M8 4.9v.1`,
  tip: 'M6 11.25c0-1.3-1.75-2.1-1.75-4.5a3.75 3.75 0 1 1 7.5 0c0 2.4-1.75 3.2-1.75 4.5z M6.25 13.75h3.5',
  success: `${CIRCLE} M5.25 8.25l2 2l3.5-4`,
  question: `${CIRCLE} M6.2 6.25a1.85 1.85 0 1 1 2.85 1.55c-.7.45-1.05.8-1.05 1.55 M8 11.4v.1`,
  important: 'M8 1.9l1.85 3.85l4.2.55l-3.1 2.9l.8 4.15L8 11.3l-3.75 2.05l.8-4.15l-3.1-2.9l4.2-.55z',
  warning: 'M8 2.25l6.25 11H1.75z M8 6.5v3.25 M8 11.4v.1',
  caution: 'M5.4 1.75h5.2l3.65 3.65v5.2l-3.65 3.65H5.4l-3.65-3.65V5.4z M8 4.9v3.85 M8 11v.1',
}

/** A line drawing for a control in the text: a callout's, and a fold's (fold.ts). */
export function icon(path: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  const line = svg.appendChild(document.createElementNS(NS, 'path'))
  line.setAttribute('d', path)
  return svg
}

/**
 * A box around some writing, of one of eight kinds, that can fold down to its
 * first line. Its type is a native menu laid over the icon, so a phone and a
 * Mac each show their own.
 *
 * A document made here shows on a Nib from before callouts with the box taken
 * off and every word still there (fitSchema).
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: 'note',
        parseHTML: (element) => asCalloutKind(element.getAttribute('data-callout')) ?? 'note',
        renderHTML: (attributes) => ({ 'data-callout': asCalloutKind(attributes.kind) ?? 'note' }),
      },
      collapsed: {
        default: false,
        parseHTML: (element) => element.hasAttribute('data-collapsed'),
        renderHTML: (attributes) => (attributes.collapsed === true ? { 'data-collapsed': '' } : {}),
      },
    }
  },

  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes), 0],

  addNodeView() {
    return ({ node: first, getPos, editor }) => {
      let node = first
      const dom = document.createElement('div')
      dom.className = 'nib-callout'

      const type = dom.appendChild(document.createElement('div'))
      type.className = 'nib-callout-kind'
      type.contentEditable = 'false'
      const picture = type.appendChild(document.createElement('span'))
      const menu = type.appendChild(document.createElement('select'))
      menu.setAttribute('aria-label', 'Callout type')
      for (const kind of CALLOUT_KINDS) menu.append(new Option(CALLOUT_NAMES[kind], kind))

      const contentDOM = dom.appendChild(document.createElement('div'))
      contentDOM.className = 'nib-callout-body'

      const fold = dom.appendChild(document.createElement('button'))
      fold.type = 'button'
      fold.className = 'nib-callout-fold'
      fold.contentEditable = 'false'
      fold.append(icon('M4.5 6.25L8 9.75l3.5-3.5'))

      const paint = (collapsed: boolean) => {
        const kind = asCalloutKind(node.attrs.kind) ?? 'note'
        dom.dataset.callout = kind
        dom.toggleAttribute('data-collapsed', collapsed)
        picture.replaceChildren(icon(ICONS[kind]))
        menu.value = kind
        fold.setAttribute('aria-expanded', String(!collapsed))
        fold.setAttribute('aria-label', collapsed ? 'Expand callout' : 'Collapse callout')
      }
      paint(node.attrs.collapsed === true)

      const change = (attrs: object, then?: (tr: typeof editor.state.tr, at: number) => void) => {
        const at = getPos()
        if (typeof at !== 'number') return
        const tr = editor.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, ...attrs })
        then?.(tr, at)
        editor.view.dispatch(tr)
      }

      menu.addEventListener('change', () => {
        if (editor.isEditable) change({ kind: menu.value })
        else paint(dom.hasAttribute('data-collapsed'))
      })

      // Pressing it mustn't take the caret out of the text, on a phone the keyboard with it.
      fold.addEventListener('mousedown', (event) => event.preventDefault())
      fold.addEventListener('click', () => {
        const collapsed = !dom.hasAttribute('data-collapsed')
        // A read-only document doesn't change: this is only what's showing.
        if (!editor.isEditable) return paint(collapsed)
        change({ collapsed }, (tr, at) => {
          // Off the lines being folded away, or they'd open again around it.
          const firstLineEnd = at + 1 + node.child(0).nodeSize
          const { head } = editor.state.selection
          if (collapsed && head > firstLineEnd && head < at + node.nodeSize) tr.setSelection(Selection.near(tr.doc.resolve(firstLineEnd - 1), -1))
          // Showing or hiding isn't an edit to undo.
          tr.setMeta('addToHistory', false)
        })
      })

      return {
        dom,
        contentDOM,
        update(updated) {
          if (updated.type !== node.type) return false
          node = updated
          paint(node.attrs.collapsed === true)
          return true
        },
        stopEvent: (event) => type.contains(event.target as globalThis.Node) || fold.contains(event.target as globalThis.Node),
      }
    }
  },

  // Find, or an arrow key, going into the folded lines opens them.
  addProseMirrorPlugins() {
    const { editor, name } = this
    return [
      new Plugin({
        appendTransaction: (transactions, _, state) => {
          if (!editor.isEditable || !transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null
          const { $head } = state.selection
          for (let depth = $head.depth; depth > 0; depth--) {
            const node = $head.node(depth)
            if (node.type.name === name && node.attrs.collapsed === true && $head.index(depth) > 0) {
              return state.tr.setNodeMarkup($head.before(depth), undefined, { ...node.attrs, collapsed: false }).setMeta('addToHistory', false)
            }
          }
          return null
        },
      }),
    ]
  },
})
