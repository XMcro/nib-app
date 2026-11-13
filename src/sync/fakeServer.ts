import { Refused } from '../../worker/answer'
import { sealPost, type Post } from '../../worker/inbox-seal'
import { Library } from '../../worker/library'
import { sqlite } from '../../worker/testing'
import { SyncHttpError, type Api, type Wire } from './api'

const AUTH = 'a test library'

/**
 * The server itself (worker/library.ts) on real SQLite, reached straight:
 * no HTTP or signing, which worker/sync and src/sync/index.change.test.ts go
 * through. `records` and `expired` are what it holds, read afresh for a test
 * to look at; `files`, the sealed files it keeps, counted by the library as
 * the Worker has it count them (worker/files). `filesLimit`: the room they get.
 * `post`: what a service sends to the library's inbox, sealed as the Worker does it.
 */
export function fakeServer({ filesLimit }: { filesLimit?: number } = {}) {
  const sql = sqlite()
  const library = new Library(sql, undefined, filesLimit)
  const files = new Map<string, Uint8Array<ArrayBuffer>>()
  /** As the app's own calls say a refusal (sync/api). */
  const refusing = <T>(act: () => T): T => {
    try {
      return act()
    } catch (error) {
      throw error instanceof Refused ? new SyncHttpError(error.status, error.message) : error
    }
  }
  const paid = () => library.create(AUTH, Number.MAX_SAFE_INTEGER, Date.now())
  paid()
  const api: Api = {
    create: async () => paid(),
    entitle: async () => paid(),
    status: async () => library.status(AUTH, Date.now()),
    changes: async (since) => library.changes(AUTH, since, Date.now(), 2), // tiny pages, so paging is always exercised
    push: async (batch) => ({ results: library.push(AUTH, batch, Date.now()) }),
    expire: async (keys) => ({ expired: library.expire(AUTH, keys, Date.now()) }),
    wipe: async () => void library.wipe(AUTH, Date.now()),
    requireSigned: async (on) => library.requireSigned(AUTH, on, Date.now()),
    files: async () => refusing(() => library.files(AUTH, Date.now())),
    putFile: async (key, sealed) =>
      refusing(() => {
        library.fileRoom(AUTH, key, sealed.length, Date.now())
        files.set(key, sealed)
        library.storedFile(key, sealed.length)
      }),
    getFile: async (key) => refusing(() => (library.authorise(AUTH, Date.now()), files.get(key) ?? null)),
    deleteFile: async (key) =>
      refusing(() => {
        library.removeFile(AUTH, key, Date.now())
        files.delete(key)
      }),
    inbox: async () => refusing(() => library.inbox(AUTH, Date.now())),
    setInbox: async (key, address, kept) => refusing(() => void library.setInbox(AUTH, key, address, kept, Date.now())),
    endInbox: async () => refusing(() => void library.endInbox(AUTH, Date.now())),
    tookPosts: async (ids) => refusing(() => void library.tookPosts(AUTH, ids, Date.now())),
  }
  return {
    api,
    files,
    library,
    /** A post from a service, to the address whose secret hashes to `address`: sealed as the Worker seals one (worker/inbox), and kept. */
    async post(address: string, post: Post, at = Date.now()) {
      const key = refusing(() => library.inboxFor(address, at))
      const sealed = await sealPost(key, post)
      refusing(() => library.addPost(address, sealed, at))
    },
    /** Every record it would send, by key, oldest change first. */
    get records() {
      const held = new Map<string, Required<Pick<Wire, 'k' | 's'>> & Wire>()
      for (let since = 0, more = true; more; ) {
        const page = library.changes(AUTH, since, Date.now())
        for (const record of page.records) held.set(record.k, { ...record, s: record.s! })
        ;({ seq: since, more } = page)
      }
      return held
    },
    /** The keys it has let go of the text of (`expire`). */
    get expired() {
      return new Set(sql.all('SELECT k FROM records WHERE expired = 1').map((row) => String(row.k)))
    },
  }
}
