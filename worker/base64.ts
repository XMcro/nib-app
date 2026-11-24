/** Base64, plain and URL-safe, for the app and the server alike (as worker/signing.ts is shared): no dependencies. */

export function base64(bytes: Uint8Array): string {
  let binary = ''
  // Chunked: a 2 MB document, or a whole picture, would overflow the argument list in one go.
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

export const base64url = (bytes: Uint8Array): string => base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))
}

/**
 * Whether `text` is standard base64, whole, as `base64` writes it. By its
 * length and one run of its alphabet, not a pattern that loops over groups of
 * four: that ran the engine out of stack past some 4.47 million characters and
 * threw, on any record a device had padded to 4 MiB (the server audit of 2026-11-23).
 */
export const isBase64 = (text: string): boolean => text.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(text)
