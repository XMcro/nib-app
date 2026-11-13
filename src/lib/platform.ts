import { Capacitor } from '@capacitor/core'
import type { Device } from './reported'

const apple = /Mac|iP(hone|ad|od)/.test(navigator.userAgent)

/** "⌘⇧S" on Apple keyboards, "Ctrl+Shift+S" everywhere else. */
export function shortcut(
  key: string,
  { alt = false, shift = false }: { alt?: boolean; shift?: boolean } = {},
): string {
  return apple
    ? `⌘${alt ? '⌥' : ''}${shift ? '⇧' : ''}${key}`
    : `Ctrl+${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${key}`
}

/** True when the event carries this platform's primary modifier. */
export function hasMod(event: KeyboardEvent): boolean {
  return apple ? event.metaKey : event.ctrlKey
}

/**
 * True inside the iOS app, false in every browser — Safari on an iPhone too.
 * The app's web view lets code raise the keyboard, which Safari only allows
 * straight after a tap, so the app is where focus has to be left alone.
 */
export const nativeApp = Capacitor.isNativePlatform()

/**
 * True in the Mac app (Mac Catalyst). The native side sets the flag before the
 * page loads (ios/App/App/MainViewController.swift). A Mac always has a
 * keyboard and focus raises nothing, so the desktop rules apply there.
 */
export const macApp = nativeApp && (window as { nibPlatform?: string }).nibPlatform === 'mac'

/** Which kind of device, as lib/counts and lib/feedback say it. An iPad's web view calls itself a Mac, with touch. */
export const deviceKind = (): Device => (macApp ? 'mac' : /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) ? 'ipad' : 'iphone')

/** The app on an iPhone or iPad, where focusing text raises the on-screen keyboard. */
export const touchApp = nativeApp && !macApp

/**
 * Whether to name keyboard shortcuts anywhere. Never in the iPhone and iPad
 * app, even with a keyboard attached: Nib doesn't support a keyboard there,
 * and ignores any key pressed with ⌘ or ⌃ (lib/useShortcuts).
 */
export const showsShortcuts = !touchApp

/** New note: ⌘N in the Mac app, whose menu owns it; ⌘⌥N in a browser, where ⌘N opens a window. */
export const NEW_NOTE_SHORTCUT = macApp ? shortcut('N') : shortcut('N', { alt: true })

/** New page: ⇧⌘N in the Mac app's menu; in a browser the same ⌘⌥N, which makes what the library is showing. */
export const NEW_PAGE_SHORTCUT = macApp ? shortcut('N', { shift: true }) : NEW_NOTE_SHORTCUT

/** Show or hide the library: ⌃⌘S in the Mac app, the Mac's usual one for a sidebar (1Password takes ⌘\ there); ⌘\ elsewhere. */
/** Tabs (lib/tabs): a new one, and along the strip either way. */
export const NEW_TAB_SHORTCUT = shortcut('T')
export const NEXT_TAB_SHORTCUT = apple ? '⌃⇥' : 'Ctrl+Tab'
export const PREVIOUS_TAB_SHORTCUT = apple ? '⌃⇧⇥' : 'Ctrl+Shift+Tab'

export const LIBRARY_SHORTCUT = macApp ? '⌃⌘S' : shortcut('\\')
