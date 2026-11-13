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
