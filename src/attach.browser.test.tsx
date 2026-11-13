import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import * as items from './db/items'
import { keepFile, readFile } from './lib/files'
import { localDay } from './lib/time'

/**
 * Attach a file…, in the app (App, editor/attach): from Commands with Nib
 * Plus, through the system's own picker, into the note open; and not offered
 * without Plus in a browser, where it can't be bought.
 */

const plus = vi.hoisted(() => ({ active: true }))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [{ active: plus.active }, () => {}, true],
}))

const { App } = await import('./App')
const library = () => within(document.querySelector<HTMLElement>('.nib-library')!)
const MOD = /Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? 'Meta' : 'Control'
const commands = async () => {
  await userEvent.keyboard(`{${MOD}>}k{/${MOD}}`)
  return within(await screen.findByRole('dialog', { name: 'Commands' }))
}

beforeEach(async () => {
  plus.active = true
  localStorage.setItem('nib-device-asked', '1')
  localStorage.setItem('nib-book', JSON.stringify([[localDay(Date.now()), 1]]))
  localStorage.setItem('nib-trades', JSON.stringify([{ id: `login:${localDay(Date.now())}`, day: localDay(Date.now()), sold: [], kind: 'login' }]))
  localStorage.setItem('nib-firsts', JSON.stringify({ done: [], away: true }))
  await db.items.clear()
  await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Harbour notes' }] }] }, { id: 'harbour' })
  await page.viewport(1280, 800)
})
afterEach(cleanup)

async function open() {
  await act(async () => void render(<App />))
  await userEvent.click(await library().findByText('Harbour notes'))
  await expect.poll(() => document.querySelector('main [data-scroll] .ProseMirror')?.textContent).toContain('Harbour notes')
}

describe('Attach a file…', () => {
  it('opens the system’s picker from Commands, and puts the file chosen into the note as an attachment, kept beside the library', async () => {
    await open()
    const picker = screen.getByLabelText<HTMLInputElement>('A file to attach')
    const asked = vi.spyOn(picker, 'click').mockImplementation(() => {})
    await userEvent.click((await commands()).getByText('Attach a file…'))
    expect(asked).toHaveBeenCalledOnce()

    const file = new File([new Uint8Array(4000).map((_, at) => at % 251)], 'Tide tables.pdf', { type: 'application/pdf' })
    await userEvent.upload(picker, file)
    const card = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('main .ProseMirror .nib-attachment')
      expect(found).not.toBeNull()
      return found!
    })
    expect([...card.querySelectorAll('.nib-attachment-text > *')].map((line) => line.textContent)).toEqual(['Tide tables.pdf', 'PDF · 4 KB'])
    // Saved in the note as which file it is, and the file itself kept.
    const attached = await waitFor(async () => {
      const block = (await items.get('harbour'))!.body.content!.find((one) => one.type === 'attachment')
      expect(block).toBeDefined()
      return block!.attrs as { file: { id: string; size: number }; name: string }
    })
    expect(attached).toMatchObject({ name: 'Tide tables.pdf', file: { type: 'application/pdf', size: 4000 } })
    expect((await readFile(attached.file.id))!.size).toBe(4000)
    // The same file can be chosen again.
    expect(picker.value).toBe('')
  })

  it('isn’t offered without Plus in a browser', async () => {
    plus.active = false
    await open()
    const list = await commands()
    expect(list.queryByText('Attach a file…')).toBeNull()
    expect(list.queryByText('Attachments…')).toBeNull()
  })
})

describe('Attachments…', () => {
  const FILE = { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'application/pdf', size: 2_400_000 }
  const withFile = (text: string, name: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, { type: 'attachment', attrs: { file: FILE, name } }] })

  it('lists every attached file in the library’s place, from Commands, and a row goes to its document', async () => {
    await items.create('note', withFile('Survey notes', 'survey.pdf'), { id: 'survey' })
    await items.create('page', withFile('Chapter one', 'map.pdf'), { id: 'chapter' })
    const archived = await items.create('note', withFile('Put away', 'old.pdf'))
    await db.items.update(archived, { archivedAt: Date.now() })
    const binned = await items.create('note', withFile('Thrown out', 'binned.pdf'))
    await items.remove(binned)
    await open()
    await userEvent.click((await commands()).getByText('Attachments…'))
    const panel = within(document.querySelector<HTMLElement>('.nib-library')!)
    // Notes, pages and what's put away; what's in the trash is counted, not listed.
    expect(await panel.findByText(/^3 attachments/)).toBeTruthy()
    expect(panel.getAllByRole('listitem').map((row) => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('survey.pdf'), expect.stringContaining('in Chapter one'), expect.stringContaining('in Put away')]))
    expect(panel.queryByText('binned.pdf')).toBeNull()
    expect(panel.getByText(/^One more is in the trash/)).toBeTruthy()

    await userEvent.click(panel.getByText('survey.pdf'))
    await expect.poll(() => document.querySelector('main [data-scroll] .ProseMirror')?.textContent).toContain('Survey notes')
    // Still there on coming back to the library, to go on from; Back gives the library its cards again.
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(await library().findByText(/^3 attachments/)).toBeTruthy()
    await userEvent.click(library().getByRole('button', { name: '← Back' }))
    await expect.poll(() => library().queryByText(/^3 attachments/)).toBeNull()
    expect(library().getByText('Harbour notes')).toBeTruthy()
  })

  it('is reached from Settings too, where the room files take is said, with Plus or without', async () => {
    plus.active = false
    const id = (await keepFile(new Blob([new Uint8Array(5000)], { type: 'application/pdf' })))!
    await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Survey notes' }] }, { type: 'attachment', attrs: { file: { id, type: 'application/pdf', size: 5000 }, name: 'survey.pdf' } }] })
    // From the library, whose own Settings button is the one showing.
    await act(async () => void render(<App />))
    await library().findByText('Survey notes')
    await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Settings' }))
    const settings = within(await screen.findByRole('dialog', { name: 'Settings' }))
    await userEvent.click(settings.getByRole('button', { name: /Advanced/ }))
    await userEvent.click(await settings.findByRole('button', { name: 'See attachments' }))
    expect(await library().findByText(/^1 attachment · 5\sKB$/)).toBeTruthy()
    expect(library().getByText('survey.pdf')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
  })
})
