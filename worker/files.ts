import type { Call } from './answer'
import { cors, json, parseJson, TooLarge } from './http'
import type { Asker, LibraryRequests } from './library'
import { FILE_HASH_HEADER, KEY_SHAPE, MAX_RECORDS, MAX_SEALED_FILE } from './wire.mjs'

/**
 * A library's files on the server (worker/sync sends these routes here, with
 * the library's credentials already read):
 *
 *   GET    /v1/files           which there are, and the room they take
 *   PUT    /v1/files/<key>     one, sealed on the device, with its length and its hash
 *   GET    /v1/files/<key>     its bytes, as they were sent
 *   DELETE /v1/files/<key>
 *   POST   /v1/files/used      { keys, done? }: the files this device's documents use, a thousand at a go
 *
 * A file is sealed before it leaves the device and named by a key the device
 * makes, so the server can't read it or tell which note it belongs to. What
 * it can see: how many a library has, how big each is, and when it came. Its
 * bytes go straight to the store and are never held whole in memory here;
 * the library's own object (worker/library) counts them, and says where in
 * the store they are.
 */

/** Where sealed files are kept: an R2 bucket (worker/index), or a Map in a test. */
export type FileStore = {
  /** Keeps `body` under `name` if it hashes to `sha256`, and says how many bytes it was. Throws if it doesn't, or can't be kept: nothing is stored then, and what was there before stays. */
  put(name: string, body: ReadableStream<Uint8Array>, sha256: string): Promise<number>
  get(name: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>
  delete(names: string[]): Promise<void>
  /** Up to a thousand of the names that begin with `prefix`, as many as one `delete` takes. */
  list(prefix: string): Promise<string[]>
}

/** Every file kept under `home`, deleted from the store. */
export async function emptyFiles(store: FileStore, home: string) {
  for (let names = await store.list(`${home}/`); names.length > 0; names = await store.list(`${home}/`)) await store.delete(names)
}

const FILE = new RegExp(`^/v1/files/(${KEY_SHAPE})$`)
const HASH = /^[0-9a-f]{64}$/
const KEY = new RegExp(`^${KEY_SHAPE}$`)

/** Whether a request sends a file, and so says its body's hash in a header (worker/sync `proof`). */
export const sendsFile = (request: Request) => request.method === 'PUT' && FILE.test(new URL(request.url).pathname)

export type FileDeps = {
  store: FileStore
  /** Asks the library, as whoever sent the request. */
  asked(ask: (stub: LibraryRequests, asker: Asker) => Promise<Call>): Promise<Call>
  /** Asks the library as the Worker itself, once the request has been let in. */
  reach(ask: (stub: LibraryRequests) => Promise<Call>): Promise<Call>
  /** The request's body, as worker/sync read it (and, of a signed request, checked it). */
  body(): Promise<Uint8Array<ArrayBuffer>>
  /** Lets work go on after the sender has gone (the Worker's `ctx.waitUntil`): storing a file and counting it. */
  waitUntil?(work: Promise<unknown>): void
}

export async function handleFiles(request: Request, { store, asked, reach, body, waitUntil }: FileDeps): Promise<Response> {
  const path = new URL(request.url).pathname
  const reply = ({ status, body }: Call) => json(request, status, body)
  if (path === '/v1/files' && request.method === 'GET') return reply(await asked((stub, asker) => stub.files(asker)))
  if (path === '/v1/files/used' && request.method === 'POST') {
    const said = parseJson(await body())
    const keys = said?.keys
    if (!Array.isArray(keys) || keys.length > MAX_RECORDS || !keys.every((one) => typeof one === 'string' && KEY.test(one)) || (said?.done !== undefined && typeof said.done !== 'boolean')) {
      return json(request, 400, { error: 'Expected { keys, done }.' })
    }
    return reply(await asked((stub, asker) => stub.namedFiles(asker, keys, said?.done === true)))
  }
  const key = FILE.exec(path)?.[1]
  if (!key) return json(request, 404, { error: 'Not found.' })
  const named = (home: Call) => `${(home.body as { home: string }).home}/${key}`

  if (request.method === 'PUT') {
    const size = Number(request.headers.get('Content-Length'))
    const hash = request.headers.get(FILE_HASH_HEADER) ?? ''
    // A file refused is answered and left unread: letting go of what's still being sent (`cancel`) drops the connection, and the device is never told why.
    if (!request.body || !Number.isInteger(size) || size <= 0 || !HASH.test(hash)) return json(request, 400, { error: 'Expected a file, with its length and its hash.' })
    if (size > MAX_SEALED_FILE) throw new TooLarge()
    // The code, Plus and the room for it first, booked: a file there's no place for is never taken.
    const room = await asked((stub, asker) => stub.fileRoom(asker, key, size))
    if (room.status !== 200) return reply(room)
    const body = request.body
    // Stored and counted, or neither: carried on if the sender goes, and a file the library won't count is deleted again, whatever the reason.
    const work = (async (): Promise<Response> => {
      let stored: number
      try {
        stored = await store.put(named(room), body, hash)
      } catch (error) {
        console.warn('A file was not stored', (error as Error).message)
        await reach((stub) => stub.fileFailed(key))
        return json(request, 422, { error: 'The file didn’t arrive as it was sent, or couldn’t be kept. Nothing was stored.' })
      }
      let kept: Call
      try {
        kept = await reach((stub) => stub.fileStored(key, stored))
      } catch (error) {
        await store.delete([named(room)])
        throw error
      }
      if (kept.status !== 200) await store.delete([named(room)])
      return reply(kept)
    })()
    waitUntil?.(work.catch(() => {}))
    return work
  }

  if (request.method === 'GET') {
    const known = await asked((stub, asker) => stub.authorise(asker))
    if (known.status !== 200) return reply(known)
    // When the library was asked, by its own clock, before the store is.
    const since = (known.body as { at: number }).at
    const file = await store.get(named(known))
    if (!file) {
      // Listed, and not in the store (deleted as it was sent again, say): forgotten, so the device that has it
      // sees the server hasn't, and sends it again (src/sync/files `nameFiles`). It was listed for good, and fetched
      // by none. Only as it was listed before the store was asked: one stored since is there.
      await reach((stub) => stub.fileMissing(key, since))
      return json(request, 404, { error: 'No such file.' })
    }
    return new Response(file.body, {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size), 'Cache-Control': 'no-store', ...cors(request) },
    })
  }

  if (request.method === 'DELETE') {
    // No longer counted, then gone from the store. Asked again after a failure, it goes on to the store all the same.
    const gone = await asked((stub, asker) => stub.removeFile(asker, key))
    if (gone.status !== 200) return reply(gone)
    await store.delete([named(gone)])
    return json(request, 200, { deleted: true })
  }
  return json(request, 404, { error: 'Not found.' })
}
