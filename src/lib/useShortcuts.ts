import { useEffect, useEffectEvent } from 'react'
import { hasMod, showsShortcuts, touchApp } from './platform'
import { sheetUp } from './quiet'

/** Keys that still work with ⌘ or ⌃ on iPhone and iPad (see `ignore` below). */
const TEXT_EDITING = /^(Key[ACVXZ]|Arrow\w+|Backspace|Delete|Home|End|PageUp|PageDown|(Meta|Control|Shift|Alt)\w*)$/

/** The keyboard shortcuts, the hints that name them, and where they're turned off. */
export function useShortcuts({ toggleLibrary, startNew, togglePalette, toggleFocus, find, searchLibrary, tab }: {
  toggleLibrary: () => void
  startNew: () => void
  togglePalette: () => void
  toggleFocus: () => void
  find: () => void
  searchLibrary: () => void
  /** Runs a tab's command by its id in the palette, and says whether there was one to run: with none, the key is left to do what it does. */
  tab: (id: 'tab-new' | 'tab-next' | 'tab-previous') => boolean
}) {
  // No keyboard support on iPhone and iPad: a key pressed with ⌘ or ⌃ does
  // nothing there, neither Nib's shortcuts nor the editor's nor the web view's
  // own (its ⌘B bolds). Caught first, on the way down. The system's text
  // editing stays: copy, cut, paste, undo, select all, moving and deleting.
  useEffect(() => {
    if (!touchApp) return
    const ignore = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || TEXT_EDITING.test(event.code)) return
      event.stopImmediatePropagation()
      event.preventDefault()
    }
    window.addEventListener('keydown', ignore, true)
    return () => window.removeEventListener('keydown', ignore, true)
  }, [])

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Only a hardware keyboard sends a modifier; the one on screen never
    // does. From then on the shortcut hints are worth showing on touch too.
    if (showsShortcuts && (event.metaKey || event.ctrlKey || event.altKey) && !('keys' in document.documentElement.dataset)) {
      document.documentElement.dataset.keys = ''
      try {
        localStorage.setItem('nib-keys', '1')
      } catch {
        // Private mode: the hints still show for this session.
      }
    }
    // ⌃Tab on every platform, as in a browser: the next tab, and with Shift the one before.
    if (event.code === 'Tab' && event.ctrlKey && !event.metaKey && !event.altKey && !sheetUp() && tab(event.shiftKey ? 'tab-previous' : 'tab-next')) return event.preventDefault()
    if (!hasMod(event)) return
    // Under a sheet these would change what's behind it, unseen, as the Mac's menu would (App). Commands looks for itself.
    if (sheetUp() && event.code !== 'KeyK') return
    // `code` rather than `key`: on macOS, Option+N is a dead key.
    if (event.code === 'Backslash') {
      event.preventDefault()
      toggleLibrary()
    } else if (event.code === 'KeyN' && event.altKey) {
      event.preventDefault()
      startNew()
    } else if (event.code === 'KeyK') {
      event.preventDefault()
      togglePalette()
    } else if (event.code === 'KeyF' && event.shiftKey) {
      event.preventDefault()
      toggleFocus()
    } else if (event.code === 'KeyF' && event.altKey) {
      event.preventDefault()
      searchLibrary()
    } else if (event.code === 'KeyF') {
      event.preventDefault()
      find()
    } else if (event.code === 'KeyT' && !event.shiftKey && !event.altKey) {
      if (tab('tab-new')) event.preventDefault()
    }
  })

  useEffect(() => {
    // On iPhone and iPad nothing names a shortcut, even for someone who had a
    // keyboard attached under 1.0, when one keypress turned the hints on for good.
    if (!showsShortcuts) {
      delete document.documentElement.dataset.keys
      try {
        localStorage.removeItem('nib-keys')
      } catch {
        // Storage off: nothing was remembered.
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
