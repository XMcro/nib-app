import { keychain } from '../lib/keychain'
import { nativeApp } from '../lib/platform'

const CODE_KEY = 'nib-sync-code'

// In the app the code lives in the Keychain (lib/keychain); the web view's
// storage can be cleared by iOS, and losing the code there would look like
// losing sync.

export const codeStore = {
  async get(): Promise<string | null> {
    if (nativeApp) return (await keychain.get({ key: CODE_KEY })).value
    try {
      return localStorage.getItem(CODE_KEY)
    } catch {
      return null
    }
  },
  async set(code: string): Promise<void> {
    if (nativeApp) return keychain.set({ key: CODE_KEY, value: code })
    localStorage.setItem(CODE_KEY, code)
  },
  async clear(): Promise<void> {
    if (nativeApp) return keychain.remove({ key: CODE_KEY })
    localStorage.removeItem(CODE_KEY)
  },
}
