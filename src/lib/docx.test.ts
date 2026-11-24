// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { readDocx as readParts } from './docx'

/** What of reading a Word document needs no real browser. The rest, with real files, is in docx.browser.test.ts. */

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
].join(' ')
const read = (body: string, parts: Record<string, Uint8Array> = {}) => readParts(unzipSync(zipSync({ 'word/document.xml': strToU8(`<w:document ${NS}><w:body>${body}</w:body></w:document>`), ...parts })))
const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const picture = (id: string) => `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
const rels = (target: string) =>
  strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/></Relationships>`)
/** A real PNG, of one pixel. */
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (char) => char.charCodeAt(0))

describe('a Word document', () => {
  // Word writes `media/p.png`. Another writer's `./media/p.png` named no part of the file, and the picture was left out.
  it('finds a picture however its place beside the document is written', async () => {
    for (const target of ['media/p.png', './media/p.png', '../word/media/p.png', '/word/media/p.png']) {
      const { body, left } = await read(picture('rId1'), { 'word/_rels/document.xml.rels': rels(target), 'word/media/p.png': PNG })
      expect(body.content?.[0].content?.[0], target).toMatchObject({ type: 'image', attrs: { src: expect.stringMatching(/^data:image\/png;base64,/) } })
      expect(left.pictures, target).toBeUndefined()
    }
  })

  // A table of no rows is none to the editor: its page opened, but wouldn't export.
  it('leaves out a table with no cells in it', async () => {
    const { body } = await read(`${para('Before')}<w:tbl></w:tbl><w:tbl><w:tr></w:tr></w:tbl>${para('After')}`)
    expect(body.content?.map((node) => node.type)).toEqual(['paragraph', 'paragraph'])
  })

  // A cell's span is how many columns are drawn for it, one at a time.
  it('keeps a cell’s span to what a table can be drawn with', async () => {
    const cell = (span: string) => `<w:tc><w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>${para('x')}</w:tc>`
    const { body } = await read(`<w:tbl><w:tr>${cell('2')}${cell('10000000')}${cell('1e300')}</w:tr></w:tbl>`)
    expect(body.content?.[0].content?.[0].content?.map((one) => one.attrs?.colspan)).toEqual([2, 1, 1])
  })
})
