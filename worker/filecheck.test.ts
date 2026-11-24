import { describe, expect, it } from 'vitest'
import type { Call } from './answer'
import { checkFiles, GRACE_MS, MOST_ASKS, placesOf, walkOf, type CheckDeps, type Folder, type Stored } from './filecheck'
import { Library, libraryRequests, NAMED_LATELY_DAYS, SWEEP_HOLD_MS, UNUSED_DAYS } from './library'
import { sweepRequests, Sweeps } from './sweeps'
import { sqlite } from './testing'

/**
 * The server's daily look through the file store (worker/filecheck), with real libraries and a real trail, and a
 * store that's a list. It deletes writers' files, so what it must leave alone is tried as hard as what it must take.
 */
const DAY = 86_400_000
const NOW = Date.UTC(2026, 11, 1, 3, 17)
const AUTH = 'a'.repeat(64)
/** A library's object id, as its folder is named: `n` picks where it sorts. */
const homeOf = (n: number) => n.toString(16).padStart(2, '0').repeat(32)
const KEY = (n: number) => `${'K'.repeat(40)}${String(n).padStart(3, '0')}`

function world({ pageSize = 1000 } = {}) {
  const clock = { now: NOW }
  const store = new Map<string, Stored>()
  /** Each place's libraries, by id: the EU's, and where libraries were made before. */
  const places = [new Map<string, Library>(), new Map<string, Library>()]
  /** `<place> <home>` whose library can't be asked; and those that answer with a failure. */
  const away = new Set<string>()
  const failed = new Set<string>()
  /** `calls`: everything a run asked of the store, the libraries and the trail, all told. */
  const asked = { pages: 0, libraries: [] as string[], calls: 0 }
  const sql = sqlite()
  const trail = sweepRequests(new Sweeps(sql), () => clock.now)
  const failing = { delete: false, trail: false }
  /** Run as the store is about to delete: what happens in the moment the check has decided and not yet acted. */
  const meanwhile = { act: null as null | (() => void) }
  const deps = (deletes = true): CheckDeps => ({
    page: async (after) => {
      asked.pages++
      asked.calls++
      const names = [...store.keys()].filter((name) => name > after).sort()
      return { files: names.slice(0, pageSize).map((name) => store.get(name)!), more: names.length > pageSize }
    },
    delete: async (names) => {
      asked.calls++
      meanwhile.act?.()
      if (failing.delete) throw new Error('The store is away')
      for (const name of names) store.delete(name)
    },
    places: places.map((libraries, place) => (home: string): Folder | null => {
      // The EU's place doesn't know an id that isn't its own; and no place knows one that begins "fe".
      if ((place === 0 && home.startsWith('ff')) || home.startsWith('fe')) return null
      const requests = libraryRequests(libraries.get(home) ?? new Library(sqlite()), () => clock.now)
      return {
        unlisted: async (keys, run): Promise<Call> => {
          asked.libraries.push(home)
          asked.calls++
          if (away.has(`${place} ${home}`)) throw new Error('The library is away')
          if (failed.has(`${place} ${home}`)) return { status: 500, body: { error: 'It failed.' } }
          return requests.unlisted(keys, run)
        },
        swept: (keys, run) => (asked.calls++, requests.swept(keys, run)),
      }
    }),
    trail: {
      position: () => (asked.calls++, trail.position()),
      deleted: async (files) => {
        asked.calls++
        if (failing.trail) throw new Error('The trail is away')
        return trail.deleted(files)
      },
      undeleted: (files) => (asked.calls++, trail.undeleted(files)),
      checked: (check, next) => (asked.calls++, trail.checked(check, next)),
    },
    now: clock.now,
    deletes,
  })
  /** A library in a place (0 the EU's, 1 from before), paid for, holding the files of these keys. */
  const library = (home: string, keys: string[] = [], place = 0) => {
    const made = new Library(sqlite())
    made.create(AUTH, NOW + 30 * DAY, NOW - 30 * DAY)
    for (const key of keys) made.storedFile(key, 1000)
    places[place].set(home, made)
    return made
  }
  /** A file in the store, `age` old. */
  const put = (home: string, key: string, age = 2 * DAY, size = 1000) => void store.set(`${home}/${key}`, { name: `${home}/${key}`, size, at: clock.now - age })
  const run = (deletes = true) => checkFiles(deps(deletes))
  const written = async () => (await trail.since(0)).body as { checks: unknown[]; deleted: { why: string; home: string; k: string; left?: true }[] }
  const position = async () => ((await trail.position()).body as { next: string }).next
  /** As if the last run had stopped after this name. */
  const stoppedAt = (name: string) => trail.checked({ at: clock.now, looked: 0, found: 0, deleted: 0, bytes: 0, whole: false }, name)
  return { clock, store, places, away, failed, asked, failing, meanwhile, library, put, run, written, position, stoppedAt, names: () => [...store.keys()].sort() }
}

