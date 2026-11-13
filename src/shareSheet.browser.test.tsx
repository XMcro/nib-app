import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import type { Capture, Target } from './lib/inbox'
import { plainText } from './lib/text'
import { localDay } from './lib/time'

/**
 * The share sheet's side of the app (lib/inbox, lib/useLaunchServices): the
 * notes it's told it may add to, and what's shared into one of them arriving
 * when Nib comes to the front. The inbox itself is stood in for.
 */

const device = vi.hoisted(() => ({ captures: [] as object[], acked: [] as string[], told: [] as object[][], plus: [] as boolean[] }))
vi.mock('./lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/platform')>()), nativeApp: true, macApp: true, touchApp: false }))
// Whether the App Store has answered yet, which a test can hold back.
const store = vi.hoisted(() => ({ known: true, answer: () => {} }))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => {
    const [known, setKnown] = useState(store.known)
    store.answer = () => setKnown(true)
    return [{ active: false }, () => {}, known]
  },
}))
vi.mock('@capacitor/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@capacitor/core')>()
  const inbox = {
    list: async () => ({ captures: device.captures }),
    ack: async ({ ids }: { ids: string[] }) => {
      device.acked.push(...ids)
      device.captures = (device.captures as Capture[]).filter((capture) => !ids.includes(capture.id))
    },
    targets: async ({ targets }: { targets: Target[] }) => void device.told.push(targets),
    plus: async ({ active }: { active: boolean }) => void device.plus.push(active),
    addListener: async () => ({ remove: async () => {} }),
  }
  return { ...real, registerPlugin: (name: string, ...rest: []) => (name === 'NibInbox' ? inbox : real.registerPlugin(name, ...rest)) }
})

const { App } = await import('./App')
const library = () => within(document.querySelector<HTMLElement>('.nib-library')!)
const HARBOUR = 'ab1e0000-0000-4000-8000-000000000001'
const FERRY = 'ab1e0000-0000-4000-8000-000000000002'
const CAPTURE = 'c0ffee00-0000-4000-8000-000000000001'
const doc = (...lines: string[]) => ({ type: 'doc', content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) })
const editorText = () => [...document.querySelectorAll('main [data-scroll] .ProseMirror > p')].map((line) => line.textContent)
/** Nib coming back to the front, as it does after the share sheet in another app. */
const comeToFront = () => act(async () => void document.dispatchEvent(new Event('visibilitychange')))

beforeEach(async () => {
  device.captures = []
  device.acked = []
  device.told = []
  device.plus = []
  store.known = true
  localStorage.setItem('nib-device-asked', '1')
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]]))
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }]))
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true }))
  await db.items.clear()
  await items.create('note', doc('Harbour notes', 'Tides at six.'), { id: HARBOUR, updatedAt: 2000 })
  await items.create('page', doc('Ferry times'), { id: FERRY, updatedAt: 1000 })
  await page.viewport(1280, 800)
})
afterEach(cleanup)

describe('the notes the share sheet may add to', () => {
  it('are told to it once the library is read, again when they change, and as Nib leaves the front', async () => {
    await act(async () => void render(<App />))
    await library().findByText('Harbour notes')
    const both = [{ id: HARBOUR, title: 'Harbour notes', kind: 'note' }, { id: FERRY, title: 'Ferry times', kind: 'page' }]
    await waitFor(() => expect(device.told.at(-1)).toEqual(both))
    // And whether Plus is on, which decides whether the sheet takes a file that isn't a picture: not here.
    expect(device.plus).toEqual([false])
    // Never an empty list first, from before the library was read: that would take the sheet's notes away at every launch.
    expect(device.told.every((told) => told.length === 2)).toBe(true)

    await act(async () => void (await items.create('note', doc('Customs forms'), { id: CAPTURE })))
    await waitFor(() => expect(device.told.at(-1)).toEqual([{ id: CAPTURE, title: 'Customs forms', kind: 'note' }, ...both]))
    // One of them put in the trash leaves the list.
    await act(async () => void (await items.remove(FERRY)))
    await waitFor(() => expect(device.told.at(-1)!.map((told) => (told as Target).title)).toEqual(['Customs forms', 'Harbour notes']))

    const count = device.told.length
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    try {
      document.dispatchEvent(new Event('visibilitychange'))
      await waitFor(() => expect(device.told).toHaveLength(count + 1))
    } finally {
      delete (document as { visibilityState?: string }).visibilityState
    }
  })
})

