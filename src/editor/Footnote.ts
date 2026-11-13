import { Node, mergeAttributes } from '@tiptap/core'

/**
 * An inline atom holding its own text. Numbering is a CSS counter, and the
 * text surfaces on hover via `title` — so there is no separate footnotes
 * section to render, position, or keep in sync.
 */
export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      text: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-text') ?? '',
        renderHTML: (attributes) => ({
          'data-text': attributes.text,
          title: attributes.text,
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'sup',
      mergeAttributes(HTMLAttributes, { 'data-footnote': '', class: 'nib-footnote' }),
    ]
  },
})
