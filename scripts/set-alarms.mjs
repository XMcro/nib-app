// Once, after the Worker that has /v1/alarms is deployed (worker/alarms): every sync library and every
// subscription's record is asked once, so each gets the alarm it is deleted by. One that nothing has reached
// since alarms came (libraries: 8 November 2026; subscriptions: this Worker) has none, and would be kept for ever.
//
//   npm run set-alarms -- [--dry]      --dry counts what's there and asks the server nothing
//
// Needs, in the environment:
//   CLOUDFLARE_ACCOUNT_ID   the account the Worker "nib" is in
//   CLOUDFLARE_API_TOKEN    a token that can read Workers scripts (it lists Durable Object ids, nothing more)
// The server is sync.nibprivacy.com, or NIB_SERVER (a local `wrangler dev`).
// The secret is COINS_ADMIN, or .coins-admin.local here, never committed.
//
// NOT RUN AGAINST CLOUDFLARE WHEN IT WAS WRITTEN (the server audit of 2026-11-23): its listing of objects is as
// Cloudflare's API documents it. Run it with --dry first, and check the counts look right. Whether objects kept
// in the EU jurisdiction are listed with the rest is the thing to look for: libraries made since 1 November 2026
// are there, so a count of libraries far below what's expected means they aren't, and this needs another way.
// Run again, it changes nothing.
import { existsSync, readFileSync } from 'node:fs'

const SECRET_FILE = new URL('../.coins-admin.local', import.meta.url)
const SERVER = process.env.NIB_SERVER ?? 'https://sync.nibprivacy.com'
const API = 'https://api.cloudflare.com/client/v4'
const WORKER = 'nib'
const KINDS = { LibraryObject: 'library', SubscriberObject: 'subscriber' }
/** As the server takes them (worker/alarms MAX_IDS). */
const AT_ONCE = 100

function fail(message) {
  console.error(message)
  process.exit(1)
}

const dry = process.argv.includes('--dry')
const unknown = process.argv.slice(2).filter((arg) => arg !== '--dry')
if (unknown.length) fail(`Not understood: ${unknown.join(' ')}. Usage: npm run set-alarms -- [--dry]`)

const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env
if (!account || !token) fail('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a token that can read Workers scripts).')
// The secret goes only to Nib's own server, or to this machine.
const { protocol, hostname } = new URL(SERVER)
if (!(protocol === 'https:' && hostname === 'sync.nibprivacy.com') && !['localhost', '127.0.0.1'].includes(hostname)) fail(`${SERVER} isn't Nib's server or this machine: the secret isn't sent there.`)
const secret = process.env.COINS_ADMIN ?? (existsSync(SECRET_FILE) ? readFileSync(SECRET_FILE, 'utf8').trim() : '')
if (!secret && !dry) fail('No secret: set COINS_ADMIN, or run npm run coin-code -- secret.')

/** One page from Cloudflare's API. */
async function cloudflare(path) {
  const response = await fetch(`${API}/accounts/${account}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.success === false) fail(`Cloudflare said ${response.status} for ${path.split('?')[0]}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`)
  return body
}

const namespaces = (await cloudflare('/workers/durable_objects/namespaces?per_page=100')).result.filter((one) => one.script === WORKER && KINDS[one.class])
if (namespaces.length === 0) fail(`No Durable Object namespaces found for the Worker "${WORKER}" with the classes ${Object.keys(KINDS).join(', ')}.`)

for (const namespace of namespaces) {
  const kind = KINDS[namespace.class]
  let [listed, asked, failed, cursor] = [0, 0, 0, '']
  do {
    const page = await cloudflare(`/workers/durable_objects/namespaces/${namespace.id}/objects?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    const ids = page.result.map((object) => object.id).filter((id) => /^[0-9a-f]{64}$/.test(id))
    listed += ids.length
    for (let at = 0; !dry && at < ids.length; at += AT_ONCE) {
      const response = await fetch(`${SERVER}/v1/alarms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ids: ids.slice(at, at + AT_ONCE) }),
      })
      if (response.status === 404) fail(`${SERVER} has no /v1/alarms, or didn't take the secret: is the Worker deployed, with COINS_ADMIN set?`)
      if (!response.ok) fail(`${SERVER} said ${response.status}.`)
      const answer = await response.json()
      asked += answer.asked
      failed += answer.failed.length
    }
    cursor = page.result_info?.cursor ?? ''
  } while (cursor)
  console.log(`${namespace.class}: ${listed} listed${dry ? '' : `, ${asked} asked, ${failed} that couldn't be`}.`)
}
if (dry) console.log('Nothing was asked of the server (--dry).')
