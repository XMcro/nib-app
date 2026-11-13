import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'

/**
 * On a touch screen there's no hover, so the reason for an underline shows in
 * the status line while the caret is in it.
 */

vi.mock('../../lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platform')>()),
  touchApp: true,
}))

const { nibExtensions } = await import('../extensions')
const { EditorStatus } = await import('../EditorStatus')
const { DEBOUNCE_MS, styleCheck } = await import('./plugin')
const { RULES } = await import('./rules')

let editor: Editor | undefined
afterEach(() => {
  cleanup()
  editor?.destroy()
  document.body.replaceChildren()
})

it('shows the reason for the underline the caret is in, in place of the count', async () => {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({ element, extensions: nibExtensions(true), content: '<p>She ran quickly home.</p>' })
  render(<EditorStatus editor={editor} />)
  editor.registerPlugin(styleCheck(new Set(RULES.map((rule) => rule.id))))
  await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS))

  const line = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].at(-1)!
  editor.commands.setTextSelection(3) // in "She"
  await waitFor(() => expect(line().textContent).toBe('4 words · 1 min'))
  editor.commands.setTextSelection(12) // in "quickly"
  await waitFor(() => expect(line().textContent).toBe('Adverb: a stronger verb might do the work of “quickly”.'))

  editor.commands.setTextSelection(3)
  await waitFor(() => expect(line().textContent).toBe('4 words · 1 min'))
  line().click()
  expect(await screen.findByText('Checked on this device')).toBeTruthy()
})
