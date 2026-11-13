import { describe, expect, it } from 'vitest'
import { FEEDBACK_MAX, FEEDBACK_MIN } from '../src/lib/reported'
import { alertPhone, Feedback, feedbackRequests, handleFeedback, INBOX_URL, MOST_KEPT, PER_NETWORK } from './feedback'
import type { QuotaRequests } from './quota'
import { sqlite } from './testing'

const WORDS = 'A word count per chapter, please. '.repeat(6).trim()
const SECOND = 'And a second thought. '.repeat(10).trim()
const BODY = { text: `  ${WORDS}  `, device: 'ipad', version: '1.10.10' }
const KEY = 'the-owner-s-key'
const NOW = Date.UTC(2026, 10, 9, 15, 30)
const ORIGIN = 'https://sync.nibprivacy.com'

type Row = { id: number; day: string; device: string; version: string; text: string }

function server({ fails = false, key = KEY as string | undefined } = {}) {
  const feedback = new Feedback(sqlite())
  const requests = feedbackRequests(feedback)
  const inbox = fails ? { ...requests, add: async () => Promise.reject(new Error('no')) } : requests
  const used = new Map<string, number>()
  const names: string[] = []
  let alerts = 0
  const quota = (name: string): QuotaRequests => ({
    used: async () => ({ status: 200, body: { used: used.get(name) ?? 0 } }),
    spend: async (limit, refusal) => {
      names.push(name)
      const n = used.get(name) ?? 0
      if (n >= limit) return { status: 429, body: { error: refusal } }
      used.set(name, n + 1)
      return { status: 200, body: {} }
    },
    refund: async () => {
      names.push(name)
      used.set(name, (used.get(name) ?? 0) - 1)
      return { status: 200, body: {} }
    },
  })
  const deps = { inbox, alert: () => void alerts++, quota, secret: 'the-secret', key, now: () => NOW }
  const post = (body: unknown, ip = '198.51.100.7') =>
    handleFeedback(new Request(`${ORIGIN}/v1/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(body) }), deps)
  const owner = (method: string, path: string, given: string | null = KEY) => handleFeedback(new Request(`${ORIGIN}${path}`, { method, headers: given === null ? {} : { Authorization: `Bearer ${given}` } }), deps)
  const read = async () => ((await (await owner('GET', '/v1/feedback/messages')).json()) as { messages: Row[] }).messages
  return { post, owner, read, feedback, deps, used, names, alerts: () => alerts }
}

describe('a feedback message', () => {
  it('is kept with the device, the version and the day, and nothing of who sent it', async () => {
    const { post, read, names } = server()
    expect((await post(BODY)).status).toBe(200)
    const messages = await read()
    expect(messages).toEqual([{ id: 1, day: '2026-11-09', device: 'ipad', version: '1.10.10', text: WORDS }])
    expect(JSON.stringify(messages) + names.join()).not.toContain('198.51.100.7')
  })

  it('sets off one alert, once it is safely kept', async () => {
    const { post, alerts } = server()
    await post(BODY)
    expect(alerts()).toBe(1)
  })

  it('takes only a known device and a real version', async () => {
    const { post, read } = server()
    expect((await post({ ...BODY, version: '1.0<script>' })).status).toBe(400)
    expect((await post({ ...BODY, device: 'pager' })).status).toBe(400)
    expect(await read()).toEqual([])
  })

  it('has to say something and not too much', async () => {
    const { post, read } = server()
    expect((await post({ ...BODY, text: '   hi   ' })).status).toBe(400)
    expect((await post({ ...BODY, text: 'x'.repeat(FEEDBACK_MIN - 1) })).status).toBe(400)
    expect((await post({ ...BODY, text: 'x'.repeat(FEEDBACK_MAX + 1) })).status).toBe(400)
    expect((await post({ ...BODY, text: 12345678901 })).status).toBe(400)
    expect(await read()).toEqual([])
  })

  it('is refused past a network’s limit for the day, with no alert', async () => {
    const { post, read, alerts } = server()
    for (let i = 0; i < PER_NETWORK; i++) expect((await post(BODY)).status).toBe(200)
    expect((await post(BODY)).status).toBe(429)
    expect(await read()).toHaveLength(PER_NETWORK)
    expect(alerts()).toBe(PER_NETWORK)
  })

  it('that could not be kept says so, sets off no alert, and does not count against the limit', async () => {
    const { post, used, alerts } = server({ fails: true })
    expect((await post(BODY)).status).toBe(502)
    expect(alerts()).toBe(0)
    expect([...used.values()].every((n) => n === 0)).toBe(true)
  })

  // Kept until deleted, so a flood can't grow without end.
  it('is refused once as many as the inbox holds are waiting, and goes in again when one is deleted', async () => {
    const { post, owner, feedback, used, alerts } = server()
    for (let i = 0; i < MOST_KEPT; i++) feedback.add('a message', 'mac', '1.10.10', '2026-11-09')
    expect((await post(BODY)).status).toBe(503)
    expect(alerts()).toBe(0)
    expect([...used.values()].every((n) => n === 0)).toBe(true)
    await owner('DELETE', '/v1/feedback/messages/1')
    expect((await post(BODY)).status).toBe(200)
  })

  it('cannot be sent from a page on another site, which can only post text/plain unasked', async () => {
    const { deps, read } = server()
    const response = await handleFeedback(new Request(`${ORIGIN}/v1/feedback`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' }, body: JSON.stringify(BODY) }), deps)
    expect(response.status).toBe(415)
    expect(await read()).toEqual([])
  })
})

describe('the alert', () => {
  const CIPHER = '0123456789abcdef0123456789abcdef'
  const encoder = new TextEncoder()

  async function sent(respond: () => Promise<Response>, cipher = CIPHER) {
    const calls: { url: string; init: RequestInit }[] = []
    await alertPhone({ device: 'the-device', cipher }, async (url, init) => {
      calls.push({ url: String(url), init: init! })
      return respond()
    })
    return calls
  }
  const ok = async () => new Response('{"code":200}')
  const fields = (call: { init: RequestInit }) => JSON.parse(String(call.init.body)) as { device_key: string; ciphertext: string; iv: string }

  /** As the Bark app opens one: the key's and iv's own characters as bytes, and the tag after the text. */
  async function opened(call: { init: RequestInit }, cipher = CIPHER) {
    const { ciphertext, iv } = fields(call)
    const key = await crypto.subtle.importKey('raw', encoder.encode(cipher), 'AES-GCM', false, ['decrypt'])
    const bytes = Uint8Array.from(atob(ciphertext), (char) => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: encoder.encode(iv) }, key, bytes)))
  }

  it('goes to Bark sealed, with the key, the iv and the sealed text and nothing else', async () => {
    const [call] = await sent(ok)
    expect(call.url).toBe('https://api.day.app/push')
    expect(call.init.method).toBe('POST')
    expect(Object.keys(fields(call)).sort()).toEqual(['ciphertext', 'device_key', 'iv'])
    expect(fields(call).device_key).toBe('the-device')
    expect(String(call.init.body)).not.toMatch(/waiting|Nib feedback|inbox/)
  })

  it('opens, for the Bark app, to one fixed sentence and the link to the private page', async () => {
    expect(await opened((await sent(ok))[0])).toEqual({ title: 'Nib feedback', body: 'A new message is waiting.', url: INBOX_URL })
  })

  it('can’t be opened with another key', async () => {
    await expect(opened((await sent(ok))[0], 'ffffffffffffffffffffffffffffffff')).rejects.toThrow()
  })

  // The app takes the iv's characters as its bytes, and wants exactly 12 for GCM.
  it('has a new iv of 12 characters each time, so no two look alike', async () => {
    const [[one], [two]] = await Promise.all([sent(ok), sent(ok)])
    expect(fields(one).iv).toMatch(/^[\w-]{12}$/)
    expect(fields(one).iv).not.toBe(fields(two).iv)
    expect(fields(one).ciphertext).not.toBe(fields(two).ciphertext)
  })

  it('takes nothing but the keys, so no words can be handed to it', () => {
    expect(alertPhone.length).toBe(1)
  })

  it.each([
    ['refused', async () => new Response('{"code":400}', { status: 400 })],
    ['unreachable', async () => Promise.reject(new TypeError('network'))],
  ])('fails quietly when the service is %s: the message is already kept', async (_, respond) => {
    await expect(sent(respond)).resolves.toHaveLength(1)
  })

  it('fails quietly, sending nothing, with a key of the wrong length', async () => {
    await expect(sent(ok, 'too short')).resolves.toHaveLength(0)
  })
})

describe('reading them', () => {
  it.each([
    ['no key', null],
    ['the wrong key', 'guess'],
  ])('is not found with %s', async (_, given) => {
    const { post, owner, read } = server()
    await post(BODY)
    const list = await owner('GET', '/v1/feedback/messages', given)
    expect(list.status).toBe(404)
    expect(await list.text()).not.toContain('word count')
    expect((await owner('DELETE', '/v1/feedback/messages/1', given)).status).toBe(404)
    expect(await read()).toHaveLength(1)
  })

  it('is not found for anyone while the Worker has no key', async () => {
    const { owner } = server({ key: undefined })
    expect((await owner('GET', '/v1/feedback/messages', 'undefined')).status).toBe(404)
  })

  it('lists the newest first', async () => {
    const { post, read } = server()
    await post(BODY)
    await post({ ...BODY, text: SECOND })
    expect((await read()).map((message) => message.text)).toEqual([SECOND, WORDS])
  })

  it('deletes the one asked for and no other', async () => {
    const { post, owner, read } = server()
    await post(BODY)
    await post({ ...BODY, text: SECOND })
    expect((await owner('DELETE', '/v1/feedback/messages/1')).status).toBe(204)
    expect((await read()).map((message) => message.id)).toEqual([2])
  })

  it.each(['/v1/feedback/messages/abc', '/v1/feedback/messages/1/2', '/v1/feedback/messages/0', '/v1/feedback/messages/-1', '/v1/feedback/messages/'])('deletes nothing for %s', async (path) => {
    const { post, owner, read } = server()
    await post(BODY)
    expect((await owner('DELETE', path)).status).toBe(404)
    expect(await read()).toHaveLength(1)
  })
})

describe('the private page', () => {
  const page = async (ask = server()) => ask.owner('GET', '/v1/feedback/inbox', null)

  it('opens without a key and holds no message', async () => {
    const ask = server()
    await ask.post(BODY)
    const response = await page(ask)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(await response.text()).not.toContain('word count')
  })

  // What's shown was written by anyone at all.
  it('can run only its own script, and puts a message on the page only as text', async () => {
    const response = await page()
    const csp = response.headers.get('Content-Security-Policy')!
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)![1]
    const html = await response.text()
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(html).toContain(`<script nonce="${nonce}">`)
    expect(html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
    expect(html).toContain('.textContent = message.text')
  })

  it('has a new nonce each time, is never stored, and is left out of search', async () => {
    const [one, two] = await Promise.all([page(), page()])
    expect(one.headers.get('Content-Security-Policy')).not.toBe(two.headers.get('Content-Security-Policy'))
    expect(one.headers.get('Cache-Control')).toBe('no-store')
    expect(one.headers.get('X-Robots-Tag')).toBe('noindex')
    expect(one.headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  it('is not found under any other path or method', async () => {
    const { owner } = server()
    expect((await owner('POST', '/v1/feedback/inbox')).status).toBe(404)
    expect((await owner('GET', '/v1/feedback/other')).status).toBe(404)
    expect((await owner('GET', '/v1/feedback')).status).toBe(404)
  })
})
