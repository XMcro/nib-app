import { marked } from 'marked'
import { generateJSON } from '@tiptap/html'
import type { JSONContent } from '@tiptap/react'
import type { Kind } from '../db/db'
import { nibExtensions } from '../editor/extensions'
import { withoutDefaultAlignment } from './alignment'
import { asCalloutKind, type CalloutKind } from './callouts'
import { allowedImageSrc, filterBodyImages } from './image'
import { looksLikeMath } from './math'

export type Incoming = { kind: Kind; markdown: string }

// Dated, so a user's own note titled "# Nib export format notes" is imported
// as the ordinary document it is rather than unpacked as an export. No `g`
// flag: this is reused across calls and `lastIndex` would make it stateful.
const EXPORT_HEADER = /^# Nib export — \d{4}-\d{2}-\d{2}/
const ENTRY_RULE = /\n\n---\n\n/

/** Drops the `### Title` and `*date*` lines an export adds back on. */
function stripEntryHeader(entry: string): string {
  // Trim first: the section split leaves a leading newline, which would stop
  // the ^ anchors below from matching.
  return entry
    .trim()
    .replace(/^###\s+.*\n+/, '')
    .replace(/^\*\d{4}-\d{2}-\d{2}\*\n+/, '')
    .trim()
}

/** True for a file Nib's own export wrote, which holds many documents. */
export function isNibExport(markdown: string): boolean {
  return EXPORT_HEADER.test(markdown.trim())
}

/**
 * One file is normally one document. A Nib export is the exception: it is
 * unpacked back into the notes and pages it came from, so export/import
 * round-trips instead of collapsing into a single giant note.
 */
export function parseImport(markdown: string, fallbackKind: Kind): Incoming[] {
  const text = markdown.trim()
  if (!text) return []

  if (!isNibExport(text)) {
    return [{ kind: fallbackKind, markdown: text }]
  }

  const incoming: Incoming[] = []
  // Everything after a `## Notes` / `## Pages` heading belongs to that kind.
  const sections = text.split(/\n## (Notes|Pages)\n/)
  for (let i = 1; i < sections.length; i += 2) {
    const kind: Kind = sections[i] === 'Pages' ? 'page' : 'note'
    for (const entry of sections[i + 1].split(ENTRY_RULE)) {
      const body = stripEntryHeader(entry)
      if (body) incoming.push({ kind, markdown: body })
    }
  }
  // An export whose section headings were edited away unpacks to nothing.
  // Importing the file as one document keeps the text, where returning an
  // empty list would look identical to not having imported at all.
  return incoming.length ? incoming : [{ kind: fallbackKind, markdown: text }]
}

/**
 * Obsidian's kinds of callout that Nib has no kind for, and its other words for the ones it has, as the nearest of Nib's eight.
 * Its `important` and `caution` are Nib's own kinds, and stay those. A Map: a callout named `constructor` is no kind.
 */
const OBSIDIAN_CALLOUTS = new Map<string, CalloutKind>([
  ['abstract', 'note'],
  ['summary', 'note'],
  ['tldr', 'note'],
  ['example', 'note'],
  ['todo', 'info'],
  ['hint', 'tip'],
  ['check', 'success'],
  ['done', 'success'],
  ['help', 'question'],
  ['faq', 'question'],
  ['attention', 'warning'],
  ['failure', 'caution'],
  ['fail', 'caution'],
  ['missing', 'caution'],
  ['danger', 'caution'],
  ['error', 'caution'],
  ['bug', 'caution'],
])
/** Obsidian's callout that is a quotation: it stays one, without its marker. */
const OBSIDIAN_QUOTES = new Set(['quote', 'cite'])

/**
 * Two places where marked's HTML and Nib's schema disagree, and the schema
 * would silently drop what it does not recognise.
 *
 * marked emits GFM checkboxes as a plain `<li><input type=checkbox>`, which
 * TipTap reads as an ordinary bullet and discards; TaskItem matches on
 * `data-type`, so the markup is rewritten into the shape it expects. And an
 * image Nib will not store is turned back into visible text rather than
 * vanishing.
 */
function reshapeForSchema(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  for (const input of parsed.querySelectorAll('li > input[type="checkbox"]')) {
    const item = input.parentElement
    const list = item?.parentElement
    if (!item || list?.tagName !== 'UL') continue
    list.setAttribute('data-type', 'taskList')
    item.setAttribute('data-type', 'taskItem')
    item.setAttribute('data-checked', input.hasAttribute('checked') ? 'true' : 'false')
    input.remove()
  }

  // GitHub's and Obsidian's `> [!NOTE]` is a quotation to marked. A word in the square brackets that neither has stays one, as written.
  for (const quote of parsed.querySelectorAll('blockquote')) {
    const first = quote.firstElementChild
    const words = first?.tagName === 'P' ? first.firstChild : null
    const alert = words?.nodeType === Node.TEXT_NODE ? /^\[!(\w+)\]([+-]?)[ \t]*(.*)(\n?)\s*/.exec(words.textContent ?? '') : null
    const word = alert?.[1].toLowerCase() ?? ''
    const kind = asCalloutKind(word) ?? OBSIDIAN_CALLOUTS.get(word)
    if (!words || !alert || !(kind || OBSIDIAN_QUOTES.has(word))) continue
    const rest = words.textContent!.slice(alert[0].length)
    const title = alert[3].trim()
    // Obsidian's title for the box, written after the marker with the box's words under it: a line of its own, the one a folded box shows.
    if (title && alert[4]) {
      const line = parsed.createElement('p')
      line.textContent = title
      first!.before(line)
      words.textContent = rest
    } else words.textContent = alert[3] + rest
    if (!first!.textContent) first!.remove()
    if (!kind) continue
    const box = parsed.createElement('div')
    box.dataset.callout = kind
    if (alert[2] === '-') box.toggleAttribute('data-collapsed', true)
    box.append(...quote.childNodes)
    quote.replaceWith(box)
  }

  // An image Nib will not store — a file path, a remote URL — would otherwise
  // be dropped by the schema without a trace. Put the reference back as visible
  // text so the writer can see what was there and go and find it.
  for (const image of parsed.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? ''
    if (allowedImageSrc(src)) continue
    image.replaceWith(
      parsed.createTextNode(`![${image.getAttribute('alt') ?? ''}](${src})`),
    )
  }
  return parsed.body.innerHTML
}

/** A formula's LaTeX, as text, for the span or div editor/Math reads one back from. */
const texAsText = (tex: string) => tex.replace(/[&<>]/g, (char) => `&#${char.charCodeAt(0)};`)

/**
 * Whether the Markdown being read has a dollar in it at all. marked asks at
 * every step of a paragraph where the next formula might start, and looking
 * through the rest of the text each time made a long paragraph's reading grow
 * with the square of its length. Most writing has none, and isn't looked through.
 */
let dollars = false

// A formula as Pandoc, Obsidian and GitHub write one, and as Nib does (lib/markdown): `$…$` in a
// line, `$$…$$` on lines of its own. Read before anything else in it, so its `_` and `*` aren't
// taken for emphasis; and never in code, which is read first.
marked.use({
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      start: (src: string) => (dollars ? /^\$\$/m.exec(src)?.index : undefined),
      // No empty line inside it: LaTeX allows none there, and two stray pairs of dollars far apart aren't a formula.
      tokenizer(src: string) {
        const match = /^\$\$[ \t]*\n?((?:(?!\n[ \t]*\n)[^$])+?)\n?[ \t]*\$\$[ \t]*(?:\n+|$)/.exec(src)
        return match && match[1].trim() ? { type: 'mathBlock', raw: match[0], tex: match[1].trim() } : undefined
      },
      renderer: (token) => `<div data-math>${texAsText(String(token.tex))}</div>\n`,
    },
    {
      name: 'mathInline',
      level: 'inline',
      // Where one could open: a dollar after a space or a bracket. One in a word (US$5) is a dollar.
      // The first character of what marked hands over follows one it doesn't show, so a dollar there is tried.
      start(src: string) {
        if (!dollars) return undefined
        for (let at = src.indexOf('$'); at >= 0; at = src.indexOf('$', at + 1)) {
          if (at === 0 || /[\s(]/.test(src[at - 1])) return at
        }
        return undefined
      },
      // No space inside either dollar, no digit after the second, and more than a price between them (lib/math).
      tokenizer(src: string) {
        const match = /^\$([^\s$](?:[^$\n]*[^\s$])?)\$(?!\d)/.exec(src)
        return match && looksLikeMath(match[1]) ? { type: 'mathInline', raw: match[0], tex: match[1] } : undefined
      },
      renderer: (token) => `<span data-math>${texAsText(String(token.tex))}</span>`,
    },
  ],
})

/** Markdown as HTML, read the same way wherever Markdown comes in. */
export function markdownToHtml(markdown: string): string {
  dollars = markdown.includes('$')
  return marked.parse(tame(markdown), { async: false, gfm: true }) as string
}

/** More `*`, `_`, `~` and `[` than any paragraph of writing has. */
const MAX_MARKS = 1000
/** What marked takes the square of a paragraph's count of: emphasis, strikethrough (one `~` will do), and link openers. */
const MARKS = /[*_~[]/g
/** Deeper than any list anyone writes: 32 levels at two spaces each. */
const MAX_INDENT = 64
/** What starts a line and is not emphasis: quote markers, indentation, a bullet, and a checklist's box. */
const PREFIX = /^(?:[ \t]*>)*[ \t]*(?:[*+-][ \t]+(?:\[[ xX]\][ \t]+)?)?/
/** A `***` or `___` rule, which escaped would read as text. */
const RULE = /^ {0,3}([*_-])(?:[ \t]*\1){2,}[ \t]*$/

/**
 * What marked takes too long over, on the main thread, made harmless in one
 * pass. Its emphasis takes time that grows with the square of a paragraph's
 * unmatched `*` and `_`: a 40 KB paragraph of them took 7.5 s. So does its
 * strikethrough with `~`, and its links with `[`. Past MAX_MARKS they are
 * escaped, and read as the characters they are; bullets
 * and rules, which are not emphasis, are left to mean what they did. And its
 * lists grow costly with their depth: 700 levels deep, an import failed.
 * Indentation past MAX_INDENT is held to it. Code fences are left as written.
 */
function tame(markdown: string): string {
  const lines = markdown.split('\n')
  let fence: string | null = null
  let paragraph: number[] = []
  const prose = (line: string) => (RULE.test(line) ? '' : line.slice(PREFIX.exec(line)![0].length))
  const close = () => {
    const marks = paragraph.reduce((n, i) => n + (prose(lines[i]).match(MARKS)?.length ?? 0), 0)
    if (marks > MAX_MARKS) {
      for (const i of paragraph) {
        const text = prose(lines[i])
        lines[i] = lines[i].slice(0, lines[i].length - text.length) + text.replace(MARKS, '\\$&')
      }
    }
    paragraph = []
  }
  lines.forEach((line, i) => {
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = null
      return
    }
    if (opener) {
      close()
      fence = opener
      return
    }
    if (!line.trim()) return close()
    if (/^[ \t]{65}/.test(line)) lines[i] = line.replace(/^[ \t]+/, ' '.repeat(MAX_INDENT))
    paragraph.push(i)
  })
  close()
  return lines.join('\n')
}

/** HTML becomes editor JSON on Nib's own schema. */
export function htmlToBody(html: string, kind: Kind): JSONContent {
  return filterBodyImages(withoutDefaultAlignment(generateJSON(reshapeForSchema(html), nibExtensions(kind === 'page'))))
}

/** Markdown becomes HTML, then editor JSON on Nib's own schema. */
export function markdownToBody(markdown: string, kind: Kind): JSONContent {
  return htmlToBody(markdownToHtml(markdown), kind)
}
