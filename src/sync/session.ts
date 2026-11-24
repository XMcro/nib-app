import Dexie from 'dexie'
import { db } from '../db/db'
import { STAMPS_CHANGED } from '../lib/collection'
import { FOLDERS_CHANGED } from '../lib/folderSettings'
import { LOOKS_CHANGED } from '../lib/look'
import { SUBMISSIONS_CHANGED } from '../lib/submissions'
import { fetchOriginalsWith } from '../lib/originals'
import { SERVER } from '../lib/server'
import { notWrittenHere } from '../lib/writtenHere'
import { httpApi, SyncHttpError, type Api } from './api'
import type { SyncKeys } from './crypto'
import { expireHistory, SyncReset, syncOnce } from './engine'
import { fetchFile, syncFiles, nameFiles } from './files'
import { takePosts } from './inbox'
import { describeError, type SyncStatus } from './status'

const DEBOUNCE_MS = 2000
/** While Nib is written in, it looks no sooner than this after the last time: the server sees the rhythm of the writing only roughly. */
const WRITING_MS = 60_000
/** How soon it looks again while the app is open: at first, and at the longest, once nothing has changed for a while (Session `later`). */
const INTERVAL_MS = 30_000
const IDLE_MS = 5 * 60_000
/** Away this long with a look in flight, the look is ended as Nib comes back (onVisible): what it was waiting on isn't coming. */
const AWAY_MS = 60_000
/** How long a request saying which files are used (Session `name`) waits for its answer. */
const REPORT_ANSWER_MS = 60_000
/** Coming back says so more than once, shown and then focused: said again this soon, it's the same coming back, and the one look. */
const JUST_MS = 5000

/**
 * The running sync, for one code. Only one tab per browser runs it (a Web
 * Lock), so two tabs never race each other to the server; the others see
 * "syncing in another tab".
 *
 * `manual` (a switch on this device, "Sync only when I ask"): while it says
 * so, nothing here looks by itself, for writing, for Nib coming or going, or
 * for time passing. Only `run`, which is Sync now.
 */
export class Session {
  /** The next look, whatever brings it: there's one at a time, so a poll can't send writing sooner than WRITING_MS. */
  private next: ReturnType<typeof setTimeout> | undefined
  /** Looks in a row that found nothing to bring here. */
  private quiet = 0
  /** When the last look began, and whether anything's been written here since. */
  private lastLook = -Infinity
  private written = false
  /** When Nib last came back to the screen, or to the front (onVisible). */
  private backAt = -Infinity
  /** When Nib was put away, while it is. */
  private hidAt: number | null = null
  /** What ends the look under way; none between looks, so nothing else that asks the server is ended with it. */
  private look: AbortController | null = null
  /** How many times the documents here have been written, and the count at the last look that left none of them to send: -1 before one, or since whatever unsettled it. */
  private writes = 0
  private sentAt = -1
  private running: Promise<void> | null = null
  private again = false
  private stopped = false
  private release: (() => void) | undefined
  private keys: SyncKeys
  private api: Api
  /** Saying which files are used, under way (`name`). */
  private naming: Promise<unknown> | null = null
  private onStatus: (status: SyncStatus) => void
  private onApplied: (ids: string[], copies: number) => void
  private receipt: () => string | undefined
  private manual: () => boolean
  private postsFolder: () => string | undefined
  /** Posts waiting in the library's inbox, as the server said when it last answered for changes. */
  private posts = 0
  private sent: string | undefined
  private leading = false

