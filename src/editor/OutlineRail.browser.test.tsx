import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { nibExtensions } from './extensions'
import { fold } from './fold'
import { OutlineRail } from './OutlineRail'

/**
 * The rail's active entry is decided by comparing each heading's
 * getBoundingClientRect against the scroller's — pure layout, which jsdom does
 * not implement, so none of this could be checked before.
 */

let editor: Editor | undefined

/** Mounts the rail over a page inside a short, scrollable container. */
function mount(content: string) {
  const style = document.createElement('style')
  // Tall paragraphs, so the headings are far enough apart to scroll between.
  style.textContent = '.nib-editor p { height: 400px; margin: 0 }'
  document.head.append(style)

  const scroller = document.createElement('div')
  scroller.setAttribute('data-scroll', '')
  scroller.style.cssText = 'height: 300px; overflow-y: auto'
  document.body.append(scroller)

  const host = document.createElement('div')
  scroller.append(host)
  editor = new Editor({
    element: host,
    extensions: nibExtensions(true),
    content,
    editorProps: { attributes: { class: 'nib-editor' } },
  })
  render(<OutlineRail editor={editor} />)
  return scroller
}

/** The label of the entry currently marked active. */
const activeEntry = () =>
  screen.getAllByRole('button').find((button) => button.getAttribute('aria-current') === 'location')?.textContent

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
  document.head.querySelectorAll('style').forEach((node) => node.remove())
})

describe('OutlineRail', () => {
  it('lists every heading in the document', () => {
    mount('<h1>One</h1><p>a</p><h2>Two</h2><p>b</p><h3>Three</h3>')
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'One',
      'Two',
      'Three',
    ])
  })

  it('indents each entry by its heading level', () => {
    mount('<h1>One</h1><p>a</p><h3>Three</h3>')
    const [first, third] = screen.getAllByRole('button')
    expect(parseFloat(getComputedStyle(third).paddingLeft)).toBeGreaterThan(parseFloat(getComputedStyle(first).paddingLeft))
  })

  it('renders nothing for a document with no headings', () => {
    mount('<p>just prose</p>')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('ignores a heading with no text yet', () => {
    mount('<h1>Real</h1><p>a</p><h2>   </h2>')
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Real'])
  })

  it('doesn’t take a heading folded out of sight for where the reader is', async () => {
    const scroller = mount('<h1>Beginning</h1><p>a</p><h2>Middle</h2><p>b</p><h2>End</h2><p>c</p>')
    editor!.registerPlugin(fold(() => null))
    // index.css's own rule for what a fold puts away: this file brings in none of it.
    document.head.appendChild(document.createElement('style')).textContent = '.nib-folded-away { display: none }'
    editor!.view.dom.querySelector<HTMLButtonElement>('h1 > .nib-fold')!.click()
    expect(getComputedStyle(editor!.view.dom.querySelectorAll('h2')[1]).display).toBe('none')
    scroller.dispatchEvent(new Event('scroll'))
    // Once the rail has drawn again: Middle and End are put away, nowhere on the page, and each would have counted as above the top.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(activeEntry()).toBe('Beginning')
    // The rail still lists them (the folds' own controls are buttons too, with no words).
    expect(screen.getAllByRole('button').map((button) => button.textContent).filter(Boolean)).toEqual(['Beginning', 'Middle', 'End'])
    // Chosen in the rail, one that was put away is shown, and gone to.
    await userEvent.click(screen.getByRole('button', { name: 'End' }))
    expect(getComputedStyle(editor!.view.dom.querySelectorAll('h2')[1]).display).not.toBe('none')
    await waitFor(() => expect(activeEntry()).toBe('End'))
  })

  it('follows the reader down the page as it scrolls', async () => {
    const scroller = mount(
      '<h1>Beginning</h1><p>a</p><h2>Middle</h2><p>b</p><h2>End</h2><p>c</p>',
    )
    await waitFor(() => expect(activeEntry()).toBe('Beginning'))

    scroller.scrollTop = scroller.scrollHeight
    await waitFor(() => expect(activeEntry()).toBe('End'))

    scroller.scrollTop = 0
    await waitFor(() => expect(activeEntry()).toBe('Beginning'))
  })

  it('lists the deeper headings and finds the right one among them', async () => {
    const scroller = mount(`<h4>Four</h4><p>a</p><h5>Five</h5><p>b</p><h6>Six</h6><p>c</p><h2>Last</h2>${'<p>on and on</p>'.repeat(60)}`)
    const entries = screen.getAllByRole('button')
    expect(entries.map((entry) => entry.textContent)).toEqual(['Four', 'Five', 'Six', 'Last'])
    expect(entries[2].style.paddingLeft).toBe('55px')
    await userEvent.click(entries[3])
    const last = editor!.view.dom.querySelector('h2')!
    // At the top, give or take the margin ProseMirror keeps; left to itself it would stop at the bottom.
    await waitFor(() => expect(Math.abs(last.getBoundingClientRect().top - scroller.getBoundingClientRect().top)).toBeLessThanOrEqual(6))
  })

  it('jumps to the heading you click', async () => {
    const scroller = mount('<h1>Beginning</h1><p>a</p><h2>Middle</h2><p>b</p><h2>End</h2><p>c</p>')
    expect(scroller.scrollTop).toBe(0)

    // By role, not by text: the heading itself is also on the page.
    const entry = screen.getAllByRole('button').find((button) => button.textContent === 'End')
    await userEvent.click(entry!)

    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0))
    // The selection follows, so typing continues in the section jumped to.
    const { $from } = editor!.state.selection
    expect($from.parent.textContent).toBe('End')
  })
})
