import type { JSONContent } from '@tiptap/react'
import { base64url, fromBase64url } from '../../worker/base64'
import { clipperCode, newInboxKeys, openPost, type Post } from '../../worker/inbox-seal'
import { bodyHash } from '../../worker/signing'
import type { Kind } from '../db/db'
import * as items from '../db/items'
import { markdownToBody } from '../lib/import'
import { withWebPage } from '../lib/importApps'
import { SERVER } from '../lib/server'
import type { Api } from './api'
import { open, seal, type SyncKeys } from './crypto'

/**
 * The library's inbox, from a device's side (worker/inbox): an address any
 * service can post a note to. A post reaches the server readable, which
 * seals it at once with the public half of a key made here; this device
 * fetches what waits as it syncs, opens each with the private half, makes a
 * note of it, and tells the server, which deletes it.
 *
 * The private half, and the secret in the address, are kept on the server
 * with the inbox, sealed with the sync code's key as every record is: any
 * device with the code can open posts and show the address, and the server
 * can do neither.
 */

/** What the devices keep with the inbox: the key as a JWK's numbers, and the secret in the address. */
type Kept = { d: string; x: string; y: string; secret: string }
/** The name it's sealed under: one sealed as a record can't be passed off as it. */
const KEPT = 'inbox'
const NUMBER = /^[A-Za-z0-9_-]{43}$/
const WEB = /^https?:\/\//i

const encoder = new TextEncoder()

/** What's kept with the inbox, opened: null if this device can't, or it isn't that. */
async function opened(keys: SyncKeys, sealed: string): Promise<Kept | null> {
  const kept = (await open(keys, KEPT, sealed).catch(() => null)) as Partial<Kept> | null
  const whole = kept && [kept.d, kept.x, kept.y, kept.secret].every((part) => typeof part === 'string' && NUMBER.test(part))
  return whole ? (kept as Kept) : null
}

/** The key's public half, as the server has it and as posts are sealed to it: the point whole. */
const publicKey = ({ x, y }: Kept) => base64url(Uint8Array.of(4, ...fromBase64url(x), ...fromBase64url(y)))

const addressOf = (keys: SyncKeys, { secret }: Kept) => `${SERVER || location.origin}/v1/in/${keys.libraryId}.${secret}`

/** Where the inbox is: its address, for a service to post to; and the clipper code, the address with the key posts are sealed with, for Nib's browser extension, which seals its own. */
export type InboxAt = { address: string; clipper: string }
const at = (keys: SyncKeys, mine: Kept): InboxAt => ({ address: addressOf(keys, mine), clipper: clipperCode(addressOf(keys, mine), publicKey(mine)) })

/** Where the inbox is, or null if the library has none this device can use. */
export async function inboxAddress(keys: SyncKeys, api: Api): Promise<InboxAt | null> {
  const { on, kept } = await api.inbox()
  const mine = on && kept ? await opened(keys, kept) : null
  return mine && at(keys, mine)
}

/**
 * An inbox for the library, or a new address for the one it has: the address
 * in use stops at once. The key stays as it is, so what's waiting can still
 * be opened; a library with no inbox gets a new one.
 */
export async function newInboxAddress(keys: SyncKeys, api: Api): Promise<InboxAt> {
  const { on, kept } = await api.inbox()
  let mine = on && kept ? await opened(keys, kept) : null
  if (!mine) {
    const { d, x, y } = await crypto.subtle.exportKey('jwk', (await newInboxKeys()).privateKey)
    mine = { d: d!, x: x!, y: y!, secret: '' }
  }
  mine = { ...mine, secret: base64url(crypto.getRandomValues(new Uint8Array(32))) }
  await api.setInbox(publicKey(mine), await bodyHash(encoder.encode(mine.secret)), await seal(keys, KEPT, mine))
  return at(keys, mine)
}

const paragraph = (text: string, href?: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}) }],
})

/** None of a post is trusted: what isn't text is nothing. */
const said = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** What a post becomes: a clip of more of a web page than a selection is a page, which keeps a web page's headings and tables; anything else a note. */
export const postKind = (post: Post): Kind => (said(post.page) && post.part !== 'selection' ? 'page' : 'note')

/**
 * A post as a document: its title on the first line, its text read as
 * Markdown, then its link. A clip from the browser extension has part of a
 * web page with it: set out as a page shared from Safari is (lib/inbox), its
 * link under its title, then the clipper's own words, then the page's.
 */
export function postBody(post: Post): JSONContent {
  const [title, text, url, page] = [said(post.title).replace(/\s+/g, ' '), said(post.text), said(post.url), said(post.page)]
  const kind = postKind(post)
  const words = text ? (markdownToBody(text, kind).content ?? []) : []
  const link = WEB.test(url) ? [paragraph(url, url)] : []
  const lead = title ? [paragraph(title)] : []
  if (page) return { type: 'doc', content: withWebPage([...lead, ...link, ...words], page, kind) }
  return { type: 'doc', content: [...lead, ...words, ...link] }
}

/** The note a post becomes, by a name any device would give it: taken in twice, or on two devices at once, it's one note. */
async function noteId(keys: SyncKeys, post: { id: number; at: number }): Promise<string> {
  const hex = await bodyHash(encoder.encode(`nib-inbox:${keys.libraryId}:${post.id}:${post.at}`))
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Every post waiting, made into a note of its own (a page, for a clip of
 * more than a selection), in `folder` if there is one; then the server is told, and deletes them. Returns how many notes were
 * made. A post this device can't open, no device can: it's let go of too.
 */
export async function takePosts(keys: SyncKeys, api: Api, folder?: string): Promise<number> {
  let made = 0
  for (;;) {
    const { on, kept, posts, more } = await api.inbox()
    const mine = on && kept ? await opened(keys, kept) : null
    if (!mine) return made
    const privateKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: mine.d, x: mine.x, y: mine.y }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    for (const post of posts) {
      const read = await openPost(privateKey, publicKey(mine), post.p).catch(() => null)
      const body = read && postBody(read)
      if (!read || !body?.content?.length) {
        console.warn('Nib: a post in the inbox could not be read')
        continue
      }
      const id = await noteId(keys, post)
      if (await items.get(id)) continue
      await items.create(postKind(read), body, { id, createdAt: post.at, folder })
      made += 1
    }
    await api.tookPosts(posts.map((post) => post.id))
    if (!more) return made
  }
}
