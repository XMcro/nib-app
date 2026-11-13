// Builds Nib's browser extension (the web clipper, src/clipper) into extension/dist, to load unpacked in Chrome, Edge or
// Firefox, or to zip for their stores. One manifest for all three (extension/manifest.json).
//
//   node scripts/build-extension.mjs           as it's published: it reaches Nib's server and nothing else
//   node scripts/build-extension.mjs --local   for trying it out: a server on this computer too (never published)
//
// Each script is one file with nothing to load beside it: a page's script and a background can't share pieces.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'vite'

const local = process.argv.includes('--local')
/** The server a local build may also send to (wrangler dev). */
const LOCAL = ['http://localhost:8799', 'http://127.0.0.1:8799']
const out = 'extension/dist'

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

for (const [entry, name] of [
  ['src/clipper/popup.ts', 'popup'],
  ['src/clipper/background.ts', 'background'],
  ['src/clipper/picker-entry.ts', 'picker'],
]) {
  await build({
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    define: local ? { __CLIPPER_LOCAL__: JSON.stringify(LOCAL) } : {},
    build: { outDir: out, emptyOutDir: false, target: 'es2022', lib: { entry, formats: ['iife'], name: `nib_${name}`, fileName: () => `${name}.js`, cssFileName: name } },
  })
}

// The page's own reader: the same script Safari's share sheet runs.
cpSync('ios/App/NibShare/Page.js', `${out}/page.js`)
cpSync('extension/popup.html', `${out}/popup.html`)
cpSync('extension/icons', `${out}/icons`, { recursive: true })

const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'))
manifest.version = JSON.parse(readFileSync('package.json', 'utf8')).version
if (local) manifest.host_permissions.push(...LOCAL.map((origin) => `${origin}/*`))
writeFileSync(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Built ${out}${local ? ' (local: not for publishing)' : ''}, version ${manifest.version}`)
