import { describe, expect, it } from 'vitest'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { getSchema } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import type { JSONContent } from '@tiptap/react'
import { nibExtensions } from '../editor/extensions'
import type { Item } from '../db/db'
import { toDocx } from './documentExport'
import { DOC_BUDGET, MAX_BYTES } from './image'
import { readDocx as readParts } from './docx'
// Written from __fixtures__/manuscript.md by `pandoc manuscript.md -o manuscript-pandoc.docx`,
// and that saved again by LibreOffice (soffice --convert-to docx): two real writers of Word files.
import pandoc from './__fixtures__/manuscript-pandoc.docx?url'
import libre from './__fixtures__/manuscript-libreoffice.docx?url'

/** A .docx's bytes, read as lib/importApps reads them once its checks have passed (those are tested there). */
const readDocx = async (bytes: Uint8Array) => readParts(unzipSync(bytes))

/** Word documents read into Nib pages (lib/docx). */

const schema = getSchema(nibExtensions(true))
const bytesOf = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer())
/** Throws unless Nib's own schema takes the page as it is. */
const fits = (body: JSONContent) => PMNode.fromJSON(schema, body).check()

const t = (text: string, ...marks: NonNullable<JSONContent['marks']>): JSONContent => ({ type: 'text', text, ...(marks.length ? { marks } : {}) })
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const item = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content })
const cell = (type: string, text: string): JSONContent => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p(t(text))] })

const MANUSCRIPT: JSONContent[] = [
  h(1, 'The Crossing'),
  h(1, 'Chapter one'),
  p(
    t('The ferry leaves at '),
    t('seven', { type: 'bold' }),
    t(' sharp, and the '),
    t('crossing', { type: 'italic' }),
    t(' takes an '),
    t('hour', { type: 'underline' }),
    t(' if the sea is '),
    t('calm', { type: 'strike' }),
    t(' kind.'),
    { type: 'footnote', attrs: { text: 'Pevensie, 1950.' } },
    t(' See '),
    t('the timetable', { type: 'link', attrs: { href: 'https://example.com/times' } }),
    t('.'),
  ),
  h(2, 'The quay'),
  { type: 'bulletList', content: [item(p(t('Tickets'))), item(p(t('Rope')), { type: 'bulletList', content: [item(p(t('Long rope')))] }), item(p(t('Lanterns')))] },
  { type: 'orderedList', content: [item(p(t('First'))), item(p(t('Second')))] },
  { type: 'blockquote', content: [p(t('The sea is a road.'))] },
  {
    type: 'table',
    content: [
      { type: 'tableRow', content: [cell('tableHeader', 'Day'), cell('tableHeader', 'Time')] },
      { type: 'tableRow', content: [cell('tableCell', 'Mon'), cell('tableCell', '07:40')] },
    ],
  },
  p({ type: 'image', attrs: { src: expect.stringMatching(/^data:image\/png;base64,/), alt: 'The quay at dusk' } }),
  p(t('The quay at dusk')),
  // The comment, a note to self on its words; the insertion taken, the deletion not.
  p(t('They reach the island before dark.', { type: 'noteToSelf', attrs: { id: expect.any(String), text: 'Ann: Is it ever dark by then?' } }), t(' Then they rest.')),
  h(3, 'A small heading'),
  p(t('Line one'), { type: 'hardBreak' }, t('line two.')),
]

describe('readDocx, on files real programs wrote', () => {
  // LibreOffice centres its title on the paragraph itself.
  const [title, ...rest] = MANUSCRIPT
  it.each([
    ['pandoc', pandoc, MANUSCRIPT],
    ['LibreOffice', libre, [{ ...title, attrs: { ...title.attrs, textAlign: 'center' } }, ...rest]],
  ])('reads a manuscript from %s: headings, words’ styles, links, footnotes, lists, quotes, tables, pictures, comments and changes', async (_, url, written) => {
    const { body, left } = await readDocx(await bytesOf(url))
    expect(body.content).toEqual(written)
    expect(left).toEqual({})
    expect(() => fits(body)).not.toThrow()
  })
})

