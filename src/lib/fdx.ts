import type { JSONContent } from '@tiptap/react'
import { readLines, type Element as Part } from './fountain'
import { scriptParagraphs, titleLines, type Run, type ScriptParagraph } from './scriptPages'

/**
 * Final Draft's .fdx (Nib Plus): a screenplay written out as Final Draft's
 * XML (`toFdx`), and one read back in as a screenplay page (`fromFdx`).
 *
 * The script as the open-source tools that write it do (screenplain,
 * Trelby): FinalDraft › Content › a Paragraph each, its Type "Scene Heading",
 * "Action", "Character", "Parenthetical", "Dialogue" or "Transition", its
 * words in Text, bold, italic and underline in Text's Style ("Bold+Italic"),
 * a line break inside one a newline; centred action Alignment="Center"; two
 * characters speaking at once inside a DualDialogue. Read as Trelby reads it:
 * a Type it doesn't know (General, Shot, New Act …) is action.
 *
 * Neither writes a scene's number, a page break or a title page. Those are
 * Final Draft's own as it saves them: Number on a scene heading,
 * StartsNewPage="Yes", and TitlePage › Content › Paragraphs aligned left,
 * centre or right. No Final Draft file has been seen to check them by.
 *
 * Read in, each paragraph becomes Fountain's lines (lib/fountain), with the
 * mark that forces its element only where Fountain would read it as
 * something else: a scene heading that doesn't begin INT or EXT takes a dot,
 * a name not in capitals an @.
 */

const TYPE: Partial<Record<Part, string>> = {
  scene: 'Scene Heading',
  action: 'Action',
  centered: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  // Lyrics aren't one of the elements the open-source tools write: in italic, as Nib prints them, as action Final Draft will show.
  lyric: 'Action',
  transition: 'Transition',
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const styleOf = (run: Run) => [run.bold && 'Bold', run.italic && 'Italic', run.underline && 'Underline'].filter(Boolean).join('+')
const texts = (runs: Run[]) => runs.map((run) => `<Text${styleOf(run) ? ` Style="${styleOf(run)}"` : ''}>${escape(run.text)}</Text>`).join('')

const written = (paragraph: ScriptParagraph, indent: string): string => {
  if ('dual' in paragraph) return `${indent}<Paragraph>\n${indent}  <DualDialogue>\n${paragraph.dual.map((one) => written(one, `${indent}    `)).join('')}${indent}  </DualDialogue>\n${indent}</Paragraph>\n`
  const attributes = [...(paragraph.element === 'centered' ? ['Alignment="Center"'] : []), ...(paragraph.number ? [`Number="${escape(paragraph.number)}"`] : []), ...(paragraph.pageBreak ? ['StartsNewPage="Yes"'] : [])]
  return `${indent}<Paragraph Type="${TYPE[paragraph.element]}"${attributes.map((attribute) => ` ${attribute}`).join('')}>${texts(paragraph.runs)}</Paragraph>\n`
}

const ALIGNED = { left: 'Left', center: 'Center', right: 'Right' }

/** The title page (lib/scriptPages titleLines) a paragraph a line, empty ones between, each line aligned as it's placed. */
function titleContent(body: JSONContent): string {
  const lines = titleLines(body)
  if (!lines) return ''
  const out = lines.map((line) => `      <Paragraph Alignment="${line ? ALIGNED[line.alignment] : 'Left'}">${(line && texts(line.runs)) || '<Text></Text>'}</Paragraph>\n`)
  return `  <TitlePage>\n    <Content>\n${out.join('')}    </Content>\n  </TitlePage>\n`
}

/** A screenplay page as a Final Draft file. What isn't printed (notes, sections, synopses, the boneyard) isn't in it. */
export function toFdx(body: JSONContent): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n',
    '<FinalDraft DocumentType="Script" Template="No" Version="1">\n',
    '  <Content>\n',
    ...scriptParagraphs(body).map((paragraph) => written(paragraph, '    ')),
    '  </Content>\n',
    titleContent(body),
    '</FinalDraft>\n',
  ].join('')
}

/** What a Final Draft paragraph's Type is; any other is action. */
const PART: Record<string, Part> = { 'Scene Heading': 'scene', Action: 'action', Character: 'character', Parenthetical: 'parenthetical', Dialogue: 'dialogue', Transition: 'transition', Lyrics: 'lyric' }
/** What forces each element in Fountain, before its words and after them. */
const FORCE: Partial<Record<Part, [string, string]>> = { scene: ['.', ''], action: ['!', ''], character: ['@', ''], transition: ['> ', ''], centered: ['> ', ' <'], lyric: ['~', ''] }

type Out = { want: Part; content: JSONContent[]; forced?: true }

const childrenOf = (parent: Element, name: string) => [...parent.children].filter((child) => child.tagName === name)
const text = (content: JSONContent[]) => content.map((node) => node.text ?? '').join('')
const plain = (words: string): JSONContent => ({ type: 'text', text: words })

