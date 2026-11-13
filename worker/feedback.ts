import { DEVICES, FEEDBACK_MAX, FEEDBACK_MIN, VERSION, type Device } from '../src/lib/reported'
import { ok, type Call } from './answer'
import { base64, base64url } from './base64'
import { INBOX_PAGE } from './feedback-page'
import { isAdmin, isJson, json, networksOf, readJson } from './http'
import type { Sql } from './library'
import { EVERYONE, spendEach, type QuotaRequests } from './quota'
import { utcDay } from './wire.mjs'

/**
 * A message from Settings → Send feedback, kept here until its reader deletes
 * it, with which kind of device, which version and the day, and nothing about
 * who sent it. The owner's phone is told that one has come, in words that are
 * always the same (`alertPhone`), and they're read on a private page
 * (feedback-page), which holds nothing until it's given FEEDBACK_KEY.
 */

const INBOX_PATH = '/v1/feedback/inbox'
const MESSAGES_PATH = '/v1/feedback/messages'
export const INBOX_URL = `https://sync.nibprivacy.com${INBOX_PATH}`
const BARK = 'https://api.day.app/push'

/** Enough for a household or a café, and not enough to fill the inbox. */
export const PER_NETWORK = 5
export const PER_WIDE = 30
export const PER_DAY = 200
const QUOTA_EVERYONE = `feedback ${EVERYONE}`
/** Waiting to be read. What's kept is kept until it's deleted, so a flood can't go on growing, and the whole list still fits in one answer. */
export const MOST_KEPT = 1000

export class Feedback {
  private sql: Sql

  constructor(sql: Sql) {
    this.sql = sql
    sql.run('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, device TEXT NOT NULL, version TEXT NOT NULL, text TEXT NOT NULL)')
  }

  /** False, and nothing kept, once MOST_KEPT are waiting. */
  add(text: string, device: Device, version: string, day: string): boolean {
    if (Number(this.sql.all('SELECT COUNT(*) AS n FROM messages')[0].n) >= MOST_KEPT) return false
    this.sql.run('INSERT INTO messages (day, device, version, text) VALUES (?, ?, ?, ?)', day, device, version, text)
    return true
  }

  list() {
    return this.sql.all('SELECT id, day, device, version, text FROM messages ORDER BY id DESC')
  }

  remove(id: number) {
    this.sql.run('DELETE FROM messages WHERE id = ?', id)
  }
}

/** The messages' requests, for their Durable Object. */
export function feedbackRequests(feedback: Feedback) {
  return {
    add: async (text: string, device: Device, version: string, day: string): Promise<Call> => (feedback.add(text, device, version, day) ? ok({}) : { status: 503, body: { error: 'Not taking messages just now.' } }),
    list: async (): Promise<Call> => ok({ messages: feedback.list() }),
    remove: async (id: number): Promise<Call> => {
      feedback.remove(id)
      return ok({})
    },
  }
}

type FeedbackRequests = ReturnType<typeof feedbackRequests>

/**
 * Tells the owner's phone that a message has come, through Bark's public
 * server (ntfy.sh can't be reached from Cloudflare's network: 522). Sealed with
 * AES-256-GCM under a key only this Worker and the owner's Bark app hold, as
 * Bark's own script does it: the tag after the text, a new 12-character iv each
 * time, so Bark's server and Apple's see neither what it says nor that two are
 * alike. It's given only the keys, so none of the writer's words can reach it.
 * What's sent is already kept, so a failure here costs an alert and no message.
 */
export async function alertPhone(keys: { device: string; cipher: string }, send: typeof fetch = fetch) {
  try {
    const encoder = new TextEncoder()
    const iv = base64url(crypto.getRandomValues(new Uint8Array(9)))
    const key = await crypto.subtle.importKey('raw', encoder.encode(keys.cipher), 'AES-GCM', false, ['encrypt'])
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: encoder.encode(iv) }, key, encoder.encode(JSON.stringify({ title: 'Nib feedback', body: 'A new message is waiting.', url: INBOX_URL })))
    const response = await send(BARK, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ device_key: keys.device, ciphertext: base64(new Uint8Array(sealed)), iv }) })
    if (!response.ok) console.error('Nib: the feedback alert was refused', response.status)
  } catch (error) {
    console.error('Nib: the feedback alert could not be sent', error instanceof Error ? error.name : 'unknown')
  }
}

