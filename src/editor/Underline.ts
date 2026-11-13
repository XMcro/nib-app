import { Mark } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    underline: { toggleUnderline: () => ReturnType }
  }
}

/**
 * No attributes, so nothing on a pasted `<u>` or styled span can reach the
 * DOM. Apple Notes and Word paste `<u>`; Google Docs pastes a span styled
 * `text-decoration: underline`, which is read too. Markdown has no underline,
 * so export writes the `<u>` tag (see lib/markdown).
 */
export const Underline = Mark.create({
  name: 'underline',

  parseHTML() {
    return [
      { tag: 'u' },
      {
        style: 'text-decoration',
        consuming: false,
        getAttrs: (value) => (String(value).includes('underline') ? {} : false),
      },
    ]
  },

  renderHTML() {
    return ['u', 0]
  },

  addCommands() {
    return {
      toggleUnderline:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    }
  },

  addKeyboardShortcuts() {
    return { 'Mod-u': () => this.editor.commands.toggleUnderline() }
  },
})
