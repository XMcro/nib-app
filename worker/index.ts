import { DurableObject } from 'cloudflare:workers'
import { armLibrary, handleAlarms } from './alarms'
import { APPLE_ROOT_G3 } from './apple-root'
import { CoinCodes, coinRequests, handleCoins, type CoinRequests } from './coins'
import { countRequests, Counts, handleCounts } from './counts'
import { frontDoor } from './door'
import { alertPhone, Feedback, feedbackRequests, handleFeedback } from './feedback'
import { checkFiles, placesOf, walkOf } from './filecheck'
import { emptyFiles, type FileStore } from './files'
import { fromHere } from './http'
import { verifySigned, verifyTransaction } from './jws'
import { Library, libraryRequests, retireLibrary, type LibraryRequests, type Region, type Sql } from './library'
import { handlePost } from './inbox'
import { handleNotification } from './notifications'
import { FreeQuota, quotaRequests, type QuotaRequests } from './quota'
import { expireShare, Share, shareRequests, type ShareRequests } from './share'
import { handleShares } from './shares'
import { retireSubscriber, Subscriber, subscriberRequests, type SubscriberRequests } from './subscriber'
import { handleSweeps, sweepRequests, Sweeps } from './sweeps'
import { handleSync } from './sync'
import { utcDay } from './wire.mjs'

type Env = {
  ASSETS: Fetcher
  LIBRARY: DurableObjectNamespace<LibraryObject>
  SHARE: DurableObjectNamespace<ShareObject>
  SUBSCRIBER: DurableObjectNamespace<SubscriberObject>
  QUOTA: DurableObjectNamespace<QuotaObject>
  COINS: DurableObjectNamespace<CoinsObject>
  COUNTS: DurableObjectNamespace<CountsObject>
  FEEDBACK: DurableObjectNamespace<FeedbackObject>
  SWEEPS: DurableObjectNamespace<SweepsObject>
  /** Sealed files (worker/files), in a bucket kept in the EU. */
  FILES: R2Bucket
  /** Opens the feedback kept here (worker/feedback); a Worker secret, set with wrangler. */
  FEEDBACK_KEY?: string
  /** For telling the owner's phone a message has come: its key on Bark's server, and the 32-character key set in the Bark app to seal the alert. Worker secrets. */
  FEEDBACK_BARK_DEVICE?: string
  FEEDBACK_BARK_CIPHER?: string
  /** Requests for a code's coins from one network, before they reach the one object all codes are in (worker/coins). */
  COINS_LIMIT?: RateLimit
  /** The secret that makes, reads and ends codes for coins (worker/coins); a Worker secret, set with wrangler. */
  COINS_ADMIN?: string
  /** The Ed25519 key a code's coins are signed with (worker/coins), base64 of its PKCS#8; a Worker secret. The app holds the public half. */
  COINS_SIGNING_KEY?: string
  /** Local development only (.dev.vars): accept Xcode's StoreKit test purchases. */
  STOREKIT_XCODE?: string
  /** "1" has the daily check of the file store delete what it finds (worker/filecheck). Anything else, it only looks, and writes down what it would have deleted. */
  FILE_CHECK_DELETES?: string
  /** "1" turns off reading and notes on every shared draft. Owners can still revoke. */
  SHARES_OFF?: string
  /** Comma-separated slugs, or subscriber keys from the logs, whose shares stop serving. */
  SHARES_BLOCKED?: string
}

const roots = [Uint8Array.from(atob(APPLE_ROOT_G3), (c) => c.charCodeAt(0))]

function sqlOf(ctx: DurableObjectState): Sql {
  return {
    all: (query, ...args) => ctx.storage.sql.exec(query, ...args).toArray() as Record<string, string | number | null>[],
    run: (query, ...args) => void ctx.storage.sql.exec(query, ...args),
    transaction: (fn) => ctx.storage.transactionSync(fn),
  }
}

