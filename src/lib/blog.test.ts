// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'

const blog = vi.hoisted(() => ({
  connect: vi.fn(),
  blog: vi.fn(),
  forget: vi.fn(),
  request: vi.fn(),
}))
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: (name: string) => (name === 'NibBlog' ? blog : {}),
}))

const { BlogError, connectGhost, connectMicroblog, connectWordPress, postOf, sendPost, withPictures } = await import('./blog')

const text = (value: string): JSONContent => ({ type: 'text', text: value })
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const doc = (...content: JSONContent[]): Item => ({ id: 'a', kind: 'page', version: 1, createdAt: 1, updatedAt: 1, body: { type: 'doc', content } })
const PNG = 'data:image/png;base64,iVBORw0KGgo='
const answer = (status: number, body: unknown) => ({ status, body: JSON.stringify(body) })

beforeEach(() => {
  for (const method of Object.values(blog)) method.mockReset()
  blog.connect.mockImplementation(async ({ site }: { site: string }) => ({ site }))
  blog.blog.mockResolvedValue({ service: 'wordpress', site: 'https://blog.example', user: 'mara' })
})

describe('a document as a post', () => {
  it('takes its first line as the title, and leaves that line out of the text', () => {
    const post = postOf(doc({ type: 'heading', attrs: { level: 1 }, content: [text('Salt and weed')] }, p(text('The tide came in.'))))
    expect(post.title).toBe('Salt and weed')
    expect(post.html).not.toContain('Salt and weed')
    expect(post.html).toContain('The tide came in.')
  })

  it('keeps a first paragraph that only begins with the title', () => {
    const post = postOf(doc(p(text('Salt and weed'), { type: 'hardBreak' }, text('The tide came in.'))))
    expect(post.title).toBe('Salt and weed')
    expect(post.html).toContain('The tide came in.')
  })

  it('lists its footnotes after it, numbered', () => {
    const post = postOf(doc(p(text('Title')), p(text('Tides'), { type: 'footnote', attrs: { text: 'Twice a day.' } })))
    const page = new DOMParser().parseFromString(post.html, 'text/html')
    expect(page.querySelector('sup a')?.textContent).toBe('1')
    expect(page.querySelector('.notes li')?.textContent).toContain('Twice a day.')
  })
})

describe('the pictures in a post', () => {
  it('are uploaded once each, named for what’s in them, and their addresses on the blog put in their place', async () => {
    const upload = vi.fn(async ({ name }: { name: string }) => `https://blog.example/uploads/${name}`)
    const { html, pictures } = await withPictures(`<p><img src="${PNG}"></p><p><img src="${PNG}"><img src="https://elsewhere.example/a.png"></p>`, upload)
    expect(upload).toHaveBeenCalledOnce()
    const [[{ name }]] = upload.mock.calls
    expect(name).toMatch(/^[0-9a-f]{32}\.png$/)
    expect(upload).toHaveBeenCalledWith({ data: 'iVBORw0KGgo=', type: 'image/png', name })
    expect(html.split(`src="https://blog.example/uploads/${name}"`)).toHaveLength(3)
    expect(html).not.toContain('elsewhere')
    expect(pictures).toEqual({ [name.slice(0, 32)]: `https://blog.example/uploads/${name}` })
  })

  it('aren’t uploaded again when they were before', async () => {
    const upload = vi.fn(async () => 'https://blog.example/uploads/new.png')
    const first = await withPictures(`<img src="${PNG}">`, upload)
    upload.mockClear()
    const again = await withPictures(`<img src="${PNG}">`, upload, { ...first.pictures, gone: 'https://blog.example/uploads/old.png' })
    expect(upload).not.toHaveBeenCalled()
    expect(again.html).toContain('src="https://blog.example/uploads/new.png"')
    // Only the pictures it has now.
    expect(again.pictures).toEqual(first.pictures)
  })
})