describe('readDocx, on Nib’s own Word export', () => {
  it('reads back a page as it was written out', async () => {
    const page: JSONContent = {
      type: 'doc',
      content: [
        h(1, 'The Crossing'),
        h(2, 'The quay'),
        p(
          t('The ferry leaves at '),
          t('seven', { type: 'bold' }),
          t(', '),
          t('kind', { type: 'italic' }),
          t(' and '),
          t('slow', { type: 'underline' }),
          t(' or '),
          t('calm', { type: 'strike' }),
          t('.'),
          { type: 'footnote', attrs: { text: 'Pevensie, 1950.' } },
          t(' See '),
          t('times', { type: 'link', attrs: { href: 'https://example.com/times' } }),
          t('.'),
        ),
        { type: 'bulletList', content: [item(p(t('Rope')), { type: 'bulletList', content: [item(p(t('Long rope')))] })] },
        { type: 'orderedList', content: [item(p(t('First')))] },
        { type: 'blockquote', content: [p(t('The sea is a road.'))] },
      ],
    }
    const word = await toDocx({ id: 'crossing', kind: 'page', body: page, version: 1, createdAt: 0, updatedAt: 0 } as Item)
    const { body, left } = await readDocx(new Uint8Array(await word.arrayBuffer()))
    expect(body).toEqual(page)
    expect(left).toEqual({})
  })
})

// The parts of a .docx a test needs, around some body XML.
const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"',
].join(' ')
function docx(body: string, parts: Record<string, string | Uint8Array> = {}) {
  const files: Record<string, Uint8Array> = { 'word/document.xml': strToU8(`<w:document ${NS}><w:body>${body}</w:body></w:document>`) }
  for (const [name, content] of Object.entries(parts)) files[name] = typeof content === 'string' ? strToU8(content) : content
  return zipSync(files)
}
const run = (text: string, props = '') => `<w:r>${props && `<w:rPr>${props}</w:rPr>`}<w:t xml:space="preserve">${text}</w:t></w:r>`
const para = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`
const picture = (id: string) =>
  `<w:r><w:drawing><wp:inline><wp:docPr id="1" name="p" descr="A picture"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