/** The file store, in R2. A file that doesn't hash to what was said of it isn't kept: R2 checks it as it arrives. */
const filesIn = (bucket: R2Bucket): FileStore => ({
  put: async (name, body, sha256) => (await bucket.put(name, body, { sha256 })).size,
  get: async (name) => {
    const object = await bucket.get(name)
    return object && { body: object.body, size: object.size }
  },
  delete: (names) => bucket.delete(names),
  list: async (prefix) => (await bucket.list({ prefix })).objects.map((object) => object.key),
})

/** One per sync library, holding its records in its own SQLite database, and the posts waiting in its inbox. */
export class LibraryObject extends DurableObject<Env> {
  private library = new Library(sqlOf(this.ctx))
  private effects = {
    // Asked at every request, so written only when it changes.
    alarm: async (at: number | null) => {
      if ((await this.ctx.storage.getAlarm()) === at) return
      await (at === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(at))
    },
    // Its files are kept under this object's own id, which is one library's in one region and nothing a request can name.
    home: this.ctx.id.toString(),
    deleteFiles: () => emptyFiles(filesIn(this.env.FILES), this.ctx.id.toString()),
    release: async (id: string, subscriptions: string[]) => {
      await Promise.all(subscriptions.map((key) => this.env.SUBSCRIBER.get(this.env.SUBSCRIBER.idFromName(key)).releaseLibrary(id)))
    },
  }
  private requests = libraryRequests(this.library, Date.now, this.effects)

  create(...args: Parameters<LibraryRequests['create']>) { return this.requests.create(...args) }
  entitle(...args: Parameters<LibraryRequests['entitle']>) { return this.requests.entitle(...args) }
  status(...args: Parameters<LibraryRequests['status']>) { return this.requests.status(...args) }
  authorise(...args: Parameters<LibraryRequests['authorise']>) { return this.requests.authorise(...args) }
  changes(...args: Parameters<LibraryRequests['changes']>) { return this.requests.changes(...args) }
  push(...args: Parameters<LibraryRequests['push']>) { return this.requests.push(...args) }
  expire(...args: Parameters<LibraryRequests['expire']>) { return this.requests.expire(...args) }
  enroll(...args: Parameters<LibraryRequests['enroll']>) { return this.requests.enroll(...args) }
  requireSigned(...args: Parameters<LibraryRequests['requireSigned']>) { return this.requests.requireSigned(...args) }
  wipe(...args: Parameters<LibraryRequests['wipe']>) { return this.requests.wipe(...args) }
  fileRoom(...args: Parameters<LibraryRequests['fileRoom']>) { return this.requests.fileRoom(...args) }
  fileStored(...args: Parameters<LibraryRequests['fileStored']>) { return this.requests.fileStored(...args) }
  fileFailed(...args: Parameters<LibraryRequests['fileFailed']>) { return this.requests.fileFailed(...args) }
  fileMissing(...args: Parameters<LibraryRequests['fileMissing']>) { return this.requests.fileMissing(...args) }
  files(...args: Parameters<LibraryRequests['files']>) { return this.requests.files(...args) }
  namedFiles(...args: Parameters<LibraryRequests['namedFiles']>) { return this.requests.namedFiles(...args) }
  removeFile(...args: Parameters<LibraryRequests['removeFile']>) { return this.requests.removeFile(...args) }
  revoke(...args: Parameters<LibraryRequests['revoke']>) { return this.requests.revoke(...args) }
  paidTo(...args: Parameters<LibraryRequests['paidTo']>) { return this.requests.paidTo(...args) }
  arm() { return this.requests.arm() }
  unlisted(...args: Parameters<LibraryRequests['unlisted']>) { return this.requests.unlisted(...args) }
  swept(...args: Parameters<LibraryRequests['swept']>) { return this.requests.swept(...args) }
  signs() { return this.requests.signs() }
  gone() { return this.requests.gone() }
  setInbox(...args: Parameters<LibraryRequests['setInbox']>) { return this.requests.setInbox(...args) }
  endInbox(...args: Parameters<LibraryRequests['endInbox']>) { return this.requests.endInbox(...args) }
  inbox(...args: Parameters<LibraryRequests['inbox']>) { return this.requests.inbox(...args) }
  tookPosts(...args: Parameters<LibraryRequests['tookPosts']>) { return this.requests.tookPosts(...args) }
  inboxFor(...args: Parameters<LibraryRequests['inboxFor']>) { return this.requests.inboxFor(...args) }
  addPost(...args: Parameters<LibraryRequests['addPost']>) { return this.requests.addPost(...args) }

