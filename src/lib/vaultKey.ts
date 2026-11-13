import { keychain, type Biometry } from './keychain'
import { nativeApp } from './platform'

/**
 * The vault opened with Face ID, Touch ID or Optic ID (components/VaultDialog):
 * a long passphrase is what keeps it safe, and typing one each time Nib comes
 * back is what makes people choose a short one. If the writer asks, its
 * passcode is kept in the Keychain on this device alone, behind biometrics
 * only (not the device passcode), and enrolling another face or finger loses
 * it, so it's typed again.
 */

const NAMES: Record<Exclude<Biometry, 'none'>, string> = { faceID: 'Face ID', touchID: 'Touch ID', opticID: 'Optic ID' }

/** What could open the vault here, and whether it has the passcode; null where nothing can (none set up, or not the app). */
export async function vaultUnlock(): Promise<{ name: string; stored: boolean } | null> {
  if (!nativeApp) return null
  const status = await keychain.vaultStatus().catch(() => null)
  if (!status || status.biometry === 'none') return null
  return { name: NAMES[status.biometry], stored: status.stored }
}

/** The kept passcode, once Face ID or Touch ID says so; null if that was cancelled or failed. */
export async function recallPasscode(): Promise<string | null> {
  try {
    return (await keychain.vaultRecall()).passcode
  } catch {
    return null
  }
}

export function rememberPasscode(passcode: string): Promise<void> {
  return keychain.vaultStore({ passcode })
}

export function forgetPasscode(): Promise<void> {
  return keychain.vaultForget()
}
