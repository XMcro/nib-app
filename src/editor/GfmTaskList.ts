import { Extension, InputRule, type ChainedCommands } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'

/** `[ ] `, `[x] `, or the GFM form with a bullet marker in front. */
const CHECKBOX = /^\s*[-*+]?\s*\[([ xX])\]\s$/

function ancestorListKind(state: EditorState): 'task' | 'plain' | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name
    if (name === 'taskItem') return 'task'
    if (name === 'listItem') return 'plain'
  }
  return null
}

/**
 * GFM writes `- [ ] `, and so does Nib's own export. TipTap only recognises a
 * bare `[ ] ` at the start of a paragraph, which leaves two gaps:
 *
 *  - after `- ` has already produced a bullet list, its rule cannot wrap a
 *    list item, so the brackets survive as literal text;
 *  - inside an existing task list nothing consumes the prefix at all.
 *
 * Handle both, so the syntax Nib writes is the syntax Nib accepts.
 */
export const GfmTaskList = Extension.create({
  name: 'gfmTaskList',

  addInputRules() {
    return [
      new InputRule({
        find: CHECKBOX,
        handler: ({ state, range, match, chain }) => {
          const where = ancestorListKind(state)
          // A bare `[ ] ` in ordinary prose is already the stock rule's job;
          // returning null lets it run.
          if (where === null) return null

          const checked = match[1].toLowerCase() === 'x'
          const commands = (chain() as ChainedCommands).deleteRange(range)
          if (where === 'plain') commands.toggleTaskList()
          commands.updateAttributes('taskItem', { checked }).run()
        },
      }),
    ]
  },
})