describe('connecting a WordPress blog', () => {
  it('keeps it, with https:// if no scheme is given, and asks it who the key belongs to', async () => {
    blog.request.mockResolvedValue(answer(200, { id: 1, name: 'Mara Wells' }))
    await expect(connectWordPress(' blog.example ', 'mara ', 'abcd efgh ijkl')).resolves.toEqual({ name: 'Mara Wells', site: 'https://blog.example' })
    expect(blog.connect).toHaveBeenCalledWith({ service: 'wordpress', site: 'https://blog.example', user: 'mara', key: 'abcd efgh ijkl' })
    expect(blog.request).toHaveBeenCalledWith({ method: 'GET', path: '/wp-json/wp/v2/users/me?context=edit' })
    expect(blog.forget).not.toHaveBeenCalled()
  })

  it('forgets a key the blog won’t take, saying what it said', async () => {
    blog.request.mockResolvedValue(answer(401, { code: 'invalid_username', message: '<strong>Error:</strong> Unknown username.' }))
    await expect(connectWordPress('https://blog.example', 'nobody', 'x')).rejects.toThrow('That blog didn’t take that username and application password. It said: Error: Unknown username.')
    expect(blog.forget).toHaveBeenCalledOnce()
  })

  it('forgets an address with nothing there, or no WordPress', async () => {
    blog.request.mockRejectedValueOnce(new Error('offline'))
    await expect(connectWordPress('https://nowhere.example', 'mara', 'x')).rejects.toThrow('Couldn’t reach a blog at that address.')
    blog.request.mockResolvedValueOnce({ status: 404, body: '<html>Not found</html>' })
    await expect(connectWordPress('https://shop.example', 'mara', 'x')).rejects.toThrow('No WordPress answered at that address.')
    expect(blog.forget).toHaveBeenCalledTimes(2)
  })

  it('won’t keep an address that isn’t https, and says when the key can’t be kept', async () => {
    blog.connect.mockRejectedValueOnce(Object.assign(new Error('Expected a blog'), { code: 'address' }))
    await expect(connectWordPress('http://blog.example', 'mara', 'x')).rejects.toThrow('It needs to start with https://.')
    blog.connect.mockRejectedValueOnce(new Error('Keychain write failed (-25300).'))
    await expect(connectWordPress('https://blog.example', 'mara', 'x')).rejects.toThrow('Couldn’t keep your blog’s key on this device.')
    blog.connect.mockRejectedValueOnce(new Error('Keychain write failed (-25300).'))
    await expect(connectWordPress('https://blog.example', 'mara', 'x')).rejects.toBeInstanceOf(BlogError)
    expect(blog.request).not.toHaveBeenCalled()
  })
})

