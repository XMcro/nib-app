/**
 * Whether Nib Web Clipper, the browser extension (src/clipper), is out in the
 * browsers' add-on stores. Held back for now (the user, 2026-11-13): till it
 * is, nothing in the app points to it, so no one looks for an extension they
 * can't get; the inbox it sends to is there all the same. Turned on, the Sync
 * panel offers its code again and Inkwell answers of it; its line goes back in
 * Billing's Plus list by hand, where it waits in a comment.
 */
export const CLIPPER_OUT = false
