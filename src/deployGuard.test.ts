import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { notTheDeployBranch, unwanted } from '../scripts/public-files.mjs'
import pkg from '../package.json'

/**
 * What the deploy looks for in a folder before it's public (scripts/public-files `unwanted`), in a folder of the
 * test's own. Asked of the guard itself: the deploy script is never run from a test, which would deploy the
 * project (it works from the project now, wherever it's run; the server audit of 2026-11-23).
 */
function guard(path: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'nib-guard-'))
  try {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), 'secret')
    return (unwanted([join(dir, 'site'), join(dir, 'website/site')]) as string[]).map((found) => basename(found))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Security finding 14 of the 8 November audit: the guard knew only .env and .dev.vars, and only in site/.
describe('the deploy guard', () => {
  for (const name of ['.env', '.env.production', '.dev.vars', '.coins-signing.local', 'AuthKey_ABC123.p8', 'server.pem', 'certificates.p12']) {
    for (const folder of ['site', 'website/site/nested']) {
      it(`refuses ${name} in ${folder}`, () => {
        expect(guard(`${folder}/${name}`)).toEqual([name])
      })
    }
  }

  it('passes a folder of what a site is made of', () => {
    expect(guard('site/index.html')).toEqual([])
    expect(guard('website/site/assets/site.css')).toEqual([])
  })
})

// Any clean checkout deployed, on any branch: one of the project's dozens of old worktrees would have put the
// server of months before live (the server audit of 2026-11-23).
describe('where a deploy runs from', () => {
  it('is the one branch package.json names, and no other', () => {
    expect(notTheDeployBranch('more-importers', 'more-importers')).toBeNull()
    expect(notTheDeployBranch('side-by-side', 'more-importers')).toBe('this is the branch side-by-side, and deploys run only from more-importers (package.json deployFrom)')
    expect(notTheDeployBranch('more-importers-old', 'more-importers')).not.toBeNull()
    // A commit checked out by itself, as git names it.
    expect(notTheDeployBranch('HEAD', 'more-importers')).toBe('this is no branch (a commit checked out by itself), and deploys run only from more-importers (package.json deployFrom)')
  })

  it('is nowhere when package.json names none', () => {
    for (const none of [undefined, '', null, 3]) expect(notTheDeployBranch('more-importers', none)).toBe('package.json names no branch to deploy from (deployFrom)')
  })

  it('is named in package.json, and asked of it by the deploy before anything is built or sent', () => {
    expect((pkg as { deployFrom?: string }).deployFrom).toBe('more-importers')
    const script = readFileSync(new URL('../scripts/deploy.mjs', import.meta.url), 'utf8')
    const asked = script.indexOf("notTheDeployBranch(branch, JSON.parse(readFileSync('package.json', 'utf8')).deployFrom)")
    expect(asked).toBeGreaterThan(0)
    for (const after of ['clearBuilt()', "run('npm'", "run('npx'"]) expect(script.indexOf(after)).toBeGreaterThan(asked)
  })
})
