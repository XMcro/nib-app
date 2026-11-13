import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor as TiptapEditor } from '@tiptap/core'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { JSONContent } from '@tiptap/react'
import '../index.css'
import type { Item } from '../db/db'
import { MAX_FILE } from '../lib/fileRef'
import { readFile } from '../lib/files'
import { keepOriginals } from '../lib/originals'
import { wordsIn } from '../lib/pictureText'
import { Fragment, Slice } from '@tiptap/pm/model'
import { ATTACH_PROBLEMS, attachFile, withoutFiles } from './attach'
import { Editor } from './Editor'
import { nibExtensions } from './extensions'

/**
 * An attached file in the editor (editor/Attachment, editor/attach): attached
 * with Nib Plus, kept in the store, shown as a card, and written into HTML as
 * its name with which file only for Nib's own clipboard.
 */

vi.mock('../lib/pictureText', () => ({ wordsIn: vi.fn(async () => null) }))

const pdf = (name = 'report.pdf', size = 3000) => new File([new Uint8Array(size).map((_, at) => at % 251)], name, { type: 'application/pdf' })

let editor: TiptapEditor | undefined
function open(content: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }) {
  editor = new TiptapEditor({ element: document.body.appendChild(document.createElement('div')), extensions: nibExtensions(false), content })
  editor.view.dom.classList.add('nib-editor')
  return editor
}
const attachments = () => {
  const found: Record<string, unknown>[] = []
  editor!.state.doc.descendants((node) => void (node.type.name === 'attachment' && found.push(node.attrs)))
  return found
}
const card = () => editor!.view.dom.querySelector<HTMLElement>('.nib-attachment')!
const words = () => [...card().querySelectorAll('.nib-attachment-text > *')].map((line) => line.textContent)

afterEach(() => {
  keepOriginals(false)
  editor?.destroy()
  editor = undefined
  cleanup()
  document.body.replaceChildren()
})

describe('attaching a file', () => {
  it('keeps it with Nib Plus, names it in the document where the cursor is, and shows it as a card', async () => {
    keepOriginals(true)
    const file = pdf('Quarterly report.pdf')
    expect(await attachFile(open(), file)).toBe('added')
    const [attrs] = attachments() as { file: { id: string; type: string; size: number }; name: string }[]
    expect(attrs).toEqual({ file: { id: expect.stringMatching(/^[0-9a-f-]{36}$/), type: 'application/pdf', size: 3000 }, name: 'Quarterly report.pdf' })
    // The file itself is in the store, byte for byte; the document holds only which it is.
    expect(new Uint8Array(await (await readFile(attrs.file.id))!.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()))
    expect(JSON.stringify(editor!.getJSON()).length).toBeLessThan(400)
    expect(words()).toEqual(['Quarterly report.pdf', 'PDF · 3 KB'])
    expect(card().isContentEditable).toBe(false)
    // A block of its own, with the writing going on around it.
    expect(editor!.getJSON().content!.map((block) => block.type)).toContain('attachment')
  })

  it('isn’t done without Plus, for a locked note, or past what one file may be, and says which', async () => {
    expect(await attachFile(open(), pdf())).toBe('plus')
    keepOriginals(true)
    editor!.storage.image.locked = true
    expect(await attachFile(editor!, pdf())).toBe('locked')
    editor!.storage.image.locked = false
    expect(await attachFile(editor!, new File([new Uint8Array(MAX_FILE + 1)], 'film.mov', { type: 'video/quicktime' }))).toBe('large')
    expect(attachments()).toEqual([])
    expect(ATTACH_PROBLEMS.large).toContain('25 MB')
    expect(MAX_FILE).toBe(25 * 1024 * 1024)
  })

  it('takes a file of no kind as a file, and its name without the folders it came from', async () => {
    keepOriginals(true)
    await attachFile(open(), new File(['notes'], 'a/b/notes', { type: '' }))
    await attachFile(editor!, new File(['x'], 'data.csv', { type: 'text/csv; charset=utf-8' }))
    expect((attachments() as { file: { type: string }; name: string }[]).map(({ file, name }) => [name, file.type])).toEqual([
      ['notes', 'application/octet-stream'],
      ['data.csv', 'text/csv'],
    ])
  })

  it('leaves the cursor on the line after it, so the next one attached, or what’s typed, goes below and not in its place', async () => {
    keepOriginals(true)
    const lines = () => (editor!.getJSON().content as JSONContent[]).map((block) => (block.type === 'attachment' ? block.attrs!.name : (block.content?.[0]?.text ?? '')))
    open({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }] })
    editor!.commands.focus('end')
    await attachFile(editor!, pdf('one.pdf'))
    await attachFile(editor!, pdf('two.pdf'))
    editor!.commands.insertContent('After')
    expect(lines()).toEqual(['Before', 'one.pdf', 'two.pdf', 'After'])
    // Between two paragraphs, it lands between them and the cursor goes to the one after.
    editor!.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: 'Below' }] }] })
    editor!.commands.focus('start')
    await attachFile(editor!, pdf('first.pdf'))
    editor!.commands.insertContent('Typed ')
    expect(lines()).toEqual(['first.pdf', 'Typed Below'])
  })
})

