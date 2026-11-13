import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/react'
import { Editor } from './Editor'
import { forget, keptCount } from './kept'

/**
 * An editor kept for its tab (editor/kept, useKeptEditor): the same one when
 * its document is come back to, with what it would undo and where its cursor
 * was, drawn by a new component and answering to that one.
 */

const body = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const drawn = (props: Partial<ComponentProps<typeof Editor>>) => (
  <div data-scroll>
    <Editor key={props.docKey} kind="page" focus={false} onChange={() => {}} {...props} />
  </div>
)
const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))
/** Destroyed for good. Tiptap's own `isDestroyed` is also true of one that's only off the page. */
const gone = (editor: TiptapEditor) => editor.schema === null

afterEach(() => {
  cleanup()
  forget(() => false)
  document.body.replaceChildren()
})

describe('an editor kept for its tab', () => {
  it('is the same editor when its document is come back to, as it was left, and answers to the component drawing it now', async () => {
    const first = { onChange: vi.fn(), onOpenLink: vi.fn() }
    const second = { onChange: vi.fn(), onOpenLink: vi.fn() }
    let editor: TiptapEditor | null = null
    const onEditor = (live: TiptapEditor | null) => void (live && (editor = live))
    const { rerender } = render(drawn({ docKey: 'a:1', keptAs: () => ({ key: 'a:2', id: 'a' }), initialBody: body('Tides'), ...first, onEditor }))
    await waitFor(() => expect(editor).not.toBeNull())
    const made = editor!
    act(() => void made.commands.insertContentAt(6, ' at seven'))
    act(() => void made.commands.setTextSelection(3))
    expect(first.onChange).toHaveBeenCalledTimes(1)

    // Another document's: this one is put away, not destroyed.
    rerender(drawn({ docKey: 'b:1', initialBody: body('Ferries'), onEditor }))
    await waitFor(() => expect(keptCount()).toBe(1))
    await tick()
    expect(gone(made)).toBe(false)
    expect(editor).not.toBe(made)

    // Back, as what it was kept as. What it's given to open with isn't read: it has its own.
    rerender(drawn({ docKey: 'a:2', initialBody: body('Not this'), ...second, onEditor }))
    await waitFor(() => expect(editor).toBe(made))
    expect(keptCount()).toBe(0)
    expect(document.querySelector('.ProseMirror')!.textContent).toBe('Tides at seven')
    expect(made.state.selection.from).toBe(3)

    act(() => void made.commands.insertContentAt(1, 'Spring '))
    expect(second.onChange).toHaveBeenCalledTimes(1)
    expect(first.onChange).toHaveBeenCalledTimes(1)
    const link = { type: { name: 'noteLink' }, attrs: { id: 'z', block: null } }
    made.view.someProp('handleClickOn', (handle) => handle(made.view, 0, link as never, 0, new MouseEvent('click'), true))
    expect(second.onOpenLink).toHaveBeenCalledWith('z', null)
    expect(first.onOpenLink).not.toHaveBeenCalled()

    // What it would undo came back with it, from before it was put away.
    act(() => void made.commands.undo())
    act(() => void made.commands.undo())
    expect(made.getText()).toBe('Tides')
  })

  it('is destroyed when its document isn’t being left for another, as it always was', async () => {
    let editor: TiptapEditor | null = null
    const onEditor = (live: TiptapEditor | null) => void (live && (editor = live))
    const { rerender } = render(drawn({ docKey: 'a:1', keptAs: () => null, initialBody: body('Tides'), onEditor }))
    await waitFor(() => expect(editor).not.toBeNull())
    const made = editor!
    rerender(drawn({ docKey: 'a:2', initialBody: body('Tides, as changed elsewhere'), onEditor }))
    await waitFor(() => expect(gone(made)).toBe(true))
    expect(keptCount()).toBe(0)
    expect(document.querySelector('.ProseMirror')!.textContent).toBe('Tides, as changed elsewhere')
  })

  it('goes when another is kept for the same document, and when its tab is no longer behind', async () => {
    const editors: TiptapEditor[] = []
    const onEditor = (live: TiptapEditor | null) => void (live && editors.push(live))
    const { rerender } = render(drawn({ docKey: 'a:1', keptAs: () => ({ key: 'a:1', id: 'a' }), initialBody: body('Tides'), onEditor }))
    await waitFor(() => expect(editors.length).toBe(1))
    // Changed elsewhere meanwhile, so opened afresh as a:2, and that one kept in its turn.
    rerender(drawn({ docKey: 'b:1', onEditor }))
    await waitFor(() => expect(keptCount()).toBe(1))
    rerender(drawn({ docKey: 'a:2', keptAs: () => ({ key: 'a:2', id: 'a' }), initialBody: body('Tides, changed'), onEditor }))
    await waitFor(() => expect(editors.length).toBe(3))
    expect(editors[2]).not.toBe(editors[0])
    rerender(drawn({ docKey: 'b:2', onEditor }))
    await waitFor(() => expect(gone(editors[0])).toBe(true))
    expect(keptCount()).toBe(1)
    expect(gone(editors[2])).toBe(false)
    forget((id) => id !== 'a')
    expect(gone(editors[2])).toBe(true)
    expect(keptCount()).toBe(0)
  })
})
