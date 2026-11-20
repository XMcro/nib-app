import { asPost, send, WHY, type Sent } from './clip'

/**
 * The extension's background: the one place a clip is sent from. The popup
 * and the page's picker hand it a clip; it seals it with the code kept in the
 * extension's own storage and sends it there (clipper/clip `send`). A page's
 * script can't send across sites itself, and is never given the code.
 *
 * It takes a clip only from this extension, and never where to send one.
 */

// The code is for the popup and this script alone. Left as a browser has it, the storage can be read by the
// extension's script in a page too (the picker), and so by a page that got the better of it (the red-team review
// of 2026-11-17). Chrome and Edge take this; a browser that doesn't goes on as before.
try {
  void chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {})
} catch {
  // As before.
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const asked = message as { type?: unknown; post?: unknown } | null
  if (sender.id !== chrome.runtime.id || asked?.type !== 'clip') return
  const failed: Sent = { ok: false, why: WHY.offline }
  void chrome.storage.local
    .get('code')
    .then(({ code }) => send(typeof code === 'string' ? code : '', asPost(asked.post)))
    .then(respond, () => respond(failed))
  // Answered when it's sent.
  return true
})
