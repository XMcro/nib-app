import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Nib's own licence, first: its code is public under the GNU AGPL, version 3
 * or later, from the build that carries this. nibprivacy.com/source is a page
 * of Nib's that says where the code is, so the app's link never has to change.
 */
const OWN = [
  'Nib',
  'Copyright © 2026 Andrew Neitsch.',
  'Nib is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.',
  'Nib is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details: https://www.gnu.org/licenses/agpl-3.0.html',
  'Its source code is at https://nibprivacy.com/source.',
  'The name Nib, its icons and its artwork, the stamps among them, aren’t covered by this licence.',
].join('\n\n')

const HEADER = 'Nib is built with the open-source software below. Each is listed with its version and its licence, and the notice that licence asks to go with every copy.'

type Bundle = Record<string, { type: string; modules?: Record<string, { renderedLength: number }>; originalFileNames?: string[] }>

/**
 * The notices of the open-source software a build ships, written beside it
 * as `fileName` (Settings → Acknowledgements opens the app's): every package
 * that code of its scripts or its workers', or a file of its styles, came
 * from, and `also`, what's in the copy without being in those. `plugin` goes
 * in the build's plugins and `worker` in its workers', which are built first.
 */
export function licences(fileName: string, also: { packages?: string[]; texts?: string[] } = {}): { plugin: Plugin; worker: Plugin } {
  const ids = new Set<string>()
  const collect = (bundle: Bundle) => {
    for (const output of Object.values(bundle)) {
      if (output.type === 'chunk') for (const [id, module] of Object.entries(output.modules ?? {})) if (module.renderedLength) ids.add(id)
      for (const name of output.originalFileNames ?? []) ids.add(name)
    }
  }
  return {
    worker: { name: 'nib-licences-worker', apply: 'build', generateBundle: (_, bundle) => collect(bundle) },
    plugin: {
      name: 'nib-licences',
      apply: 'build',
      generateBundle(_, bundle) {
        collect(bundle)
        const packages = (also.packages ?? []).map((name) => `node_modules/${name}/package.json`)
        this.emitFile({ type: 'asset', fileName, source: notices([...ids, ...packages], process.cwd(), also.texts) })
      },
    },
  }
}

/**
 * The notices file for these modules, by path or by path from `root`, with
 * `texts` after them. A package's is its licence file and its NOTICE, as it
 * ships them; one without a licence file stops the build. A file of Nib's own
 * that opens with a `/*!` comment, someone else's work copied in, has that
 * comment for its notice.
 */
export function notices(ids: Iterable<string>, root: string, texts: string[] = []): string {
  const entries = new Map<string, string>()
  for (const id of ids) {
    if (id.startsWith('\0')) continue
    const path = id.split('?')[0]
    const file = isAbsolute(path) ? path : join(root, path)
    const at = file.lastIndexOf('/node_modules/')
    if (at >= 0) {
      const [scope, name] = file.slice(at + 14).split('/')
      const dir = realpathSync(file.slice(0, at + 14) + (scope.startsWith('@') ? `${scope}/${name}` : scope))
      if (!entries.has(dir)) entries.set(dir, notice(dir))
    } else if (file.startsWith(root) && existsSync(file)) {
      const comment = /^\s*\/\*!([\s\S]*?)\*\//.exec(readFileSync(file, 'utf8'))?.[1]
      if (comment) entries.set(file, comment.replace(/^[ \t]*\* ?/gm, '').trim())
    }
  }
  return `${[OWN, HEADER, ...[...entries.values()].sort((a, b) => a.localeCompare(b)), ...texts].join('\n\n\n')}\n`
}

/** A package's name, version and licence, then its licence file and NOTICE. */
function notice(dir: string): string {
  const { name, version, license } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string; license?: string }
  const files = readdirSync(dir)
  const licence = files.find((file) => /^(licen[cs]e|copying)\b/i.test(file))
  if (!licence) throw new Error(`${name}: no licence file to give its notice from (scripts/licences)`)
  const extra = files.find((file) => /^notice\b/i.test(file))
  return [`${name} ${version}${license ? ` (${license})` : ''}`, ...[licence, ...(extra ? [extra] : [])].map((file) => readFileSync(join(dir, file), 'utf8').trim())].join('\n\n')
}
