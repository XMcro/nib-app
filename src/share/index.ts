import type { JSONContent } from '@tiptap/react'
import { FREE_DAYS } from '../../worker/wire.mjs'
import type { Item, ShareRef } from '../db/db'
import { withoutNotes } from '../editor/NoteToSelf'
import { filterBodyImages, withoutAboutIn } from '../lib/image'
import { linkTitle, withoutLines } from '../lib/links'
import { withoutWritersLines } from '../lib/fountain'
import { SERVER, SHARE_HOST } from '../lib/server'
import { newShare, open, PASSWORD_MARK, revealCheck, revealToken, seal, withPassword } from './crypto'

/**
 * Share a draft, from the app: the frozen copy that gets sealed, and the calls
 * to the server. See worker/shares.ts for the other side.
 */

/** A reader's note, opened. `quote` is the passage it's about, if any. */
export type ReaderNote = { id: number; at: number; text: string; quote?: string; name?: string }

export class ShareError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The document's share that is still live, if any: v1 keeps one at a time. */
export const liveShare = (item: Pick<Item, 'shares'> | undefined, now = Date.now()) =>
  item?.shares?.filter((share) => share.expiresAt > now).at(-1)

/** The document holding the library's one live free link, if any. */
export const freeShareHolder = (documents: Item[], now = Date.now()) => documents.find((item) => liveShare(item, now)?.free)

export const shareUrl = (share: ShareRef) =>
  `${SHARE_HOST || location.origin}/d/${share.slug}#${share.key}${share.password ? PASSWORD_MARK : ''}`

// PBKDF2 takes a moment on purpose; a share's key is worked out once per launch.
const passwordKeys = new Map<string, Promise<string>>()

/** The key that seals a share's draft and notes: the link's own, or that and its password. */
function sealKey(share: Pick<ShareRef, 'slug' | 'key' | 'password'>): Promise<string> {
  if (!share.password) return Promise.resolve(share.key)
  const cached = `${share.slug}\n${share.password}`
  if (!passwordKeys.has(cached)) passwordKeys.set(cached, withPassword(share.key, share.slug, share.password))
  return passwordKeys.get(cached)!
}

/**
 * What a reader gets: the document as it is now, with pictures that pass the
 * image rule. A sketch keeps its picture but not its drawing, which only the
 * app can edit and which would double the size; it's marked, so the reader
 * page can invert it in dark mode as the app does. A link to another note
 * becomes its title: the note isn't shared, and its id is nobody else's
 * business. Notes to self are the writer's, and stay behind, as does what a
 * picture says about itself.
 */
export function snapshot(item: Pick<Item, 'kind' | 'body'> & Partial<Pick<Item, 'screenplay'>>) {
  const strip = (node: JSONContent): JSONContent => {
    if (node.type === 'noteLink') return { type: 'text', text: linkTitle(node) }
    if (node.type === 'image' && node.attrs?.drawing) {
      const { drawing: _drawing, ...attrs } = node.attrs
      return { ...node, attrs: { ...attrs, sketch: true } }
    }
    return node.content ? { ...node, content: node.content.map(strip) } : node
  }
  // A screenplay says so, for the reader to set it out as one (src/reader/script); a reader from before shows its lines as they are.
  const screenplay = item.kind === 'page' && item.screenplay === true
  const body = strip(withoutLines(withoutNotes(withoutAboutIn(filterBodyImages(item.body)))))
  // A screenplay's own notes, sections, synopses and cut text are the writer's too (lib/fountain).
  return { v: 1, kind: item.kind, ...(screenplay && { screenplay: true }), body: screenplay ? withoutWritersLines(body) : body }
}

