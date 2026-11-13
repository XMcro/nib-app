import { useEffect, useLayoutEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { count } from './counts'
import { nibWindow } from './keyboard'
import { applyLook, setLookPlus, useLook } from './look'
import { nativeApp } from './platform'
import { applyTheme, effectiveTheme, isDark, NAMED, named, readTheme, WINTER, writeTheme, type Theme } from './theme'

/** The theme and the look, put on the page; changing the theme; and the theme's rows in the palette. */
export function useTheme(plusGate: { active: boolean; known: boolean }) {
  const [theme, setTheme] = useState<Theme>(readTheme)

  // Lives here rather than in Settings: 'system' must keep tracking the OS
  // even while the settings panel is closed.
  // A Nib Plus theme shows only with Plus; without it, System.
  const shownTheme = effectiveTheme(theme, plusGate)
  // Customize's choices: the Plus half only with Plus, like a Plus theme. Put
  // on <html> before the first paint, so a chosen size or font never shows
  // the default first.
  const look = useLook()
  useEffect(() => setLookPlus(plusGate))
  useLayoutEffect(() => applyLook(look), [look])
  useEffect(() => {
    // The app's window takes the page's light or dark: on the Mac the title
    // bar, which macOS draws in its own appearance otherwise (Light under Dark
    // Mode was a white page beneath a dark bar); on iPhone and iPad the status
    // bar and the keyboard, or a light theme under Dark Mode had white status
    // text on a pale page. A named theme says which it is, and one's own.
    const dark = named(shownTheme) || shownTheme === 'custom' ? isDark(shownTheme, look.ownTheme) : undefined
    if (nativeApp) nibWindow.setTheme({ theme: shownTheme, dark }).catch(() => {})
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      applyTheme(shownTheme, look.ownTheme)
      // Lock Nib's cover in the same colours, now and on the next launch,
      // when it is up before the page has said anything (NibLockPlugin).
      if (!nativeApp) return
      const colors = getComputedStyle(document.documentElement)
      const color = (name: string) => colors.getPropertyValue(name).trim()
      nibWindow.setCover({ shell: color('--color-shell'), ink: color('--color-ink') }).catch(() => {})
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [shownTheme, look.ownTheme])

  function changeTheme(next: Theme) {
    count('theme_changed')
    writeTheme(next)
    // A cross-fade from the old picture to the new (index.css), with the new
    // theme on the page before the new picture is taken. Where there are no
    // view transitions (iOS before 18), it simply changes.
    const swap = () => {
      flushSync(() => setTheme(next))
      applyTheme(effectiveTheme(next, plusGate), look.ownTheme)
    }
    // One started before the last is ready skips it, as clicking quickly
    // through the themes does. The swap runs either way.
    if (document.startViewTransition) document.startViewTransition(swap).ready.catch(() => {})
    else swap()
  }

  return {
    theme,
    look,
    changeTheme,
    /** A backup has replaced the library: the theme it brought takes effect. */
    rereadTheme: () => setTheme(readTheme()),
    /** Its rows in the palette: Winter's there if `winter`. */
    themeCommands: (winter: boolean, askPlus: (reason: string) => void) => [
      { id: 'theme-light', label: 'Appearance: Light', run: () => changeTheme('light') },
      { id: 'theme-dark', label: 'Appearance: Dark', run: () => changeTheme('dark') },
      { id: 'theme-system', label: 'Appearance: Follow system', run: () => changeTheme('system') },
      // Found by searching, so they don't fill the list. A Plus theme asks for
      // Plus without it; Winter is there once Christmas Day's present has given it.
      ...NAMED.filter((one) => one.id !== WINTER || winter).map((one) => ({
        id: `theme-${one.id}`,
        label: `Appearance: ${one.label}`,
        searchOnly: true,
        run: () => (one.plus && !plusGate.active ? askPlus(`${one.label} is one of the Nib Plus themes.`) : changeTheme(one.id)),
      })),
    ],
  }
}
