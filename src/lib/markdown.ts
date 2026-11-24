import { attachedName, NOT_INCLUDED } from './attachment'
import { isAllowedUri } from '@tiptap/extension-link'
import type { JSONContent } from '@tiptap/react'
import { wikiTarget } from './links'
import { asCalloutKind } from './callouts'

/**
 * Serialiser for our own schema only — hand-rolled because prosemirror-markdown
 * isn't bundled with @tiptap/pm and would cost a dependency for twelve cases.
 */
export function toMarkdown(doc: JSONContent): string {
  return (doc.content ?? [])
    .map((node) => block(node))
    .join('\n\n')
    .trim()
}

/** Longest run of backticks in `text`, so a fence can always outgrow it. */
function backtickRun(text: string): number {
  // One at a time: spread into Math.max, some 130,000 runs were more arguments than a call takes, and the export failed.
  let longest = 0
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length)
  return longest
}

/**
 * Backslash-escapes what the importer would otherwise read back as syntax.
 * Without this, text that merely looks like Markdown does not survive a round
 * trip: `a*b*c` loses its asterisks, `<div>` is deleted outright, and a line of
 * `---` or `## Notes` collides with the delimiters an export writes, tearing
 * one document into two. CommonMark honours a backslash before any ASCII
 * punctuation, so escaping is always safe to add.
 */
function escapeText(text: string): string {
  return text
    .replace(/[\\`*_~[\]<&]/g, (char) => `\\${char}`)
    .replace(/^(\s*)([#>+-])/gm, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/gm, '$1\\$2')
}

/** Percent-encodes what would otherwise end the URL early or break the line. */
function encodeHref(href: string): string {
  return href.replace(
    /[\s()<>\\]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  )
}

/** Lists indent themselves, so `children` must not indent them again. */
const LISTS = new Set(['bulletList', 'orderedList', 'taskList'])

function block(node: JSONContent, depth = 0): string {
  switch (node.type) {
    case 'heading':
      // A newline would end the heading, so a Shift+Enter break inside one has
      // to travel as `<br>` — which marked passes through and HardBreak parses
      // back. Otherwise half the title returns as a stray paragraph.
      // Nib's levels, 1 to 6: a stored level of 1e10 threw in repeat().
      return `${'#'.repeat(Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) || 1)))} ${inline(node, '<br>')}`
    case 'codeBlock': {
      // The language shares the opening fence's line, so it must not carry a
      // backtick or a newline of its own.
      const language = String(node.attrs?.language ?? '').replace(/[^\w+#.-]/g, '')
      const source = (node.content ?? []).map((child) => child.text ?? '').join('')
      // The fence has to outgrow the longest run inside it. A three-backtick
      // fence around content containing ``` closes early, and everything after
      // it in the document is swallowed as source.
      const fence = '`'.repeat(Math.max(3, backtickRun(source) + 1))
      return [fence + language, source, fence].join('\n')
    }
    case 'blockquote':
      return children(node, depth)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    case 'attachment':
      // Its name, and that it isn't here: Markdown has no way to hold a file.
      return `*${escapeText(attachedName(node))}* (${NOT_INCLUDED})`
    case 'mathBlock':
      // As Pandoc, Obsidian and GitHub write one: its LaTeX as it is, between dollars on lines of their own.
      return ['$$', texOf(node), '$$'].join('\n')
    case 'callout':
      // GitHub's and Obsidian's alert, its `-` Obsidian's for folded.
      return [`[!${(asCalloutKind(node.attrs?.kind) ?? 'note').toUpperCase()}]${node.attrs?.collapsed === true ? '-' : ''}`, ...children(node, depth).split('\n')].map((line) => `> ${line}`).join('\n')
    case 'bulletList':
      return (node.content ?? [])
        .map((item) => `${'  '.repeat(depth)}- ${children(item, depth + 1)}`)
        .join('\n')
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1)
      return (node.content ?? [])
        .map((item, i) => `${'  '.repeat(depth)}${start + i}. ${children(item, depth + 1)}`)
        .join('\n')
    }
    case 'taskList':
      return (node.content ?? [])
        .map(
          (item) =>
            `${'  '.repeat(depth)}- [${item.attrs?.checked ? 'x' : ' '}] ${children(item, depth + 1)}`,
        )
        .join('\n')
    case 'listItem':
    case 'taskItem':
      return children(node, depth)
    case 'table': {
      // GFM's table: the first row is always the header, whatever it was here.
      const rows = (node.content ?? []).map((row) => (row.content ?? []).map(cell))
      if (!rows.length) return ''
      const width = Math.max(...rows.map((row) => row.length))
      const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`
      return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n')
    }
    default:
      return inline(node)
  }
}

/**
 * A cell is one line in Markdown, so its blocks and line breaks travel as
 * `<br>`, which marked passes through and reads back as breaks; and a `|` in
 * the text would end the cell early.
 */
function cell(node: JSONContent): string {
  return (node.content ?? [])
    .map((child) => block(child))
    .join('\n')
    .replace(/\|/g, '\\|')
    .replace(/ *\n+/g, '<br>')
}

function children(node: JSONContent, depth: number): string {
  return (node.content ?? [])
    .map((child, index) => {
      const text = block(child, depth)
      // The first block shares the list marker's line. Anything after it needs
      // the continuation indent, or Markdown reads it as having left the list
      // and the item is torn into loose top-level blocks on the way back in.
      if (index === 0 || LISTS.has(child.type ?? '')) return text
      const pad = '  '.repeat(depth)
      return text
        .split('\n')
        .map((line) => (line ? pad + line : line))
        .join('\n')
    })
    .join('\n\n')
}

const WRAP: Record<string, (text: string, attrs?: Record<string, unknown>) => string> = {
  bold: (t) => `**${t}**`,
  italic: (t) => `*${t}*`,
  strike: (t) => `~~${t}~~`,
  // Markdown has neither. The HTML tags pass through marked on import and are
  // read back as the same marks; other Markdown apps show or drop them.
  underline: (t) => `<u>${t}</u>`,
  highlight: (t) => `<mark>${t}</mark>`,
  code: (t) => {
    const fence = '`'.repeat(backtickRun(t) + 1)
    // A span that begins or ends with a backtick needs a space of its own.
    const pad = t.startsWith('`') || t.endsWith('`') ? ' ' : ''
    return `${fence}${pad}${t}${pad}${fence}`
  },
  // Only what the editor allows: a stored file: or javascript: link is its words alone.
  link: (t, attrs) => {
    const href = String(attrs?.href ?? '')
    return href && isAllowedUri(href) ? `[${t}](${encodeHref(href)})` : t
  },
}

