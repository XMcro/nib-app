import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { JSONContent } from '@tiptap/react'
import '../index.css'
import { nibExtensions } from './extensions'
import { FindBar, openFind } from './FindBar'
import { fold } from './fold'

const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const run = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const LAMPS: JSONContent = { type: 'doc', content: [para(run('The lamp was lit.')), para(run('A second lamp.')), para(run('And a third lamp at last.'))] }

let editor: Editor | undefined
const wrappers: HTMLElement[] = []

function open(content: JSONContent = LAMPS, scroller = false) {
  const outer = document.createElement('div')
  if (scroller) {
    outer.dataset.scroll = ''
    outer.style.cssText = 'height: 300px; overflow-y: auto'
  }
  const element = document.createElement('div')
  outer.append(element)
  document.body.append(outer)
  wrappers.push(outer)
  editor = new Editor({ element, extensions: nibExtensions(true), content, editorProps: { attributes: { class: 'nib-editor' } } })
  render(<FindBar editor={editor} readOnly={false} />)
  return editor
}

const ask = (live: Editor) => act(async () => openFind(live))
const field = () => screen.getByLabelText('Find in this document') as HTMLInputElement
const status = () => screen.getByRole('status').textContent
const type = async (text: string) => {
  await act(async () => void field().focus())
  await userEvent.keyboard(text)
}
const on = () => document.querySelector('.ProseMirror-active-search-match')?.textContent
const others = () => document.querySelectorAll('.ProseMirror-search-match').length

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
  editor?.destroy()
  editor = undefined
  for (const wrapper of wrappers.splice(0)) wrapper.remove()
})

describe('finding in what is folded away', () => {
  const heading = (text: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [run(text)] })
  const shown = (text: string) => [...document.querySelectorAll<HTMLElement>('.ProseMirror > *')].some((block) => block.textContent === text && block.offsetParent !== null)

  it('counts the matches there, and shows the lines when it goes to one', async () => {
    const live = open({ type: 'doc', content: [heading('Tides'), para(run('A lamp in the first section.')), heading('Ferries'), para(run('A lamp in the second.'))] })
    live.registerPlugin(fold(() => null))
    for (const control of document.querySelectorAll<HTMLButtonElement>('.nib-fold')) act(() => control.click())
    expect(shown('A lamp in the first section.')).toBe(false)
    expect(shown('A lamp in the second.')).toBe(false)
    await ask(live)
    await type('lamp')
    await waitFor(() => expect(status()).toBe('1 of 2'))
    // The one it is on is shown; the other stays put away until Find goes there.
    expect(shown('A lamp in the first section.')).toBe(true)
    expect(shown('A lamp in the second.')).toBe(false)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(status()).toBe('2 of 2'))
    expect(shown('A lamp in the second.')).toBe(true)
  })
})