const rels = (...pictures: [string, string][]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pictures
    .map(([id, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`)
    .join('')}</Relationships>`

describe('readDocx, on the harder parts of Word', () => {
  it('keeps how a paragraph sits, and leaves it to its direction when it’s Word’s ordinary left', async () => {
    const sitting = (jc: string, words: string, extra = '') => `<w:p><w:pPr>${extra}<w:jc w:val="${jc}"/></w:pPr>${run(words)}</w:p>`
    const { body } = await readDocx(docx(sitting('center', 'A') + sitting('right', 'B') + sitting('both', 'C') + sitting('left', 'D') + para(run('E')) + sitting('right', 'F', '<w:bidi/>') + sitting('nonsense', 'G')))
    expect(body.content!.map((line) => line.attrs?.textAlign)).toEqual(['center', 'right', 'justify', undefined, undefined, 'left', undefined])
    fits(body)
  })

  it('reads what Word shows, not how it’s made: field results, real line breaks, accepted moves', async () => {
    const { body } = await readDocx(
      docx(
        para(
          run('Page '),
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>',
          run('7'),
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
          run(' not bold', '<w:b w:val="0"/>'),
          '<w:r><w:br w:type="page"/></w:r>',
          `<w:moveFrom>${run(' moved away')}</w:moveFrom><w:del>${'<w:r><w:delText>gone</w:delText></w:r>'}</w:del><w:moveTo>${run(' moved here')}</w:moveTo>`,
        ) +
          para() +
          para('<w:r><w:tab/></w:r>', run('Indented.')),
      ),
    )
    expect(body.content).toEqual([p(t('Page 7 not bold moved here')), p(t('Indented.'))])
  })

  it('keeps the deeper heading levels, down to six, and makes what’s deeper still a six', async () => {
    const style = (level: number) => `<w:style w:type="paragraph" w:styleId="H${level}"><w:name w:val="heading ${level}"/></w:style>`
    const styled = (level: number) => `<w:p><w:pPr><w:pStyle w:val="H${level}"/></w:pPr>${run(`Level ${level}`)}</w:p>`
    const { body } = await readDocx(docx(styled(3) + styled(4) + styled(5) + styled(6) + styled(9), { 'word/styles.xml': `<w:styles ${NS}>${[3, 4, 5, 6, 9].map(style).join('')}</w:styles>` }))
    expect(body.content!.map((block) => [block.type, block.attrs?.level])).toEqual([3, 4, 5, 6, 6].map((level) => ['heading', level]))
  })

  it('keeps a numbered heading a heading, and makes a list of a list style', async () => {
    const styles = `<w:styles ${NS}>
      <w:style w:type="paragraph" w:styleId="Kop1"><w:name w:val="heading 1"/></w:style>
      <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
    </w:styles>`
    const numbering = `<w:numbering ${NS}>
      <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
      <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
      <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
    </w:numbering>`
    const { body } = await readDocx(
      docx(
        `<w:p><w:pPr><w:pStyle w:val="Kop1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>${run('Chapter One')}</w:p>` +
          `<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr>${run('Oars')}</w:p>`,
        { 'word/styles.xml': styles, 'word/numbering.xml': numbering },
      ),
    )
    expect(body.content).toEqual([h(1, 'Chapter One'), { type: 'bulletList', content: [item(p(t('Oars')))] }])
  })

  it('makes each comment a note to self: across paragraphs one note, where comments overlap one note with both', async () => {
    const comments = `<w:comments ${NS}>
      <w:comment w:id="1" w:author="Ann"><w:p>${run('One')}</w:p></w:comment>
      <w:comment w:id="2" w:author="Bo"><w:p>${run('Two')}</w:p></w:comment>
    </w:comments>`
    const { body } = await readDocx(
      docx(
        para('<w:commentRangeStart w:id="1"/>', run('A'), '<w:commentRangeStart w:id="2"/>', run('B'), '<w:commentRangeEnd w:id="1"/>', run('C'), '<w:commentRangeEnd w:id="2"/>', run('D')) +
          para('<w:commentRangeStart w:id="1"/>', run('E')) +
          para(run('F'), '<w:commentRangeEnd w:id="1"/>'),
        { 'word/comments.xml': comments },
      ),
    )
    const notes = (body.content ?? []).flatMap((block) => (block.content ?? []).map((node) => [node.text, node.marks?.[0]?.attrs?.id, node.marks?.[0]?.attrs?.text]))
    const [[, one], [, both], [, two], [, none], [, again], [, last]] = notes
    expect(notes.map(([text, , said]) => [text, said])).toEqual([
      ['A', 'Ann: One'],
      ['B', 'Ann: One\nBo: Two'],
      ['C', 'Bo: Two'],
      ['D', undefined],
      ['E', 'Ann: One'],
      ['F', 'Ann: One'],
    ])
    expect(new Set([one, both, two]).size).toBe(3)
    expect(none).toBeUndefined()
    expect([again, last]).toEqual([one, one])
  })

  it('leaves out what Nib has no place for, and counts it: shapes and text boxes, equations, headers', async () => {
    const box = `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent>${para(run('Boxed'))}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>`
    const { body, left } = await readDocx(
      docx(para(run('Before '), box, '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>', '<w:r><w:pict/></w:r>', run('after.')), {
        'word/header1.xml': `<w:hdr ${NS}>${para(run('The Crossing — draft'))}</w:hdr>`,
      }),
    )
    expect(body.content).toEqual([p(t('Before after.'))])
    expect(left).toEqual({ shapes: 2, equations: 1, headers: 1 })
  })

  it('brings pictures in made to fit, within the document’s share; one it can’t read, it says so', async () => {
    // Noise, so a canvas can't squeeze it: each picture close to the most one may be.
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 230
    const context = canvas.getContext('2d')!
    const noise = context.createImageData(230, 230)
    for (let i = 0; i < noise.data.length; i++) noise.data[i] = i % 4 === 3 ? 255 : (i * 2654435761) >>> 24
    context.putImageData(noise, 0, 0)
    const png = new Uint8Array(await (await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'))).arrayBuffer())
    expect(png.length).toBeLessThan(MAX_BYTES)
    // As many as twice the document's share would take.
    const many = Math.ceil((2 * DOC_BUDGET) / ((png.length * 4) / 3))
    const media: Record<string, Uint8Array> = { 'word/media/drawn.emf': new Uint8Array([1, 0, 0, 0]) }
    const refs: [string, string][] = [['rIdE', 'media/drawn.emf']]
    for (let i = 0; i < many; i++) {
      media[`word/media/p${i}.png`] = png
      refs.push([`rId${i}`, `media/p${i}.png`])
    }
    const { body, left } = await readDocx(
      docx(para(picture('rIdE')) + para(...refs.slice(1).map(([id]) => picture(id))), { 'word/_rels/document.xml.rels': rels(...refs), ...media }),
    )
    const [first, second] = body.content!
    expect(first).toEqual(p(t('[picture not imported: not a format Nib reads]')))
    const kept = second.content!.filter((node) => node.type === 'image')
    const refused = second.content!.filter((node) => node.text === '[picture not imported: too large]')
    expect(kept.length).toBeGreaterThan(0)
    expect(refused.length).toBeGreaterThan(0)
    expect(kept.reduce((sum, image) => sum + image.attrs!.src.length, 0)).toBeLessThanOrEqual(DOC_BUDGET)
    expect(left).toEqual({ pictures: 1 + refused.length })
    expect(() => fits(body)).not.toThrow()
  })

  it('takes a large picture made smaller, as a pasted one is', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 2400
    canvas.height = 1600
    const context = canvas.getContext('2d')!
    const sky = context.createLinearGradient(0, 0, 0, 1600)
    sky.addColorStop(0, '#89b4d8')
    sky.addColorStop(1, '#f2d6a2')
    context.fillStyle = sky
    context.fillRect(0, 0, 2400, 1600)
    for (let i = 0; i < 400; i++) {
      context.fillStyle = `hsl(${i % 360} 40% 50%)`
      context.fillRect((i * 97) % 2400, (i * 53) % 1600, 30, 30)
    }
    const png = new Uint8Array(await (await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'))).arrayBuffer())
    expect(png.length).toBeGreaterThan(MAX_BYTES)
    const { body, left } = await readDocx(docx(para(picture('rId1')), { 'word/_rels/document.xml.rels': rels(['rId1', 'media/big.png']), 'word/media/big.png': png }))
    const image = body.content![0].content![0]
    expect(image.type).toBe('image')
    expect(Math.floor((image.attrs!.src.length * 3) / 4)).toBeLessThanOrEqual(MAX_BYTES * 1.01)
    expect(left).toEqual({})
  })

  it('links only to the web and mail, and keeps a cell across two columns', async () => {
    const links = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rIdW" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
      <Relationship Id="rIdJ" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>
    </Relationships>`
    const { body } = await readDocx(
      docx(
        para(`<w:hyperlink r:id="rIdW">${run('web')}</w:hyperlink>`, run(' and '), `<w:hyperlink r:id="rIdJ">${run('script')}</w:hyperlink>`) +
          `<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${para(run('Both'))}</w:tc></w:tr><w:tr><w:tc>${para(run('A'))}</w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>`,
        { 'word/_rels/document.xml.rels': links },
      ),
    )
    expect(body.content).toEqual([
      p(t('web', { type: 'link', attrs: { href: 'https://example.com' } }), t(' and script')),
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ ...cell('tableCell', 'Both'), attrs: { colspan: 2, rowspan: 1, colwidth: null } }] },
          { type: 'tableRow', content: [cell('tableCell', 'A'), { ...cell('tableCell', ''), content: [{ type: 'paragraph' }] }] },
        ],
      },
    ])
    expect(() => fits(body)).not.toThrow()
  })

  it('refuses a file that isn’t a Word document', async () => {
    await expect(readDocx(zipSync({ 'mimetype': strToU8('application/epub+zip') }))).rejects.toThrow('Not a Word document')
    await expect(readDocx(strToU8('not a zip at all'))).rejects.toThrow()
  })
})