describe('the daily look through the file store', () => {
  it('deletes a file whose folder has no library behind it, and one its library doesn’t list, and writes each down', async () => {
    const { library, put, run, names, written } = world()
    const gone = library(homeOf(1), [KEY(1)])
    gone.wipe(AUTH, NOW)
    put(homeOf(1), KEY(1), 2 * DAY, 4000)
    library(homeOf(2), [KEY(1)])
    put(homeOf(2), KEY(1))
    put(homeOf(2), KEY(2), 2 * DAY, 500)
    // And a folder by an id no library was ever made under.
    put(homeOf(3), KEY(1), 2 * DAY, 30)

    expect(await run()).toEqual({ at: NOW, looked: 4, found: 3, deleted: 3, bytes: 4530, whole: true })
    expect(names()).toEqual([`${homeOf(2)}/${KEY(1)}`])
    expect((await written()).deleted).toEqual([
      { at: NOW, why: 'no library', home: homeOf(1), k: KEY(1), size: 4000 },
      { at: NOW, why: 'not listed', home: homeOf(2), k: KEY(2), size: 500 },
      { at: NOW, why: 'no library', home: homeOf(3), k: KEY(1), size: 30 },
    ])
    expect((await written()).checks).toEqual([{ at: NOW, looked: 4, found: 3, deleted: 3, bytes: 4530, whole: true }])
  })

  it('leaves every file its library accounts for: kept, booked while it’s being sent, or going with the library', async () => {
    const { library, put, run, names } = world()
    const live = library(homeOf(1), [KEY(1)])
    live.fileRoom(AUTH, KEY(2), 1000, NOW)
    put(homeOf(1), KEY(1))
    put(homeOf(1), KEY(2))
    const going = library(homeOf(2), [KEY(1)])
    put(homeOf(2), KEY(1))
    // Its files are being deleted with it, slowly: still its own till they're gone.
    let released = () => {}
    const emptying = going.emptied(() => new Promise<void>((resolve) => void (released = resolve)))
    const before = names()
    expect(await run()).toMatchObject({ looked: 3, found: 0, deleted: 0, whole: true })
    expect(names()).toEqual(before)
    released()
    await emptying
  })

  it('leaves the files of a lapsed library, and of one in the place libraries were made before', async () => {
    const { library, put, run, names, clock } = world()
    library(homeOf(1), [KEY(1)])
    put(homeOf(1), KEY(1))
    // Not the EU's id at all, and one the EU's place has an object for that holds nothing.
    library(homeOf(255), [KEY(1)], 1)
    put(homeOf(255), KEY(1))
    library(homeOf(7), [KEY(1)], 1)
    put(homeOf(7), KEY(1))
    clock.now = NOW + 200 * DAY
    const before = names()
    expect(await run()).toMatchObject({ looked: 3, found: 0, whole: true })
    expect(names()).toEqual(before)
  })

  it('leaves a file less than a day old, whatever it looks like, and takes it the next day if it’s still unaccounted for', async () => {
    expect(GRACE_MS).toBe(24 * 60 * 60 * 1000)
    const { library, put, run, names, clock, asked } = world()
    library(homeOf(1))
    put(homeOf(1), KEY(1), GRACE_MS - 1)
    put(homeOf(3), KEY(1), 0)
    expect(await run()).toMatchObject({ looked: 2, found: 0, deleted: 0 })
    expect(names()).toHaveLength(2)
    // Nor is its library asked about it yet.
    expect(asked.libraries).toEqual([])
    clock.now += DAY
    expect(await run()).toMatchObject({ found: 2, deleted: 2 })
    expect(names()).toEqual([])
  })

  // Asked which files it had, and the file deleted some moments after: sent again in between, the new file was
  // stored, counted by its library, and deleted from under it, which listed it for good (found checking the check, 2026-11-23).
  it('holds a file’s key while it deletes it: one sent meanwhile is refused, and can be sent after', async () => {
    const { library, put, run, meanwhile, names } = world()
    const live = library(homeOf(1), [KEY(4)])
    put(homeOf(1), KEY(1))
    put(homeOf(1), KEY(2), GRACE_MS - 1)
    put(homeOf(1), KEY(4))
    const tried: string[] = []
    const send = (key: string) => {
      try {
        live.fileRoom(AUTH, key, 1000, NOW)
        tried.push('booked')
      } catch (error) {
        tried.push((error as Error).message)
      }
    }
    meanwhile.act = () => (send(KEY(1)), send(KEY(3)), send(KEY(4)))
    expect(await run()).toMatchObject({ found: 1, deleted: 1 })
    // The one being cleared couldn't be sent; another key could, and so could one the library has, sent again.
    expect(tried).toEqual([expect.stringContaining('being cleared'), 'booked', 'booked'])
    expect(names()).toEqual([`${homeOf(1)}/${KEY(2)}`, `${homeOf(1)}/${KEY(4)}`])
    expect(live.files(AUTH, NOW).files).toEqual([{ k: KEY(4), size: 1000 }])
    // Done, it's let go: sent again now, it's taken.
    send(KEY(1))
    expect(tried.at(-1)).toBe('booked')
  })

  it('leaves one its library has come to account for since the store was listed, and lets go of a key however the run ends', async () => {
    const { library, put, run, names, failing, clock } = world()
    const live = library(homeOf(1))
    put(homeOf(1), KEY(1))
    // Sent again, and stored, between the store being listed and the library being asked.
    live.fileRoom(AUTH, KEY(1), 1000, NOW)
    live.storedFile(KEY(1), 1000)
    expect(await run()).toMatchObject({ looked: 1, found: 0, deleted: 0 })
    expect(names()).toHaveLength(1)
    // A key held when the store then fails is let go of all the same.
    put(homeOf(1), KEY(2))
    failing.delete = true
    await run()
    expect(() => live.fileRoom(AUTH, KEY(2), 1000, NOW)).not.toThrow()
    // And one never let go of (the check died) is, after as long as a run can last.
    expect(SWEEP_HOLD_MS).toBe(15 * 60_000)
    live.unlisted([KEY(9)], clock.now, 'a run')
    expect(() => live.fileRoom(AUTH, KEY(9), 1000, clock.now + SWEEP_HOLD_MS - 1)).toThrow(/being cleared/)
    expect(() => live.fileRoom(AUTH, KEY(9), 1000, clock.now + SWEEP_HOLD_MS)).not.toThrow()
  })

  // Found checking the rework, 2026-11-23: each of these left a library listing a file the check had deleted.
  describe('a key held while its file is cleared', () => {
    function held() {
      const sql = sqlite()
      const live = new Library(sql)
      live.create(AUTH, NOW + 30 * DAY, NOW - 30 * DAY)
      return { sql, live }
    }

    it('isn’t counted if it’s stored meanwhile, by a send that was booked before and lost its booking', () => {
      const { live } = held()
      // Two sends of one key at once: one fails, and its failing takes the booking both stood on.
      live.fileRoom(AUTH, KEY(1), 1000, NOW)
      live.fileRoom(AUTH, KEY(1), 1000, NOW)
      live.fileFailed(KEY(1))
      expect(live.unlisted([KEY(1)], NOW, 'run-a').keys).toEqual([KEY(1)])
      // The other send's file lands: refused, so the Worker deletes it and its device sends it again.
      expect(() => live.storedFile(KEY(1), 1000, NOW)).toThrow(/being cleared/)
      expect(live.files(AUTH, NOW).files).toEqual([])
      live.swept([KEY(1)], 'run-a')
      expect(() => live.storedFile(KEY(1), 1000, NOW)).not.toThrow()
    })

    it('is still held when the library’s object has been put to sleep and woken', () => {
      const { sql, live } = held()
      live.unlisted([KEY(1)], NOW, 'run-a')
      const woken = new Library(sql)
      expect(() => woken.fileRoom(AUTH, KEY(1), 1000, NOW + 1000)).toThrow(/being cleared/)
      woken.swept([KEY(1)], 'run-a')
      expect(() => new Library(sql).fileRoom(AUTH, KEY(1), 1000, NOW + 1000)).not.toThrow()
    })

    it('is one run’s: another run isn’t given it, and can’t let go of it', () => {
      const { live } = held()
      expect(live.unlisted([KEY(1), KEY(2)], NOW, 'run-b').keys).toEqual([KEY(1), KEY(2)])
      // A second run at once: neither is its to delete; looking, it's told the same.
      expect(live.unlisted([KEY(1), KEY(2), KEY(3)], NOW, 'run-a').keys).toEqual([KEY(3)])
      expect(live.unlisted([KEY(1)], NOW).keys).toEqual([])
      live.swept([KEY(1), KEY(2), KEY(3)], 'run-a')
      expect(() => live.fileRoom(AUTH, KEY(1), 1000, NOW)).toThrow(/being cleared/)
      expect(() => live.fileRoom(AUTH, KEY(3), 1000, NOW)).not.toThrow()
      live.swept([KEY(1), KEY(2)], 'run-b')
      expect(() => live.fileRoom(AUTH, KEY(1), 1000, NOW)).not.toThrow()
    })

    it('goes with the library when that’s deleted, and makes nothing of one that’s gone', () => {
      const { sql, live } = held()
      live.unlisted([KEY(1)], NOW, 'run-a')
      live.wipe(AUTH, NOW)
      expect(sql.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name)).toEqual(['meta'])
      expect(() => live.swept([KEY(1)], 'run-a')).not.toThrow()
      expect(sql.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name)).toEqual(['meta'])
    })
  })

  it('deletes nothing from a folder whose library can’t be asked, or fails, in any place it may be, and says the run wasn’t whole', async () => {
    for (const how of ['away', 'failed'] as const) {
      for (const place of [0, 1]) {
        const tried = world()
        // The library is in the place that fails: asked only where it answers, it would look like none.
        tried.library(homeOf(1), [KEY(1)], place)
        tried.put(homeOf(1), KEY(1))
        tried.put(homeOf(1), KEY(2))
        tried[how].add(`${place} ${homeOf(1)}`)
        tried.put(homeOf(2), KEY(1))
        expect(await tried.run(), `${how} ${place}`).toMatchObject({ looked: 3, found: 1, deleted: 1, whole: false })
        expect(tried.names()).toEqual([`${homeOf(1)}/${KEY(1)}`, `${homeOf(1)}/${KEY(2)}`])
      }
    }
  })

  // A place that fails for an id that isn't its own (as the EU's may for one from before) stopped the asking there:
  // the place the library is in was never asked, and its folder never looked through (found checking the rework).
  it('still asks the next place when one fails, and takes the library’s own word where it finds it', async () => {
    const { library, put, run, names, away } = world()
    library(homeOf(1), [KEY(1)], 1)
    put(homeOf(1), KEY(1))
    put(homeOf(1), KEY(2))
    away.add(`0 ${homeOf(1)}`)
    expect(await run()).toMatchObject({ looked: 2, found: 1, deleted: 1, whole: true })
    expect(names()).toEqual([`${homeOf(1)}/${KEY(1)}`])
  })

  it('leaves what isn’t named as a library’s file is: nothing the server put there', async () => {
    const { put, run, names, store } = world()
    put('notes', 'readme.txt')
    put(homeOf(171).toUpperCase(), KEY(1))
    put(homeOf(171).slice(0, 62), KEY(1))
    store.set('loose-file', { name: 'loose-file', size: 1, at: 0 })
    store.set(`${homeOf(4)}/`, { name: `${homeOf(4)}/`, size: 1, at: 0 })
    const before = names()
    expect(await run()).toMatchObject({ looked: 5, found: 0, whole: true })
    expect(names()).toEqual(before)
  })

  it('leaves a folder whose id no place knows as one of its own: nobody said there’s no library', async () => {
    const { put, run, names } = world()
    put(homeOf(254), KEY(1))
    expect(await run()).toMatchObject({ looked: 1, found: 0, deleted: 0, whole: false })
    expect(names()).toHaveLength(1)
  })

  it('only looks unless it’s told to delete: what it finds is written down as left, nothing is deleted, and no key is held', async () => {
    const { library, put, run, names, written } = world()
    const live = library(homeOf(1))
    put(homeOf(1), KEY(1))
    put(homeOf(3), KEY(1))
    expect(await run(false)).toEqual({ at: NOW, looked: 2, found: 2, deleted: 0, bytes: 0, whole: true })
    expect(names()).toHaveLength(2)
    expect((await written()).deleted).toEqual([
      { at: NOW, why: 'not listed', home: homeOf(1), k: KEY(1), size: 1000, left: true },
      { at: NOW, why: 'no library', home: homeOf(3), k: KEY(1), size: 1000, left: true },
    ])
    expect(() => live.fileRoom(AUTH, KEY(1), 1000, NOW)).not.toThrow()
  })

  it('writes a file down before deleting it, and deletes none it couldn’t write down', async () => {
    const tried = world()
    tried.put(homeOf(3), KEY(1))
    tried.failing.trail = true
    expect(await tried.run()).toMatchObject({ found: 1, deleted: 0, whole: false })
    expect(tried.names()).toHaveLength(1)
    // And one written down that the store then wouldn't delete is found again the next day.
    const kept = world()
    kept.put(homeOf(3), KEY(1))
    kept.failing.delete = true
    expect(await kept.run()).toMatchObject({ found: 1, deleted: 0, whole: false })
    expect(kept.names()).toHaveLength(1)
    // Written down as deleted, and then not: the line says it's still there.
    expect((await kept.written()).deleted).toEqual([{ at: NOW, why: 'no library', home: homeOf(3), k: KEY(1), size: 1000, left: true }])
    kept.failing.delete = false
    kept.clock.now += DAY
    expect(await kept.run()).toMatchObject({ found: 1, deleted: 1, whole: true })
    expect((await kept.written()).deleted).toHaveLength(2)
    expect((await kept.written()).checks).toHaveLength(2)
  })

  it('goes through a store of many pages, a folder split across them, each file looked at once', async () => {
    const { library, put, run, names } = world({ pageSize: 7 })
    for (let home = 1; home <= 5; home++) {
      library(homeOf(home), Array.from({ length: 10 }, (_, n) => KEY(n)))
      for (let n = 0; n < 12; n++) put(homeOf(home), KEY(n))
    }
    expect(await run()).toMatchObject({ looked: 60, found: 10, deleted: 10, whole: true })
    expect(names()).toHaveLength(50)
    // And again, from the beginning: nothing more.
    expect(await run()).toMatchObject({ looked: 50, found: 0, deleted: 0, whole: true })
  })

  it('going on from where the last run stopped, looks at each file once: to the end, then from the beginning up to there', async () => {
    const { library, put, run, stoppedAt, position, asked } = world({ pageSize: 2 })
    for (let home = 1; home <= 6; home++) {
      library(homeOf(home), [KEY(1)])
      put(homeOf(home), KEY(1))
    }
    await stoppedAt(`${homeOf(3)}/${KEY(1)}`)
    // From the fourth to the last, then the first two: the third was the last the run before dealt with.
    expect(await run()).toMatchObject({ looked: 5, found: 0, whole: true })
    expect(asked.libraries).toEqual([4, 5, 6, 1, 2].map(homeOf))
    expect(await position()).toBe('')
  })

  it('says the run wasn’t whole if the store gives a page of nothing and says there’s more, and doesn’t ask for it for ever', async () => {
    let pages = 0
    const trail = sweepRequests(new Sweeps(sqlite()))
    const check = await checkFiles({ page: async () => (pages++, { files: [], more: true }), delete: async () => {}, places: [], trail, now: NOW, deletes: true })
    void trail.undeleted
    expect([check.whole, pages]).toEqual([false, 1])
  })

  // Starting a little further on by the day, a store whose folders all began alike had the same few hundred looked
  // at every day, and the rest never (found checking the check, 2026-11-23).
  it('stops when it has asked as much as one run may, and the next run goes on from there, round the whole store', async () => {
    expect(MOST_ASKS).toBeLessThanOrEqual(800)
    const { library, put, run, asked, position, names } = world()
    // More live libraries than one run can ask about, all beginning alike, each with one file it doesn't list.
    const folders = Array.from({ length: 1000 }, (_, n) => `00${n.toString(16).padStart(4, '0')}${'0'.repeat(58)}`)
    for (const home of folders) {
      library(home, [KEY(1)])
      put(home, KEY(1))
      put(home, KEY(2))
    }
    const first = await run()
    expect(first.whole).toBe(false)
    expect(first.deleted).toBeGreaterThan(300)
    expect(first.deleted).toBeLessThan(1000)
    // Everything it asked, of the store, the libraries and the trail, telling each library when it was done included.
    expect(asked.calls).toBeLessThanOrEqual(MOST_ASKS)
    expect(asked.calls).toBeGreaterThan(MOST_ASKS - 10)
    // It stopped at the end of a folder it had dealt with.
    expect(names()).not.toContain(`${(await position()).slice(0, 64)}/${KEY(2)}`)
    expect(await position()).toMatch(/^00[0-9a-f]{62}\/K+00[12]$/)
    let deleted = first.deleted
    for (let n = 0; n < 4 && deleted < 1000; n++) deleted += (await run()).deleted
    expect(deleted).toBe(1000)
    expect(new Set(asked.libraries).size).toBe(1000)
    expect(names()).toHaveLength(1000)
    // With nothing left to delete, it still goes round all of them, in as many runs as that takes, and round again.
    asked.libraries.length = 0
    for (let n = 0; n < 2; n++) expect(await run()).toMatchObject({ found: 0, whole: false })
    expect(new Set(asked.libraries).size).toBe(1000)
    asked.libraries.length = 0
    for (let n = 0; n < 2; n++) await run()
    expect(new Set(asked.libraries).size).toBe(1000)
    // A deleted library's folders are each asked in both places, and that's counted too.
    const gone = world()
    for (let n = 0; n < 1000; n++) gone.put(`01${n.toString(16).padStart(4, '0')}${'0'.repeat(58)}`, KEY(1))
    await gone.run()
    expect(gone.asked.calls).toBeLessThanOrEqual(MOST_ASKS)
  })
})

