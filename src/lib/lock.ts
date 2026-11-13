import { registerPlugin } from '@capacitor/core'
import { onVaultChange, vaultOpen } from './vault'

/**
 * "Lock Nib". The lock itself is native (ios/App/App/NibLockPlugin.swift): it
 * has to cover the window before the page has drawn and before iOS takes the
 * app-switcher snapshot, and JavaScript runs too late for both. The page only
 * reads the setting and changes it.
 */

export type LockStatus = {
  enabled: boolean
  /** Seconds away before it locks again; 0 is immediately. */
  after: number
  /** False when the device has no passcode, so there is nothing to unlock with. */
  available: boolean
  biometry: 'faceID' | 'touchID' | 'opticID' | 'none'
  device: 'iPhone' | 'iPad' | 'Mac'
  /** Behind its cover now, waiting for Face ID or the passcode. Missing from builds before 1.10.05. */
  locked?: boolean
  /** Privacy mode: covered in the app switcher, Lock Nib on or off, and while the screen is recorded, mirrored or shared. Missing where the app has none. */
  privacy?: boolean
}

interface NibLock {
  status(): Promise<LockStatus>
  /** Turning it on or off asks for Face ID or the passcode first, and rejects if that is cancelled. */
  set(options: { enabled: boolean; after: number }): Promise<LockStatus>
  /** Whether the vault is open, so Nib is covered on the way out (coverOpenVault). */
  vault(options: { open: boolean }): Promise<void>
  /** Privacy mode on or off. No Face ID: it's a cover, not a lock. */
  privacy(options: { on: boolean }): Promise<LockStatus>
}

export const lock = registerPlugin<NibLock>('NibLock')

/**
 * In the app: Nib is covered on the way out while the vault is open, Lock
 * Nib on or not, as iOS keeps a snapshot of the screen for the app switcher,
 * and with the vault open that can be a locked note's text or its title.
 * Follows the vault from now on; returns how to stop.
 */
export function coverOpenVault(): () => void {
  const tell = () => void lock.vault({ open: vaultOpen() }).catch(() => {})
  tell()
  return onVaultChange(tell)
}

/** Whether Nib is behind its cover now. Not where there is no native lock to ask. */
export const coveredNow = () =>
  lock
    .status()
    .then((status) => status.locked === true)
    .catch(() => false)

export const LOCK_AFTER: [number, string][] = [
  [0, 'Immediately'],
  [60, 'After 1 minute'],
  [300, 'After 5 minutes'],
  [900, 'After 15 minutes'],
  [3600, 'After 1 hour'],
]

/** What unlocks it, in the words the device itself uses. */
export function describeUnlock(status: LockStatus): string {
  const secret = status.device === 'Mac' ? 'your password' : 'your passcode'
  const biometry = { faceID: 'Face ID', touchID: 'Touch ID', opticID: 'Optic ID', none: '' }[status.biometry]
  return biometry ? `With ${biometry} or ${secret}` : `With ${secret}`
}

/** Why the switch is off limits, when it is. */
export function unavailableReason(status: LockStatus): string {
  return status.device === 'Mac'
    ? 'Set a login password on this Mac to use this.'
    : `Set a passcode on this ${status.device} to use this.`
}
