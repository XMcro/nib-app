import { expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { coloursFor } from './codeColours'
import { nibEditor } from './extensions'

// A file of its own: once a worker is refused none is asked for again.
it('leaves code as it is, the document open, and an export not waiting, when the worker can’t start', async () => {
  const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw new Error('refused')
      }
    },
  )
  const element = document.body.appendChild(document.createElement('div'))
  const editor = new Editor({ element, ...nibEditor(true), content: { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: 'const a' }] }] } })
  editor.commands.insertContentAt(1, 'x')
  expect(editor.getText()).toBe('xconst a')
  expect(editor.view.dom.querySelector('.nib-code-keyword')).toBeNull()
  expect(warned).toHaveBeenCalledTimes(1)
  await coloursFor([{ type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'pass' }] }] }])
  editor.destroy()
  vi.unstubAllGlobals()
})
