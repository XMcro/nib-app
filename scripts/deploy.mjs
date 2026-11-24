#!/usr/bin/env node
/**
 * Deploy the sync server, shared drafts and the static site, as they are committed.
 *
 * Refuses if a file that mustn't be public has found its way into site/ or website/site, or site/ holds anything
 * not committed there (scripts/public-files). And refuses if what ships has changes that aren't committed: it
 * deployed whatever was in the folder it was run in, an edit half made to the policy or the Worker among it, and
 * nothing recorded which commit was live (the server audit of 2026-11-23). The commit is given to Cloudflare with
 * the version, where the dashboard shows it.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { clearBuilt, keptByNpm, notTheDeployBranch, refuseInTests, refuseSecrets, refuseStrays, ROOT } from './public-files.mjs'

refuseInTests()
// Only when told to, in so many words: npm run deploy -- --go. An option typed before the --, or with none
// (--dry-run, --dryrun, anything), npm keeps for itself and says nothing, and this was run as if nothing had been
// said: it deployed. What npm keeps never reaches here, so what's wanted has to.
if (process.argv.length !== 3 || process.argv[2] !== '--go' || keptByNpm().length) {
  console.error('Refusing to deploy: this deploys only as npm run deploy -- --go (with the -- before it). It has no other options, and no dry run.')
  process.exit(1)
}
// From the project, wherever it was run from.
process.chdir(ROOT)

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const git = (...args) => {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.status !== 0) {
    console.error(`Refusing to deploy: git ${args[0]} failed, so what's being deployed can't be said.`)
    process.exit(1)
  }
  return result.stdout.trim()
}

// Anything committed that has since been changed, anywhere, and anything new where the Worker and its site are, or
// where the website is built from: its build copies whole folders, whatever is in them (website/build_site.py).
// Said in full, whatever git is set to show here (status.showUntrackedFiles); and what git is told to pass over, in
// the folders the website's build copies whole: passed over, it's copied all the same.
const changed = [
  git('status', '--porcelain', '--untracked-files=no'),
  // src too: the Worker, the reader page and the website's script are built from files there.
  git('status', '--porcelain', '--untracked-files=all', '--', 'worker', 'site', 'wrangler.jsonc', 'website', 'src'),
  git('status', '--porcelain', '--untracked-files=all', '--ignored', '--', 'website/assets', 'website/source-assets'),
]
  .filter(Boolean)
  .join('\n')
if (changed) {
  console.error(`Refusing to deploy: these aren't committed, and a deploy ships the folder as it is.\n${[...new Set(changed.split('\n'))].join('\n')}`)
  process.exit(1)
}
const commit = git('rev-parse', 'HEAD')
const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
// Only from the branch releases are made from, as this checkout's own package.json names it.
const elsewhere = notTheDeployBranch(branch, JSON.parse(readFileSync('package.json', 'utf8')).deployFrom)
if (elsewhere) {
  console.error(`Refusing to deploy: ${elsewhere}.`)
  process.exit(1)
}
console.log(`Deploying ${commit.slice(0, 7)} from ${branch}.`)

// website/site is built, and may not be there.
refuseSecrets(['site', 'website/site'])
// The reader page for shared drafts is served from site/, and built, not committed. What was built before goes
// first: a script the page no longer fetches, or a file dropped there under a name like the build's, shipped with it.
clearBuilt()
run('npm', ['run', 'build:reader'])
// As it's about to go: the reader page's build is in it now.
refuseSecrets(['site'])
refuseStrays()
run('npx', ['wrangler', 'deploy', '--message', commit, '--tag', commit.slice(0, 12)])
