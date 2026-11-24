import type { Call } from './answer'
import type { Checked, Gone, Why } from './sweeps'

/**
 * The server's own daily look through the file store, for files nothing accounts for: one in a folder with no
 * library behind it (deleted, and its files left by a failure), or one its library doesn't list (stored, and the
 * library never told, or told to forget it and the store never emptied of it). Each is deleted, and written down
 * (worker/sweeps). Nothing looked before but an audit (the server audit of 2026-11-23, L13).
 *
 * What it can't see is whether a file its library does list is still used by any document: those are sealed, and
 * only a device can say. So a library says which of its files no device has named in a long while (worker/library
 * `namedFiles`, `unlisted`), and those go too.
 *
 * It errs on the side of leaving a file. One is deleted only if it's a day old, its folder is named as a library's
 * object is, every place a library by that id may be kept answered, and none of them accounts for it. And a
 * library asked is asked as the file is about to go, and holds its key till it has: nothing sent meanwhile is
 * deleted in its place (worker/library `unlisted`).
 */

/** A file in the store: its name there (`<its library's object>/<its key>`), its size, and when it was stored. */
export type Stored = { name: string; size: number; at: number }

/** A library's object, as much of it as the check asks (worker/library `unlisted`, `swept`). */
export type Folder = { unlisted(keys: string[], run?: string): Promise<Call>; swept(keys: string[], run: string): Promise<Call> }

export type CheckDeps = {
  /** The store's files whose names come after `after`, in order, a page of them; `more` if there are others past these. */
  page(after: string): Promise<{ files: Stored[]; more: boolean }>
  delete(names: string[]): Promise<void>
  /** The library's object by a folder's name, in each place one may be kept; null from a place that name isn't an id of. */
  places: ((home: string) => Folder | null)[]
  trail: { position(): Promise<Call>; deleted(files: Gone[]): Promise<unknown>; undeleted(files: Gone[]): Promise<unknown>; checked(check: Checked, next: string): Promise<unknown> }
  now: number
  /** Deletes what it finds. Without it, it only looks: what it finds is written down as left. */
  deletes: boolean
}

const DAY_MS = 86_400_000
/**
 * How old a file is before it's looked at: one being sent is booked by its library before it reaches the store,
 * and one being deleted is forgotten by its library before it leaves, so neither is ever what this finds; a day is
 * for whatever order of things nobody thought of.
 */
export const GRACE_MS = DAY_MS
/**
 * The most it asks of the store, the libraries and the trail in one run, all told: under what a Worker may ask of
 * Cloudflare's own services in one go on any plan (1,000). Short of it, the run stops, says it wasn't the whole
 * store, and the next one goes on from where it stopped (worker/sweeps `position`).
 */
export const MOST_ASKS = 800
/** Kept back of those for what a page may still need once its folders are asked: writing down, deleting, saying what wasn't deleted; and the run's own line. */
const KEPT_BACK = 4
/** A library's object, as its folder is named. */
const HOME = /^[0-9a-f]{64}$/

/** As much of an R2 bucket as the check uses. */
type Bucket = {
  list(options: { limit: number; startAfter?: string }): Promise<{ objects: { key: string; size: number; uploaded: Date }[]; truncated: boolean }>
  delete(names: string[]): Promise<void>
}
/** As much of a Durable Object namespace as the check uses: an id from its text, which throws if it's no id of this namespace's, and the object by it. */
type Namespace<Id> = { idFromString(id: string): Id; get(id: Id): unknown }

/** The store, as the check walks it: an R2 bucket's list and delete, a thousand at a time. */
export const walkOf = (bucket: Bucket): Pick<CheckDeps, 'page' | 'delete'> => ({
  page: async (after) => {
    const listed = await bucket.list({ limit: 1000, ...(after ? { startAfter: after } : {}) })
    return { files: listed.objects.map((object) => ({ name: object.key, size: object.size, at: object.uploaded.getTime() })), more: listed.truncated }
  },
  delete: (names) => bucket.delete(names),
})

/**
 * The places a library's object may be kept, each as the check asks it: a folder's name is its object's id, which
 * is one place's, and the other says it's no id of its own. Only that is taken for "not here"; anything else that
 * fails is left to fail, and the folder is left alone.
 */
export const placesOf = <Id>(places: Namespace<Id>[]): CheckDeps['places'] =>
  places.map((place) => (home) => {
    let id: Id
    try {
      id = place.idFromString(home)
    } catch {
      return null
    }
    return place.get(id) as unknown as Folder
  })

