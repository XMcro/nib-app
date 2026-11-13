#!/usr/bin/env node
/**
 * Deploy the sync server, shared drafts and the static site. Refuses to ship if a
 * secret-looking file (.env, .dev.vars, *.local, a signing key) has found its way
 * into site/ or website/site, where it would be served to anyone. Adapted from
 * draft PR #8.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

const secret = (name) => name === '.env' || name.startsWith('.env.') || name === '.dev.vars' || name.startsWith('.dev.vars.') || /\.(local|p8|pem|p12)$/.test(name)

function files(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, found)
    else found.push(path)
  }
  return found
}

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// website/site is built, and may not be there.
const hits = ['site', 'website/site'].filter((dir) => existsSync(dir)).flatMap((dir) => files(dir)).filter((path) => secret(basename(path)))
if (hits.length) {
  console.error(`Refusing to deploy: ${hits.join(', ')} would be public.`)
  process.exit(1)
}
// The reader page for shared drafts is served from site/, and built, not committed.
run('npm', ['run', 'build:reader'])
run('npx', ['wrangler', 'deploy'])
