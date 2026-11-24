import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import { shownTitle } from '../lib/links'

/** A page's tables, out to a spreadsheet and in from one. Nib Plus (App's Commands). */

export const CSV_ACCEPT = '.csv,text/csv'
const MAX_BYTES = 4 * 1024 * 1024
/** Past this a phone is slow to type in the page: at 10,000, a keystroke on a Mac takes about 30 ms, and at 20,000 twice that. */
export const MAX_CELLS = 10_000

/** UTF-8, or else what Excel's plain "CSV" is. */
function decoded(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** What the first line is split by the most of. Excel writes semicolons where a comma is the decimal point, so a tie goes to them. */
function delimiterOf(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  let quoted = false
  for (const char of text) {
    if (char === '"') quoted = !quoted
    else if (!quoted && (char === '\n' || char === '\r')) break
    else if (!quoted && char in counts) counts[char]++
  }
  return ['\t', ';'].reduce((best, each) => (counts[each] > 0 && counts[each] >= counts[best] ? each : best), ',')
}

/** Rows of cells, as RFC 4180 has them: quotes around a cell, doubled inside one, and new lines within. Blank lines are left out, the second half of a \r\n among them. */
export function parseCsv(text: string): string[][] {
  const delimiter = delimiterOf(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const endRow = () => {
    row.push(cell)
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
    cell = ''
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char !== '"') cell += char
      else if (text[i + 1] === '"') cell += text[++i]
      else quoted = false
    } else if (char === '"' && cell === '') quoted = true
    else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') endRow()
    else cell += char
  }
  if (cell !== '' || row.length) endRow()
  return rows
}

// A cell a spreadsheet would run as a formula, from a table that may have come from anywhere, goes out as text.
const LOOKS_LIKE_A_FORMULA = /^[=+\-@\t\r]/
const SIGNED_NUMBER = /^[+-][\d.,\s%]*$/
const asText = (cell: string) => (LOOKS_LIKE_A_FORMULA.test(cell) && !SIGNED_NUMBER.test(cell) ? `'${cell}` : cell)
const fromText = (cell: string) => (cell[0] === "'" && LOOKS_LIKE_A_FORMULA.test(cell.slice(1)) ? cell.slice(1) : cell)

/** A file Excel reads as UTF-8, which it does only with the byte-order mark. */
export function toCsv(rows: string[][]): string {
  const written = (cell: string) => {
    const text = asText(cell)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return `\uFEFF${rows.map((row) => row.map(written).join(',')).join('\r\n')}\r\n`
}

/** Each cell's words, a line to a paragraph; marks, pictures and footnotes stay behind. A link to a note is what it's called on the page, which for one locked since is nothing of its title (lib/links). A merged cell's words go in its first square, so the columns still line up. */
export function rowsOf(table: ProseMirrorNode): string[][] {
  const map = TableMap.get(table)
  const seen = new Set<number>()
  const words = (cell: ProseMirrorNode) => cell.textBetween(0, cell.content.size, '\n', (leaf) => (leaf.type.name === 'hardBreak' ? '\n' : leaf.type.name === 'noteLink' ? shownTitle(String(leaf.attrs.id ?? ''), leaf.attrs.title) : ''))
  return Array.from({ length: map.height }, (_, row) =>
    Array.from({ length: map.width }, (_, column) => {
      const at = map.map[row * map.width + column]
      if (seen.has(at)) return ''
      seen.add(at)
      return words(table.nodeAt(at)!)
    }),
  )
}

/** The table the caret is in. */
export function tableAtCaret(editor: Editor): ProseMirrorNode | null {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === 'table') return $from.node(depth)
  return null
}

/** A file's rows as a table, its first row the header and every row as wide as the widest; or what stopped it, to say. */
export function tableFromCsv(bytes: Uint8Array): { table: JSONContent } | { problem: string } {
  if (bytes.length > MAX_BYTES) return { problem: 'That CSV is too long to put in a page.' }
  const rows = parseCsv(decoded(bytes))
  if (!rows.length) return { problem: 'There’s nothing in that CSV.' }
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0)
  if (rows.length * width > MAX_CELLS) return { problem: 'That CSV is too long to put in a page.' }
  const lines = (cell: string): JSONContent[] => fromText(cell).split(/\r\n?|\n/).map((line) => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) }))
  return {
    table: {
      type: 'table',
      content: rows.map((row, index) => ({
        type: 'tableRow',
        content: Array.from({ length: width }, (_, column) => ({ type: index === 0 ? 'tableHeader' : 'tableCell', content: lines(row[column] ?? '') })),
      })),
    },
  }
}

/** Puts it where the caret is, with a line after it if it's the last thing there: there is no other way to write below a table. */
export function insertTable(editor: Editor, table: JSONContent) {
  const { $from } = editor.state.selection
  const last = $from.index(0) === editor.state.doc.childCount - 1
  editor.chain().focus().insertContent(last ? [table, { type: 'paragraph' }] : table).run()
}

/** The system's file picker. Called straight from a tap or a click, or Safari won't show it. */
export function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.body.appendChild(document.createElement('input'))
    input.type = 'file'
    input.accept = accept
    input.className = 'sr-only'
    const done = () => {
      resolve(input.files?.[0])
      input.remove()
    }
    input.addEventListener('change', done, { once: true })
    input.addEventListener('cancel', done, { once: true })
    input.click()
  })
}
