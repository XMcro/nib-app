/**
 * Ask the browser to keep the database.
 *
 * IndexedDB is evictable: under storage pressure a browser may clear it without
 * warning, and it holds the only copy of everything written in Nib. Persistent
 * storage is the one thing that makes "stored on this device" a promise rather
 * than a hope, and it has to be requested — it is never granted by default.
 *
 * Asked once, not on every load: Chromium decides silently from engagement, but
 * Firefox shows a prompt, and a prompt on every visit is its own bug. A refusal
 * is not an error and neither is an engine without the API.
 */
export async function keepStoragePersistent(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
