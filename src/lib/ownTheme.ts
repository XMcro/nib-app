/**
 * A theme of one's own (Customize, Nib Plus): the writer picks the page, the
 * text and the accent, and the rest of what a theme sets is worked out from
 * them here, as it was for the named themes: the library's shell, the lines,
 * the hover and selected rows, the muted and faint text, the highlight.
 * Two of those the writer can choose instead, the library's background
 * (`shell`) and the highlight, each held to the text reading on it; left
 * out, each is worked out as before.
 *
 * Worked out in script rather than with CSS color-mix(), which iOS 15 and 16.0
 * don't have, and so that muted text and the highlight can be held to their
 * contrast rather than hoped into it.
 */
export type OwnColors = { paper: string; ink: string; accent: string; shell?: string; highlight?: string }

/** The two that can be chosen or left to be worked out, as Customize calls them. */
export const OWN_EXTRAS = [
  ['shell', 'Library'],
  ['highlight', 'Highlight'],
] as const

/** A starting point: warm paper, near-black ink, and Nib's accent a shade deeper, to read on that paper. */
export const DEFAULT_OWN: OwnColors = { paper: '#fbf8f1', ink: '#2b2a27', accent: '#43707f' }

/** Text and links both have to read on the page: the 4.5:1 of body text. */
export const OWN_MIN = 4.5

const HEX = /^#[0-9a-f]{6}$/i
export const isColor = (value: unknown): value is string => typeof value === 'string' && HEX.test(value)

type Rgb = [number, number, number]
const rgb = (hex: string): Rgb => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb
const hex = (color: Rgb) => '#' + color.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')
/** `amount` of the way from `from` to `to`. */
const mix = (from: string, to: string, amount: number) => {
  const [a, b] = [rgb(from), rgb(to)]
  return hex(a.map((value, i) => value + (b[i] - value) * amount) as Rgb)
}

function luminance(color: string) {
  const [r, g, b] = rgb(color).map((value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Whether the text and the accent read on the page, and the text on a library
 * background or highlight that was chosen; what each comes to, either way.
 */
export function readable(colors: OwnColors) {
  const ink = contrast(colors.ink, colors.paper)
  const accent = contrast(colors.accent, colors.paper)
  const shell = colors.shell === undefined ? undefined : contrast(colors.ink, colors.shell)
  const highlight = colors.highlight === undefined ? undefined : contrast(colors.ink, colors.highlight)
  const ok = [ink, accent, shell, highlight].every((reads) => reads === undefined || reads >= OWN_MIN)
  return { ok, ink, accent, shell, highlight }
}

/** What index.css's `[data-theme='custom']` reads, as `--own-*`. */
export const OWN_VARS = ['paper', 'shell', 'ink', 'muted', 'accent', 'line', 'faint', 'item-active', 'item-hover', 'highlight'] as const

/** Everything a theme sets, from the three. */
export function palette(colors: OwnColors): { dark: boolean; vars: Record<(typeof OWN_VARS)[number], string> } {
  const { paper, ink, accent } = colors
  // Dark when white text would read better on it than black.
  const dark = contrast(paper, '#ffffff') > contrast(paper, '#000000')
  // The library a shade toward the ink, unless that's the shade the ink
  // can't spare: text that only just reads on the page has to read there too.
  let shell = colors.shell ?? mix(paper, ink, 0.03)
  if (colors.shell === undefined && contrast(ink, shell) < OWN_MIN) shell = paper
  // As far toward the ink as it takes to read on the page and the shell, the
  // ink itself at the most, which reads on both.
  let amount = 0.55
  let muted = mix(paper, ink, amount)
  while (Math.min(contrast(muted, paper), contrast(muted, shell)) < OWN_MIN && amount < 1) {
    amount = Math.min(1, amount + 0.02)
    muted = mix(paper, ink, amount)
  }
  // The accent washed into the page, as far back as the ink still reads on
  // it: the page itself at the least, which the ink reads on.
  let wash = 0.35
  let highlight = colors.highlight ?? mix(paper, accent, wash)
  while (colors.highlight === undefined && contrast(ink, highlight) < OWN_MIN && wash > 0) {
    wash = Math.max(0, wash - 0.02)
    highlight = mix(paper, accent, wash)
  }
  return {
    dark,
    vars: {
      paper,
      shell,
      ink,
      muted,
      accent,
      line: mix(paper, ink, 0.1),
      faint: mix(paper, ink, 0.3),
      'item-active': mix(paper, ink, 0.08),
      'item-hover': mix(paper, ink, 0.05),
      highlight,
    },
  }
}