async function call<T>(path: string, init: RequestInit & { owner?: string } = {}): Promise<T> {
  const { owner, ...rest } = init
  const response = await fetch(`${SERVER}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(owner ? { Authorization: `Owner ${owner}` } : {}), ...rest.headers },
  })
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new ShareError(response.status, body.error ?? 'Couldn’t reach Nib.')
  return body
}

/**
 * Seals the document as it is now and puts it on the server. With Plus, `jws`
 * is the App Store's receipt, and with a password readers need it as well as
 * the link, and `once` makes it one to be read once (worker/share). Without a
 * receipt the share is free: FREE_DAYS, read-only, no password, not once.
 */
export async function createShare(
  item: Pick<Item, 'kind' | 'body'> & Partial<Pick<Item, 'screenplay'>>,
  days: number,
  jws: string | undefined,
  { password = '', once = false, now = Date.now() }: { password?: string; once?: boolean; now?: number } = {},
): Promise<ShareRef> {
  const { slug, key, owner } = newShare()
  const share: ShareRef = jws
    ? { slug, key, owner, createdAt: now, expiresAt: 0, ...(password ? { password } : {}), ...(once ? { once: true } : {}) }
    : { slug, key, owner, createdAt: now, expiresAt: 0, free: true }
  const doc = await seal(await sealKey(share), slug, 'doc', snapshot(item))
  // One to be read once is handed over only for a token from the key that opens it (src/share/crypto `revealToken`):
  // the link's, or with a password the one the two make, so that the link alone can't have it handed over, and deleted.
  const reveal = once && jws ? { once: true, reveal: await revealCheck(await revealToken(await sealKey(share), slug)) } : {}
  const body = jws ? { slug, jws, days, doc, ...reveal } : { slug, days: FREE_DAYS, doc }
  const { expiresAt } = await call<{ expiresAt: number }>('/v1/shares', { method: 'POST', owner, body: JSON.stringify(body) })
  return { ...share, expiresAt }
}

/** Tells the server about a renewal, for every share at once. */
export const reportRenewal = (jws: string) => call('/v1/shares/entitlement', { method: 'POST', body: JSON.stringify({ jws }) })

/**
 * Readers' notes, opened. One that won't open is junk from someone without
 * the key, and one that opens but isn't a note is junk too: left out, and
 * deleted from the server, where it would take one of the draft's places for
 * good. If none opens at all, it may be the key here that's wrong, and
 * deleting would lose every real note: so the draft itself has to open first.
 * Without that, junk on a draft with no real notes was never shown or deleted,
 * and every reader was told it had all the notes it could take.
 */
export async function readNotes(share: ShareRef): Promise<{ notes: ReaderNote[]; notesOn: boolean; expiresAt: number }> {
  const { notes, notesOn, expiresAt } = await call<{ notes: { id: number; at: number; note: string }[]; notesOn: boolean; expiresAt: number }>(
    `/v1/shares/${share.slug}/notes`,
    { owner: share.owner },
  )
  const key = await sealKey(share)
  const junk: number[] = []
  let opens = false
  const opened = await Promise.all(
    notes.map(async ({ id, at, note }): Promise<ReaderNote | null> => {
      let value: Record<string, unknown>
      try {
        value = (await open(key, share.slug, 'note', note)) as Record<string, unknown>
      } catch {
        junk.push(id)
        return null
      }
      opens = true
      if (typeof value?.text !== 'string') {
        junk.push(id)
        return null
      }
      const reader: ReaderNote = { id, at, text: value.text }
      if (typeof value.quote === 'string' && value.quote) reader.quote = value.quote
      if (typeof value.name === 'string' && value.name) reader.name = value.name
      return reader
    }),
  )
  // Tried again next time if this fails; the notes themselves are unaffected.
  if (junk.length && (opens || (await opensDraft(share, key)))) await Promise.all(junk.map((id) => deleteNote(share, id).catch(() => {})))
  return { notes: opened.filter((note) => note !== null), notesOn, expiresAt }
}

/** Whether `key` opens the shared draft, as a reader's would. Not being able to ask counts as no, and one to be read once is never handed over for the asking. */
async function opensDraft(share: ShareRef, key: string): Promise<boolean> {
  try {
    // As its owner, so the server doesn't count this as a reader opening it.
    await open(key, share.slug, 'doc', (await call<{ doc: string }>(`/v1/shares/${share.slug}`, { owner: share.owner })).doc)
    return true
  } catch {
    return false
  }
}

/**
 * What the server tells a share's owner of its readers, and nothing of who or
 * when: whether one to be read once has been (`read`), and of one that's
 * counted, how many times its link has been opened (`opens`).
 */
export async function shareStatus(share: Pick<ShareRef, 'slug' | 'owner'>): Promise<{ read: boolean; opens?: number }> {
  const { opened, opens } = await call<{ opened?: boolean; opens?: number }>(`/v1/shares/${share.slug}/notes`, { owner: share.owner })
  return { read: opened === true, ...(typeof opens === 'number' ? { opens } : {}) }
}

export const deleteNote = (share: ShareRef, id: number) => call(`/v1/shares/${share.slug}/notes/${id}`, { method: 'DELETE', owner: share.owner })

export const setNotesOn = (share: ShareRef, notes: boolean) =>
  call(`/v1/shares/${share.slug}`, { method: 'PATCH', owner: share.owner, body: JSON.stringify({ notes }) })

/** A new expiry, counted from now. */
export async function extendShare(share: ShareRef, days: number): Promise<number> {
  const { expiresAt } = await call<{ expiresAt: number }>(`/v1/shares/${share.slug}`, { method: 'PATCH', owner: share.owner, body: JSON.stringify({ days }) })
  return expiresAt
}

/** What is asked before a share is stopped. */
export const stopSharingQuestion = (share: ShareRef) =>
  `Stop sharing this draft? The link stops working for everyone${share.free ? '' : ', and readers’ notes are deleted'}.`

/** Gone from the server. Already gone (expired, revoked elsewhere) counts as done. */
export async function revokeShare(share: ShareRef): Promise<void> {
  try {
    await call(`/v1/shares/${share.slug}`, { method: 'DELETE', owner: share.owner })
  } catch (error) {
    if (!(error instanceof ShareError && (error.status === 404 || error.status === 410))) throw error
  }
}

// Deleting a document for good stops sharing it. Best effort: offline, a
// share stays up until it expires, which is what its expiry is for.
export function stopSharing(documents: Item[]) {
  for (const share of documents.flatMap((item) => item.shares ?? [])) {
    revokeShare(share).catch((error: unknown) => console.warn('Nib: could not stop sharing a draft', error))
  }
}
