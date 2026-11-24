import type { JSONContent } from '@tiptap/react'
import type { Element } from './fountain'
import { scriptParagraphs, titleLines, type Run, type ScriptParagraph } from './scriptPages'

/**
 * A screenplay (Nib Plus) as Word and as HTML, laid out as a script: a
 * paragraph an element (lib/scriptPages scriptParagraphs), each from its own
 * indent on the six-inch line of Courier 12 the PDF has, the title page
 * first. Word and the reader's screen paginate them, so no (MORE) or
 * (CONT'D); the PDF (lib/scriptPages) is the one laid out page by page.
 */

/** Each element's indents on the six-inch line, left and right, in characters of the sixty it holds. */
const INDENT: Record<Element, [number, number]> = {
  scene: [0, 0],
  action: [0, 0],
  centered: [0, 0],
  transition: [0, 0],
  character: [22, 0],
  parenthetical: [16, 19],
  dialogue: [10, 15],
  lyric: [10, 15],
  title: [0, 0],
  section: [0, 0],
  synopsis: [0, 0],
  note: [0, 0],
  boneyard: [0, 0],
  pageBreak: [0, 0],
  blank: [0, 0],
}
/** What follows a character's name without an empty line before it. */
const SAID: Element[] = ['parenthetical', 'dialogue']
/** What's never left last on a page. */
const KEPT: Element[] = ['scene', 'character', 'parenthetical']

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function html(runs: Run[]): string {
  return runs
    .map((run) => {
      if (run.text === '\n') return '<br>'
      let text = escape(run.text)
      if (run.underline) text = `<u>${text}</u>`
      if (run.italic) text = `<i>${text}</i>`
      if (run.bold) text = `<b>${text}</b>`
      return text
    })
    .join('')
}

const percent = (characters: number) => `${+((characters / 60) * 100).toFixed(2)}%`

const STYLE = `
  :root { color-scheme: light; }
  body { margin: 0; background: #fff; color: #000; }
  main { max-width: 6in; margin: 0 auto; padding: 1in 24px; font: 12pt/1.25 'Courier Prime', 'Courier New', Courier, monospace; }
  p { margin: 1.25em 0 0; white-space: pre-wrap; overflow-wrap: break-word; }
  .parenthetical, .dialogue { margin-top: 0; }
  ${(['character', 'parenthetical', 'dialogue', 'lyric'] as const).map((element) => `.${element} { margin-left: ${percent(INDENT[element][0])}; margin-right: ${percent(INDENT[element][1])}; }`).join('\n  ')}
  .transition { text-align: right; }
  .centered { text-align: center; }
  .scene { position: relative; }
  .number { position: absolute; top: 0; }
  .number.before { right: calc(100% + 0.3in); }
  .number.after { left: calc(100% + 0.1in); }
  .dual { display: flex; gap: 0.25in; }
  .dual > div { flex: 1; min-width: 0; }
  .dual p { margin-left: 0; margin-right: 0; }
  .dual .character { text-align: center; }
  .page-break { break-before: page; }
  .title-page { break-after: page; padding-bottom: 2in; }
  .title-page p { margin: 0; min-height: 1.25em; }
  @media print { @page { size: letter; margin: 1in 1in 1in 1.5in; } main { max-width: none; padding: 0; } .title-page { padding-bottom: 0; } }
`

function paragraphHtml(paragraph: ScriptParagraph): string {
  if ('dual' in paragraph) {
    // The two side by side: each from its own name on.
    const second = paragraph.dual.findIndex((one, index) => index > 0 && 'element' in one && one.element === 'character')
    const sides = second > 0 ? [paragraph.dual.slice(0, second), paragraph.dual.slice(second)] : [paragraph.dual]
    return `<div class="dual">${sides.map((side) => `<div>${side.map(paragraphHtml).join('')}</div>`).join('')}</div>`
  }
  const numbers = paragraph.number ? `<span class="number before">${escape(paragraph.number)}</span><span class="number after">${escape(paragraph.number)}</span>` : ''
  return `<p class="${paragraph.element}${paragraph.pageBreak ? ' page-break' : ''}">${numbers}${html(paragraph.runs)}</p>`
}

