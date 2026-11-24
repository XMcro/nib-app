import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearBuilt, keptByNpm, strays, unwanted } from '../scripts/public-files.mjs'

/**
 * What a deploy looks at before it publishes a folder (scripts/public-files). It refused a few names and nothing
 * else: whatever was dropped into site/ shipped to everyone, a .DS_Store, a source map, a test export, some notes;
 * and run from another folder it looked at nothing and deployed all the same (the server audit of 2026-11-23).
 */
let dir: string
const file = (path: string, text = 'x') => {
  mkdirSync(join(dir, path, '..'), { recursive: true })
  writeFileSync(join(dir, path), text)
}
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'nib-public-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('what mustn’t be in a folder about to be public', () => {
  it('is a secret by its name, a link, a hidden file, a source map, or someone’s notes or log', () => {
    for (const ok of ['index.html', '_headers', 'assets/site.css', 'reader.js', 'reader-licences.txt', 'screens/phone/1.png']) file(ok)
    for (const not of ['.env', '.ENV.production', '.dev.vars', 'key.p8', 'signing.PEM', 'settings.local', '.DS_Store', 'assets/.hidden', 'reader.js.map', 'notes.md', 'deploy.log']) file(not)
    symlinkSync(join(dir, 'index.html'), join(dir, 'linked.html'))
    const found = (unwanted([dir]) as string[]).map((path) => path.slice(dir.length + 1)).sort()
    expect(found).toEqual(['.DS_Store', '.ENV.production', '.dev.vars', '.env', 'assets/.hidden', 'deploy.log', 'key.p8', 'linked.html', 'notes.md', 'reader.js.map', 'settings.local', 'signing.PEM'].sort())
  })

  it('is nothing in a folder that isn’t there yet, being built', () => {
    expect(unwanted([join(dir, 'not-built')])).toEqual([])
  })
})

describe('what npm keeps of a command typed with an option before the --', () => {
  it('is seen for a check or a dry run of any spelling, and for nothing npm sets of itself', () => {
    expect(keptByNpm({ npm_config_dry_run: 'true', npm_config_dryrun: 'true', npm_config_check: 'true', npm_config_Check_only: 'true' })).toHaveLength(4)
    expect(keptByNpm({ npm_config_cache: '/x', npm_config_user_agent: 'npm/10', npm_config_prefix: '/y', npm_lifecycle_event: 'deploy', PATH: '/bin' })).toEqual([])
  })
})

describe('what’s in site/ that nobody put there on purpose', () => {
  it('is anything that isn’t committed there and isn’t the reader page’s own build', () => {
    for (const there of ['_headers', 'index.html', 'privacy.html', 'reader.js', 'reader.css', 'reader-code.js', 'reader-katex.js', 'reader-licences.txt', 'export.json', 'old/privacy.html', 'readerx.exe']) file(there)
    // Named like the build's and not of it: anything that began "reader" and ended .js, .css or .txt passed (found checking the fix, 2026-11-23).
    const named = ['reader-private-notes.txt', 'reader.txt', 'readers.css', 'reader-old.css', 'old/reader.js']
    for (const there of named) file(there)
    const found = (strays(dir, ['_headers', 'index.html', 'privacy.html']) as string[]).map((path) => path.slice(dir.length + 1)).sort()
    expect(found).toEqual(['export.json', 'old/privacy.html', 'readerx.exe', ...named].sort())
  })

  // The build doesn't empty the folder: a script the page fetched in an earlier build, or a file dropped there
  // under a name like the build's, was still there after it, and shipped (found checking the fix, 2026-11-23).
  it('has the reader page’s build of before taken out ahead of the build, and nothing else', () => {
    for (const there of ['_headers', 'index.html', 'privacy.html', 'reader.js', 'reader.css', 'reader-licences.txt', 'reader-code.js', 'reader-old-chunk.js', 'reader-notes.txt', 'old/reader.js']) file(there)
    clearBuilt(dir)
    expect(readdirSync(dir).sort()).toEqual(['_headers', 'index.html', 'old', 'privacy.html', 'reader-notes.txt'])
    expect(readdirSync(join(dir, 'old'))).toEqual(['reader.js'])
  })

  it('is nothing as the site is committed', () => {
    for (const there of ['_headers', 'index.html', 'reader.js']) file(there)
    expect(strays(dir, ['_headers', 'index.html'])).toEqual([])
  })
})