// A file its library lists, that no document uses any more: only a device can say so, and none did. It stayed on
// the server till the library was deleted (the server audit of 2026-11-23, L13).
describe('a file no device has named in a long while', () => {
  /** A library whose two files were sent a hundred days ago, both still in the store; paid for well past the days these go on to. */
  function sent() {
    const made = world()
    const live = made.library(homeOf(1))
    live.entitle(AUTH, NOW + 400 * DAY, NOW - 100 * DAY)
    for (const key of [KEY(1), KEY(2)]) {
      live.storedFile(key, 1000, NOW - 100 * DAY)
      made.put(homeOf(1), key, 100 * DAY)
    }
    /** A device saying each day, from `from` days ago to `to` days ago, that these are all the files its documents use. */
    const saying = (keys: string[], from = 95, to = 1, done = true) => {
      for (let ago = from; ago >= to; ago--) live.namedFiles(AUTH, keys, done, NOW - ago * DAY)
    }
    return { ...made, live, saying }
  }

  it('is deleted, and written down as unused, once devices have gone on saying which they use for ninety days and none has named that one', async () => {
    expect([UNUSED_DAYS, NAMED_LATELY_DAYS]).toEqual([90, 7])
    const { live, saying, run, names, written } = sent()
    saying([KEY(1)])
    expect(await run()).toEqual({ at: NOW, looked: 2, found: 1, deleted: 1, bytes: 1000, whole: true })
    expect(names()).toEqual([`${homeOf(1)}/${KEY(1)}`])
    expect((await written()).deleted).toEqual([{ at: NOW, why: 'unused', home: homeOf(1), k: KEY(2), size: 1000 }])
    // No longer the library's, nor counted against its room; and it can be sent again.
    expect(live.files(AUTH, NOW)).toMatchObject({ files: [{ k: KEY(1), size: 1000 }], bytes: 4096 })
    expect(() => live.fileRoom(AUTH, KEY(2), 1000, NOW)).not.toThrow()
  })

  it('is left while any device names it, or has in the last ninety days', async () => {
    const { live, saying, run, names, clock } = sent()
    saying([KEY(1), KEY(2)], 95, 89)
    saying([KEY(1)], 88, 1)
    expect(await run()).toMatchObject({ found: 0, deleted: 0 })
    expect(names()).toHaveLength(2)
    // A day more, with a device still saying, and it's ninety days since the second was named.
    clock.now = NOW + DAY
    live.namedFiles(AUTH, [KEY(1)], true, NOW + DAY - 1)
    expect(await run()).toMatchObject({ found: 1, deleted: 1 })
  })

  it('is left in a library whose devices haven’t said lately, or have only said in part', async () => {
    const quiet = sent()
    expect(await quiet.run()).toMatchObject({ found: 0 })
    // Said every day till a week ago, and not since.
    const stale = sent()
    stale.saying([KEY(1)], 95, NAMED_LATELY_DAYS)
    expect(await stale.run()).toMatchObject({ found: 0 })
    // Said in part every day, and never that it was all.
    const partly = sent()
    partly.saying([KEY(1)], 95, 1, false)
    expect(await partly.run()).toMatchObject({ found: 0 })
    expect([quiet.names(), stale.names(), partly.names()].map((left) => left.length)).toEqual([2, 2, 2])
  })

  // Lately was all it asked: the first device back after months of quiet, saying which files it uses, had every
  // file that only another device uses deleted that night, before the other had said a word (found checking the check, 2026-11-23).
  it('is left when the saying has only just begun again, however long the file has gone unnamed: ninety days of it, unbroken, come first', async () => {
    for (const first of [[KEY(1)], []]) {
      const { live, saying, run, names, clock } = sent()
      // Two devices said for a month, a hundred days ago and more; then nothing; today one is back.
      saying([KEY(1), KEY(2)], 130, 100)
      live.namedFiles(AUTH, first, true, NOW - 1000)
      expect(await run()).toMatchObject({ found: 0 })
      // The other says what it uses the next day, and both go on.
      for (let day = 1; day <= 89; day++) {
        clock.now = NOW + day * DAY
        live.namedFiles(AUTH, [KEY(1)], true, clock.now - 2000)
        live.namedFiles(AUTH, [KEY(2)], true, clock.now - 1000)
      }
      expect(await run()).toMatchObject({ found: 0 })
      expect(names()).toHaveLength(2)
      // And a gap of a week starts the ninety days again.
      clock.now = NOW + 200 * DAY
      live.namedFiles(AUTH, [KEY(1)], true, clock.now - 1000)
      expect(await run()).toMatchObject({ found: 0 })
    }
  })

  // One Nib that says, beside one from before that never does: what only the older one's history names went ninety
  // days after the first said anything (found checking the check, 2026-11-23).
  it('is left while a device that doesn’t say which files it uses has synced in the last ninety days', async () => {
    const { live, saying, run, clock } = sent()
    saying([KEY(1)])
    // An older Nib pulled, eighty-nine days ago; the newer one's own pulls say that it says.
    live.changes(AUTH, 0, NOW - 89 * DAY)
    live.changes(AUTH, 0, NOW - DAY, undefined, true)
    expect(await run()).toMatchObject({ found: 0 })
    clock.now = NOW + DAY
    live.namedFiles(AUTH, [KEY(1)], true, clock.now - 1000)
    live.changes(AUTH, 0, clock.now - 1000, undefined, true)
    expect(await run()).toMatchObject({ found: 1, deleted: 1 })
  })

  it('counts a file from before this was kept from when its library is first told anything, not from when it was sent', async () => {
    const { live, run, names, clock } = sent()
    // As rows were before: with no word of when they were named.
    ;(live as unknown as { sql: { run(query: string): void } }).sql.run('UPDATE files SET named = NULL')
    for (let day = 0; day <= 89; day++) live.namedFiles(AUTH, [KEY(1)], true, NOW + day * DAY)
    clock.now = NOW + 90 * DAY - 1
    expect(await run()).toMatchObject({ found: 0 })
    clock.now = NOW + 90 * DAY
    live.namedFiles(AUTH, [KEY(1)], true, clock.now - 1)
    expect(await run()).toMatchObject({ found: 1, deleted: 1 })
    expect(names()).toEqual([`${homeOf(1)}/${KEY(1)}`])
  })

  it('only looking, is written down as left, the once however many days it’s found, and stays the library’s', async () => {
    const { live, saying, run, names, written, clock } = sent()
    saying([KEY(1)])
    expect(await run(false)).toMatchObject({ found: 1, deleted: 0 })
    clock.now = NOW + DAY
    live.namedFiles(AUTH, [KEY(1)], true, clock.now - 1000)
    expect(await run(false)).toMatchObject({ found: 1, deleted: 0 })
    expect(names()).toHaveLength(2)
    expect((await written()).deleted).toEqual([{ at: NOW, why: 'unused', home: homeOf(1), k: KEY(2), size: 1000, left: true }])
    expect(live.files(AUTH, NOW).files).toHaveLength(2)
    // Told to delete, it does, and that's a line of its own.
    expect(await run()).toMatchObject({ found: 1, deleted: 1 })
    expect((await written()).deleted.map((file) => file.left ?? false)).toEqual([true, false])
  })

  it('can’t be sent again in the moment it’s being cleared, and is found again as unlisted if the store won’t delete it', async () => {
    const { live, saying, run, names, meanwhile, failing, clock, written } = sent()
    saying([KEY(1)])
    const tried: string[] = []
    meanwhile.act = () => {
      try {
        live.fileRoom(AUTH, KEY(2), 1000, NOW)
        tried.push('booked')
      } catch (error) {
        tried.push((error as Error).message)
      }
    }
    failing.delete = true
    expect(await run()).toMatchObject({ found: 1, deleted: 0, whole: false })
    expect(tried).toEqual([expect.stringContaining('being cleared')])
    // Forgotten by its library, and still in the store: the next run takes it as a file nothing lists.
    expect(names()).toHaveLength(2)
    failing.delete = false
    meanwhile.act = null
    clock.now = NOW + DAY
    live.namedFiles(AUTH, [KEY(1)], true, clock.now - 1)
    expect(await run()).toMatchObject({ found: 1, deleted: 1 })
    expect((await written()).deleted.map((file) => [file.why, file.k, file.left ?? false])).toEqual([
      ['unused', KEY(2), true],
      ['not listed', KEY(2), false],
    ])
  })

  it('is named only by a device with the library’s code, and Plus', () => {
    const { live } = sent()
    expect(() => live.namedFiles('b'.repeat(64), [KEY(2)], true, NOW)).toThrow(/does not match/)
    expect(() => live.namedFiles(AUTH, [KEY(2)], true, NOW + 500 * DAY)).toThrow(/Plus/)
  })

  it('isn’t one being sent, or one going with its library', async () => {
    const sending = sent()
    sending.live.fileRoom(AUTH, KEY(3), 1000, NOW - 100 * DAY)
    sending.put(homeOf(1), KEY(3), 100 * DAY)
    sending.saying([KEY(1), KEY(2)])
    // However long ago it was last named: it's on its way in.
    ;(sending.live as unknown as { sql: { run(query: string, ...args: unknown[]): void } }).sql.run('UPDATE files SET named = ? WHERE k = ?', NOW - 100 * DAY, KEY(3))
    expect(await sending.run()).toMatchObject({ found: 0 })
    expect(sending.names()).toHaveLength(3)
    // And one whose library is being deleted, its files with it: theirs to delete, not this check's.
    const going = sent()
    going.saying([KEY(1)])
    let released = () => {}
    const emptying = going.live.emptied(() => new Promise<void>((resolve) => void (released = resolve)))
    expect(await going.run()).toMatchObject({ found: 0 })
    expect(going.names()).toHaveLength(2)
    released()
    await emptying
  })
})

