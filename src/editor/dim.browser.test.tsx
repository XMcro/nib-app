import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { resetLook, setLook, setLookPlus } from '../lib/look'
import { dim } from './dim'
import { Editor as NibEditor } from './Editor'
import { nibExtensions } from './extensions'
import { foldKey } from './fold'
import '../index.css'

/** Focus mode's dimming and the always-on typewriter (Customize, Nib Plus). */

const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Line ${i + 1}` }] }))
const paragraphs = () => [...document.querySelectorAll<HTMLElement>('.ProseMirror > p')]
// Fading takes 200ms; read where it settles.
const opacity = (element: Element) => {
  element.getAnimations().forEach((animation) => animation.finish())
  return getComputedStyle(element).opacity
}

afterEach(() => {
  cleanup()
  resetLook()
  setLookPlus({ active: false, known: false })
  document.body.replaceChildren()
})

describe('dimming', () => {
  it('keeps the paragraph with the caret and fades the rest, following the caret', () => {
    const element = document.createElement('div')
    document.body.append(element)
    const editor = new Editor({ element, extensions: nibExtensions(true), content: { type: 'doc', content: lines(3) } })
    editor.registerPlugin(dim())
    // In "Line 2".
    editor.commands.setTextSelection(10)
    expect(editor.view.dom.classList.contains('nib-dim')).toBe(true)
    expect(paragraphs().map(opacity)).toEqual(['0.3', '1', '0.3'])

    editor.commands.setTextSelection(18)
    expect(paragraphs().map(opacity)).toEqual(['0.3', '0.3', '1'])
    editor.destroy()
  })
})

describe('the editor', () => {
  function mount(focus: boolean, content: object[] = lines(80)) {
    let live: TiptapEditor | null = null
    const view = render(
      // No scroll anchoring, as in the app's own web view, which has none: Chromium's would hold the text still by itself.
      <div data-scroll style={{ height: '400px', overflowY: 'auto', width: '360px', overflowAnchor: 'none' }}>
        <div style={{ paddingBottom: '400px' }}>
          <NibEditor kind="page" focus={focus} initialBody={{ type: 'doc', content }} onChange={() => {}} onEditor={(next) => (live = next)} />
        </div>
      </div>,
    )
    return { view, editor: () => live as TiptapEditor | null }
  }

  it('dims in focus mode with Plus, and not out of it, or without Plus', async () => {
    setLookPlus({ active: true, known: true })
    setLook({ dim: true })
    const { view, editor } = mount(true)
    await waitFor(() => expect(editor()).not.toBeNull())
    expect(editor()!.view.dom.classList.contains('nib-dim')).toBe(true)

    view.unmount()
    mount(false)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    expect(document.querySelector('.ProseMirror')!.classList.contains('nib-dim')).toBe(false)

    cleanup()
    act(() => setLookPlus({ active: false, known: true }))
    mount(true)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    expect(document.querySelector('.ProseMirror')!.classList.contains('nib-dim')).toBe(false)
  })

  // The caret held 40% of the way down the text, out of focus mode too.
  it('keeps the line being written mid-screen when typewriter is always on', async () => {
    const caretAt = (editor: TiptapEditor) => {
      const scroller = document.querySelector<HTMLElement>('[data-scroll]')!.getBoundingClientRect()
      return (editor.view.coordsAtPos(editor.state.selection.from).top - scroller.top) / scroller.height
    }
    const frames = async () => {
      for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame)
    }
    const place = async (editor: TiptapEditor) => {
      // Past the editor's own focus('end'), a frame off, which moves the caret and the scroll after this would.
      await frames()
      document.querySelector<HTMLElement>('[data-scroll]')!.scrollTop = 0
      act(() => void editor.commands.setTextSelection(editor.view.posAtDOM(paragraphs()[30].firstChild!, 2)))
      await frames()
    }

    const plain = mount(false)
    await waitFor(() => expect(plain.editor()).not.toBeNull())
    await place(plain.editor()!)
    // Off: Line 31 is far below the 400px box, and the caret is left there.
    expect(caretAt(plain.editor()!)).toBeGreaterThan(1)
    cleanup()

    setLookPlus({ active: true, known: true })
    setLook({ typewriter: true })
    const always = mount(false)
    await waitFor(() => expect(always.editor()).not.toBeNull())
    await place(always.editor()!)
    await expect.poll(() => Math.abs(caretAt(always.editor()!) - 0.4)).toBeLessThan(0.05)
  })

  it('holds the line being written where it was when lines above it are folded away, and brought back', async () => {
    const heading = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
    const caretAt = (editor: TiptapEditor) => {
      const scroller = document.querySelector<HTMLElement>('[data-scroll]')!.getBoundingClientRect()
      return (editor.view.coordsAtPos(editor.state.selection.from).top - scroller.top) / scroller.height
    }
    const frames = async () => {
      for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame)
    }
    setLookPlus({ active: true, known: true })
    setLook({ typewriter: true })
    const { editor } = mount(false, [heading('Above'), ...lines(40), heading('Below'), ...lines(40)])
    await waitFor(() => expect(editor()).not.toBeNull())
    await frames()
    // In the tenth line under "Below".
    act(() => void editor()!.commands.setTextSelection(editor()!.view.posAtDOM(paragraphs()[50].firstChild!, 2)))
    await frames()
    await expect.poll(() => Math.abs(caretAt(editor()!) - 0.4)).toBeLessThan(0.05)

    const fold = () => document.querySelector<HTMLButtonElement>('.ProseMirror > h2 > .nib-fold')!
    act(() => fold().click())
    expect(foldKey.getState(editor()!.state)!.folded).toHaveLength(1)
    await frames()
    expect(Math.abs(caretAt(editor()!) - 0.4)).toBeLessThan(0.05)
    act(() => fold().click())
    await frames()
    expect(Math.abs(caretAt(editor()!) - 0.4)).toBeLessThan(0.05)
  })
})
