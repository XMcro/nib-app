import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { notices } from '../scripts/licences'

const root = process.cwd()
let made: string | undefined
afterEach(() => made && rmSync(made, { recursive: true, force: true }))

/** A folder standing in for the project, with these files in it. */
function project(files: Record<string, string>) {
  made = mkdtempSync(join(tmpdir(), 'nib-licences-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(made, path, '..'), { recursive: true })
    writeFileSync(join(made, path), text)
  }
  return made
}

describe('the notices file (scripts/licences)', () => {
  // Nib's own code goes public under the AGPL with the build that carries this (decided 2026-11-12/13).
  it('opens with Nib’s own licence, the AGPL, and where its source is, before what it’s built with', () => {
    const text = notices([], root)
    expect(text.startsWith('Nib\n\nCopyright © 2026 Andrew Neitsch.')).toBe(true)
    expect(text).toContain('GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version')
    expect(text).toContain('https://nibprivacy.com/source')
    expect(text).toContain('The name Nib, its icons and its artwork, the stamps among them, aren’t covered by this licence.')
    expect(text.indexOf('Affero')).toBeLessThan(text.indexOf('Nib is built with the open-source software below'))
  })

  it('gives each package once, by name, with its licence file and its NOTICE', () => {
    const text = notices([join(root, 'node_modules/marked/lib/marked.esm.js'), 'node_modules/dexie/dist/dexie.mjs', join(root, 'node_modules/dexie/package.json?commonjs-proxy')], root)
    const dexie = JSON.parse(readFileSync('node_modules/dexie/package.json', 'utf8')) as { version: string }

    expect(text.indexOf(`dexie ${dexie.version} (Apache-2.0)`)).toBeGreaterThan(0)
    expect(text.indexOf('dexie ')).toBe(text.lastIndexOf('dexie '))
    expect(text).toContain(readFileSync('node_modules/dexie/LICENSE', 'utf8').trim())
    expect(text).toContain(readFileSync('node_modules/dexie/NOTICE', 'utf8').trim())
    expect(text.indexOf('dexie ')).toBeLessThan(text.indexOf('marked '))
    expect(text).toContain('Permission is hereby granted')
  })

  it('stops the build for a package with no licence file to give', () => {
    const dir = project({ 'node_modules/quiet/package.json': '{"name":"quiet","version":"1.0.0","license":"MIT"}', 'node_modules/quiet/index.js': '' })
    expect(() => notices([join(dir, 'node_modules/quiet/index.js')], dir)).toThrow('quiet: no licence file')
  })

  it('has someone else’s work copied into Nib by the /*! comment it opens with', () => {
    const dir = project({
      'src/icons.ts': '/*! Icons from Somewhere, 1.0.\n *\n * ISC License\n */\n\n/** Nib’s own words. */\nexport const icons = {}\n',
      'src/plain.ts': '/** Nib’s own. */\nexport const plain = 1\n',
    })
    const text = notices([join(dir, 'src/icons.ts'), join(dir, 'src/plain.ts'), '\0virtual'], dir, ['Added as it is'])

    expect(text).toContain('\n\n\nIcons from Somewhere, 1.0.\n\nISC License\n\n\nAdded as it is\n')
    expect(text).not.toContain('Nib’s own')
  })
})