  /** The date it's to be deleted, or an earlier one since moved (worker/library retireLibrary). */
  alarm() {
    return retireLibrary(this.library, Date.now(), this.effects)
  }
}

/** One per shared draft: its sealed document and readers' sealed notes. Deletes itself at expiry. */
export class ShareObject extends DurableObject<Env> {
  private share = new Share(sqlOf(this.ctx))
  private effects = {
    subscriber: (key: string) => this.env.SUBSCRIBER.get(this.env.SUBSCRIBER.idFromName(key)),
    alarm: (at: number | null) => (at === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(at)),
  }
  private requests = shareRequests(this.share, this.effects)

  create(...args: Parameters<ShareRequests['create']>) { return this.requests.create(...args) }
  read(...args: Parameters<ShareRequests['read']>) { return this.requests.read(...args) }
  countOpen(...args: Parameters<ShareRequests['countOpen']>) { return this.requests.countOpen(...args) }
  guarded(...args: Parameters<ShareRequests['guarded']>) { return this.requests.guarded(...args) }
  reveal(...args: Parameters<ShareRequests['reveal']>) { return this.requests.reveal(...args) }
  takesNotes(...args: Parameters<ShareRequests['takesNotes']>) { return this.requests.takesNotes(...args) }
  addNote(...args: Parameters<ShareRequests['addNote']>) { return this.requests.addNote(...args) }
  notes(...args: Parameters<ShareRequests['notes']>) { return this.requests.notes(...args) }
  deleteNote(...args: Parameters<ShareRequests['deleteNote']>) { return this.requests.deleteNote(...args) }
  update(...args: Parameters<ShareRequests['update']>) { return this.requests.update(...args) }
  unentitle() { return this.requests.unentitle() }
  revoke(...args: Parameters<ShareRequests['revoke']>) { return this.requests.revoke(...args) }

  alarm() {
    return expireShare(this.share, Date.now(), this.effects)
  }
}

/**
 * One per App Store subscription that has synced, shared a draft, or been told of by the App Store: how long it's
 * paid for, its live shares and the libraries it pays for. Deletes itself a year past the last it was paid to
 * (worker/subscriber `forgetAt`).
 */
export class SubscriberObject extends DurableObject<Env> {
  private subscriber = new Subscriber(sqlOf(this.ctx))
  private effects = {
    // Asked at every request, so written only when it changes.
    alarm: async (at: number | null) => {
      if ((await this.ctx.storage.getAlarm()) === at) return
      await (at === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(at))
    },
    deleteAll: () => this.ctx.storage.deleteAll(),
  }
  private requests = subscriberRequests(this.subscriber, Date.now, this.effects)

  entitle(...args: Parameters<SubscriberRequests['entitle']>) { return this.requests.entitle(...args) }
  expiry() { return this.requests.expiry() }
  admit(...args: Parameters<SubscriberRequests['admit']>) { return this.requests.admit(...args) }
  extend(...args: Parameters<SubscriberRequests['extend']>) { return this.requests.extend(...args) }
  release(...args: Parameters<SubscriberRequests['release']>) { return this.requests.release(...args) }
  claimLibrary(...args: Parameters<SubscriberRequests['claimLibrary']>) { return this.requests.claimLibrary(...args) }
  releaseLibrary(...args: Parameters<SubscriberRequests['releaseLibrary']>) { return this.requests.releaseLibrary(...args) }
  revoke(...args: Parameters<SubscriberRequests['revoke']>) { return this.requests.revoke(...args) }
  unrevoke(...args: Parameters<SubscriberRequests['unrevoke']>) { return this.requests.unrevoke(...args) }
  paidTo(...args: Parameters<SubscriberRequests['paidTo']>) { return this.requests.paidTo(...args) }

