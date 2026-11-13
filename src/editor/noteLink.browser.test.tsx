import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/react'
import '../index.css'
import { db, type Item } from '../db/db'
import { withoutDefaultAlignment } from '../lib/alignment'
import { asBlock, setLinkable } from '../lib/links'
import { goToBlock } from './arrive'
import { Editor } from './Editor'

/** `[[` in the live editor: the list, choosing, a link that opens its note, and one whose note is gone. */

const doc = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const item = (id: string, text: string, updatedAt: number, kind: Item['kind'] = 'note'): Item => ({ id, kind, body: doc(text), version: 1, createdAt: 1, updatedAt })

afterEach(async () => {
  cleanup()
  setLinkable([])
  document.body.replaceChildren()
  await db.items.clear()
})

async function open(body: JSONContent = doc('Plans'), onOpenLink = vi.fn(), kind: Item['kind'] = 'note') {
  let editor: TiptapEditor | null = null
  render(
    <div data-scroll>
      <Editor kind={kind} focus={false} initialBody={body} item={item('self', 'Plans', 1)} onChange={() => {}} onEditor={(live) => (editor = live)} onOpenLink={onOpenLink} />
    </div>,
  )
  await waitFor(() => expect(editor).not.toBeNull())
  editor!.commands.focus('end')
  editor!.view.dom.focus()
  return { editor: editor! as TiptapEditor, onOpenLink }
}

/** As a body is stored: without what the editor gives a null. */
const stored = (editor: TiptapEditor): JSONContent => withoutDefaultAlignment(editor.getJSON())
const links = (editor: TiptapEditor): JSONContent[] => (stored(editor).content?.[0].content ?? []).filter((node: JSONContent) => node.type === 'noteLink')

describe('linking with [[', () => {
  it('lists other notes as you type, and puts a link to the chosen one in place of what was typed', async () => {
    setLinkable([item('self', 'Plans', 9), item('ferry', 'Ferry times', 3), item('tickets', 'Tickets', 2, 'page')])
    const { editor } = await open()
    await userEvent.keyboard(' [[[[')
    const list = await screen.findByRole('listbox', { name: 'Link to a note' })
    expect([...list.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual(['Ferry timesNote', 'TicketsPage'])

    await userEvent.keyboard('tic')
    await waitFor(() => expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['TicketsPage']))
    await userEvent.keyboard('{Enter}')

    expect(links(editor)).toEqual([{ type: 'noteLink', attrs: { id: 'tickets', title: 'Tickets' } }])
    expect(editor.getText()).toBe('Plans Tickets ')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('chooses with the arrow keys, and Escape leaves the typing as it was', async () => {
    setLinkable([item('a', 'Apples', 3), item('b', 'Bananas', 2)])
    const { editor } = await open()
    await userEvent.keyboard(' [[[[')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(links(editor)[0].attrs?.id).toBe('b')

    await userEvent.keyboard('[[[[ap{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(editor.getText()).toContain('[[ap')
  })

  // Copying as plain text is built on renderText, which still gave the title
  // the link had when it was made.
  it('copies as plain text with nothing of a note locked into the vault', async () => {
    const locked: Item = { ...item('ferry', '', 3), vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) } }
    setLinkable([item('self', 'Plans', 9), locked])
    const { editor } = await open({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'noteLink', attrs: { id: 'ferry', title: 'Ferry times' } }] }],
    })
    expect(editor.getText()).toBe('See A locked note')
    // Nor of one line of it, which a link to that line still holds the words of.
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'noteLink', attrs: { id: 'ferry', title: 'Ferry times', block: 'abcd1234', part: 'The last boat' } }] }] })
    expect(editor.getText()).toBe('A locked note')
    expect(editor.getHTML()).not.toMatch(/Ferry|last boat|abcd1234/)
  })

  it('opens its note when tapped, and shows its note’s title as it is now', async () => {
    setLinkable([item('ferry', 'Ferry at 07:40', 3)])
    const body: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'noteLink', attrs: { id: 'ferry', title: 'Ferry' } }] }] }
    const { onOpenLink } = await open(body)
    const shown = document.querySelector<HTMLElement>('.ProseMirror .nib-note-link')!
    expect(shown.textContent).toBe('Ferry at 07:40')
    expect(shown.hasAttribute('data-missing')).toBe(false)

    await userEvent.click(shown)
    expect(onOpenLink).toHaveBeenCalledWith('ferry', null)

    // Its note goes to the trash: the link stays, looking gone.
    act(() => setLinkable([]))
    expect(shown.hasAttribute('data-missing')).toBe(true)
    expect(shown.textContent).toBe('Ferry')
  })
})

