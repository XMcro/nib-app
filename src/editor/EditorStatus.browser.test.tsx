import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import type { DailyGoal } from '../lib/goal'
import { localDay } from '../lib/time'
import { describeLength } from '../lib/stats'
import { plainText } from '../lib/text'
import { nibExtensions } from './extensions'
import { EditorStatus, type GoalControls } from './EditorStatus'

/**
 * Needs a live editor, so it could not be rendered under jsdom at all.
 *
 * The cross-check below is the point of this file: the status button counts
 * from the running document, while the history panel counts from the stored
 * JSON via plainText. The two used to disagree — a three-item
 * checklist read as 6 words here and 4 there — and nothing caught it.
 */

let editor: Editor | undefined

function mount(content: string, item?: Item, goal?: DailyGoal, goals?: GoalControls) {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({ element, extensions: nibExtensions(true), content })
  return render(<EditorStatus editor={editor} item={item} goal={goal} goals={goals} />)
}

const status = () => screen.getByRole('button')
const storedCount = () => describeLength(plainText(editor!.getJSON() as JSONContent))

const item = (overrides: Partial<Item> = {}): Item => ({
  id: 'x',
  kind: 'note',
  body: { type: 'doc' },
  version: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
})

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

describe('EditorStatus', () => {
  it('says Empty before anything is written', () => {
    mount('')
    expect(status().textContent).toBe('Empty')
  })

  it('counts words and estimates reading time', () => {
    mount('<p>one two three four five</p>')
    expect(status().textContent).toBe('5 words · 1 min')
  })

  it('says "1 word" rather than "1 words"', () => {
    mount('<p>alone</p>')
    expect(status().textContent).toBe('1 word · 1 min')
  })

  it('keeps up as the document is typed into', async () => {
    mount('<p>one</p>')
    expect(status().textContent).toBe('1 word · 1 min')

    editor!.commands.focus('end')
    editor!.view.dom.focus()
    await userEvent.keyboard(' two three')

    await waitFor(() => expect(status().textContent).toBe('3 words · 1 min'))
  })

  it('opens the detail panel, and closes it again', async () => {
    mount('<p>one two</p>')
    expect(status().getAttribute('aria-expanded')).toBe('false')

    await userEvent.click(status())
    await waitFor(() => expect(status().getAttribute('aria-expanded')).toBe('true'))
    expect(screen.getByText('Words')).toBeTruthy()
    expect(screen.getByText('Characters')).toBeTruthy()

    await userEvent.click(status())
    await waitFor(() => expect(screen.queryByText('Words')).toBeNull())
  })

  it('describes the document only when there is one saved', async () => {
    mount('<p>one</p>')
    await userEvent.click(status())
    expect(screen.queryByText('Kind')).toBeNull()

    cleanup()
    editor?.destroy()
    document.body.replaceChildren()

    mount('<p>one</p>', item({ kind: 'page' }))
    await userEvent.click(status())
    expect(screen.getByText('Kind')).toBeTruthy()
    expect(screen.getByText('Page')).toBeTruthy()
    expect(screen.getByText('Created')).toBeTruthy()
    expect(screen.getByText('Edited')).toBeTruthy()
  })

  it('counts an emoji as one character, not two', async () => {
    mount('<p>hi 👋</p>')
    await userEvent.click(status())
    // "hi 👋" is four code points.
    expect(screen.getByText('4')).toBeTruthy()
  })

  // The regression the audit found: these two counts are shown side by side in
  // the app, so they have to agree on the same document.
  it.each([
    ['a checklist', '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Buy milk</p></li><li data-type="taskItem" data-checked="false"><p>Call mum</p></li><li data-type="taskItem" data-checked="false"><p>Book flight</p></li></ul>'],
    ['a bullet list', '<ul><li><p>first item</p></li><li><p>second item</p></li></ul>'],
    ['a multi-paragraph quote', '<blockquote><p>one here</p><p>two here</p></blockquote>'],
    ['a heading and prose', '<h1>The title</h1><p>Some prose follows.</p>'],
    ['a hard break', '<p>before<br>after</p>'],
    ['nested lists', '<ul><li><p>outer one</p><ul><li><p>inner two</p></li></ul></li></ul>'],
    ['a footnote', '<p>A claim<sup data-footnote data-text="Pevensie 1950 page 12"></sup></p>'],
  ])('agrees with the stored count for %s', (_label, content) => {
    mount(content)
    expect(status().textContent).toBe(storedCount())
  })
})

describe('the daily goal (Nib Plus)', () => {
  it('shows the day’s progress beside the count', () => {
    mount('<p>Three words here</p>', undefined, { goal: 500, written: 312, streak: 0 })
    expect(status().textContent).toBe('3 words · 1 min · 312 of 500 today')
  })

  it('says so when it is met, with the run of days', () => {
    mount('<p>Three words here</p>', undefined, { goal: 500, written: 540, streak: 4 })
    expect(status().textContent).toBe('3 words · 1 min · Goal met · 4 days in a row')
  })

  it('shows nothing extra without a goal', () => {
    mount('<p>Three words here</p>')
    expect(status().textContent).toBe('3 words · 1 min')
  })
})

const controls = (overrides: Partial<GoalControls> = {}): GoalControls => ({
  plus: true,
  sprint: null,
  sprintDone: null,
  onSetGoal: vi.fn(),
  onStartSprint: vi.fn(),
  onStopSprint: vi.fn(),
  onDismissSprint: vi.fn(),
  onPlus: vi.fn(),
  request: null,
  ...overrides,
})

