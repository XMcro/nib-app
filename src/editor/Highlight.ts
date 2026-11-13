import { Mark } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlight: { toggleHighlight: () => ReturnType }
  }
}

/**
 * One colour, set by the theme (index.css), so it reads in light and dark
 * alike. No attributes: a pasted `<mark style=…>` brings no colour of its own.
 * Markdown has no standard highlight, so export writes the `<mark>` tag.
 */
export const Highlight = Mark.create({
  name: 'highlight',

  parseHTML() {
    return [{ tag: 'mark' }]
  },

  renderHTML() {
    return ['mark', 0]
  },

  addCommands() {
    return {
      toggleHighlight:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    }
  },

  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.toggleHighlight() }
  },
})