describe('a note that begins with an attachment', () => {
  const file = { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'application/pdf', size: 2000 }
  const first = { type: 'attachment', attrs: { file, name: 'first.pdf' } }
  const names = () => (attachments() as { name: string }[]).map(({ name }) => name)

  it('keeps it when another is attached before the cursor has been put anywhere: the new one goes after it', async () => {
    keepOriginals(true)
    open({ type: 'doc', content: [first, { type: 'paragraph', content: [{ type: 'text', text: 'Harbour survey' }] }] })
    // As a note opens: nothing in it is where the cursor is but its first block.
    expect(editor!.state.selection.toJSON()).toMatchObject({ type: 'node', anchor: 0 })
    expect(await attachFile(editor!, pdf('second.pdf'))).toBe('added')
    expect(names()).toEqual(['first.pdf', 'second.pdf'])
    expect(editor!.getJSON().content!.map((block) => block.type)).toEqual(['attachment', 'attachment', 'paragraph'])
    // And the cursor goes on to the line after the new one, as anywhere else.
    editor!.commands.insertContent('Typed ')
    expect((editor!.getJSON().content![2].content![0] as { text: string }).text).toBe('Typed Harbour survey')

    // One selected on purpose is kept too, wherever it is, with a line made after the new one if it's the last.
    editor!.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Above' }] }, first] })
    editor!.commands.setNodeSelection(7)
    await attachFile(editor!, pdf('third.pdf'))
    expect(names()).toEqual(['first.pdf', 'third.pdf'])
    expect(editor!.getJSON().content!.map((block) => block.type)).toEqual(['paragraph', 'attachment', 'attachment', 'paragraph'])
  })

  it('doesn’t look selected until the cursor is in the text', async () => {
    open({ type: 'doc', content: [first, { type: 'paragraph' }] })
    const shade = () => getComputedStyle(card()).backgroundColor
    expect(card().classList.contains('ProseMirror-selectednode')).toBe(true)
    const plain = shade()
    editor!.commands.focus()
    editor!.commands.setNodeSelection(0)
    await waitFor(() => expect(shade()).not.toBe(plain))
  })
})

describe('an attachment written as HTML', () => {
  const file = { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'application/pdf', size: 2_400_000 }

  it('reads by itself, and keeps its file when cut and pasted within Nib', () => {
    open({ type: 'doc', content: [{ type: 'attachment', attrs: { file, name: 'report.pdf' } }] })
    const html = editor!.getHTML()
    expect(html).toBe('<div data-file="7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d 2400000 application/pdf" data-name="report.pdf" data-attachment="" class="nib-attachment"><strong>report.pdf</strong> (PDF · 2&nbsp;MB)</div>')
    editor!.commands.setContent(html)
    expect(attachments()).toEqual([{ file, name: 'report.pdf' }])
  })

  it('says it isn’t included once it has left without its file', () => {
    open({ type: 'doc', content: [{ type: 'attachment', attrs: { file: null, name: 'report.pdf' } }] })
    expect(editor!.getHTML()).toBe('<div data-name="report.pdf" data-attachment="" class="nib-attachment"><strong>report.pdf</strong> (attached file, not included)</div>')
    expect(words()).toEqual(['report.pdf', 'attached file, not included'])
    // Nothing to open: its name is all there is of it.
    expect(card().querySelector('button, audio')).toBeNull()
  })

  it('is made only from Nib’s own markup, and never with an address or anything that isn’t a file of the store’s', () => {
    open()
    for (const not of ['<div data-attachment>report.pdf</div>', '<div data-name="report.pdf">x</div>', '<a href="https://example.com/report.pdf" download>report.pdf</a>']) {
      editor!.commands.setContent(not)
      expect(attachments(), not).toEqual([])
    }
    for (const bad of ['https://example.com/a.pdf 100 application/pdf', '../index 100 application/pdf', `${file.id} lots application/pdf`, `${file.id} 100 application/pdf extra`, `${file.id} 100`]) {
      editor!.commands.setContent(`<div data-attachment data-name="a/b/report.pdf" data-file="${bad}">x</div>`)
      expect(attachments(), bad).toEqual([{ file: null, name: 'report.pdf' }])
    }
  })
})

