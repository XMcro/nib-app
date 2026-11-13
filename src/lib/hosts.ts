/**
 * Where the app syncs and shares from (lib/server), unless a local build
 * names its own server (VITE_SYNC_URL). Kept apart, with nothing imported,
 * so the build can read them too: the page's Content Security Policy lets it
 * reach these and no others (lib/csp).
 *
 * Sync is under Nib's own domain (wrangler.jsonc routes), not the Cloudflare
 * account's workers.dev name, which earlier Nibs sync with and the Worker
 * goes on answering. The Worker has to be deployed with the route
 * before a build that syncs here ships.
 */
export const SYNC_ORIGIN = 'https://sync.nibprivacy.com'
export const SHARE_ORIGIN = 'https://share.nibprivacy.com'
