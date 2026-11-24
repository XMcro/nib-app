// The files the server's own check has deleted from the store, and each time it ran (worker/sweeps):
//
//   npm run sweeps -- [YYYY-MM-DD]     since that day; without one, the last 30 days
//
// A file is named as the server knows it: the folder it was in (its library's object) and its key there. Neither
// says whose it was, or which document's.
//
// The server is sync.nibprivacy.com, or NIB_SERVER (a local `wrangler dev`).
// The secret is COINS_ADMIN, or .coins-admin.local here, never committed.
import { existsSync, readFileSync } from 'node:fs'

const SECRET_FILE = new URL('../.coins-admin.local', import.meta.url)
const SERVER = process.env.NIB_SERVER ?? 'https://sync.nibprivacy.com'
const secret = process.env.COINS_ADMIN ?? (existsSync(SECRET_FILE) ? readFileSync(SECRET_FILE, 'utf8').trim() : '')
if (!secret) {
  console.error('No secret: set COINS_ADMIN, or run npm run coin-code -- secret.')
  process.exit(1)
}

const from = process.argv[2] ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
const response = await fetch(`${SERVER}/v1/sweeps?from=${encodeURIComponent(from)}`, { headers: { Authorization: `Bearer ${secret}` } }).catch((error) => {
  console.error(`Couldn't reach ${SERVER}: ${error.message}`)
  process.exit(1)
})
if (!response.ok) {
  console.error(`The server said ${response.status}.`, await response.text())
  process.exit(1)
}
const { checks, deleted, more } = await response.json()
const when = (at) => new Date(at).toISOString().slice(0, 16).replace('T', ' ')
const size = (bytes) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.ceil(bytes / 1000)} KB`)

console.log(`Since ${from} (times in UTC)`)
console.log(`\nThe check ran ${checks.length} ${checks.length === 1 ? 'time' : 'times'}.`)
if (checks.length) {
  console.log(`${'When'.padEnd(18)}${'Looked at'.padStart(11)}${'Found'.padStart(7)}${'Deleted'.padStart(9)}${'Freed'.padStart(10)}  Whole store`)
  for (const check of checks) {
    console.log(`${when(check.at).padEnd(18)}${check.looked.toLocaleString().padStart(11)}${check.found.toLocaleString().padStart(7)}${check.deleted.toLocaleString().padStart(9)}${size(check.bytes).padStart(10)}  ${check.whole ? 'yes' : 'no: part of it, or a library didn’t answer'}`)
  }
}
console.log(`\n${deleted.length ? `${deleted.length.toLocaleString()} ${deleted.length === 1 ? 'file' : 'files'} found that nothing accounts for${more ? ' (the newest; ask from a later day for fewer)' : ''}:` : 'No file was found that nothing accounts for.'}`)
for (const file of deleted) console.log(`${when(file.at)}  ${file.left ? 'left   ' : 'deleted'}  ${file.why.padEnd(11)} ${size(file.size).padStart(8)}  ${file.home.slice(0, 12)}…/${file.k}`)