  constructor(
    keys: SyncKeys,
    handlers: {
      onStatus: (status: SyncStatus) => void
      onApplied: (ids: string[], copies: number) => void
      receipt: () => string | undefined
      manual: () => boolean
      /** The folder a note made of a post goes in (lib/startAt `newIn`), if any. */
      postsFolder?: () => string | undefined
    },
  ) {
    this.keys = keys
    const api = httpApi(SERVER, keys, () => this.look?.signal)
    // As the server answers for changes it says how many posts wait in the inbox: kept for the end of the look.
    this.api = {
      ...api,
      changes: async (since) => {
        const answer = await api.changes(since)
        this.posts = answer.inbox ?? 0
        return answer
      },
    }
    this.postsFolder = handlers.postsFolder ?? (() => undefined)
    this.onStatus = handlers.onStatus
    this.onApplied = handlers.onApplied
    this.receipt = handlers.receipt
    this.manual = handlers.manual
  }

  /** An original this device hasn't, fetched when it's wanted (lib/originals). Not one that can't be: said only in the log. */
  private fetch = (original: Parameters<typeof fetchFile>[2]) =>
    fetchFile(this.keys, this.api, original).catch((error: unknown) => {
      console.warn('Nib: could not fetch a picture’s original', error)
      return false
    })

  start() {
    fetchOriginalsWith(this.fetch)
    const begin = () => {
      if (this.stopped) return
      this.leading = true
      Dexie.on('storagemutated', this.onMutated)
      document.addEventListener('visibilitychange', this.onVisible)
      window.addEventListener('online', this.onVisible)
      window.addEventListener('focus', this.onVisible)
      window.addEventListener(STAMPS_CHANGED, this.onRecordChanged)
      window.addEventListener(FOLDERS_CHANGED, this.onRecordChanged)
      window.addEventListener(LOOKS_CHANGED, this.onRecordChanged)
      window.addEventListener(SUBMISSIONS_CHANGED, this.onRecordChanged)
      if (this.manual()) this.onStatus({ state: 'manual' })
      else this.run()
    }
    if (!navigator.locks) return begin()
    this.onStatus({ state: 'elsewhere' })
    void navigator.locks.request('nib-sync', () => {
      begin()
      return new Promise<void>((resolve) => (this.release = resolve))
    })
  }

  stop() {
    fetchOriginalsWith(null, this.fetch)
    this.stopped = true
    clearTimeout(this.next)
    Dexie.on('storagemutated').unsubscribe(this.onMutated)
    document.removeEventListener('visibilitychange', this.onVisible)
    window.removeEventListener('online', this.onVisible)
    window.removeEventListener('focus', this.onVisible)
    window.removeEventListener(STAMPS_CHANGED, this.onRecordChanged)
    window.removeEventListener(FOLDERS_CHANGED, this.onRecordChanged)
    window.removeEventListener(LOOKS_CHANGED, this.onRecordChanged)
    window.removeEventListener(SUBMISSIONS_CHANGED, this.onRecordChanged)
    this.release?.()
  }

  private onMutated = (parts: Record<string, unknown>) => {
    const ours = Object.keys(parts).some(
      (part) => part.startsWith(`idb://${db.name}/items/`) || part.startsWith(`idb://${db.name}/revisions/`),
    )
    if (!ours) return
    this.quiet = 0
    this.written = true
    this.writes += 1
    if (this.manual()) return this.onStatus({ state: 'manual', message: 'Changes on this device haven’t been sent.' })
    // Put away (the editor's last save lands as Nib goes): sent while it still can be.
    if (document.visibilityState === 'hidden') return this.run()
    this.lookAt(this.writingLook())
  }

  /** A pack or a present opened here: sent at once, so another device opening Nib next has it opened too. */
  /** The stamps, the folders' settings, the saved looks or the submissions, changed here: none is in the database. */
  private onRecordChanged = () => {
    this.quiet = 0
    this.nudge()
  }

  /** A pause in the writing, and a minute since the last look. */
  private writingLook() {
    return Math.max(Date.now() + DEBOUNCE_MS, this.lastLook + WRITING_MS)
  }

