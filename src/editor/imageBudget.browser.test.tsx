import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import type { JSONContent } from '@tiptap/react'

/**
 * Its own file because the mock is module-wide, and ESM exports cannot be
 * spied on in the browser. Each accepted paste is made to cost about 800 KB, so
 * two fit inside the 2 MB document budget and the third does not — reached in
 * three pastes rather than the eleven full-size images it would take.
 */
vi.mock('../lib/image', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/image')>()
  return {
    ...real,
    toDataUrl: async () => `data:image/png;base64,${'A'.repeat(800_000)}`,
  }
})

const { Editor } = await import('./Editor')

const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (character) => character.charCodeAt(0),
)

const imagesIn = (body: JSONContent) =>
  (body.content ?? []).flatMap((block) =>
    (block.content ?? []).filter((node) => node.type === 'image'),
  )

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('the document budget', () => {
  it('refuses the image that would overflow, and says why', async () => {
    const bodies: JSONContent[] = []
    const notices: string[] = []
    render(
      <div data-scroll>
        <Editor
          kind="note"
          focus={false}
          onChange={(body) => bodies.push(body)}
          onNotice={(message) => notices.push(message)}
        />
      </div>,
    )
    const dom = document.querySelector<HTMLElement>('.nib-editor')!

    function paste() {
      const data = new DataTransfer()
      data.items.add(new File([PNG_BYTES], 'x.png', { type: 'image/png' }))
      dom.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      )
    }

    paste()
    await waitFor(() => expect(imagesIn(bodies.at(-1) ?? {})).toHaveLength(1))
    paste()
    await waitFor(() => expect(imagesIn(bodies.at(-1)!)).toHaveLength(2))

    // The third would pass 2 MB, so nothing is inserted and the writer is told.
    paste()
    await waitFor(() => expect(notices.some((notice) => notice.includes('full'))).toBe(true))
    expect(imagesIn(bodies.at(-1)!)).toHaveLength(2)
  })
})
