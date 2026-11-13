import { asPost, send, WHY, type Sent } from './clip'

/**
 * The extension's background: the one place a clip is sent from. The popup
 * and the page's picker hand it a clip; it seals it with the code kept in the
 * extension's own storage and sends it there (clipper/clip `send`). A page's
 * script can't send across sites itself, and is never given the code.
 *
 * It takes a clip only from this extension, and never where to send one.
 */
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
