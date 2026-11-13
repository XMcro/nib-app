import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { nibExtensions } from './extensions'
import '../index.css'

/**
 * A table on a page keeps its columns readable whatever is in a cell. Needs
 * layout, so a browser.
 */

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

function mount(content: string) {
  const element = document.createElement('div')
  element.style.width = '680px' // a page's column
  document.body.append(element)
  editor = new Editor({
    element,
    extensions: nibExtensions(true),
    editorProps: { attributes: { class: 'nib-editor nib-editor-page text-[17px] leading-[1.65]' } },
    content,
  })
}

describe('a table', () => {
  // A word too long to break, a pasted address most often, held its column
  // open to its full length: it took 657 of the 680 pixels, pushed the rest
  // out of sight, and squeezed the last column until its row stood 826px tall.
  it('breaks a word too long for its column rather than starving the others', () => {
    const address = 'https://example.com/a/very/long/path/that/has/no/spaces/anywhere/in/it/at/all?with=a&query=string'
    mount(
      `<table><tr><th><p>Item</p></th><th><p>Cost</p></th><th><p>Notes</p></th></tr>` +
        `<tr><td><p>${address}</p></td><td><p>9</p></td><td><p>Paid in March, with the rest due once the work is done and checked.</p></td></tr></table>`,
    )
    const wrapper = document.querySelector<HTMLElement>('.tableWrapper')!
    expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth)
    const rows = [...document.querySelectorAll('tr')].map((row) => row.getBoundingClientRect().height)
    expect(Math.max(...rows)).toBeLessThan(200)
  })
})