type Deps = {
  inbox: FeedbackRequests
  /** Off until the Worker has both Bark keys (FEEDBACK_BARK_DEVICE and _CIPHER). Not waited for. */
  alert?: () => void
  quota(key: string): QuotaRequests
  /** COINS_ADMIN: keys the names of the quotas. */
  secret?: string
  /** FEEDBACK_KEY: opens the messages. Without one set, nothing does. */
  key?: string
  now(): number
}

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Robots-Tag': 'noindex',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
}

/** The page, whose one script and one style block are all that may run: what it shows was written by anyone at all. */
function inboxPage(): Response {
  const nonce = crypto.randomUUID()
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  return new Response(INBOX_PAGE.replaceAll('{{NONCE}}', nonce), { headers: { ...PAGE_HEADERS, 'Content-Security-Policy': policy } })
}

async function handleMessages(request: Request, path: string, deps: Deps): Promise<Response> {
  const notFound = () => json(request, 404, { error: 'Not found.' })
  if (!(await isAdmin(request, deps.key))) return notFound()
  if (path === MESSAGES_PATH && request.method === 'GET') {
    const read = await deps.inbox.list()
    return json(request, read.status, read.body)
  }
  const id = /^\/([1-9]\d{0,15})$/.exec(path.slice(MESSAGES_PATH.length))?.[1]
  if (!id || request.method !== 'DELETE') return notFound()
  await deps.inbox.remove(Number(id))
  return new Response(null, { status: 204 })
}

/** A request for the feedback routes, answered. */
export async function handleFeedback(request: Request, deps: Deps): Promise<Response> {
  const path = new URL(request.url).pathname
  if (path === INBOX_PATH && request.method === 'GET') return inboxPage()
  if (path === MESSAGES_PATH || path.startsWith(`${MESSAGES_PATH}/`)) return handleMessages(request, path, deps)
  if (path !== '/v1/feedback' || request.method !== 'POST') return json(request, 404, { error: 'Not found.' })
  if (!isJson(request)) return json(request, 415, { error: 'JSON, please.' })
  const body = await readJson(request, FEEDBACK_MAX * 4 + 500)
  const { text, device, version } = body ?? {}
  const message = typeof text === 'string' ? text.trim() : ''
  if ([...message].length < FEEDBACK_MIN || [...message].length > FEEDBACK_MAX || !DEVICES.includes(device as Device) || typeof version !== 'string' || !VERSION.test(version)) {
    return json(request, 400, { error: 'A message, a device and a version, please.' })
  }
  const [here, around] = await networksOf(request, deps.secret, 'nib-quota', (network) => `feedback ${network}`)
  const tooMany = 'Too many messages today. Please try again tomorrow.'
  const spent = await spendEach([
    [deps.quota(here), PER_NETWORK, tooMany],
    [deps.quota(around), PER_WIDE, tooMany],
    [deps.quota(QUOTA_EVERYONE), PER_DAY, tooMany],
  ])
  if ('refused' in spent) return json(request, spent.refused.status, spent.refused.body)
  let kept: Call
  try {
    kept = await deps.inbox.add(message, device as Device, version, utcDay(deps.now()))
  } catch (error) {
    console.error('Nib: a feedback message could not be kept', error instanceof Error ? error.name : 'unknown')
    kept = { status: 502, body: { error: 'Could not keep it.' } }
  }
  if (kept.status !== 200) {
    await spent.refund()
    return json(request, kept.status, kept.body)
  }
  deps.alert?.()
  return json(request, 200, { ok: true })
}
