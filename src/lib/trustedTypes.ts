/**
 * Trusted Types (lib/csp): the page turns text into HTML, or into the address
 * of a script, only through a named policy. This is the default one, for the
 * code that names none: Nib's imports and exports and TipTap's content, which
 * parse with DOMParser, and the service worker's registration. Anything else
 * throws, so a bug that would write text into the page as HTML stops there.
 * ProseMirror asks this one first for what's pasted and, refused, parses it
 * through its own (ProseMirrorClipboard), into a document of its own.
 */
export const rules = {
  createHTML(input: string, _type?: string, sink?: string): string {
    // A DOMParser document is inert: nothing in it runs or loads.
    if (sink === 'DOMParser parseFromString') return input
    throw new TypeError(`Nib: no HTML for ${sink ?? 'a caller that names no sink'}`)
  },
  createScriptURL(input: string, _type?: string, _sink?: string): string {
    const url = new URL(input, location.href)
    // By protocol and host, as the app's own scheme has no `origin` to compare.
    const own = url.protocol === location.protocol && url.host === location.host && !url.search && !url.hash
    if (own && (url.pathname === '/sw.js' || url.pathname === '/regex-check.js' || /^\/assets\/codeWorker-[\w-]+\.js$/.test(url.pathname))) return input
    throw new TypeError(`Nib: no script from ${input}`)
  },
}

type Factory = { defaultPolicy: unknown; createPolicy(name: string, policy: typeof rules): unknown }

/** First, before anything can turn text into HTML (main.tsx). A web view without Trusted Types needs nothing. */
export function installTrustedTypes(): void {
  const types = (window as Window & { trustedTypes?: Factory }).trustedTypes
  if (types && !types.defaultPolicy) types.createPolicy('default', rules)
}
