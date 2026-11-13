import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { licences } from './scripts/licences.ts'

// The notices of what the page is built with (scripts/licences), served beside it.
const notices = licences('reader-licences.txt')

/**
 * The reader page for shared drafts (/d/<slug>), built as two plain files in
 * site/, which the Worker serves as static assets. The page's CSP allows only
 * scripts and styles from its own origin, so they have to be real files, not
 * inline. No framework: the page draws the draft with the DOM alone.
 */
export default defineConfig({
  // As the app's (vite.config.ts): `:dir(rtl)` left as it's written.
  css: { lightningcss: { exclude: 4 } },
  publicDir: false,
  build: {
    outDir: 'site',
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: 'src/reader/main.ts',
      formats: ['es'],
      fileName: () => 'reader.js',
      cssFileName: 'reader',
    },
    // What the page fetches only when a draft needs it (KaTeX, for a formula: reader/math), under one
    // name from build to build, as reader.js is: nothing is left in site/ from the build before.
    rollupOptions: { output: { chunkFileNames: 'reader-[name].js' } },
  },
  // Under one name too: the code colours' worker (reader/code), a file of its own as the page's policy allows nothing else.
  worker: { rollupOptions: { output: { entryFileNames: 'reader-code.js' } }, plugins: () => [notices.worker] },
  plugins: [notices.plugin],
  // As the app's: its build for browsers needs a `document`, which that worker hasn't.
  resolve: { alias: { 'decode-named-character-reference': fileURLToPath(new URL('node_modules/decode-named-character-reference/index.js', import.meta.url)) } },
})
