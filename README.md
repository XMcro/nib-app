# Nib

Nib is a writing app for iPhone, iPad and Mac: quick notes, pages with headings,
and a manuscript for a whole book. Your writing stays on your device. Nib Plus
adds sync between your devices, sealed with keys only your devices hold.

This repository is the code of Nib 1.10.15 (build 56) as it ships in the App
Store, and of the Nib Plus server it talks to. It's public so anyone can check
what Nib does with their writing. The privacy policy, in `site/privacy.html`,
says exactly what the server keeps.

## Licence

Copyright © 2026 Andrew Neitsch.

Nib is free software: you can redistribute it and/or modify it under the terms
of the GNU Affero General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. It comes with no warranty. The full licence is in `LICENSE`.

The name Nib, its icons and its artwork, the stamps among them, aren't covered
by this licence. They're here because the app can't be built without them, but
they aren't yours to reuse: a version of Nib you build and share needs a name
and icons of its own.

## What's here

- `src/`: the app, in React, TypeScript, TipTap and Dexie, which runs inside the
  iPhone, iPad and Mac app. Inkwell's answers (`src/buddy`) are searched on the
  device, with no AI.
- `ios/`: the app for iPhone, iPad and Mac (Capacitor; the Mac app is Mac
  Catalyst), with Nib's own native plugins in Swift.
- `worker/`: the Nib Plus server, a Cloudflare Worker: sync, shared drafts, the
  inbox, attached files and Nib Plus purchases.
- `site/`: the pages the server serves, the privacy policy among them.
- `extension/`: Nib Web Clipper, a browser extension, not yet released.
- `scripts/`: building and upkeep.

Nib's website, nibprivacy.com, isn't here, so `npm run release:web` won't run.

## Building

```bash
npm install
npm run dev      # in a browser, for development, without the native parts
npm test         # unit tests, and browser tests in headless Chromium
npm run build
```

For the apps, run `scripts/build-capacitor.sh` once: the published Capacitor
package has no Mac Catalyst build, so this builds Capacitor from its source.
Then `npm run cap:sync` (not `npx cap sync`) and open
`ios/App/App.xcodeproj` in Xcode. Signing needs an Apple team and bundle IDs
of your own.

## Contributing

This repository is read-only: issues are welcome, pull requests aren't taken.
Please report a security problem privately, to support@nibprivacy.com.