  private onVisible = (event: Event) => {
    // Back: look at once, and start over. Put away: send what's written, while it can be.
    if (document.visibilityState === 'visible') {
      this.quiet = 0
      // Shown, then focused: the one look, not a second waiting on the first. Back online is its own news.
      if (event.type !== 'online') {
        if (Date.now() - this.backAt < JUST_MS) return
        this.backAt = Date.now()
      }
      // A look in flight as Nib was put away is stopped where it stands, its request with it. Back after a while, that
      // may never be answered, and every look since waited behind it: ended, for the look below to be made afresh.
      if (this.hidAt !== null && Date.now() - this.hidAt >= AWAY_MS) this.look?.abort()
      this.hidAt = null
    } else {
      this.hidAt ??= Date.now()
      if (!this.written) return
    }
    this.nudge()
  }

  /** A look for a reason of Nib's own, not the writer's asking: none while it's only when asked. Also what takes it up again once that's off. */
  nudge() {
    if (!this.manual()) this.run()
  }

  /** `polling`: only while Nib is on screen; hidden, it waits to be shown (onVisible). */
  private lookAt(at: number, polling = false) {
    clearTimeout(this.next)
    this.next = setTimeout(() => (!polling || document.visibilityState === 'visible') && this.nudge(), Math.max(0, at - Date.now()))
  }

  /**
   * The next look while the app is open: INTERVAL_MS after the first that
   * found nothing, then twice as long after each more, up to IDLE_MS. An
   * open window, a Mac's all day, otherwise asked the server every 30 s for
   * nothing. A look that brings changes starts it over, and so do writing
   * here (onMutated) and coming back to Nib (onVisible). Written in
   * meanwhile, it's the writing's own look instead.
   */
  private later() {
    if (this.stopped) return
    if (this.written) return this.lookAt(this.writingLook())
    const wait = Math.min(INTERVAL_MS * 2 ** Math.max(0, this.quiet - 1), IDLE_MS)
    this.lookAt(Date.now() + wait, true)
  }

  run() {
    if (this.stopped || !this.leading) return
    if (this.running) {
      this.again = true
      return
    }
    // What's been written so far goes with this look.
    clearTimeout(this.next)
    this.lastLook = Date.now()
    this.written = false
    this.look = new AbortController()
    this.running = this.pass(this.look.signal).finally(() => this.after())
  }

  private after() {
    this.running = null
    this.look = null
    if (this.again && !this.stopped) {
      this.again = false
      this.run()
    } else this.later()
  }

  /** `work`, with no pass under way meanwhile; one asked for then runs after it (changeLibrary). */
  async hold<T>(work: () => Promise<T>): Promise<T> {
    while (this.running) await this.running
    let release!: () => void
    this.running = new Promise<void>((resolve) => (release = resolve))
    try {
      return await work()
    } finally {
      // A library changed, or fetched afresh: what sync knew of the documents is no longer what was sent.
      this.sentAt = -1
      this.after()
      release()
    }
  }

  /**
   * Once a day, which files this device's documents use, said to the server (sync/files `nameFiles`); and any of
   * them it has lost, sent again with a look made for it. Beside the look, not within it: it reads every document
   * and every past version, and within, the look showed as syncing and no other could start till it was done,
   * what was just written waiting with it. By requests of its own, which a look ended as Nib comes back doesn't
   * end; each is ended if it has no answer in REPORT_ANSWER_MS, or one that never answered (as when WebKit's
   * networking is lost under Nib) left this under way for good, and nothing said again till Nib was opened afresh.
   * Never the reason sync shows as failing (a server from before it listened, say).
   */
  private name() {
    if (this.naming || this.stopped) return
    const answered = () => {
      const ending = new AbortController()
      setTimeout(() => ending.abort(), REPORT_ANSWER_MS)
      return ending.signal
    }
    this.naming = nameFiles(this.keys, httpApi(SERVER, this.keys, answered))
      .then((lost) => {
        if (lost) this.run()
      })
      .catch((error: unknown) => console.warn('Nib: could not tell the server which files are used', error))
      .finally(() => (this.naming = null))
  }

