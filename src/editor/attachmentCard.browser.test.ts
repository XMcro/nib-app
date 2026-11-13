import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { Editor as TiptapEditor } from '@tiptap/core'
import '../index.css'
import type { Opened } from '../lib/preview'
import { nibExtensions } from './extensions'

/**
 * An attachment's card in the editor (editor/attachmentCard): Open, which
 * shows the file and says so when it can't; a recording's player and a PDF's
 * first page, for a file that's on this device. Opening and what's here are
 * stand-ins (lib/preview has its own tests).
 */

const at = vi.hoisted(() => ({
  here: new Set<string>(),
  opened: [] as string[],
  went: 'opened' as Opened,
  go: null as (() => void) | null,
  wait: false,
  pages: [] as { name: string; edge: number }[],
  played: 0,
}))
const PAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
vi.mock('../lib/preview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/preview')>()),
  openAttached: async (file: { id: string }, name: string) => {
    at.opened.push(name)
    if (at.wait) await new Promise<void>((resolve) => (at.go = resolve))
    if (at.went === 'opened') at.here.add(file.id)
    return at.went
  },
  playable: async (file: { id: string }, name: string) => {
    at.played++
    return at.here.has(file.id) ? `data:audio/wav;base64,UklGRg==#${name}` : null
  },
  firstPage: async (file: { id: string }, name: string, edge: number) => {
    at.pages.push({ name, edge })
    return at.here.has(file.id) ? PAGE : null
  },
}))

