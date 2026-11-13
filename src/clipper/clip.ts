import { readClipperCode, sealPost, type Post } from '../../worker/inbox-seal'
import { MAX_SEALED_POST, SEALED_TYPE } from '../../worker/wire.mjs'
import { SYNC_ORIGIN } from '../lib/hosts'

/**
 * Nib's browser extension, the part of it that isn't the browser's: what a
 * clip is, and how it leaves. A clip is sealed here, in the browser, with the
 * key in the clipper code (worker/inbox-seal), and sent to the address in the
 * code and nowhere else. Nib's server keeps it as it comes and can't read it;
 * the library's devices open it (src/sync/inbox).
 */

/** Set by a build for trying the extension out (scripts/build-extension.mjs): a server on this computer, besides Nib's own. */
declare const __CLIPPER_LOCAL__: string[] | undefined

/** Where a clip may be sent: Nib's own server. The manifest lets the extension reach these and no others. */
export const SERVERS: string[] = [SYNC_ORIGIN, ...(typeof __CLIPPER_LOCAL__ === 'undefined' ? [] : __CLIPPER_LOCAL__)]

/** A clipper code this extension will use: one that reads as one, for a server it may send to. */
export function acceptCode(code: string, servers: string[] = SERVERS): { address: string; key: string } | null {
  const read = readClipperCode(code)
  return read && servers.includes(new URL(read.address).origin) ? read : null
}

/** A page as its script hands it over (ios/App/NibShare/Page.js, the same script Safari's share sheet runs): its parts, each as HTML, or nothing. */
export type Parts = { title: string; url: string; html: string; selection: string; article: string; visible: string }

/** What can be kept of a page, as the popup says it, in the order it's offered: the link alone, or with it a part there is. */
export const CHOICES = [
  ['link', 'Link only'],
  ['selection', 'Selection'],
  ['article', 'Article'],
  ['visible', 'Part on screen'],
  ['whole', 'Whole page'],
] as const
export type Choice = (typeof CHOICES)[number][0]

const partOf = (parts: Parts, choice: Choice) => (choice === 'link' ? '' : choice === 'whole' ? parts.html : parts[choice])

/** The choices a page has something for. The link always. */
export const offered = (parts: Parts): Choice[] => CHOICES.map(([choice]) => choice).filter((choice) => choice === 'link' || partOf(parts, choice) !== '')

/** What's chosen as the popup opens: what was selected, as in Safari's share sheet, or the link alone. */
export const firstChoice = (parts: Parts): Choice => (parts.selection ? 'selection' : 'link')

/** The clip: the page's title, or the one written over it, its address, a note if one was written, and the part chosen. */
export function clipOf(parts: Parts, choice: Choice, title: string, note: string): Post {
  const page = partOf(parts, choice)
  return { title: title.trim() || parts.title, url: parts.url, ...(note.trim() ? { text: note.trim() } : {}), ...(page ? { page, part: choice } : {}) }
}

/** A clip from wherever it was put together (the popup, or the page's own picker): its fields that are text, and nothing else. */
export function asPost(value: unknown): Post {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const post: Post = {}
  for (const field of ['title', 'text', 'url', 'page', 'part'] as const) if (typeof given[field] === 'string') post[field] = given[field]
  return post
}

export const WHY = {
  code: 'That isn’t a clipper code. Copy it again in Nib: Settings, Sync, “Copy the code for Nib’s browser extension”.',
  offline: 'Couldn’t reach Nib’s server. Check your connection and try again.',
  402: 'Nib Plus isn’t active for this library.',
  404: 'Nib has no inbox at this code’s address any more. Copy the code again in Nib, and paste it here.',
  413: 'That’s too long to send. Choose a smaller part of the page.',
  429: 'The inbox has taken all it takes in a day.',
  507: 'The inbox is full. Open Nib so it takes in what’s waiting.',
} as const

export type Sent = { ok: true } | { ok: false; why: string }

/**
 * Seals a clip with the code's key and sends it to the code's address. Never
 * sent unsealed, never anywhere else, and not at all if it's longer than the
 * server takes. With it goes nothing of the browser's: no cookies, and no
 * word of the page it was sent from.
 */
export async function send(code: string, post: Post, fetching: typeof fetch = fetch): Promise<Sent> {
  const to = acceptCode(code)
  if (!to) return { ok: false, why: WHY.code }
  const sealed = await sealPost(to.key, post)
  if (sealed.length > MAX_SEALED_POST) return { ok: false, why: WHY[413] }
  // The secret goes in a header, to the id alone, out of the address wherever addresses are noted on the way (worker/inbox).
  const at = to.address.lastIndexOf('.')
  let answer: Response
  try {
    answer = await fetching(to.address.slice(0, at), {
      method: 'POST',
      headers: { 'Content-Type': SEALED_TYPE, Authorization: `Bearer ${to.address.slice(at + 1)}` },
      body: sealed,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    return { ok: false, why: WHY.offline }
  }
  if (answer.ok) return { ok: true }
  return { ok: false, why: (WHY as Record<string, string>)[answer.status] ?? `Nib’s server answered ${answer.status}.` }
}
