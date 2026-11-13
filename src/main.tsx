import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
// Customize's serif (lib/look). Only fetched once something is set in it.
import '@fontsource-variable/literata'
import '@fontsource-variable/literata/wght-italic.css'
import './index.css'
import { App } from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { download } from './lib/download.ts'
import { count, sendCounts } from './lib/counts.ts'
import { sweepExports } from './lib/exportFile.ts'
import { sweepFiles } from './lib/fileUse.ts'
import { countLaunch } from './lib/feedback.ts'
import { restoreFromMirror } from './lib/mirror.ts'
import { nativeApp } from './lib/platform.ts'
import { keepStoragePersistent } from './lib/storage.ts'
import { followLargerText } from './lib/textSize.ts'
import { installTrustedTypes } from './lib/trustedTypes.ts'

// Before anything can turn text into HTML: the page's policy wants one named (lib/trustedTypes).
installTrustedTypes()

// The offline copy (vite-plugin-pwa's sw.js), in a built page: registered here, as its registerSW.js
// did, since the page's policy runs only the scripts its own inline ones load (lib/csp).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = () => void navigator.serviceWorker.register('/sw.js', { scope: '/' })
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register)
}

// iOS's Larger Text, before the first thing is drawn in it.
followLargerText()

// Before anything renders, and deliberately not awaited: nothing on screen
// depends on the answer, but the writing does.
void keepStoragePersistent()

// Exports are the writing in the clear (lib/exportFile): any a crash kept from
// going, go now.
if (nativeApp) void sweepExports().catch((error: unknown) => console.warn('Nib: could not clear old exports', error))

// Awaited, unlike the above: if iOS cleared the web view's database, the
// library has to be back before the app shows an empty list or starts a draft.
// A failure here must not stop the app opening on whatever is still there; the
// file is then left alone for the session (see lib/mirror).
if (nativeApp) {
  await restoreFromMirror().catch((error: unknown) => console.error('Nib: restore from the app’s file failed', error))
}

// Files no document uses any more (lib/fileUse): looked for once a day, as Nib opens. After the library is back
// (above): looked for in a library iOS had just emptied, every one would seem unused.
void sweepFiles().catch((error: unknown) => console.warn('Nib: could not clear unused files', error))

// A launch, for what Nib asks at which (lib/feedback); and any finished day's counts, for a writer who said yes.
if (nativeApp) {
  countLaunch()
  count('opened')
  void sendCounts()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary save={download}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