describe('sending to WordPress', () => {
  const item = doc(p(text('Salt and weed')), p(text('The tide.')), p({ type: 'image', attrs: { src: PNG } }))

  it('uploads the pictures, then makes a draft of the post, and says where it is', async () => {
    blog.request.mockResolvedValueOnce(answer(201, { id: 7, source_url: 'https://blog.example/uploads/picture-1.png' }))
    blog.request.mockResolvedValueOnce(answer(201, { id: 42, link: 'https://blog.example/?p=42', status: 'draft' }))
    const sent = await sendPost(item)
    expect(sent).toMatchObject({ id: '42', url: 'https://blog.example/?p=42', edit: 'https://blog.example/wp-admin/post.php?post=42&action=edit', updated: false })
    expect(Object.values(sent.pictures)).toEqual(['https://blog.example/uploads/picture-1.png'])
    expect(blog.request.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/wp-json/wp/v2/media', file: { type: 'image/png' } })
    const [{ path, json }] = blog.request.mock.calls[1]
    expect(path).toBe('/wp-json/wp/v2/posts')
    const post = JSON.parse(json)
    expect(post).toMatchObject({ title: 'Salt and weed', status: 'draft' })
    expect(post.content).toContain('<img src="https://blog.example/uploads/picture-1.png"')
    expect(post.content).toContain('The tide.')
  })

  it('changes the post it made before, leaving its status as it is and its pictures where they went', async () => {
    blog.request.mockResolvedValueOnce(answer(201, { source_url: 'https://blog.example/uploads/picture-1.png' }))
    blog.request.mockResolvedValueOnce(answer(201, { id: 42, link: 'https://blog.example/?p=42' }))
    const first = await sendPost(item)
    blog.request.mockClear()
    blog.request.mockResolvedValueOnce(answer(200, { id: 42, link: 'https://blog.example/salt-and-weed/', status: 'publish' }))
    await expect(sendPost(item, first)).resolves.toMatchObject({ id: '42', url: 'https://blog.example/salt-and-weed/', updated: true, pictures: first.pictures })
    expect(blog.request).toHaveBeenCalledOnce()
    expect(blog.request.mock.calls[0][0].path).toBe('/wp-json/wp/v2/posts/42')
    expect(JSON.parse(blog.request.mock.calls[0][0].json)).not.toHaveProperty('status')
  })

  it('makes a new draft when the post it made is gone, or in the trash', async () => {
    const plain = doc(p(text('Title')), p(text('Words.')))
    blog.request.mockResolvedValueOnce(answer(404, { code: 'rest_post_invalid_id' }))
    blog.request.mockResolvedValueOnce(answer(201, { id: 43, link: 'https://blog.example/?p=43' }))
    await expect(sendPost(plain, { id: '42' })).resolves.toMatchObject({ id: '43', updated: false })
    blog.request.mockResolvedValueOnce(answer(200, { id: 43, status: 'trash' }))
    blog.request.mockResolvedValueOnce(answer(201, { id: 44, link: 'https://blog.example/?p=44' }))
    await expect(sendPost(plain, { id: '43' })).resolves.toMatchObject({ id: '44', updated: false })
    expect(JSON.parse(blog.request.mock.calls[3][0].json)).toMatchObject({ status: 'draft' })
  })

  it('says so when the blog refuses it, or none is connected', async () => {
    blog.request.mockResolvedValueOnce(answer(403, { message: 'Sorry, you are not allowed to create posts as this user.' }))
    await expect(sendPost(doc(p(text('Title'))))).rejects.toThrow('Your blog didn’t take the post. It said: Sorry, you are not allowed to create posts as this user.')
    blog.blog.mockResolvedValue({})
    await expect(sendPost(doc(p(text('Title'))))).rejects.toThrow('Connect your blog first, in Settings.')
  })
})

describe('connecting a Ghost site', () => {
  const KEY = `${'a'.repeat(24)}:${'b'.repeat(64)}`

  it('keeps it by its API URL, or its admin’s, and asks it for a post to be sure the key works', async () => {
    blog.request.mockResolvedValue(answer(200, { posts: [] }))
    await expect(connectGhost(' https://ghost.example/ghost/ ', ` ${KEY} `)).resolves.toEqual({ site: 'https://ghost.example' })
    expect(blog.connect).toHaveBeenCalledWith({ service: 'ghost', site: 'https://ghost.example', key: KEY })
    expect(blog.request).toHaveBeenCalledWith({ method: 'GET', path: '/ghost/api/admin/posts/?limit=1&fields=id' })
  })

  it('forgets a key Ghost won’t take, saying what it said, and says when it isn’t a key at all', async () => {
    blog.request.mockResolvedValue(answer(401, { errors: [{ message: 'Unknown Admin API Key', type: 'UnauthorizedError' }] }))
    await expect(connectGhost('ghost.example', KEY)).rejects.toThrow('That Ghost site didn’t take that Admin API key. It said: Unknown Admin API Key')
    expect(blog.forget).toHaveBeenCalledOnce()
    blog.connect.mockRejectedValueOnce(Object.assign(new Error('Expected an Admin API key'), { code: 'key' }))
    await expect(connectGhost('ghost.example', 'a content key')).rejects.toThrow('That isn’t an Admin API key.')
  })
})

describe('sending to Ghost', () => {
  const ID = '6b024c5aee91b377593d2df1'
  const item = doc(p(text('Salt and weed')), p(text('The tide.')), p({ type: 'image', attrs: { src: PNG } }))
  beforeEach(() => blog.blog.mockResolvedValue({ service: 'ghost', site: 'https://ghost.example' }))

  it('uploads the pictures, then makes a draft from the HTML, and says where to edit it', async () => {
    blog.request.mockResolvedValueOnce(answer(201, { images: [{ url: 'https://ghost.example/content/images/a.png', ref: null }] }))
    blog.request.mockResolvedValueOnce(answer(201, { posts: [{ id: ID, url: 'https://ghost.example/p/uuid/', status: 'draft' }] }))
    const sent = await sendPost(item)
    expect(sent).toMatchObject({ id: ID, url: 'https://ghost.example/p/uuid/', edit: `https://ghost.example/ghost/#/editor/post/${ID}`, updated: false })
    expect(Object.values(sent.pictures)).toEqual(['https://ghost.example/content/images/a.png'])
    expect(blog.request.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/ghost/api/admin/images/upload/', file: { type: 'image/png' } })
    const [{ method, path, json }] = blog.request.mock.calls[1]
    expect([method, path]).toEqual(['POST', '/ghost/api/admin/posts/?source=html'])
    const [post] = JSON.parse(json).posts
    expect(post).toMatchObject({ title: 'Salt and weed', status: 'draft' })
    expect(post.html).toContain('<img src="https://ghost.example/content/images/a.png"')
  })

  it('changes the post it made before, as Ghost has it now, leaving its status be', async () => {
    blog.request.mockResolvedValueOnce(answer(200, { posts: [{ id: ID, status: 'published', updated_at: '2026-11-22T01:58:50.000Z' }] }))
    blog.request.mockResolvedValueOnce(answer(200, { posts: [{ id: ID, url: 'https://ghost.example/salt-and-weed/' }] }))
    await expect(sendPost(doc(p(text('Salt and weed')), p(text('The tide.'))), { id: ID })).resolves.toMatchObject({ id: ID, url: 'https://ghost.example/salt-and-weed/', updated: true })
    expect(blog.request.mock.calls[0][0]).toEqual({ method: 'GET', path: `/ghost/api/admin/posts/${ID}/` })
    const [{ method, path, json }] = blog.request.mock.calls[1]
    expect([method, path]).toEqual(['PUT', `/ghost/api/admin/posts/${ID}/?source=html`])
    const [post] = JSON.parse(json).posts
    expect(post.updated_at).toBe('2026-11-22T01:58:50.000Z')
    expect(post).not.toHaveProperty('status')
  })

  it('makes a new draft when the post it made is gone, but sends nothing new when Ghost can’t say', async () => {
    blog.request.mockResolvedValueOnce(answer(404, { errors: [{ message: 'Post not found.' }] }))
    blog.request.mockResolvedValueOnce(answer(201, { posts: [{ id: 'c'.repeat(24), url: 'https://ghost.example/p/new/' }] }))
    await expect(sendPost(doc(p(text('Title'))), { id: ID })).resolves.toMatchObject({ id: 'c'.repeat(24), updated: false })
    blog.request.mockClear()
    blog.request.mockResolvedValueOnce(answer(500, { errors: [{ message: 'Internal server error' }] }))
    await expect(sendPost(doc(p(text('Title'))), { id: ID })).rejects.toThrow('Your blog didn’t take the post. It said: Internal server error')
    expect(blog.request).toHaveBeenCalledOnce()
  })
})

describe('connecting Micro.blog', () => {
  it('keeps Micro.blog with the app token, and asks it for its settings to be sure the token works', async () => {
    blog.request.mockResolvedValue(answer(200, { 'media-endpoint': 'https://micro.blog/micropub/media' }))
    await expect(connectMicroblog(' token ')).resolves.toEqual({ site: 'https://micro.blog' })
    expect(blog.connect).toHaveBeenCalledWith({ service: 'microblog', site: 'https://micro.blog', key: 'token' })
    expect(blog.request).toHaveBeenCalledWith({ method: 'GET', path: '/micropub?q=config' })
  })

  it('forgets a token Micro.blog won’t take, saying what it said', async () => {
    blog.request.mockResolvedValue(answer(401, { error: 'unauthorized', error_description: 'The token is not valid.' }))
    await expect(connectMicroblog('old')).rejects.toThrow('Micro.blog didn’t take that app token. It said: The token is not valid.')
    expect(blog.forget).toHaveBeenCalledOnce()
  })
})

describe('sending to Micro.blog', () => {
  const URL_ = 'https://mara.micro.blog/2026/11/21/salt-and-weed.html'
  const PREVIEW = 'https://micro.blog/account/posts/123/preview/456'
  const item = doc(p(text('Salt and weed')), p(text('The tide.')), p({ type: 'image', attrs: { src: PNG } }))
  const plain = doc(p(text('Salt and weed')), p(text('The tide.')))
  beforeEach(() => blog.blog.mockResolvedValue({ service: 'microblog', site: 'https://micro.blog' }))

  it('uploads the pictures, then makes a draft, as a form, and opens it at its preview', async () => {
    blog.request.mockResolvedValueOnce({ status: 202, body: '', location: 'https://mara.micro.blog/uploads/2026/a.png' })
    blog.request.mockResolvedValueOnce({ ...answer(202, { url: URL_, preview: PREVIEW }), location: URL_ })
    const sent = await sendPost(item)
    expect(sent).toMatchObject({ id: '', url: URL_, edit: PREVIEW, updated: false })
    expect(Object.values(sent.pictures)).toEqual(['https://mara.micro.blog/uploads/2026/a.png'])
    expect(blog.request.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/micropub/media', file: { type: 'image/png' } })
    const [{ path, form }] = blog.request.mock.calls[1]
    expect(path).toBe('/micropub')
    const post = new URLSearchParams(form)
    expect([post.get('h'), post.get('name'), post.get('post-status')]).toEqual(['entry', 'Salt and weed', 'draft'])
    expect(post.get('content')).toContain('<img src="https://mara.micro.blog/uploads/2026/a.png"')
  })

  it('changes the post it made before by its address, as Micropub has it, leaving its status and preview be', async () => {
    blog.request.mockResolvedValueOnce({ status: 204, body: '' })
    await expect(sendPost(plain, { id: '', url: URL_, edit: PREVIEW })).resolves.toMatchObject({ url: URL_, edit: PREVIEW, updated: true })
    const [{ path, json }] = blog.request.mock.calls[0]
    expect(path).toBe('/micropub')
    expect(JSON.parse(json)).toEqual({ action: 'update', url: URL_, replace: { name: ['Salt and weed'], content: [expect.stringContaining('The tide.')] } })
  })

  it('makes a new draft when Micro.blog no longer has the post, but says what it said otherwise', async () => {
    blog.request.mockResolvedValueOnce(answer(404, { error: 'not_found' }))
    blog.request.mockResolvedValueOnce({ ...answer(202, { url: `${URL_}?2`, preview: PREVIEW }) })
    await expect(sendPost(plain, { url: URL_ })).resolves.toMatchObject({ url: `${URL_}?2`, updated: false })
    blog.request.mockClear()
    blog.request.mockResolvedValueOnce(answer(400, { error: 'invalid_request', error_description: 'Posts can’t be edited yet.' }))
    await expect(sendPost(plain, { url: URL_ })).rejects.toThrow('Your blog didn’t take the post. It said: Posts can’t be edited yet.')
    expect(blog.request).toHaveBeenCalledOnce()
  })
})