describe('finding in a document', () => {
  it('counts the matches, marks each one, and moves through them, round the ends', async () => {
    const live = open()
    await ask(live)
    await type('lamp')
    await waitFor(() => expect(status()).toBe('1 of 3'))
    expect(on()).toBe('lamp')
    expect(others()).toBe(2)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(status()).toBe('2 of 3'))
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await waitFor(() => expect(status()).toBe('1 of 3'))
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await waitFor(() => expect(status()).toBe('3 of 3'))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(status()).toBe('1 of 3'))
  })

  it('moves with its arrows, and keeps the field', async () => {
    const live = open()
    await ask(live)
    await type('lamp')
    await waitFor(() => expect(status()).toBe('1 of 3'))
    await userEvent.click(screen.getByRole('button', { name: 'Next match' }))
    await waitFor(() => expect(status()).toBe('2 of 3'))
    await userEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    await waitFor(() => expect(status()).toBe('1 of 3'))
    expect(document.activeElement).toBe(field())
  })

  it('says so when there are none, and has nowhere to go', async () => {
    const live = open()
    await ask(live)
    await type('zebra')
    await waitFor(() => expect(status()).toBe('No matches'))
    expect((screen.getByRole('button', { name: 'Next match' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Previous match' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('ignores capitals, and finds across a change of style', async () => {
    const live = open({ type: 'doc', content: [para(run('The la'), run('mp', [{ type: 'bold' }]), run(' and the LAMP.'))] })
    await ask(live)
    await type('Lamp')
    await waitFor(() => expect(status()).toBe('1 of 2'))
  })

  it('takes what is typed as it is, not as a pattern', async () => {
    const live = open({ type: 'doc', content: [para(run('A lamp, and l.mp, and a back\\nslash.'))] })
    await ask(live)
    await type('l.mp')
    await waitFor(() => expect(status()).toBe('1 of 1'))
    await act(async () => void field().select())
    await userEvent.keyboard('\\n')
    await waitFor(() => expect(status()).toBe('1 of 1'))
  })

  it('starts from where you are, and a longer word doesn’t creep on from the last match', async () => {
    const live = open()
    live.view.dispatch(live.state.tr.setSelection(TextSelection.create(live.state.doc, 20)))
    await ask(live)
    await type('l')
    await waitFor(() => expect(on()).toBe('l'))
    await userEvent.keyboard('amp')
    await waitFor(() => expect(status()).toBe('2 of 3'))
  })

  it('goes back to the earlier match when a letter is taken off', async () => {
    const live = open({ type: 'doc', content: [para(run('A lid and a lamp.'))] })
    await ask(live)
    await type('l')
    await waitFor(() => expect(status()).toBe('1 of 2'))
    await userEvent.keyboard('a')
    await waitFor(() => expect(status()).toBe('1 of 1'))
    await userEvent.keyboard('{Backspace}')
    await waitFor(() => expect(status()).toBe('1 of 2'))
  })

  it('brings the first match into view as it’s typed', async () => {
    const live = open({ type: 'doc', content: [...Array.from({ length: 120 }, (_, n) => para(run(`line ${n}`))), para(run('needle'))] }, true)
    const pane = live.view.dom.closest<HTMLElement>('[data-scroll]')!
    await ask(live)
    await type('needle')
    await waitFor(() => expect(status()).toBe('1 of 1'))
    const match = document.querySelector('.ProseMirror-active-search-match')!.getBoundingClientRect()
    const box = pane.getBoundingClientRect()
    expect(match.top).toBeGreaterThan(box.top + 64)
    expect(match.bottom).toBeLessThan(box.bottom)
  })

  it('wraps to the top when nothing comes after where you are', async () => {
    const live = open()
    live.view.dispatch(live.state.tr.setSelection(TextSelection.atEnd(live.state.doc)))
    await ask(live)
    await type('lamp')
    await waitFor(() => expect(status()).toBe('1 of 3'))
  })

  it('starts with the words selected, on one line', async () => {
    const live = open()
    live.view.dispatch(live.state.tr.setSelection(TextSelection.create(live.state.doc, 5, 9)))
    await ask(live)
    await waitFor(() => expect(field().value).toBe('lamp'))
    await waitFor(() => expect(status()).toBe('1 of 3'))
  })

  it('doesn’t start with words selected across paragraphs', async () => {
    const live = open()
    live.view.dispatch(live.state.tr.setSelection(TextSelection.create(live.state.doc, 5, 25)))
    await ask(live)
    expect(field().value).toBe('')
  })

  it('counts again as the writing changes under it', async () => {
    const live = open()
    await ask(live)
    await type('lamp')
    await waitFor(() => expect(status()).toBe('1 of 3'))
    await act(async () => void live.commands.insertContentAt(1, 'One lamp. '))
    await waitFor(() => expect(status()).toMatch(/of 4$|4 found/))
  })

  it('takes the keyboard back and selects its words on another ⌘F', async () => {
    const live = open()
    await ask(live)
    await type('lamp')
    await act(async () => void live.view.dom.focus())
    await ask(live)
    expect(document.activeElement).toBe(field())
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 4])
  })

  it('closes with Escape, back at what it found, leaving the writing as it was', async () => {
    const live = open()
    const before = live.getJSON()
    await ask(live)
    await type('lamp')
    await waitFor(() => expect(status()).toBe('1 of 3'))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(status()).toBe('2 of 3'))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('search')).toBeNull())
    expect(document.querySelector('.ProseMirror-search-match, .ProseMirror-active-search-match')).toBeNull()
    expect(live.state.doc.textBetween(live.state.selection.from, live.state.selection.to)).toBe('lamp')
    expect(live.view.hasFocus()).toBe(true)
    expect(live.getJSON()).toEqual(before)
    expect(live.can().undo()).toBe(false)
  })

  it('closes with its button too, and opens empty of highlights again', async () => {
    const live = open()
    await ask(live)
    await type('lamp')
    await waitFor(() => expect(status()).toBe('1 of 3'))
    await userEvent.click(screen.getByRole('button', { name: 'Close find' }))
    await waitFor(() => expect(screen.queryByRole('search')).toBeNull())
    await ask(live)
    expect(field().value).toBe('lamp')
  })

  describe('replacing', () => {
    const text = (live: Editor) => live.state.doc.textBetween(0, live.state.doc.content.size, '\n')
    const replaceWith = async (words: string) => {
      await userEvent.click(screen.getByRole('button', { name: 'Show replace' }))
      await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Replace with')))
      if (words) await userEvent.keyboard(words)
    }
    const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

    it('shows its row only when asked, and hides it again', async () => {
      const live = open()
      await ask(live)
      expect(screen.queryByLabelText('Replace with')).toBeNull()
      await replaceWith('')
      await userEvent.click(button('Hide replace'))
      await waitFor(() => expect(screen.queryByLabelText('Replace with')).toBeNull())
      expect(document.activeElement).toBe(field())
    })

    it('replaces the one you’re on and moves to the next', async () => {
      const live = open()
      await ask(live)
      await type('lamp')
      await waitFor(() => expect(status()).toBe('1 of 3'))
      await replaceWith('torch')
      await userEvent.click(button('Replace'))
      await waitFor(() => expect(text(live)).toBe('The torch was lit.\nA second lamp.\nAnd a third lamp at last.'))
      await waitFor(() => expect(status()).toBe('1 of 2'))
      expect(on()).toBe('lamp')
      expect(document.activeElement).toBe(screen.getByLabelText('Replace with'))
    })

    it('replaces with Return in its field, and only what you’re on', async () => {
      const live = open()
      await ask(live)
      await type('lamp')
      await waitFor(() => expect(status()).toBe('1 of 3'))
      await replaceWith('torch')
      await userEvent.keyboard('{Enter}')
      await waitFor(() => expect(status()).toBe('1 of 2'))
      expect(text(live).match(/torch/g)).toHaveLength(1)
    })

    it('replaces them all, says how many, and one Undo brings them back', async () => {
      const live = open()
      const before = live.getJSON()
      await ask(live)
      await type('lamp')
      await waitFor(() => expect(status()).toBe('1 of 3'))
      await replaceWith('torch')
      await userEvent.click(button('Replace all'))
      await waitFor(() => expect(text(live)).toBe('The torch was lit.\nA second torch.\nAnd a third torch at last.'))
      await waitFor(() => expect(status()).toBe('Replaced 3'))
      expect(button('Replace all').disabled).toBe(true)
      await act(async () => void live.commands.undo())
      expect(live.getJSON()).toEqual(before)
    })

    it('takes away what it finds when there’s nothing to put in', async () => {
      const live = open()
      await ask(live)
      await type(' lamp')
      await waitFor(() => expect(status()).toBe('1 of 3'))
      await replaceWith('')
      await userEvent.click(button('Replace all'))
      await waitFor(() => expect(text(live)).toBe('The was lit.\nA second.\nAnd a third at last.'))
    })

    it('keeps the style and notes of what it replaces', async () => {
      const note = { type: 'noteToSelf', attrs: { id: 'n1', text: 'Check.' } }
      const live = open({ type: 'doc', content: [para(run('The '), run('lamp', [{ type: 'bold' }, note]), run(' lit.'))] })
      await ask(live)
      await type('lamp')
      await waitFor(() => expect(status()).toBe('1 of 1'))
      await replaceWith('torch')
      await userEvent.click(button('Replace'))
      await waitFor(() => expect(text(live)).toBe('The torch lit.'))
      const replaced = live.getJSON().content![0].content![1] as JSONContent
      expect(replaced.text).toBe('torch')
      expect(replaced.marks?.map((mark) => mark.type).sort()).toEqual(['bold', 'noteToSelf'])
    })

    it('leaves off a style that covered only part of what it replaces', async () => {
      const live = open({ type: 'doc', content: [para(run('The '), run('la', [{ type: 'bold' }]), run('mp lit.'))] })
      await ask(live)
      await type('lamp')
      await waitFor(() => expect(status()).toBe('1 of 1'))
      await replaceWith('torch')
      await userEvent.click(button('Replace'))
      await waitFor(() => expect(text(live)).toBe('The torch lit.'))
      expect(live.getJSON().content![0].content).toEqual([run('The torch lit.')])
    })

    it('goes back to counting when you search for something else', async () => {
      const live = open()
      await ask(live)
      await type('lamp')
      await waitFor(() => expect(status()).toBe('1 of 3'))
      await replaceWith('torch')
      await userEvent.click(button('Replace all'))
      await waitFor(() => expect(status()).toBe('Replaced 3'))
      await act(async () => void field().select())
      await userEvent.keyboard('torch')
      await waitFor(() => expect(status()).toBe('1 of 3'))
    })

    it('puts in exactly what’s typed', async () => {
      const live = open({ type: 'doc', content: [para(run('A lamp.'))] })
      await ask(live)
      await type('lamp')
      await waitFor(() => expect(status()).toBe('1 of 1'))
      await replaceWith('$1 \\n')
      await userEvent.click(button('Replace all'))
      await waitFor(() => expect(text(live)).toBe('A $1 \\n.'))
    })

    it('doesn’t chase its own words when what it puts in holds what it finds', async () => {
      const live = open()
      await ask(live)
      await type('lamp')
      await waitFor(() => expect(status()).toBe('1 of 3'))
      await replaceWith('lamp post')
      await userEvent.click(button('Replace all'))
      await waitFor(() => expect(text(live)).toBe('The lamp post was lit.\nA second lamp post.\nAnd a third lamp post at last.'))
    })

    it('has nothing to replace when nothing matches', async () => {
      const live = open()
      await ask(live)
      await type('zebra')
      await waitFor(() => expect(status()).toBe('No matches'))
      await replaceWith('horse')
      expect(button('Replace').disabled).toBe(true)
      expect(button('Replace all').disabled).toBe(true)
      await userEvent.keyboard('{Enter}')
      expect(text(live)).toBe('The lamp was lit.\nA second lamp.\nAnd a third lamp at last.')
    })

    it('counts as a change to the document, so it’s saved', async () => {
      const live = open()
      let updates = 0
      live.on('update', () => updates++)
      await ask(live)
      await type('lamp')
      await waitFor(() => expect(status()).toBe('1 of 3'))
      expect(updates).toBe(0)
      await replaceWith('torch')
      expect(updates).toBe(0)
      await userEvent.click(button('Replace all'))
      await waitFor(() => expect(updates).toBe(1))
    })

    it('keeps the next match out from under both rows', async () => {
      const live = open({ type: 'doc', content: [para(run('needle')), ...Array.from({ length: 120 }, (_, n) => para(run(`line ${n}`))), para(run('needle'))] }, true)
      const pane = live.view.dom.closest<HTMLElement>('[data-scroll]')!
      await ask(live)
      await type('needle')
      await waitFor(() => expect(status()).toBe('1 of 2'))
      await replaceWith('pin')
      await userEvent.click(button('Replace'))
      await waitFor(() => expect(status()).toBe('1 of 1'))
      const match = document.querySelector('.ProseMirror-active-search-match')!.getBoundingClientRect()
      const box = pane.getBoundingClientRect()
      expect(match.top).toBeGreaterThan(box.top + 100)
      expect(match.bottom).toBeLessThan(box.bottom)
    })
  })

  describe('matching capitals and whole words', () => {
    const NAMES: JSONContent = { type: 'doc', content: [para(run('Ann met Anne.')), para(run('ann said annual things.')), para(run('Ann left.'))] }
    const text = (live: Editor) => live.state.doc.textBetween(0, live.state.doc.content.size, '\n')
    const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

    it('counts capitals and parts of words only when asked, each on its own or both', async () => {
      const live = open(NAMES)
      await ask(live)
      await type('Ann')
      await waitFor(() => expect(status()).toBe('1 of 5'))
      await userEvent.click(button('Show replace'))
      await userEvent.click(button('Match case'))
      await waitFor(() => expect(status()).toBe('1 of 3'))
      expect(button('Match case').getAttribute('aria-pressed')).toBe('true')
      await userEvent.click(button('Whole words'))
      await waitFor(() => expect(status()).toBe('1 of 2'))
      await userEvent.click(button('Match case'))
      await waitFor(() => expect(status()).toBe('1 of 3'))
      expect(document.activeElement).toBe(field())
    })

    it('replaces only what they match', async () => {
      const live = open(NAMES)
      await ask(live)
      await type('Ann')
      await userEvent.click(button('Show replace'))
      await userEvent.click(button('Match case'))
      await userEvent.click(button('Whole words'))
      await waitFor(() => expect(status()).toBe('1 of 2'))
      await act(async () => void (screen.getByLabelText('Replace with') as HTMLInputElement).focus())
      await userEvent.keyboard('Anna')
      await userEvent.click(button('Replace all'))
      await waitFor(() => expect(text(live)).toBe('Anna met Anne.\nann said annual things.\nAnna left.'))
    })

    it('lets go of both once the row is closed', async () => {
      const live = open(NAMES)
      await ask(live)
      await type('Ann')
      await userEvent.click(button('Show replace'))
      await userEvent.click(button('Match case'))
      await userEvent.click(button('Whole words'))
      await waitFor(() => expect(status()).toBe('1 of 2'))
      await userEvent.click(button('Hide replace'))
      await waitFor(() => expect(status()).toBe('1 of 5'))
      await userEvent.click(button('Show replace'))
      expect(button('Match case').getAttribute('aria-pressed')).toBe('false')
      expect(button('Whole words').getAttribute('aria-pressed')).toBe('false')
    })
  })

  describe('opened at a match of a book’s find', () => {
    const NAMES: JSONContent = { type: 'doc', content: [para(run('Ann met Anne.')), para(run('ann said annual things.')), para(run('Ann left.'))] }
    const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')
    const seed = { words: 'Ann', caseSensitive: true, wholeWord: true, regex: false, index: 1 }

    it('opens on the words and switches it’s given, at the match it’s given', async () => {
      const live = open(NAMES)
      await act(async () => openFind(live, seed))
      await waitFor(() => expect(status()).toBe('2 of 2'))
      expect(field().value).toBe('Ann')
      expect(pressed('Match case')).toBe('true')
      expect(pressed('Whole words')).toBe('true')
      expect(pressed('Regular expression')).toBe('false')
      const { from, to } = live.state.selection
      expect(live.state.doc.textBetween(from, to + 5)).toBe('Ann left')
      // A frame on, after the chapter's own focus.
      await waitFor(() => expect(document.activeElement).toBe(field()))
    })

    it('takes one given before it’s there, as a chapter only just opened is', async () => {
      const element = document.createElement('div')
      document.body.append(element)
      wrappers.push(element)
      editor = new Editor({ element, extensions: nibExtensions(true), content: NAMES })
      const live = editor
      await act(async () => openFind(live, { ...seed, index: 0 }))
      render(<FindBar editor={live} readOnly={false} />)
      await waitFor(() => expect(status()).toBe('1 of 2'))
      expect(field().value).toBe('Ann')
    })

    it('goes to the first when there aren’t as many as it was told, the chapter changed since', async () => {
      const live = open(NAMES)
      await act(async () => openFind(live, { ...seed, index: 7 }))
      await waitFor(() => expect(status()).toBe('1 of 2'))
    })
  })

  describe('with a pattern', () => {
    const text = (live: Editor) => live.state.doc.textBetween(0, live.state.doc.content.size, '\n')
    const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
    const lit = () => document.querySelectorAll('.ProseMirror-search-match, .ProseMirror-active-search-match').length
    async function patterns(live: Editor) {
      await ask(live)
      await userEvent.click(button('Show replace'))
      await userEvent.click(button('Regular expression'))
      expect(document.activeElement).toBe(field())
    }
    const retype = async (words: string) => {
      await act(async () => void field().select())
      await userEvent.keyboard(words)
    }

    it('finds by pattern, ignoring capitals, only when asked', async () => {
      const live = open()
      await ask(live)
      await type('l.mp')
      await waitFor(() => expect(status()).toBe('No matches'))
      await userEvent.click(button('Show replace'))
      await userEvent.click(button('Regular expression'))
      await waitFor(() => expect(status()).toBe('1 of 3'))
      expect(button('Regular expression').getAttribute('aria-pressed')).toBe('true')
      await retype('L.MP')
      await waitFor(() => expect(status()).toBe('1 of 3'))
      await userEvent.click(button('Regular expression'))
      await waitFor(() => expect(status()).toBe('No matches'))
    })

    it('reads words as words again once the row is closed', async () => {
      const live = open()
      await patterns(live)
      await type('l.mp')
      await waitFor(() => expect(status()).toBe('1 of 3'))
      await userEvent.click(button('Hide replace'))
      await waitFor(() => expect(status()).toBe('No matches'))
    })

    it('says when a pattern isn’t one, and does nothing with it', async () => {
      const live = open()
      await patterns(live)
      await type('(lamp')
      await waitFor(() => expect(status()).toBe('Invalid pattern'))
      expect(lit()).toBe(0)
      expect(button('Replace all').disabled).toBe(true)
    })

    it('uses what the pattern caught in what it puts in', async () => {
      const live = open()
      await patterns(live)
      await type('(l)amp')
      await waitFor(() => expect(status()).toBe('1 of 3'))
      await act(async () => void (screen.getByLabelText('Replace with') as HTMLInputElement).focus())
      await userEvent.keyboard('$1oom')
      await userEvent.click(button('Replace all'))
      await waitFor(() => expect(text(live)).toBe('The loom was lit.\nA second loom.\nAnd a third loom at last.'))
      await act(async () => void live.commands.undo())
      expect(text(live)).toBe('The lamp was lit.\nA second lamp.\nAnd a third lamp at last.')
    })

    it('keeps a note to self on what a pattern replaces', async () => {
      const note = { type: 'noteToSelf', attrs: { id: 'n1', text: 'Check.' } }
      const live = open({ type: 'doc', content: [para(run('The '), run('lamp', [note]), run(' lit.'))] })
      await patterns(live)
      await type('la.p')
      await waitFor(() => expect(status()).toBe('1 of 1'))
      await act(async () => void (screen.getByLabelText('Replace with') as HTMLInputElement).focus())
      await userEvent.keyboard('torch')
      await userEvent.click(button('Replace'))
      await waitFor(() => expect(text(live)).toBe('The torch lit.'))
      expect((live.getJSON().content![0].content![1] as JSONContent).marks?.map((mark) => mark.type)).toEqual(['noteToSelf'])
    })

    // Without the worker each of these would hang this page for longer than anyone would wait.
    it.each([
      ['runs of one letter', '(a+)+$', `${'a'.repeat(40)}!`],
      ['ordinary sentences', '(\\w+ ?)+:', 'The keeper climbed the long stair and checked the lamp and wrote it all down in the log before the morning came over the flats and the gulls went out to sea'],
    ])('refuses a pattern that would never finish, on %s, and the app carries on', async (_what, words, writing) => {
      const live = open({ type: 'doc', content: [para(run(writing))] })
      await patterns(live)
      await type(words)
      await waitFor(() => expect(status()).toBe('Too slow to run'), { timeout: 4000 })
      expect(lit()).toBe(0)
      expect(button('Replace all').disabled).toBe(true)
      await retype('the|a')
      await waitFor(() => expect(status()).toMatch(/ of \d+$/))
    })

    it('forgets a check overtaken by the next letter', async () => {
      const live = open({ type: 'doc', content: [para(run(`${'a'.repeat(40)}!`))] })
      await patterns(live)
      await type('(a+)+$')
      await retype('a+')
      await waitFor(() => expect(status()).toBe('1 of 1'))
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(status()).toBe('1 of 1')
    })

    it('refuses one that matches empty text, which has nothing to show or replace', async () => {
      const live = open()
      await patterns(live)
      await type('x*')
      await waitFor(() => expect(status()).toBe('Matches empty text'))
      expect(lit()).toBe(0)
      expect(button('Replace all').disabled).toBe(true)
    })

    it('won’t run a pattern it couldn’t check', async () => {
      vi.stubGlobal('Worker', class { constructor() { throw new Error('No workers here') } })
      const live = open()
      await patterns(live)
      await type('l.mp')
      await waitFor(() => expect(status()).toBe('Can’t check this'))
      expect(lit()).toBe(0)
    })

    it('still finds plain words where workers can’t run', async () => {
      vi.stubGlobal('Worker', class { constructor() { throw new Error('No workers here') } })
      const live = open()
      await ask(live)
      await type('lamp')
      await waitFor(() => expect(status()).toBe('1 of 3'))
    })
  })

  it('stays where it is when there’s nothing to go to', async () => {
    const live = open({ type: 'doc', content: Array.from({ length: 120 }, (_, n) => para(run(`line ${n}`))) }, true)
    const pane = live.view.dom.closest<HTMLElement>('[data-scroll]')!
    await ask(live)
    await type('zebra')
    await waitFor(() => expect(status()).toBe('No matches'))
    pane.scrollTop = 900
    await userEvent.keyboard('{Enter}')
    expect(pane.scrollTop).toBe(900)
  })

  it('brings a match out from under the bar and into view', async () => {
    const live = open({ type: 'doc', content: [para(run('needle')), ...Array.from({ length: 120 }, (_, n) => para(run(`line ${n}`))), para(run('needle'))] }, true)
    const pane = live.view.dom.closest<HTMLElement>('[data-scroll]')!
    await ask(live)
    await type('needle')
    await waitFor(() => expect(status()).toBe('1 of 2'))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(status()).toBe('2 of 2'))
    const match = document.querySelector('.ProseMirror-active-search-match')!.getBoundingClientRect()
    const box = pane.getBoundingClientRect()
    expect(pane.scrollTop).toBeGreaterThan(0)
    expect(match.top).toBeGreaterThan(box.top + 64)
    expect(match.bottom).toBeLessThan(box.bottom)
  })
})
