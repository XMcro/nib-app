import type { Call } from './answer'
import { isAdmin, json, readJson } from './http'

/**
 * A one-off, for the libraries and subscriptions from before each had an alarm to be deleted by (worker/library
 * `nextAlarm`, worker/subscriber `forgetAt`). An alarm is set when its object is next asked anything, and one that
 * nothing reaches again never is: a library last used before 8 November 2026, its subscription already ended, was
 * kept for ever (the server audit of 2026-11-23). scripts/set-alarms.mjs lists every object's id from Cloudflare's
 * API and sends them here, for each to be asked once; asked again, nothing changes.
 *
 *   POST /v1/alarms   { kind: 'library' | 'subscriber', ids: [...] }   with COINS_ADMIN
 *
 * Without the secret it's not found, as the codes' own routes are (worker/coins).
 */
export type AlarmKind = 'library' | 'subscriber'
export type AlarmDeps = {
  /** COINS_ADMIN. Unset, it's not served. */
  admin: string | undefined
  /** The object of this `kind` with this id, asked once, so its alarm is set. False if the id isn't one of that kind's, or it couldn't be asked. */
  arm(kind: AlarmKind, id: string): Promise<boolean>
}

/**
 * A library asked once to set its alarm (worker/library `arm`), in each place one may be kept: `asks`, the EU's and
 * then where libraries were made before. Its id is one place's, and the other refuses it, or has an object by it
 * that holds nothing, which is left holding nothing. True for a library, or the mark of one deleted.
 */
export async function armLibrary(asks: ((id: string) => Promise<Call>)[], id: string): Promise<boolean> {
  for (const ask of asks) {
    try {
      const { library, gone } = (await ask(id)).body as { library?: boolean; gone?: boolean }
      if (library || gone) return true
    } catch {
      // Not an id of that place's.
    }
  }
  return false
}

/** A Durable Object's id, as Cloudflare's API lists them. */
const OBJECT_ID = /^[0-9a-f]{64}$/
/** Ids in one request: each is a request to an object of its own. */
export const MAX_IDS = 100

export async function handleAlarms(request: Request, deps: AlarmDeps): Promise<Response> {
  if (!(await isAdmin(request, deps.admin)) || request.method !== 'POST') return json(request, 404, { error: 'Not found.' })
  const body = await readJson(request, 16_000)
  const { kind, ids } = body ?? {}
  if ((kind !== 'library' && kind !== 'subscriber') || !Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === 'string' && OBJECT_ID.test(id))) {
    return json(request, 400, { error: `Expected { kind: 'library' | 'subscriber', ids }, up to ${MAX_IDS} ids.` })
  }
  const asked = await Promise.all((ids as string[]).map((id) => deps.arm(kind, id).catch(() => false)))
  return json(request, 200, { asked: asked.filter(Boolean).length, failed: (ids as string[]).filter((_, at) => !asked[at]) })
}
