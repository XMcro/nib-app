import { MAX_NOTE_BYTES, READ_ONCE_GONE } from '../../worker/wire.mjs'
import { NOTE_LIMITS, open, PASSWORD_MARK, revealToken, seal, sealedBytes, validKey, validSlug, withPassword } from '../share/crypto'
import { renderDocument } from './render'

/**
 * The page at /d/<slug>#<key>: a draft someone shared from Nib. The key is in
 * the fragment, which the browser never sends, so the server hands over only
 * ciphertext and this page opens it. Readers can leave the writer a note on
 * what they've selected; it's sealed with the same key before it's sent, and
 * only the writer ever sees it.
 *
 * A draft to be read once (worker/share) isn't fetched by opening the page,
 * which a chat app's preview of the link does too: the page says what will
 * happen and waits for "Open it now". That one request is what hands it over
 * and deletes it from the server.
 *
 * What the writer learns of a reader is said on the page: that one to be read
 * once was read, and of a draft whose openings are counted (`counted`), how
 * many times its link has been opened.
 */

/** What a reader is told of a draft whose openings are counted (worker/share): under the draft, and where its password is asked for, since the asking was counted. */
const COUNTED = 'The writer can see how many times this link has been opened, and nothing about who opened it.'

/** What the page says of one that has been read already. */
const ALREADY_READ = 'This draft could be read once, and it already has been.'

const REPORT_TO = 'support@nibprivacy.com'
/** Where a reader who likes what they see can get Nib. */
const APP_STORE = 'https://apps.apple.com/app/nib-private-notes/id6815422995'

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

