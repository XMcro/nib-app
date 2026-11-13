import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { cleanup, render, screen, within } from '@testing-library/react'
import '../index.css'
import { PROMPTS } from '../buddy/answers'
import { BuddyAsk } from './BuddyAsk'

afterEach(cleanup)

const field = () => screen.getByRole('textbox', { name: 'Ask Inkwell' })
const says = () => within(screen.getByRole('region', { name: 'What Inkwell says' }))
const answer = () => screen.findByRole('article')
/** The screen in the region now (components/BuddyAsk), as it came in. */
const current = () => screen.getByRole('region', { name: 'What Inkwell says' }).querySelector<HTMLElement>('.nib-buddy-screen')!
/** The prompt shown, written out a word at a time but whole in the page. */
const promptShown = () => current().querySelector('h3 + p')!.textContent!

describe('asking the writing buddy', () => {
  it('shows the closest answer, and goes on to one it offers, and back to the topics', async () => {
    render(<BuddyAsk />)
    await says().findByRole('group', { name: 'Topics' })
    await userEvent.fill(field(), 'how do I lock a note')
    expect((await answer()).getAttribute('aria-label')).toBe('How do I lock a note?')
    expect((await answer()).textContent).toMatch(/choose Lock this note in Commands/)
    await userEvent.click(says().getByRole('button', { name: 'How do I take the lock off a note?' }))
    expect((await answer()).getAttribute('aria-label')).toBe('How do I take the lock off a note?')
    await userEvent.click(says().getByRole('button', { name: '← Topics' }))
    expect(says().getByRole('group', { name: 'Topics' })).toBeTruthy()
    expect((field() as HTMLInputElement).value).toBe('')
  })

  it('shows a list as a list, one that follows a line of its own too', async () => {
    render(<BuddyAsk />)
    await says().findByRole('group', { name: 'Topics' })
    await userEvent.fill(field(), 'my notes disappeared')
    const shown = await answer()
    expect(shown.querySelector('p')!.textContent).toBe('Try these, in turn:')
    expect(within(shown).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3)
    expect(shown.textContent).not.toMatch(/(^|\s)- /)
  })

  it('lists a topic’s questions, and goes back to the list from one', async () => {
    render(<BuddyAsk />)
    await userEvent.click(await says().findByRole('button', { name: 'Word pairs' }))
    await userEvent.click(says().getByRole('button', { name: 'Affect or effect?' }))
    expect((await answer()).getAttribute('aria-label')).toBe('Affect or effect?')
    await userEvent.click(says().getByRole('button', { name: '← Word pairs' }))
    expect(says().getByRole('list', { name: 'Word pairs' })).toBeTruthy()
  })

  it('says when it doesn’t know, and offers the topics', async () => {
    render(<BuddyAsk />)
    await says().findByRole('group', { name: 'Topics' })
    await userEvent.fill(field(), 'banana smoothie recipe')
    expect(await says().findByText(/I don’t know that one yet/)).toBeTruthy()
    expect(says().getByRole('group', { name: 'Topics' })).toBeTruthy()
  })

  it('gives something to write from, asked for or picked, and another', async () => {
    render(<BuddyAsk />)
    await userEvent.click(await says().findByRole('button', { name: 'Give me a prompt' }))
    const one = promptShown()
    expect(PROMPTS).toContain(one)
    await userEvent.click(says().getByRole('button', { name: 'Another' }))
    const two = promptShown()
    expect(PROMPTS).toContain(two)
    expect(two).not.toBe(one)

    await userEvent.click(says().getByRole('button', { name: '← Topics' }))
    await userEvent.fill(field(), 'give me a writing prompt')
    expect(await says().findByText('Something to write from')).toBeTruthy()
  })

  // Asked 2026-11-13: the screens sliding, the answers writing out, the buddy moved by what's asked.
  it('slides each screen in, deeper from the right and back from the left, in place as a question’s typed', async () => {
    render(<BuddyAsk />)
    await says().findByRole('group', { name: 'Topics' })
    await userEvent.click(says().getByRole('button', { name: 'Word pairs' }))
    expect(current().dataset.way).toBe('on')
    await userEvent.click(says().getByRole('button', { name: '← Topics' }))
    expect(current().dataset.way).toBe('back')
    await userEvent.fill(field(), 'how do I lock a note')
    await answer()
    expect(current().dataset.way).toBe('here')
  })

  it('writes an answer out a word at a time, every word in the page from the start', async () => {
    render(<BuddyAsk />)
    await says().findByRole('group', { name: 'Topics' })
    await userEvent.fill(field(), 'how do I lock a note')
    const shown = await answer()
    const words = [...shown.querySelectorAll<HTMLElement>('.nib-buddy-word')]
    expect(words.length).toBeGreaterThan(5)
    expect(words.map((word) => Number(word.style.getPropertyValue('--w')))).toEqual(words.map((_, index) => index))
    expect(shown.textContent).toMatch(/choose Lock this note in Commands/)
  })

  it('has the buddy think as a question’s typed, and nod once it rests on an answer', async () => {
    const onMood = vi.fn()
    render(<BuddyAsk onMood={onMood} />)
    await says().findByRole('group', { name: 'Topics' })
    await userEvent.fill(field(), 'how do I lock a note')
    await vi.waitFor(() => expect(onMood).toHaveBeenLastCalledWith('nod'))
    expect(onMood).toHaveBeenCalledWith('think')
    onMood.mockClear()
    await userEvent.fill(field(), 'banana smoothie recipe')
    await vi.waitFor(() => expect(onMood).toHaveBeenLastCalledWith(null))
  })
})
