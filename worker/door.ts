import { SYNC_ORIGIN } from '../src/lib/hosts'
import { cors, json, TooLarge } from './http'
import { NOTIFICATIONS_PATH } from './notifications'
import { PAGE, READER_HEADERS, READER_PAGE } from './shares'

type Route = (request: Request) => Promise<Response>
export type Routes = Record<'assets' | 'notifications' | 'shares' | 'coins' | 'counts' | 'feedback' | 'inbox' | 'sync', Route>

/** Whose a path under /v1/ is. Anything else is the sync API's, which says it wants a library's credentials. */
function routeOf(path: string, routes: Routes): Route {
  if (path === '/v1/shares' || path.startsWith('/v1/shares/')) return routes.shares
  if (path.startsWith('/v1/coins/')) return routes.coins
  if (path === '/v1/counts') return routes.counts
  if (path === '/v1/feedback' || path.startsWith('/v1/feedback/')) return routes.feedback
  // A post from a service, to an inbox's address (worker/inbox). A device's side of its inbox, /v1/inbox, is the sync API's.
  if (path.startsWith('/v1/in/')) return routes.inbox
  return routes.sync
}

/**
 * On every answer, by whichever of its addresses it leaves: the nibprivacy.com zone adds these itself, and the
 * workers.dev address earlier Nibs sync with had none of them (the red-team review of 2026-11-17).
 */
const ON_EVERY_ANSWER: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
}
/** Where the owner's page of feedback is, its key kept in that origin's storage (worker/feedback-page): no stranger's draft is shown there. */
const SYNC_HOST = new URL(SYNC_ORIGIN).hostname

/** Every request the Worker takes (`routed`), its answer sent with the headers every answer has, where it hasn't its own. */
export async function frontDoor(request: Request, routes: Routes): Promise<Response> {
  const answer = await routed(request, routes)
  // A copy: the headers of an answer from the site's files, or from a Durable Object, can't be changed.
  const headers = new Headers(answer.headers)
  for (const [name, value] of Object.entries(ON_EVERY_ANSWER)) if (!headers.has(name)) headers.set(name, value)
  return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers })
}

/** Whose a request is, the app's own origin asking first, and a body past its route's limit, each said once. */
async function routed(request: Request, routes: Routes): Promise<Response> {
  const { pathname: path, hostname } = new URL(request.url)
  if (PAGE.test(path) && request.method === 'GET' && hostname !== SYNC_HOST) return new Response(READER_PAGE, { headers: READER_HEADERS })
  // Only /v1/* and /d/* reach here (assets.run_worker_first); everything else is the site.
  if (!path.startsWith('/v1/')) return routes.assets(request)
  try {
    // From Apple, so before the sync API, which wants a library's credentials; and Apple never asks first.
    if (path === NOTIFICATIONS_PATH) return await routes.notifications(request)
    // The app's own origin asks first, for a JSON body.
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) })
    return await routeOf(path, routes)(request)
  } catch (error) {
    if (error instanceof TooLarge) return json(request, 413, { error: 'Too large.' })
    throw error
  }
}
