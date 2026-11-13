import { registerPlugin } from '@capacitor/core'

export type Biometry = 'faceID' | 'touchID' | 'opticID' | 'none'

/**
 * The Keychain (ios/App/App/NibKeychainPlugin.swift), on this device alone:
 * the sync code (sync), where iOS clearing the web view's storage can't lose
 * it; and the vault's passcode, if the writer asks, behind Face ID or Touch
 * ID (lib/vaultKey).
 */
export const keychain = registerPlugin<{
  /** `lasting`: an entry that stays through deleting and downloading Nib again (lib/feedback). */
  get(options: { key: string; lasting?: boolean }): Promise<{ value: string | null }>
  set(options: { key: string; value: string; lasting?: boolean }): Promise<void>
  remove(options: { key: string }): Promise<void>
  vaultStatus(): Promise<{ biometry: Biometry; stored: boolean }>
  vaultStore(options: { passcode: string }): Promise<void>
  /** Asks for Face ID or Touch ID first; rejects if that's cancelled or fails, or the passcode is gone. */
  vaultRecall(): Promise<{ passcode: string }>
  vaultForget(): Promise<void>
}>('NibKeychain')
