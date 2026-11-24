import type { JSONContent } from '@tiptap/react'
import { linesOf, readLines, titlePage, type Element, type Line } from './fountain'
import { nodeText } from './text'

/**
 * A screenplay's pages as they print (Nib Plus, lib/fountain), laid out here
 * on the industry's grid rather than by a web view, since Courier 12 is a
 * grid: ten characters an inch, six lines an inch. US Letter, an inch and a
 * half of margin on the left and an inch elsewhere, 55 lines a page.
 *
 * Each element from its own column, wrapped at its own width: action and
 * scene headings from 1.5 inches, 60 characters; dialogue from 2.5, 35; a
 * parenthetical from 3.1, 25; a character from 3.7; transitions to the right
 * margin; centred lines centred. Scene headings, characters and transitions
 * in capitals. A scene heading never last on a page; a character never
 * without a line of what they say; a speech that runs over a page goes on
 * after (MORE) under the character's name and (CONT'D). The title page, from
 * the script's title lines, comes first and isn't numbered; nor is the first
 * page of the script, and the others are numbered at the top right.
 *
 * What isn't printed (notes, sections, synopses, the boneyard) isn't here.
 * Two characters speaking at once print one after the other.
 */

export type Run = { text: string; bold?: true; italic?: true; underline?: true }
/** A line on a page: where it starts, in points from the page's top left, and its words. */
export type Placed = { x: number; y: number; runs: Run[] }
export type ScriptPage = Placed[]

export const PAGE = { width: 612, height: 792 }
const CHAR = 7.2
const ROW = 12
const TOP = 72
export const LINES_A_PAGE = 55

/** Columns, in characters from the page's left edge. */
const COLUMN = { action: 15, dialogue: 25, parenthetical: 31, character: 37, right: 75 }
const WIDTH = { action: 60, dialogue: 35, parenthetical: 25, character: 38 }

/** A line on the grid: its column, its words, and anything else on the same line (a scene's number, either side of it). */
type Row = { column: number; runs: Run[]; also?: { column: number; runs: Run[] }[] }
/** What's printed, in the order it's printed: rows that go together, and what stays with what. */
type Block =
  | { kind: 'blank' }
  | { kind: 'pageBreak' }
  | { kind: 'rows'; rows: Row[]; heading?: true }
  | { kind: 'speech'; name: string; cue: Row[]; lines: { row: Row | null; parenthetical: boolean }[] }

const length = (runs: Run[]) => runs.reduce((sum, run) => sum + run.text.length, 0)

/** `runs` from character `from` to `to`. */
function slice(runs: Run[], from: number, to: number): Run[] {
  const out: Run[] = []
  let at = 0
  for (const run of runs) {
    const start = Math.max(from, at)
    const end = Math.min(to, at + run.text.length)
    if (start < end) out.push({ ...run, text: run.text.slice(start - at, end - at) })
    at += run.text.length
  }
  return out
}

/** `text` broken into lines of at most `width`, at spaces where it can be: each line's start and end. */
export function wrap(text: string, width: number): [number, number][] {
  if (!text) return [[0, 0]]
  const lines: [number, number][] = []
  let start = 0
  while (start < text.length) {
    if (text.length - start <= width) {
      lines.push([start, text.length])
      break
    }
    let cut = text.lastIndexOf(' ', start + width)
    if (cut <= start) cut = start + width
    lines.push([start, cut])
    start = cut
    while (text[start] === ' ') start++
  }
  return lines
}

/** A paragraph's words with their bold, italic and underline, as one line: `linesOf`'s, marked. */
export function runsOf(paragraph: JSONContent | undefined): Run[] {
  return (paragraph?.content ?? []).map((node) => {
    if (node.type !== 'text') return { text: node.type === 'hardBreak' ? ' ' : nodeText(node) }
    const has = (type: string) => node.marks?.some((mark) => mark.type === type)
    return { text: node.text ?? '', ...(has('bold') && { bold: true }), ...(has('italic') && { italic: true }), ...(has('underline') && { underline: true }) }
  })
}