describe('a link that wraps', () => {
  it('is the link all along it, between its two lines too, at the loosest line spacing', async () => {
    const title = 'A title long enough that it has to go over two lines'
    setLinkable([item('ferry', title, 1)])
    const body: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'noteLink', attrs: { id: 'ferry', title } }] }] }
    const { editor } = await open(body)
    Object.assign(editor.view.dom.style, { width: '220px', lineHeight: '1.95' })
    const link = document.querySelector<HTMLElement>('[data-note-link]')!
    const [first, second] = link.getClientRects()
    expect(second.top).toBeGreaterThan(first.top)
    const between = document.elementFromPoint(Math.max(first.left, second.left) + 5, (first.top + first.height + second.top) / 2)
    expect(between?.closest('[data-note-link]')).toBe(link)
  })
})

describe('linking to one line with [[ and #', () => {
  const line = (words: string, blockId?: string): JSONContent => ({ type: 'paragraph', ...(blockId && { attrs: { blockId } }), content: [{ type: 'text', text: words }] })
  const ferry = (...marks: (string | undefined)[]): Item => ({
    id: 'ferry',
    kind: 'page',
    version: 1,
    createdAt: 1,
    updatedAt: 3,
    body: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Ferry times' }] }, line('The first boat leaves at seven.', marks[0]), line('The last boat leaves at nine.', marks[1])] },
  })
  const options = () => screen.getAllByRole('option').map((option) => option.textContent)

  it('lists a document’s headings and paragraphs, links to the one chosen, and marks it in its document', async () => {
    await db.items.put(ferry())
    setLinkable([item('self', 'Plans', 9), ferry()])
    const { editor } = await open()
    await userEvent.keyboard(' [[[[fer#')
    const list = await screen.findByRole('listbox', { name: 'Link to a note' })
    await waitFor(() => expect(options()).toEqual(['Ferry timesHeading', 'The first boat leaves at seven.Paragraph', 'The last boat leaves at nine.Paragraph']))
    // Whose lines they are, as only the start of its name was typed.
    expect(list.textContent).toContain('In Ferry times')
    await userEvent.keyboard('last')
    await waitFor(() => expect(options()).toEqual(['The last boat leaves at nine.Paragraph']))
    await userEvent.keyboard('{Enter}')

    const [link] = links(editor)
    const block = link.attrs!.block as string
    expect(asBlock(block)).toBe(block)
    expect(link.attrs).toEqual({ id: 'ferry', title: 'Ferry times', block, part: 'The last boat leaves at nine.' })
    expect(editor.getText()).toBe('Plans Ferry times › The last boat leaves at nine. ')
    expect(screen.queryByRole('listbox')).toBeNull()

    // The marker is in the line's own document, saved as an edit of it; its other lines are as they were.
    await waitFor(async () => expect((await db.items.get('ferry'))!.body.content![2].attrs).toEqual({ blockId: block }))
    const saved = (await db.items.get('ferry'))!
    expect(saved.body.content!.slice(0, 2)).toEqual(ferry().body.content!.slice(0, 2))
    expect(saved.version).toBe(2)
    expect(saved.updatedAt).toBeGreaterThan(3)
  })

  it('links to a line something links to already by the marker it has, and writes nothing', async () => {
    await db.items.put(ferry(undefined, 'abcd1234'))
    setLinkable([item('self', 'Plans', 9), ferry(undefined, 'abcd1234')])
    const { editor } = await open()
    await userEvent.keyboard(' [[[[ferry#nine{Enter}')
    await waitFor(() => expect(links(editor)[0]?.attrs?.block).toBe('abcd1234'))
    await new Promise((done) => setTimeout(done, 100))
    expect((await db.items.get('ferry'))!.version).toBe(1)
  })

  it('writes no marker in a read-only document, whose marked lines alone are offered', async () => {
    const readOnly = { ...ferry('abcd1234'), readOnly: true as const }
    await db.items.put(readOnly)
    setLinkable([item('self', 'Plans', 9), readOnly])
    await open()
    await userEvent.keyboard(' [[[[ferry#')
    await waitFor(() => expect(options()).toEqual(['The first boat leaves at seven.Paragraph']))
    await userEvent.keyboard('nine')
    await waitFor(() => expect(screen.getByRole('listbox').textContent).toContain('It’s read-only'))
    expect((await db.items.get('ferry'))!.version).toBe(1)
  })

  it('opens its note at its line when tapped, and reads as the note and the line’s words now', async () => {
    setLinkable([ferry(undefined, 'abcd1234')])
    const { editor, onOpenLink } = await open({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'noteLink', attrs: { id: 'ferry', title: 'Ferry', block: 'abcd1234', part: 'The last boat left at eight.' } }] }] })
    const shown = document.querySelector<HTMLElement>('.ProseMirror .nib-note-link')!
    expect(shown.textContent).toBe('Ferry times › The last boat leaves at nine.')
    await userEvent.click(shown)
    expect(onOpenLink).toHaveBeenCalledWith('ferry', 'abcd1234')
    // Copied, it comes back as the same link.
    const html = editor.getHTML()
    editor.commands.setContent(html)
    expect(links(editor)[0].attrs).toEqual({ id: 'ferry', title: 'Ferry times', block: 'abcd1234', part: 'The last boat left at eight.' })
  })

  it('keeps a line’s marker on the line, not on the one Return makes of its end', async () => {
    const { editor } = await open({ type: 'doc', content: [line('The last boat leaves at nine.', 'abcd1234')] })
    editor.commands.setTextSelection(14)
    await userEvent.keyboard('{Enter}')
    expect(stored(editor).content).toEqual([line('The last boat', 'abcd1234'), line(' leaves at nine.')])
    // And a line with none says nothing of it, as stored.
    expect(stored(editor).content![1].attrs).toBeUndefined()
    // A copy of the line, pasted in, is a line of its own: the link goes where it went.
    editor.commands.insertContentAt(editor.state.doc.content.size, line('The last boat', 'abcd1234'))
    expect(stored(editor).content!.map((one) => one.attrs?.blockId)).toEqual(['abcd1234', undefined, undefined])
  })

  it('keeps a line’s marker on its words when Return at its start puts an empty line above them', async () => {
    const { editor } = await open({ type: 'doc', content: [line('Before.'), line('The last boat.', 'abcd1234')] })
    editor.commands.setTextSelection(10)
    await userEvent.keyboard('{Enter}')
    expect(stored(editor).content).toEqual([line('Before.'), { type: 'paragraph' }, line('The last boat.', 'abcd1234')])
  })

  it('goes to the line a link is to: the caret at its start, the line shown for a moment', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => line(`Line ${i + 1} of the timetable.`, i === 44 ? 'abcd1234' : undefined))
    const { editor } = await open({ type: 'doc', content: lines }, vi.fn(), 'page')
    const scroller = document.querySelector<HTMLElement>('[data-scroll]')!
    Object.assign(scroller.style, { height: '300px', overflowY: 'auto' })
    act(() => goToBlock(editor, 'abcd1234'))
    expect(editor.state.selection.$from.parent.textContent).toBe('Line 45 of the timetable.')
    expect(editor.state.selection.$from.parentOffset).toBe(0)
    const arrived = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('.ProseMirror .nib-arrived')
      expect(found).not.toBeNull()
      return found!
    })
    expect(arrived.textContent).toBe('Line 45 of the timetable.')
    // In sight, about the middle of what shows.
    await vi.waitFor(() => {
      const pane = scroller.getBoundingClientRect()
      const box = arrived.getBoundingClientRect()
      expect(box.top).toBeGreaterThan(pane.top)
      expect(box.bottom).toBeLessThan(pane.bottom)
    })
    await expect.poll(() => document.querySelector('.ProseMirror .nib-arrived'), { timeout: 4000 }).toBeNull()

    // A line that's gone: nothing moves.
    const before = editor.state.selection.from
    act(() => goToBlock(editor, 'zzzz9999'))
    expect(editor.state.selection.from).toBe(before)
    expect(document.querySelector('.ProseMirror .nib-arrived')).toBeNull()
  })
})
