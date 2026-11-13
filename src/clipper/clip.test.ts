import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { clipperCode, newInboxKeys, openPost } from '../../worker/inbox-seal'
import { MAX_SEALED_POST, SEALED_TYPE } from '../../worker/wire.mjs'
import { SYNC_ORIGIN } from '../lib/hosts'
import { acceptCode, asPost, clipOf, firstChoice, offered, send, SERVERS, WHY, type Parts } from './clip'

/** Nib's browser extension: what a clip is, and how it leaves the browser (clipper/clip), sealed with a real inbox's key. */

const ID = '0123456789abcdef0123456789abcdef'
const SECRET = 'S'.repeat(43)
const ADDRESS = `${SYNC_ORIGIN}/v1/in/${ID}.${SECRET}`
const PARTS: Parts = { title: 'Tides of the north harbour', url: 'https://example.com/tides', html: '<p>All of it</p>', selection: '', article: '<p>The article</p>', visible: '<p>On screen</p>' }

describe('the clipper code, in the extension', () => {
  it('is taken only for Nib’s own server, as published', async () => {
    const { publicKey } = await newInboxKeys()
    expect(SERVERS).toEqual([SYNC_ORIGIN])
    expect(acceptCode(clipperCode(ADDRESS, publicKey))).toEqual({ address: ADDRESS, key: publicKey })
    // A code that reads as one, for anywhere else: a clip isn't sent there.
    for (const elsewhere of ['https://sync.example.com', 'https://nibprivacy.com', 'http://localhost:8799', `${SYNC_ORIGIN}.example.com`]) {
      expect(acceptCode(clipperCode(`${elsewhere}/v1/in/${ID}.${SECRET}`, publicKey)), elsewhere).toBe(null)
    }
    for (const code of ['', ADDRESS, 'not a code']) expect(acceptCode(code), code).toBe(null)
    // A build for trying it out names a server on this computer, and takes a code for it.
    expect(acceptCode(clipperCode(`http://localhost:8799/v1/in/${ID}.${SECRET}`, publicKey), [SYNC_ORIGIN, 'http://localhost:8799'])).not.toBe(null)
  })
})

describe('a clip', () => {
  it('offers the link, and each part of the page there is: what’s selected first of all when there is some', () => {
    expect(offered(PARTS)).toEqual(['link', 'article', 'visible', 'whole'])
    expect(firstChoice(PARTS)).toBe('link')
    const selected = { ...PARTS, selection: '<p>Chosen</p>' }
    expect(offered(selected)).toEqual(['link', 'selection', 'article', 'visible', 'whole'])
    expect(firstChoice(selected)).toBe('selection')
    expect(offered({ ...PARTS, html: '', article: '', visible: '' })).toEqual(['link'])
  })

  it('is the page’s title and address, the note if one was written, and the part chosen under its name', () => {
    expect(clipOf(PARTS, 'link', PARTS.title, '')).toEqual({ title: PARTS.title, url: PARTS.url })
    expect(clipOf(PARTS, 'article', '  My own title ', ' For Thursday. ')).toEqual({ title: 'My own title', url: PARTS.url, text: 'For Thursday.', page: '<p>The article</p>', part: 'article' })
    expect(clipOf(PARTS, 'visible', '', '')).toEqual({ title: PARTS.title, url: PARTS.url, page: '<p>On screen</p>', part: 'visible' })
    expect(clipOf(PARTS, 'whole', PARTS.title, '')).toMatchObject({ page: '<p>All of it</p>', part: 'whole' })
    // A part chosen that the page has nothing for is the link alone.
    expect(clipOf(PARTS, 'selection', PARTS.title, '')).toEqual({ title: PARTS.title, url: PARTS.url })
  })

  it('is taken from the page’s picker as its text alone: nothing else it was handed', () => {
    expect(asPost({ title: 'T', text: 7, url: 'https://example.com/', page: '<p>x</p>', part: 'picked', address: 'https://elsewhere.example', code: 'x', extra: { deep: true } })).toEqual({ title: 'T', url: 'https://example.com/', page: '<p>x</p>', part: 'picked' })
    for (const nothing of [null, undefined, 'a string', 7, []]) expect(asPost(nothing)).toEqual({})
  })
})

