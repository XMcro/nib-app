import { registerPlugin } from '@capacitor/core'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import { endnotes, markupOf } from './documentExport'
import type { Posted } from './posted'
import { plainText } from './text'
import { nameOf } from './fountain'

/**
 * Posting a document to the writer's own blog, as a draft to publish there:
 * Nib Plus. The blog's address and key are kept in the Keychain on this
 * device alone, and its requests are made by the app itself
 * (ios/App/App/NibBlogPlugin.swift), so the key never reaches the page and
 * nothing goes through Nib's server. A self-hosted WordPress, with an
 * application password; a Ghost site, with a custom integration's Admin
 * API key; or a blog on Micro.blog, with an app token.
 */

export type Service = 'wordpress' | 'ghost' | 'microblog'

type Answer = { status: number; body: string; location?: string }

export const blogPlugin = registerPlugin<{
  /** Keeps the blog, replacing any kept before. Answers its address as kept. */
  connect(options: { service: Service; site: string; user?: string; key: string }): Promise<{ site: string }>
  /** The blog kept on this device, without its key: nothing if there's none. */
  blog(): Promise<{ service?: Service; site?: string; user?: string }>
  forget(): Promise<void>
  /** `path` within the service's API on the blog. `form` is form-encoded; a `file` is a picture, base64. */
  request(options: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE'
    path: string
    json?: string
    form?: string
    file?: { data: string; type: string; name: string }
  }): Promise<Answer>
}>('NibBlog')

/** Something the blog said no to, or couldn't be reached for, in words for the writer. */
export class BlogError extends Error {}

/** Where a document went on the blog (lib/posted), but for the blog's address. */
export type Sent = Omit<Posted, 'site'>

/** Why the Plus sheet opened, when a document was to be sent to a blog without it. */
export const BLOG_PLUS = 'Sending a note or page to your own blog, as a draft, is part of Nib Plus.'

const parsed = <T>(answer: Answer): T | null => {
  try {
    return JSON.parse(answer.body) as T
  } catch {
    return null
  }
}

/**
 * A document as a post: its title, the first line, and the rest as HTML, its
 * footnotes listed after it. The title's own line is left out of the text,
 * as the blog shows the title above it. Notes to self stay behind (markupOf).
 */
export function postOf(item: Item): { title: string; html: string } {
  const title = nameOf(item)
  const [first, ...rest] = item.body.content ?? []
  const titled = first !== undefined && plainText({ type: 'doc', content: [first] }).trim() === title
  const body: JSONContent = titled ? { ...item.body, content: rest } : item.body
  // Parsed, not assigned to a live element: nothing in it loads or runs.
  const page = new DOMParser().parseFromString(`<body>${markupOf({ ...item, body })}</body>`, 'text/html')
  endnotes(page.body)
  return { title, html: page.body.innerHTML }
}

const PICTURE = /^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/

