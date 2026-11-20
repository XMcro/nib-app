import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { newShare, open, revealToken, seal, withPassword } from '../share/crypto'
import { openDraft } from './page'
import './reader.css'

/**
 * The reader page, end to end in a real browser: the server is a stand-in,
 * the encryption is real. Needs selection, so not jsdom.
 */

const body = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'The Lighthouse Keeper' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'The lamp turned all night over the harbour.' }] },
  ],
}

async function shared({ notesOn = true, status = 200, draft = body as object, counted = undefined as unknown } = {}) {
  const secrets = newShare()
  const doc = await seal(secrets.key, secrets.slug, 'doc', { v: 1, kind: 'page', body: draft })
  const sent: { url: string; init?: RequestInit }[] = []
  const fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url, init })
    if (init?.method === 'POST') return new Response('{"id":1}', { status: 201 })
    return new Response(JSON.stringify({ doc, expiresAt: new Date(2026, 10, 30, 12).getTime(), notesOn, ...(counted === undefined ? {} : { counted }) }), { status })
  }) as typeof window.fetch
  const root = document.createElement('main')
  document.body.append(root)
  const link = new URL(`https://nib.test/d/${secrets.slug}#${secrets.key}`)
  await openDraft(root, link, fetch)
  return { root, sent, secrets, link }
}

afterEach(() => document.body.replaceChildren())

