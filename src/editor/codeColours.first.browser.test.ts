import { expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { nibEditor } from './extensions'

// A file of its own: nothing before this may have fetched the grammars.
it('fetches the grammars when a block in a document with none is given a language', async () => {
  const element = document.body.appendChild(document.createElement('div'))
  const editor = new Editor({ element, ...nibEditor(true), content: { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'def go(): pass' }] }] } })
  const menu = editor.view.dom.querySelector('select')!
  menu.value = 'python'
  menu.dispatchEvent(new Event('change', { bubbles: true }))
  await vi.waitFor(() => expect(editor.view.dom.querySelector('.nib-code-keyword')?.textContent).toBe('def'), { timeout: 10_000 })
  editor.destroy()
})