/** Opens the draft at `link` into `root`. `fetch` is the page's own, except in tests. */
export async function openDraft(root: HTMLElement, link: URL, fetch: typeof window.fetch = window.fetch.bind(window)) {
  const say = (message: string) => root.replaceChildren(element('p', 'status', message))
  const slug = link.pathname.split('/')[2] ?? ''
  const fragment = link.hash.slice(1)
  // `#<key>.p`: the draft also needs a password, which the writer gives separately.
  const needsPassword = fragment.endsWith(PASSWORD_MARK)
  const key = needsPassword ? fragment.slice(0, -PASSWORD_MARK.length) : fragment
  if (!validSlug(slug) || !validKey(key)) return say('This link is incomplete. Ask for it again, and copy all of it.')

  let response: Response
  try {
    response = await fetch(`/v1/shares/${slug}`, { cache: 'no-store' })
  } catch {
    return say('Couldn’t reach Nib. Check your connection, then reload.')
  }
  if (response.status === 404) return say('Nothing is shared at this link. The writer may have stopped sharing it.')
  if (response.status === 410) return say((await readOnceGone(response)) ? ALREADY_READ : 'This draft is no longer shared.')
  if (response.status === 503) return say('Shared drafts are unavailable just now. Try again later.')
  if (!response.ok) return say('Something went wrong opening this draft. Try reloading.')
  let shared = (await response.json()) as { doc?: string; once?: boolean; counted?: boolean; expiresAt: number; notesOn: boolean }
  const once = shared.once === true
  const counted = shared.counted === true
  // The key the password typed for one to be read once makes, if one was.
  let tried: string | undefined
  if (once) {
    const revealed = await reveal(root, slug, key, needsPassword, fetch)
    if (!revealed) return say(ALREADY_READ)
    shared = revealed
    tried = revealed.sealKey
  }
  if (typeof shared.doc !== 'string') return say('This draft can’t be shown. Ask the writer to share it again.')

  let draft: { kind?: unknown; body?: unknown }
  let sealKey = key
  // Handed over for that password's token, it opens with it; an older one, handed over for the link's, may not.
  const opened = tried ? await open(tried, slug, 'doc', shared.doc).catch(() => undefined) : undefined
  if (opened !== undefined) {
    draft = opened as typeof draft
    sealKey = tried!
  } else if (needsPassword) {
    ;({ draft, sealKey } = await unlock(root, slug, key, shared.doc, once ? ' It’s deleted from Nib’s server now: keep this page open until you’ve read it.' : counted ? ` ${COUNTED}` : ''))
  } else {
    try {
      draft = (await open(key, slug, 'doc', shared.doc)) as typeof draft
    } catch {
      return say('This link’s key doesn’t open the draft. Ask for the link again, and copy all of it.')
    }
  }

  // Opened, but to something that isn't a draft: it threw here, and the page
  // stayed on "Opening the draft…".
  if (typeof draft !== 'object' || draft === null) return say('This draft can’t be shown. Ask the writer to share it again.')
  const article = element('article', draft.kind === 'note' ? 'draft note' : 'draft page')
  renderDocument(draft.body, article)
  document.title = article.querySelector('h1, h2, h3, h4, h5, h6, p')?.textContent?.trim().slice(0, 80) || 'A shared draft'

  const until = new Date(shared.expiresAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
  const header = element('header', 'meta', once ? 'A draft shared from Nib, to be read once. It’s now deleted from Nib’s server: this page is the only copy, until you close it.' : `A draft shared from Nib, until ${until}`)
  root.replaceChildren(header, article, ...(shared.notesOn ? notes(article, slug, sealKey, fetch) : []), footer(link, counted))
}

type Revealed = { doc?: string; expiresAt: number; notesOn: boolean }

const readOnceGone = async (response: Response) => ((await response.json().catch(() => null)) as { error?: string } | null)?.error === READ_ONCE_GONE

/**
 * A draft to be read once: says so, and waits to be asked for it. Resolves
 * with the draft once the server has handed it over, which deletes it there;
 * or with null if someone read it first. A request that never got there uses
 * nothing up, and can be made again.
 *
 * One that needs a password is asked for it here, first, and for the token
 * the password makes (src/share/crypto `revealToken`): the link alone had it
 * handed over, and so deleted, with its password still to be asked for (the
 * red-team review of 2026-11-17). A wrong password uses nothing up. Resolves
 * then with `sealKey` too, the key that password makes. A draft from a Nib
 * before that kept the token of the link's key alone, which is tried second:
 * that one is handed over whatever the password, as it always was.
 */
function reveal(root: HTMLElement, slug: string, key: string, needsPassword: boolean, fetch: typeof window.fetch): Promise<(Revealed & { sealKey?: string }) | null> {
  return new Promise((resolve) => {
    const form = element('form', 'unlock')
    const label = element('p', '', `This draft can be read once. When you open it, it’s deleted from Nib’s server, and this link stops working. The writer will see that it has been read.${needsPassword ? ' It needs a password too: the writer will have given it to you with the link.' : ''}`)
    const input = element('input')
    input.type = 'password'
    input.autocomplete = 'off'
    input.required = true
    input.setAttribute('aria-label', 'Password')
    input.placeholder = 'Password'
    const message = element('p', 'hint')
    const button = element('button', '', 'Open it now')
    button.type = 'submit'
    form.append(label, ...(needsPassword ? [input] : []), message, button)
    root.replaceChildren(form)

    const ask = async (from: string) =>
      fetch(`/v1/shares/${slug}/reveal`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: await revealToken(from, slug) }) })

    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (needsPassword && !input.value) return
      button.disabled = true
      message.textContent = 'Opening…'
      try {
        // With a token from the key that opens it, which the slug alone, seen on the way, can't make (src/share/crypto `revealToken`).
        const sealKey = needsPassword ? await withPassword(key, slug, input.value) : undefined
        let response = await ask(sealKey ?? key)
        if (sealKey && response.status === 404) response = await ask(key)
        if (response.ok) return resolve({ ...((await response.json()) as Revealed), sealKey })
        if (response.status === 410 && (await readOnceGone(response))) return resolve(null)
        message.textContent =
          response.status === 503 ? 'Shared drafts are unavailable just now. Try again later.' : sealKey && response.status === 404 ? 'That password doesn’t open it. Check it with the writer.' : 'This draft is no longer shared.'
        if (sealKey) input.select()
      } catch {
        message.textContent = 'Couldn’t reach Nib. Check your connection and try again.'
      }
      button.disabled = false
    })
  })
}

/**
 * Asks for the password until it opens the draft. Each try costs half a
 * second of PBKDF2, here as for anyone guessing, and the password never leaves
 * this page. Resolves with the draft and the key its notes are sealed with.
 * `more` is said with the asking: that one to be read once is gone from the
 * server by now, since closing the page to go and ask for the password would
 * lose it, or that the link's openings are counted.
 */
