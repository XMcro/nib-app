import { useSyncExternalStore } from 'react'
import { registerPlugin } from '@capacitor/core'
import type { Theme } from './theme'

/**
 * The on-screen keyboard on iPhone and iPad, as the app reports it
 * (ios/App/App/MainViewController.swift, the `nibkeyboard` event).
 *
 * While the text is being written in, the keyboard slides over the page as
 * it does over any text on iOS, and the formatting bar rides on it
 * (editor/FormatBar). For a field (search, the vault, the palette), which
 * lays itself out in what can be seen, the web view is asked to end where the
 * keyboard begins instead.
 */

export const nibWindow = registerPlugin<{
  setTheme(options: { theme: Theme; dark?: boolean }): Promise<void>
  fitKeyboard(options: { fit: boolean }): Promise<void>
  /** An alternate app icon by its asset name, or none for the standard one (Customize). */
  setIcon(options: { name?: string }): Promise<void>
  icon(): Promise<{ name?: string }>
  /** Lock Nib's cover in the page's colours, as #rrggbb (ios/App/App/NibLockPlugin). */
  setCover(options: { shell: string; ink: string }): Promise<void>
  /** Puts away the system's Cut, Copy and Paste menu (editor/SelectionToolbar). */
  hideEditMenu(): Promise<void>
  /** "Open Nib at login", on a Mac (Settings): whether macOS opens Nib at login, and asking it to or not to. */
  login(): Promise<LoginItem>
  setLogin(options: { on: boolean }): Promise<LoginItem>
}>('NibWindow')

/** `approval`: asked for, but turned off in System Settings, where it has to be allowed. Not `available` off the Mac, or before macOS 13. */
export type LoginItem = { available: boolean; on: boolean; approval: boolean }

/** `over`: how much of the page the keyboard lies over now. `sliding`: whether it got there by sliding, or the page changed size under it. */
export type Keyboard = { over: number; sliding: boolean }

/** How far a docked keyboard reaches up from the bottom of the window, and the window's height. */
let height = 0
let windowHeight = 0
let state: Keyboard = { over: 0, sliding: false }
let fitting = false
const listeners = new Set<() => void>()

function update(sliding: boolean) {
  // The web view may end at the keyboard (fitting) or run the whole window.
  const over = windowHeight ? Math.max(0, Math.round(height - (windowHeight - innerHeight))) : 0
  if (over !== state.over) state = { over, sliding }
  listeners.forEach((listener) => listener())
}

/** A field that raises the keyboard: not the text, which is contenteditable, and not a checkbox. */
function inField(): boolean {
  const element = document.activeElement
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true
  return element instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(element.type)
}

function decide() {
  const fit = height > 0 && inField()
  if (fit === fitting) return
  fitting = fit
  nibWindow.fitKeyboard({ fit }).catch(() => {})
}

/** Listens for the keyboard. Once, at start, in the app on iPhone and iPad. Returns a stop function. */
export function startKeyboard(): () => void {
  const onKeyboard = (event: Event) => {
    const report = event as Event & { height?: unknown; window?: unknown }
    if (typeof report.height !== 'number' || typeof report.window !== 'number') return
    height = report.height
    windowHeight = report.window
    decide()
    update(true)
  }
  const onResize = () => update(false)
  window.addEventListener('nibkeyboard', onKeyboard)
  window.addEventListener('resize', onResize)
  document.addEventListener('focusin', decide)
  return () => {
    window.removeEventListener('nibkeyboard', onKeyboard)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('focusin', decide)
  }
}

export function useKeyboard(): Keyboard {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}
