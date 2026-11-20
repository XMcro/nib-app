// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { newShare, revealCheck, revealToken, seal, withPassword } from '../share/crypto'
import { openDraft } from './page'

/**
 * A draft to be read once that needs a password too, on the reader page: the server stood in for as worker/share
 * answers (handed over only for the token whose hash it keeps, and deleted then), the encryption real. The rest of
 * the page is in page.browser.test.ts.
 */

const body = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'The Lighthouse Keeper' }] }] }
const PASSWORD = 'harbour lights'

/** `older`: made by a Nib whose token came from the link's key alone. */
async function once({ older = false } = {}) {
  const secrets = newShare()
  const key = await withPassword(secrets.key, secrets.slug, PASSWORD)
  const doc = await seal(key, secrets.slug, 'doc', { v: 1, kind: 'page', body })
  const kept = await revealCheck(await revealToken(older ? secrets.key : key, secrets.slug))
  const reveals: string[] = []
  let read = false
  const fetch = (async (url: string, init?: RequestInit) => {
    const about = { expiresAt: new Date(2026, 10, 30, 12).getTime(), notesOn: false }
    if (read) return new Response(JSON.stringify({ error: 'This draft could be read once, and has been.' }), { status: 410 })
    if (!url.endsWith('/reveal')) return new Response(JSON.stringify({ once: true, ...about }), { status: 200 })
    const { token } = JSON.parse(String(init?.body)) as { token: string }
    reveals.push(token)
    if ((await revealCheck(token)) !== kept) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 })
    read = true
    return new Response(JSON.stringify({ doc, ...about }), { status: 200 })
  }) as typeof window.fetch
  const root = document.createElement('main')
  const opening = openDraft(root, new URL(`https://nib.test/d/${secrets.slug}#${secrets.key}.p`), fetch)
  const input = () => root.querySelector<HTMLInputElement>('input[type=password]')
  const tries = async (password: string, button: string) => {
    await expect.poll(() => [...root.querySelectorAll('button')].some((one) => one.textContent === button && !one.disabled), { timeout: 30_000 }).toBe(true)
    input()!.value = password
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  }
  const says = (words: string) => expect.poll(() => root.textContent ?? '', { timeout: 30_000 }).toContain(words)
  return { root, opening, secrets, key, reveals, tries, says, isRead: () => read, input }
}

describe('a draft to be read once, with a password', () => {
  it('asks for the password before anything is asked of the server, saying what opening it does', async () => {
    const { root, reveals, says, input } = await once()
    await says('This draft can be read once.')
    expect(root.querySelector('form p')?.textContent).toBe(
      'This draft can be read once. When you open it, it’s deleted from Nib’s server, and this link stops working. The writer will see that it has been read. It needs a password too: the writer will have given it to you with the link.',
    )
    expect(input()).not.toBeNull()
    expect(reveals).toEqual([])
  })

  it('isn’t used up by a wrong password, however often: it’s still there for the right one', async () => {
    const { root, opening, secrets, key, reveals, tries, says, isRead } = await once()
    await tries('wrong', 'Open it now')
    await says('That password doesn’t open it. Check it with the writer.')
    expect(isRead()).toBe(false)
    await tries('wrong again', 'Open it now')
    await expect.poll(() => reveals.length, { timeout: 30_000 }).toBe(4)
    expect(isRead()).toBe(false)
    await tries(PASSWORD, 'Open it now')
    await opening
    expect(root.querySelector('article h1')?.textContent).toBe('The Lighthouse Keeper')
    expect(root.querySelector('header')?.textContent).toContain('It’s now deleted from Nib’s server')
    // Handed over for the token that takes the password to make, never the link's own.
    expect(reveals.at(-1)).toBe(await revealToken(key, secrets.slug))
    expect(reveals.at(-1)).not.toBe(await revealToken(secrets.key, secrets.slug))
  })

  it('still opens one made by a Nib whose token came from the link’s key alone', async () => {
    const { root, opening, tries } = await once({ older: true })
    await tries(PASSWORD, 'Open it now')
    await opening
    expect(root.querySelector('article h1')?.textContent).toBe('The Lighthouse Keeper')
  })

  it('keeps such an older one on the page, handed over, until the right password is typed', async () => {
    const { root, opening, tries, says, isRead } = await once({ older: true })
    await tries('wrong', 'Open it now')
    await says('It’s deleted from Nib’s server now: keep this page open until you’ve read it.')
    expect(isRead()).toBe(true)
    await tries(PASSWORD, 'Open')
    await opening
    expect(root.querySelector('article h1')?.textContent).toBe('The Lighthouse Keeper')
  })
})