function inline(node: JSONContent, hardBreak = '  \n'): string {
  return (node.content ?? [])
    .map((child) => {
      if (child.type === 'hardBreak') return hardBreak
      // An inline atom holding its own text: there is no `text` property to
      // fall through to, so without a case here every footnote silently leaves
      // the document on export.
      if (child.type === 'footnote') return footnote(String(child.attrs?.text ?? ''))
      // Also an atom with no `text` to fall through to: without this branch an
      // image leaves the document on export, and a picture-only note exports as
      // an empty string.
      // A link to another note, as Bear and Obsidian write one, by what it is called now.
      if (child.type === 'noteLink') return `[[${escapeText(wikiTarget(child))}]]`
      // A formula, its LaTeX as it is: escaped, its backslashes would be doubled.
      if (child.type === 'mathInline') return `$${texOf(child)}$`
      if (child.type === 'image') {
        const alt = escapeText(String(child.attrs?.alt ?? ''))
        return `![${alt}](${encodeHref(String(child.attrs?.src ?? ''))})`
      }
      const marks = child.marks ?? []
      // Code spans are literal — a backslash inside one would be shown, not read.
      const literal = marks.some((mark) => mark.type === 'code')
      let text = literal ? (child.text ?? '') : escapeText(child.text ?? '')
      // Code first, so it's innermost: bold or a link wrapped inside the backticks would be read as the code's own characters.
      for (const mark of literal ? [...marks].sort((a, b) => Number(b.type === 'code') - Number(a.type === 'code')) : marks) {
        // Own keys only: a mark named `hasOwnProperty` found Object's, and threw.
        const wrap = Object.hasOwn(WRAP, mark.type ?? '') ? WRAP[mark.type!] : undefined
        if (wrap) text = wrap(text, mark.attrs)
      }
      return text
    })
    .join('')
}

/** A formula's LaTeX: the node's own text. */
const texOf = (node: JSONContent) => (node.content ?? []).map((child) => child.text ?? '').join('')

/**
 * Written as HTML rather than as a marker, because `Footnote.parseHTML` already
 * matches this exact shape and marked passes raw HTML through — so the note
 * comes back a footnote rather than as stray text.
 */
function footnote(text: string): string {
  // A line's end too: two in a row end the paragraph the footnote is in, and it came back as no footnote at all.
  const escaped = text.replace(/[&<>"\r\n]/g, (char) => `&#${char.charCodeAt(0)};`)
  return `<sup data-footnote data-text="${escaped}"></sup>`
}
