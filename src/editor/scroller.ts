import type { Editor } from '@tiptap/core'

/** What the text scrolls in: App's `data-scroll`, around the editor. Null with none around it. */
export const scrollerOf = (editor: Editor) => editor.view.dom.closest('[data-scroll]')