describe('sending a clip', () => {
  const answering = (status: number) => vi.fn(async () => new Response('{}', { status }))

  it('seals it with the code’s key and sends it sealed to the code’s address, with nothing of the browser’s', async () => {
    const keys = await newInboxKeys()
    const fetching = answering(200)
    const post = clipOf(PARTS, 'article', PARTS.title, 'For **Thursday**.')
    expect(await send(clipperCode(ADDRESS, keys.publicKey), post, fetching)).toEqual({ ok: true })
    expect(fetching).toHaveBeenCalledTimes(1)
    const [to, how] = fetching.mock.calls[0] as unknown as [string, RequestInit]
    // The secret in a header, not the address (worker/inbox).
    expect(to).toBe(`${SYNC_ORIGIN}/v1/in/${ID}`)
    expect(how).toMatchObject({ method: 'POST', headers: { 'Content-Type': SEALED_TYPE, Authorization: `Bearer ${SECRET}` }, credentials: 'omit', referrerPolicy: 'no-referrer' })
    // What went is sealed: none of the clip's words, and only the inbox's own key opens it.
    const sent = String(how.body)
    for (const words of ['Tides', 'example.com', 'Thursday', 'article']) expect(Buffer.from(sent, 'base64').toString('latin1')).not.toContain(words)
    expect(await openPost(keys.privateKey, keys.publicKey, sent)).toEqual(post)
  })

  it('sends nothing with no code, a code for anywhere else, or a clip longer than the server takes', async () => {
    const { publicKey } = await newInboxKeys()
    const fetching = answering(200)
    expect(await send('', { title: 'x' }, fetching)).toEqual({ ok: false, why: WHY.code })
    expect(await send(clipperCode(`https://elsewhere.example/v1/in/${ID}.${SECRET}`, publicKey), { title: 'x' }, fetching)).toEqual({ ok: false, why: WHY.code })
    expect(await send(clipperCode(ADDRESS, publicKey), { page: 'x'.repeat(760_000) }, fetching)).toEqual({ ok: false, why: WHY[413] })
    expect(fetching).not.toHaveBeenCalled()
    // By what it comes to sealed, not by how many letters: three bytes a letter is a third as many.
    expect((await send(clipperCode(ADDRESS, publicKey), { page: '潮'.repeat(260_000) }, fetching)).ok).toBe(false)
    expect((await send(clipperCode(ADDRESS, publicKey), { page: '潮'.repeat(240_000) }, fetching)).ok).toBe(true)
    expect(MAX_SEALED_POST).toBe(1_000_000)
  })

  it('says why it wasn’t taken, in words, and that the server couldn’t be reached', async () => {
    const { publicKey } = await newInboxKeys()
    const code = clipperCode(ADDRESS, publicKey)
    for (const status of [402, 404, 413, 429, 507] as const) expect(await send(code, { title: 'x' }, answering(status)), String(status)).toEqual({ ok: false, why: WHY[status] })
    expect(await send(code, { title: 'x' }, answering(500))).toEqual({ ok: false, why: 'Nib’s server answered 500.' })
    expect(
      await send(code, { title: 'x' }, async () => {
        throw new TypeError('Failed to fetch')
      }),
    ).toEqual({ ok: false, why: WHY.offline })
  })
})

describe('the extension as it’s published', () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
  const manifest = JSON.parse(read('extension/manifest.json')) as Record<string, any>

  it('may reach Nib’s server and nothing else, and reads a page only when its button is pressed', () => {
    expect(manifest.host_permissions).toEqual([`${SYNC_ORIGIN}/*`])
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage'])
    expect(manifest.content_scripts).toBeUndefined()
    expect(manifest.optional_host_permissions).toBeUndefined()
    // A server on this computer is added by the build for trying it out, and only by it.
    const build = read('scripts/build-extension.mjs')
    expect(build).toContain("if (local) manifest.host_permissions.push(...LOCAL.map((origin) => `${origin}/*`))")
    expect(build).toContain("define: local ? { __CLIPPER_LOCAL__: JSON.stringify(LOCAL) } : {}")
    expect(build).toContain("const local = process.argv.includes('--local')")
  })

  it('is one manifest for Chrome, Edge and Firefox: a background each can run, the versions that take it, and Firefox’s id and what it says leaves the browser', () => {
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.background).toEqual({ service_worker: 'background.js', scripts: ['background.js'] })
    expect(manifest.minimum_chrome_version).toBe('121')
    expect(manifest.browser_specific_settings.gecko).toEqual({ id: 'clipper@nibprivacy.com', strict_min_version: '127.0', data_collection_permissions: { required: ['websiteContent', 'browsingActivity'] } })
  })

  it('is built with the files its manifest and its popup name, the page’s reader being the one Safari’s share sheet runs', () => {
    const build = read('scripts/build-extension.mjs')
    const popup = read('extension/popup.html')
    for (const name of ['popup', 'background', 'picker']) expect(build).toContain(`'${name}'],`)
    expect(build).toContain("cpSync('ios/App/NibShare/Page.js', `${out}/page.js`)")
    expect(manifest.action.default_popup).toBe('popup.html')
    expect(popup).toContain('<script src="popup.js"></script>')
    expect(popup).toContain('<link rel="stylesheet" href="popup.css" />')
    expect(read('src/clipper/popup.ts')).toContain("files: ['page.js']")
    expect(read('src/clipper/popup.ts')).toContain("files: ['picker.js']")
    for (const size of ['16', '32', '48', '128']) expect(manifest.icons[size]).toBe(`icons/${size}.png`)
    // The version is the app's, put in as it's built.
    expect(build).toContain("manifest.version = JSON.parse(readFileSync('package.json', 'utf8')).version")
  })
})