function unlock(root: HTMLElement, slug: string, key: string, doc: string, more: string): Promise<{ draft: { kind?: unknown; body?: unknown }; sealKey: string }> {
  return new Promise((resolve) => {
    const form = element('form', 'unlock')
    const label = element('p', '', `This draft needs a password. The writer will have given it to you with the link.${more}`)
    const input = element('input')
    input.type = 'password'
    input.autocomplete = 'off'
    input.required = true
    input.setAttribute('aria-label', 'Password')
    input.placeholder = 'Password'
    const message = element('p', 'hint')
    const button = element('button', '', 'Open')
    button.type = 'submit'
    form.append(label, input, message, button)
    root.replaceChildren(form)
    input.focus()

    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (!input.value) return
      button.disabled = true
      message.textContent = 'Opening…'
      try {
        const sealKey = await withPassword(key, slug, input.value)
        const draft = (await open(sealKey, slug, 'doc', doc)) as { kind?: unknown; body?: unknown }
        resolve({ draft, sealKey })
      } catch {
        message.textContent = 'That password doesn’t open it. Check it with the writer.'
        input.select()
      } finally {
        button.disabled = false
      }
    })
  })
}

/** "Add a note": on what's selected, if anything, sealed before it leaves the page. */
function notes(article: HTMLElement, slug: string, key: string, fetch: typeof window.fetch): HTMLElement[] {
  let quote = ''
  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection()
    const text = selection?.toString().trim() ?? ''
    // Kept after the selection goes: tapping the button clears it on a phone.
    if (text && selection?.anchorNode && article.contains(selection.anchorNode)) quote = text.slice(0, NOTE_LIMITS.quote)
  })

  const bar = element('div', 'notebar')
  const open = element('button', '', 'Add a note')
  open.type = 'button'
  bar.append(open)

  const form = element('form', 'noteform')
  form.hidden = true
  const quoted = element('blockquote')
  const unquote = element('button', 'quiet', 'Not about this passage')
  unquote.type = 'button'
  const text = element('textarea')
  text.maxLength = NOTE_LIMITS.text
  text.required = true
  text.rows = 4
  text.setAttribute('aria-label', 'Your note')
  text.placeholder = 'Your note'
  const name = element('input')
  name.maxLength = NOTE_LIMITS.name
  name.setAttribute('aria-label', 'Your name, optional')
  name.placeholder = 'Your name (optional)'
  const message = element('p', 'hint', 'Only the writer sees notes.')
  const actions = element('div', 'actions')
  const cancel = element('button', 'quiet', 'Cancel')
  cancel.type = 'button'
  const send = element('button', '', 'Send')
  send.type = 'submit'
  actions.append(cancel, send)
  form.append(quoted, unquote, text, name, message, actions)

  let about = ''
  const showQuote = () => {
    quoted.textContent = about
    quoted.hidden = unquote.hidden = !about
  }
  open.addEventListener('click', () => {
    about = quote
    showQuote()
    message.textContent = 'Only the writer sees notes.'
    form.hidden = false
    bar.hidden = true
    text.focus()
  })
  unquote.addEventListener('click', () => {
    about = ''
    showQuote()
  })
  const close = () => {
    form.hidden = true
    bar.hidden = false
  }
  cancel.addEventListener('click', close)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const note: Record<string, string> = { text: text.value.trim() }
    if (!note.text) return
    if (about) note.quote = about
    if (name.value.trim()) note.name = name.value.trim()
    send.disabled = true
    try {
      const sealed = await seal(key, slug, 'note', note)
      if (sealedBytes(sealed) > MAX_NOTE_BYTES) {
        message.textContent = 'That note is too long. Try a shorter one.'
        return
      }
      const response = await fetch(`/v1/shares/${slug}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: sealed }),
      })
      if (response.ok) {
        text.value = ''
        close()
        open.textContent = 'Sent. Add another note'
        return
      }
      const reason = ((await response.json().catch(() => null)) as { error?: string } | null)?.error
      message.textContent = response.status === 403 ? 'The writer has turned notes off.' : (reason ?? 'Couldn’t send that. Try again.')
    } catch {
      message.textContent = 'Couldn’t send that. Check your connection and try again.'
    } finally {
      send.disabled = false
    }
  })
  return [bar, form]
}

function footer(link: URL, counted: boolean): HTMLElement {
  const foot = element('footer', 'meta')
  foot.append(element('span', '', 'Encrypted end to end: Nib’s server can’t read this draft or its notes. '))
  if (counted) foot.append(element('span', '', `${COUNTED} `))
  const report = element('a', '', 'Report this page')
  // The whole link, key and all: whoever reports it can let Nib see what they saw.
  const body = `Link: ${link.href}\n\nWhat’s wrong with it:\n`
  report.href = `mailto:${REPORT_TO}?subject=${encodeURIComponent('Report a shared draft')}&body=${encodeURIComponent(body)}`
  foot.append(report)
  const nib = element('a', '', 'Written in Nib')
  nib.href = APP_STORE
  nib.rel = 'noopener'
  foot.append(element('br'), nib)
  return foot
}

