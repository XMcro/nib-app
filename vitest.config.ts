import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { playwright } from '@vitest/browser-playwright'

// A factory, not a shared object: each project needs its own plugin instances,
// and its own copy of the build-time inject that components read.
const base = () => ({
  plugins: [react()],
  // Mirrors the build-time inject so components reading it can be rendered.
  define: { __APP_VERSION__: JSON.stringify('test') },
  // Without this the browser project pre-bundles a second copy of React into
  // @testing-library/react, and every hook throws reading a null dispatcher.
  resolve: {
    dedupe: ['react', 'react-dom'],
    // As the build has it (vite.config): the browser one needs a `document`, which the code colours' worker hasn't.
    alias: { 'decode-named-character-reference': fileURLToPath(new URL('node_modules/decode-named-character-reference/index.js', import.meta.url)) },
  },
})

export default defineConfig({
  ...base(),
  test: {
    projects: [
      {
        ...base(),
        test: {
          name: 'unit',
          // Pure logic and database tests run in node; component files opt into
          // jsdom with a `@vitest-environment` docblock.
          environment: 'node',
          globals: true,
          setupFiles: ['src/test-setup.ts'],
          include: ['src/**/*.test.{ts,tsx}', 'worker/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.{ts,tsx}'],
        },
      },
      {
        ...base(),
        // Same Tailwind plugin the app uses, so a layout assertion can see
        // utilities like `h-full`. The unit project never lays anything out.
        plugins: [react(), tailwindcss()],
        // Found late, this is pre-bundled mid-run against a second React, and
        // the first test to render App fails on a clean cache only.
        optimizeDeps: { include: ['dexie-react-hooks'] },
        test: {
          name: 'browser',
          globals: true,
          // jsdom has no layout, so ProseMirror will not run there at all —
          // input rules, selection geometry and the outline rail can only be
          // exercised in something that actually lays the document out.
          // `npm run timing` runs the milliseconds instead (*.timing.ts), which a busy machine would fail.
          include: process.env.NIB_TIMING ? ['src/**/*.timing.ts'] : ['src/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
