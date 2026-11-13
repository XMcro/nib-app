import { isColor, OWN_EXTRAS, readable, type OwnColors } from './ownTheme'

/**
 * A theme of one's own (lib/ownTheme) as a file, to send to someone or keep:
 * its colours and nothing else, under the names Customize gives them. A file
 * is read as data only: a colour is six hex digits or it isn't one, and
 * whatever else is in the file is ignored. What's installed has to read as a
 * theme made here does.
 */
/** A .json file, which it is: iOS's file picker lets only kinds of file it knows be chosen. */
export const THEME_FILE_NAME = 'Nib theme.json'
/** Far more than five colours need: anything bigger isn't one, and isn't read. */
export const THEME_FILE_MAX = 4096

const NAMES = { paper: 'page', ink: 'text', accent: 'accent', shell: 'library', highlight: 'highlight' } as const

export function themeFile(colors: OwnColors): string {
  const named = Object.entries(NAMES).flatMap(([part, name]) => {
    const color = colors[part as keyof OwnColors]
    return color === undefined ? [] : [[name, color]]
  })
  return JSON.stringify({ nib: 'theme', ...Object.fromEntries(named) }, null, 2) + '\n'
}

/** A theme file's colours; or why not: it isn't a theme file, or its text wouldn't read. */
export function readThemeFile(text: string): OwnColors | 'not-a-theme' | 'unreadable' {
  let file: Record<string, unknown>
  try {
    file = JSON.parse(text)
  } catch {
    return 'not-a-theme'
  }
  if (typeof file !== 'object' || file === null || file.nib !== 'theme') return 'not-a-theme'
  const { page, text: ink, accent } = file
  if (!isColor(page) || !isColor(ink) || !isColor(accent)) return 'not-a-theme'
  const colors: OwnColors = { paper: page.toLowerCase(), ink: ink.toLowerCase(), accent: accent.toLowerCase() }
  for (const [part] of OWN_EXTRAS) {
    const chosen = file[NAMES[part]]
    if (chosen === undefined) continue
    if (!isColor(chosen)) return 'not-a-theme'
    colors[part] = chosen.toLowerCase()
  }
  return readable(colors).ok ? colors : 'unreadable'
}
