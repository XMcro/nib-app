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

/** Every request the Worker takes: whose it is, the app's own origin asking first, and a body past its route's limit, each said once. */
export async function frontDoor(request: Request, routes: Routes): Promise<Response> {
  const path = new URL(request.url).pathname
  if (PAGE.test(path) && request.method === 'GET') return new Response(READER_PAGE, { headers: READER_HEADERS })
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