export async function checkFiles(deps: CheckDeps): Promise<Checked> {
  const { now } = deps
  const check: Checked = { at: now, looked: 0, found: 0, deleted: 0, bytes: 0, whole: true }
  let asks = 0
  /** This run, to the libraries it has hold keys (worker/library `unlisted`): another run's are not its own. */
  const run = crypto.randomUUID()
  /** The name the run has dealt with everything up to: where the next goes on from, if this one stops. */
  let done = ''

  /**
   * Which of a folder's `keys` nothing accounts for, and why; 'unknown' if that can't be said. With a library
   * there, it's the one to tell when they've been dealt with (`held`).
   */
  async function unaccounted(home: string, keys: string[]): Promise<{ why: Why; keys: string[]; unused?: string[]; held?: Folder } | 'unknown'> {
    let [answered, failed] = [false, false]
    for (const place of deps.places) {
      asks++
      try {
        const folder = place(home)
        if (folder === null) continue
        const said = await folder.unlisted(keys, deps.deletes ? run : undefined)
        if (said.status !== 200) throw new Error('It failed.')
        answered = true
        const body = said.body as { library: boolean; keys: string[]; unused?: string[] }
        // The library itself: its word stands, whatever another place did.
        if (body.library) return { why: 'not listed', keys: body.keys, unused: body.unused ?? [], ...(deps.deletes ? { held: folder } : {}) }
      } catch {
        // The next place is still asked: it may be the one the library is in. With none there, this one's
        // silence means it can't be said there's no library.
        failed = true
      }
    }
    return answered && !failed ? { why: 'no library', keys } : 'unknown'
  }

  try {
    asks++
    const start = ((await deps.trail.position()) as Call).body as { next: string }
    done = start.next
    // From where the last run stopped to the end, then from the beginning up to there.
    const legs = start.next ? [[start.next, ''], ['', start.next]] : [['', '']]
    walk: for (const [from, until] of legs) {
      for (let after = from, more = true; more; ) {
        if (asks + 1 + KEPT_BACK > MOST_ASKS) {
          check.whole = false
          break walk
        }
        asks++
        const page = await deps.page(after)
        // A page of none that says there are more: not gone through, and not to be asked for again and again.
        if (page.more && page.files.length === 0) check.whole = false
        more = page.more && page.files.length > 0
        // This page's files by folder, in order: only those old enough, in a folder named as a library's is.
        const folders: { home: string; last: string; old: Stored[] }[] = []
        for (const file of page.files) {
          if (until && file.name >= until) {
            more = false
            break
          }
          after = file.name
          check.looked++
          const slash = file.name.indexOf('/')
          const [home, key] = [file.name.slice(0, slash), file.name.slice(slash + 1)]
          // Not a library's file by its name: nothing the server put there, and not its to delete.
          if (!HOME.test(home) || !key) continue
          if (folders.at(-1)?.home !== home) folders.push({ home, last: file.name, old: [] })
          const folder = folders.at(-1)!
          folder.last = file.name
          if (file.at <= now - GRACE_MS) folder.old.push(file)
        }
        let spent = false
        /** The last name of the last folder asked about on this page: dealt with once what was found has gone. */
        let upTo = done
        const due: Gone[] = []
        const held: [Folder, string[]][] = []
        try {
          for (const { home, last, old } of folders) {
            if (old.length > 0) {
              // No more to ask with: what this page has found so far is still dealt with, below.
              // Each folder may be asked in every place, and told once when it's done.
              if (asks + deps.places.length + 1 + KEPT_BACK > MOST_ASKS) {
                spent = true
                break
              }
              const found = await unaccounted(home, old.map((file) => file.name.slice(home.length + 1)))
              if (found === 'unknown') check.whole = false
              else {
                // Counted now, the telling it when they're done: the page's folders are all asked before any is told.
                const unused = new Set(found.unused)
                if (found.held && found.keys.length + unused.size > 0) asks += held.push([found.held, [...found.keys, ...unused]]) && 1
                const keys = new Set(found.keys)
                for (const file of old) {
                  const k = file.name.slice(home.length + 1)
                  // One its library listed, and no device has named in a long while (worker/library `namedFiles`); or one nothing lists.
                  const why = unused.has(k) ? 'unused' : keys.has(k) ? found.why : null
                  if (why) due.push({ at: now, why, home, k, size: file.size, ...(deps.deletes ? {} : { left: true as const }) })
                }
              }
            }
            upTo = last
          }
          if (due.length > 0) {
            check.found += due.length
            // Written down first, then deleted: a file never goes unwritten. If deleting fails, the next run finds it again.
            asks += 2
            await deps.trail.deleted(due)
            if (deps.deletes) {
              try {
                await deps.delete(due.map((file) => `${file.home}/${file.k}`))
              } catch (error) {
                // Written down as deleted, and still there: said so, as far as it can be.
                asks++
                await deps.trail.undeleted(due).catch(() => {})
                throw error
              }
              check.deleted += due.length
              check.bytes += due.reduce((sum, file) => sum + file.size, 0)
            }
          }
          // Only now: stopped by a failure before this, the next run comes back to these.
          done = upTo
        } finally {
          // Whatever happened, the keys held are let go: a library that isn't told lets go of them itself (worker/library SWEEP_HOLD_MS).
          await Promise.all(held.map(([folder, keys]) => folder.swept(keys, run).catch(() => {})))
        }
        if (spent) {
          check.whole = false
          break walk
        }
        if (!more && !spent) done = until ? done : ''
      }
    }
    // Got to the end of the round: the next starts from the beginning.
    if (check.whole) done = ''
  } catch (error) {
    // The store or the trail failed part-way: what was done is written down, and the rest waits for the next run.
    console.warn('Nib: the check of the file store stopped', (error as Error).name)
    check.whole = false
  }
  await deps.trail.checked(check, done)
  return check
}
