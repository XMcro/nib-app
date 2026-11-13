import { DEFAULT_OWN, OWN_VARS, palette, type OwnColors } from './ownTheme'

/** Light, Dark or following the system: the three modes, and the picker's segments. */
export type Mode = 'light' | 'dark' | 'system'

/**
 * The named themes, each a palette in index.css (`[data-theme]`), adapted from
 * Blender's theme directory (extensions.blender.org/themes): the paper, ink
 * and accent of each theme's text editor, with the rest worked out from them.
 * `dark` puts the `.dark` class on too, for what is drawn differently on a
 * dark page. Four are Nib Plus, the last in the colours of its own badge
 * (assets/plus-badge.png). Winter, Nib's own, is earned instead: it's
 * offered once Christmas Day's present (lib/rewards) has been opened, and
 * kept after, Plus or not.
 */
export const NAMED = [
  { id: 'midnight-blue', label: 'Midnight Blue', dark: true, plus: false, shell: '#1c232d' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', dark: true, plus: false, shell: '#3c3836' },
  { id: 'green-olive', label: 'Green Olive', dark: true, plus: false, shell: '#1e1e1e' },
  { id: 'clean-blue', label: 'Clean Blue', dark: false, plus: false, shell: '#e8ebf0' },
  { id: 'gruvbox-light', label: 'Gruvbox Light', dark: false, plus: false, shell: '#ebdbb2' },
  { id: 'pastel-pink', label: 'Pastel Pink', dark: false, plus: false, shell: '#f7c4d7' },
  { id: 'cream-soda', label: 'Cream Soda', dark: false, plus: false, shell: '#e0d9ca' },
  { id: 'purple-green', label: 'Purple Green', dark: true, plus: true, shell: '#1b1b1b' },
  { id: 'alien-pink', label: 'Alien Pink', dark: true, plus: true, shell: '#121f2c' },
  { id: 'drcl', label: 'drcl', dark: true, plus: true, shell: '#303042' },
  { id: 'nib-plus', label: 'Nib Plus', dark: true, plus: true, shell: '#222227' },
  { id: 'winter', label: 'Winter', dark: false, plus: false, shell: '#e1e9f0' },
] as const

/** The theme Christmas Day's present gives. */
export const WINTER = 'winter'

export type Named = (typeof NAMED)[number]
/** `custom` is a theme of one's own (lib/ownTheme), Nib Plus, its colours kept with the look. */
export type Theme = Mode | Named['id'] | 'custom'

export const THEMES: Mode[] = ['light', 'dark', 'system']

export const THEME_LABEL: Record<Mode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

export const named = (theme: Theme): Named | undefined => NAMED.find((one) => one.id === theme)

export const isTheme = (value: unknown): value is Theme =>
  THEMES.includes(value as Mode) || NAMED.some((one) => one.id === value) || value === 'custom'

/** What a theme's name is shown as. */
export const themeLabel = (theme: Theme): string => (theme === 'custom' ? 'Your own' : (named(theme)?.label ?? THEME_LABEL[theme as Mode]))

/**
 * The theme to draw: a Nib Plus theme only with Plus, else System. Until the
 * App Store has answered (`known`), the chosen one, so a subscriber's never
 * flickers through another on the way in.
 */
export function effectiveTheme(theme: Theme, plus: { active: boolean; known: boolean }): Theme {
  return (theme === 'custom' || named(theme)?.plus) && plus.known && !plus.active ? 'system' : theme
}

const STORAGE_KEY = 'nib-theme'

/**
 * Anything other than an explicit choice means follow the system.
 *
 * Guarded because this runs as a `useState` initialiser: where the origin has
 * storage blocked, `getItem` throws, and an uncaught throw during the first
 * render leaves the user a blank page with their notes still sitting in
 * IndexedDB. The pre-paint script in index.html already guards the same key.
 */
export function readTheme(): Theme {
  let value: string | null = null
  try {
    value = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* storage blocked: follow the system */
  }
  return isTheme(value) ? value : 'system'
}

export function writeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* the preference simply is not remembered */
  }
}

/** --color-shell for each mode, mirrored in index.css and the web manifest. */
export const SHELL = { light: '#fafaf8', dark: '#0e0f11' } as const

/** Whether `theme` draws dark, now; for one's own, with `own`'s colours. */
export function isDark(theme: Theme, own: OwnColors = DEFAULT_OWN): boolean {
  if (theme === 'custom') return palette(own).dark
  const one = named(theme)
  if (one) return one.dark
  return theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
}

/** Where index.html's first-paint script finds one's own theme, worked out. */
export const OWN_PALETTE_KEY = 'nib-own-palette'

export function applyTheme(theme: Theme, own: OwnColors = DEFAULT_OWN): void {
  const one = named(theme)
  const dark = isDark(theme, own)
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  if (one) root.dataset.theme = one.id
  else if (theme === 'custom') root.dataset.theme = 'custom'
  else delete root.dataset.theme
  // One's own: its colours as `--own-*` for index.css, and kept for the next
  // launch's first paint, before any script of Nib's has run.
  const mine = theme === 'custom' ? palette(own) : null
  for (const name of OWN_VARS) {
    if (mine) root.style.setProperty(`--own-${name}`, mine.vars[name])
    else root.style.removeProperty(`--own-${name}`)
  }
  if (mine) {
    try {
      localStorage.setItem(OWN_PALETTE_KEY, JSON.stringify(mine))
    } catch {
      // The first paint follows the system instead.
    }
  }
  // Installed, the browser paints its own chrome around the app — the title bar
  // on Android, the status bar on iOS. Left alone it stays light while the app
  // goes dark. A media-query pair in the HTML cannot do this: it would follow
  // the system and ignore an explicit choice made against it.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', mine?.vars.shell ?? one?.shell ?? (dark ? SHELL.dark : SHELL.light))
}
