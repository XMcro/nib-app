import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }
import { contentSecurityPolicy } from './src/lib/csp.ts'
import { licences } from './scripts/licences.ts'

/**
 * The page's Content Security Policy (lib/csp), after the charset, which has
 * to come first, and before any script. Built pages only: the dev server adds
 * inline scripts of its own. Last of the plugins, so it hashes the page as it
 * ships; and a page it can't place the policy in isn't built.
 */
function contentSecurity(): Plugin {
  let syncUrl: string | undefined
  return {
    name: 'nib-content-security-policy',
    apply: 'build',
    configResolved(config) {
      syncUrl = config.env.VITE_SYNC_URL
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        const charset = '<meta charset="UTF-8" />'
        if (!html.includes(charset)) throw new Error(`index.html: no ${charset} to put the Content Security Policy after`)
        // Nib's scripts started from an inline module, allowed by hash, so the policy needn't allow a
        // script from anywhere on Nib's origin ('strict-dynamic'): in the app that origin also serves
        // any file in its sandbox (Capacitor's /_capacitor_file_/). It adds the entry as a script of its
        // own, which 'strict-dynamic' trusts, with what that imports; an import from the page's own
        // script, static or not, counts as the page's, and is refused.
        html = html
          .replace(
            /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
            `<script>(() => { const start = document.createElement('script'); start.type = 'module'; start.crossOrigin = ''; const url = '$1'; start.src = window.trustedTypes ? trustedTypes.createPolicy('nib-start', { createScriptURL: () => url }).createScriptURL(url) : url; document.head.append(start) })()</script>`,
          )
          .replace(/\s*<link rel="modulepreload" crossorigin href="[^"]+">/g, '')
        if (/<script[^>]*\bsrc=/.test(html)) throw new Error('index.html: a script by address, which the policy would refuse')
        const policy = `<meta http-equiv="Content-Security-Policy" content="${await contentSecurityPolicy(html, syncUrl)}" />`
        return html.replace(charset, `${charset}\n    ${policy}`)
      },
    },
  }
}

// The notices of what the app is built with (scripts/licences), for Settings → Acknowledgements.
const notices = licences('licences.txt', {
  // What the app has outside its scripts and styles' modules: the base styles Tailwind writes into the stylesheet; the service
  // worker's Workbox (vite-plugin-pwa), which is in the iPhone and Mac app's copy too; and Capacitor's native side, built into
  // those apps from @capacitor/ios (ios/App/capacitor-swift-pm),
  packages: ['tailwindcss', 'workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies', '@capacitor/ios'],
  // whose Cordova part is Apache Cordova's, under the Apache License, of which @capacitor/ios ships no text: TypeScript's is that licence.
  texts: [
    `Apache Cordova, in @capacitor/ios (Apache-2.0)\n\nCopyright The Apache Software Foundation. This product includes software developed at The Apache Software Foundation (http://www.apache.org/).\n\n${readFileSync('node_modules/typescript/LICENSE.txt', 'utf8').trim()}`,
  ],
})

// https://vite.dev/config/
export default defineConfig({
  // Lightning CSS's Features.DirSelector: left alone, its `:dir(rtl)` (index.css) becomes a list of `:lang()`s, which know nothing of a line's dir="auto".
  css: { lightningcss: { exclude: 4 } },
  // A font is always a file: a small one written into the stylesheet as data (KaTeX's, for the tallest
  // brackets) is one the page's policy refuses (lib/csp, font-src), and the bracket was drawn in another font.
  build: { assetsInlineLimit: (file) => (/\.(woff2?|ttf)$/.test(file) ? false : undefined) },
  // Its build for browsers needs a `document`, which the code colours' worker (editor/codeWorker) hasn't.
  resolve: { alias: { 'decode-named-character-reference': fileURLToPath(new URL('node_modules/decode-named-character-reference/index.js', import.meta.url)) } },
  worker: { plugins: () => [notices.worker] },
  plugins: [
    react(),
    tailwindcss(),
    contentSecurity(),
    notices.plugin,
    VitePWA({
      // Still 'prompt' so nothing ever calls location.reload() on a tab that
      // may be mid-sentence with an edit inside the 400ms debounce.
      registerType: 'prompt',
      // Registered from main.tsx, as its registerSW.js did: a script tag by address is one the page's policy refuses (lib/csp).
      injectRegister: false,
      workbox: {
        // But the worker no longer sits in `waiting` until every client goes
        // away. That default sounds calm and is not: a deploy is invisible
        // until you quit the app entirely — a reload will not do it, and an
        // installed window is its own client, so closing browser tabs does
        // nothing. Claiming immediately means the *next* reload serves the new
        // build; the page already open keeps the JS it is running.
        //
        // Some chunks are fetched later (`docx`, KaTeX, code grammars): a page
        // left open across a deploy can ask for the one from its own build,
        // gone by then, and that fails until it's reloaded. Nothing is deployed
        // from this build while the web app is retired, and the iPhone and Mac
        // apps have no service worker. Revisit this if the web app comes back.
        skipWaiting: true,
        clientsClaim: true,
        // Fonts are the product in a writing tool, so they are precached rather
        // than left to the network. `.woff` is excluded deliberately: it is the
        // legacy fallback, and every browser with a service worker reads woff2.
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
        // Every route is the same shell; a deep link offline must still boot.
        navigateFallback: '/index.html',
        // Not the sync API, and not the privacy policy: both are real pages
        // on the server, and the cached app shell must not stand in for them.
        navigateFallbackDenylist: [/^\/v1\//],
        cleanupOutdatedCaches: true,
      },
      includeAssets: ['favicon.png'],
      manifest: {
        name: 'Nib',
        short_name: 'Nib',
        description: 'A local-first writing tool for notes and pages.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // --color-shell, so the installed window matches the app it opens.
        background_color: '#fafaf8',
        theme_color: '#fafaf8',
        icons: [
          { src: '/favicon.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          // Separate entry: Android crops to a circle, and the plain mark runs
          // to the edges, so it needs its own copy inset into the safe zone.
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // package.json stays the single source of truth for the version.
  // Shown as the App Store shows it: 1.0.0 reads as 1.0.
  define: { __APP_VERSION__: JSON.stringify(pkg.version.replace(/\.0$/, '')) },
})
