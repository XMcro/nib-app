import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import type { JSONContent } from '@tiptap/react'

/**
 * Its own file because the mock is module-wide. `toDataUrl` is held open so
 * the editor can unmount while a paste is still decoding — the race the
 * destroyed-view guard exists to close.
 */
let release: (() => void) | undefined

vi.mock('../lib/image', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/image')>()
  return {
    ...real,
    toDataUrl: async (file: Blob) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return real.toDataUrl(file)
    },
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
  release = undefined
  cleanup()
  document.body.replaceChildren()
})

describe('pasting an image after the editor is gone', () => {
  it('does not dispatch into a destroyed view', async () => {
    const bodies: JSONContent[] = []
    const notices: string[] = []
    const failures: unknown[] = []
    const onRejection = (event: PromiseRejectionEvent) => {
      failures.push(event.reason)
      event.preventDefault()
    }
    window.addEventListener('unhandledrejection', onRejection)

    const { unmount } = render(
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
    const data = new DataTransfer()
    data.items.add(new File([PNG_BYTES], 'cat.png', { type: 'image/png' }))
    dom.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )

    await waitFor(() => expect(release).toBeTypeOf('function'))
    unmount()
    release?.()

    await new Promise((resolve) => setTimeout(resolve, 50))
    window.removeEventListener('unhandledrejection', onRejection)

    expect(failures).toEqual([])
    expect(bodies.flatMap(imagesIn)).toHaveLength(0)
    expect(notices).toHaveLength(0)
  })
})
