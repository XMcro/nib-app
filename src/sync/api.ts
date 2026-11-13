import { base64url } from '../../worker/base64'
import { bodyHash, signedMessage } from '../../worker/signing'
import { FILE_HASH_HEADER, UNENROLLED, type FileList, type Inbox, type PushResult, type Status, type Wire } from '../../worker/wire.mjs'
import { readJson, writeJson } from '../lib/jsonStorage'
import type { SyncKeys } from './crypto'

export type { PushResult, Wire }

export type Api = {
  /** A new library under these keys. Only this creates one. */
  create(jws: string): Promise<Status>
  entitle(jws: string): Promise<Status>
  status(): Promise<Status>
  /** `inbox`: how many posts wait in the library's inbox, said only when some do (sync/inbox). */
  changes(since: number): Promise<{ records: Wire[]; seq: number; more: boolean; inbox?: number }>
  push(records: Wire[]): Promise<{ results: PushResult[] }>
  /** Lets go of versions past the history the server keeps (engine expireHistory). Returns the keys it did. */
  expire(keys: string[]): Promise<{ expired: string[] }>
  wipe(): Promise<void>
  /** Signed requests only, or not, for the library (worker/library requireSigned). Signed itself. */
  requireSigned(on: boolean): Promise<Status>
  /** Which files the server has, by their keys, and the room they take of what they may. */
  files(): Promise<FileList>
  /** A file, sealed (sync/files), kept on the server under `key` (worker/files). */
  putFile(key: string, sealed: Uint8Array<ArrayBuffer>): Promise<void>
  /** As it was sent; null if the server has none under `key`. */
  getFile(key: string): Promise<Uint8Array<ArrayBuffer> | null>
  deleteFile(key: string): Promise<void>
  /** The library's inbox (worker/inbox): whether it has one, what its devices keep with it, and the posts waiting. */
  inbox(): Promise<Inbox>
  /** An inbox, or a new address for it: its public key, the hash of the secret in its address, and what the devices keep with it, sealed. */
  setInbox(key: string, address: string, kept: string): Promise<void>
  endInbox(): Promise<void>
  /** Posts this device has made notes of: deleted from the server. */
  tookPosts(ids: number[]): Promise<void>
}

export class SyncHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const encoder = new TextEncoder()

/** Whether this device has a key on this library, by a library's id: told so by the server, or by its signed requests being taken. */
const enrolledKey = (libraryId: string) => `nib-sync-enrolled-${libraryId}`

/**
 * Signed where this device can sign (keys.sign): nothing in a request is the
 * secret, which one caught in passing could be sent again with. The server
 * is given the key's public half the first time it asks for it, and only
 * then: once this device has a key there, the server has no reason to ask, and
 * a reply that does is someone on the way after the secret, which isn't sent.
 * A device that can't sign sends the secret in each request, the old way.
 */
export function httpApi(base: string, keys: SyncKeys): Api {
  /**
   * `enrol`: the old way, signed too, to prove this device holds the key it
   * gives. A body of bytes is a file (worker/files): sent as it is, with its
   * hash in a header, which is what a signed request signs of it either way.
   * An answer that is a file is left unread, for whoever asked to take.
   */
  async function send(method: string, path: string, body: unknown, how: 'signed' | 'bearer' | 'enrol') {
    const file = body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : undefined
    const text = body === undefined || file ? undefined : JSON.stringify(body)
    const hash = await bodyHash(file ?? encoder.encode(text ?? ''))
    const headers: Record<string, string> = {
      Authorization: how === 'signed' ? `Signed ${keys.libraryId}` : `Bearer ${keys.libraryId}.${keys.secret}`,
      ...(text === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(file ? { 'Content-Type': 'application/octet-stream', [FILE_HASH_HEADER]: hash } : {}),
    }
    if (how !== 'bearer') {
      const time = Date.now()
      const message = signedMessage({ id: keys.libraryId, method, path, time, bodyHash: hash })
      headers['X-Nib-Time'] = String(time)
      headers['X-Nib-Signature'] = base64url(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, keys.sign!.key, encoder.encode(message))))
    }
    const response = await fetch(`${base}${path}`, { method, headers, body: file ?? text })
    const answersFile = response.ok && response.headers.get('Content-Type') === 'application/octet-stream'
    return { response, json: (answersFile ? {} : await response.json().catch(() => ({}))) as { error?: string; code?: string } }
  }

  function answer<T>({ response, json }: Awaited<ReturnType<typeof send>>): T {
    if (!response.ok) throw new SyncHttpError(response.status, json.error ?? `Sync failed (${response.status}).`)
    return json as T
  }

  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => answer<T>(await sending(method, path, body))

  /** A request by whichever way this device has, its key given to the server first if that's what it asks for. */
  async function sending(method: string, path: string, body?: unknown) {
    if (!keys.sign) return send(method, path, body, 'bearer')
    const hasKey = enrolledKey(keys.libraryId)
    let sent = await send(method, path, body, 'signed')
    if (sent.response.status === 401 && sent.json.code === UNENROLLED && !readJson(hasKey, false)) {
      const enrolled = await send('POST', '/v1/key', { key: keys.sign.publicKey }, 'enrol')
      if (enrolled.response.ok) writeJson(hasKey, true)
      sent = enrolled.response.ok ? await send(method, path, body, 'signed') : enrolled
    }
    if (sent.response.ok) writeJson(hasKey, true)
    return sent
  }

  /** Forgotten with the library it was for: one made again under this code needs its first key. */
  const noKey = <T>(done: T) => {
    writeJson(enrolledKey(keys.libraryId), false)
    return done
  }
  return {
    // The old way: a library just made has no key for signed requests yet.
    create: async (jws) => noKey(answer<Status>(await send('POST', '/v1/library', { jws }, 'bearer'))),
    entitle: (jws) => call('POST', '/v1/entitlement', { jws }),
    status: () => call('GET', '/v1/status'),
    changes: (since) => call('GET', `/v1/changes?since=${since}`),
    push: (records) => call('POST', '/v1/changes', { records }),
    expire: (keys) => call('POST', '/v1/expire', { keys }),
    wipe: async () => noKey(await call('DELETE', '/v1/library')),
    requireSigned: async (on) => {
      if (!keys.sign) throw new SyncHttpError(400, 'This device can’t sign its requests: it needs iOS 17 or macOS 14 or later.')
      return call('POST', '/v1/signed-only', { on })
    },
    files: () => call('GET', '/v1/files'),
    putFile: (key, sealed) => call('PUT', `/v1/files/${key}`, sealed),
    getFile: async (key) => {
      const sent = await sending('GET', `/v1/files/${key}`)
      if (sent.response.status === 404) return null
      answer(sent)
      return new Uint8Array(await sent.response.arrayBuffer())
    },
    deleteFile: (key) => call('DELETE', `/v1/files/${key}`),
    inbox: () => call('GET', '/v1/inbox'),
    setInbox: (key, address, kept) => call('PUT', '/v1/inbox', { key, address, kept }),
    endInbox: () => call('DELETE', '/v1/inbox'),
    tookPosts: (ids) => call('POST', '/v1/inbox/taken', { ids }),
  }
}
