import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Theme } from './lib/theme'
import type { Sort } from './lib/sort'
import type { OpenDocument } from './lib/useOpenDocument'
import { db } from './db/db'
import * as items from './db/items'

/** Commands → Send to your blog (fileActions sendToBlog): the blog itself stood in for (lib/blog). */

const blog = vi.hoisted(() => ({ site: 'https://blog.example' as string | undefined, send: vi.fn() }))
vi.mock('./lib/blog', async (actual) => {
  const real = await actual<typeof import('./lib/blog')>()
  return { ...real, blogPlugin: { blog: async () => (blog.site ? { service: 'wordpress', site: blog.site } : {}) }, sendPost: blog.send }
})

const { BLOG_PLUS, BlogError } = await import('./lib/blog')
const { fileActions } = await import('./fileActions')

const body = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const setNotice = vi.fn()
const askPlus = vi.fn()
const openBlog = vi.fn()
const sent = (id: string, updated = false) => ({ id, url: `https://blog.example/?p=${id}`, edit: `https://blog.example/wp-admin/post.php?post=${id}&action=edit`, pictures: { ['a'.repeat(32)]: 'https://blog.example/a.png' }, updated })

function actions(open: string, features = true) {
  const session = { flush: async () => {}, guarded: async (action: () => Promise<unknown>) => action(), whenSaved: async (run: (id: string) => Promise<void>) => run(open) } as unknown as OpenDocument
  return fileActions({ session, setNotice, features, askPlus, everything: [], theme: 'light' as Theme, sort: 'recent' as Sort, setImportReport: vi.fn(), onRestored: vi.fn(), openBlog })
}

beforeEach(async () => {
  await db.items.clear()
  blog.site = 'https://blog.example'
  blog.send.mockReset()
  for (const mock of [setNotice, askPlus, openBlog]) mock.mockClear()
})

describe('sending to your blog', () => {
  it('sends the document as a draft, keeps where it went, and offers to open it there', async () => {
    const id = await items.create('page', body('Salt and weed'))
    blog.send.mockResolvedValue(sent('42'))
    await actions(id).sendToBlog()
    expect(blog.send).toHaveBeenCalledWith(expect.objectContaining({ id }), undefined)
    const { updated: _, ...where } = sent('42')
    expect((await items.get(id))!.posted).toEqual([{ site: 'https://blog.example', ...where }])
    const notice = setNotice.mock.calls.at(-1)![0]
    expect(notice.text).toBe('Sent to blog.example as a draft.')
    const open = vi.fn()
    vi.stubGlobal('window', { open })
    notice.action.run()
    vi.unstubAllGlobals()
    expect(open).toHaveBeenCalledWith('https://blog.example/wp-admin/post.php?post=42&action=edit', '_blank')
  })

  it('changes the post it made before, and says so', async () => {
    const id = await items.create('page', body('Salt and weed'))
    blog.send.mockResolvedValueOnce(sent('42')).mockResolvedValueOnce(sent('42', true))
    await actions(id).sendToBlog()
    await actions(id).sendToBlog()
    expect(blog.send.mock.calls[1][1]).toMatchObject({ site: 'https://blog.example', id: '42', pictures: sent('42').pictures })
    expect(setNotice.mock.calls.at(-1)![0].text).toBe('Updated your post on blog.example.')
    expect((await items.get(id))!.posted).toHaveLength(1)
  })

  it('says what the blog said when it refuses, and keeps nothing', async () => {
    const id = await items.create('page', body('Salt and weed'))
    blog.send.mockRejectedValue(new BlogError('Your blog didn’t take the post.'))
    await actions(id).sendToBlog()
    expect(setNotice).toHaveBeenLastCalledWith('Your blog didn’t take the post.')
    expect((await items.get(id))!.posted).toBeUndefined()
  })

  it('asks for Plus without it, and to connect a blog when there’s none, sending nothing', async () => {
    const id = await items.create('page', body('Salt and weed'))
    await actions(id, false).sendToBlog()
    expect(askPlus).toHaveBeenCalledWith(BLOG_PLUS)
    blog.site = undefined
    await actions(id).sendToBlog()
    expect(openBlog).toHaveBeenCalledOnce()
    expect(blog.send).not.toHaveBeenCalled()
  })

  it('won’t send a locked one with the vault shut', async () => {
    const id = await items.create('page', body('Salt and weed'))
    await db.items.update(id, { vault: { v: 1, iv: 'a', data: 'b' } as never })
    await actions(id).sendToBlog()
    expect(setNotice).toHaveBeenLastCalledWith('This is locked. Open the vault to send it.')
    expect(blog.send).not.toHaveBeenCalled()
  })
})
