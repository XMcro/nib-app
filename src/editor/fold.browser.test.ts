import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import '../index.css'
import { nibEditor, textClass } from './extensions'
import { toRead } from '../lib/readAloud'
import { fold, foldedAway } from './fold'

/** Folding a heading's section away (fold.ts), in a real editor: what shows, what the document holds, and what this device keeps. */

const line = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const heading = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: text ? [{ type: 'text', text }] : [] })

const PAGE = [
  heading(1, 'Harbour'),
  line('Opening words.'),
  heading(2, 'Tides'),
  line('High at seven.'),
  heading(3, 'Springs'),
  line('Higher still.'),
  heading(2, 'Ferries'),
  line('Weekdays.'),
  heading(2, 'Nothing under this'),
  heading(2, 'The last'),
]

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})
beforeEach(() => localStorage.clear())

function open(content: JSONContent[] = PAGE, id: string | null = 'doc-1', editable = true, page = true) {
  const element = document.body.appendChild(document.createElement('div'))
  // The room the app leaves beside the text on a phone (App's px-8).
  element.style.padding = '0 32px'
  editor = new Editor({ element, ...nibEditor(page), content: { type: 'doc', content }, editable, editorProps: { attributes: { class: textClass(page) } } })
  editor.registerPlugin(fold(() => id))
  return editor
}
const blocks = () => [...editor!.view.dom.children] as HTMLElement[]
const block = (text: string) => blocks().find((element) => element.textContent === text)!
const button = (text: string) => block(text).querySelector<HTMLButtonElement>(':scope > .nib-fold')
const showing = () => blocks().filter((element) => getComputedStyle(element).display !== 'none').map((element) => element.textContent)
const press = (text: string) => button(text)!.click()
const kept = () => JSON.parse(localStorage.getItem('nib-folds') ?? '{}')
/** Where the words `text` start in the document. */
const at = (text: string) => {
  let found = -1
  editor!.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) found = pos
  })
  return found
}