/** What's in a picture, as a name for it: the first half of its SHA-256, in hex. */
async function fingerprint(src: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src)))
  return [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Each picture in `html` uploaded once by `upload`, or found in `known` from
 * an earlier send, and its address on the blog put in its place. A picture
 * that isn't one of the document's own is left out. Answers the HTML, and
 * the pictures it has, to know next time.
 */
export async function withPictures(
  html: string,
  upload: (file: { data: string; type: string; name: string }) => Promise<string>,
  known: Record<string, string> = {},
): Promise<{ html: string; pictures: Record<string, string> }> {
  const page = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const pictures: Record<string, string> = {}
  for (const img of page.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? ''
    const [, type, extension, data] = PICTURE.exec(src) ?? []
    if (!type) {
      img.remove()
      continue
    }
    const name = await fingerprint(src)
    pictures[name] ??= typeof known[name] === 'string' ? known[name] : await upload({ data, type, name: `${name}.${extension === 'jpeg' ? 'jpg' : extension}` })
    img.setAttribute('src', pictures[name])
  }
  return { html: page.body.innerHTML, pictures }
}

const WP = '/wp-json/wp/v2/'
const GHOST = '/ghost/api/admin/'
const MICROPUB = '/micropub'
/** Micro.blog itself: its blogs are all posted to here. */
const MICROBLOG = 'https://micro.blog'

/** What a refusal says: the blog's own words for it where it gave any. */
function refused(answer: Answer, otherwise: string): BlogError {
  const body = parsed<{ message?: unknown; errors?: { message?: unknown }[]; error_description?: unknown }>(answer)
  const said = body?.message ?? body?.errors?.[0]?.message ?? body?.error_description
  return new BlogError(typeof said === 'string' && said ? `${otherwise} It said: ${said.replace(/<[^>]*>/g, '')}` : otherwise)
}

/** Keeps the blog on this device, with https:// if no scheme is given. Answers its address as kept. */
async function keep(blog: { service: Service; site: string; user?: string; key: string }): Promise<string> {
  const site = blog.site.trim()
  const kept = await blogPlugin.connect({ ...blog, site: /^[a-z]+:\/\//i.test(site) ? site : `https://${site}` }).catch((error: unknown) => {
    const code = (error as { code?: unknown }).code
    throw new BlogError(
      code === 'address'
        ? 'That isn’t a blog’s address Nib can use. It needs to start with https://.'
        : code === 'key'
          ? 'That isn’t an Admin API key. Copy it whole from your integration in Ghost.'
          : 'Couldn’t keep your blog’s key on this device.',
    )
  })
  return kept.site
}

/** Asks the blog just kept something only its key can, to be sure: if it won't answer, the key isn't kept. */
async function check(path: string, notTaken: string, nobody: string): Promise<Answer> {
  const answer = await blogPlugin.request({ method: 'GET', path }).catch(() => ({ status: 0, body: '' }))
  if (answer.status === 200 && parsed(answer)) return answer
  await blogPlugin.forget()
  if (answer.status === 0) throw new BlogError('Couldn’t reach a blog at that address.')
  if (answer.status === 401 || answer.status === 403) throw refused(answer, notTaken)
  throw refused(answer, nobody)
}

/** A self-hosted WordPress, by a username and an application password. Answers the name it gave the key's owner. */
export async function connectWordPress(site: string, user: string, password: string): Promise<{ name: string; site: string }> {
  const kept = await keep({ service: 'wordpress', site, user: user.trim(), key: password.trim() })
  const me = parsed<{ name?: unknown }>(
    await check(`${WP}users/me?context=edit`, 'That blog didn’t take that username and application password.', 'No WordPress answered at that address.'),
  )
  return { name: typeof me?.name === 'string' ? me.name : user.trim(), site: kept }
}

/** A Ghost site, by its API URL and the Admin API key of a custom integration made there. */
export async function connectGhost(site: string, key: string): Promise<{ site: string }> {
  // Its admin's address, pasted in place of the API URL, is the same site.
  const kept = await keep({ service: 'ghost', site: site.trim().replace(/\/ghost(\/.*)?$/, ''), key: key.trim() })
  await check(`${GHOST}posts/?limit=1&fields=id`, 'That Ghost site didn’t take that Admin API key.', 'No Ghost answered at that address.')
  return { site: kept }
}

/** A blog on Micro.blog, by an app token. Its other blogs, for one who has more, aren't chosen: posts go to the first. */
export async function connectMicroblog(token: string): Promise<{ site: string }> {
  const kept = await keep({ service: 'microblog', site: MICROBLOG, key: token.trim() })
  await check(`${MICROPUB}?q=config`, 'Micro.blog didn’t take that app token.', 'Micro.blog didn’t answer as Nib expected.')
  return { site: kept }
}

type Saved = Omit<Sent, 'pictures'> & { updated: boolean }
type Earlier = Partial<Sent>

/** A WordPress post changed to match, whatever it is now; or, if there's none, or it's in the trash, a new draft. */
async function toWordPress(site: string, title: string, content: string, sent?: Earlier): Promise<Saved> {
  const id = sent?.id
  const save = (path: string, fields: object) => blogPlugin.request({ method: 'POST', path, json: JSON.stringify({ title, content, ...fields }) })
  let answer = id && /^\d+$/.test(id) ? await save(`${WP}posts/${id}`, {}) : null
  const updated = answer?.status === 200 && parsed<{ status?: unknown }>(answer)?.status !== 'trash'
  if (!updated) answer = await save(`${WP}posts`, { status: 'draft' })
  const post = parsed<{ id?: unknown; link?: unknown }>(answer!)
  if ((answer!.status !== 200 && answer!.status !== 201) || typeof post?.id !== 'number') throw refused(answer!, 'Your blog didn’t take the post.')
  return { id: String(post.id), url: typeof post.link === 'string' ? post.link : site, edit: `${site}/wp-admin/post.php?post=${post.id}&action=edit`, updated }
}

/**
 * A Ghost post changed to match, whatever it is now; or, if there's none, a
 * new draft. Ghost changes one only when told which version it is changing,
 * so it's asked first. Ghost makes its own kind of post from the HTML.
 */
async function toGhost(site: string, title: string, html: string, sent?: Earlier): Promise<Saved> {
  const id = sent?.id
  const json = (fields: object) => JSON.stringify({ posts: [{ title, html, ...fields }] })
  const now = id && /^[0-9a-f]{24}$/.test(id) ? await blogPlugin.request({ method: 'GET', path: `${GHOST}posts/${id}/` }) : null
  if (now && now.status !== 200 && now.status !== 404) throw refused(now, 'Your blog didn’t take the post.')
  const version = now?.status === 200 ? parsed<{ posts?: { updated_at?: unknown }[] }>(now)?.posts?.[0]?.updated_at : undefined
  const answer =
    typeof version === 'string'
      ? await blogPlugin.request({ method: 'PUT', path: `${GHOST}posts/${id}/?source=html`, json: json({ updated_at: version }) })
      : await blogPlugin.request({ method: 'POST', path: `${GHOST}posts/?source=html`, json: json({ status: 'draft' }) })
  const post = parsed<{ posts?: { id?: unknown; url?: unknown }[] }>(answer)?.posts?.[0]
  if ((answer.status !== 200 && answer.status !== 201) || typeof post?.id !== 'string') throw refused(answer, 'Your blog didn’t take the post.')
  return { id: post.id, url: typeof post.url === 'string' ? post.url : site, edit: `${site}/ghost/#/editor/post/${post.id}`, updated: answer.status === 200 }
}

/**
 * A Micro.blog post changed to match, as the Micropub standard has it, by its
 * address: its status left be. One Micro.blog no longer has is sent as a new
 * draft, made as Micro.blog shows. Micro.blog knows a post by its address, so
 * it has no id here, and its draft is opened at its preview, where it's
 * published.
 */
async function toMicroblog(_site: string, title: string, html: string, sent?: Earlier): Promise<Saved> {
  if (sent?.url) {
    const answer = await blogPlugin.request({ method: 'POST', path: MICROPUB, json: JSON.stringify({ action: 'update', url: sent.url, replace: { name: [title], content: [html] } }) })
    if (answer.status >= 200 && answer.status < 300) return { id: '', url: answer.location ?? sent.url, edit: sent.edit ?? sent.url, updated: true }
    if (answer.status !== 404) throw refused(answer, 'Your blog didn’t take the post.')
  }
  const form = new URLSearchParams({ h: 'entry', name: title, content: html, 'post-status': 'draft' })
  const answer = await blogPlugin.request({ method: 'POST', path: MICROPUB, form: form.toString() })
  const post = parsed<{ url?: unknown; preview?: unknown }>(answer)
  const url = typeof post?.url === 'string' ? post.url : answer.location
  if (answer.status < 200 || answer.status > 202 || !url) throw refused(answer, 'Your blog didn’t take the post.')
  return { id: '', url, edit: typeof post?.preview === 'string' ? post.preview : url, updated: false }
}

const SEND = { wordpress: toWordPress, ghost: toGhost, microblog: toMicroblog }

/**
 * The document on the blog connected, as a draft, its pictures uploaded
 * first; or, if it was sent before (`sent`), that post changed to match.
 * One gone from the blog is sent as a new draft.
 */
export async function sendPost(item: Item, sent?: Earlier): Promise<Sent & { updated: boolean }> {
  const { service = 'wordpress', site } = await blogPlugin.blog()
  if (!site) throw new BlogError('Connect your blog first, in Settings.')
  const { title, html } = postOf(item)
  const { html: content, pictures } = await withPictures(
    html,
    async (file) => {
      const path = service === 'ghost' ? `${GHOST}images/upload/` : service === 'microblog' ? `${MICROPUB}/media` : `${WP}media`
      const answer = await blogPlugin.request({ method: 'POST', path, file })
      const url =
        service === 'ghost'
          ? parsed<{ images?: { url?: unknown }[] }>(answer)?.images?.[0]?.url
          : service === 'microblog'
            ? answer.location
            : parsed<{ source_url?: unknown }>(answer)?.source_url
      // Micro.blog takes one for later (202).
      if ((answer.status !== 201 && answer.status !== 202) || typeof url !== 'string') throw refused(answer, 'Your blog didn’t take a picture.')
      return url
    },
    sent?.pictures,
  )
  return { ...(await SEND[service](site, title, content, sent)), pictures }
}
