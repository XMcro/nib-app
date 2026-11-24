import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { useState } from 'react'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { localDay } from './lib/time'

/** Read aloud from Commands, in the Mac app as it has ⌘K: started, stopped, and finished. */

vi.mock('./lib/platform', async (importOriginal) => {
  const real = await importOriginal<typeof import('./lib/platform')>()
  return { ...real, nativeApp: true, macApp: true, touchApp: false }
})

// Nib Plus, which this has needed since Phase 10 (without it, Commands offers Plus: App.test).
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [...useState({ active: true }), true],
}))

const { App } = await import('./App')
const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)))
const library = () => within(document.querySelector<HTMLElement>('.nib-library')!)
const commands = async () => {
  await act(async () => void window.dispatchEvent(Object.assign(new Event('nibmenu'), { id: 'palette' })))
  return within(screen.getByRole('dialog', { name: 'Commands' }))
}

/** The system's voice, as far as Read aloud uses it. */
class Utterance {
  rate = 1
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  text: string
  constructor(text: string) {
    this.text = text
  }
}
const spoken: Utterance[] = []
const voice = { speak: vi.fn((utterance: Utterance) => void spoken.push(utterance)), cancel: vi.fn() }

beforeEach(async () => {
  // Noon, whatever hour the tests run at: across midnight a pack or the day's coins would come up over the test. Only the date; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') })
  localStorage.setItem('nib-device-asked', '1')
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]])) // today's pack, opened already (rewards.browser.test)
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }])) // today's coins, collected already (rewards.browser.test)
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  await db.items.clear()
  spoken.length = 0
  vi.clearAllMocks()
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('speechSynthesis', voice)
})
afterEach(() => void vi.useRealTimers())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function open(text: string) {
  await page.viewport(1024, 768)
  await items.create('page', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  await act(async () => void render(<App />))
  await userEvent.click(library().getByRole('tab', { name: 'Pages' }))
  await userEvent.click(await library().findByText(text))
  await expect.poll(() => document.querySelector('.ProseMirror')?.textContent).toContain(text)
}

describe('Read aloud', () => {
  it('reads from Commands, sentence by sentence, and offers Read aloud again at the end', async () => {
    await open('One goes. Two goes.')
    await userEvent.click((await commands()).getByText('Read aloud'))
    expect(spoken.map((utterance) => utterance.text)).toEqual(['One goes.'])
    expect((await commands()).getByText('Stop reading')).toBeTruthy()
    await userEvent.keyboard('{Escape}')

    act(() => spoken[0].onend!())
    act(() => spoken[1].onend!())
    expect(spoken.map((utterance) => utterance.text)).toEqual(['One goes.', 'Two goes.'])
    expect((await commands()).getByText('Read aloud')).toBeTruthy()
  })

  it('stops from Commands, and when another document opens', async () => {
    await open('One goes. Two goes.')
    await userEvent.click((await commands()).getByText('Read aloud'))
    voice.cancel.mockClear()
    await userEvent.click((await commands()).getByText('Stop reading'))
    expect(voice.cancel).toHaveBeenCalled()
    await userEvent.click((await commands()).getByText('Read aloud'))
    voice.cancel.mockClear()
    await userEvent.click((await commands()).getByText('New note'))
    await wait()
    expect(voice.cancel).toHaveBeenCalled()
    expect((await commands()).queryByText('Stop reading')).toBeNull()
  })

  it('stops when Nib leaves the screen', async () => {
    await open('One goes. Two goes.')
    await userEvent.click((await commands()).getByText('Read aloud'))
    voice.cancel.mockClear()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    try {
      await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState
    }
    expect(voice.cancel).toHaveBeenCalled()
    expect((await commands()).queryByText('Stop reading')).toBeNull()
  })

  // On a Mac, Lock Nib covers a window that stays on the screen, so it isn't hidden: reading went on behind the cover.
  it('stops when Lock Nib covers it', async () => {
    await open('One goes. Two goes.')
    await userEvent.click((await commands()).getByText('Read aloud'))
    voice.cancel.mockClear()
    await act(async () => void window.dispatchEvent(new Event('niblock')))
    expect(voice.cancel).toHaveBeenCalled()
  })

  // The library covers the bar and the writing goes out of reach: the voice went on with no way to stop it.
  it('stops when the library comes back over the text', async () => {
    await open('A sentence to read.')
    await userEvent.click((await commands()).getByText('Read aloud'))
    voice.cancel.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Pages' }))
    expect(voice.cancel).toHaveBeenCalled()
  })

  it('shows a bar while reading, and highlights each sentence as it’s read', async () => {
    await open('One goes. Two goes.')
    await userEvent.click((await commands()).getByText('Read aloud'))
    const bar = screen.getByRole('toolbar', { name: 'Reading aloud' })
    expect(within(bar).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['Pause', 'Slower', 'Faster', 'Stop'])
    const highlighted = () => [...document.querySelectorAll('.nib-reading')].map((part) => part.textContent).join('')
    expect(highlighted()).toBe('One goes.')
    act(() => spoken[0].onend!())
    expect(highlighted()).toBe('Two goes.')
    act(() => spoken[1].onend!())
    expect(highlighted()).toBe('')
    expect(screen.queryByRole('toolbar', { name: 'Reading aloud' })).toBeNull()
  })

  it('pauses and resumes from the bar, the sentence starting again', async () => {
    await open('One goes. Two goes.')
    await userEvent.click((await commands()).getByText('Read aloud'))
    voice.cancel.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(voice.cancel).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(spoken.map((utterance) => utterance.text)).toEqual(['One goes.', 'One goes.'])
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
  })

  it('goes faster and slower from the bar, at once, and keeps the speed for next time', async () => {
    localStorage.removeItem('nib-reading-rate')
    await open('One goes. Two goes.')
    await userEvent.click((await commands()).getByText('Read aloud'))
    const bar = within(screen.getByRole('toolbar', { name: 'Reading aloud' }))
    expect(bar.getByText('1×')).toBeTruthy()
    await userEvent.click(bar.getByRole('button', { name: 'Faster' }))
    expect(bar.getByText('1.25×')).toBeTruthy()
    expect(spoken.map((utterance) => [utterance.text, utterance.rate])).toEqual([['One goes.', 1], ['One goes.', 1.25]])
    expect(localStorage.getItem('nib-reading-rate')).toBe('1.25')
    await userEvent.click(bar.getByRole('button', { name: 'Slower' }))
    await userEvent.click(bar.getByRole('button', { name: 'Slower' }))
    expect(bar.getByText('0.75×')).toBeTruthy()
    expect(bar.getByRole('button', { name: 'Slower' })).toHaveProperty('disabled', true)
    localStorage.removeItem('nib-reading-rate')
  })

  it('stops from the bar, with a tap in the text, and with a change to it', async () => {
    await open('One goes. Two goes.')
    const stopped = () => !screen.queryByRole('toolbar', { name: 'Reading aloud' }) && !document.querySelector('.nib-reading')
    const read = async () => {
      await userEvent.click((await commands()).getByText('Read aloud'))
      expect(stopped()).toBe(false)
    }
    await read()
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(stopped()).toBe(true)

    await read()
    await userEvent.click(document.querySelector('.ProseMirror')!)
    expect(stopped()).toBe(true)

    await read()
    const editor = (document.querySelector('.ProseMirror') as HTMLElement & { editor: import('@tiptap/core').Editor }).editor
    act(() => void editor.commands.insertContentAt(1, 'And '))
    expect(stopped()).toBe(true)
  })

  it('says so when there’s nothing to read', async () => {
    // A scene break: no words.
    await open('* * *')
    await userEvent.click((await commands()).getByText('Read aloud'))
    expect(voice.speak).not.toHaveBeenCalled()
    expect(screen.getByText('There’s nothing here to read.')).toBeTruthy()
  })
})
