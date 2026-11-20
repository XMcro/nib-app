#!/usr/bin/env node
/**
 * At an App Store release, the web side in one go: the Nib Worker (sync,
 * shared drafts, the reader page and the app's privacy page), then
 * nibprivacy.com, then a check that each address is serving this release.
 *
 *   npm run release:web            deploy both, then check
 *   npm run release:web -- --check check only
 *
 * Wrangler must be logged in to the Cloudflare account that has both Workers.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Something only this release says, at each address.
const CHECKS = [
  // Free links and notes counted by network too (25 October 2026).
  ['https://nib.social-alias.workers.dev/privacy', 'one address, or one network'],
  // Where Nib syncs from now on: the same Worker under nibprivacy.com.
  ['https://sync.nibprivacy.com/privacy', 'one address, or one network'],
  // How to send a note to the inbox, which the app and the policy link to.
  ['https://sync.nibprivacy.com/inbox', 'Sending notes to your inbox'],
  // A draft that isn't one says so, instead of crashing the page.
  ['https://share.nibprivacy.com/reader.js', 'Ask the writer to share it again'],
  // The site redrawn for 1.10.09, with its new features.
  ['https://nibprivacy.com/', 'Six chapters, and a few appendices.'],
  ['https://nibprivacy.com/inkwell.js', 'nib-inkwell-story'],
  // The update log, with this release in it and its day filled in.
  ['https://nibprivacy.com/updates/', `id="v${version.replaceAll('.', '-')}-h">${version}</h2><time`],
  ['https://nibprivacy.com/privacy/', 'one address, or one network'],
]

if (!process.argv.includes('--check')) {
  run('npm', ['run', 'deploy'])
  run('python3', ['website/build_site.py'])
  run('npx', ['wrangler', 'deploy', '--config', 'website/wrangler.jsonc'])
}

const serving = async ([url, marker]) => {
  try {
    const response = await fetch(url, { cache: 'no-store' })
    return response.ok && (await response.text()).includes(marker)
  } catch {
    return false
  }
}

// A new deploy can take a few seconds to reach every edge.
let missing = CHECKS
for (let attempt = 0; attempt < 5 && missing.length; attempt++) {
  if (attempt) await new Promise((resolve) => setTimeout(resolve, 3000))
  const results = await Promise.all(missing.map(serving))
  missing = missing.filter((_, i) => !results[i])
}
for (const [url] of CHECKS) console.log(`${missing.some(([other]) => other === url) ? 'not yet' : 'ok     '}  ${url}`)
if (missing.length) {
  console.error('\nNot everything is serving this release yet. Wait a minute, then: npm run release:web -- --check')
  process.exit(1)
}
console.log('\nThe web side of the release is live.')