/** A paragraph's words, a line each where it breaks: Text's bold, italic and underline made marks, its all-capitals made capitals. Empty lines at either end left off. */
function linesIn(paragraph: Element): JSONContent[][] {
  const lines: JSONContent[][] = [[]]
  for (const node of childrenOf(paragraph, 'Text')) {
    const styles = (node.getAttribute('Style') ?? '').split('+')
    const marks = (['Bold', 'Italic', 'Underline'] as const).filter((style) => styles.includes(style)).map((style) => ({ type: style.toLowerCase() }))
    const words = styles.includes('AllCaps') ? (node.textContent ?? '').toUpperCase() : (node.textContent ?? '')
    words.split(/\r\n|\r|\n/).forEach((part, index) => {
      if (index) lines.push([])
      if (part) lines.at(-1)!.push({ type: 'text', text: part, ...(marks.length && { marks }) })
    })
  }
  while (lines.length && !text(lines[0]).trim()) lines.shift()
  while (lines.length && !text(lines.at(-1)!).trim()) lines.pop()
  return lines
}

/**
 * The title page's lines as Fountain's keys: Final Draft's are only lines,
 * so what each is is told from where it's aligned. Centred, the title, until
 * a line ending "by" (Credit), then the author; right, the draft date; left,
 * the contact.
 */
function titleFields(root: Element): [string, string[]][] {
  const fields = new Map<string, string[]>()
  const page = childrenOf(root, 'TitlePage')[0]
  const content = page && childrenOf(page, 'Content')[0]
  let centred = 'Title'
  for (const paragraph of content ? childrenOf(content, 'Paragraph') : []) {
    const alignment = paragraph.getAttribute('Alignment')
    for (const line of linesIn(paragraph).map((words) => text(words).trim()).filter(Boolean)) {
      let key = alignment === 'Right' ? 'Draft date' : alignment === 'Center' ? centred : 'Contact'
      if (alignment === 'Center' && /(?:^|\s)by$/i.test(line)) [key, centred] = ['Credit', 'Author']
      fields.set(key, [...(fields.get(key) ?? []), line])
    }
  }
  return [...fields]
}

/** A Final Draft file as a screenplay page's body; null for a file that isn't one. */
export function fromFdx(xml: string): JSONContent | null {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  const root = parsed.documentElement
  const script = root?.tagName === 'FinalDraft' && !parsed.getElementsByTagName('parsererror').length ? childrenOf(root, 'Content')[0] : undefined
  if (!script) return null
  const out: Out[] = []
  const line = (want: Part, content: JSONContent[]) => out.push({ want, content })
  const gap = () => {
    if (out.length && out.at(-1)!.want !== 'blank') line('blank', [])
  }
  for (const [key, values] of titleFields(root)) {
    if (values.length === 1) line('title', [plain(`${key}: ${values[0]}`)])
    else {
      line('title', [plain(`${key}:`)])
      for (const value of values) line('title', [plain(`    ${value}`)])
    }
  }
  let speaking = false
  const take = (paragraph: Element, dual: boolean) => {
    const pair = childrenOf(paragraph, 'DualDialogue')[0]
    if (pair) {
      let cues = 0
      for (const inner of childrenOf(pair, 'Paragraph')) take(inner, inner.getAttribute('Type') === 'Character' && ++cues > 1)
      return
    }
    if (paragraph.getAttribute('StartsNewPage') === 'Yes' && out.some((one) => one.want !== 'title')) {
      gap()
      line('pageBreak', [plain('===')])
      speaking = false
    }
    const lines = linesIn(paragraph)
    if (!lines.length) return
    const part = PART[paragraph.getAttribute('Type') ?? ''] ?? 'action'
    const want: Part = part === 'action' && paragraph.getAttribute('Alignment') === 'Center' ? 'centered' : part
    const said = want === 'parenthetical' || want === 'dialogue'
    if (!(said && speaking)) gap()
    speaking = want === 'character' || (said && speaking)
    const number = want === 'scene' ? paragraph.getAttribute('Number')?.trim() : undefined
    for (const content of lines) {
      // An empty line inside a speech is two spaces, as Fountain keeps one; elsewhere, an empty line.
      if (!text(content).trim()) {
        if (want === 'dialogue') line('dialogue', [plain('  ')])
        else gap()
        continue
      }
      const words = text(content).trim()
      const wrapped = want === 'parenthetical' && !(words.startsWith('(') && words.endsWith(')')) ? [plain('('), ...content, plain(')')] : content
      line(want, [...wrapped, ...(number ? [plain(` #${number}#`)] : []), ...(want === 'character' && dual ? [plain(' ^')] : [])])
    }
  }
  for (const paragraph of childrenOf(script, 'Paragraph')) take(paragraph, false)
  // A line that Fountain would read as something else is given the mark that forces it, and what follows read again.
  for (let pass = 0; pass < 3; pass++) {
    const read = readLines(out.map((one) => text(one.content)))
    let changed = false
    out.forEach((one, i) => {
      const force = FORCE[one.want]
      if (!force || one.forced || read[i].element === one.want) return
      one.content = [plain(force[0]), ...one.content, ...(force[1] ? [plain(force[1])] : [])]
      one.forced = true
      changed = true
    })
    if (!changed) break
  }
  while (out.at(-1)?.want === 'blank') out.pop()
  return { type: 'doc', content: out.map((one) => (one.content.length ? { type: 'paragraph', content: one.content } : { type: 'paragraph' })) }
}