  /** The date it's to be deleted, or an earlier one since moved (worker/subscriber retireSubscriber). */
  alarm() {
    return retireSubscriber(this.subscriber, Date.now(), this.effects)
  }
}

/** One per IP address (by a hash keyed with the Worker's secret) that has started a free share or left a note: how many, by day. */
export class QuotaObject extends DurableObject<Env> {
  private requests = quotaRequests(new FreeQuota(sqlOf(this.ctx)), { alarm: (at) => this.ctx.storage.setAlarm(at) })

  spend(...args: Parameters<QuotaRequests['spend']>) { return this.requests.spend(...args) }
  refund() { return this.requests.refund() }
  used() { return this.requests.used() }

  /** At the end of the day: nothing is kept past the day it counts, not even the object. */
  alarm() {
    return this.ctx.storage.deleteAll()
  }
}

/** The one object every code for coins is kept in (worker/coins), so a use is never counted twice. */
export class CoinsObject extends DurableObject<Env> {
  private codes = new CoinCodes(sqlOf(this.ctx))
  private requests = coinRequests(this.codes, { alarm: (at) => this.ctx.storage.setAlarm(at) })

  redeem(...args: Parameters<CoinRequests['redeem']>) { return this.requests.redeem(...args) }
  set(...args: Parameters<CoinRequests['set']>) { return this.requests.set(...args) }
  show(...args: Parameters<CoinRequests['show']>) { return this.requests.show(...args) }
  end(...args: Parameters<CoinRequests['end']>) { return this.requests.end(...args) }

  alarm() {
    this.codes.forget(utcDay(Date.now()))
  }
}

/** The one object the totals of how Nib is used are kept in (worker/counts). */
export class CountsObject extends DurableObject<Env> {
  private requests = countRequests(new Counts(sqlOf(this.ctx)))

  add(...args: Parameters<ReturnType<typeof countRequests>['add']>) { return this.requests.add(...args) }
  since(...args: Parameters<ReturnType<typeof countRequests>['since']>) { return this.requests.since(...args) }
}

/** The one object feedback is kept in until it's read and deleted (worker/feedback). */
export class FeedbackObject extends DurableObject<Env> {
  private requests = feedbackRequests(new Feedback(sqlOf(this.ctx)))

  add(...args: Parameters<ReturnType<typeof feedbackRequests>['add']>) { return this.requests.add(...args) }
  list() { return this.requests.list() }
  remove(...args: Parameters<ReturnType<typeof feedbackRequests>['remove']>) { return this.requests.remove(...args) }
  clear(...args: Parameters<ReturnType<typeof feedbackRequests>['clear']>) { return this.requests.clear(...args) }
}

/** The one object the trail of files the server's own check deleted is kept in (worker/sweeps). */
export class SweepsObject extends DurableObject<Env> {
  private requests = sweepRequests(new Sweeps(sqlOf(this.ctx)))

