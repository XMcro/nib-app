/**
 * What must never be in a folder that's about to be served to anyone, looked for before each deploy
 * (scripts/deploy, scripts/release-web). Adapted from draft PR #8.
 *
 * Folders are found from where this file is, not from where the command was run: run from scripts/, `site`
 * wasn't there, nothing was looked at, and the deploy went ahead (the server audit of 2026-11-23).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, unlinkSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Whatever its case: on a Mac's disk `.ENV` is `.env`. A secret by its name (.env, .dev.vars, *.local, a signing
// key); and what nobody means to publish: a hidden file (.DS_Store), a source map, notes, a log.
const named = (name) => name.startsWith('.') || /\.(local|p8|pem|p12|map|md|log)$/.test(name)
const secret = (name) => named(name.toLowerCase())

/** Every file under `dir`, and every link, which is never followed: where it points is none of the folder's. */
function files(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const what = lstatSync(path)
    if (what.isDirectory()) files(path, found)
    else found.push({ path, link: what.isSymbolicLink() })
  }
  return found
}

/** The files under `dirs` that mustn't be public, and every link, whose name says nothing of what it leads to. A folder that's built, and not there yet, holds none. */
export function unwanted(dirs) {
  return dirs
    .map((dir) => resolve(ROOT, dir))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => files(dir))
    .filter(({ path, link }) => link || secret(basename(path)))
    .map(({ path }) => path)
}

/**
 * What the reader page's build writes into site/ (vite.reader.config.ts), as .gitignore names them: the page, its
 * styles, its notices, and the scripts it fetches when a draft needs them. Built, not committed. Nothing else that
 * only begins "reader": reader-private-notes.txt passed.
 */
const READER_BUILT = /^(reader\.(js|css)|reader-licences\.txt|reader-[\w-]+\.js)$/

/** The reader page's build, taken out of `dir` before it's built again, so that what's there after is that build's alone. */
export function clearBuilt(dir = 'site') {
  const root = resolve(ROOT, dir)
  for (const name of readdirSync(root)) if (READER_BUILT.test(name)) unlinkSync(join(root, name))
}

/**
 * The files in `dir` that are neither committed there (`tracked`, as paths within it) nor the reader page's build:
 * whatever else is in site/ was dropped there, and would be served with the rest.
 */
export function strays(dir, tracked) {
  const kept = new Set(tracked)
  const root = resolve(ROOT, dir)
  return files(root)
    .map(({ path }) => path)
    .filter((path) => !kept.has(relative(root, path)) && !READER_BUILT.test(relative(root, path)))
}

/**
 * Stops a deploy that was started from inside a test run. A test once ran the deploy script itself, in a folder
 * of its own where it had nothing to deploy; now that the script works from the project wherever it's run, the
 * same test would have deployed the project, to everyone, the first time the tests ran on a clean checkout.
 */
export function refuseInTests() {
  if (!process.env.VITEST && process.env.NODE_ENV !== 'test') return
  console.error('Refusing to deploy: this is a test run.')
  process.exit(1)
}

/**
 * What npm kept for itself of a command that asked for a check or a dry run before the `--` (--check, --dry-run,
 * --dryrun): it says nothing, and passes them on only as these. A deploy told to go with one of them wasn't meant.
 */
export const keptByNpm = (env = process.env) => Object.keys(env).filter((name) => /^npm_config_(dry|check)/i.test(name))

/** Stops the deploy, saying why. */
function refuse(hits, why) {
  if (!hits.length) return
  console.error(`Refusing to deploy: ${hits.map((path) => relative(ROOT, path)).join(', ')} ${why}`)
  process.exit(1)
}

/** Stops the deploy if any of `dirs` holds what mustn't be public (`unwanted`). */
export function refuseSecrets(dirs) {
  refuse(unwanted(dirs), 'would be public.')
}

/** Stops the deploy if site/ holds anything not committed there (`strays`). */
export function refuseStrays() {
  const listed = spawnSync('git', ['ls-files', '-z', '--', 'site'], { cwd: ROOT, encoding: 'utf8' })
  if (listed.status !== 0) refuse(['site'], 'couldn’t be checked against what’s committed (is git here?).')
  const tracked = listed.stdout.split('\0').filter(Boolean).map((path) => path.slice('site/'.length))
  refuse(strays('site', tracked), 'isn’t committed in site/, and would be public. Commit it, or take it out.')
}

/**
 * Why a deploy can't run from `branch`, or null if it can: only from the one branch package.json names
 * (`deployFrom`). Any clean checkout deployed, on any branch: there are dozens of old worktrees of this project,
 * and one run in any of them put the server of months before live (the server audit of 2026-11-23). Change the
 * name there, in a commit, when releases move to another branch.
 */
export function notTheDeployBranch(branch, wanted) {
  if (typeof wanted !== 'string' || !wanted) return 'package.json names no branch to deploy from (deployFrom)'
  if (branch === wanted) return null
  return `this is ${branch === 'HEAD' ? 'no branch (a commit checked out by itself)' : `the branch ${branch}`}, and deploys run only from ${wanted} (package.json deployFrom)`
}