const ID = '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d'
const attachment = (name: string, type: string) => ({ type: 'attachment', attrs: { file: { id: ID, type, size: 2_400_000 }, name } })
let editor: TiptapEditor | undefined
function open(...blocks: object[]) {
  editor = new TiptapEditor({ element: document.body.appendChild(document.createElement('div')), extensions: nibExtensions(false), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Above' }] }, ...blocks] } })
  editor.view.dom.classList.add('nib-editor')
  return editor
}
const card = () => editor!.view.dom.querySelector<HTMLElement>('.nib-attachment')!
const about = () => card().querySelector('.nib-attachment-about')!.textContent
const button = () => card().querySelector<HTMLButtonElement>('button.nib-attachment-open')!
const player = () => card().querySelector<HTMLAudioElement>('audio.nib-attachment-player')
const page = () => card().querySelector<HTMLImageElement>('img.nib-attachment-page')!
const seen = (element: Element | null) => element !== null && getComputedStyle(element).display !== 'none'

beforeEach(() => {
  at.here = new Set()
  at.opened.length = 0
  at.pages.length = 0
  at.played = 0
  at.went = 'opened'
  at.wait = false
})
afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

describe('an attachment’s card', () => {
  it('opens its file at Open, saying so while it does, and leaves the cursor where it was', async () => {
    open(attachment('report.pdf', 'application/pdf'))
    editor!.commands.focus('start')
    const before = editor!.state.selection.toJSON()
    at.wait = true
    expect(button().textContent).toBe('Open')
    await userEvent.click(button())
    expect(at.opened).toEqual(['report.pdf'])
    expect(about()).toBe('Opening…')
    // Not asked for twice while it's on its way.
    expect(button().disabled).toBe(true)
    at.go!()
    await expect.poll(about).toBe('PDF · 2 MB')
    expect(button().disabled).toBe(false)
    // The press was the card's: the editor neither selected the card nor moved the cursor.
    expect(editor!.state.selection.toJSON()).toEqual(before)
    // Nor is it one that puts the cursor in the text, which on an iPhone brought the keyboard up.
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    button().dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
  })

  it('says which went wrong when it can’t be opened, and can be asked again', async () => {
    open(attachment('report.pdf', 'application/pdf'))
    at.went = 'away'
    await userEvent.click(button())
    await expect.poll(about).toBe('It isn’t on this device, and couldn’t be fetched.')
    at.went = 'failed'
    await userEvent.click(button())
    await expect.poll(about).toBe('Couldn’t open it.')
    at.went = 'opened'
    await userEvent.click(button())
    await expect.poll(about).toBe('PDF · 2 MB')
    expect(at.opened).toHaveLength(3)
  })

  it('has a player for a recording that’s on this device, and none for one that isn’t until it has been opened', async () => {
    open(attachment('memo.wav', 'audio/wav'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(seen(player())).toBe(false)
    expect(player()!.getAttribute('src')).toBeNull()
    expect(seen(button())).toBe(true)
    await userEvent.click(button())
    await expect.poll(() => seen(player())).toBe(true)
    expect(player()!.getAttribute('src')).toBe('data:audio/wav;base64,UklGRg==#memo.wav')
    expect(player()!.controls).toBe(true)
    // Open stays: the system's viewer is where it's shared from. Opened again, what's playing isn't begun again.
    expect(seen(button())).toBe(true)
    expect(at.played).toBe(2)
    await userEvent.click(button())
    await expect.poll(() => at.opened).toHaveLength(2)
    await expect.poll(() => button().disabled).toBe(false)
    expect(at.played).toBe(2)
    // Under the name, across the card.
    expect(player()!.getBoundingClientRect().top).toBeGreaterThanOrEqual(card().querySelector('.nib-attachment-text')!.getBoundingClientRect().bottom)

    // Here from the start: the player without being asked. And no player at all for what isn't a recording.
    editor!.destroy()
    open(attachment('MEMO.WAV', 'Audio/WAV'))
    await expect.poll(() => seen(player())).toBe(true)
    editor!.destroy()
    open(attachment('report.pdf', 'application/pdf'))
    expect(player()).toBeNull()
  })

  it('shows a PDF’s first page, small, once the file is here; and asks for no page of anything else', async () => {
    open(attachment('report.pdf', 'application/pdf'))
    await expect.poll(() => at.pages).toEqual([{ name: 'report.pdf', edge: 96 }])
    expect(seen(page())).toBe(false)
    await userEvent.click(button())
    await expect.poll(() => seen(page())).toBe(true)
    expect(page().src).toBe(PAGE)
    // Decoration: a screen reader isn't read its address.
    expect(page().getAttribute('alt')).toBe('')
    await expect.poll(() => page().getBoundingClientRect().height).toBe(48)
    // Opened again, it isn't drawn again.
    await userEvent.click(button())
    await expect.poll(() => at.opened).toHaveLength(2)
    await expect.poll(() => button().disabled).toBe(false)
    expect(at.pages).toHaveLength(2)
    expect(page().getBoundingClientRect().right).toBeLessThanOrEqual(card().querySelector('.nib-attachment-text')!.getBoundingClientRect().left)

    at.pages.length = 0
    editor!.destroy()
    open(attachment('tides.csv', 'text/csv'), attachment('memo.wav', 'audio/wav'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(at.pages).toEqual([])
  })

  it('is selected by a press anywhere else on it, as any block is', async () => {
    open(attachment('report.pdf', 'application/pdf'))
    await userEvent.click(card().querySelector('.nib-attachment-name')!)
    expect(editor!.state.selection.toJSON()).toMatchObject({ type: 'node' })
    expect(at.opened).toEqual([])
  })

  it('lets a long name give way to the button, and its words wrap', async () => {
    open(attachment(`${'A very long name for a file '.repeat(6)}.pdf`, 'application/pdf'))
    editor!.view.dom.style.width = '320px'
    at.went = 'away'
    await userEvent.click(button())
    await expect.poll(about).toContain('couldn’t be fetched')
    const [box, open_] = [card().getBoundingClientRect(), button().getBoundingClientRect()]
    expect(box.width).toBeLessThanOrEqual(320)
    expect(open_.right).toBeLessThanOrEqual(box.right)
    expect(card().querySelector('.nib-attachment-name')!.scrollWidth).toBeGreaterThan(card().querySelector('.nib-attachment-name')!.clientWidth)
    const words = card().querySelector('.nib-attachment-about')!
    expect(words.scrollWidth).toBeLessThanOrEqual(words.clientWidth)
  })
})
