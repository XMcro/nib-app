import { SHARE_ORIGIN, SYNC_ORIGIN } from './hosts.ts'

/**
 * The app page's Content Security Policy, written into a production build's
 * index.html (vite.config): scripts from Nib itself and the page's own inline
 * ones, by hash, and none from anywhere else. Nothing is known to let a
 * script in, but in the iPhone and Mac app one that ran could call the native
 * plugins, the Keychain's sync code among them, and this stops it running.
 * A meta tag, not a header, as the app's web view has no server to send one.
 * `syncUrl`: a local build's own server (VITE_SYNC_URL), in place of both.
 */
export async function contentSecurityPolicy(html: string, syncUrl?: string): Promise<string> {
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1])
  const hashes = await Promise.all(inline.map(sha256))
  const styles = await Promise.all([...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => sha256(match[1])))
  return [
    // Nothing that isn't named below: frames, plugins, audio and video, and
    // whatever kind of thing comes next, till it's named here on purpose.
    "default-src 'none'",
    // Only scripts the page's own inline ones, by hash, load: not any script on Nib's origin, which
    // in the app serves every file in its sandbox. 'self' is for a web view too old for 'strict-dynamic'.
    `script-src 'self' 'strict-dynamic' ${hashes.join(' ')}`,
    // Stylesheets from Nib, and the opening screen's own <style>, by hash: no
    // other <style> (the editor's rules are in index.css). React and the
    // editor set style attributes, so those stay open. style-src is for a
    // web view too old to tell the two apart (before iOS 15.4).
    "style-src 'self' 'unsafe-inline'",
    `style-src-elem 'self' ${styles.join(' ')}`,
    "style-src-attr 'unsafe-inline'",
    // Pictures in documents are data URIs and nothing else (lib/image).
    "img-src 'self' data:",
    // An attached recording, played in the note (editor/Attachment): from the app's own files, or in a browser from a `data:` address, as a picture is.
    "media-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${syncUrl ?? `${SYNC_ORIGIN} ${SHARE_ORIGIN}`}`,
    // The offline copy's service worker, and the manifest it installs from.
    "worker-src 'self'",
    "manifest-src 'self'",
    // Text turns into HTML, or a script's address, only through a named
    // policy: the page's own (lib/trustedTypes), and ProseMirror's for pasting.
    "require-trusted-types-for 'script'",
    // And the page's start, for the one script it adds (vite.config).
    'trusted-types default ProseMirrorClipboard nib-start',
    "base-uri 'none'",
    // Every form is handled on the page, never sent.
    "form-action 'none'",
  ].join('; ')
}

async function sha256(code: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)))
  return `'sha256-${btoa(String.fromCharCode(...digest))}'`
}
