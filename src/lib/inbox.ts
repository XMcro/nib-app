import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { JSONContent } from '@tiptap/react'
import type { Item, Kind } from '../db/db'
import * as items from '../db/items'
import { ATTACH_PROBLEMS, keepAttached } from '../editor/attach'
import { DOC_BUDGET, allowedImageSrc, toDataUrl } from './image'
import { withWebPage } from './importApps'
import { keepOriginal, keepsFiles } from './originals'
import { countWords } from './stats'
import { plainText, titleOf } from './text'
import { isLocked } from './vault'
import { notWrittenHere } from './writtenHere'

/**
 * Quick capture. The share extension and Shortcuts write captures to an inbox
 * in the App Group (ios/App/App/NibInbox.swift); the app empties it into
 * notes on launch and whenever it comes back to the front.
 *
 * Two steps, so a crash between them never loses a capture: save every one,
 * and only then tell the inbox to delete them. Each note takes its capture's
 * id, so a capture saved before a crash and listed again is not saved twice.
 *
 * A capture arrives already written, so it is not today's writing: the daily
 * goal first sees it with its words in it and counts none of them (lib/writtenHere).
 *
 * The share sheet can also add to a note or a page there already. It never
 * reads the library, so the app leaves it the few it may offer (`shareTargets`),
 * and a capture says which it was for (`into`).
 *
 * Pictures and other files shared with a capture wait beside it (`files`),
 * each read from where the inbox says it is. A picture goes into the note as
 * one pasted there does; any other file as an attachment, with Nib Plus.
 *
 * From Safari a capture can carry some of the page itself (`page`, as HTML,
 * and `part`, which of it): read into the document after the words and the
 * link (lib/importApps `withWebPage`). What was selected is kept for anyone,
 * as a note's lines. The article, the part on screen or the whole page are
 * kept with Nib Plus, and a document of its own is then a page, which keeps a
 * web page's headings and tables.
 */

export type Capture = { id: string; text: string; url?: string; createdAt: number; into?: string; files?: SharedFile[]; page?: string; part?: string }

/** The parts of a page the sheet can keep (NibInbox.swift `parts`): what's selected, the article, the part on screen, all of it. */
const PARTS = ['selection', 'article', 'visible', 'whole']

/** A picture or another file shared with a capture, and where the page can read it from. */
export type SharedFile = { name: string; type: string; size: number; uri: string }

/** A note or a page the share sheet offers to add to. */
export type Target = { id: string; title: string; kind: Kind }

interface NibInbox {
  list(): Promise<{ captures: Capture[] }>
  ack(options: { ids: string[] }): Promise<void>
  /** What the share sheet may offer to add to, in place of what it had. Kept as none while Lock Nib is on (NibInboxPlugin.swift). */
  targets(options: { targets: Target[] }): Promise<void>
  /** Whether Nib Plus is on: the share sheet takes a file that isn't a picture only with it. */
  plus(options: { active: boolean }): Promise<void>
  /** nib://new-note and nib://new-page, from a widget or Shortcuts. */
  addListener(event: 'openUrl', listener: (event: { url: string }) => void): Promise<PluginListenerHandle>
}

export const inbox = registerPlugin<NibInbox>('NibInbox')

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const WEB = /^https?:\/\//i

/** A paragraph per line of the text, then the link, if there was one. */
export function captureBody(capture: Capture): JSONContent {
  const lines = capture.text.split(/\r?\n/)
  const content: JSONContent[] = capture.text
    ? lines.map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }))
    : []
  if (capture.url && WEB.test(capture.url)) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: capture.url, marks: [{ type: 'link', attrs: { href: capture.url } }] }],
    })
  }
  return { type: 'doc', content }
}

const said = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })

/** What a body's pictures take of a document's room for them, as lib/image `imageBytes` counts it in the editor. */
const pictureBytes = (body: JSONContent): number =>
  (body.type === 'image' ? String(body.attrs?.src ?? '').length + (typeof body.attrs?.drawing === 'string' ? body.attrs.drawing.length : 0) : 0) +
  (body.content ?? []).reduce((sum, child) => sum + pictureBytes(child), 0)

/**
 * The pictures and files shared with a capture, as the blocks they are in a
 * note: a picture as one pasted is (made small enough, its original kept with
 * Plus), any other file an attachment. One that can't be had says why in its
 * place, so nothing shared goes without a word. `room`: what the document
 * they're for has left for pictures.
 */
async function sharedBlocks(files: unknown, room: number): Promise<JSONContent[]> {
  const blocks: JSONContent[] = []
  for (const shared of Array.isArray(files) ? (files as Partial<SharedFile>[]) : []) {
    // Only from where the inbox keeps them: a file on this device, named by the app.
    if (typeof shared?.name !== 'string' || typeof shared.type !== 'string' || typeof shared.uri !== 'string' || !shared.uri.startsWith('file:///')) continue
    const answer = await fetch(Capacitor.convertFileSrc(shared.uri))
    if (!answer.ok) throw new Error(`Nib: a shared file could not be read (${answer.status})`)
    const file = new File([await answer.blob()], shared.name, { type: shared.type })
    const src = await toDataUrl(file)
    if (src && allowedImageSrc(src)) {
      if (src.length > room) {
        blocks.push(said(`${shared.name} didn’t fit: this document’s pictures are at their limit.`))
        continue
      }
      room -= src.length
      blocks.push({ type: 'paragraph', content: [{ type: 'image', attrs: { src, alt: '', full: await keepOriginal(file, false) } }] })
      continue
    }
    const attached = await keepAttached(file, false)
    blocks.push(typeof attached === 'string' ? said(`${shared.name}: ${ATTACH_PROBLEMS[attached]}`) : { type: 'attachment', attrs: attached })
  }
  return blocks
}

