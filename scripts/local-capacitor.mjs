#!/usr/bin/env node
/**
 * Points every Swift package that depends on Capacitor at the copy built from
 * source (ios/App/capacitor-swift-pm, by scripts/build-capacitor.sh) instead of
 * the published capacitor-swift-pm, which ships no Mac Catalyst build.
 *
 * Each manifest names the same local path, so Swift Package Manager sees one
 * package, not two with the same identity. Rewrites the app's CapApp-SPM (which
 * `cap sync` regenerates) and each Capacitor plugin in node_modules (which
 * `npm install` replaces), so it runs after both: see `postinstall` and
 * `cap:sync` in package.json. Running it again changes nothing.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const local = join(root, 'ios/App/capacitor-swift-pm')
const app = join(root, 'ios/App/CapApp-SPM/Package.swift')
const published = /\.package\(\s*url:\s*"https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git"[^)]*\)/g

// The app's manifest, then every plugin it lists by path.
const manifests = [app]
for (const [, path] of readFileSync(app, 'utf8').matchAll(/\.package\(\s*name:\s*"[^"]+",\s*path:\s*"([^"]+)"\)/g)) {
  const manifest = join(dirname(app), path, 'Package.swift')
  if (existsSync(manifest)) manifests.push(manifest)
}

for (const manifest of manifests) {
  const before = readFileSync(manifest, 'utf8')
  const path = relative(dirname(manifest), local)
  const after = before.replace(published, `.package(path: "${path}")`)
  if (after !== before) {
    writeFileSync(manifest, after)
    console.log(`Capacitor: ${relative(root, manifest)} now uses ${relative(root, local)}`)
  }
}

// `cap sync` takes CapApp-SPM's iOS version from the first deployment target
// in the Xcode project, which since the widgets (iOS 16) can be theirs rather
// than the app's (iOS 15). Only the app links CapApp-SPM, so it gets the
// project's lowest target instead, or iOS 15 devices would lose the app.
const targets = [...readFileSync(join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8').matchAll(/IPHONEOS_DEPLOYMENT_TARGET = (\d+)\./g)]
if (targets.length) {
  const lowest = Math.min(...targets.map(([, major]) => Number(major)))
  const before = readFileSync(app, 'utf8')
  const after = before.replace(/\.iOS\(\.v\d+\)/, `.iOS(.v${lowest})`)
  if (after !== before) {
    writeFileSync(app, after)
    console.log(`Capacitor: ${relative(root, app)} supports iOS ${lowest} again, as the app does`)
  }
}

if (!existsSync(join(local, 'Capacitor.xcframework'))) {
  console.warn('Capacitor: the local build is missing. Run scripts/build-capacitor.sh before building the app.')
}