  private async pass(ended: AbortSignal) {
    this.onStatus({ state: 'syncing' })
    try {
      // This device's own App Store receipt keeps the library paid for.
      // Sent whenever it changes (a renewal is a new one); the server only
      // ever extends, so a stale receipt from another device cannot cut it short.
      const jws = this.receipt()
      if (jws && jws !== this.sent) {
        // Refused (on too many libraries, refunded), or not reached: said in the log and tried again next look, and
        // this look goes on. It stopped here, every time, though the library was still paid for by another device's;
        // whether it is, is for the server to say to the look itself.
        try {
          await this.api.entitle(jws)
          this.sent = jws
        } catch (error) {
          console.warn('Nib: could not send this device’s receipt', error)
        }
      }
      // Read through for what to send only if written since a look that sent them all (engine `syncOnce`): every key
      // of every document and past version, on each look, was most of what a look cost. Unsettled till this one ends
      // well: stopped part-way, it may have left something only the reading would find.
      const writes = this.writes
      const unchanged = this.sentAt === writes
      this.sentAt = -1
      const { changed, full, tooLarge, copies, moved, clean } = await syncOnce(this.keys, this.api, Date.now(), unchanged)
      if (clean && this.writes === writes) this.sentAt = writes
      // Once a day, and never the reason sync shows as failing (a server not yet deployed with it, say).
      await expireHistory(this.api).catch((error: unknown) => console.warn('Nib: could not let go of old history on the server', error))
      // The files the documents name, after them; nor these the reason. More than a pass takes go in the next, at once.
      const files = await syncFiles(this.keys, this.api).catch((error: unknown) => {
        console.warn('Nib: could not sync files', error)
        return { full: false, more: false }
      })
      if (files.more) this.again = true
      this.name()
      // Posts waiting in the inbox, made into notes here and sent at once, with the next look. Nor these the reason.
      if (this.posts) {
        const made = await takePosts(this.keys, this.api, this.postsFolder()).catch((error: unknown) => {
          console.warn('Nib: could not take in the inbox', error)
          return 0
        })
        if (made) this.again = true
      }
      // Written elsewhere, and already applied: not today's writing here.
      for (const [id, words] of moved) notWrittenHere(id, words)
      if (this.stopped) return
      this.quiet = changed.length || copies ? 0 : this.quiet + 1
      if (changed.length || copies) this.onApplied(changed, copies)
      this.onStatus(
        full
          ? { state: 'error', message: 'Your sync storage is full. New changes stay on this device.' }
          : files.full
            ? { state: 'synced', at: Date.now(), message: 'The room for full-quality pictures and attachments on the server is full. New ones stay on this device.' }
            : tooLarge
            ? {
                state: 'synced',
                at: Date.now(),
                message: `${tooLarge === 1 ? 'One document is' : `${tooLarge} documents are`} too large to sync, usually because of images. ${tooLarge === 1 ? 'It stays' : 'They stay'} on this device.`,
              }
            : { state: 'synced', at: Date.now() },
      )
    } catch (error) {
      if (this.stopped) return
      // Ended as Nib came back (onVisible): not offline, and another is made at once.
      if (ended.aborted) {
        this.again = true
        return
      }
      // Lapsed, every look ends here: the server is still asked to let go of the history past what it keeps
      // (worker/library `expire` takes that without Plus), which it otherwise never was again.
      if (error instanceof SyncHttpError && error.status === 402) {
        await expireHistory(this.api).catch((failed: unknown) => console.warn('Nib: could not let go of old history on the server', failed))
        if (this.stopped) return
      }
      // Offline, or the server down: no need to ask it any more often.
      this.quiet += 1
      // Reset under it (a restored backup): it stopped, and a fresh pass runs now.
      if (error instanceof SyncReset) this.again = true
      else this.onStatus(describeError(error))
    }
  }
}