/** A screenplay as a standalone page, laid out as a script, its title page first. */
export function scriptHtml(body: JSONContent, title: string): string {
  const lines = titleLines(body)
  const titlePage = lines ? `<section class="title-page">${lines.map((line) => `<p style="text-align: ${line?.alignment ?? 'left'}">${line ? html(line.runs) : ''}</p>`).join('')}</section>` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>${titlePage}${scriptParagraphs(body).map(paragraphHtml).join('')}</main>
</body>
</html>
`
}

/** A screenplay as a .docx, laid out as a script on US Letter: its title page, then the script, its pages after the first numbered at the top right. */
export async function scriptDocx(body: JSONContent, title: string): Promise<Blob> {
  const { AlignmentType, Document, Header, LineRuleType, Packer, PageNumber, Paragraph, Tab, TextRun } = await import('docx')
  const INCH = 1440
  /** A character of Courier 12, in twentieths of a point. */
  const CHARACTER = 144
  const LINE = { line: 240, lineRule: LineRuleType.EXACT }
  const runs = (given: Run[]) =>
    given.map((run) => (run.text === '\n' ? new TextRun({ text: '', break: 1 }) : new TextRun({ text: run.text, bold: run.bold, italics: run.italic, underline: run.underline ? {} : undefined })))

  const paragraphs = (paragraph: ScriptParagraph): InstanceType<typeof Paragraph>[] => {
    if ('dual' in paragraph) return paragraph.dual.flatMap(paragraphs)
    const [left, right] = INDENT[paragraph.element]
    return [
      new Paragraph({
        spacing: { ...LINE, before: SAID.includes(paragraph.element) ? 0 : 240 },
        // A scene's number out in the margin before it, as the PDF has it.
        indent: { left: left * CHARACTER, right: right * CHARACTER, ...(paragraph.number ? { hanging: INCH / 2 } : {}) },
        alignment: paragraph.element === 'transition' ? AlignmentType.RIGHT : paragraph.element === 'centered' ? AlignmentType.CENTER : AlignmentType.LEFT,
        pageBreakBefore: paragraph.pageBreak,
        // A scene heading, a name and a parenthetical never last on a page: Word keeps each with what follows.
        keepNext: KEPT.includes(paragraph.element) || undefined,
        children: [...(paragraph.number ? [new TextRun({ children: [paragraph.number, new Tab()] })] : []), ...runs(paragraph.runs)],
      }),
    ]
  }

  const page = { size: { width: 12240, height: 15840 }, margin: { top: INCH, right: INCH, bottom: INCH, left: INCH * 1.5, header: INCH / 2 } }
  const lines = titleLines(body)
  const ALIGNED = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT }
  const titlePage = lines?.map((line) => new Paragraph({ spacing: LINE, alignment: line ? ALIGNED[line.alignment] : undefined, children: line ? runs(line.runs) : [] }))
  const script = scriptParagraphs(body).flatMap(paragraphs)
  const number = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: [PageNumber.CURRENT, '.'] })] })] })
  const document = new Document({
    title,
    styles: { default: { document: { run: { font: 'Courier New', size: 24 }, paragraph: { spacing: { after: 0, ...LINE } } } } },
    sections: [
      // Its contact and date are on the PDF's last line, with a line of their own each here: half an inch more room under them.
      ...(titlePage ? [{ properties: { page: { ...page, margin: { ...page.margin, bottom: INCH / 2 } } }, children: titlePage }] : []),
      // The script's first page is page 1 and isn't numbered; the rest are.
      { properties: { page: { ...page, pageNumbers: { start: 1 } }, titlePage: true }, headers: { default: number, first: new Header({ children: [] }) }, children: script.length ? script : [new Paragraph({})] },
    ],
  })
  return Packer.toBlob(document)
}