/** What a line prints: its words, in capitals if its element is, marked as they are in the line where they can be found there. */
export function printed(line: Line, raw: string, runs: Run[], capitals: boolean): Run[] {
  const text = line.text.replace(/\t/g, '    ')
  const at = raw.replace(/\t/g, '    ').indexOf(text)
  const marked = at >= 0 && !raw.includes('\t') ? slice(runs, at, at + text.length) : [{ text }]
  return capitals ? marked.map((run) => ({ ...run, text: run.text.toUpperCase() })) : marked
}

/** A line's words, wrapped at `width` and set from `column`, or each placed by `place` from its own length. */
function rows(runs: Run[], width: number, column: number | ((length: number) => number), italic = false): Row[] {
  const text = runs.map((run) => run.text).join('')
  return wrap(text, width).map(([from, to]) => {
    const line = slice(runs, from, to).map((run) => (italic ? { ...run, italic: true as const } : run))
    return { column: typeof column === 'number' ? column : column(to - from), runs: line }
  })
}

function blocks(body: JSONContent): Block[] {
  const raw = linesOf(body)
  const read = readLines(raw)
  const out: Block[] = []
  for (let i = 0; i < read.length; i++) {
    const line = read[i]
    const runs = () => runsOf(body.content?.[i])
    if (line.element === 'blank') out.push({ kind: 'blank' })
    else if (line.element === 'pageBreak') out.push({ kind: 'pageBreak' })
    else if (line.element === 'scene') {
      const heading = rows(printed(line, raw[i], runs(), true), WIDTH.action, COLUMN.action)
      // Its number, if it's given one, either side of it.
      if (line.number) heading[0].also = [{ column: COLUMN.action - line.number.length - 3, runs: [{ text: line.number }] }, { column: COLUMN.right + 1, runs: [{ text: line.number }] }]
      out.push({ kind: 'rows', rows: heading, heading: true })
    } else if (line.element === 'action') out.push({ kind: 'rows', rows: rows(printed(line, raw[i], runs(), false), WIDTH.action, COLUMN.action) })
    else if (line.element === 'transition') out.push({ kind: 'rows', rows: rows(printed(line, raw[i], runs(), true), WIDTH.action, (length) => COLUMN.right - length) })
    else if (line.element === 'centered') out.push({ kind: 'rows', rows: rows(printed(line, raw[i], runs(), false), WIDTH.action, (length) => 45 - Math.floor(length / 2)) })
    else if (line.element === 'lyric') out.push({ kind: 'rows', rows: rows(printed(line, raw[i], runs(), false), WIDTH.dialogue, COLUMN.dialogue, true) })
    else if (line.element === 'character') {
      const speech: Block = { kind: 'speech', name: line.text.toUpperCase().trimEnd().replace(/\((?:cont['’]d|continued)\)$/i, '').trimEnd(), cue: rows(printed(line, raw[i], runs(), true), WIDTH.character, COLUMN.character), lines: [] }
      while (i + 1 < read.length && (read[i + 1].element === 'dialogue' || read[i + 1].element === 'parenthetical')) {
        const next = read[++i]
        const parenthetical = next.element === 'parenthetical'
        const set = parenthetical ? rows(printed(next, raw[i], runsOf(body.content?.[i]), false), WIDTH.parenthetical, COLUMN.parenthetical) : rows(printed(next, raw[i], runsOf(body.content?.[i]), false), WIDTH.dialogue, COLUMN.dialogue)
        // A gap kept in a speech (two spaces) is a line with nothing on it.
        for (const row of set) speech.lines.push({ row: length(row.runs) ? row : null, parenthetical })
      }
      out.push(speech)
    }
  }
  return out
}

/** The title page, from the script's title lines: the title, credit, authors and source in the middle, contact and notes bottom left, the date bottom right. */
function titleRows(body: JSONContent): ScriptPage | null {
  const fields = titlePage(linesOf(body))
  if (!fields.length) return null
  const page: ScriptPage = []
  const value = (...keys: string[]) => fields.filter((field) => keys.includes(field.key)).flatMap((field) => field.value)
  const centred = (text: string, row: number) => page.push({ x: (45 - Math.floor(text.length / 2)) * CHAR, y: TOP + row * ROW, runs: [{ text }] })
  // The title about a third of the way down, then who wrote it.
  let row = 18
  for (const [keys, gap] of [[['title'], 0], [['credit'], 3], [['author', 'authors'], 1], [['source'], 2]] as const) {
    const lines = value(...keys)
    if (!lines.length) continue
    if (page.length) row += gap
    for (const line of lines) centred(line, row++)
  }
  const foot = (lines: string[], column: (text: string) => number) => lines.forEach((text, index) => page.push({ x: column(text) * CHAR, y: TOP + (LINES_A_PAGE - lines.length + index) * ROW, runs: [{ text }] }))
  foot([...value('contact'), ...value('notes'), ...value('copyright')], () => COLUMN.action)
  foot([...value('draft date', 'date'), ...value('revision')], (text) => COLUMN.right - text.length)
  return page
}

/**
 * The title page a line at a time, as it's placed on the PDF's (`titleRows`):
 * each line's words and how it's aligned, null for an empty one. None without
 * title lines. For files that set out a page as lines (Final Draft, Word).
 */
export function titleLines(body: JSONContent): ({ alignment: 'left' | 'center' | 'right'; runs: Run[] } | null)[] | null {
  const page = titleRows(body)
  if (!page) return null
  const rows = new Map<number, Placed[]>()
  for (const placed of page) {
    const row = Math.round((placed.y - TOP) / ROW)
    rows.set(row, [...(rows.get(row) ?? []), placed])
  }
  const out: ({ alignment: 'left' | 'center' | 'right'; runs: Run[] } | null)[] = []
  for (let row = 0; row <= Math.max(...rows.keys()); row++) {
    const here = rows.get(row)
    if (!here) out.push(null)
    for (const placed of here ?? []) {
      const column = Math.round(placed.x / CHAR)
      out.push({ alignment: column === COLUMN.action ? 'left' : column + length(placed.runs) === COLUMN.right ? 'right' : 'center', runs: placed.runs })
    }
  }
  return out
}

/** A printed element as a paragraph, for files that lay a script out themselves: two characters speaking at once are a pair. */
export type ScriptParagraph = { element: Element; runs: Run[]; number?: string; pageBreak?: true } | { dual: ScriptParagraph[] }

const SET: Element[] = ['scene', 'action', 'centered', 'character', 'parenthetical', 'dialogue', 'lyric', 'transition']
const CAPITALS: Element[] = ['scene', 'character', 'transition']
/** Lines of these with no empty line between are one paragraph, a line break (a run of "\n") between them. */
const RUN_ON: Element[] = ['action', 'centered', 'dialogue', 'lyric']

/**
 * The screenplay `body`'s printed elements, a paragraph each, as printed (in
 * capitals where they print so, lyrics in italic, without Fountain's marks):
 * what Final Draft, Word and HTML are written from. What isn't printed
 * (notes, sections, synopses, the boneyard, the title page) isn't here; a
 * page break is on the paragraph after it.
 */
export function scriptParagraphs(body: JSONContent): ScriptParagraph[] {
  const raw = linesOf(body)
  const read = readLines(raw)
  const content: ScriptParagraph[] = []
  // Where a speech's paragraphs go: the script, or the two speaking at once.
  let into = content
  let speech = -1
  let pageBreak = false
  read.forEach((line, i) => {
    if (line.element === 'pageBreak') pageBreak = content.length > 0
    if (!SET.includes(line.element)) return
    if (line.element === 'character') {
      if (line.dual && speech >= 0 && into === content) {
        const pair: ScriptParagraph = { dual: content.splice(speech) }
        content.push(pair)
        into = pair.dual
      } else if (!line.dual || into === content) {
        into = content
        speech = content.length
      }
    } else if (line.element !== 'parenthetical' && line.element !== 'dialogue') {
      into = content
      speech = -1
    }
    const marked = printed(line, raw[i], runsOf(body.content?.[i]), CAPITALS.includes(line.element))
    const runs = line.element === 'lyric' ? marked.map((run) => ({ ...run, italic: true as const })) : marked
    const last = into.at(-1)
    if (RUN_ON.includes(line.element) && read[i - 1]?.element === line.element && last && 'runs' in last && !pageBreak) {
      last.runs.push({ text: '\n' }, ...runs)
      return
    }
    into.push({ element: line.element, runs, ...(line.number && { number: line.number }), ...(pageBreak && { pageBreak: true as const }) })
    pageBreak = false
  })
  return content
}

/** The screenplay `body` as it prints, page by page: its title page first, if it has one. */
export function scriptPages(body: JSONContent): ScriptPage[] {
  const pages: ScriptPage[] = []
  let page: ScriptPage = []
  let used = 0
  const turn = () => {
    pages.push(page)
    page = []
    used = 0
  }
  const put = (row: Row | null) => {
    for (const one of row ? [row, ...(row.also ?? [])] : []) page.push({ x: one.column * CHAR, y: TOP + used * ROW, runs: one.runs })
    used += 1
  }
  const room = () => LINES_A_PAGE - used
  for (const block of blocks(body)) {
    if (block.kind === 'pageBreak') {
      if (used) turn()
    } else if (block.kind === 'blank') {
      if (used && room() > 0) used += 1
    } else if (block.kind === 'rows') {
      const height = block.rows.length
      // A heading with no room under it for the empty line and two lines of what follows goes over.
      if (height > room() || (block.heading && height + 3 > room())) {
        // Action that's longer than what's left goes on over the page, two lines at least either side.
        if (!block.heading && room() >= 2 && height - room() >= 2) {
          const first = room()
          block.rows.slice(0, first).forEach(put)
          turn()
          block.rows.slice(first).forEach((row) => {
            if (!room()) turn()
            put(row)
          })
          continue
        }
        if (used) turn()
      }
      for (const row of block.rows) {
        if (!room()) turn()
        put(row)
      }
    } else {
      let cue = block.cue
      let lines = block.lines
      for (;;) {
        if (cue.length + lines.length <= room()) {
          cue.forEach(put)
          lines.forEach((line) => put(line.row))
          break
        }
        // As much as fits with (MORE) under it, two lines of it at least, not ending on a parenthetical.
        let fit = room() - cue.length - 1
        while (fit > 0 && lines[fit - 1].parenthetical) fit--
        if (fit >= 2 && lines.length - fit >= 1) {
          cue.forEach(put)
          lines.slice(0, fit).forEach((line) => put(line.row))
          put({ column: COLUMN.character, runs: [{ text: '(MORE)' }] })
          lines = lines.slice(fit)
          cue = [{ column: COLUMN.character, runs: [{ text: `${block.name} (CONT'D)` }] }]
        } else if (!used) {
          // Longer than a page and nowhere to break: as it comes.
          cue.forEach((row) => (room() ? put(row) : (turn(), put(row))))
          lines.forEach((line) => (room() ? put(line.row) : (turn(), put(line.row))))
          break
        }
        turn()
      }
    }
  }
  if (used || page.length) pages.push(page)
  // The first page of the script has no number; the rest have theirs at the top right.
  pages.forEach((one, index) => {
    if (index === 0) return
    const number = `${index + 1}.`
    one.push({ x: (COLUMN.right - number.length) * CHAR, y: 36, runs: [{ text: number }] })
  })
  const title = titleRows(body)
  return title ? [title, ...pages] : pages
}
