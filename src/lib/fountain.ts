import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import { nodeText, titleOf } from './text'

/**
 * Screenplays (Nib Plus): a page written in Fountain, the plain-text
 * screenplay format (fountain.io). Its lines are kept as they're typed, a
 * paragraph each, and what each one is (a scene heading, a character, a line
 * of dialogue …) is read from the words, as Fountain's own apps do. So a
 * screenplay is a page like any other to sync, history, Compare and search,
 * and a Nib from before screenplays shows its lines as they are.
 *
 * Bold, italic and underline are the page's own marks: written out as
 * Fountain's **, * and _ (`toFountain`), and read back from them
 * (`fromFountain`). Everything else Fountain marks is in the words: a
 * leading . ! @ > ~ = or #, [[notes]], /* the boneyard *\/ and the title page.
 */

export const isScreenplay = (item: Pick<Item, 'kind' | 'screenplay'>) => item.kind === 'page' && item.screenplay === true

export const SCREENPLAY_PLUS = 'Writing screenplays, laid out as you type and exported in industry format, is part of Nib Plus.'

export type Element =
  | 'title'
  | 'scene'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'lyric'
  | 'transition'
  | 'centered'
  | 'section'
  | 'synopsis'
  | 'note'
  | 'boneyard'
  | 'pageBreak'
  | 'blank'

/**
 * A line as read: what it is, and its words as printed, its Fountain marks
 * taken off. `dual`: a character speaking at the same time as the one before
 * (a cue ending ^). `number`: a scene heading's own number (#12A#).
 */
export type Line = { element: Element; text: string; dual?: true; number?: string }

/** Empty. A line of two spaces or more isn't: it keeps a gap inside a speech. */
const blank = (line: string) => line.trim() === '' && line.length < 2

const SCENE = /^(?:int\.?\/ext|i\/e|int|ext|est)[. ]/i
/** A scene's number at the end of its heading, #12A#, after a space. Found from the #, not from the spaces before it: a pattern beginning with them is tried again from every space of a long run. */
const NUMBER = /#([\p{L}\p{N}.-]+)#$/u
/** In capitals: a capital and no small letter. */
const capitals = (text: string) => /\p{Lu}/u.test(text) && !/\p{Ll}/u.test(text)
/** A title page's keys, as Fountain's own parser knows them: any other word and colon at the top (FADE IN:) is the script. */
const TITLE_KEY = /^(title|credit|authors?|source|notes|draft date|date|contact|copyright|revision)\s*:\s*(.*)$/i

/** Without [[notes]] and /* the boneyard *\/ written inside a line. */
const unmarked = (text: string) => without(without(text, '[[', ']]'), '/*', '*/')
/** Each stretch of `text` from an `open` to the next `close`, as where it starts and ends. By hand: a pattern would look to the line's end from every `open` left unclosed. */
function stretches(text: string, open: string, close: string): [number, number][] {
  const found: [number, number][] = []
  for (let at = 0; ; ) {
    const from = text.indexOf(open, at)
    const to = from < 0 ? -1 : text.indexOf(close, from + open.length)
    if (to < 0) return found
    found.push([from, (at = to + close.length)])
  }
}
/** `text` without each of them. */
function without(text: string, open: string, close: string): string {
  let out = ''
  let at = 0
  for (const [from, to] of stretches(text, open, close)) {
    out += text.slice(at, from)
    at = to
  }
  return out + text.slice(at)
}

/** Whether a line begins as a scene heading does: INT, EXT, EST, INT./EXT, INT/EXT or I/E, with a dot or a space. */
export const isSceneHeading = (line: string) => SCENE.test(line.trim())

/** Whether a line could be a character's cue, given a line under it. */
export const isCue = (line: string) => cue(line) !== null

/** A character's cue, `null` for a line that isn't one: in capitals (its extension, (V.O.), may not be), or forced with @. */
function cue(line: string): { name: string; dual: boolean } | null {
  let text = line.trim()
  const forced = text.startsWith('@')
  if (forced) text = text.slice(1).trim()
  const dual = text.endsWith('^')
  if (dual) text = text.slice(0, -1).trimEnd()
  if (!text) return null
  // Its name without an extension after it, (V.O.): from the first bracket, if the line ends with one.
  const bracket = text.endsWith(')') ? text.indexOf('(') : -1
  if (!forced && (text.startsWith('!') || !capitals(bracket < 0 ? text : text.slice(0, bracket)))) return null
  return { name: text, dual }
}

