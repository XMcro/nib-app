import { SHARE_ORIGIN, SYNC_ORIGIN } from './hosts'
import { nativeApp } from './platform'

/**
 * Nib Plus's server: sync, and shared drafts. The website talks to its own
 * origin. The app, on capacitor://localhost, has to name the server; a local
 * build can point it elsewhere for testing.
 */
export const SERVER = nativeApp ? (import.meta.env.VITE_SYNC_URL ?? SYNC_ORIGIN) : ''

/**
 * Where share links point: the same server under nibprivacy.com, so the link
 * a reader gets names Nib's own domain. A local build's links go to its local
 * server, like everything else.
 */
export const SHARE_HOST = nativeApp ? (import.meta.env.VITE_SYNC_URL ?? SHARE_ORIGIN) : ''
