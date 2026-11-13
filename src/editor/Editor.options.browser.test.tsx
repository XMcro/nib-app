import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { Editor } from './Editor'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('the editor between renders', () => {
  it('keeps its options, so being drawn again doesn’t reconfigure the view', async () => {
    let editor: TiptapEditor | null = null
    const drawn = (onChange: () => void) => (
      <div data-scroll>
        <Editor kind="page" focus={false} onChange={onChange} onEditor={(live) => (editor = live)} />
      </div>
    )
    const { rerender } = render(drawn(() => {}))
    await waitFor(() => expect(editor).not.toBeNull())
    const setOptions = vi.spyOn(editor!, 'setOptions')
    rerender(drawn(() => {}))
    rerender(drawn(() => {}))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(setOptions).not.toHaveBeenCalled()
  })
})
