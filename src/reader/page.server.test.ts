// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { frontDoor, type Routes } from '../../worker/door'
import type { Claims } from '../../worker/jws'
import { FreeQuota, quotaRequests } from '../../worker/quota'
import { REVEALED_KEPT_MS, Share, shareRequests } from '../../worker/share'
import { handleShares, type ShareDeps } from '../../worker/shares'
import { Subscriber, subscriberRequests } from '../../worker/subscriber'
import { sqlite } from '../../worker/testing'
import { newShare, revealCheck, revealToken, seal, withPassword } from '../share/crypto'
import { openDraft } from './page'

/**
 * A draft to be read once, on the reader's own page against the share routes themselves (worker/shares), with
 * real Share, Subscriber and quota objects. Each side was tried only against a stand-in for the other, and in the
 * ten minutes a draft is held after it's handed over (worker/share `REVEALED_KEPT_MS`) they disagreed: the server
 * said "gone" to a token that wasn't the draft's, which the page took for "already read" (found checking the fix
 * of the server audit of 2026-11-23).
 */
const DAY = 86_400_000
const PASSWORD = 'harbour lights'
const body = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'The Lighthouse Keeper' }] }] }

function server() {
  const clock = { now: Date.UTC(2027, 0, 1) }
  const shares = new Map<string, Share>()
  const subscribers = new Map<string, Subscriber>()
  const quotas = new Map<string, FreeQuota>()
  const subscriber: ShareDeps['subscriber'] = (key) => subscriberRequests(subscribers.get(key) ?? subscribers.set(key, new Subscriber(sqlite())).get(key)!, () => clock.now)
  const deps: ShareDeps = {
    share: (slug) => shareRequests(shares.get(slug) ?? shares.set(slug, new Share(sqlite())).get(slug)!, { subscriber, alarm: async () => {} }, () => clock.now),
    subscriber,
    quota: (key) => quotaRequests(quotas.get(key) ?? quotas.set(key, new FreeQuota(sqlite())).get(key)!, { alarm: async () => {} }, () => clock.now),
    secret: 'the-secret',
    verify: async (): Promise<Claims> => ({ productId: 'p', originalTransactionId: 'subscription-1', expiresAt: clock.now + 30 * DAY, purchasedAt: Date.UTC(2026, 11, 1), environment: 'Production' }),
    off: false,
    blocked: [],
    now: () => clock.now,
  }
  const ask = (path: string, init: RequestInit = {}) =>
    frontDoor(new Request(`https://nib.test${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.20', ...(init.headers as Record<string, string>) } }), { shares: (asked) => handleShares(asked, deps) } as Routes)
  return { clock, ask }
}

/** One made as the app makes it (src/share `createShare`). `older`: its token from the link's key alone, as Nib 1.10.11 made one with a password. */
async function draft(world: ReturnType<typeof server>, { older = false } = {}) {
  const secrets = newShare()
  const key = await withPassword(secrets.key, secrets.slug, PASSWORD)
  const doc = await seal(key, secrets.slug, 'doc', { v: 1, kind: 'page', body })
  const reveal = await revealCheck(await revealToken(older ? secrets.key : key, secrets.slug))
  const made = await world.ask('/v1/shares', { method: 'POST', headers: { Authorization: `Owner ${secrets.owner}` }, body: JSON.stringify({ slug: secrets.slug, jws: 'a receipt', days: 30, doc, once: true, reveal }) })
  expect(made.status).toBe(201)
  return new URL(`https://nib.test/d/${secrets.slug}#${secrets.key}.p`)
}

/** The page, its fetch the routes'. `lose`: how many of the answers that hand the draft over are lost on the way back. */
function reader(world: ReturnType<typeof server>, link: URL, lose = 0) {
  const fetch = (async (url: string, init?: RequestInit) => {
    const response = await world.ask(url, { method: init?.method ?? 'GET', body: init?.body, headers: { 'Sec-Fetch-Site': 'same-origin' } })
    if (url.endsWith('/reveal') && response.status === 200 && lose-- > 0) throw new TypeError('Load failed')
    return response
  }) as typeof window.fetch
  const root = document.createElement('main')
  const opening = openDraft(root, link, fetch)
  const tries = async (password: string) => {
    await expect.poll(() => [...root.querySelectorAll('button')].some((one) => one.textContent === 'Open it now' && !one.disabled), { timeout: 30_000 }).toBe(true)
    root.querySelector<HTMLInputElement>('input[type=password]')!.value = password
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  }
  const says = (words: string) => expect.poll(() => root.textContent ?? '', { timeout: 30_000 }).toContain(words)
  const opened = async () => {
    await opening
    return root.querySelector('article h1')?.textContent
  }
  return { root, tries, says, opened }
}

const LOST = 'Couldn’t reach Nib. Check your connection and try again.'
const WRONG = 'That password doesn’t open it. Check it with the writer.'
const READ = 'This draft could be read once, and it already has been.'

describe('a draft to be read once, on the reader’s page against the server', () => {
  it('opens for the reader who tries again when its answer was lost on the way', async () => {
    const world = server()
    const page = reader(world, await draft(world), 1)
    await page.tries(PASSWORD)
    await page.says(LOST)
    await page.tries(PASSWORD)
    expect(await page.opened()).toBe('The Lighthouse Keeper')
  }, 60_000)

  it('says a mistyped password is wrong while it’s held, not that the draft has been read, and still opens', async () => {
    const world = server()
    const page = reader(world, await draft(world), 1)
    await page.tries(PASSWORD)
    await page.says(LOST)
    await page.tries('harbor lights')
    await page.says(WRONG)
    expect(page.root.textContent).not.toContain(READ)
    await page.tries(PASSWORD)
    expect(await page.opened()).toBe('The Lighthouse Keeper')
  }, 60_000)

  it('opens one made by an older Nib for the reader who tries again', async () => {
    const world = server()
    const page = reader(world, await draft(world, { older: true }), 1)
    await page.tries(PASSWORD)
    await page.says(LOST)
    await page.tries(PASSWORD)
    expect(await page.opened()).toBe('The Lighthouse Keeper')
  }, 60_000)

  it('says it has been read to whoever comes once it’s no longer held', async () => {
    const world = server()
    const link = await draft(world)
    const first = reader(world, link)
    await first.tries(PASSWORD)
    expect(await first.opened()).toBe('The Lighthouse Keeper')
    world.clock.now += REVEALED_KEPT_MS
    await reader(world, link).says(READ)
  }, 60_000)
})