  deleted(...args: Parameters<ReturnType<typeof sweepRequests>['deleted']>) { return this.requests.deleted(...args) }
  checked(...args: Parameters<ReturnType<typeof sweepRequests>['checked']>) { return this.requests.checked(...args) }
  since(...args: Parameters<ReturnType<typeof sweepRequests>['since']>) { return this.requests.since(...args) }
  position() { return this.requests.position() }
  undeleted(...args: Parameters<ReturnType<typeof sweepRequests>['undeleted']>) { return this.requests.undeleted(...args) }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Xcode's own test purchases, and coins unsigned, only for `wrangler dev` on the developer's machine: set on the
    // deployed Worker by mistake, the variable is kept from deploy to deploy (wrangler.jsonc keep_vars), and anyone
    // could then have made receipts. Never for what the App Store sends, which Xcode doesn't.
    const local = env.STOREKIT_XCODE === '1' && fromHere(request)
    const trust = { roots, allowXcode: local }
    const verify = (jws: string) => verifyTransaction(jws, trust)
    // New libraries are kept in the EU (worker/library findLibrary); those made before, where they were made.
    const library = (id: string, region: Region) => env.LIBRARY.get((region === 'eu' ? env.LIBRARY.jurisdiction('eu') : env.LIBRARY).idFromName(id))
    const subscriber = (key: string) => env.SUBSCRIBER.get(env.SUBSCRIBER.idFromName(key))
    const share = (slug: string) => env.SHARE.get(env.SHARE.idFromName(slug))
    const quota = (key: string) => env.QUOTA.get(env.QUOTA.idFromName(key))
    return frontDoor(request, {
      assets: (asked) => env.ASSETS.fetch(asked),
      notifications: (asked) => handleNotification(asked, { verify: (jws) => verifySigned(jws, { roots }), subscriber, library, share }),
      shares: (asked) =>
        handleShares(asked, {
          share,
          subscriber,
          quota,
          secret: env.COINS_ADMIN,
          verify,
          off: env.SHARES_OFF === '1',
          blocked: (env.SHARES_BLOCKED ?? '').split(',').map((entry) => entry.trim()).filter(Boolean),
          now: Date.now,
        }),
      coins: (asked) => handleCoins(asked, { coins: env.COINS.get(env.COINS.idFromName('codes')), admin: env.COINS_ADMIN, signingKey: env.COINS_SIGNING_KEY, local, limiter: env.COINS_LIMIT }),
      alarms: (asked) =>
        handleAlarms(asked, {
          admin: env.COINS_ADMIN,
          arm: async (kind, id) => {
            // Asked when it's paid to, which changes nothing: any request sets its alarm (worker/subscriber).
            if (kind === 'subscriber') return (await (env.SUBSCRIBER.get(env.SUBSCRIBER.idFromString(id)) as unknown as SubscriberRequests).expiry()).status === 200
            // A library's id is one made in the EU or one from before: asked as each (worker/alarms `armLibrary`).
            const places = [env.LIBRARY.jurisdiction('eu'), env.LIBRARY]
            return armLibrary(places.map((place) => (named: string) => (place.get(place.idFromString(named)) as unknown as LibraryRequests).arm()), id)
          },
        }),
      // In the EU, as the files it's of are.
      sweeps: (asked) => handleSweeps(asked, { sweeps: env.SWEEPS.get(env.SWEEPS.jurisdiction('eu').idFromName('trail')), secret: env.COINS_ADMIN }),
      counts: (asked) => handleCounts(asked, { counts: env.COUNTS.get(env.COUNTS.idFromName('totals')), quota, secret: env.COINS_ADMIN, now: Date.now }),
      feedback: (asked) => {
        const [device, cipher] = [env.FEEDBACK_BARK_DEVICE, env.FEEDBACK_BARK_CIPHER]
        return handleFeedback(asked, {
          inbox: env.FEEDBACK.get(env.FEEDBACK.jurisdiction('eu').idFromName('messages')),
          alert: device && cipher ? () => ctx.waitUntil(alertPhone({ device, cipher })) : undefined,
          quota,
          secret: env.COINS_ADMIN,
          key: env.FEEDBACK_KEY,
          now: Date.now,
        })
      },
      inbox: (asked) => handlePost(asked, { library }),
      sync: (asked) => handleSync(asked, { library, subscriber, verify, files: filesIn(env.FILES), waitUntil: (work) => ctx.waitUntil(work), quota, secret: env.COINS_ADMIN }),
    })
  },
  /** Once a day (wrangler.jsonc `triggers`): the file store looked through for files nothing accounts for (worker/filecheck). */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const trail = env.SWEEPS.get(env.SWEEPS.jurisdiction('eu').idFromName('trail'))
    await checkFiles({
      ...walkOf(env.FILES),
      // A library's folder is named by its object's id, which is one made in the EU or one from before: asked as each.
      places: placesOf([env.LIBRARY.jurisdiction('eu'), env.LIBRARY]),
      trail,
      now: Date.now(),
      deletes: env.FILE_CHECK_DELETES === '1',
    })
  },
} satisfies ExportedHandler<Env>
