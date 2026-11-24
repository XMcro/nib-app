import type { Item } from '../db/db'

/**
 * Where a document went on the writer's blog (lib/blog), by the blog's
 * address: the post's id there (none on Micro.blog, which knows it by its
 * address), where it's read and where it's edited, and
 * each of its pictures uploaded there, by what's in it. So sending it again,
 * from any of the writer's devices, changes that post and uploads no picture
 * twice. None of it is a secret: the blog's key stays in this device's
 * Keychain.
 */
export type Posted = { site: string; id: string; url: string; edit: string; pictures: Record<string, string> }

const LINK = /^https?:\/\/\S{1,2000}$/
const link = (raw: unknown): raw is string => typeof raw === 'string' && LINK.test(raw)

/** The one check on a document's posts arriving from outside. An empty list, not a missing one, means none, as with `shares`. */
export function asPosted(raw: unknown): Posted[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.slice(0, 20).flatMap((entry) => {
    const one = entry as Partial<Posted> | null
    if (!one || !link(one.site) || typeof one.id !== 'string' || !/^[\w-]{0,64}$/.test(one.id) || !link(one.url) || !link(one.edit)) return []
    const pictures: Record<string, string> = {}
    if (one.pictures && typeof one.pictures === 'object') {
      for (const [name, url] of Object.entries(one.pictures).slice(0, 500)) if (/^[0-9a-f]{32}$/.test(name) && link(url)) pictures[name] = url
    }
    return [{ site: one.site, id: one.id, url: one.url, edit: one.edit, pictures }]
  })
}

/** Its post on the blog at `site`, if it has one. */
export const postedOn = (item: Item, site: string): Posted | undefined => item.posted?.find((one) => one.site === site)
