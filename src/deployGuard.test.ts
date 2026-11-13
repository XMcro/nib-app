import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../scripts/deploy.mjs')

/** The deploy script, run where nothing can deploy: a folder with no package.json holding only this file. */
function guard(path: string) {
  const dir = mkdtempSync(join(tmpdir(), 'nib-guard-'))
  try {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), 'secret')
    return spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Security finding 14 of the 8 November audit: the guard knew only .env and .dev.vars, and only in site/.
describe('the deploy guard', () => {
  for (const name of ['.env', '.env.production', '.dev.vars', '.coins-signing.local', 'AuthKey_ABC123.p8', 'server.pem', 'certificates.p12']) {
    for (const folder of ['site', 'website/site/nested']) {
      it(`refuses ${name} in ${folder}`, () => {
        const result = guard(`${folder}/${name}`)
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('Refusing to deploy')
        expect(result.stderr).toContain(name)
      })
    }
  }
})
