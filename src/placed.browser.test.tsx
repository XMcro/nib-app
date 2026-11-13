import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { BOOK } from './lib/stampbook'

/**
 * Stamps put on writing (lib/placed) through the whole app, as on the Mac:
 * from a stamp's page in the Stampbook, onto the note open, shown at the top
 * of the writing and on its library card, and taken off again.
 */

vi.mock('./lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/platform')>()), nativeApp: true, macApp: true }))
vi.mock('./lib/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/inbox')>()),
  inbox: { list: async () => ({ captures: [] }), ack: async () => {}, addListener: async () => ({ remove: async () => {} }) },
}))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [{ active: false }, () => {}, true],
  store: { products: async () => ({ products: [] }), purchase: vi.fn(), restore: vi.fn(), manage: vi.fn(), entitlement: vi.fn() },
}))

const { App } = await import('./App')

async function command(label: string) {
  await userEvent.keyboard('{Meta>}k{/Meta}')
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label}`) }))
}
const book = () => within(screen.getByRole('dialog', { name: 'Stampbook' }).querySelector<HTMLElement>('section:not([aria-hidden])')!)
/** Turned to a part of the Stampbook from its contents. */
async function turnTo(part: string) {
  const stampbook = within(screen.getByRole('dialog', { name: 'Stampbook' }))
  const contents = stampbook.queryByRole('button', { name: 'Contents' })
  if (contents) await userEvent.click(contents)
  await userEvent.click(stampbook.getByRole('button', { name: new RegExp(`^${part},`) }))
}
const stampPage = () => within(screen.getAllByRole('dialog').at(-1)!)
const placed = async () => (await items.list('note'))[0]?.stamps

beforeEach(async () => {
  // Only the date is the 4th of November; timers run as ever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T10:00:00') })
  localStorage.clear()
  localStorage.setItem('nib-device-asked', '1')
  localStorage.setItem('nib-daily-asked', 'true')
  // Today's pack among them, opened already.
  localStorage.setItem('nib-stamps', JSON.stringify(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']))
  localStorage.setItem('nib-book', JSON.stringify([['2026-11-01', 7], ['2026-11-02', 150], ['2026-11-03', 8], ['2026-11-04', 9]]))
  localStorage.setItem('nib-trades', JSON.stringify([{ id: 'login:2026-11-04', day: '2026-11-04', sold: [], kind: 'login' }])) // today's coins, collected already
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true })) // first steps, put away: a library already here is given them (firsts.browser.test)
  await db.items.clear()
  await page.viewport(1280, 800)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Stamps put on writing', () => {
  it('go on the note open from the Stampbook, three at most, at the top of the writing and on its card, and come off again', async () => {
    await act(async () => void render(<App />))
    await userEvent.click(screen.getByRole('button', { name: 'New note' }))
    // Kept once something's written in it.
    await userEvent.click(document.querySelector('main .ProseMirror')!)
    await userEvent.keyboard('Stamped')
    await waitFor(async () => expect(await items.list('note')).toHaveLength(1))
    await command('Stampbook')
    for (const [part, name] of [
      ['Rare', `No. 150, ${BOOK[149].name}`],
      ['Common', `No. 7, ${BOOK[6].name}`],
      ['Holidays', 'Halloween'],
    ]) {
      await turnTo(part)
      await userEvent.click(book().getByRole('button', { name }))
      await userEvent.click(stampPage().getByRole('button', { name: 'Put on this note' }))
      expect(await stampPage().findByRole('button', { name: 'Take off this note' })).toBeTruthy()
      await userEvent.keyboard('{Escape}')
    }
    await turnTo('Common')
    await userEvent.click(book().getByRole('button', { name: `No. 8, ${BOOK[7].name}` }))
    expect(stampPage().getByText('There are 3 stamps on this note already. Take one off to put this on.')).toBeTruthy()
    expect(stampPage().queryByRole('button', { name: 'Put on this note' })).toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Escape}')
    expect(await placed()).toEqual([{ day: '2026-11-02', no: 150 }, { day: '2026-11-01', no: 7 }, { day: '2026-10-31' }])

    // At the top of the writing, each to open and take off.
    const writing = within(document.querySelector<HTMLElement>('main')!)
    expect(writing.getAllByRole('button', { name: /^Stamp: / }).map((stamp) => stamp.getAttribute('aria-label'))).toEqual([
      `Stamp: ${BOOK[149].name}`,
      `Stamp: ${BOOK[6].name}`,
      'Stamp: Halloween',
    ])
    await userEvent.click(writing.getByRole('button', { name: 'Stamp: Halloween' }))
    const card = within(screen.getByRole('dialog', { name: 'Halloween' }))
    expect(card.getByText(`Found on ${new Date(2026, 9, 31).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.`)).toBeTruthy()
    await userEvent.click(card.getByRole('button', { name: 'Take off this note' }))
    expect(screen.queryByRole('dialog', { name: 'Halloween' })).toBeNull()
    await waitFor(async () => expect(await placed()).toHaveLength(2))
    await waitFor(() => expect(writing.queryByRole('button', { name: 'Stamp: Halloween' })).toBeNull())

    // And small on its card in the library.
    await userEvent.click(within(document.querySelector<HTMLElement>('.nib-chrome')!).getByRole('button', { name: 'Notes' }))
    await waitFor(() => expect(document.querySelectorAll('.nib-library [data-stamps] svg')).toHaveLength(2))
  })

  it('have nothing to go on with the library showing, even with a note open behind it', async () => {
    await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Waiting' }] }] })
    await act(async () => void render(<App />))
    await userEvent.click(await within(document.querySelector<HTMLElement>('.nib-library')!).findByText('Waiting'))
    await userEvent.click(within(document.querySelector<HTMLElement>('.nib-chrome')!).getByRole('button', { name: 'Notes' }))
    // From the library's own album.
    await userEvent.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('button', { name: 'Stampbook' }))
    await turnTo('Rare')
    await userEvent.click(book().getByRole('button', { name: `No. 150, ${BOOK[149].name}` }))
    expect(stampPage().getByText(BOOK[149].story)).toBeTruthy()
    expect(stampPage().queryByRole('button', { name: /^Put on/ })).toBeNull()
  })
})
