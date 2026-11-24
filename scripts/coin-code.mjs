// Codes for coins, on Nib's server (worker/coins):
//
//   npm run coin-code -- make <coins> [--uses N|none] [--until YYYY-MM-DD|none] [--code CODE]
//       A code worth <coins>, for N uses (any number without --uses), till
//       its last day (UTC) if it has one. Without --code, one is made at
//       random (NIB-XXXX-XXXX-XXXX); one given needs 12 letters and digits
//       or more after NIB. Making a code that's there already changes it: its coins
//       always, its uses and last day only if given (none takes them away),
//       its uses so far stay counted, and an ended one opens again.
//   npm run coin-code -- show <CODE>      how many uses it's had
//   npm run coin-code -- end <CODE>       no more uses
//   npm run coin-code -- secret           a new secret, kept in .coins-admin.local, to put on the Worker
//
// The server is sync.nibprivacy.com, or NIB_SERVER (a local `wrangler dev`).
// The secret is COINS_ADMIN, or .coins-admin.local here, never committed.
// Only a code's fingerprint goes to the server, never the code.
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fingerprintInput, MAX_COINS, normalCode, realDay } from '../worker/wire.mjs'

const SECRET_FILE = new URL('../.coins-admin.local', import.meta.url)
const SERVER = process.env.NIB_SERVER ?? 'https://sync.nibprivacy.com'
const [command, ...rest] = process.argv.slice(2)

function fail(message) {
  console.error(message)
  process.exit(1)
}

/**
 * --name value pairs, of the `known` names, and what's left. Anything else that begins -- is a mistake to say,
 * not to pass over: --use 5, or --uses=5, made a code for any number of uses, and --code with nothing after it a random one.
 * One given twice is too: the last was taken, so --uses 5 --uses none made a code with no limit.
 */
function options(args, known) {
  const found = {}
  const left = []
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) {
      left.push(args[i])
      continue
    }
    const name = args[i].slice(2)
    if (!known.includes(name)) fail(`Not understood: ${args[i]}. The options are ${known.map((one) => `--${one}`).join(', ')}, each with its value after a space, as --uses 5.`)
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) fail(`${args[i]} needs a value after it.`)
    if (name in found) fail(`${args[i]} is given twice.`)
    found[name] = args[++i]
  }
  return { found, left }
}

// npm run coin-code make 100 --uses 5, without the -- before it: npm keeps the options for itself, says nothing,
// and this was run with none, and made a code for any number of uses.
const kept = ['uses', 'until', 'code'].filter((name) => process.env[`npm_config_${name}`] !== undefined)
if (kept.length) fail(`npm took ${kept.map((name) => `--${name}`).join(' and ')} for itself. Put -- before the command: npm run coin-code -- make 100 --uses 5.`)

// As src/lib/codes.ts's fingerprintOf has it.
const fingerprintOf = (code) => createHash('sha256').update(fingerprintInput(code)).digest('hex')

function secret() {
  const secret = process.env.COINS_ADMIN ?? (existsSync(SECRET_FILE) ? readFileSync(SECRET_FILE, 'utf8').trim() : '')
  if (!secret) fail('No secret: run npm run coin-code -- secret, and put it on the Worker.')
  return secret
}

async function ask(method, path, body) {
  const response = await fetch(`${SERVER}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  }).catch((error) => fail(`Couldn't reach ${SERVER}: ${error.message}`))
  const answer = await response.json().catch(() => ({}))
  if (response.status === 404 && answer.error === 'unknown') fail('No such code on the server.')
  if (response.status === 404) fail(`${SERVER} didn't take the secret, or has no codes for coins yet (is the Worker deployed, with COINS_ADMIN set?).`)
  if (!response.ok) fail(`${SERVER} said ${response.status}: ${answer.error ?? ''}`)
  return answer
}

const describe = (state) =>
  `${state.coins} coins, used ${state.used}${state.uses === null ? '' : ` of ${state.uses}`}${state.until ? `, last day ${state.until} (UTC)` : ''}${state.ended ? ', ended' : ''}`

if (command === 'secret') {
  if (existsSync(SECRET_FILE)) fail('There is a secret already, in .coins-admin.local. Delete it first to make a new one.')
  const made = randomBytes(32).toString('base64url')
  writeFileSync(SECRET_FILE, `${made}\n`, { mode: 0o600 })
  console.log('Kept in .coins-admin.local. Put the same on the Worker, pasting it when asked:')
  console.log('  npx wrangler secret put COINS_ADMIN')
  console.log(made)
} else if (command === 'make') {
  const { found, left } = options(rest, ['uses', 'until', 'code'])
  // Anything else given is a mistake to say, not to pass over: a code given without --code was, and a random one made in its place.
  if (left.length > 1) fail(`Not understood: ${left.slice(1).join(' ')}. A code of your own goes after --code, as --code ${left[1]}.`)
  // 999,999 as well as 999999.
  const coins = Number(String(left[0] ?? '').replace(/,/g, ''))
  if (Number.isInteger(coins) && coins > MAX_COINS) fail(`A code gives at most ${MAX_COINS.toLocaleString('en-US')} coins.`)
  // Only what's given goes, so a code made again keeps the rest: none is null, which takes it away.
  const uses = !('uses' in found) ? undefined : found.uses === 'none' ? null : Number(found.uses)
  const until = !('until' in found) ? undefined : found.until === 'none' ? null : (found.until ?? '')
  // As the server checks: a day the calendar has, and no more than a million coins.
  if (!Number.isInteger(coins) || coins <= 0 || coins > MAX_COINS || (uses != null && (!Number.isInteger(uses) || uses <= 0)) || (until != null && !realDay(until))) {
    fail('Usage: npm run coin-code -- make <coins> [--uses N|none] [--until YYYY-MM-DD|none] [--code CODE]')
  }
  // No 0 or O, 1 or I: easy to read out and type.
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const part = () => Array.from({ length: 4 }, () => letters[randomInt(letters.length)]).join('')
  const code = found.code ?? `NIB-${part()}-${part()}-${part()}`
  // The server keeps a hash of the code, and the app holds it: one short enough can be found from it on a GPU.
  if (found.code !== undefined && normalCode(found.code).replace(/^NIB/, '').length < 12) {
    fail('A code needs 12 letters and digits or more after NIB: the server knows it by a hash, and a shorter one can be found from that on a GPU in minutes. Leave out --code for one made at random.')
  }
  const state = await ask('POST', '/v1/coins/codes', { code: fingerprintOf(code), coins, ...(uses !== undefined && { uses }), ...(until !== undefined && { until }) })
  console.log(`Code to give out: ${code}`)
  console.log(`On ${SERVER}: ${describe(state)}.`)
} else if (command === 'show' || command === 'end') {
  if (!rest[0]) fail(`Usage: npm run coin-code -- ${command} <CODE>`)
  const state = await ask(command === 'show' ? 'GET' : 'DELETE', `/v1/coins/codes/${fingerprintOf(rest[0])}`)
  console.log(`${rest[0]}: ${describe(state)}.`)
} else {
  fail('npm run coin-code -- make <coins> [--uses N|none] [--until YYYY-MM-DD|none] [--code CODE] | show <CODE> | end <CODE> | secret')
}
