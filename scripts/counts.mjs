// How Nib is used, from the totals on its server (worker/counts):
//
//   npm run counts -- [YYYY-MM-DD]     since that day; without one, the last 30 days
//
// "Times" is how often something was done. "Device-days" adds up, day by day,
// how many devices did it, so on a single day it's how many devices, and over
// several days someone using it every day counts once for each.
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
const response = await fetch(`${SERVER}/v1/counts?from=${encodeURIComponent(from)}`, { headers: { Authorization: `Bearer ${secret}` } })
if (!response.ok) {
  console.error(`The server said ${response.status}.`, await response.text())
  process.exit(1)
}
const { rows } = await response.json()
if (!rows.length) {
  console.log(`Nothing counted since ${from}.`)
  process.exit(0)
}

const add = (table, key, row) => {
  const line = (table[key] ??= { times: 0, devices: 0 })
  line.times += row.times
  line.devices += row.devices
}
const byEvent = {}
const opened = {}
for (const row of rows) {
  add(byEvent, row.event, row)
  if (row.event === 'opened') add(opened, row.device, row)
}
const print = (title, table) => {
  console.log(`\n${title.padEnd(26)}${'Times'.padStart(10)}${'Device-days'.padStart(14)}`)
  for (const [name, { times, devices }] of Object.entries(table).sort((a, b) => b[1].times - a[1].times)) {
    console.log(`${name.padEnd(26)}${times.toLocaleString().padStart(10)}${devices.toLocaleString().padStart(14)}`)
  }
}
console.log(`Since ${from}`)
print('What was used', byEvent)
print('Opened, by device', opened)
