import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/react'
import { IMAGE_SRC } from '../lib/image'
import { wordsIn } from '../lib/pictureText'
import type { NoticeAction } from '../lib/notices'
import { Editor } from './Editor'

/**
 * A pasted picture with words in it goes in as its words, and the notice
 * offers the picture back. The reading itself is native (NibTextPlugin), so
 * here it is stood in for.
 */
vi.mock('../lib/pictureText', () => ({ wordsIn: vi.fn() }))

const PNG_BYTES = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
)
const picture = (name = 'page.png') => new File([PNG_BYTES], name, { type: 'image/png' })

function mount() {
  const bodies: JSONContent[] = []
  const notices: { message: string; action?: NoticeAction }[] = []
  let editor: TiptapEditor | null = null
  render(
    <div data-scroll>
      <Editor
        kind="note"
        focus={false}
        onChange={(body) => bodies.push(body)}
        onNotice={(message, action) => notices.push({ message, action })}
        onEditor={(next) => (editor = next)}
      />
    </div>,
  )
  const dom = document.querySelector<HTMLElement>('.nib-editor')!
  return { bodies, notices, dom, editor: () => editor! }
}

function paste(dom: HTMLElement, files: File[]) {
  const data = new DataTransfer()
  files.forEach((file) => data.items.add(file))
  dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
}

const imagesIn = (body: JSONContent) =>
  (body.content ?? []).flatMap((block) => (block.content ?? []).filter((node) => node.type === 'image'))
const textsOf = (body: JSONContent) =>
  (body.content ?? []).map((block) => (block.content ?? []).map((node) => node.text ?? '').join(''))

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.mocked(wordsIn).mockReset()
})

describe('pasting a picture with words in it', () => {
  it('puts in its words, a paragraph each, and not the picture', async () => {
    vi.mocked(wordsIn).mockResolvedValue(['The boats came in late.', 'It had been a long season.'])
    const { bodies, notices, dom } = mount()
    const file = picture()
    paste(dom, [file])

    await waitFor(() => expect(notices).toHaveLength(1))
    expect(wordsIn).toHaveBeenCalledWith(file)
    expect(textsOf(bodies.at(-1)!)).toEqual(['The boats came in late.', 'It had been a long season.'])
    expect(bodies.flatMap(imagesIn)).toHaveLength(0)
    expect(notices[0].message).toBe('Typed out 11 words from the picture.')
    expect(notices[0].action?.label).toBe('Keep the picture')
  })

  it('puts the picture back in place of its words, leaving what was typed around them', async () => {
    vi.mocked(wordsIn).mockResolvedValue(['The boats came in late.', 'It had been a long season.'])
    const { bodies, notices, dom, editor } = mount()
    paste(dom, [picture()])
    await waitFor(() => expect(notices).toHaveLength(1))

    // Typed right up against both ends of the words, after they went in.
    editor().commands.insertContentAt(1, 'Seen at the harbour: ')
    editor().commands.insertContentAt(editor().state.doc.content.size - 1, ' The end.')
    notices[0].action!.run()

    await waitFor(() => expect(imagesIn(bodies.at(-1)!)).toHaveLength(1))
    const [image] = imagesIn(bodies.at(-1)!)
    expect(String(image.attrs?.src)).toMatch(IMAGE_SRC)
    // No alt from the file's name, which went into shares and exports (Docs/audit-2026-11-05.md, 25).
    expect(image.attrs?.alt).toBe('')
    expect(textsOf(bodies.at(-1)!)).toEqual(['Seen at the harbour:  The end.'])
  })

  it('puts back every picture of one paste', async () => {
    vi.mocked(wordsIn).mockResolvedValueOnce(['Rope']).mockResolvedValueOnce(['Two lanterns'])
    const { bodies, notices, dom } = mount()
    paste(dom, [picture('one.png'), picture('two.png')])

    // Each picture's words a paragraph of their own, not run together.
    await waitFor(() => expect(textsOf(bodies.at(-1) ?? {})).toEqual(['Rope', 'Two lanterns']))
    expect(notices.at(-1)?.message).toBe('Typed out 3 words from the pictures.')
    expect(notices.at(-1)?.action?.label).toBe('Keep the pictures')
    notices.at(-1)!.action!.run()

    await waitFor(() => expect(imagesIn(bodies.at(-1)!).map((image) => String(image.attrs?.src).slice(0, 15))).toEqual(['data:image/png;', 'data:image/png;']))
    expect(textsOf(bodies.at(-1)!)).toEqual([''])
  })
})

describe('pasting a picture with no words in it', () => {
  it('puts in the picture, as before, with nothing to say', async () => {
    vi.mocked(wordsIn).mockResolvedValue(null)
    const { bodies, notices, dom } = mount()
    paste(dom, [picture('cat.png')])

    await waitFor(() => expect(bodies.length).toBeGreaterThan(0))
    expect(imagesIn(bodies.at(-1)!)).toHaveLength(1)
    expect(notices).toHaveLength(0)
  })
})

/** A read that takes `ms`, as Vision's first one in an app did (24 s on a Mac) before it was readied after launch. */
const slowly = (words: string[] | null, ms: number) => vi.mocked(wordsIn).mockImplementation(() => new Promise((done) => setTimeout(() => done(words), ms)))

describe('a picture whose words take a while to read', () => {
  it('says it is reading them, then what it typed out', async () => {
    slowly(['The boats came in late.'], 900)
    const { notices, dom } = mount()
    paste(dom, [picture()])
    await waitFor(() => expect(notices).toHaveLength(2), { timeout: 3000 })
    expect(notices.map((one) => one.message)).toEqual(['Reading the words in the picture…', 'Typed out 5 words from the picture.'])
  })

  it('says so when it found none, and the picture went in', async () => {
    slowly(null, 900)
    const { bodies, notices, dom } = mount()
    paste(dom, [picture()])
    await waitFor(() => expect(notices).toHaveLength(2), { timeout: 3000 })
    expect(notices.map((one) => one.message)).toEqual(['Reading the words in the picture…', 'Found no words in the picture, so it went in as a picture.'])
    await waitFor(() => expect(imagesIn(bodies.at(-1)!)).toHaveLength(1))
  })

  it('says nothing more when they’re read at once', async () => {
    slowly(['The boats came in late.'], 50)
    const { notices, dom } = mount()
    paste(dom, [picture()])
    await waitFor(() => expect(notices).toHaveLength(1))
    await new Promise((done) => setTimeout(done, 700))
    expect(notices.map((one) => one.message)).toEqual(['Typed out 5 words from the picture.'])
  })
})