describe('the reader page', () => {
  it('shows a callout’s kind in words, in its own colour', async () => {
    const { root } = await shared({ draft: { type: 'doc', content: ['warning', 'tip'].map((kind) => ({ type: 'callout', attrs: { kind, collapsed: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Words' }] }] })) } })
    const [warning, tip] = root.querySelectorAll('[data-callout]')
    expect(getComputedStyle(warning, '::before').content).toBe('"Warning"')
    expect(getComputedStyle(tip, '::before').content).toBe('"Tip"')
    expect(getComputedStyle(warning).borderInlineStartColor).not.toBe(getComputedStyle(tip).borderInlineStartColor)
  })

  it('is titled for a draft that opens with a deeper heading, drawn a little under the subheading', async () => {
    const heading = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
    const { root } = await shared({ draft: { type: 'doc', content: [heading(5, 'A small opening'), heading(3, 'Three'), heading(4, 'Four'), heading(6, 'Six')] } })
    expect(document.title).toBe('A small opening')
    const size = (tag: string) => parseFloat(getComputedStyle(root.querySelector(tag)!).fontSize)
    expect(size('h3')).toBeGreaterThan(size('h4'))
    expect(size('h4')).toBeGreaterThan(size('h5'))
    expect(size('h5')).toBeGreaterThan(size('h6'))
    expect(size('h6') / size('h3')).toBeCloseTo(0.95 / 1.15, 2)
  })

  it('draws a picture the writer sized at that share of the text, and sets it where its line is', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 8
    canvas.getContext('2d')!.fillRect(0, 0, 8, 8)
    const picture = (attrs: object) => ({ type: 'paragraph', attrs, content: [{ type: 'image', attrs: { src: canvas.toDataURL('image/png'), alt: '', size: 'medium' } }] })
    const { root } = await shared({ draft: { type: 'doc', content: [picture({}), picture({ textAlign: 'right' })] } })
    const [plain, right] = [...root.querySelectorAll<HTMLImageElement>('img[data-size="medium"]')]
    await expect.poll(() => plain.complete && right.complete).toBe(true)
    const line = plain.parentElement!.getBoundingClientRect()
    expect(Math.round(plain.getBoundingClientRect().width)).toBe(Math.round(line.width / 2))
    expect(Math.round(plain.getBoundingClientRect().left)).toBe(Math.round(line.left))
    expect(Math.round(right.getBoundingClientRect().right)).toBe(Math.round(right.parentElement!.getBoundingClientRect().right))
  })

  it('opens the draft with the key from the link, which it never sends', async () => {
    const { root, sent, secrets } = await shared()
    expect(root.querySelector('h1')?.textContent).toBe('The Lighthouse Keeper')
    expect(root.querySelector('header')?.textContent).toBe('A draft shared from Nib, until November 30')
    expect(document.title).toBe('The Lighthouse Keeper')
    expect(sent.map((request) => request.url)).toEqual([`/v1/shares/${secrets.slug}`])
    expect(JSON.stringify(sent)).not.toContain(secrets.key)
  })

  it('sends a note on the selected passage, sealed with the same key', async () => {
    const { root, sent, secrets } = await shared()
    const paragraph = root.querySelector('article p')!
    const range = document.createRange()
    range.setStart(paragraph.firstChild!, 4)
    range.setEnd(paragraph.firstChild!, 26)
    const selected = new Promise((resolve) => document.addEventListener('selectionchange', resolve, { once: true })) // selectionchange is async
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    await selected

    await userEvent.click(root.querySelector('.notebar button')!)
    expect(root.querySelector('.noteform blockquote')?.textContent).toBe('lamp turned all night')
    // As the password's field: 16px, or an iPhone zooms in on it.
    expect(getComputedStyle(root.querySelector('textarea')!).fontSize).toBe('16px')
    expect(getComputedStyle(root.querySelector('.noteform input')!).fontSize).toBe('16px')
    await userEvent.type(root.querySelector('textarea')!, 'Lovely image.')
    await userEvent.type(root.querySelector('.noteform input')!, 'Sam')
    await userEvent.click(root.querySelector<HTMLButtonElement>('.noteform button[type="submit"]')!)

    const post = sent.find((request) => request.init?.method === 'POST')!
    expect(post.url).toBe(`/v1/shares/${secrets.slug}/notes`)
    const { note } = JSON.parse(post.init!.body as string)
    expect(note).not.toContain('Lovely')
    expect(await open(secrets.key, secrets.slug, 'note', note)).toEqual({ text: 'Lovely image.', quote: 'lamp turned all night', name: 'Sam' })
    expect(JSON.stringify(sent)).not.toContain(secrets.key)
  })

  it('offers no notes when the writer has turned them off', async () => {
    const { root } = await shared({ notesOn: false })
    expect(root.querySelector('.notebar')).toBeNull()
  })

  it('says plainly when a draft is gone, or the link is broken', async () => {
    expect((await shared({ status: 410 })).root.textContent).toBe('This draft is no longer shared.')

    const root = document.createElement('main')
    const { slug } = newShare()
    await openDraft(root, new URL(`https://nib.test/d/${slug}`), (async () => new Response('{}')) as typeof window.fetch)
    expect(root.textContent).toMatch(/^This link is incomplete/)

    const { secrets, root: other } = await shared()
    const wrong = new URL(`https://nib.test/d/${secrets.slug}#${newShare().key}`)
    const doc = await seal(secrets.key, secrets.slug, 'doc', { body })
    await openDraft(other, wrong, (async () => new Response(JSON.stringify({ doc, expiresAt: 0, notesOn: true }))) as typeof window.fetch)
    expect(other.textContent).toMatch(/^This link’s key doesn’t open the draft/)
  })

  // A draft that opened to something not a draft, `null` say, threw, and the
  // page sat on "Opening the draft…" for good.
  it('says so when the draft opens to something that isn’t one', async () => {
    const secrets = newShare()
    const doc = await seal(secrets.key, secrets.slug, 'doc', null)
    const fetch = (async () => new Response(JSON.stringify({ doc, expiresAt: Date.now() + 86_400_000, notesOn: false }))) as unknown as typeof window.fetch
    const root = document.createElement('main')
    document.body.append(root)
    await openDraft(root, new URL(`https://nib.test/d/${secrets.slug}#${secrets.key}`), fetch)
    expect(root.textContent).toContain('This draft can’t be shown')
  })

  it('says it was written in Nib, linking to the App Store', async () => {
    const { root } = await shared()
    const nib = [...root.querySelectorAll<HTMLAnchorElement>('footer a')].find((a) => a.textContent === 'Written in Nib')!
    expect(nib.href).toBe('https://apps.apple.com/app/nib-private-notes/id6815422995')
    expect(nib.rel).toBe('noopener')
  })

  it('lets the reader report it, with the whole link so they can choose to show it', async () => {
    const { root, link } = await shared()
    const report = root.querySelector<HTMLAnchorElement>('footer a')!
    expect(report.textContent).toBe('Report this page')
    const mail = new URL(report.href)
    expect(mail.protocol).toBe('mailto:')
    expect(mail.pathname).toBe('support@nibprivacy.com')
    expect(mail.searchParams.get('body')).toContain(link.href)
  })
})

describe('a draft whose openings are counted', () => {
  const COUNTED = 'The writer can see how many times this link has been opened, and nothing about who opened it.'

  it('says so to the reader, beside what it says of the encryption', async () => {
    const { root } = await shared({ counted: true })
    expect(root.querySelector('footer')?.textContent).toContain(`Encrypted end to end: Nib’s server can’t read this draft or its notes. ${COUNTED} Report this page`)
  })

  it('says nothing of counting on one that isn’t: a free link, or an answer that doesn’t say yes', async () => {
    expect((await shared()).root.querySelector('footer')?.textContent).not.toContain('how many times')
    document.body.replaceChildren()
    expect((await shared({ counted: 'no' })).root.querySelector('footer')?.textContent).not.toContain('how many times')
  })
})

describe('a draft with a password', () => {
  // The asking is what's counted, whether or not the password ever opens it.
  it('says where it asks for the password that the link is counted, when it is', async () => {
    const secrets = newShare()
    const fetch = (async () => new Response(JSON.stringify({ doc: 'AAAA', expiresAt: Date.now() + 86_400_000, notesOn: true, counted: true }), { status: 200 })) as typeof window.fetch
    const root = document.createElement('main')
    document.body.append(root)
    void openDraft(root, new URL(`https://nib.test/d/${secrets.slug}#${secrets.key}.p`), fetch)
    await expect.poll(() => root.querySelector('.unlock p')?.textContent).toBe(
      'This draft needs a password. The writer will have given it to you with the link. The writer can see how many times this link has been opened, and nothing about who opened it.',
    )
  })

  it('asks for it, says when it’s wrong, then opens and seals notes with it', async () => {
    const secrets = newShare()
    const sealKey = await withPassword(secrets.key, secrets.slug, 'tide tables')
    const doc = await seal(sealKey, secrets.slug, 'doc', { v: 1, kind: 'page', body })
    const sent: { url: string; init?: RequestInit }[] = []
    const fetch = (async (url: string, init?: RequestInit) => {
      sent.push({ url, init })
      if (init?.method === 'POST') return new Response('{"id":1}', { status: 201 })
      return new Response(JSON.stringify({ doc, expiresAt: Date.now() + 86_400_000, notesOn: true }), { status: 200 })
    }) as typeof window.fetch
    const root = document.createElement('main')
    document.body.append(root)
    const opened = openDraft(root, new URL(`https://nib.test/d/${secrets.slug}#${secrets.key}.p`), fetch)

    const input = await waitFor(() => root.querySelector<HTMLInputElement>('.unlock input[type="password"]'))
    // 16px, or Safari on an iPhone zooms the page in when the field is tapped, and the words beside it run off the side.
    // It was `font: 16px/1.5 inherit`, which is no font at all, so the field had the browser's own 13px.
    expect(getComputedStyle(input).fontSize).toBe('16px')
    // Still on the server, so it says nothing of being deleted there (as one to be read once does).
    expect(root.querySelector('.unlock p')?.textContent).toBe('This draft needs a password. The writer will have given it to you with the link.')
    await userEvent.type(input, 'wrong')
    await userEvent.click(root.querySelector('.unlock button')!)
    await waitFor(() => (root.querySelector('.unlock .hint')?.textContent?.startsWith('That password') ? true : null))
    expect(root.querySelector('article')).toBeNull()

    await userEvent.clear(input)
    await userEvent.type(input, 'tide tables')
    await userEvent.click(root.querySelector('.unlock button')!)
    await opened
    expect(root.querySelector('h1')?.textContent).toBe('The Lighthouse Keeper')

    await userEvent.click(root.querySelector('.notebar button')!)
    await userEvent.type(root.querySelector('textarea')!, 'Lovely.')
    await userEvent.click(root.querySelector('.noteform button[type="submit"]')!)
    const posted = sent.find((request) => request.init?.method === 'POST')!
    const { note } = JSON.parse(posted.init!.body as string)
    expect(await open(sealKey, secrets.slug, 'note', note)).toEqual({ text: 'Lovely.' })
    expect(JSON.stringify(sent)).not.toContain('tide tables')
  })
})

/** Polls until `find` gives something, for steps that wait on PBKDF2. */
async function waitFor<T>(find: () => T | null | undefined, timeout = 8000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const found = find()
    if (found) return found
    if (Date.now() - start > timeout) throw new Error('Timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

// A link that deletes itself after one reading (worker/share): the page asks before it's used up.
describe('a draft to be read once', () => {
  const READ_ONCE_GONE = 'This draft could be read once, and has been.'
  /** The server's side, stood in for: asked, it says only that it's one; revealed, it hands it over once. */
  async function once({ password = '', gone = false, failing = false } = {}) {
    const secrets = newShare()
    const key = password ? await withPassword(secrets.key, secrets.slug, password) : secrets.key
    const doc = await seal(key, secrets.slug, 'doc', { v: 1, kind: 'page', body })
    const sent: { url: string; method: string; body?: string }[] = []
    let read = gone
    const fetch = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      sent.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined })
      const about = { expiresAt: new Date(2026, 10, 30, 12).getTime(), notesOn: true }
      if (url.endsWith('/notes')) return new Response('{"id":1}', { status: 201 })
      if (read) return new Response(JSON.stringify({ error: READ_ONCE_GONE }), { status: 410 })
      if (url.endsWith('/reveal')) {
        if (failing) throw new TypeError('offline')
        read = true
        return new Response(JSON.stringify({ doc, ...about }), { status: 200 })
      }
      return new Response(JSON.stringify({ once: true, ...about }), { status: 200 })
    }) as typeof window.fetch
    const root = document.createElement('main')
    document.body.append(root)
    const link = new URL(`https://nib.test/d/${secrets.slug}#${secrets.key}${password ? '.p' : ''}`)
    const opening = openDraft(root, link, fetch)
    return { root, sent, opening, secrets, readElsewhere: () => void (read = true) }
  }
  const button = (root: HTMLElement, name: string) => [...root.querySelectorAll('button')].find((one) => one.textContent === name)!
  const until = (check: () => boolean) => expect.poll(check).toBe(true)

  it('isn’t fetched by opening the page: it says what will happen, and waits to be asked', async () => {
    const { root, sent } = await once()
    await until(() => !!button(root, 'Open it now'))
    // Before it's opened, all of what opening it does, what the writer learns included.
    expect(root.querySelector('form p')?.textContent).toBe('This draft can be read once. When you open it, it’s deleted from Nib’s server, and this link stops working. The writer will see that it has been read.')
    expect(root.querySelector('article')).toBeNull()
    expect(sent.map((one) => `${one.method} ${one.url.replace(/[A-Za-z0-9_-]{22}/, ':slug')}`)).toEqual(['GET /v1/shares/:slug'])
  })

  it('is shown when asked for, saying it’s now gone from the server, and still takes a note', async () => {
    const { root, sent, opening, secrets } = await once()
    await until(() => !!button(root, 'Open it now'))
    await userEvent.click(button(root, 'Open it now'))
    await opening
    expect(root.querySelector('article h1')?.textContent).toBe('The Lighthouse Keeper')
    expect(root.querySelector('header')?.textContent).toBe('A draft shared from Nib, to be read once. It’s now deleted from Nib’s server: this page is the only copy, until you close it.')
    expect(sent.map((one) => one.method)).toEqual(['GET', 'POST'])
    expect(sent[1].url).toMatch(/\/reveal$/)
    // With the token from the link's key, which the slug alone can't make (the security review of 2026-11-13).
    expect(JSON.parse(sent[1].body!)).toEqual({ token: await revealToken(secrets.key, secrets.slug) })
    expect(button(root, 'Add a note')).toBeTruthy()
  })

  it('says so when it has been read already, here or by someone else first', async () => {
    const { root, opening } = await once({ gone: true })
    await opening
    expect(root.textContent).toBe('This draft could be read once, and it already has been.')

    document.body.replaceChildren()
    // Read by someone else between this page opening and its button being pressed.
    const raced = await once()
    await until(() => !!button(raced.root, 'Open it now'))
    raced.readElsewhere()
    await userEvent.click(button(raced.root, 'Open it now'))
    await raced.opening
    expect(raced.root.textContent).toBe('This draft could be read once, and it already has been.')
  })

  it('isn’t used up by a reveal that never reached the server: it can be asked for again', async () => {
    const { root, opening } = await once({ failing: true })
    await until(() => !!button(root, 'Open it now'))
    await userEvent.click(button(root, 'Open it now'))
    await until(() => (root.textContent ?? '').includes('Couldn’t reach Nib. Check your connection and try again.'))
    expect(button(root, 'Open it now').disabled).toBe(false)
    void opening
  })

  // This stand-in hands it over for any token, as the server does one from a Nib before tokens: the password is
  // asked for with "Open it now" all the same, and again after if it was wrong (page.once.test.ts has the rest).
  it('with a password too, asks for it before it’s revealed, and again after for as often as it takes', async () => {
    const { root, opening } = await once({ password: 'harbour lights' })
    await until(() => !!button(root, 'Open it now'))
    expect(root.textContent).toContain('It needs a password too: the writer will have given it to you with the link.')
    await userEvent.fill(root.querySelector('input[type=password]')!, 'wrong')
    await userEvent.click(button(root, 'Open it now'))
    // Closing the page to go and ask for the password would lose it.
    await until(() => (root.textContent ?? '').includes('It’s deleted from Nib’s server now: keep this page open until you’ve read it.'))
    await userEvent.fill(root.querySelector('input[type=password]')!, 'wrong')
    await userEvent.click(button(root, 'Open'))
    await until(() => (root.textContent ?? '').includes('That password doesn’t open it.'))
    await userEvent.fill(root.querySelector('input[type=password]')!, 'harbour lights')
    await userEvent.click(button(root, 'Open'))
    await opening
    expect(root.querySelector('article h1')?.textContent).toBe('The Lighthouse Keeper')
  })

  it('says a draft can’t be shown when the answer has none in it, rather than calling the link wrong', async () => {
    const { slug, key } = newShare()
    const root = document.createElement('main')
    const fetch = (async () => new Response(JSON.stringify({ expiresAt: 1, notesOn: false }), { status: 200 })) as typeof window.fetch
    await openDraft(root, new URL(`https://nib.test/d/${slug}#${key}`), fetch)
    expect(root.textContent).toBe('This draft can’t be shown. Ask the writer to share it again.')
  })
})

