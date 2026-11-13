import { useEffect, useEffectEvent } from 'react'
import type { Editor } from '@tiptap/core'
import type { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * A plugin on the live editor, never part of its schema, for as long as
 * `when` holds, and made again when `when` changes. `first`: before the
 * editor's own, so its keys come before theirs.
 */
export function useEditorPlugin(editor: Editor | null, make: (editor: Editor) => Plugin, key: PluginKey, { when = true, first = false }: { when?: unknown; first?: boolean } = {}) {
  const made = useEffectEvent(make)
  useEffect(() => {
    if (!editor || !when) return
    editor.registerPlugin(made(editor), first ? (plugin, plugins) => [plugin, ...plugins] : undefined)
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(key)
    }
  }, [editor, key, when, first])
}