describe('what’s shared with a file', () => {
  it('waits, and the sheet is told nothing of Plus, until the App Store has said whether Plus is on', async () => {
    store.known = false
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string, ...rest: []) => (String(url).startsWith('file:') ? { ok: true, status: 200, blob: async () => new Blob([new Uint8Array(900)], { type: 'application/pdf' }) } : realFetch(url, ...rest)))
    try {
      device.captures = [{ id: CAPTURE, text: 'With a file', createdAt: Date.now(), files: [{ name: 'Tide tables.pdf', type: 'application/pdf', size: 900, uri: 'file:///group/Inbox/x.files/0' }] }]
      await act(async () => void render(<App />))
      await library().findByText('Harbour notes')
      await waitFor(() => expect(device.told.length).toBeGreaterThan(0))
      expect(await items.get(CAPTURE)).toBeUndefined()
      expect(device.acked).toEqual([])
      expect(device.plus).toEqual([])

      await act(async () => store.answer())
      await waitFor(() => expect(device.acked).toEqual([CAPTURE]))
      expect(plainText((await items.get(CAPTURE))!.body)).toBe('With a file\nTide tables.pdf: Attaching files is part of Nib Plus.')
      expect(device.plus).toEqual([false])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('what’s shared into a note', () => {
  it('goes in at the end of the one open, through its editor, the cursor left where it was', async () => {
    await act(async () => void render(<App />))
    await userEvent.click(await library().findByText('Harbour notes'))
    await expect.poll(editorText).toEqual(['Harbour notes', 'Tides at six.'])
    // The writer is in the first line.
    await userEvent.click(document.querySelector('main [data-scroll] .ProseMirror > p')!)
    await userEvent.keyboard('{Home}')

    device.captures = [{ id: CAPTURE, text: 'From the harbour master', url: 'https://example.com/tides', createdAt: Date.now(), into: HARBOUR }]
    await comeToFront()
    await expect.poll(editorText).toEqual(['Harbour notes', 'Tides at six.', 'From the harbour master', 'https://example.com/tides'])
    expect(device.acked).toEqual([CAPTURE])
    // Typing goes on where it was, not after what arrived.
    await userEvent.keyboard('The ')
    await expect.poll(() => editorText()[0]).toBe('The Harbour notes')
    // Saved as the writer's own edit is, with nothing lost and no note made for it.
    await waitFor(async () => expect(plainText((await items.get(HARBOUR))!.body)).toBe('The Harbour notes\nTides at six.\nFrom the harbour master\nhttps://example.com/tides'))
    expect(await items.get(CAPTURE)).toBeUndefined()
  })

  it('is written to one that isn’t open, which shows it when opened', async () => {
    await act(async () => void render(<App />))
    await userEvent.click(await library().findByText('Harbour notes'))
    await expect.poll(editorText).toEqual(['Harbour notes', 'Tides at six.'])
    device.captures = [{ id: CAPTURE, text: 'Last boat 22:40', createdAt: Date.now(), into: FERRY }]
    await comeToFront()
    await waitFor(async () => expect(plainText((await items.get(FERRY))!.body)).toBe('Ferry times\nLast boat 22:40'))
    expect(editorText()).toEqual(['Harbour notes', 'Tides at six.'])
    await waitFor(() => expect(device.acked).toEqual([CAPTURE]))
  })
})