const TARGETS = 10
const TITLE = 80

/** Whether what's shared can be added to it: not one that's locked, read-only, put away or in the trash. */
const takes = (item: Item) => !isLocked(item) && !item.readOnly && typeof item.archivedAt !== 'number' && item.template !== true && item.deletedAt === undefined

/**
 * What the share sheet offers to add to: the ten notes and pages edited most
 * recently that can be added to, by title. Never a locked one, whose title is
 * its own to keep; nor one with no words to be known by.
 */
export function shareTargets(documents: Item[]): Target[] {
  return documents
    .filter((item) => takes(item) && titleOf(item.body) !== 'Untitled')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, TARGETS)
    .map((item) => ({ id: item.id, title: titleOf(item.body).slice(0, TITLE), kind: item.kind }))
}

/**
 * Saves everything waiting: each capture a note of its own, or added to the
 * end of the one it was for. Returns how many.
 *
 * `addToOpen`: puts blocks at the end of the document open in the editor, if
 * that is the one, and says whether it did. Written under the editor instead,
 * the editor's next save would meet a version it didn't know.
 *
 * One added to an existing document has no id of its own there to be known by
 * a second time, so the inbox is told as soon as it's in: a crash between the
 * two adds it again, where a note of its own is never made twice. One whose
 * document has gone, or can't be added to any more, is a note of its own.
 *
 * `plusKnown`: whether Nib has heard yet if Plus is on. One with files, or a
 * whole page, waits until it has: taken in a moment too soon, at launch, a
 * file that isn't a picture, or the page, would be turned away as if there
 * were no Plus, and gone.
 */
export function drainInbox(addToOpen: (id: string, content: JSONContent[]) => boolean = () => false, plusKnown = true): Promise<number> {
  // One at a time: two at once (launch, then Plus known a moment later) would each add the same capture to its note.
  const next = draining.catch(() => {}).then(() => drain(addToOpen, plusKnown))
  draining = next
  return next
}
let draining: Promise<unknown> = Promise.resolve()

async function drain(addToOpen: (id: string, content: JSONContent[]) => boolean, plusKnown: boolean): Promise<number> {
  const { captures } = await inbox.list()
  const saved: string[] = []
  let added = 0
  for (const capture of captures) {
    if (!ID.test(capture.id) || typeof capture.text !== 'string' || typeof capture.createdAt !== 'number') continue
    if (!plusKnown && (capture.files !== undefined || capture.page !== undefined)) continue
    const found = typeof capture.into === 'string' ? await items.get(capture.into) : undefined
    const target = found && takes(found) ? found : undefined
    // A note of its own was made the first time, files and all: they aren't read, or kept, again.
    if (!target && (await items.get(capture.id))) {
      saved.push(capture.id)
      continue
    }
    const body = captureBody(capture)
    // Some of the page: which, if the sheet said, and all of it if it didn't. More than a selection is with Plus (the sheet offers it only then; Plus may have ended since), and a page of Nib's where it's a document of its own.
    const part = typeof capture.page === 'string' && capture.page !== '' ? (PARTS.find((known) => known === capture.part) ?? 'whole') : null
    const kept = part === 'selection' || keepsFiles()
    const kind: Kind = target?.kind ?? (part && part !== 'selection' && kept ? 'page' : 'note')
    if (part) body.content = kept ? withWebPage(body.content!, capture.page!, kind) : [...body.content!, said('The page’s text wasn’t kept: saving more than what’s selected is part of Nib Plus.')]
    body.content!.push(...(await sharedBlocks(capture.files, DOC_BUDGET - (target ? pictureBytes(target.body) : 0))))
    if (target) {
      if (!addToOpen(target.id, body.content!)) {
        await items.update(target.id, { ...target.body, content: [...(target.body.content ?? []), ...body.content!] }, { expectedVersion: target.version })
      }
      // Written somewhere else, as a capture is: not today's words (lib/writtenHere).
      notWrittenHere(target.id, countWords(plainText(body)))
      await inbox.ack({ ids: [capture.id] })
      added += 1
      continue
    }
    await items.create(kind, body, { id: capture.id, createdAt: capture.createdAt })
    saved.push(capture.id)
  }
  if (saved.length) await inbox.ack({ ids: saved })
  return saved.length + added
}

/** What a nib:// link asks for, or null for one Nib does not know. */
export function linkAction(url: string): 'new-note' | 'new-page' | null {
  if (url === 'nib://new-note') return 'new-note'
  if (url === 'nib://new-page') return 'new-page'
  return null
}