describe('a heading’s fold', () => {
  it('is offered only where something is under the heading', () => {
    open()
    expect(blocks().filter((element) => element.querySelector(':scope > .nib-fold')).map((element) => element.textContent)).toEqual(['Harbour', 'Tides', 'Springs', 'Ferries'])
    expect(button('Tides')!.getAttribute('aria-label')).toBe('Hide this section')
    expect(button('Tides')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('puts its section out of sight, down to the next heading of its level, and brings it back', async () => {
    open()
    await userEvent.click(button('Tides')!)
    expect(showing()).toEqual(['Harbour', 'Opening words.', 'Tides', 'Ferries', 'Weekdays.', 'Nothing under this', 'The last'])
    expect(block('Tides').hasAttribute('data-folded')).toBe(true)
    expect(getComputedStyle(block('Tides'), '::after').content).toContain('…')
    expect(button('Tides')!.getAttribute('aria-expanded')).toBe('false')
    expect(button('Tides')!.getAttribute('aria-label')).toBe('Show this section')
    await userEvent.click(button('Tides')!)
    expect(showing()).toHaveLength(PAGE.length)
    expect(block('Tides').hasAttribute('data-folded')).toBe(false)
  })

  it('takes everything under a title, the headings below it with it', () => {
    open()
    press('Harbour')
    expect(showing()).toEqual(['Harbour'])
  })

  it('changes nothing in the document, and is no edit', () => {
    const page = open()
    const before = JSON.stringify(page.getJSON())
    const edited = vi.fn()
    page.on('update', edited)
    press('Tides')
    press('Ferries')
    expect(JSON.stringify(page.getJSON())).toBe(before)
    expect(page.getHTML()).not.toContain('folded')
    expect(edited).not.toHaveBeenCalled()
    expect(page.can().undo()).toBe(false)
  })

  it('works on a page that is only to be read', () => {
    open(PAGE, 'doc-1', false)
    press('Tides')
    expect(showing()).not.toContain('High at seven.')
  })

  it('shows its control under the pointer, and all the while something is put away', async () => {
    open()
    const settled = () => new Promise((resolve) => setTimeout(resolve, 200))
    expect(getComputedStyle(button('Ferries')!).opacity).toBe('0')
    await userEvent.hover(block('Ferries'))
    await settled()
    expect(getComputedStyle(button('Ferries')!).opacity).toBe('1')
    press('Ferries')
    await userEvent.hover(block('Harbour'))
    await settled()
    expect(getComputedStyle(button('Ferries')!).opacity).toBe('1')
    expect(getComputedStyle(button('Tides')!).opacity).toBe('0')
  })

  it('leaves the control in the margin before the heading, out of the way of its words', () => {
    open()
    // A tap on the heading's first letter is for the caret: the control's reach for a finger stops where the words start.
    const words = block('Tides').getBoundingClientRect()
    expect(document.elementFromPoint(words.left + 1, words.top + words.height / 2)?.closest('.nib-fold') ?? null).toBeNull()
    expect(document.elementFromPoint(words.left - 3, words.top + words.height / 2)?.closest('.nib-fold')).toBe(button('Tides'))
    const title = block('Tides').getBoundingClientRect()
    const control = button('Tides')!.getBoundingClientRect()
    expect(control.right).toBeLessThanOrEqual(title.left + 1)
    expect(control.width).toBeGreaterThanOrEqual(24)
    expect(button('Tides')!.tabIndex).toBe(-1)
  })
})

describe('the caret and a fold', () => {
  it('is taken out of the lines being put away, to the end of the heading, so nothing is typed where it can’t be seen', () => {
    const page = open()
    page.commands.setTextSelection(at('Higher still.') + 3)
    press('Tides')
    page.commands.insertContent('!')
    expect(block('Tides!').hasAttribute('data-folded')).toBe(true)
    expect(showing()).not.toContain('Higher still.')
  })

  it('opens the section it is sent into: by Find, the outline or an arrow key', () => {
    const page = open()
    press('Tides')
    page.commands.setTextSelection(at('High at seven.') + 1)
    expect(showing()).toHaveLength(PAGE.length)
    expect(block('Tides').hasAttribute('data-folded')).toBe(false)
  })

  it('opens every fold around it, one inside another', () => {
    const page = open()
    press('Springs')
    press('Tides')
    press('Ferries')
    page.commands.setTextSelection(at('Higher still.') + 1)
    expect(showing()).toEqual(['Harbour', 'Opening words.', 'Tides', 'High at seven.', 'Springs', 'Higher still.', 'Ferries', 'Nothing under this', 'The last'])
  })

  it('opens for a line begun under a folded heading', () => {
    const page = open()
    press('Tides')
    page.commands.setTextSelection(at('Tides') + 5)
    page.commands.splitBlock()
    expect(block('Tides').hasAttribute('data-folded')).toBe(false)
    expect(showing()).toContain('High at seven.')
  })
})

describe('a fold as the page is written', () => {
  it('stays on its heading when lines are added above it', () => {
    const page = open()
    press('Ferries')
    page.commands.insertContentAt(0, line('A new first line.'))
    page.commands.insertContentAt(at('Opening words.'), 'More. ')
    expect(showing()).not.toContain('Weekdays.')
    expect(block('Ferries').hasAttribute('data-folded')).toBe(true)
  })

  it('ends when its heading is a heading no longer, or is gone', () => {
    const page = open()
    press('Tides')
    press('Ferries')
    page.commands.setTextSelection(at('Tides') + 1)
    page.commands.setParagraph()
    expect(showing()).toContain('High at seven.')
    const ferries = at('Ferries') - 1
    page.commands.deleteRange({ from: ferries, to: ferries + page.state.doc.nodeAt(ferries)!.nodeSize })
    expect(showing()).toContain('Weekdays.')
    expect(kept()).toEqual({})
  })

  it('shows its lines when they are changed where they couldn’t be seen, and not for a change anywhere else', () => {
    const page = open()
    press('Ferries')
    page.commands.insertContentAt(page.state.doc.content.size, line('At the very end.'))
    page.commands.insertContentAt(at('Opening words.'), 'More. ', { updateSelection: false })
    expect(showing()).not.toContain('Weekdays.')
    // As Replace all does: the caret doesn't go there with it.
    page.commands.insertContentAt(at('Weekdays.') + 8, ' only', { updateSelection: false })
    expect(showing()).toContain('Weekdays only.')
    expect(block('Ferries').hasAttribute('data-folded')).toBe(false)
  })

  it('shows its lines when the first of them is pulled up into the heading', () => {
    const page = open()
    press('Tides')
    page.commands.setTextSelection(at('Tides') + 5)
    page.commands.joinForward()
    expect(showing()).toContain('TidesHigh at seven.')
    expect(showing()).toContain('Higher still.')
  })

  it('shows what is under a list’s line when another is moved under it', () => {
    const page = note()
    control('Boat')!.click()
    page.commands.setTextSelection(at('Shore') + 1)
    page.commands.sinkListItem('listItem')
    expect(row('Boat').hasAttribute('data-folded')).toBe(false)
    expect(rows()).toEqual(['Boat', 'Rope', 'Hemp', 'Nylon', 'Lamp', 'Shore', 'First', 'First of first', 'Pack', 'Charts', 'Go'])
  })
})

describe('what passes over a fold', () => {
  const here = () => editor!.state.selection.$head.parent.textContent

  it('lets the arrow keys by, to the next line that shows, and stays shut', async () => {
    const page = open()
    press('Tides')
    page.commands.focus()
    page.view.dom.focus()
    page.commands.setTextSelection(at('Tides') + 5)
    await userEvent.keyboard('{ArrowRight}')
    expect(here()).toBe('Ferries')
    await userEvent.keyboard('{ArrowLeft}')
    expect(here()).toBe('Tides')
    await userEvent.keyboard('{ArrowDown}')
    expect(here()).toBe('Ferries')
    await userEvent.keyboard('{ArrowUp}')
    expect(here()).toBe('Tides')
    expect(block('Tides').hasAttribute('data-folded')).toBe(true)
    expect(showing()).not.toContain('High at seven.')
  })

  it('leaves what is put away unread by Read aloud, a heading’s section and a list’s lines', () => {
    const page = open([heading(2, 'Tides'), line('High at seven.'), heading(2, 'Ferries'), bullets(item('Weekdays', bullets(item('At seven.'))), item('Sundays')), line('The end.')])
    const read = () => toRead(page.state.doc, { from: 1, to: 1, empty: true }, foldedAway(page.state)).map((sentence) => sentence.text)
    expect(read()).toEqual(['Tides', 'High at seven.', 'Ferries', 'Weekdays', 'At seven.', 'Sundays', 'The end.'])
    press('Tides')
    control('Weekdays')!.click()
    expect(read()).toEqual(['Tides', 'Ferries', 'Weekdays', 'Sundays', 'The end.'])
    // Selected right across a fold, the same.
    expect(toRead(page.state.doc, { from: 0, to: page.state.doc.content.size, empty: false }, foldedAway(page.state)).map((sentence) => sentence.text)).toEqual(['Tides', 'Ferries', 'Weekdays', 'Sundays', 'The end.'])
  })
})

describe('what this device keeps of a fold', () => {
  it('folds the same headings when the page is opened again, here', () => {
    open()
    press('Tides')
    press('Ferries')
    expect(kept()).toEqual({ 'doc-1': ['2 Tides', '2 Ferries'] })
    editor!.destroy()
    document.body.replaceChildren()
    open()
    expect(showing()).toEqual(['Harbour', 'Opening words.', 'Tides', 'Ferries', 'Nothing under this', 'The last'])
    press('Tides')
    expect(kept()).toEqual({ 'doc-1': ['2 Ferries'] })
    press('Ferries')
    expect(kept()).toEqual({})
  })

  it('keeps them for that page only, and nothing for one not saved yet', () => {
    open()
    press('Tides')
    editor!.destroy()
    document.body.replaceChildren()
    open(PAGE, 'doc-2')
    expect(showing()).toHaveLength(PAGE.length)
    editor!.destroy()
    document.body.replaceChildren()
    open(PAGE, null)
    press('Ferries')
    expect(kept()).toEqual({ 'doc-1': ['2 Tides'] })
  })

  it('follows a folded heading that is given other words', () => {
    const page = open()
    press('Tides')
    page.commands.insertContentAt(at('Tides') + 5, ' and times')
    expect(kept()).toEqual({ 'doc-1': ['2 Tides and times'] })
  })

  it('tells two headings of a name apart by how many were folded', () => {
    const twice = [heading(2, 'Notes'), line('One.'), heading(2, 'Notes'), line('Two.')]
    open(twice)
    blocks()[2].querySelector<HTMLButtonElement>('.nib-fold')!.click()
    expect(kept()).toEqual({ 'doc-1': ['2 Notes'] })
    editor!.destroy()
    document.body.replaceChildren()
    open(twice)
    // The first of the name is the one folded now: which of the two it was isn't kept.
    expect(showing()).toEqual(['Notes', 'Notes', 'Two.'])
  })

  it('forgets a heading that isn’t on the page any more', () => {
    localStorage.setItem('nib-folds', JSON.stringify({ 'doc-1': ['2 Gone', '2 Ferries'] }))
    open()
    expect(showing()).not.toContain('Weekdays.')
    expect(showing()).toContain('High at seven.')
  })
})

const item = (text: string, ...under: JSONContent[]): JSONContent => ({ type: 'listItem', content: [line(text), ...under] })
const bullets = (...items: JSONContent[]): JSONContent => ({ type: 'bulletList', content: items })
const numbers = (...items: JSONContent[]): JSONContent => ({ type: 'orderedList', content: items })
const task = (text: string, checked: boolean, ...under: JSONContent[]): JSONContent => ({ type: 'taskItem', attrs: { checked }, content: [line(text), ...under] })
const tasks = (...items: JSONContent[]): JSONContent => ({ type: 'taskList', content: items })

const OUTLINE = [
  line('Plans'),
  bullets(item('Boat', bullets(item('Rope', bullets(item('Hemp'), item('Nylon'))), item('Lamp')), line('And more under Boat.')), item('Shore')),
  numbers(item('First', numbers(item('First of first')))),
  tasks(task('Pack', false, tasks(task('Charts', true))), task('Go', false)),
]

const firstLine = (li: Element) => li.querySelector(':scope > p, :scope > div > p')!
const row = (text: string) => [...editor!.view.dom.querySelectorAll('li')].find((li) => firstLine(li).textContent === text)!
const control = (text: string) => firstLine(row(text)).querySelector<HTMLButtonElement>(':scope > .nib-fold')
const visible = (element: Element) => (element as HTMLElement).offsetParent !== null
/** The lines of every list that can be seen. */
const rows = () => [...editor!.view.dom.querySelectorAll('li')].filter(visible).map((li) => firstLine(li).textContent)
const note = (content = OUTLINE) => open(content, 'doc-1', true, false)

describe('a list’s line', () => {
  it('folds only where something is under it, in a note as on a page, whatever kind of list', () => {
    note()
    expect([...editor!.view.dom.querySelectorAll('li')].filter((li) => firstLine(li).querySelector(':scope > .nib-fold')).map((li) => firstLine(li).textContent)).toEqual(['Boat', 'Rope', 'First', 'Pack'])
    expect(control('Boat')!.getAttribute('aria-label')).toBe('Hide what’s under this')
    editor!.destroy()
    document.body.replaceChildren()
    open(OUTLINE)
    expect(control('Rope')).not.toBeNull()
  })

  it('puts away everything under it, lists and lines alike, and brings it back', async () => {
    note()
    await userEvent.click(control('Boat')!)
    expect(rows()).toEqual(['Boat', 'Shore', 'First', 'First of first', 'Pack', 'Charts', 'Go'])
    expect(visible([...row('Boat').children].find((child) => child.textContent === 'And more under Boat.')!)).toBe(false)
    expect(row('Boat').hasAttribute('data-folded')).toBe(true)
    expect(getComputedStyle(firstLine(row('Boat')), '::after').content).toContain('…')
    expect(control('Boat')!.getAttribute('aria-label')).toBe('Show what’s under this')
    await userEvent.click(control('Boat')!)
    expect(rows()).toHaveLength(11)
  })

  it('folds a numbered list’s and a checklist’s the same, and leaves the tick alone', () => {
    const page = note()
    const before = JSON.stringify(page.getJSON())
    control('First')!.click()
    control('Pack')!.click()
    expect(rows()).toEqual(['Boat', 'Rope', 'Hemp', 'Nylon', 'Lamp', 'Shore', 'First', 'Pack', 'Go'])
    expect(JSON.stringify(page.getJSON())).toBe(before)
    expect(row('Pack').querySelector('input')!.checked).toBe(false)
    const box = row('Pack').querySelector('input')!.getBoundingClientRect()
    const fold = control('Pack')!.getBoundingClientRect()
    expect(fold.right).toBeLessThanOrEqual(box.left)
  })

  it('keeps its control before the bullet, on the screen, and clear of the words', () => {
    note()
    for (const text of ['Boat', 'Rope', 'First', 'Pack']) {
      const fold = control(text)!.getBoundingClientRect()
      expect(fold.left, text).toBeGreaterThanOrEqual(0)
      expect(fold.right, text).toBeLessThanOrEqual(firstLine(row(text)).getBoundingClientRect().left)
      // A numbered line's is a little narrower, to clear its number.
      expect(fold.width, text).toBeGreaterThanOrEqual(22)
    }
    // The line itself is where it was: the control takes no room in it.
    expect(firstLine(row('Boat')).getBoundingClientRect().left).toBe(firstLine(row('Shore')).getBoundingClientRect().left)
  })

  it('is pressed where it is drawn, shut or open, and not the control of the line below or above', () => {
    note()
    const owner = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('.nib-fold')
    const pressedAt = (text: string) => {
      const box = control(text)!.getBoundingClientRect()
      const middle = box.left + box.width / 2
      // The middle of it, and just inside its top and its bottom.
      return [box.top + box.height / 2, box.top + 3, box.bottom - 3].map((y) => owner(middle, y) === control(text))
    }
    for (const text of ['Boat', 'Rope', 'Pack']) expect(pressedAt(text), `${text}, open`).toEqual([true, true, true])
    // Shut, the arrow turns: Rope's reach turned with it once, up over Boat's control.
    control('Rope')!.click()
    expect(pressedAt('Boat'), 'Boat, with Rope shut').toEqual([true, true, true])
    expect(pressedAt('Rope'), 'Rope, shut').toEqual([true, true, true])
    control('Boat')!.click()
    expect(pressedAt('Boat'), 'Boat, shut').toEqual([true, true, true])
  })

  it('changes nothing in the document, and is no edit', () => {
    const page = note()
    const before = JSON.stringify(page.getJSON())
    const edited = vi.fn()
    page.on('update', edited)
    control('Boat')!.click()
    control('Pack')!.click()
    expect(JSON.stringify(page.getJSON())).toBe(before)
    expect(edited).not.toHaveBeenCalled()
  })

  it('takes the caret out of what it puts away, and opens when the caret is sent back in, every fold around it', () => {
    const page = note()
    page.commands.setTextSelection(at('Nylon') + 2)
    control('Rope')!.click()
    page.commands.insertContent('!')
    expect(rows()).toContain('Rope!')
    expect(rows()).not.toContain('Nylon')
    control('Boat')!.click()
    expect(rows()).not.toContain('Rope!')
    page.commands.setTextSelection(at('Hemp') + 1)
    expect(rows()).toEqual(['Boat', 'Rope!', 'Hemp', 'Nylon', 'Lamp', 'Shore', 'First', 'First of first', 'Pack', 'Charts', 'Go'])
  })

  it('ends when nothing is under the line any more', () => {
    const page = note()
    control('First')!.click()
    const under = at('First of first') - 3
    page.commands.deleteRange({ from: under, to: under + page.state.doc.nodeAt(under)!.nodeSize })
    expect(control('First')).toBeNull()
    expect(row('First').hasAttribute('data-folded')).toBe(false)
    expect(kept()).toEqual({})
  })

  it('is kept on this device with the headings’, each by its words', () => {
    const both = [heading(2, 'Plans'), ...OUTLINE.slice(1)]
    open(both)
    press('Plans')
    control('Boat')!.click()
    control('Pack')!.click()
    expect(kept()).toEqual({ 'doc-1': ['2 Plans', '- Boat', '- Pack'] })
    editor!.destroy()
    document.body.replaceChildren()
    const page = open(both)
    // The heading has it all put away; opened, its lists are folded as they were left.
    expect(rows()).toEqual([])
    press('Plans')
    expect(rows()).toEqual(['Boat', 'Shore', 'First', 'First of first', 'Pack', 'Go'])
    expect(JSON.stringify(page.getJSON())).not.toContain('folded')
  })
})