describe('the store and the places, as the Worker gives them to the check', () => {
  it('lists the bucket a thousand at a time from after a name, and says when there’s more', async () => {
    const asked: unknown[] = []
    const bucket = {
      list: async (options: unknown) => {
        asked.push(options)
        return { objects: [{ key: 'a/b', size: 7, uploaded: new Date(NOW) }], truncated: true, cursor: 'c', delimitedPrefixes: [] }
      },
      delete: async (names: string[] | string) => void asked.push(names),
    }
    const walk = walkOf(bucket as unknown as Parameters<typeof walkOf>[0])
    expect(await walk.page('')).toEqual({ files: [{ name: 'a/b', size: 7, at: NOW }], more: true })
    expect(await walk.page('a/b')).toMatchObject({ more: true })
    await walk.delete(['a/b'])
    expect(asked).toEqual([{ limit: 1000 }, { limit: 1000, startAfter: 'a/b' }, ['a/b']])
  })

  it('takes only "not an id of mine" for a place that hasn’t it: anything else is left to fail', () => {
    const stub = { unlisted: async () => ({ status: 200, body: {} }), swept: async () => ({ status: 200, body: {} }) }
    const mine = { idFromString: (id: string) => ({ id }), get: () => stub }
    const notMine = {
      idFromString: () => {
        throw new TypeError('Invalid Durable Object ID')
      },
      get: () => stub,
    }
    const broken = {
      idFromString: (id: string) => ({ id }),
      get: () => {
        throw new Error('The namespace is away')
      },
    }
    const [first, second, third] = placesOf([notMine, mine, broken] as unknown as Parameters<typeof placesOf>[0])
    expect(first(homeOf(1))).toBeNull()
    expect(second(homeOf(1))).toBe(stub)
    expect(() => third(homeOf(1))).toThrow('away')
  })
})