describe('a file that isn’t a picture, pasted or dropped into a note', () => {
  const note = (locked: boolean): Item => ({ id: 'the-note', kind: 'note', body: { type: 'doc', content: [{ type: 'paragraph' }] }, version: 1, createdAt: 1, updatedAt: 1, ...(locked ? { vault: { salt: 'a-salt', sealed: 'sealed' } } : {}) })
  function mount(locked = false) {
    const bodies: JSONContent[] = []
    const notices: string[] = []
    render(
      <div data-scroll>
        <Editor kind="note" focus={false} item={note(locked)} onChange={(body) => bodies.push(body)} onNotice={(message) => notices.push(message)} />
      </div>,
    )
    return { bodies, notices, dom: document.querySelector<HTMLElement>('.nib-editor')! }
  }
  function paste(dom: HTMLElement, files: File[]) {
    const data = new DataTransfer()
    files.forEach((file) => data.items.add(file))
    dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }
  const attachedIn = (body: JSONContent | undefined) => (body?.content ?? []).filter((block) => block.type === 'attachment')

  it('is attached with Nib Plus', async () => {
    keepOriginals(true)
    vi.mocked(wordsIn).mockResolvedValue(null)
    const { bodies, notices, dom } = mount()
    paste(dom, [pdf('minutes.pdf')])
    await waitFor(() => expect(attachedIn(bodies.at(-1))).toHaveLength(1))
    expect(attachedIn(bodies.at(-1))[0].attrs).toMatchObject({ name: 'minutes.pdf', file: { type: 'application/pdf', size: 3000 } })
    expect(notices).toEqual([])
  })

  const CARD = '<p>Minutes of the meeting</p><blockquote><div data-attachment data-name="report.pdf" data-file="7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d 2400000 application/pdf" class="nib-attachment"><strong>report.pdf</strong> (PDF · 2 MB)</div></blockquote>'
  function pasteHtml(dom: HTMLElement, html: string) {
    const data = new DataTransfer()
    data.setData('text/html', html)
    dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }
  const cards = (body: JSONContent | undefined): JSONContent[] => (body?.type === 'attachment' ? [body] : (body?.content ?? []).flatMap(cards))

  it('goes into a locked note as its name alone when its card is pasted from another note, and says so; into any other, with its file', async () => {
    const locked = mount(true)
    pasteHtml(locked.dom, CARD)
    await waitFor(() => expect(cards(locked.bodies.at(-1))).toHaveLength(1))
    expect(cards(locked.bodies.at(-1))[0].attrs).toEqual({ file: null, name: 'report.pdf' })
    expect(JSON.stringify(locked.bodies.at(-1))).toContain('Minutes of the meeting')
    expect(locked.notices).toEqual(['A locked note can’t hold attachments, so only the name was pasted.'])
    // Nothing to open on it.
    expect(locked.dom.querySelector('.nib-attachment button')).toBeNull()
    expect(locked.dom.querySelector('.nib-attachment-about')!.textContent).toBe('attached file, not included')

    // Text alone, or a name alone, pasted into a locked note: nothing said.
    pasteHtml(locked.dom, '<p>More</p><div data-attachment data-name="gone.pdf">gone.pdf</div>')
    await waitFor(() => expect(JSON.stringify(locked.bodies.at(-1))).toContain('gone.pdf'))
    expect(locked.notices).toHaveLength(1)

    cleanup()
    const open = mount()
    pasteHtml(open.dom, CARD)
    await waitFor(() => expect(cards(open.bodies.at(-1))).toHaveLength(1))
    expect(cards(open.bodies.at(-1))[0].attrs).toEqual({ file: { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'application/pdf', size: 2_400_000 }, name: 'report.pdf' })
    expect(open.notices).toEqual([])
  })

  it('is the same slice back when there’s no file in it to take, and keeps how open its ends were', () => {
    const { schema } = open().state
    const file = { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'application/pdf', size: 2000 }
    const text = new Slice(Fragment.from(schema.nodes.paragraph.create(null, schema.text('Words'))), 1, 1)
    expect(withoutFiles(text)).toBe(text)
    const named = new Slice(Fragment.from(schema.nodes.attachment.create({ file: null, name: 'a.pdf' })), 0, 0)
    expect(withoutFiles(named)).toBe(named)
    const mixed = new Slice(Fragment.from([schema.nodes.paragraph.create(null, schema.text('Words')), schema.nodes.blockquote.create(null, schema.nodes.attachment.create({ file, name: 'a.pdf' }))]), 1, 0)
    const taken = withoutFiles(mixed)
    expect([taken.openStart, taken.openEnd]).toEqual([1, 0])
    expect(taken.content.toJSON()).toMatchObject([
      { type: 'paragraph', content: [{ type: 'text', text: 'Words' }] },
      { type: 'blockquote', content: [{ type: 'attachment', attrs: { file: null, name: 'a.pdf' } }] },
    ])
    // What was pasted from is as it was.
    expect(mixed.content.child(1).child(0).attrs.file).toEqual(file)
  })

  it('is turned away as before without Plus, and from a locked note with the reason', async () => {
    vi.mocked(wordsIn).mockResolvedValue(null)
    const free = mount()
    paste(free.dom, [pdf('minutes.pdf')])
    await waitFor(() => expect(free.notices).toEqual(['Can’t add minutes.pdf']))
    cleanup()
    keepOriginals(true)
    const locked = mount(true)
    paste(locked.dom, [pdf('minutes.pdf')])
    await waitFor(() => expect(locked.notices).toEqual(['A locked note can’t hold attachments. Remove its lock first.']))
    expect(attachedIn(locked.bodies.at(-1))).toEqual([])
  })
})
