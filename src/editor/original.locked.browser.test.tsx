import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import type { NoticeAction } from '../lib/notices'
import { keepOriginals } from '../lib/originals'
import { wordsIn } from '../lib/pictureText'
import { Editor } from './Editor'

/**
 * A picture pasted into a locked note keeps no original (lib/originals): its
 * text is sealed, and a file beside the library isn't. Through the editor
 * itself, by both ways a pasted picture goes in.
 */

vi.mock('../lib/pictureText', () => ({ wordsIn: vi.fn() }))

/** A JPEG, which always has an original with Plus: the note's own is drawn again from it. */
async function photo(): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 60
  const pen = canvas.getContext('2d')!
  pen.fillStyle = '#184476'
  pen.fillRect(0, 0, 60, 60)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg'))
  return new File([blob!], 'photo.jpg', { type: 'image/jpeg' })
}

const note = (locked: boolean): Item => ({
  id: 'the-note',
  kind: 'note',
  body: { type: 'doc', content: [{ type: 'paragraph' }] },
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  ...(locked ? { vault: { salt: 'a-salt', sealed: 'sealed' } } : {}),
})

function mount(locked: boolean) {
  const bodies: JSONContent[] = []
  const notices: { message: string; action?: NoticeAction }[] = []
  let editor: TiptapEditor | null = null
  const page = (item: Item) => (
    <div data-scroll>
      <Editor kind="note" focus={false} item={item} onChange={(body) => bodies.push(body)} onNotice={(message, action) => notices.push({ message, action })} onEditor={(next) => (editor = next)} />
    </div>
  )
  const { rerender } = render(page(note(locked)))
  const dom = document.querySelector<HTMLElement>('.nib-editor')!
  return { bodies, notices, dom, editor: () => editor!, becomes: (now: boolean) => rerender(page(note(now))) }
}

function paste(dom: HTMLElement, files: File[]) {
  const data = new DataTransfer()
  files.forEach((file) => data.items.add(file))
  dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
}

const pictureIn = (body: JSONContent | undefined) => (body?.content ?? []).flatMap((block) => (block.content ?? []).filter((node) => node.type === 'image'))[0]

afterEach(() => {
  keepOriginals(false)
  cleanup()
  document.body.replaceChildren()
  vi.mocked(wordsIn).mockReset()
})

describe.each([
  ['a locked note', true],
  ['a note that isn’t locked', false],
])('a picture pasted into %s, with Plus', (_, locked) => {
  const kept = locked ? null : { id: expect.stringMatching(/^[0-9a-f-]{36}$/), type: 'image/jpeg', size: expect.any(Number) }

  it(`${locked ? 'keeps no original' : 'keeps its original'} as it goes in`, async () => {
    keepOriginals(true)
    vi.mocked(wordsIn).mockResolvedValue(null)
    const { bodies, dom } = mount(locked)
    paste(dom, [await photo()])
    await waitFor(() => expect(pictureIn(bodies.at(-1))).toBeDefined())
    expect(pictureIn(bodies.at(-1))!.attrs!.full).toEqual(kept)
  })

  it(`${locked ? 'keeps no original' : 'keeps its original'} when it’s put back in place of its words`, async () => {
    keepOriginals(true)
    vi.mocked(wordsIn).mockResolvedValue(['The boats came in late.'])
    const { bodies, notices, dom } = mount(locked)
    paste(dom, [await photo()])
    await waitFor(() => expect(notices).toHaveLength(1))
    notices[0].action!.run()
    await waitFor(() => expect(pictureIn(bodies.at(-1))).toBeDefined())
    expect(pictureIn(bodies.at(-1))!.attrs!.full).toEqual(kept)
  })
})

describe('what puts a picture in from outside the editor (addPicture)', () => {
  it('is told by the editor whether its note is locked, as it is now and not as it was opened', async () => {
    const { editor, becomes } = mount(false)
    await waitFor(() => expect(editor()).toBeTruthy())
    expect(editor().storage.image.locked).toBe(false)
    becomes(true)
    expect(editor().storage.image.locked).toBe(true)
    becomes(false)
    expect(editor().storage.image.locked).toBe(false)
  })
})
