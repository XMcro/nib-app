// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Item } from '../db/db'
import { CommandPalette, type Command } from './CommandPalette'

const item = (id: string, text: string, kind: Item['kind'] = 'note'): Item => ({
  id,
  kind,
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  version: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const items = [item('n1', 'Darkroom key'), item('p1', 'Sonoran winter', 'page')]

function setup(overrides: { commands?: Command[] } = {}) {
  const run = { newNote: vi.fn(), focus: vi.fn() }
  const commands: Command[] = overrides.commands ?? [
    { id: 'new', label: 'New note', hint: '⌘⌥N', run: run.newNote },
    { id: 'focus', label: 'Focus mode', run: run.focus },
  ]
  const onSelectItem = vi.fn()
  const onClose = vi.fn()
  render(
    <CommandPalette
      items={items}
      commands={commands}
      onSelectItem={onSelectItem}
      onClose={onClose}
    />,
  )
  return { run, onSelectItem, onClose }
}

const rowLabels = () =>
  screen
    .getAllByRole('button')
    .map((button) => button.textContent?.trim() ?? '')

describe('CommandPalette', () => {
  it('names its field, and tells it which row the arrow keys are on', () => {
    render(<CommandPalette items={[]} commands={[{ id: 'a', label: 'First', run: () => {} }, { id: 'b', label: 'Second', run: () => {} }]} onSelectItem={() => {}} onClose={() => {}} />)
    const field = screen.getByRole('combobox', { name: /Type a command/ })
    expect(document.getElementById(field.getAttribute('aria-activedescendant')!)?.textContent).toBe('First')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    const active = document.getElementById(field.getAttribute('aria-activedescendant')!)!
    expect(active.textContent).toBe('Second')
    expect(active.getAttribute('aria-selected')).toBe('true')
    expect(active.getAttribute('role')).toBe('option')
  })

  it('lists the formats only once something is typed, so an empty palette stays a short menu', async () => {
    setup({
      commands: [
        { id: 'new', label: 'New note', run: vi.fn() },
        { id: 'format-checklist', label: 'Checklist', searchOnly: true, run: vi.fn() },
      ],
    })
    expect(rowLabels().some((label) => label.startsWith('Checklist'))).toBe(false)
    await userEvent.type(screen.getByRole('combobox'), 'check')
    expect(rowLabels().some((label) => label.startsWith('Checklist'))).toBe(true)
  })

  it('opens as a menu of commands, without listing every document', () => {
    setup()
    expect(rowLabels()).toEqual(['New note⌘⌥N', 'Focus mode'])
  })

  it('brings documents in once you type, tagged by tab', async () => {
    setup()
    await userEvent.type(screen.getByRole('combobox'), 'sonoran')
    expect(rowLabels()).toEqual(['Sonoran winterPage'])
  })

  it('matches commands and documents in the same query', async () => {
    setup()
    await userEvent.type(screen.getByRole('combobox'), 'o')
    const labels = rowLabels()
    expect(labels.some((l) => l.startsWith('Focus mode'))).toBe(true)
    expect(labels.some((l) => l.startsWith('Sonoran winter'))).toBe(true)
  })

  it('runs the highlighted command on Enter and closes', async () => {
    const { run, onClose } = setup()
    await userEvent.keyboard('{Enter}')
    expect(run.newNote).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  // A row that opens under a pointer that never moved gets mouse events too,
  // and it took the highlight: ⌘K then Enter ran whatever lay under a
  // resting pointer, "Move this to trash" over the middle of the text.
  it('leaves the highlight alone for a pointer that hasn’t moved', async () => {
    const { run } = setup()
    const row = screen.getByText('Focus mode')
    fireEvent.mouseEnter(row)
    fireEvent.mouseMove(row, { clientX: 40, clientY: 60 })
    await userEvent.keyboard('{Enter}')
    expect(run.newNote).toHaveBeenCalledOnce()
    expect(run.focus).not.toHaveBeenCalled()
  })

  it('moves the highlight to a row the pointer moves over', async () => {
    const { run } = setup()
    const row = screen.getByText('Focus mode')
    fireEvent.mouseMove(row, { clientX: 40, clientY: 60 })
    fireEvent.mouseMove(row, { clientX: 42, clientY: 61 })
    await userEvent.keyboard('{Enter}')
    expect(run.focus).toHaveBeenCalledOnce()
  })

  it('moves the highlight with the arrow keys', async () => {
    const { run } = setup()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(run.focus).toHaveBeenCalledOnce()
    expect(run.newNote).not.toHaveBeenCalled()
  })

  it('wraps around at both ends', async () => {
    const { run } = setup()
    // Up from the first row lands on the last.
    await userEvent.keyboard('{ArrowUp}{Enter}')
    expect(run.focus).toHaveBeenCalledOnce()
  })

  it('opens a document rather than running a command when one is highlighted', async () => {
    const { onSelectItem } = setup()
    await userEvent.type(screen.getByRole('combobox'), 'darkroom')
    await userEvent.keyboard('{Enter}')
    expect(onSelectItem).toHaveBeenCalledWith('n1')
  })

  it('resets the highlight when the results change', async () => {
    const { onSelectItem, run } = setup()
    await userEvent.keyboard('{ArrowDown}') // highlight the second command
    await userEvent.type(screen.getByRole('combobox'), 'darkroom')
    await userEvent.keyboard('{Enter}')
    // Without a reset the stale index would have pointed past the results.
    expect(onSelectItem).toHaveBeenCalledWith('n1')
    expect(run.focus).not.toHaveBeenCalled()
  })

  it('closes on Escape without running anything', async () => {
    const { run, onClose, onSelectItem } = setup()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
    expect(run.newNote).not.toHaveBeenCalled()
    expect(onSelectItem).not.toHaveBeenCalled()
  })

  it('says so when nothing matches, and Enter is harmless', async () => {
    const { onClose } = setup()
    await userEvent.type(screen.getByRole('combobox'), 'zzzzz')
    expect(screen.getByText('Nothing matches.')).toBeTruthy()
    await userEvent.keyboard('{Enter}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when the backdrop is clicked but not the dialog itself', async () => {
    const { onClose } = setup()
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  // App rebuilds `commands` on every render, and the five item-scoped ones
  // splice in partway down the list as soon as a new draft becomes a real
  // document. A positional cursor would have slid onto whatever took its slot.
  it('keeps the highlight on the same command when the list grows', async () => {
    const run = { first: vi.fn(), inserted: vi.fn(), last: vi.fn() }
    const before: Command[] = [
      { id: 'first', label: 'New note', run: run.first },
      { id: 'last', label: 'Open trash', run: run.last },
    ]
    const props = { items: [], onSelectItem: vi.fn(), onClose: vi.fn() }
    const { rerender } = render(<CommandPalette {...props} commands={before} />)

    await userEvent.keyboard('{ArrowDown}')
    rerender(
      <CommandPalette
        {...props}
        commands={[
          before[0],
          { id: 'trash-this', label: 'Move this to trash', run: run.inserted },
          before[1],
        ]}
      />,
    )
    await userEvent.keyboard('{Enter}')

    expect(run.last).toHaveBeenCalledOnce()
    expect(run.inserted).not.toHaveBeenCalled()
  })

  // Most commands do not remount the editor, so without this the caret is left
  // on document.body and everything typed next is dropped.
  it('hands focus back to whatever had it', () => {
    const editor = document.createElement('textarea')
    document.body.append(editor)
    editor.focus()

    const { unmount } = render(
      <CommandPalette items={[]} commands={[]} onSelectItem={vi.fn()} onClose={vi.fn()} />,
    )
    expect(document.activeElement).not.toBe(editor)

    unmount()
    expect(document.activeElement).toBe(editor)
    editor.remove()
  })

  // On iOS a focused field raises the keyboard over half the commands, so a
  // palette opened by touch leaves the search box alone and the editor lets go.
  it('takes no focus when opened by touch, and still hands it back', () => {
    const editor = document.createElement('textarea')
    document.body.append(editor)
    editor.focus()

    const { unmount } = render(
      <CommandPalette
        items={[]}
        commands={[]}
        onSelectItem={vi.fn()}
        onClose={vi.fn()}
        focusSearch={false}
      />,
    )
    expect(document.activeElement).toBe(document.body)

    unmount()
    expect(document.activeElement).toBe(editor)
    editor.remove()
  })
})
