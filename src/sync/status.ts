import { SyncHttpError } from './api'

/** `manual`: on, and set to sync only when asked (sync/session), with nothing asked for yet or writing here not yet sent. */
export type SyncState = 'off' | 'syncing' | 'synced' | 'offline' | 'inactive' | 'error' | 'elsewhere' | 'manual'
export type SyncStatus = { state: SyncState; at?: number; message?: string }

export function describeSync(status: SyncStatus): string {
  switch (status.state) {
    case 'off':
      return 'Off'
    case 'syncing':
      return 'Syncing…'
    case 'synced':
      return 'Synced'
    case 'offline':
      return 'Offline — will sync when back online'
    case 'inactive':
      return 'Paused — Nib Plus isn’t active for this library'
    case 'elsewhere':
      return 'Syncing in another tab'
    case 'manual':
      return 'Syncs when you ask'
    case 'error':
      return 'Not syncing'
  }
}

export function describeError(error: unknown): SyncStatus {
  if (error instanceof SyncHttpError) {
    if (error.status === 402) return { state: 'inactive', message: error.message }
    if (error.status === 404) return { state: 'error', message: 'This sync library no longer exists. It may have been deleted, or its code changed, on another device.' }
    return { state: 'error', message: error.message }
  }
  // fetch rejects only when it never reached the server.
  return { state: 'offline' }
}