/** A line read on its own: what can be anywhere, then action. */
function single(line: string): Line {
  const text = line.trim()
  if (/^={3,}$/.test(text)) return { element: 'pageBreak', text: '' }
  if (text.startsWith('#')) return { element: 'section', text: text.replace(/^#+/, '').trim() }
  if (text.startsWith('=')) return { element: 'synopsis', text: text.slice(1).trim() }
  if (/^\[\[[\s\S]*\]\]$/.test(text) && !text.slice(2, -2).includes(']]')) return { element: 'note', text: text.slice(2, -2).trim() }
  if (/^>.*<$/.test(text)) return { element: 'centered', text: unmarked(text.slice(1, -1)).trim() }
  if (text.startsWith('~')) return { element: 'lyric', text: unmarked(text.slice(1)).trim() }
  if (text.startsWith('!')) return { element: 'action', text: unmarked(line.replace(/^\s*!/, '')).trimEnd() }
  return { element: 'action', text: unmarked(line).trimEnd() }
}

/** A scene heading: begins INT, EXT, EST, INT./EXT, INT/EXT or I/E with a dot or a space, or is forced with one dot. */
function scene(line: string): Line | null {
  let text = line.trim()
  if (text.startsWith('.') && !text.startsWith('..')) text = text.slice(1)
  else if (!SCENE.test(text)) return null
  const found = NUMBER.exec(text)
  const numbered = found && found.index > 0 && /\s/.test(text[found.index - 1]) ? found : null
  text = unmarked(numbered ? text.slice(0, numbered.index) : text).trim()
  return { element: 'scene', text, ...(numbered && { number: numbered[1] }) }
}

/** A transition, on a line of its own: in capitals ending TO:, or forced with > (and not centred, >like this<). */
function transition(line: string): Line | null {
  const text = line.trim()
  if (text.startsWith('>') && !text.endsWith('<')) return { element: 'transition', text: unmarked(text.slice(1)).trim() }
  if (capitals(text) && text.endsWith('TO:')) return { element: 'transition', text: unmarked(text).trim() }
  return null
}

/**
 * What each of `lines` is, by Fountain's rules. A title page first, if the
 * first line is a key and its value (Title: …), up to the first empty line.
 * Then each run of lines between empty ones: a transition alone; a scene
 * heading, the lines after it read on their own; a character and what they
 * say (parentheticals and dialogue) when the first is a cue with a line under
 * it; otherwise each line on its own, which is mostly action.
 */
export function readLines(lines: string[]): Line[] {
  const out: Line[] = lines.map(() => ({ element: 'blank', text: '' }))
  let i = 0
  if (lines.length && TITLE_KEY.test(lines[0])) for (; i < lines.length && !blank(lines[i]); i++) out[i] = { element: 'title', text: lines[i] }
  // The boneyard first: what's in it is no part of the script, and parts it like an empty line.
  const boned = lines.map(() => false)
  let open = false
  for (let j = i; j < lines.length; j++) {
    const text = lines[j].trim()
    const opens: boolean = !open && text.startsWith('/*')
    if (!open && !opens) continue
    boned[j] = true
    out[j] = { element: 'boneyard', text: lines[j] }
    open = !(opens ? text.slice(2) : text).includes('*/')
  }
  while (i < lines.length) {
    if (blank(lines[i]) || boned[i]) {
      i++
      continue
    }
    let end = i
    while (end < lines.length && !blank(lines[end]) && !boned[end]) end++
    const head = lines[i]
    const alone = end - i === 1
    const done = alone && transition(head)
    const heading = !done && scene(head)
    const speaker = !done && !heading && end - i > 1 && cue(head)
    if (done) out[i] = done
    else if (heading) {
      out[i] = heading
      for (let j = i + 1; j < end; j++) out[j] = single(lines[j])
    } else if (speaker) {
      out[i] = { element: 'character', text: unmarked(speaker.name).trim(), ...(speaker.dual && { dual: true }) }
      for (let j = i + 1; j < end; j++) {
        const text = unmarked(lines[j]).trim()
        out[j] = text.startsWith('(') && text.endsWith(')') ? { element: 'parenthetical', text } : { element: 'dialogue', text }
      }
    } else for (let j = i; j < end; j++) out[j] = single(lines[j])
    i = end
  }
  return out
}

/** The title page's keys and values, in order: Title, Credit, Author, Draft date, Contact … A value goes on over lines indented under it. */
export function titlePage(lines: string[]): { key: string; value: string[] }[] {
  const fields: { key: string; value: string[] }[] = []
  for (const line of readLines(lines).flatMap((read, i) => (read.element === 'title' ? [lines[i]] : []))) {
    const keyed = /^\s/.test(line) ? null : TITLE_KEY.exec(line)
    if (keyed) fields.push({ key: keyed[1].trim().toLowerCase(), value: keyed[2].trim() ? [keyed[2].trim()] : [] })
    else if (fields.length && line.trim()) fields.at(-1)!.value.push(line.trim())
  }
  return fields
}

/** A page's lines as Fountain reads them: each paragraph one line, a line break inside one a space. */
export const linesOf = (body: JSONContent): string[] => (body.content ?? []).map((node) => nodeText(node).replace(/\n/g, ' '))

/** A line of the page without what's written between `open` and `close`, its marks kept; as it was if it has anything but text in it. */
function cut(paragraph: JSONContent, open: string, close: string): JSONContent {
  const pieces = paragraph.content ?? []
  if (pieces.some((piece) => piece.type !== 'text')) return paragraph
  const gone = stretches(pieces.map((piece) => piece.text ?? '').join(''), open, close)
  if (gone.length === 0) return paragraph
  let at = 0
  const content = pieces.flatMap((piece) => {
    const from = at
    const text = [...(piece.text ?? '')].filter((_, i) => !gone.some(([start, end]) => from + i >= start && from + i < end))
    at += piece.text?.length ?? 0
    return text.length ? [{ ...piece, text: text.join('') }] : []
  })
  const { content: _content, ...rest } = paragraph
  return content.length ? { ...rest, content } : rest
}

/**
 * A screenplay as it's shared (share/index `snapshot`): without what Fountain
 * keeps for the writer alone, which the reader's page doesn't show but which
 * would travel in the copy all the same. Notes ([[…]]), sections (#) and
 * synopses (=) on lines of their own go, and notes and cut text inside a
 * line; a line left with nothing goes too. The boneyard goes, an empty line
 * in its place, as it parts what's either side of it. The title page stays.
 */
export function withoutWritersLines(body: JSONContent): JSONContent {
  const read = readLines(linesOf(body))
  const content: JSONContent[] = []
  ;(body.content ?? []).forEach((node, i) => {
    const element = read[i]?.element
    if (element === 'title') return void content.push(node)
    if (element === 'note' || element === 'section' || element === 'synopsis') return
    if (element === 'boneyard') return void (read[i - 1]?.element === 'boneyard' || content.push({ type: 'paragraph' }))
    const kept = node.type === 'paragraph' ? cut(cut(node, '[[', ']]'), '/*', '*/') : node
    // Emptied by it: no line. One that was empty already is the script's own.
    if (kept === node || nodeText(kept).trim()) content.push(kept)
  })
  return { ...body, content }
}

type Mark = 'bold' | 'italic' | 'underline'
const MARKS: Mark[] = ['underline', 'bold', 'italic']
const OPEN: Record<Mark, string> = { underline: '_', bold: '**', italic: '*' }

/**
 * A line of the page as Fountain: its bold, italic and underline as **, * and
 * _, any of those characters in its words escaped. A mark is opened where it
 * begins and closed where it ends, whatever the page's text is cut into
 * between: opened and closed again around each piece, a bold line with one
 * italic word came out as **He said *****now***** again**, which nothing reads.
 */
function written(paragraph: JSONContent): string {
  // Those open, the first opened first: closed last opened first.
  const open: Mark[] = []
  let line = ''
  const shut = (keep: number) => {
    while (open.length > keep) line += OPEN[open.pop()!]
  }
  for (const node of paragraph.content ?? []) {
    const on = node.type === 'text' ? MARKS.filter((mark) => node.marks?.some((given) => given.type === mark)) : []
    // The first one open that ends here, and all opened inside it.
    let keep = 0
    while (keep < open.length && on.includes(open[keep])) keep++
    shut(keep)
    for (const mark of on) {
      if (open.includes(mark)) continue
      line += OPEN[mark]
      open.push(mark)
    }
    line += node.type === 'hardBreak' ? '\n' : node.type === 'text' ? (node.text ?? '').replace(/([\\*_])/g, '\\$1') : nodeText(node)
  }
  shut(0)
  return line
}

/** A screenplay page as a Fountain file. */
export function toFountain(body: JSONContent): string {
  return (body.content ?? []).map((node) => (node.type === 'paragraph' ? written(node) : nodeText(node))).join('\n') + '\n'
}

/**
 * A line of Fountain as the page's text, its **, * and _ made marks, a
 * backslash's character kept as it is. Read once, left to right: each mark
 * turns its style on where it's off and off where it's on, an underscore
 * underline, one asterisk italic, two bold, three both. Four close an italic
 * inside bold, close the bold and open the italic again, as `written` puts a
 * bold line that goes on in italics alone, so bold goes off; five, the same
 * the other way round. Any other run of asterisks is itself. A style still on
 * at the line's end was never one: its mark is its characters.
 */
function emphasised(line: string): JSONContent[] {
  const out: { text: string; marks: Mark[] }[] = []
  // Each style that's on, by the piece it came on before.
  const on = new Map<Mark, number>()
  let text = ''
  const flush = () => {
    if (text) out.push({ text, marks: MARKS.filter((mark) => on.has(mark)) })
    text = ''
  }
  const turn = (mark: Mark) => {
    if (!on.delete(mark)) on.set(mark, out.length)
  }
  for (let i = 0; i < line.length; ) {
    const char = line[i]
    if (char === '\\' && i + 1 < line.length) {
      text += line[i + 1]
      i += 2
      continue
    }
    let run = char === '*' || char === '_' ? 1 : 0
    if (char === '*') while (line[i + run] === '*') run++
    const both = on.has('bold') && on.has('italic')
    const turned: Mark[] | null = char === '_' ? ['underline'] : run === 1 || (run === 5 && both) ? ['italic'] : run === 2 || (run === 4 && both) ? ['bold'] : run === 3 ? ['bold', 'italic'] : null
    if (!turned) {
      text += run ? line.slice(i, i + run) : char
      i += run || 1
      continue
    }
    flush()
    turned.forEach(turn)
    i += run
  }
  flush()
  // Never closed, the last opened first, so each goes back where it was.
  for (const [mark, at] of [...on].sort(([, a], [, b]) => b - a)) {
    for (const piece of out.slice(at)) piece.marks = piece.marks.filter((given) => given !== mark)
    // Its characters, styled as what follows them: they're inside whatever else is on there.
    out.splice(at, 0, { text: OPEN[mark], marks: [...(out[at]?.marks ?? [])] })
  }
  const content: JSONContent[] = []
  for (const piece of out) {
    const marks = piece.marks.map((type) => ({ type }))
    const before = content.at(-1)
    if (before && JSON.stringify(before.marks ?? []) === JSON.stringify(marks)) before.text += piece.text
    else content.push({ type: 'text', text: piece.text, ...(marks.length && { marks }) })
  }
  return content
}

/** A Fountain file as a screenplay page's body: a paragraph a line, emphasis made marks. */
export function fromFountain(file: string): JSONContent {
  const lines = file.replace(/^﻿/, '').split(/\r\n|\r|\n/)
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return {
    type: 'doc',
    content: lines.map((line) => {
      const content = emphasised(line)
      return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
    }),
  }
}

const PRINTED: Element[] = ['scene', 'action', 'character', 'dialogue', 'transition', 'centered', 'lyric']
const SHOUTED: Element[] = ['scene', 'character', 'transition']

/** A screenplay's name and the line its card shows under it, worked out once a body: reading the whole script is too much for every card drawn. */
const known = new WeakMap<JSONContent, { title: string; preview: string }>()

function headOf(body: JSONContent) {
  let head = known.get(body)
  if (!head) {
    const lines = linesOf(body)
    // As printed: a scene heading, a name and a transition in capitals.
    const printed = readLines(lines).flatMap((line) => (PRINTED.includes(line.element) && line.text.trim() ? [SHOUTED.includes(line.element) ? line.text.trim().toUpperCase() : line.text.trim()] : []))
    const given = titlePage(lines).find((field) => field.key === 'title')?.value.join(' ')
    head = given ? { title: given, preview: printed[0] ?? '' } : { title: printed[0] ?? 'Untitled', preview: printed[1] ?? '' }
    known.set(body, head)
  }
  return head
}

/** What a screenplay is called: its title page's title, or else its first printed line, as printed. */
export const scriptTitle = (body: JSONContent): string => headOf(body).title

/** What a screenplay's card shows under its name: the first printed line after it. */
export const scriptPreview = (body: JSONContent): string => headOf(body).preview

/** What a document is called wherever Nib names it: a screenplay by its title (`scriptTitle`), anything else by its first line. */
export const nameOf = (item: Pick<Item, 'kind' | 'screenplay' | 'body'>): string => (isScreenplay(item) ? scriptTitle(item.body) : titleOf(item.body))

/** What a line can be made from the keyboard bar, or with Tab. */
export type Settable = 'scene' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition'
export const SETTABLE: Settable[] = ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition']
export const ELEMENT_NAMES: Record<Settable, string> = { scene: 'Scene heading', action: 'Action', character: 'Character', parenthetical: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition' }

/** Tab's order: from action to a character, a scene heading, a transition and back; in a speech, between dialogue and a parenthetical. */
export function nextElement(current: Element, step: 1 | -1 = 1): Settable {
  const round: Settable[] = ['action', 'character', 'scene', 'transition']
  if (current === 'dialogue') return 'parenthetical'
  if (current === 'parenthetical') return 'dialogue'
  const at = round.indexOf(current as Settable)
  return round[(Math.max(at, 0) + step + round.length) % round.length]
}

/** A line's words without the mark that forces its element, and a parenthetical's brackets. */
function bare(line: string): string {
  let text = line.trim()
  if (/^>.*<$/.test(text)) return text.slice(1, -1).trim()
  if (/^[!@>~]/.test(text) || (text.startsWith('.') && !text.startsWith('..'))) text = text.slice(1).trimStart()
  if (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1).trim()
  return text
}

const SPEECH: Element[] = ['character', 'parenthetical', 'dialogue']

/**
 * `lines[index]` made `target`: its words with what Fountain reads that
 * element by, where the caret goes in them, and whether an empty line has to
 * go in before it (a scene heading, a character and a transition stand after
 * one; action after a speech) or after it (a transition stands alone).
 */
export function asElement(lines: string[], index: number, target: Settable): { text: string; caret: number; before: boolean; after: boolean } {
  const words = bare(lines[index])
  const read = readLines(lines)
  const joined = index > 0 && !blank(lines[index - 1])
  let text = words
  let before = false
  let after = false
  if (target === 'scene') {
    text = !words ? 'INT. ' : isSceneHeading(words) ? words : `.${words}`
    before = joined
  } else if (target === 'character') {
    text = !words ? '@' : words.replace(/^[^(]*/, (name) => name.toUpperCase())
    before = joined
  } else if (target === 'transition') {
    text = words.toUpperCase().endsWith('TO:') ? words.toUpperCase() : `>${words}`
    before = joined
    after = index + 1 < lines.length && !blank(lines[index + 1])
  } else if (target === 'parenthetical') text = `(${words})`
  else if (target === 'action') {
    before = joined && SPEECH.includes(read[index - 1].element)
    const tried = [...lines]
    tried[index] = text
    if (before) tried.splice(index, 0, '')
    if (text && readLines(tried)[before ? index + 1 : index].element !== 'action') text = `!${words}`
  }
  return { text, caret: target === 'parenthetical' ? text.length - 1 : text.length, before, after }
}

/** Each element's width on the printed page, in characters of Courier 12: what it wraps at. Those not printed have none. */
const WIDTH: Partial<Record<Element, number>> = { scene: 60, action: 60, transition: 60, centered: 60, lyric: 60, character: 38, dialogue: 35, parenthetical: 25 }
const LINES_A_PAGE = 55

/** About how many pages the script prints to, at 55 lines a page, so about how many minutes it runs: each element's lines at its width, and the empty lines between. */
export function pageCount(lines: Line[]): number {
  let full = 0
  let on = 0
  let printed = false
  for (const line of lines) {
    if (line.element === 'pageBreak') {
      if (on > 0) full += 1
      on = 0
      continue
    }
    const width = WIDTH[line.element]
    if (line.element === 'blank') on += 1
    else if (width) {
      on += Math.max(1, Math.ceil(line.text.length / width))
      printed = true
    }
    if (on >= LINES_A_PAGE) {
      full += 1
      on -= LINES_A_PAGE
    }
  }
  return printed ? full + (on > 0 ? 1 : 0) : 0
}