// With the panel open there are other buttons, one of them a toggle too; the line comes after the panel.
const line = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].at(-1)!
const tomorrow = () => localDay(Date.now() + 86_400_000)

describe('a document’s goal (Nib Plus)', () => {
  it('shows progress and the pace needed in place of the count', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') }) // noon: the test's days can't change under it
    onTestFinished(() => void vi.useRealTimers())
    mount('<p>Three words here</p>', item({ goal: { words: 10, deadline: tomorrow() } }), undefined, controls())
    // 7 left over today and tomorrow.
    expect(line().textContent).toMatch(/^3 of 10 · 4\/day to make \w+ \d+$/)
  })

  it('shows the count as before without Plus, goal or not', () => {
    mount('<p>Three words here</p>', item({ goal: { words: 10 } }), undefined, controls({ plus: false }))
    expect(line().textContent).toBe('3 words · 1 min')
  })

  it('is set from the panel, with an optional deadline', async () => {
    const goals = controls()
    mount('<p>one</p>', item(), undefined, goals)
    await userEvent.click(line())
    await userEvent.click(screen.getByRole('button', { name: 'Set a goal for this' }))
    await userEvent.fill(screen.getByLabelText('Goal, in words'), '2000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(goals.onSetGoal).toHaveBeenLastCalledWith({ words: 2000 })

    await userEvent.click(screen.getByRole('button', { name: 'Set a goal for this' }))
    await userEvent.fill(screen.getByLabelText('Goal, in words'), '5000')
    await userEvent.fill(screen.getByLabelText('Deadline, optional'), '2026-11-30')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(goals.onSetGoal).toHaveBeenLastCalledWith({ words: 5000, deadline: '2026-11-30' })
  })

  it('is changed or removed from the panel', async () => {
    const goals = controls()
    mount('<p>one</p>', item({ goal: { words: 5000 } }), undefined, goals)
    await userEvent.click(line())
    await userEvent.click(screen.getByRole('button', { name: 'Change the goal' }))
    expect((screen.getByLabelText('Goal, in words') as HTMLInputElement).value).toBe('5000')
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(goals.onSetGoal).toHaveBeenLastCalledWith(null)
  })

  it('opens at its form when the palette asks', async () => {
    const goals = controls()
    const { rerender } = mount('<p>one</p>', item(), undefined, goals)
    expect(screen.queryByLabelText('Goal, in words')).toBeNull()
    rerender(<EditorStatus editor={editor!} item={item()} goals={{ ...goals, request: { form: 'goal', at: 1 } }} />)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Goal, in words')))
  })

  // App keeps the last request and the status line remounts with each document: every one opened after it came up at that form.
  it('acts only on a request that arrives after it mounted', async () => {
    const goals = controls()
    const asked = { ...goals, request: { form: 'goal', at: 1 } as const }
    const { rerender } = mount('<p>one</p>', item(), undefined, goals)
    rerender(<EditorStatus editor={editor!} item={item()} goals={asked} />)
    await waitFor(() => expect(screen.getByLabelText('Goal, in words')).toBeTruthy())

    // The next document, the same request still there.
    rerender(<EditorStatus key="next" editor={editor!} item={item()} goals={asked} />)
    expect(screen.queryByLabelText('Goal, in words')).toBeNull()

    // Asked again, from there.
    rerender(<EditorStatus key="next" editor={editor!} item={item()} goals={{ ...goals, request: { form: 'goal', at: 2 } }} />)
    await waitFor(() => expect(screen.getByLabelText('Goal, in words')).toBeTruthy())
  })
})

describe('sprints (Nib Plus)', () => {
  it('start at a set length, or one of your own', async () => {
    const goals = controls()
    mount('<p>one</p>', undefined, undefined, goals)
    await userEvent.click(line())
    await userEvent.click(screen.getByRole('button', { name: 'Start a 25-minute sprint' }))
    expect(goals.onStartSprint).toHaveBeenLastCalledWith(25)
    await userEvent.click(screen.getByRole('button', { name: 'Other' }))
    await userEvent.fill(screen.getByLabelText('Sprint length, in minutes'), '7')
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(goals.onStartSprint).toHaveBeenLastCalledWith(7)
  })

  it('show the words so far and the time left, and can be ended early', async () => {
    const goals = controls({ sprint: { endsAt: Date.now() + 12.5 * 60_000, written: 210 } })
    mount('<p>one</p>', undefined, undefined, goals)
    expect(line().textContent).toBe('Sprint · 210 words · 13 min left')
    await userEvent.click(line())
    await userEvent.click(screen.getByRole('button', { name: 'End the sprint' }))
    expect(goals.onStopSprint).toHaveBeenCalled()
  })

  it('end in a quiet summary, gone once clicked', async () => {
    const goals = controls({ sprintDone: { minutes: 25, written: 412 } })
    mount('<p>one</p>', undefined, undefined, goals)
    expect(line().textContent).toBe('Sprint done · 412 words in 25 min')
    await userEvent.click(line())
    expect(goals.onDismissSprint).toHaveBeenCalled()
  })
})

describe('a document’s goal and sprints without Plus', () => {
  it('are one row marked Plus, which asks for Plus', async () => {
    const goals = controls({ plus: false })
    mount('<p>one</p>', item(), undefined, goals)
    await userEvent.click(line())
    expect(screen.queryByRole('button', { name: /Set a goal/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Deadlines and sprints/ }))
    expect(goals.onPlus).toHaveBeenCalledWith('Deadlines and sprints are part of Nib Plus, with a calendar of your writing days.')
  })
})
