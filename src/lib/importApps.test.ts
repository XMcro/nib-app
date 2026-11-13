// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { gzipSync, strToU8, zipSync } from 'fflate'
import type { JSONContent } from '@tiptap/react'
import type { Item, Kind } from '../db/db'
import { buildExport } from './export'
import { DOC_BUDGET, MAX_BYTES } from './image'
import { htmlToBody } from './import'
import { IMPORT_ACCEPT, importedWords, readImportFile, type Imported } from './importApps'
import { md5 } from './md5'
import { colornoteOf } from './colornoteOf'
import { tarOf, type TarFile } from './tarOf'
import { plainText } from './text'

// Two different 1×1 PNGs, so a test can tell which one a note picked up.
const GREY = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const RED = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
const base64Of = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))

const file = (content: string | Uint8Array, name: string) => new File([content as BlobPart], name)

function zip(entries: Record<string, string | Uint8Array>, name = 'export.zip'): File {
  const data = Object.fromEntries(
    Object.entries(entries).map(([path, value]) => [path, typeof value === 'string' ? strToU8(value) : value]),
  )
  return file(zipSync(data), name)
}

const read = (input: File, kind: Kind = 'note') => readImportFile(input, kind)

/**
 * How much longer four times the input takes: about 4 if the time grows with
 * it, 16 with its square. The shortest of five tries at each size, since
 * whatever else the machine is doing can only add to a time.
 */
async function growth(reading: (size: number) => Promise<unknown>, size: number) {
  const shortest = async (at: number) => {
    let best = Infinity
    for (let run = 0; run < 5; run++) {
      const started = performance.now()
      await reading(at)
      best = Math.min(best, performance.now() - started)
    }
    return best
  }
  await reading(size) // warm up
  const small = await shortest(size)
  return (await shortest(size * 4)) / small
}

/** Where each file's record in a zip's directory starts, by name: for forging one. */
function directory(bytes: Uint8Array): Map<string, number> {
  const view = new DataView(bytes.buffer)
  const found = new Map<string, number>()
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue
    const length = view.getUint16(i + 28, true)
    found.set(new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + length)), i)
  }
  return found
}

/** Every node of `type` anywhere in a body, in document order. */
function nodes(body: JSONContent, type: string): JSONContent[] {
  const own = body.type === type ? [body] : []
  return [...own, ...(body.content ?? []).flatMap((child) => nodes(child, type))]
}

const lines = (doc: Imported) => plainText(doc.body).split('\n')
const firstBlock = (doc: Imported) => doc.body.content?.[0]
const headings = (doc: Imported) => nodes(doc.body, 'heading').map((node) => plainText({ type: 'doc', content: [node] }))
const images = (doc: Imported) => nodes(doc.body, 'image').map((node) => String(node.attrs?.src))

describe('IMPORT_ACCEPT', () => {
  it('lists every format the importer reads', () => {
    for (const extension of ['.md', '.markdown', '.txt', '.json', '.enex', '.html', '.htm', '.zip', '.tgz', '.jex', '.backup', '.bear2bk', '.textpack', '.docx']) {
      expect(IMPORT_ACCEPT.split(',')).toContain(extension)
    }
  })

  // Seen on the Mac, 2026-11-11: Apple Notes says what `.enex` is, a kind of XML with no MIME type of its own, and the picker greyed Evernote's exports out until XML was asked for.
  it('asks for XML too, without which a Mac with Apple Notes greys out Evernote’s exports', () => {
    expect(IMPORT_ACCEPT.split(',')).toContain('application/xml')
  })
})

describe('Word documents', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
  const word = (body: string, parts: Record<string, string | Uint8Array> = {}) =>
    zipSync({
      'word/document.xml': strToU8(`<w:document ${W}><w:body>${body}</w:body></w:document>`),
      ...Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, typeof part === 'string' ? strToU8(part) : part])),
    })

  it('makes a Word document one page, whichever kind is open, saying what Word had that Nib left out', async () => {
    const drawn = `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><a:blip r:embed="rId1"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
    const docx = word(
      `<w:p><w:r><w:t>The Crossing</w:t></w:r></w:p><w:p><w:r><w:t>By sea.</w:t></w:r><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath><w:r><w:pict/></w:r>${drawn}</w:p>`,
      {
        'word/header1.xml': `<w:hdr ${W}><w:p><w:r><w:t>Draft</w:t></w:r></w:p></w:hdr>`,
        'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart.emf"/></Relationships>`,
        'word/media/chart.emf': new Uint8Array([1, 0, 0, 0]),
      },
    )
    const { documents, skipped } = await read(file(docx, 'crossing.docx'), 'note')
    expect(documents.map((document) => [document.kind, lines(document)])).toEqual([['page', ['The Crossing', 'By sea.[picture not imported: not a format Nib reads]']]])
    expect([...skipped].sort()).toEqual(
      ['1 equation from Word', '1 picture from Word, too large or in a format Nib doesn’t read', 'A text box or shape from Word', 'A Word document’s headers and footers'].sort(),
    )
  })

  it('says so when a Word document is empty or isn’t one', async () => {
    expect((await read(file(word('<w:p/><w:p><w:r><w:t> </w:t></w:r></w:p>'), 'blank.docx'))).skipped).toEqual(['1 empty note'])
    expect(await read(file('not a zip', 'broken.docx'))).toEqual({ documents: [], skipped: ['broken.docx: couldn’t be read'] })
  })

  // A .docx is a zip, and was unpacked whole: 52 KB of one became 1 GB, and 300 KB a 300 MB page.
  it('is opened past the same checks as any zip, and only the parts read are unpacked', async () => {
    /** Each file named, said in the zip's directory to unpack to 2 GB. */
    const huge = (bytes: Uint8Array, names: string[]) => {
      const view = new DataView(bytes.buffer)
      for (let at = 0; at < bytes.length - 4; at++) {
        if (view.getUint32(at, true) !== 0x02014b50) continue
        const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + view.getUint16(at + 28, true)))
        if (names.includes(name)) view.setUint32(at + 24, 0x7fffffff, true)
      }
      return bytes
    }
    const bomb = huge(word('<w:p><w:r><w:t>Big</w:t></w:r></w:p>'), ['word/document.xml'])
    expect(await read(file(bomb, 'bomb.docx'))).toEqual({ documents: [], skipped: ['bomb.docx: more than 128 MB to unpack, too large to open'] })
    // Embedded files, Word's own settings and anything else are left packed, however large.
    const others = ['word/embeddings/sheet.bin', 'word/media/deep/big.bin', 'customXml/item1.xml']
    const other = huge(word('<w:p><w:r><w:t>Small</w:t></w:r></w:p>', Object.fromEntries(others.map((name) => [name, 'x']))), others)
    const { documents, skipped } = await read(file(other, 'small.docx'))
    expect(documents.map(lines)).toEqual([['Small']])
    expect(skipped).toEqual([])
  })
})

// Security finding 7 of the 8 November audit: every other picture lost these on the way in.
describe('a picture’s words about itself', () => {
  const exif = strToU8('Exif\0\0GPS 51.5')
  const photo = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, exif.length + 2, ...exif, 0xff, 0xda, 0, 2, 7, 7, 0xff, 0xd9])
  const plain = Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 7, 7, 0xff, 0xd9])
  const data = (bytes: Uint8Array, type = 'jpeg') => `data:image/${type};base64,${base64Of(bytes)}`

  it('stay behind from a picture in a zip', async () => {
    const { documents } = await read(zip({ 'note.md': 'A note\n\n![](photo.jpg)', 'photo.jpg': photo }))
    expect(images(documents[0])).toEqual([data(plain)])
  })

  it('stay behind from a data URI in an imported or pasted page', async () => {
    const { documents } = await read(file(`<p>A page</p><img src="${data(photo)}">`, 'page.html'))
    expect(images(documents[0])).toEqual([data(plain)])
  })

  it('stay behind from Evernote’s, and its file name doesn’t become the picture’s alt', async () => {
    const enex = `<?xml version="1.0"?><en-export><note><title>Trip</title><content><![CDATA[<en-note><en-media type="image/jpeg" hash="${md5(photo)}"/></en-note>]]></content><resource><data encoding="base64">${base64Of(photo)}</data><mime>image/jpeg</mime><resource-attributes><file-name>Our house, 12 Elm Road.jpg</file-name></resource-attributes></resource></note></en-export>`
    const { documents } = await read(file(enex, 'export.enex'))
    expect(images(documents[0])).toEqual([data(plain)])
    expect(JSON.stringify(documents[0].body)).not.toContain('Elm Road')
  })

  // What's pasted comes through here, as HTML, past toDataUrl.
  it('stay behind from a picture in HTML, and one that can’t be read that far doesn’t come in', () => {
    const body = JSON.stringify(htmlToBody(`<p><img src="${data(photo)}"></p>`, 'note'))
    expect(body).toContain(base64Of(plain))
    expect(body).not.toContain(base64Of(photo))
    expect(JSON.stringify(htmlToBody('<p><img src="data:image/png;base64,iQEC"></p>', 'note'))).not.toContain('image')
  })

  it('say so of a picture that can’t be read that far, and keep the rest', async () => {
    const broken = Uint8Array.from([0x89, 1, 2, 3])
    const { documents } = await read(zip({ 'note.md': 'A note\n\n![](bad.png)\n\n![](photo.jpg)', 'bad.png': broken, 'photo.jpg': photo }))
    expect(plainText(documents[0].body)).toContain('[picture not imported: not a format Nib reads]')
    expect(images(documents[0])).toEqual([data(plain)])
  })
})

// Security finding 10 of the 8 November audit: what comes in has to be something the library can keep rewriting.
describe('a document too long to keep', () => {
  const simplenote = (...contents: string[]) => file(JSON.stringify({ activeNotes: contents.map((content) => ({ content })) }), 'notes.json')
  const LONG = 'word '.repeat(2_000_000)

  it('is refused and reported, and the rest of the file comes in', async () => {
    const { documents, skipped } = await read(simplenote('A short one', LONG))
    expect(documents.map(lines)).toEqual([['A short one']])
    expect(skipped).toEqual(['1 note that couldn’t be read'])
  })

  it('counts paragraphs as well as words: blank ones are what a small .docx can hold most of', async () => {
    const blank = 'x\n'.repeat(4_000_000)
    expect(blank.length).toBeLessThan(LONG.length)
    expect((await read(simplenote(blank))).skipped).toEqual(['1 note that couldn’t be read'])
  })

  it('keeps a long novel', async () => {
    const novel = 'word '.repeat(1_000_000)
    const { documents, skipped } = await read(simplenote(novel))
    expect(documents).toHaveLength(1)
    expect(skipped).toEqual([])
  })

  it('is refused from a Word document too', async () => {
    const paragraph = `<w:p><w:r><w:t>${LONG}</w:t></w:r></w:p>`
    expect(await read(file(zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph}</w:body></w:document>`) }), 'huge.docx'))).toEqual({
      documents: [],
      skipped: ['huge.docx: couldn’t be read'],
    })
  })
})

describe('importedWords', () => {
  it('names what came in by its kind', () => {
    expect(importedWords(['page'])).toBe('one page')
    expect(importedWords(['note'])).toBe('one note')
    expect(importedWords(['page', 'page', 'page'])).toBe('3 pages')
    expect(importedWords(['note', 'note'])).toBe('2 notes')
    expect(importedWords(['note', 'page', 'note'])).toBe('3 notes and pages')
  })
})

describe('Markdown and text files', () => {
  it('keeps the existing import: one document of the current kind', async () => {
    const { documents, skipped } = await read(file('# Shopping\n\nBread, milk', 'list.md'), 'page')
    expect(skipped).toEqual([])
    expect(documents).toHaveLength(1)
    expect(documents[0].kind).toBe('page')
    expect(headings(documents[0])).toEqual(['Shopping'])

    const asNote = await read(file('# Shopping\n\nBread, milk', 'list.md'), 'note')
    expect(asNote.documents[0].kind).toBe('note')
    expect(lines(asNote.documents[0])).toEqual(['Shopping', 'Bread, milk'])
  })

  it('still unpacks a Nib export into its notes and pages', async () => {
    const item = (kind: Kind, text: string): Item => ({
      id: text,
      kind,
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      version: 1,
      createdAt: 0,
      updatedAt: 0,
    })
    const md = buildExport([item('note', 'first'), item('note', 'second')], [item('page', 'a page')], Date.parse('2026-08-07'))
    const { documents } = await read(file(md, 'nib-export.md'), 'page')
    expect(documents.map((doc) => [doc.kind, plainText(doc.body)])).toEqual([
      ['note', 'first'],
      ['note', 'second'],
      ['page', 'a page'],
    ])
  })

  // Notesnook's "Markdown + frontmatter": a JSON-quoted title, its own
  // day-first dates in local time, and the title again as a heading.
  it('reads Notesnook frontmatter and strips it from the text', async () => {
    const md = [
      '---',
      'title: "Trip \\"plans\\""',
      'created_at: 31-01-2020 02:30 PM',
      'updated_at: 01-02-2020 09:05 AM',
      'pinned: true',
      'tags: travel, summer',
      '---',
      '',
      '# Trip "plans"',
      '',
      'Pack light.',
    ].join('\n')
    const { documents } = await read(file(md, 'trip.md'))
    expect(documents).toHaveLength(1)
    const [doc] = documents
    expect(lines(doc)).toEqual(['Trip "plans"', 'Pack light.'])
    expect(doc.createdAt).toBe(new Date(2020, 0, 31, 14, 30).getTime())
    expect(doc.updatedAt).toBe(new Date(2020, 1, 1, 9, 5).getTime())
    expect(doc.pinned).toBe(true)
  })

  it('makes a frontmatter title the first line when the text does not start with it', async () => {
    const md = '---\ntitle: Groceries\ncreated: 2024-03-05T10:00:00Z\nmodified: 2024-03-06T10:00:00Z\n---\nEggs and milk'
    const note = (await read(file(md, 'a.md'), 'note')).documents[0]
    expect(lines(note)).toEqual(['Groceries', 'Eggs and milk'])
    expect(note.createdAt).toBe(Date.parse('2024-03-05T10:00:00Z'))
    expect(note.updatedAt).toBe(Date.parse('2024-03-06T10:00:00Z'))

    const page = (await read(file(md, 'a.md'), 'page')).documents[0]
    expect(firstBlock(page)).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(lines(page)).toEqual(['Groceries', 'Eggs and milk'])
  })

  it('reads a bare year as a year and long digits as Unix seconds', async () => {
    const [doc] = (await read(file('---\ndate: 2020\nupdated: 1700000000\n---\nText', 'd.md'))).documents
    expect(doc.createdAt).toBe(Date.UTC(2020, 0, 1))
    expect(doc.updatedAt).toBe(1_700_000_000_000)
  })

  it('leaves a note that only opens with a rule alone', async () => {
    const md = '---\nJust a thought, really\n---\nMore below.'
    const { documents } = await read(file(md, 'thought.md'))
    expect(plainText(documents[0].body)).toContain('Just a thought, really')
  })

  it('says so when a file holds nothing', async () => {
    expect(await read(file('  \n', 'empty.md'))).toEqual({ documents: [], skipped: ['empty.md: nothing to import'] })
  })
})

// marked's own costs, on the main thread: its emphasis grows with the square
// of a paragraph's unmatched `*` and `_`, and its lists with their depth.
describe('Markdown that marked is slow on', () => {
  it('reads a paragraph of unmatched emphasis at once, keeping its words', async () => {
    const stars = (n: number) => read(file(`Before\n\n${'**a *'.repeat(n)}\n\nAfter`, 'stars.md'))
    expect(await growth(stars, 2000)).toBeLessThan(10)
    const { documents } = await stars(8000)
    const text = plainText(documents[0].body)
    expect(text).toContain('Before')
    expect(text).toContain('After')
    expect(text.split('a').length - 1).toBeGreaterThanOrEqual(8000)
  })

  // Strikethrough takes a single `~` too, and links their openers: both cost
  // the square of how many a paragraph holds, as emphasis did.
  it('reads a paragraph of unmatched strikethrough or link openers at once, keeping its words', async () => {
    for (const unit of ['~a ', '[a](', '![a](']) {
      const marks = (n: number) => read(file(`Before\n\n${unit.repeat(n)}\n\nAfter`, 'marks.md'))
      expect(await growth(marks, 5000), unit).toBeLessThan(10)
      const { documents } = await marks(20_000)
      const text = plainText(documents[0].body)
      expect(text).toContain('After')
      expect(text.split('a').length - 1).toBeGreaterThanOrEqual(20_000)
    }
  })

  it('reads lists nested far deeper than anyone writes at once', async () => {
    const nested = (n: number) => read(file(`${Array.from({ length: n }, (_, i) => `${'  '.repeat(i)}- item ${i}`).join('\n')}\n\nAfter`, 'deep.md'))
    expect(await growth(nested, 175)).toBeLessThan(10)
    const { documents } = await nested(700)
    expect(plainText(documents[0].body)).toContain('item 699')
  })

  it('keeps a long checklist’s boxes among many marks', async () => {
    const list = Array.from({ length: 1200 }, (_, i) => `- [${i % 3 ? ' ' : 'x'}] task ${i}`).join('\n')
    const { documents } = await read(file(list, 'tasks.md'))
    const boxes = nodes(documents[0].body, 'taskItem')
    expect(boxes).toHaveLength(1200)
    expect(boxes.slice(0, 4).map((item) => item.attrs?.checked)).toEqual([true, false, false, true])
  })

  it('keeps a long list’s bullets and rules among many marks', async () => {
    const list = Array.from({ length: 1200 }, (_, i) => `* item_${i}`).join('\n')
    const { documents } = await read(file(`> * quoted_one\n${list}\n***\nAfter`, 'list.md'))
    const lists = documents[0].body.content!.filter((node) => node.type === 'bulletList')
    expect(lists[0].content).toHaveLength(1200)
    const text = plainText(documents[0].body)
    expect(text).toContain('quoted_one')
    expect(text).toContain('item_1199')
    expect(text).not.toContain('\\')
    // Nib keeps no rules; one escaped would have come through as `***`.
    expect(text).not.toContain('*')
  })
})

describe('Simplenote', () => {
  const notes = {
    activeNotes: [
      {
        id: '1',
        content: 'Plain note\n\nSecond paragraph\n  indented line',
        creationDate: '2020-01-31T12:00:00.000Z',
        lastModified: '2020-02-01T08:30:00.000Z',
        pinned: true,
      },
      { id: '2', content: 'Recipe\n\n## Ingredients\n\n- flour', creationDate: '2021-05-05T00:00:00.000Z', lastModified: '2021-05-05T00:00:00.000Z', markdown: true },
      { id: '3', content: '# Todo\n\n- [x] done\n- [ ] not yet', creationDate: '2021-05-05T00:00:00.000Z', lastModified: '2021-05-05T00:00:00.000Z', markdown: true },
    ],
    trashedNotes: [
      { id: '4', content: 'gone', creationDate: '2020-01-01T00:00:00.000Z', lastModified: '2020-01-01T00:00:00.000Z' },
      { id: '5', content: 'gone too', creationDate: '2020-01-01T00:00:00.000Z', lastModified: '2020-01-01T00:00:00.000Z' },
    ],
  }

  it('reads notes.json picked on its own, leaving the trash out', async () => {
    const { documents, skipped } = await read(file(JSON.stringify(notes), 'notes.json'), 'page')
    expect(documents).toHaveLength(3)
    expect(skipped).toEqual(['2 notes in Simplenote’s trash'])

    const [plain, recipe, todo] = documents
    // Plain text keeps every line, the blank one and the indentation too.
    expect(plain.kind).toBe('note')
    expect(plain.body.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Plain note' }] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '  indented line' }] },
    ])
    expect(plain.createdAt).toBe(Date.parse('2020-01-31T12:00:00.000Z'))
    expect(plain.updatedAt).toBe(Date.parse('2020-02-01T08:30:00.000Z'))
    expect(plain.pinned).toBe(true)

    // A heading under the title makes a page; the title line is not repeated.
    expect(recipe.kind).toBe('page')
    expect(firstBlock(recipe)).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(headings(recipe)).toEqual(['Recipe', 'Ingredients'])

    // A heading that is only the title leaves a note a note.
    expect(todo.kind).toBe('note')
    expect(nodes(todo.body, 'taskItem').map((item) => item.attrs?.checked)).toEqual([true, false])
  })

  it('reads the zip without importing its .txt copies a second time', async () => {
    const archive = zip({
      'source/notes.json': JSON.stringify(notes),
      'Plain note.txt': 'Plain note\n\nSecond paragraph',
      'Recipe.txt': 'Recipe\n\n## Ingredients',
      'Todo.txt': '# Todo',
    }, 'notes.zip')
    const { documents, skipped } = await read(archive)
    expect(documents).toHaveLength(3)
    expect(skipped).toEqual(['2 notes in Simplenote’s trash'])
  })

  it('keeps going past a malformed note, and skips empty ones', async () => {
    const broken = { activeNotes: [{ id: 'a', content: 42 }, { id: 'b', content: '' }, { id: 'c', content: 'Fine' }] }
    const { documents, skipped } = await read(file(JSON.stringify(broken), 'notes.json'))
    expect(documents.map((doc) => plainText(doc.body))).toEqual(['Fine'])
    expect(skipped).toEqual(['1 note that couldn’t be read', '1 empty note'])
  })
})

describe('Evernote', () => {
  const enex = (...notes: string[]) =>
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n' +
    `<en-export export-date="20240101T000000Z" application="Evernote" version="10.0">${notes.join('\n')}</en-export>`

  const note = (title: string, content: string, resources = '') =>
    `<note><title>${title}</title><created>20200131T120000Z</created><updated>20200201T083000Z</updated>` +
    '<content><![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
    '<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">' +
    `<en-note>${content}</en-note>]]></content>${resources}</note>`

  const resource = (base64: string, mime: string, name?: string) =>
    `<resource><data encoding="base64">\n${base64.replace(/(.{60})/g, '$1\n')}\n</data><mime>${mime}</mime>` +
    (name ? `<resource-attributes><file-name>${name}</file-name></resource-attributes>` : '') +
    '</resource>'

  const PDF = btoa('%PDF-1.4 not really')

  it('reads a note with pictures, an attachment, to-dos and encrypted text', async () => {
    const content = [
      '<div>Pack&nbsp;the car.</div>',
      `<div><en-media hash="${md5(bytesOf(RED))}" type="image/png"/></div>`,
      `<div><en-media hash="${md5(bytesOf(PDF))}" type="application/pdf"/></div>`,
      '<div><en-todo checked="true"/>Tickets</div>',
      '<div><en-todo checked="false"/>Snacks</div>',
      '<div><br/></div>',
      '<div><en-crypt cipher="AES" length="128">c2VjcmV0</en-crypt></div>',
    ].join('')
    const resources = resource(GREY, 'image/png', 'grey.png') + resource(RED, 'image/png', 'red.png') + resource(PDF, 'application/pdf', 'plan.pdf')
    const { documents, skipped } = await read(file(enex(note('Road trip', content, resources)), 'trip.enex'), 'page')
    expect(skipped).toEqual([])
    expect(documents).toHaveLength(1)
    const [doc] = documents

    expect(doc.kind).toBe('note')
    expect(doc.createdAt).toBe(Date.UTC(2020, 0, 31, 12, 0, 0))
    expect(doc.updatedAt).toBe(Date.UTC(2020, 1, 1, 8, 30, 0))
    // The title was kept apart from the text, so it becomes the first line.
    expect(lines(doc)[0]).toBe('Road trip')
    expect(lines(doc)[1]).toBe('Pack the car.')
    // The en-media hash picks the red picture, not the first resource.
    expect(images(doc)).toEqual([`data:image/png;base64,${RED}`])
    expect(plainText(doc.body)).toContain('[attachment: plan.pdf]')
    expect(plainText(doc.body)).toContain('[encrypted text not imported]')

    const lists = nodes(doc.body, 'taskList')
    expect(lists).toHaveLength(1)
    expect(nodes(lists[0], 'taskItem').map((item) => [plainText({ type: 'doc', content: [item] }), item.attrs?.checked])).toEqual([
      ['Tickets', true],
      ['Snacks', false],
    ])
    // The blank line survives as one empty paragraph, not a hard break.
    expect(nodes(doc.body, 'hardBreak')).toEqual([])
    expect(doc.body.content).toContainEqual({ type: 'paragraph' })
  })

  it('makes a note with headings a page, its title an h1', async () => {
    const { documents } = await read(file(enex(note('Plan', '<div>Intro</div><h2>Day one</h2><div>Drive</div>')), 'plan.enex'))
    const [doc] = documents
    expect(doc.kind).toBe('page')
    expect(firstBlock(doc)).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(headings(doc)).toEqual(['Plan', 'Day one'])
  })

  it('does not repeat a title the text already opens with', async () => {
    const { documents } = await read(file(enex(note('Groceries', '<div>Groceries</div><div>Eggs</div>')), 'g.enex'))
    expect(lines(documents[0])).toEqual(['Groceries', 'Eggs'])
  })

  it('reads Evernote 10 checklists', async () => {
    const list =
      '<ul style="--en-todo:true;"><li style="--en-checked:true;"><div>Milk</div></li><li style="--en-checked:false;"><div>Bread</div></li></ul>'
    const [doc] = (await read(file(enex(note('Shop', list)), 's.enex'))).documents
    expect(nodes(doc.body, 'taskItem').map((item) => item.attrs?.checked)).toEqual([true, false])
    expect(nodes(doc.body, 'bulletList')).toEqual([])
  })

  it('puts visible text where a picture is too large', async () => {
    const big = new Uint8Array(MAX_BYTES + 1)
    big.set(bytesOf(GREY))
    const content = `<div>Before</div><div><en-media hash="${md5(big)}" type="image/png"/></div>`
    const { documents, skipped } = await read(file(enex(note('Big', content, resource(base64Of(big), 'image/png'))), 'big.enex'))
    expect(images(documents[0])).toEqual([])
    expect(plainText(documents[0].body)).toContain('[picture not imported: too large]')
    expect(skipped).toEqual(['1 picture too large to import'])
  })

  it('keeps a note whose attachment is damaged, and the notes after it', async () => {
    const damaged = note('Damaged', `<div>Still here</div><en-media hash="${'0'.repeat(32)}" type="image/png"/>`, resource('@@not base64@@', 'image/png'))
    const fine = note('Fine', '<div>Also here</div>')
    const { documents } = await read(file(enex(damaged, fine), 'two.enex'))
    expect(documents.map((doc) => lines(doc)[0])).toEqual(['Damaged', 'Fine'])
    expect(plainText(documents[0].body)).toContain('[attachment: image/png]')
  })

  // `([^>]*?)\s*\/>` tried every split of the spaces at every step: 40,000 of
  // them in one tag took a second, on the main thread.
  it('reads a tag padded with a long run of spaces at once', async () => {
    // Not closed with `/>`, so every way to share out the spaces is tried.
    const padded = (n: number) => read(file(enex(note('Padded', `<div>Text</div><div><en-todo checked="true"${' '.repeat(n)}></en-todo>Done</div>`)), 'padded.enex'))
    expect(await growth(padded, 25_000)).toBeLessThan(10)
    const { documents } = await padded(100_000)
    expect(plainText(documents[0].body)).toContain('Done')
  })

  // `([^>]*)` ran to the end of the note from every unclosed tag, looking for
  // a `/>`: 40,000 of them took five seconds.
  it('reads a note full of unclosed tags at once', async () => {
    const unclosed = (n: number) => read(file(enex(note('Unclosed', `<div>Text</div>${'<en-media '.repeat(n)}<div>After</div>`)), 'unclosed.enex'))
    expect(await growth(unclosed, 10_000)).toBeLessThan(10)
  })

  it('reports a file that is not well-formed XML', async () => {
    expect(await read(file('<en-export><note>', 'broken.enex'))).toEqual({
      documents: [],
      skipped: ['broken.enex: couldn’t be read'],
    })
  })
})

describe('Bear', () => {
  const recipe = [
    '# Pancakes',
    '',
    'Add ::a pinch of salt:: to taste. #cooking',
    '',
    '![](assets/stack%20photo.png)',
    '',
    '`keep ::this:: as written`',
  ].join('\n')

  const info = (bear: Record<string, unknown>) =>
    JSON.stringify({ type: 'net.daringfireball.markdown', version: 2, 'net.shinyfrog.bear': bear })

  it('reads a Bear backup: assets, highlights, dates, pins and the trash', async () => {
    const backup = zip(
      {
        'Pancakes.textbundle/text.markdown': recipe,
        'Pancakes.textbundle/info.json': info({
          creationDate: '2023-07-20T10:00:00Z',
          modificationDate: '2023-07-24T09:31:59Z',
          pinned: 1,
          trashed: 0,
        }),
        'Pancakes.textbundle/assets/stack photo.png': bytesOf(RED),
        'Old.textbundle/text.markdown': '# Old\n\n![](assets/old.png)',
        'Old.textbundle/info.json': info({ trashed: 1 }),
        'Old.textbundle/assets/old.png': bytesOf(GREY),
        'Secret.textbundle/text.markdown': '',
        'Secret.textbundle/info.json': info({ encrypted: 1 }),
      },
      'Bear.bear2bk',
    )
    const { documents, skipped } = await read(backup, 'page')
    expect(skipped).toEqual(['1 note in Bear’s trash', '1 note locked with Bear’s encryption'])
    expect(documents).toHaveLength(1)
    const [doc] = documents

    expect(doc.kind).toBe('note')
    expect(doc.createdAt).toBe(Date.parse('2023-07-20T10:00:00Z'))
    expect(doc.updatedAt).toBe(Date.parse('2023-07-24T09:31:59Z'))
    expect(doc.pinned).toBe(true)
    expect(images(doc)).toEqual([`data:image/png;base64,${RED}`])

    const marked = nodes(doc.body, 'text').filter((text) => text.marks?.some((mark) => mark.type === 'highlight'))
    expect(marked.map((text) => text.text)).toEqual(['a pinch of salt'])
    // Tags stay as the words they are; code keeps its colons.
    expect(plainText(doc.body)).toContain('to taste. #cooking')
    expect(plainText(doc.body)).toContain('keep ::this:: as written')
  })

  it('reads a .textpack with its files at the top, and Core Data dates', async () => {
    const pack = zip(
      {
        'text.md': 'Packed\n\n![](assets/a.png)',
        'info.json': info({ creationDate: 600000000 }),
        'assets/a.png': bytesOf(GREY),
      },
      'Packed.textpack',
    )
    const { documents, skipped } = await read(pack)
    expect(skipped).toEqual([])
    expect(lines(documents[0])[0]).toBe('Packed')
    expect(images(documents[0])).toEqual([`data:image/png;base64,${GREY}`])
    expect(documents[0].createdAt).toBe(Date.UTC(2001, 0, 1) + 600000000 * 1000)
  })
})

describe('Notesnook and other zips', () => {
  const notesnookHtml = [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />',
    '<title>Dinner</title>',
    '<meta name="created-at" content="05-03-2024 07:15 PM" />',
    '<meta name="updated-at" content="06-03-2024 08:00 AM" />',
    '<meta name="pinned" content="true" />',
    '<script>window.parent.hacked = true</script>',
    '</head><body><h1>Dinner</h1>',
    '<p>Pasta.</p><p><br/></p>',
    '<span class="image-container"><img src="../img/dish.png" alt="dish"></span>',
    '<img src="https://example.com/tracker.png" alt="remote">',
    '<table><tr><td>salt</td><td>pepper</td></tr></table>',
    '</body></html>',
  ].join('')

  it('reads nested folders, resolves pictures against each file, and ignores Finder litter', async () => {
    const archive = zip({
      'Notebook/Trip.md': '---\ntitle: "Trip"\ncreated_at: 01-02-2024 10:00 AM\n---\n\n# Trip\n\nThe map:\n\n![map](attachments/map.png)',
      'Notebook/attachments/map.png': bytesOf(GREY),
      'Notebook/Dinners/Dinner.html': notesnookHtml,
      'Notebook/img/dish.png': bytesOf(RED),
      'Notebook/unused.png': bytesOf(GREY),
      'Notebook/clip.mov': 'not really a film',
      'Notebook/notes.txt': 'Loose line',
      '__MACOSX/Notebook/._Trip.md': 'resource fork',
      '.DS_Store': 'finder',
      'Notebook/.hidden.md': 'should not import',
    })
    const { documents, skipped } = await read(archive)

    expect(documents.map((doc) => lines(doc)[0])).toEqual(['Trip', 'Dinner', 'Loose line'])
    expect(skipped).toEqual(['Notebook/unused.png: no note uses this picture', 'Notebook/clip.mov: not a format Nib reads'])

    const [trip, dinner] = documents
    expect(trip.kind).toBe('note')
    expect(trip.createdAt).toBe(new Date(2024, 1, 1, 10, 0).getTime())
    expect(images(trip)).toEqual([`data:image/png;base64,${GREY}`])

    // Its table makes it a page, where the table comes in as one.
    expect(dinner.kind).toBe('page')
    expect(dinner.createdAt).toBe(new Date(2024, 2, 5, 19, 15).getTime())
    expect(dinner.updatedAt).toBe(new Date(2024, 2, 6, 8, 0).getTime())
    expect(dinner.pinned).toBe(true)
    expect(images(dinner)).toEqual([`data:image/png;base64,${RED}`])
    // Nothing remote is fetched: the address stays as text to go and find.
    expect(plainText(dinner.body)).toContain('![remote](https://example.com/tracker.png)')
    const table = dinner.body.content?.find((block) => block.type === 'table')
    expect(table?.content?.[0].content?.map((cell) => plainText({ type: 'doc', content: cell.content }))).toEqual(['salt', 'pepper'])
    expect(plainText(dinner.body)).not.toContain('hacked')
  })

  it('stops inlining pictures once a document would pass its budget', async () => {
    const picture = new Uint8Array(190_000)
    picture.set(bytesOf(GREY))
    const perPicture = `data:image/png;base64,${base64Of(picture)}`.length
    const fits = Math.floor(DOC_BUDGET / perPicture)
    expect(fits).toBeLessThan(9)

    const md = `Album\n\n${Array.from({ length: 9 }, () => '![](pic.png)').join('\n\n')}`
    const { documents, skipped } = await read(zip({ 'album.md': md, 'pic.png': picture }))
    expect(images(documents[0])).toHaveLength(fits)
    expect(plainText(documents[0].body).split('[picture not imported: too large]')).toHaveLength(9 - fits + 1)
    const over = 9 - fits
    expect(skipped).toEqual([`${over} ${over === 1 ? 'picture' : 'pictures'} too large to import`])
  })

  it('does not mistake a file named after an object key for a picture', async () => {
    const { documents, skipped } = await read(zip({ 'a.md': 'Odd\n\n![](x.constructor)', 'x.constructor': 'data' }))
    expect(images(documents[0])).toEqual([])
    expect(plainText(documents[0].body)).toContain('![](x.constructor)')
    expect(skipped).toEqual(['x.constructor: not a format Nib reads'])
  })

  it('applies the kind rule to Markdown inside a zip', async () => {
    const { documents } = await read(
      zip({ 'a.md': '# Just a title\n\nText', 'b.md': '# Guide\n\n## Part one\n\nText', 'c.md': 'No title heading\n\n## Section' }),
      'page',
    )
    expect(documents.map((doc) => doc.kind)).toEqual(['note', 'page', 'page'])
    expect(headings(documents[1])).toEqual(['Guide', 'Part one'])
    // A page's first line is its title, so it becomes the h1 it opens with.
    expect(headings(documents[2])).toEqual(['No title heading', 'Section'])
    expect(firstBlock(documents[2])).toMatchObject({ type: 'heading', attrs: { level: 1 } })
  })

  it('leaves a page that opens with a list as written', async () => {
    const { documents } = await read(zip({ 'list.md': '- first item\n- second\n\n## Later' }))
    expect(firstBlock(documents[0])).toMatchObject({ type: 'bulletList' })
    expect(headings(documents[0])).toEqual(['Later'])
  })

  it('refuses a zip that would take more than 128 MB of unpacking, without unpacking it', async () => {
    const bytes = zipSync({ 'a.md': strToU8('hello') })
    // Forge the central directory's uncompressed size for the one entry.
    const view = new DataView(bytes.buffer)
    const central = bytes.findIndex((_, i) => view.getUint32(i, true) === 0x02014b50)
    view.setUint32(central + 24, 0x7fffffff, true)
    const result = await read(file(bytes, 'bomb.zip'))
    expect(result).toEqual({ documents: [], skipped: ['bomb.zip: more than 128 MB to unpack, too large to open'] })
  })

  it('refuses a zip claiming more than 10,000 files', async () => {
    const bytes = zipSync({ 'a.md': strToU8('hello') })
    const view = new DataView(bytes.buffer)
    const end = bytes.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    view.setUint16(end + 8, 0xffff, true)
    view.setUint16(end + 10, 0xffff, true)
    const result = await read(file(bytes, 'many.zip'))
    expect(result).toEqual({ documents: [], skipped: ['many.zip: more than 10,000 files, too many to open'] })
  })

  // A stored file is copied by its real size, whatever it declares: this one
  // declared nothing, so it never counted against the limit.
  it('refuses a stored file bigger than it says it is', async () => {
    const bytes = zipSync({ 'a.md': [strToU8('x'.repeat(1000)), { level: 0 }] })
    new DataView(bytes.buffer).setUint32(directory(bytes).get('a.md')! + 24, 0, true)
    expect(await read(file(bytes, 'stored.zip'))).toEqual({ documents: [], skipped: ['stored.zip: couldn’t be opened'] })
  })

  // Security finding 1 of the 8 November audit: fflate picks by name, so a picture left out for its size
  // was unpacked anyway under the name of a small one, outside every limit, and took its place.
  it('unpacks only the entries it counted, when two share a name', async () => {
    const bytes = zipSync({ 'note.md': strToU8('Album\n\n![](a.png)'), 'a.png': bytesOf(RED), 'b.png': bytesOf(GREY) })
    const view = new DataView(bytes.buffer)
    const twin = directory(bytes).get('b.png')!
    bytes.set(strToU8('a.png'), twin + 46)
    view.setUint32(twin + 24, MAX_BYTES + 1, true)
    const { documents } = await read(file(bytes, 'album.zip'))
    expect(images(documents[0])).toEqual([`data:image/png;base64,${RED}`])
  })

  // Security finding 9: a file that says it holds less than it does. The size given is the data's own, which
  // passes any check of its length against what it declares, and still unpacked to a thousand times that.
  it('refuses a file that unpacks to more than it says, and doesn’t go on unpacking it', async () => {
    const bytes = zipSync({ 'a.md': strToU8('x'.repeat(1_000_000)) })
    const view = new DataView(bytes.buffer)
    const entry = directory(bytes).get('a.md')!
    view.setUint32(entry + 24, view.getUint32(entry + 20, true), true)
    expect(await read(file(bytes, 'bomb.zip'))).toEqual({ documents: [], skipped: ['bomb.zip: couldn’t be opened'] })
  })

  it('unpacks a file of many steps whole, and refuses one cut short', async () => {
    let seed = 1
    const words = Array.from({ length: 40_000 }, () => ((seed = (seed * 48271) % 2147483647), seed.toString(36))).join(' ')
    const whole = zipSync({ 'a.md': strToU8(words) })
    expect(new DataView(whole.buffer).getUint32(directory(whole).get('a.md')! + 20, true)).toBeGreaterThan(64 * 1024)
    expect(lines((await read(file(whole, 'long.zip'))).documents[0])).toEqual([words])
    const short = zipSync({ 'a.md': strToU8('hello there, hello there') })
    const view = new DataView(short.buffer)
    view.setUint32(directory(short).get('a.md')! + 20, 4, true)
    expect(await read(file(short, 'short.zip'))).toEqual({ documents: [], skipped: ['short.zip: couldn’t be opened'] })
  })

  // Every file pointing at the same data unpacks it again: a few MB became 400.
  it('refuses files that share their data', async () => {
    const bytes = zipSync({ 'a.md': strToU8('First'), 'b.md': strToU8('Second') })
    const view = new DataView(bytes.buffer)
    const entries = directory(bytes)
    view.setUint32(entries.get('b.md')! + 42, view.getUint32(entries.get('a.md')! + 42, true), true)
    expect(await read(file(bytes, 'shared.zip'))).toEqual({ documents: [], skipped: ['shared.zip: couldn’t be opened'] })
  })

  // fflate reads a ZIP64 directory when there is one, and the layout check
  // never did: a harmless classic directory passed the check while fflate
  // unpacked another, whose files shared their data.
  it('checks the directory fflate reads, a ZIP64 one included', async () => {
    const bytes = zipSync({ 'a.md': strToU8('First'), 'b.md': strToU8('Second') })
    const view = new DataView(bytes.buffer)
    const entries = directory(bytes)
    view.setUint32(entries.get('b.md')! + 42, view.getUint32(entries.get('a.md')! + 42, true), true)
    const end = bytes.length - 22
    const [size, offset] = [view.getUint32(end + 12, true), view.getUint32(end + 16, true)]
    // The classic record is the decoy: it lists only a.md.
    view.setUint16(end + 8, 1, true)
    view.setUint16(end + 10, 1, true)
    const record = new DataView(new ArrayBuffer(56))
    record.setUint32(0, 0x06064b50, true)
    record.setBigUint64(4, 44n, true)
    record.setBigUint64(24, 2n, true)
    record.setBigUint64(32, 2n, true)
    record.setBigUint64(40, BigInt(size), true)
    record.setBigUint64(48, BigInt(offset), true)
    const locator = new DataView(new ArrayBuffer(20))
    locator.setUint32(0, 0x07064b50, true)
    locator.setBigUint64(8, BigInt(end), true)
    locator.setUint32(16, 1, true)
    const forged = new Uint8Array([...bytes.subarray(0, end), ...new Uint8Array(record.buffer), ...new Uint8Array(locator.buffer), ...bytes.subarray(end)])
    expect(await read(file(forged, 'zip64.zip'))).toEqual({ documents: [], skipped: ['zip64.zip: couldn’t be opened'] })
  })

  // It would be left out as too large anyway: unpacking it was work for
  // nothing, and counted against the whole export.
  it('leaves out a picture too large to keep without unpacking it', async () => {
    const bytes = zipSync({ 'album.md': strToU8('Album\n\n![](pic.png)'), 'pic.png': bytesOf(GREY) })
    new DataView(bytes.buffer).setUint32(directory(bytes).get('pic.png')! + 24, 300 * 1024 * 1024, true)
    const { documents } = await read(file(bytes, 'album.zip'))
    expect(plainText(documents[0].body)).toContain('[picture not imported: too large]')
  })

  it('reports a zip it cannot open', async () => {
    expect((await read(file('PK not a zip', 'fake.zip'))).skipped).toEqual(['fake.zip: couldn’t be opened'])
  })
})

describe('an Obsidian vault', () => {
  // Written from Obsidian's own account of its format, not by Obsidian.
  const vault = (entries: Record<string, string | Uint8Array>, root = 'My Vault/') =>
    zip(Object.fromEntries([[`${root}.obsidian/app.json`, '{}'], ...Object.entries(entries).map(([path, value]) => [root + path, value])]), 'My Vault.zip')
  const called = (documents: Imported[], title: string) => documents.find((doc) => lines(doc)[0] === title)!
  const marks = (doc: Imported, type: string) => nodes(doc.body, 'text').filter((node) => node.marks?.some((mark) => mark.type === type)).map((node) => node.text)

  it('calls each note what its file is called, whatever its first line or its properties say', async () => {
    const { documents, skipped } = await read(
      vault({
        'Harbour log.md': '---\ntitle: Something else\ntags:\n  - sailing\naliases:\n  - The log\ncreated: 2026-03-02T09:15:00\n---\nLeft the quay at seven.',
        'Notes/Tide tables.md': '# Tide tables\n\n## Spring tides\n\nHigh at 07:40.',
        'Notes/Ideas.v2.md': '# A heading of its own\n\nWords.',
        '.trash/Old idea.md': 'Thrown away.',
      }),
    )
    expect(skipped).toEqual([])
    expect(documents.map((doc) => [doc.kind, lines(doc)])).toEqual([
      ['note', ['Harbour log', 'Left the quay at seven.']],
      ['page', ['Tide tables', 'Spring tides', 'High at 07:40.']],
      ['page', ['Ideas.v2', 'A heading of its own', 'Words.']],
    ])
    expect(documents[0].createdAt).toBe(new Date('2026-03-02T09:15:00').getTime())
  })

  it('is one zipped from the inside too, and only as far as its own folder', async () => {
    const inside = await read(vault({ 'Log.md': 'Left at seven.' }, ''))
    expect(inside.documents.map(lines)).toEqual([['Log', 'Left at seven.']])
    const beside = await read(zip({ 'Vault/.obsidian/app.json': '{}', 'Vault/Log.md': 'Left at seven.', 'Other/Loose.md': 'Its own first line.' }))
    expect(beside.documents.map(lines)).toEqual([['Log', 'Left at seven.'], ['Its own first line.']])
  })

  it('leaves a folder of notes with no vault in it as it was read before', async () => {
    const { documents } = await read(zip({ 'Notes/Log.md': 'Left at ==seven==.\n\n![[quay.png]]', 'Notes/quay.png': bytesOf(GREY) }))
    expect(documents.map(lines)).toEqual([['Left at ==seven==.', '![[quay.png]]']])
  })

  it('finds a picture by its name alone from anywhere in the vault, as Obsidian does, and by its path', async () => {
    const { documents, skipped } = await read(
      vault({
        'Daily/Log.md': 'One:\n\n![[Quay at dawn.png]]\n\nTwo, at a width:\n\n![[chart.png|300]]\n\nThree, from the top:\n\n![[attachments/chart.png]]\n\nFour, the usual way:\n\n![a chart](attachments/chart.png)\n\n![](quay%20at%20dawn.png)\n\nNot the vault’s:\n\n![far](https://example.com/chart.png)',
        'attachments/quay at dawn.png': bytesOf(RED),
        'attachments/chart.png': bytesOf(GREY),
      }),
    )
    expect(skipped).toEqual([])
    const red = `data:image/png;base64,${RED}`
    const grey = `data:image/png;base64,${GREY}`
    expect(images(documents[0])).toEqual([red, grey, grey, grey, red])
    expect(lines(documents[0]).at(-1)).toBe('![far](https://example.com/chart.png)')
  })

  it('keeps a picture it can’t find as it was written, and still says which pictures no note used', async () => {
    const { documents, skipped } = await read(vault({ 'Log.md': 'Gone:\n\n![[lost.png]]', 'spare.png': bytesOf(GREY) }))
    expect(lines(documents[0])).toEqual(['Log', 'Gone:', '![](lost.png)'])
    expect(skipped).toEqual(['My Vault/spare.png: no note uses this picture'])
  })

  it('makes a note shown inside another a link to it, and reads a highlight, but not in code', async () => {
    const { documents } = await read(
      vault({
        'Log.md': 'Left at ==seven sharp==, not at a == b or c == d.\n\n![[Tide tables]]\n\n![[Tide tables#Spring tides|the springs]]\n\n```\n==fenced==\n```\n\n`==code==` and `![[Tide tables]]`',
        'Tide tables.md': 'High at 07:40.',
      }),
    )
    const log = called(documents, 'Log')
    expect(marks(log, 'highlight')).toEqual(['seven sharp'])
    // Without the empty line a fenced block comes in with, in any Markdown.
    expect(lines(log).filter(Boolean)).toEqual(['Log', 'Left at seven sharp, not at a == b or c == d.', '[[Tide tables]]', '[[Tide tables#Spring tides|the springs]]', '==fenced==', '==code== and ![[Tide tables]]'])
  })

  it('reads Obsidian’s other kinds of callout as the nearest of Nib’s, its title as the box’s first line, and its quote as a quotation, in any Markdown', async () => {
    const markdown = ['> [!faq]- Why seven?\n> The tide.', '> [!tip] A title alone\n>\n> Its words.', '> [!NOTE]\n> No title,\n> as GitHub writes one.', '> [!example]\n> A worked case.', '> [!BUG]\n> It leaks.', '> [!todo]\n> Rope.', '> [!important]\n> Nib’s own.', '> [!quote]\n> As she said.', '> [!nonsense]\n> Left alone.'].join('\n\n')
    const { documents } = await read(file(markdown, 'Callouts.md'))
    const boxes = nodes(documents[0].body, 'callout').map((node) => [node.attrs?.kind, node.attrs?.collapsed, plainText({ type: 'doc', content: [node] })])
    expect(boxes).toEqual([
      ['question', true, 'Why seven?\nThe tide.'],
      ['tip', false, 'A title alone\nIts words.'],
      ['note', false, 'No title, as GitHub writes one.'],
      ['note', false, 'A worked case.'],
      ['caution', false, 'It leaks.'],
      ['info', false, 'Rope.'],
      ['important', false, 'Nib’s own.'],
    ])
    expect(nodes(documents[0].body, 'blockquote').map((node) => plainText({ type: 'doc', content: [node] }))).toEqual(['As she said.', '[!nonsense] Left alone.'])
  })

  it('says which folder each note was in, the innermost, and none for one at the top or outside a vault', async () => {
    const { documents } = await read(vault({ 'Log.md': 'At the top.', 'Projects/Plan.md': 'One deep.', 'Projects/Novel/Chapter 1.md': 'Two deep.' }))
    expect(documents.map((doc) => [lines(doc)[0], doc.folder])).toEqual([['Log', undefined], ['Plan', 'Projects'], ['Chapter 1', 'Novel']])
    const loose = await read(zip({ 'Projects/Plan.md': '---\ntags: [work]\n---\nNo vault here. #work' }))
    expect(loose.documents.map((doc) => [doc.folder, doc.tags])).toEqual([[undefined, undefined]])
  })

  it('reads a note’s tags from its properties, however Obsidian wrote them, and from among its words', async () => {
    const { documents } = await read(
      vault({
        'Listed.md': '---\ntags:\n  - sailing\n  - "log"\n  - \'#boats\'\ncreated: 2026-03-02\n---\nWords.',
        'Bracketed.md': '---\ntags: [sailing, travel/italy]\n---\nWords.',
        'On a line.md': '---\ntag: sailing, log boats\n---\nWords.',
        'Among words.md': 'Left at seven #sailing, then #travel/italy/ and #2026-plans.\n\n#Ünïcode_tag at the start.\n\nNot these: issue #12, C#minor, a#b, `#code`, [a link](https://example.com/#part).\n\n```\n#fenced\n```',
        'None.md': '---\ntags:\naliases:\n  - other\n---\n# A heading is no tag',
      }),
    )
    expect(Object.fromEntries(documents.map((doc) => [lines(doc)[0], doc.tags]))).toEqual({
      Listed: ['sailing', 'log', 'boats'],
      Bracketed: ['sailing', 'travel/italy'],
      'On a line': ['sailing', 'log', 'boats'],
      'Among words': ['sailing', 'travel/italy', '2026-plans', 'Ünïcode_tag'],
      None: [],
    })
    // The words keep their tags, as written.
    expect(lines(documents.find((doc) => lines(doc)[0] === 'Among words')!)[1]).toBe('Left at seven #sailing, then #travel/italy/ and #2026-plans.')
  })

  it('names what a vault holds that Nib has no place for', async () => {
    const { skipped } = await read(vault({ 'Log.md': 'Words.', 'Board.canvas': '{}', 'Scan.pdf': 'pdf' }))
    expect(skipped).toEqual(['My Vault/Board.canvas: not a format Nib reads', 'My Vault/Scan.pdf: not a format Nib reads'])
  })
})

describe('Apple Notes', () => {
  // As Notes itself wrote them (File, Export To, Markdown), from notes made in it for this: every line of words ends in two spaces.
  const LISTS = ['# Nib test lists  ', '1. First item  ', '2. Second item  ', '3. Third item  ', '    1. Indented item  ', 'A plain paragraph between the lists.  ', '    * Bullet one  ', '    * Bullet two  ', '    - Dash one  ', '    - Dash two  ', '    - [ ] Buy rope  ', '    - [x] Fix lamp  ', ''].join('\n')
  const STYLES = ['# Nib test styles  ', '## A heading  ', '### A subheading  ', 'Plain, **bold**  ', '*Italic words*  ', '++Underlined words++  ', '~~Struck words~~  ', 'Literal *stars*, _underscores_, [brackets] and a #nibtag.  ', 'A link: https://example.com  ', '  ', 'After a blank line.  ', '```', 'mono line one', '  mono line two', '```', '> A quoted line  ', '> ', '> A second quoted line  ', '>   ', ''].join('\n')
  const TABLE = ['# Nib test table  ', '# Before the table.  ', '![nib-test-picture.png](Attachments/989D5515-6F65-4F34-B9F8-55223BDB4B70.png)  ', '', '| Day | High          |', '| --- | ------------- |', '| Mon | 07:40 \\| pipe |', '  ', ''].join('\n')
  // The shape of two the writer sent: lines one under another, a blank one between, and a paragraph that opens "3." and is no list.
  const PLAIN = ['# Harbour  ', '  ', 'Left the quay\tat seven.  ', 'Back by noon.  ', '  ', 'Then home.  ', ''].join('\n')
  const NUMBERED = ['3. Notes to self  ', 'Margin comments on a selection.  ', 'Tier: free.  ', '  ', '4. Read aloud  ', 'Nib reads the draft back.  ', ''].join('\n')

  const text = (node: JSONContent) => plainText({ type: 'doc', content: [node] })
  const blocks = (doc: Imported) => (doc.body.content ?? []).map((node) => [node.type, text(node)])
  const marked = (doc: Imported, type: string) => nodes(doc.body, 'text').filter((node) => node.marks?.some((mark) => mark.type === type)).map((node) => node.text)

  it('reads each line as a paragraph of its own, not one run into the next', async () => {
    const [doc] = (await read(file(PLAIN, 'Harbour.md'))).documents
    expect(doc.kind).toBe('note')
    expect(blocks(doc)).toEqual([['paragraph', 'Harbour'], ['paragraph', 'Left the quay at seven.'], ['paragraph', 'Back by noon.'], ['paragraph', 'Then home.']])
    expect(nodes(doc.body, 'hardBreak')).toEqual([])
  })

  it('keeps the paragraphs under a line that opens with a number out of it', async () => {
    const [doc] = (await read(file(NUMBERED, '3. Notes to self.md'))).documents
    expect(blocks(doc)).toEqual([
      ['orderedList', 'Notes to self'],
      ['paragraph', 'Margin comments on a selection.'],
      ['paragraph', 'Tier: free.'],
      ['orderedList', 'Read aloud'],
      ['paragraph', 'Nib reads the draft back.'],
    ])
    expect(nodes(doc.body, 'orderedList').map((list) => list.attrs?.start)).toEqual([3, 4])
  })

  it('reads its lists: numbered with one a step in, bullets and dashes apart, and a checklist with what is ticked', async () => {
    const [doc] = (await read(file(LISTS, 'Nib test lists.md'))).documents
    expect(doc.kind).toBe('note')
    expect(blocks(doc)).toEqual([
      ['paragraph', 'Nib test lists'],
      ['orderedList', 'First item\nSecond item\nThird item\nIndented item'],
      ['paragraph', 'A plain paragraph between the lists.'],
      // Each began a step in, in Notes: here they begin at the margin, and are no code.
      ['bulletList', 'Bullet one\nBullet two'],
      ['bulletList', 'Dash one\nDash two'],
      ['taskList', 'Buy rope\nFix lamp'],
    ])
    const [numbered, inner] = nodes(doc.body, 'orderedList')
    expect(numbered.content?.map((item) => item.content?.map((child) => child.type))).toEqual([['paragraph'], ['paragraph'], ['paragraph', 'orderedList']])
    expect(text(inner)).toBe('Indented item')
    expect(nodes(doc.body, 'taskItem').map((item) => item.attrs?.checked)).toEqual([false, true])
    expect(nodes(doc.body, 'codeBlock')).toEqual([])
  })

  it('reads its styles: title, heading and subheading, bold, italic, underlined and struck, a monostyled block and a quotation', async () => {
    const [doc] = (await read(file(STYLES, 'Nib test styles.md'))).documents
    expect(doc.kind).toBe('page')
    expect(nodes(doc.body, 'heading').map((node) => [node.attrs?.level, text(node)])).toEqual([[1, 'Nib test styles'], [2, 'A heading'], [3, 'A subheading']])
    expect(marked(doc, 'bold')).toEqual(['bold'])
    expect(marked(doc, 'underline')).toEqual(['Underlined words'])
    expect(marked(doc, 'strike')).toEqual(['Struck words'])
    expect(marked(doc, 'link')).toEqual(['https://example.com'])
    // Notes writes a star typed as a star the way it writes italics: the two can't be told apart.
    expect(marked(doc, 'italic')).toEqual(['Italic words', 'stars', 'underscores'])
    expect(nodes(doc.body, 'codeBlock').map(text)).toEqual(['mono line one\n  mono line two\n'])
    expect(nodes(doc.body, 'blockquote').map((quote) => quote.content?.map(text))).toEqual([['A quoted line', 'A second quoted line']])
    expect(blocks(doc).slice(3, 10).map(([type]) => type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph'])
  })

  it('reads its table, a bar in a cell and all, and says where the picture was when the file comes alone', async () => {
    const [doc] = (await read(file(TABLE, 'Nib test table.md'))).documents
    expect(doc.kind).toBe('page')
    expect(nodes(doc.body, 'tableHeader').map(text)).toEqual(['Day', 'High'])
    expect(nodes(doc.body, 'tableCell').map(text)).toEqual(['Mon', '07:40 | pipe'])
    expect(lines(doc)).toContain('![nib-test-picture.png](Attachments/989D5515-6F65-4F34-B9F8-55223BDB4B70.png)')
  })

  it('brings the picture in from the folder Notes exports, zipped, and each note of several', async () => {
    const { documents, skipped } = await read(
      zip({
        'Nib test table/Nib test table.md': TABLE,
        'Nib test table/Attachments/989D5515-6F65-4F34-B9F8-55223BDB4B70.png': bytesOf(RED),
        'Nib test lists/Nib test lists.md': LISTS,
      }),
    )
    expect(skipped).toEqual([])
    expect(documents.map((doc) => [doc.kind, lines(doc)[0]])).toEqual([['page', 'Nib test table'], ['note', 'Nib test lists']])
    expect(images(documents[0])).toEqual([`data:image/png;base64,${RED}`])
    expect(nodes(documents[1].body, 'taskItem')).toHaveLength(2)
  })

  it('leaves Markdown from anywhere else as it was read before', async () => {
    // Two spaces end some lines, not all: a line break someone meant.
    const [doc] = (await read(file('Roses are red,  \nviolets are blue.\n\nC++ and ++x++ stay.', 'poem.md'))).documents
    expect(blocks(doc)).toEqual([['paragraph', 'Roses are red,\nviolets are blue.'], ['paragraph', 'C++ and ++x++ stay.']])
    expect(nodes(doc.body, 'hardBreak')).toHaveLength(1)
  })

  it('underlines only words between its pluses', async () => {
    const [doc] = (await read(file('C++ and C++ are not ++underlined++, nor `++code++`.  \n', 'plus.md'))).documents
    expect(marked(doc, 'underline')).toEqual(['underlined'])
    expect(lines(doc)).toEqual(['C++ and C++ are not underlined, nor ++code++.'])
  })
})

describe('Google Keep', () => {
  // As Google Takeout writes a note (takeout.google.com, Keep): one JSON file each, with an HTML copy of it beside it, the
  // pictures there too, a list of the labels, and Takeout's own index a folder up. The shapes are those of public sample
  // exports (the open-source importers' test data, read 2026-11-11); the notes are written for this.
  const SPAN = (style: string, text: string) => `<span style="font-size:7.2pt;font-family:'Google Sans';${style}">${text}</span>`
  const P = (inner: string) => `<p dir="ltr" style="line-height:1.38;margin-top:0.0pt;margin-bottom:0.0pt;">${inner}</p>`
  const PLAIN = 'font-weight:400;font-style:normal;text-decoration:none;'
  const marked = (doc: Imported, type: string) => nodes(doc.body, 'text').filter((node) => node.marks?.some((mark) => mark.type === type)).map((node) => node.text)
  const keep = (note: Record<string, unknown>) =>
    JSON.stringify({ color: 'DEFAULT', isTrashed: false, isPinned: false, isArchived: false, title: '', userEditedTimestampUsec: 1711987269581000, createdTimestampUsec: 1711987246954000, ...note })
  const COPY = '<!DOCTYPE html><html><head><title>Tides</title></head><body><div class="note"><div class="heading">Apr 1, 2024</div><div class="title">Tides</div><div class="content">High at 07:40.</div></div></body></html>'
  const takeout = (entries: Record<string, string | Uint8Array>, folder = 'Keep') =>
    zip({ 'Takeout/archive_browser.html': '<html><body><h1>Archive</h1><p>Keep: 3 files</p></body></html>', [`Takeout/${folder}/Labels.txt`]: 'harbour\nboats\n', ...Object.fromEntries(Object.entries(entries).map(([name, value]) => [`Takeout/${folder}/${name}`, value])) }, 'takeout-20260101T000000Z-001.zip')

  it('reads a Takeout zip: each note once, from its JSON, and not again from the copy beside it, the list of labels or Takeout’s own index', async () => {
    const { documents, skipped } = await read(takeout({ 'Tides.json': keep({ title: 'Tides', textContent: 'High at 07:40.\n\nLow at 13:55.', isPinned: true }), 'Tides.html': COPY }))
    expect(skipped).toEqual([])
    expect(documents).toHaveLength(1)
    const [doc] = documents
    expect(doc.kind).toBe('note')
    expect(lines(doc)).toEqual(['Tides', 'High at 07:40.', '', 'Low at 13:55.'])
    // Keep counts in millionths of a second.
    expect(doc.createdAt).toBe(1711987246954)
    expect(doc.updatedAt).toBe(1711987269581)
    expect(doc.pinned).toBe(true)
    expect(doc.archived).toBeUndefined()
  })

  it('reads it whatever language named the folder, as Takeout does for an account in German', async () => {
    const { documents, skipped } = await read(
      zip({ 'Takeout/Archiv_Übersicht.html': '<html><body>Archiv</body></html>', 'Takeout/Google Notizen/Labels.txt': 'hafen\n', 'Takeout/Google Notizen/Gezeiten.json': keep({ title: 'Gezeiten', textContent: 'Hochwasser um 07:40.' }), 'Takeout/Google Notizen/Gezeiten.html': COPY }),
    )
    expect(skipped).toEqual([])
    expect(documents.map(lines)).toEqual([['Gezeiten', 'Hochwasser um 07:40.']])
  })

  it('leaves another zip’s pages and text alone: only beside a Keep note is an HTML file its copy, and Labels.txt a list', async () => {
    const { documents } = await read(zip({ 'Notes/Labels.txt': 'A note about labels.', 'Notes/Tides.html': '<p>A page about tides.</p>', 'index.html': '<p>An index someone wrote.</p>' }))
    expect(documents.map((doc) => plainText(doc.body)).sort()).toEqual(['A note about labels.', 'A page about tides.', 'An index someone wrote.'])
  })

  it('drops only Takeout’s own index: a page elsewhere in the zip, or above a Keep folder that isn’t Takeout’s, still comes in', async () => {
    const tides = keep({ title: 'Tides', textContent: 'High at 07:40.' })
    const texts = async (input: File) => (await read(input)).documents.map((doc) => plainText(doc.body)).sort()
    expect(await texts(zip({ 'Takeout/archive_browser.html': '<p>Index</p>', 'Takeout/Keep/Tides.json': tides, 'Takeout/Other/Letter.html': '<p>A letter.</p>' }))).toEqual(['A letter.', 'Tides\nHigh at 07:40.'])
    expect(await texts(zip({ 'Mine/About.html': '<p>About these.</p>', 'Mine/Keep/Tides.json': tides }))).toEqual(['About these.', 'Tides\nHigh at 07:40.'])
  })

  it('makes a checklist of a list, ticked where it was', async () => {
    const { documents } = await read(takeout({ 'Shopping.json': keep({ title: 'Shopping', listContent: [{ text: 'Rope', isChecked: false }, { text: 'Lamp oil', isChecked: true }, { text: 'Charts', isChecked: false }] }) }))
    const [doc] = documents
    expect(doc.kind).toBe('note')
    expect(lines(doc)).toEqual(['Shopping', 'Rope', 'Lamp oil', 'Charts'])
    expect(nodes(doc.body, 'taskList')).toHaveLength(1)
    expect(nodes(doc.body, 'taskItem').map((item) => [plainText({ type: 'doc', content: [item] }), item.attrs?.checked])).toEqual([['Rope', false], ['Lamp oil', true], ['Charts', false]])
  })

  it('keeps bold, italics and underlining, in a note’s words and in a checklist’s', async () => {
    const html = P(SPAN('font-weight:700;font-style:normal;text-decoration:none;', 'Bold') + SPAN(PLAIN, ' and ') + SPAN('font-weight:400;font-style:italic;text-decoration:none;', 'italic') + SPAN(PLAIN, ' plus ') + SPAN('font-weight:400;font-style:normal;text-decoration:underline;', 'underline'))
    const { documents } = await read(
      takeout({
        'Styles.json': keep({ title: 'Styles', textContent: 'Bold and italic plus underline', textContentHtml: html }),
        'List.json': keep({ title: 'List', listContent: [{ text: 'rich item', textHtml: P(SPAN('font-weight:700;font-style:normal;text-decoration:none;', 'rich item')), isChecked: false }, { text: 'done item', textHtml: P(SPAN('font-weight:400;font-style:italic;text-decoration:none;', 'done item')), isChecked: true }] }),
      }),
    )
    const styles = documents.find((doc) => lines(doc)[0] === 'Styles')!
    expect(styles.kind).toBe('note')
    expect(lines(styles)).toEqual(['Styles', 'Bold and italic plus underline'])
    expect(marked(styles, 'bold')).toEqual(['Bold'])
    expect(marked(styles, 'italic')).toEqual(['italic'])
    expect(marked(styles, 'underline')).toEqual(['underline'])
    const list = documents.find((doc) => lines(doc)[0] === 'List')!
    expect(marked(list, 'bold')).toEqual(['rich item'])
    expect(marked(list, 'italic')).toEqual(['done item'])
    expect(nodes(list.body, 'taskItem').map((item) => item.attrs?.checked)).toEqual([false, true])
  })

  it('makes a page of a note with headings, which a note of Nib’s has none of, and doesn’t embolden a heading twice', async () => {
    const html = `<h1 dir="ltr">${SPAN('font-weight:700;font-style:normal;text-decoration:none;', 'Spring tides')}</h1>` + P(SPAN(PLAIN, 'After the new moon.'))
    const { documents } = await read(takeout({ 'Tides.json': keep({ title: 'Tides', textContent: 'Spring tides\nAfter the new moon.', textContentHtml: html }) }))
    const [doc] = documents
    expect(doc.kind).toBe('page')
    expect(headings(doc)).toEqual(['Tides', 'Spring tides'])
    expect(marked(doc, 'bold')).toEqual([])
  })

  it('brings a note’s pictures in under its words, found beside it even where the JSON says .jpeg of a .jpg', async () => {
    const { documents, skipped } = await read(
      takeout({
        'Harbour.json': keep({ title: 'Harbour', textContent: 'The north quay.', attachments: [{ filePath: '1629964333125.746683646.jpeg', mimetype: 'image/jpeg' }, { filePath: '1629964295873.139657380.png', mimetype: 'image/png' }] }),
        '1629964333125.746683646.jpg': bytesOf(RED),
        '1629964295873.139657380.png': bytesOf(GREY),
      }),
    )
    expect(skipped).toEqual([])
    const [doc] = documents
    expect(lines(doc).slice(0, 2)).toEqual(['Harbour', 'The north quay.'])
    expect(images(doc)).toEqual([`data:image/jpeg;base64,${RED}`, `data:image/png;base64,${GREY}`])
  })

  it('opens a note that is only a picture with no empty line where its words would be, and ends no note’s words with one', async () => {
    const { documents } = await read(
      takeout({ 'Screenshot.json': keep({ title: 'Screenshot', textContent: '', attachments: [{ filePath: 'shot.png', mimetype: 'image/png' }] }), 'shot.png': bytesOf(GREY), 'Ends.json': keep({ title: 'Ends', textContent: 'content\n' }) }),
    )
    const called = (title: string) => documents.find((doc) => lines(doc)[0] === title)!
    expect(called('Screenshot').body.content!.map((block) => block.content?.[0]?.type)).toEqual(['text', 'image'])
    expect(lines(called('Ends'))).toEqual(['Ends', 'content'])
  })

  it('adds a link Keep kept with a note under its words, by the page’s name, unless the words hold its address already', async () => {
    const annotations = [
      { description: '', source: 'WEBLINK', title: 'Tide tables for the north harbour', url: 'https://example.com/tides' },
      { description: '', source: 'WEBLINK', title: 'Ferry times', url: 'https://example.com/ferry' },
      { description: '', source: 'WEBLINK', title: 'Not the web', url: 'javascript:alert(1)' },
    ]
    const { documents } = await read(takeout({ 'Links.json': keep({ title: 'Links', textContent: 'See https://example.com/ferry for the boat.', annotations }) }))
    const [doc] = documents
    expect(lines(doc)).toEqual(['Links', 'See https://example.com/ferry for the boat.', 'Tide tables for the north harbour'])
    const linked = nodes(doc.body, 'text').filter((node) => node.marks?.some((mark) => mark.type === 'link'))
    expect(linked.map((node) => [node.text, node.marks!.find((mark) => mark.type === 'link')!.attrs!.href])).toContainEqual(['Tide tables for the north harbour', 'https://example.com/tides'])
    expect(JSON.stringify(doc.body)).not.toContain('javascript:')
  })

  it('leaves out what’s in Keep’s trash and says so once, its copy and its picture with it', async () => {
    const { documents, skipped } = await read(
      takeout({
        'Tides.json': keep({ title: 'Tides', textContent: 'High at 07:40.' }),
        'Old.json': keep({ title: 'Old', textContent: 'Thrown away.', isTrashed: true, attachments: [{ filePath: 'old.png', mimetype: 'image/png' }] }),
        'Old.html': COPY,
        'old.png': bytesOf(GREY),
        'Older.json': keep({ title: 'Older', textContent: 'Thrown away before.', isTrashed: true }),
      }),
    )
    expect(documents.map((doc) => lines(doc)[0])).toEqual(['Tides'])
    expect(skipped).toEqual(['2 notes in Keep’s trash'])
  })

  it('says a voice recording was left out, once, and not again as a file it can’t read', async () => {
    const { documents, skipped } = await read(
      takeout({ 'Memo.json': keep({ title: 'Memo', textContent: 'Said on the quay.', attachments: [{ filePath: '1690859067849.259766.1353747803.3gp', mimetype: 'audio/3gp' }] }), '1690859067849.259766.1353747803.3gp': new Uint8Array([0, 0, 0, 24]) }),
    )
    expect(documents.map(lines)).toEqual([['Memo', 'Said on the quay.']])
    expect(skipped).toEqual(['1 voice recording from Keep'])
  })

  it('says which notes were archived and what labels each had, for whoever keeps them', async () => {
    const { documents } = await read(
      takeout({ 'Tides.json': keep({ title: 'Tides', textContent: 'High at 07:40.', isArchived: true, labels: [{ name: 'harbour' }, { name: 'boats' }] }), 'Plain.json': keep({ title: 'Plain', textContent: 'No labels.' }) }),
    )
    const tides = documents.find((doc) => lines(doc)[0] === 'Tides')!
    expect(tides.archived).toBe(true)
    expect(tides.tags).toEqual(['harbour', 'boats'])
    expect(tides.filing).toBe('Keep’s labels')
    const plain = documents.find((doc) => lines(doc)[0] === 'Plain')!
    expect(plain.archived).toBeUndefined()
    expect(plain.tags).toEqual([])
  })

  it('takes an older note, which has no time it was made, by the time it was last changed; and a title of two lines as one', async () => {
    const { documents } = await read(takeout({ 'Old.json': JSON.stringify({ color: 'RED', isTrashed: false, isPinned: false, isArchived: false, textContent: 'hello world', title: 'Old\nnote', userEditedTimestampUsec: 1629964207042000 }) }))
    const [doc] = documents
    expect(lines(doc)).toEqual(['Old note', 'hello world'])
    expect(doc.createdAt).toBe(1629964207042)
    expect(doc.updatedAt).toBe(1629964207042)
  })

  it('reads one note’s JSON picked by itself', async () => {
    const { documents, skipped } = await read(file(keep({ title: 'Tides', textContent: 'High at 07:40.' }), 'Tides.json'))
    expect(skipped).toEqual([])
    expect(documents.map(lines)).toEqual([['Tides', 'High at 07:40.']])
  })

  it('counts an empty note as empty, and JSON that only looks a little like Keep’s as no format it reads', async () => {
    expect((await read(takeout({ 'Empty.json': keep({ textContent: '' }) }))).skipped).toEqual(['1 empty note'])
    expect((await read(file(JSON.stringify({ title: 'Tides', textContent: 'High at 07:40.' }), 'tides.json'))).skipped).toEqual(['tides.json: not a format Nib reads'])
  })

  // Takeout's other form: the same files in a gzipped tar, each after a record of its own (a public sample's shape, read 2026-11-11).
  const tgz = (files: TarFile[], name = 'takeout-20260101T000000Z-001.tgz') => file(gzipSync(tarOf(files)), name)
  const pax = { mtime: '1711987187.1550000' }

  it('reads Takeout’s .tgz as it reads its zip: the note once, its picture, and not the copy, the labels or the index', async () => {
    const { documents, skipped } = await read(
      tgz([
        { name: 'Takeout/Google Notizen/Labels.txt', data: 'hafen\n', pax },
        { name: 'Takeout/Google Notizen/Gezeiten.json', data: keep({ title: 'Gezeiten', textContent: 'Hochwasser um 07:40.', attachments: [{ filePath: 'bild.png', mimetype: 'image/png' }], labels: [{ name: 'hafen' }] }), pax },
        { name: 'Takeout/Google Notizen/Gezeiten.html', data: COPY, pax },
        { name: 'Takeout/Google Notizen/bild.png', data: bytesOf(GREY), pax },
        { name: 'Takeout/Archiv_Übersicht.html', data: '<html><body>Archiv</body></html>', pax },
      ]),
    )
    expect(skipped).toEqual([])
    expect(documents).toHaveLength(1)
    expect(lines(documents[0]).slice(0, 2)).toEqual(['Gezeiten', 'Hochwasser um 07:40.'])
    expect(images(documents[0])).toEqual([`data:image/png;base64,${GREY}`])
    expect(documents[0].tags).toEqual(['hafen'])
  })

  it('leaves a picture too large to keep where it is in a .tgz, and says so, as for a zip', async () => {
    const { documents, skipped } = await read(
      tgz([{ name: 'Takeout/Keep/Big.json', data: keep({ title: 'Big', textContent: 'A photo.', attachments: [{ filePath: 'big.png', mimetype: 'image/png' }] }) }, { name: 'Takeout/Keep/big.png', data: new Uint8Array(MAX_BYTES + 1) }]),
    )
    expect(lines(documents[0])).toEqual(['Big', 'A photo.', '[picture not imported: too large]'])
    expect(skipped).toEqual(['1 picture too large to import'])
  })

  it('refuses a .tgz that says it unpacks to more than Nib will, one that holds more than it says, and one that isn’t a gzipped tar', async () => {
    const good = gzipSync(tarOf([{ name: 'Takeout/Keep/Tides.json', data: keep({ title: 'Tides', textContent: 'High at 07:40.' }) }]))
    const saying = (size: number) => {
      const forged = good.slice()
      new DataView(forged.buffer).setUint32(forged.length - 4, size, true)
      return file(forged, 'takeout.tgz')
    }
    expect(await read(saying(128 * 1024 * 1024 + 1))).toEqual({ documents: [], skipped: ['takeout.tgz: more than 128 MB to unpack, too large to open'] })
    expect(await read(saying(600))).toEqual({ documents: [], skipped: ['takeout.tgz: couldn’t be opened'] })
    expect(await read(file('Not an archive at all.', 'takeout.tgz'))).toEqual({ documents: [], skipped: ['takeout.tgz: couldn’t be opened'] })
    expect(await read(file(gzipSync(strToU8('Words, gzipped, and no tar. '.repeat(40))), 'takeout.tgz'))).toEqual({ documents: [], skipped: ['takeout.tgz: couldn’t be opened'] })
    expect((await read(file(good, 'takeout.tgz'))).documents).toHaveLength(1)
  })

  it('reads a tar made from inside its folder, which names every file from ./', async () => {
    const { documents, skipped } = await read(tgz([{ name: './Keep/Tides.json', data: keep({ title: 'Tides', textContent: 'High at 07:40.' }) }, { name: './Keep/Tides.html', data: COPY }]))
    expect(skipped).toEqual([])
    expect(documents.map(lines)).toEqual([['Tides', 'High at 07:40.']])
  })

  it('refuses a .tgz of more than 10,000 files', async () => {
    const files = Array.from({ length: 10_001 }, (_, i) => ({ name: `Takeout/Keep/${i}.bin` }))
    expect(await read(tgz(files, 'takeout.tgz'))).toEqual({ documents: [], skipped: ['takeout.tgz: more than 10,000 files, too many to open'] })
    // And of more records than that many files could come with, whatever they are.
    const folders = Array.from({ length: 20_001 }, (_, i) => ({ name: `d${i}/`, type: '5' }))
    expect(await read(tgz(folders, 'takeout.tgz'))).toEqual({ documents: [], skipped: ['takeout.tgz: more than 10,000 files, too many to open'] })
  })

  it('runs nothing a note’s HTML carries', async () => {
    const { documents } = await read(takeout({ 'Bad.json': keep({ title: 'Bad', textContent: 'Words', textContentHtml: '<p>Words<script>globalThis.keepRan = true</script><img src="x" onerror="globalThis.keepRan = true"></p>' }) }))
    // A picture Nib can't keep is left as words that say where it was (lib/import).
    expect(lines(documents[0])).toEqual(['Bad', 'Words![](x)'])
    expect((globalThis as { keepRan?: boolean }).keepRan).toBeUndefined()
    expect(JSON.stringify(documents[0].body)).not.toContain('keepRan')
  })
})

describe('Joplin', () => {
  // Joplin's own export (File, Export all, JEX): a tar of one `.md` file an item, named by its id. A note is its title, a
  // blank line, its Markdown, a blank line, then what Joplin knows of it, a line a field; a notebook, a tag, a tag put on
  // a note and a file are items too, told apart by `type_`. Shapes from public sample exports (read 2026-11-11).
  const id = (n: number) => n.toString(16).padStart(32, '0')
  const [BOOK, NESTED, TAG, PICTURE, PDF] = [101, 102, 103, 104, 105].map(id)
  const fields = (props: Record<string, string | number>) => Object.entries(props).map(([key, value]) => `${key}: ${value}`).join('\n')
  const item = (own: string, lead: string, props: Record<string, string | number>): TarFile => ({ name: `${own}.md`, data: `${lead}${lead ? '\n\n' : ''}${fields({ id: own, ...props })}` })
  const note = (n: number, title: string, body: string, props: Record<string, string | number> = {}) =>
    item(id(n), `${title}\n\n${body}`, {
      parent_id: BOOK,
      created_time: '2024-04-28T21:53:13.438Z',
      updated_time: '2024-09-29T11:43:09.475Z',
      is_conflict: 0,
      is_todo: 0,
      todo_due: 0,
      todo_completed: 0,
      source: 'joplin-desktop',
      user_created_time: '2024-04-13T16:23:00.000Z',
      user_updated_time: '2024-09-29T11:39:00.000Z',
      encryption_cipher_text: '',
      encryption_applied: 0,
      markup_language: 1,
      deleted_time: 0,
      ...props,
      type_: 1,
    })
  const notebook = (own: string, title: string, parent = '') => item(own, title, { created_time: '2024-04-28T21:53:13.647Z', parent_id: parent, deleted_time: 0, type_: 2 })
  const tag = item(TAG, 'harbour', { created_time: '2024-09-16T16:03:03.250Z', parent_id: '', type_: 5 })
  const tagged = (n: number, on: number) => item(id(n), '', { note_id: id(on), tag_id: TAG, type_: 6 })
  const resource = (own: string, title: string, mime: string, extension: string, data: Uint8Array): TarFile[] => [item(own, title, { mime, filename: '', file_extension: extension, size: data.length, type_: 4 }), { name: `resources/${own}.${extension}`, data }]
  const jex = (files: TarFile[], name = 'export.jex') => file(tarOf(files), name)
  const called = (documents: Imported[], title: string) => documents.find((doc) => lines(doc)[0] === title)!

  it('reads a Joplin export: each note with its title, its Markdown, and the dates Joplin shows for it', async () => {
    const { documents, skipped } = await read(jex([notebook(BOOK, 'My Notebook'), note(1, 'Tides', 'High at **07:40**.\n\n- Spring\n- Neap'), note(2, 'Ferry', 'Weekdays at seven.')]))
    expect(skipped).toEqual([])
    expect(documents).toHaveLength(2)
    const tides = called(documents, 'Tides')
    expect(tides.kind).toBe('note')
    expect(lines(tides)).toEqual(['Tides', 'High at 07:40.', 'Spring', 'Neap'])
    expect(nodes(tides.body, 'bulletList')).toHaveLength(1)
    // The dates a person sees and can set in Joplin, not when it last synced the note.
    expect(tides.createdAt).toBe(Date.parse('2024-04-13T16:23:00.000Z'))
    expect(tides.updatedAt).toBe(Date.parse('2024-09-29T11:39:00.000Z'))
  })

  it('says which notebook each note is in, the one it’s directly in, and its tags, for whoever keeps them', async () => {
    const { documents } = await read(jex([notebook(BOOK, 'My Notebook'), notebook(NESTED, 'Nested Notebook', BOOK), tag, tagged(50, 1), note(1, 'Tides', 'High.', { parent_id: NESTED }), note(2, 'Ferry', 'At seven.'), note(3, 'Loose', 'In no notebook.', { parent_id: '' })]))
    expect(called(documents, 'Tides')).toMatchObject({ folder: 'Nested Notebook', tags: ['harbour'], filing: 'Joplin’s notebooks and tags' })
    expect(called(documents, 'Ferry')).toMatchObject({ folder: 'My Notebook', tags: [] })
    expect(called(documents, 'Loose').folder).toBeUndefined()
  })

  it('brings in the pictures a note shows, from the export’s resources, written as Markdown or as HTML', async () => {
    const { documents, skipped } = await read(jex([note(1, 'Harbour', `The quay:\n\n![quay.png](:/${PICTURE})\n\n<img src=":/${PICTURE}" width="50"/>`), ...resource(PICTURE, 'quay.png', 'image/png', 'png', bytesOf(RED))]))
    expect(skipped).toEqual([])
    expect(images(documents[0])).toEqual([`data:image/png;base64,${RED}`, `data:image/png;base64,${RED}`])
  })

  it('writes a link to another note as one by its title, and a link to a file it can’t bring in as its words, counted', async () => {
    const { documents, skipped } = await read(
      jex([
        note(1, 'Log', `See [the tides](:/${id(2)}), [Tides](:/${id(2)}), [high|low](:/${id(2)}), [gone](:/${id(99)}) and [manual.pdf](:/${PDF}). Also [the web](https://example.com/).`),
        note(2, 'Tides', 'High.'),
        note(3, 'A [odd] title', 'Odd.'),
        note(4, 'Other', `To [odd](:/${id(3)}).`),
        ...resource(PDF, 'manual.pdf', 'application/pdf', 'pdf', new Uint8Array([37, 80, 68, 70])),
      ]),
    )
    // Words that hold the link's own marks aren't put in it.
    expect(lines(called(documents, 'Log'))).toEqual(['Log', 'See [[Tides|the tides]], [[Tides]], [[Tides]], gone and manual.pdf. Also the web.'])
    // A title that would break the link's own brackets is left as the words it was shown by.
    expect(lines(called(documents, 'Other'))).toEqual(['Other', 'To odd.'])
    expect(skipped).toEqual(['1 file attached in Joplin'])
    const web = nodes(called(documents, 'Log').body, 'text').find((node) => node.text === 'the web')!
    expect(web.marks?.[0]).toMatchObject({ type: 'link', attrs: { href: 'https://example.com/' } })
  })

  it('reads a note Joplin keeps as HTML, as a clipped web page is', async () => {
    // Set out as a page's HTML is, which read as Markdown would make code of the indented lines.
    const { documents } = await read(jex([note(1, 'Clipped', '<div>\n\n    <p>Rich <b>words</b> here.</p>\n\n    <p>More.</p>\n\n</div>', { markup_language: 2 })]))
    expect(lines(documents[0])).toEqual(['Clipped', 'Rich words here.', 'More.'])
    expect(nodes(documents[0].body, 'codeBlock')).toEqual([])
    expect(nodes(documents[0].body, 'text').filter((node) => node.marks?.some((mark) => mark.type === 'bold')).map((node) => node.text)).toEqual(['words'])
  })

  it('leaves out what’s in Joplin’s trash and what it encrypted, counted, and says a to-do came in without its tick', async () => {
    const { documents, skipped } = await read(
      jex([note(1, 'Kept', 'Here.'), note(2, 'Binned', 'Gone.', { deleted_time: 1714341193438 }), note(3, '', '', { encryption_applied: 1, encryption_cipher_text: 'JED01000…' }), note(4, 'Buy rope', 'From the chandler.', { is_todo: 1, todo_completed: 1713025684000 }), note(5, 'Fix lamp', '', { is_todo: 1 })]),
    )
    expect(documents.map((doc) => lines(doc)[0]).sort()).toEqual(['Buy rope', 'Fix lamp', 'Kept'])
    expect(skipped.sort()).toEqual(['1 note encrypted by Joplin', '1 note in Joplin’s trash', 'The ticks on 2 to-dos from Joplin'])
  })

  it('takes a note’s words as they are: fields that look like Joplin’s, written in the note, are the note’s', async () => {
    const { documents } = await read(jex([note(1, 'Recipe', 'Flour.\n\ntype_: 2\nparent_id: none')]))
    expect(lines(documents[0])).toEqual(['Recipe', 'Flour.', 'type_: 2 parent_id: none'])
  })

  it('loses only the note it can’t read, and counts it', async () => {
    const parse = DOMParser.prototype.parseFromString
    DOMParser.prototype.parseFromString = function (this: DOMParser, text: string, type: DOMParserSupportedType) {
      if (text.includes('UNREADABLE')) throw new Error('No')
      return parse.call(this, text, type)
    }
    try {
      const { documents, skipped } = await read(jex([note(1, 'First', 'Here.'), note(2, 'Broken', 'UNREADABLE'), note(3, 'Last', 'Here too.')]))
      expect(documents.map((doc) => lines(doc)[0])).toEqual(['First', 'Last'])
      expect(skipped).toEqual(['1 note that couldn’t be read'])
    } finally {
      DOMParser.prototype.parseFromString = parse
    }
  })

  // Joplin's other export, a folder of Markdown (File, Export all, "MD - Markdown" or "MD - Markdown + Front Matter"),
  // zipped by its owner: a folder a notebook, a file a note, named by its title cut to fifty characters and made safe,
  // `_resources/` at the top for what notes hold, and a link to another note as the path to its file. Written from
  // Joplin's exporter (its source, read 2026-11-11), not by Joplin: there is no public sample of one.
  const front = (fields: string) => `---\n${fields}\n---\n\n`
  const DATES = 'updated: 2024-09-29 11:39:00Z\ncreated: 2024-04-13 16:23:00Z'

  it('reads a zipped Markdown export with front matter: the title Joplin wrote, its dates, its notebook and its tags, its picture, and its links', async () => {
    const { documents, skipped } = await read(
      zip({
        'Export/_resources/quay.png': bytesOf(RED),
        'Export/_resources/manual.pdf': '%PDF',
        'Export/_resources/attached.md': 'A Markdown file someone attached to a note: no note itself.',
        'Export/Harbour/Tides of the north harbour_ a long title that is.md': `${front(`title: 'Tides of the north harbour: a long title that is cut'\n${DATES}\nlatitude: 50.00000000\nlongitude: 30.00000000\naltitude: 0.0000\ntags:\n  - harbour\n  - two words`)}High at 07:40.\n\n![quay.png](../_resources/quay.png)`,
        'Export/Harbour/Boats/Ferry.md': `${front(`title: Ferry\n${DATES}`)}Weekdays at seven. See [the tides](../Tides%20of%20the%20north%20harbour_%20a%20long%20title%20that%20is.md), [manual.pdf](../../_resources/manual.pdf), [attached.md](../../_resources/attached.md), [gone](Gone.md) and [the web](https://example.com/).`,
        'Export/Harbour/Boats/_folder.yml': 'icon:\n  type: emoji\n  emoji: ⛵\n',
      }),
    )
    expect(documents).toHaveLength(2)
    const tides = called(documents, 'Tides of the north harbour: a long title that is cut')
    expect(tides).toMatchObject({ kind: 'note', folder: 'Harbour', tags: ['harbour', 'two words'], filing: 'Joplin’s notebooks and tags' })
    expect(tides.createdAt).toBe(Date.UTC(2024, 3, 13, 16, 23, 0))
    expect(tides.updatedAt).toBe(Date.UTC(2024, 8, 29, 11, 39, 0))
    expect(images(tides)).toEqual([`data:image/png;base64,${RED}`])
    expect(tides.vault).toBeUndefined()
    const ferry = called(documents, 'Ferry')
    expect(ferry).toMatchObject({ folder: 'Boats', tags: [] })
    expect(lines(ferry)).toEqual(['Ferry', 'Weekdays at seven. See [[Tides of the north harbour: a long title that is cut|the tides]], manual.pdf, attached.md, gone and the web.'])
    // Only the web's link is left a link: no path into the export, to a file or to a note that isn't there, is kept as one.
    expect(nodes(ferry.body, 'text').flatMap((node) => (node.marks ?? []).filter((mark) => mark.type === 'link').map((mark) => [node.text, mark.attrs?.href]))).toEqual([['the web', 'https://example.com/']])
    // The files a note holds that Nib doesn't bring in are said once, a Markdown one among them; a notebook's icon isn't a file of anyone's.
    expect(skipped).toEqual(['2 files attached in Joplin'])
  })

  it('reads a plain Markdown export, which holds nothing of a note but its words: its title is its file’s name', async () => {
    const plain = file(zipSync({ _resources: {}, Harbour: { 'Tides.md': strToU8('High at 07:40.\n\nSee [Ferry](../Boats/Ferry.md).'), 'Clipped.html': strToU8('<div><p>Rich <b>words</b>.</p></div>') }, Boats: { 'Ferry.md': strToU8('# Timetable\n\nWeekdays at seven.') } }), 'export.zip')
    const { documents, skipped } = await read(plain)
    expect(skipped).toEqual([])
    expect(lines(called(documents, 'Tides'))).toEqual(['Tides', 'High at 07:40.', 'See [[Ferry]].'])
    expect(called(documents, 'Tides')).toMatchObject({ folder: 'Harbour', tags: [] })
    // A heading of the note's own doesn't make its title: the file's name is that.
    expect(called(documents, 'Ferry')).toMatchObject({ kind: 'page', folder: 'Boats' })
    expect(headings(called(documents, 'Ferry'))).toEqual(['Ferry', 'Timetable'])
    expect(lines(called(documents, 'Clipped'))).toEqual(['Clipped', 'Rich words.'])
    expect(called(documents, 'Clipped').folder).toBe('Harbour')
  })

  it('reads a note kept as HTML past its front matter, and says a to-do came in without its tick', async () => {
    const { documents, skipped } = await read(
      zip({
        'Export/_resources/quay.png': bytesOf(RED),
        'Export/Harbour/Clipped.html': `${front(`title: A clipped page\n${DATES}\nsource: https://example.com/page`)}<div>\n\n    <p>Rich <b>words</b>.</p>\n\n</div>`,
        'Export/Harbour/Buy rope.md': `${front(`title: Buy rope\n${DATES}\ncompleted?: no`)}From the chandler.`,
        'Export/Harbour/Fix lamp.md': `${front(`title: Fix lamp\n${DATES}\ncompleted?: yes\ndue: 2024-04-20 09:00:00Z`)}`,
      }),
    )
    expect(lines(called(documents, 'A clipped page'))).toEqual(['A clipped page', 'Rich words.'])
    expect(nodes(called(documents, 'A clipped page').body, 'codeBlock')).toEqual([])
    expect(called(documents, 'A clipped page').createdAt).toBe(Date.UTC(2024, 3, 13, 16, 23, 0))
    expect(documents.map((doc) => lines(doc)[0]).sort()).toEqual(['A clipped page', 'Buy rope', 'Fix lamp'])
    expect(skipped).toEqual(['Export/_resources/quay.png: no note uses this picture', 'The ticks on 2 to-dos from Joplin'])
  })

  it('reads a zip of Markdown with no _resources folder as it always has, and a vault that holds one as a vault', async () => {
    const { documents } = await read(zip({ 'Harbour/Tides.md': 'High at 07:40.\n\nSee [Ferry](Ferry.md).', 'Harbour/Ferry.md': 'Weekdays at seven.' }))
    expect(documents.map((doc) => [lines(doc)[0], doc.folder, doc.filing])).toEqual([['High at 07:40.', undefined, undefined], ['Weekdays at seven.', undefined, undefined]])
    const vault = await read(zip({ 'Vault/.obsidian/app.json': '{}', 'Vault/_resources/quay.png': bytesOf(RED), 'Vault/Harbour/Tides.md': 'High at 07:40. #boats' }))
    expect(vault.documents[0]).toMatchObject({ vault: true, filing: 'The vault’s folders and tags', tags: ['boats'] })
  })

  it('says a .jex that is no tar couldn’t be opened, and one with no notes that there was nothing', async () => {
    expect(await read(file('Not a tar.', 'export.jex'))).toEqual({ documents: [], skipped: ['export.jex: couldn’t be opened'] })
    expect(await read(jex([notebook(BOOK, 'Empty notebook')]))).toEqual({ documents: [], skipped: ['export.jex: nothing to import'] })
  })
})

describe('UpNote', () => {
  // UpNote's HTML export (Export all notes, on a computer), zipped: a folder a space, in it a file a note named for its
  // title, a `Files` folder for what notes hold, a stylesheet, and `notebooks/<Notebook>/` listing each notebook's notes,
  // each a file of its note's name holding the path to it (or, written on Windows, a shortcut). A note's words are in
  // `div.shine-editor`, its title the first line of them. Shapes from public sample exports of 2026 (read 2026-11-11).
  const page = (inner: string) => `<head><title></title><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"></head><body class="light-theme blue_sky" style="padding: 20px;"><div class="shine-editor">${inner}</div></body>`
  const SPACE = 'UpNote_2026-06-18_11-59-39/General Space/'
  const exported = (entries: Record<string, string | Uint8Array>) => zip({ [`${SPACE}styles.css`]: '.shine-editor { color: black }', ...Object.fromEntries(Object.entries(entries).map(([name, value]) => [SPACE + name, value])) }, 'UpNote_2026-06-18_11-59-39.zip')
  const called = (documents: Imported[], title: string) => documents.find((doc) => lines(doc)[0] === title)!
  const marked = (doc: Imported, type: string) => nodes(doc.body, 'text').filter((node) => node.marks?.some((mark) => mark.type === type)).map((node) => node.text)

  it('reads an UpNote export: each note once, in the notebook the export lists it under, and not the lists themselves or the stylesheet', async () => {
    const { documents, skipped } = await read(
      exported({
        'Welcome to UpNote!.html': page('<h2>Welcome to UpNote!</h2><div>Thank you for choosing UpNote.</div><div><br></div><h3>Get started</h3><div>Write your first note.</div>'),
        'Plan.html': page('Plan<br><br>Line one<br>Line two'),
        'Loose.html': page('<div>Loose</div><div>In no notebook.</div>'),
        'notebooks/Get Started/Welcome to UpNote!.html': '../../Welcome to UpNote!.html',
        'notebooks/Work/Plans/Plan.html': '../../../Plan.html',
        'notebooks/Later/Plan.html': '../../Plan.html',
      }),
    )
    expect(skipped).toEqual([])
    expect(documents).toHaveLength(3)
    const welcome = called(documents, 'Welcome to UpNote!')
    expect(welcome).toMatchObject({ kind: 'page', folder: 'Get Started', tags: [], filing: 'UpNote’s notebooks and tags' })
    expect(headings(welcome)).toEqual(['Welcome to UpNote!', 'Get started'])
    // The notebook a note is directly in; and of two it is in, the first the export lists.
    expect(called(documents, 'Plan')).toMatchObject({ kind: 'note', folder: 'Plans' })
    expect(lines(called(documents, 'Plan'))).toEqual(['Plan', '', 'Line one', 'Line two'])
    expect(called(documents, 'Loose').folder).toBeUndefined()
  })

  it('reads the notebooks of an export written on Windows, where each is a shortcut', async () => {
    const { documents, skipped } = await read(exported({ 'Plan.html': page('Plan<br><br>Line one'), 'notebooks/Get Started/Plan.html.lnk': new Uint8Array([0x4c, 0, 0, 0, 1, 0x14, 2, 0]) }))
    expect(skipped).toEqual([])
    expect(documents.map((doc) => [lines(doc)[0], doc.folder])).toEqual([['Plan', 'Get Started']])
  })

  it('takes only a list’s own files for one: a page in a folder called notebooks, of its own words, still comes in', async () => {
    const { documents, skipped } = await read(zip({ 'Site/Plan.html': '<p>The plan.</p>', 'Site/notebooks/Paper/Plan.html': '<p>A page about paper notebooks.</p>', 'Site/styles.css': 'p {}' }))
    expect(documents.map((doc) => plainText(doc.body)).sort()).toEqual(['A page about paper notebooks.', 'The plan.'])
    expect(documents.every((doc) => doc.folder === undefined)).toBe(true)
    // And only beside UpNote's notes is a stylesheet theirs: this one is said to be left, as it always was.
    expect(skipped).toEqual(['Site/styles.css: not a format Nib reads'])
  })

  it('makes a checklist of a list UpNote ticks, and puts a list inside the item it is under', async () => {
    const { documents } = await read(
      exported({
        'Lists.html': page(
          '<div>Lists</div><ul><li data-checked="false">Rope</li><li data-checked="true">Lamp <b>oil</b></li></ul><ul><li>Use multi-level lists like this:</li><ul><li>Inner one</li><li>Inner two</li></ul><li>Last</li></ul><ol><li>First</li><li>Second</li></ol><ul><ul><li>Under nothing</li></ul></ul>',
        ),
      }),
    )
    const [doc] = documents
    expect(plainText(doc.body)).toContain('Under nothing')
    expect(nodes(doc.body, 'taskItem').map((item) => [plainText({ type: 'doc', content: [item] }), item.attrs?.checked])).toEqual([['Rope', false], ['Lamp oil', true]])
    const [outer] = nodes(doc.body, 'bulletList')
    expect(outer.content!.map((item) => plainText({ type: 'doc', content: [item] }).split('\n'))).toEqual([['Use multi-level lists like this:', 'Inner one', 'Inner two'], ['Last']])
    expect(nodes(outer.content![0], 'bulletList')).toHaveLength(1)
    expect(nodes(doc.body, 'orderedList')).toHaveLength(1)
  })

  it('keeps a highlight of any colour as a highlight, a formula as one, and bold, italics, underlining and struck words', async () => {
    const { documents } = await read(
      exported({
        'Styles.html': page(
          '<div>Styles</div><div><b><span class="shine-text-blue">bold</span></b>, <i>italic</i>, <u>underline</u>, <strike>struck</strike>, <span class="shine-highlight-orange">orange</span> and <span class="shine-highlight">green</span>.</div><div><span data-formula-width-em="10.375" data-upnote-formula="x=\\frac{-b}{2a}" data-non-editable="true">x=\\frac{-b}{2a}</span></div>',
        ),
      }),
    )
    const [doc] = documents
    expect([marked(doc, 'bold'), marked(doc, 'italic'), marked(doc, 'underline'), marked(doc, 'strike')]).toEqual([['bold'], ['italic'], ['underline'], ['struck']])
    expect(marked(doc, 'highlight')).toEqual(['orange', 'green'])
    expect(nodes(doc.body, 'mathInline').map((node) => plainText({ type: 'doc', content: [{ type: 'paragraph', content: [node] }] }))).toEqual(['x=\\frac{-b}{2a}'])
  })

  it('takes a note’s hashtags as its tags, each once, and leaves them in its words as words', async () => {
    const tag = (name: string) => `<a title="#${name}" data-upnote-tag="#${name}" spellcheck="false" data-non-editable="true" href="upnote://x-callback-url/tag/view?tag=${name}">#${name}</a>`
    const { documents } = await read(exported({ 'Tagged.html': page(`<div>Tagged</div><div>Type a hash to add ${tag('UpNote')} and ${tag('boats')}, or ${tag('UpNote')} again.</div>`) }))
    const [doc] = documents
    expect(doc.tags).toEqual(['UpNote', 'boats'])
    expect(lines(doc)).toEqual(['Tagged', 'Type a hash to add #UpNote and #boats, or #UpNote again.'])
    expect(JSON.stringify(doc.body)).not.toContain('upnote://')
  })

  it('writes a link to another note as one by that note’s first line, whatever its file had to be called, and one to a note that isn’t there as its words', async () => {
    const link = (href: string, shown: string) => `<a href="${href}" data-note-id="019ecc37-3356-7452-a9f8-107ca6d2bff6">${shown}</a>`
    const { documents } = await read(
      exported({
        'Log.html': page(`<div>Log</div><div>See ${link('What%20next_.html', 'What next?')}, ${link('What%20next_.html', 'the plan')} and ${link('Gone.html', 'a note that went')}. Also <a href="https://example.com/">the web</a>, ${link('Plan.html', 'Plan')}, ${link('Files/chart.png', 'a picture')} and ${link('https://example.com/Plan.html', 'elsewhere')}.</div>`),
        'What next_.html': page('<h2>What next?</h2><div>Sail.</div>'),
        'Plan.html': page('Plan<br><br>Line one<br>Line two'),
        'Files/chart.png': bytesOf(RED),
        'notebooks/Later/Gone.html': '../../Gone.html',
      }),
    )
    expect(documents).toHaveLength(3)
    expect(lines(called(documents, 'Log'))).toEqual(['Log', 'See [[What next?]], [[What next?|the plan]] and a note that went. Also the web, [[Plan]], a picture and elsewhere.'])
    expect(nodes(called(documents, 'Log').body, 'text').flatMap((node) => (node.marks ?? []).filter((mark) => mark.type === 'link').map((mark) => [node.text, mark.attrs?.href]))).toEqual([['the web', 'https://example.com/']])
  })

  it('brings in a note’s pictures from the export’s Files folder', async () => {
    const { documents, skipped } = await read(exported({ 'Photo.html': page('<div>Photo</div><div><img src="Files/upnote_sample_image.png" width="100%"><br></div>'), 'Files/upnote_sample_image.png': bytesOf(RED) }))
    expect(skipped).toEqual([])
    expect(images(documents[0])).toEqual([`data:image/png;base64,${RED}`])
  })

  it('reads one note’s HTML picked by itself, its checklist and its tags', async () => {
    const { documents, skipped } = await read(file(page('<h2>Alone</h2><ul><li data-checked="true">Done</li></ul><div><a data-upnote-tag="#solo" href="upnote://x-callback-url/tag/view?tag=solo">#solo</a></div>'), 'Alone.html'))
    expect(skipped).toEqual([])
    expect(lines(documents[0])[0]).toBe('Alone')
    expect(nodes(documents[0].body, 'taskItem').map((item) => item.attrs?.checked)).toEqual([true])
    expect(documents[0].tags).toEqual(['solo'])
  })

  it('runs nothing a note’s HTML carries', async () => {
    const { documents } = await read(exported({ 'Bad.html': page('<div>Bad</div><div onclick="globalThis.upnoteRan = true">Words<script>globalThis.upnoteRan = true</script></div><span data-upnote-formula="<img src=x onerror=globalThis.upnoteRan=true>">x</span>') }))
    expect(lines(documents[0]).slice(0, 2)).toEqual(['Bad', 'Words'])
    expect((globalThis as { upnoteRan?: boolean }).upnoteRan).toBeUndefined()
    // A formula's own text is text, whatever it spells: no picture is made of it.
    expect(nodes(documents[0].body, 'image')).toEqual([])
    expect(JSON.stringify(documents[0].body)).not.toContain('onclick')
  })
})

describe('Zoho Notebook', () => {
  // Zoho Notebook's export of everything (Settings, Export/Download your Notebook data), in either form it offers. As
  // HTML: a zip of one page a card, named by the card's id, the pictures beside them, and an index of them; what Zoho
  // knows of a card is in its `<body>`'s attributes, as JSON. As ZNote: a folder a notebook, named in its `meta.json`,
  // holding a `.znote` a card, which is a tar of the card's `Note.znel` (XML, its words as HTML in `ZContent`) and its
  // pictures. Shapes from public sample exports of 2022, 2024 and 2025 (read 2026-11-11).
  const ID = (n: number) => `ihl6e${n.toString(16).padStart(32, '0')}`
  const attr = (value: unknown) => JSON.stringify(value).replace(/"/g, '&quot;')
  const card = (name: string, inner: string, about: { notebook?: string; tags?: string[]; created?: string; modified?: string } = {}) =>
    `<html><head><title>${name}</title></head><body data-notebook="${attr({ cover: { is_private: false }, name: about.notebook ?? 'My Notebook', created_date: '2024-04-13T18:21:39+0200' })}" data-notecard="${attr({ color: '#D4E0E3', name, created_date: about.created ?? '2024-04-13T18:21:59+0200', modified_date: about.modified ?? '2024-04-14T17:59:58+0200' })}"${about.tags ? ` data-tag="${attr(about.tags)}"` : ''}><content><content>${inner}</content></content></body></html>`
  const INDEX = '<html><title>Notebook Exported data</title><body><h1>Notebook Exported Data</h1><br/><ol type="1"><li><a href="a.html">Tides</a></li></ol></body></html>'
  const asHtml = (entries: Record<string, string | Uint8Array>) => zip({ '20098146652/index.html': INDEX, ...Object.fromEntries(Object.entries(entries).map(([name, value]) => [`20098146652/${name}`, value])) }, 'Notebook_18Jan2025_1756_html.zip')
  const called = (documents: Imported[], title: string) => documents.find((doc) => lines(doc)[0] === title)!

  it('reads the HTML export: a card a document, with its name, its dates, its notebook and its tags, and not the index of them', async () => {
    const { documents, skipped } = await read(
      asHtml({
        [`${ID(1)}.html`]: card('Tides', '<div><div>High at <b>07:40</b>.<br></div><div><br></div><ul><li>Spring<br></li><li>Neap<br></li></ul></div>', { tags: ['harbour', 'boats'] }),
        [`${ID(2)}.html`]: card('Ferry', '<div>Weekdays at seven.<br></div>', { notebook: 'Second notebook' }),
      }),
    )
    expect(skipped).toEqual([])
    expect(documents).toHaveLength(2)
    const tides = called(documents, 'Tides')
    expect(tides).toMatchObject({ kind: 'note', folder: 'My Notebook', tags: ['harbour', 'boats'], filing: 'Zoho Notebook’s notebooks and tags' })
    expect(lines(tides)).toEqual(['Tides', 'High at 07:40.', '', 'Spring', 'Neap'])
    expect(tides.createdAt).toBe(Date.UTC(2024, 3, 13, 16, 21, 59))
    expect(tides.updatedAt).toBe(Date.UTC(2024, 3, 14, 15, 59, 58))
    expect(called(documents, 'Ferry')).toMatchObject({ folder: 'Second notebook', tags: [] })
  })

  it('makes one checklist of a card’s ticks, whatever they are nested in, and keeps a table and a quotation', async () => {
    const row = (text: string, checked = false) => `<div><div><input${checked ? ' checked="true"' : ''} type="checkbox"><span>${text}</span></div></div>`
    const { documents } = await read(
      asHtml({
        [`${ID(1)}.html`]: card(
          'Lists',
          `<div><div><div class="checklist">${row('todo 1')}${row('todo 2', true)}</div><div><div><hr><br></div><div><blockquote><div>quote<br></div></blockquote></div><div><br></div><div class="checklist">${row('todo 3')}<div class="checklist">${row('nested todo 4', true)}<div class="checklist">${row('nested nested todo 5')}</div></div>${row('todo 6')}</div></div></div><table border="1" class="ze_tableView"><tbody><tr><td><div>Day<br></div></td><td><div>High<br></div></td></tr></tbody></table></div>`,
        ),
      }),
    )
    const [doc] = documents
    expect(doc.kind).toBe('page')
    const lists = nodes(doc.body, 'taskList')
    expect(lists.map((list) => nodes(list, 'taskItem').map((item) => [plainText({ type: 'doc', content: [item] }), item.attrs?.checked]))).toEqual([
      [['todo 1', false], ['todo 2', true]],
      [['todo 3', false], ['nested todo 4', true], ['nested nested todo 5', false], ['todo 6', false]],
    ])
    expect(nodes(doc.body, 'blockquote')).toHaveLength(1)
    expect(nodes(doc.body, 'table')).toHaveLength(1)
  })

  it('brings in a card’s picture from beside it, a picture card as its picture alone, and a card Zoho calls Untitled with no title', async () => {
    const { documents, skipped } = await read(
      asHtml({
        [`${ID(1)}.html`]: card('Harbour', `<div><div>With image:<br></div><div><img src="${ID(50)}.png"><br></div></div>`),
        [`${ID(2)}.html`]: card('Untitled', `<img src="${ID(51)}.png">`),
        [`${ID(50)}.png`]: bytesOf(RED),
        [`${ID(51)}.png`]: bytesOf(GREY),
      }),
    )
    expect(skipped).toEqual([])
    expect(images(called(documents, 'Harbour'))).toEqual([`data:image/png;base64,${RED}`])
    const picture = documents.find((doc) => doc !== called(documents, 'Harbour'))!
    expect(images(picture)).toEqual([`data:image/png;base64,${GREY}`])
    expect(plainText(picture.body)).not.toContain('Untitled')
  })

  it('writes a link to another card as one by that card’s name, and one to a card that isn’t there as its words', async () => {
    const { documents } = await read(
      asHtml({
        [`${ID(1)}.html`]: card('Log', `<div>See&nbsp;<a href="zohonotebook://notes/${ID(2)}">link</a>&nbsp;and <a class="zn-link editor-note-link" href="zohonotebook://notes/${ID(2)}" target="_blank">Tide tables</a>, <a href="zohonotebook://notes/${ID(99)}">a card that went</a> and <a class="zn-link" href="https://example.com/" target="_blank" title="https://example.com/">the web</a>.<br></div>`),
        [`${ID(2)}.html`]: card('Tide tables', '<div>High at 07:40.<br></div>'),
      }),
    )
    expect(lines(called(documents, 'Log'))).toEqual(['Log', 'See [[Tide tables|link]] and [[Tide tables]], a card that went and the web.'])
    expect(nodes(called(documents, 'Log').body, 'text').flatMap((node) => (node.marks ?? []).filter((mark) => mark.type === 'link').map((mark) => [node.text, mark.attrs?.href]))).toEqual([['the web', 'https://example.com/']])
  })

  it('reads one card’s page picked by itself, and a page that only has an index’s name as a page', async () => {
    const alone = await read(file(card('Alone', '<div class="checklist"><div><div><input checked="true" type="checkbox"><span>Done</span></div></div></div>', { tags: ['solo'] }), `${ID(1)}.html`))
    expect(alone.skipped).toEqual([])
    expect(alone.documents[0]).toMatchObject({ folder: 'My Notebook', tags: ['solo'] })
    expect(nodes(alone.documents[0].body, 'taskItem').map((item) => item.attrs?.checked)).toEqual([true])
    const site = await read(zip({ 'Site/index.html': '<html><title>Home</title><body><p>Welcome to the harbour.</p></body></html>' }))
    expect(site.documents.map((doc) => plainText(doc.body))).toEqual(['Home\nWelcome to the harbour.'])
  })

  // The other form.
  const znel = (title: string, inner: string, about: { type?: string; tags?: string[]; created?: string } = {}) =>
    `<ZNote znelVersion="1"><ZMeta><ZTitle>${title}</ZTitle><ZCreatedDate>${about.created ?? '2024-04-13T16:21:59+0000'}</ZCreatedDate><ZModifiedDate>2024-04-13T16:28:44+0000</ZModifiedDate><ZLocation><ZLongitude>0.0</ZLongitude><ZLatitude>0.0</ZLatitude><ZCity>Unknown</ZCity></ZLocation><ZNoteColor>#D4E0E3</ZNoteColor><ZNoteType typeVersion="1">${about.type ?? 'note/mixed'}</ZNoteType></ZMeta><ZContent><![CDATA[<content>${inner}</content>]]></ZContent>${about.tags?.length ? `<ZTags>${about.tags.map((tag) => `<ZTag>${tag}</ZTag>`).join('')}</ZTags>` : '<ZTags/>'}<ZReminders/></ZNote>`
  const znote = (id: string, xml: string, held: Record<string, Uint8Array> = {}) => tarOf([{ name: `${id}/Note.znel`, data: xml }, ...Object.entries(held).map(([name, data]) => ({ name: `${id}/${name}`, data }))])
  const meta = (name: string, id: string) => JSON.stringify({ cover: { is_private: false }, data_type: 'NOTEBOOK', name, created_date: '2024-04-13T18:21:39+0200', modified_date: '2024-04-13T18:21:39+0200', notebook_id: id })
  const [BOOK, OTHER] = [ID(900), ID(901)]
  const asZnote = (entries: Record<string, string | Uint8Array>) => zip({ [`20098146652/${BOOK}/meta.json`]: meta('My Notebook', BOOK), [`20098146652/${OTHER}/meta.json`]: meta('Second notebook', OTHER), ...Object.fromEntries(Object.entries(entries).map(([name, value]) => [`20098146652/${name}`, value])) }, 'Notebook_14Apr2024_0732_znote.zip')

  it('reads the ZNote export: a card a document, with its name, its dates, the notebook its folder is, and its tags', async () => {
    const { documents, skipped } = await read(
      asZnote({
        [`${BOOK}/${ID(1)}.znote`]: znote(ID(1), znel('Tides', '<content><div><div>High at 07:40.<br/></div><ul><li>Spring<br/></li><li>Neap<br/></li></ul></div></content>', { tags: ['harbour'] })),
        [`${OTHER}/${ID(2)}.znote`]: znote(ID(2), znel('Ferry', '<content><div>Weekdays at seven.<br/></div></content>', { created: '2022-03-01T09:18:54-0800' })),
      }),
    )
    expect(skipped).toEqual([])
    expect(documents).toHaveLength(2)
    const tides = called(documents, 'Tides')
    expect(tides).toMatchObject({ kind: 'note', folder: 'My Notebook', tags: ['harbour'], filing: 'Zoho Notebook’s notebooks and tags' })
    expect(lines(tides)).toEqual(['Tides', 'High at 07:40.', 'Spring', 'Neap'])
    expect(tides.createdAt).toBe(Date.UTC(2024, 3, 13, 16, 21, 59))
    expect(tides.updatedAt).toBe(Date.UTC(2024, 3, 13, 16, 28, 44))
    expect(called(documents, 'Ferry')).toMatchObject({ folder: 'Second notebook', tags: [] })
    expect(called(documents, 'Ferry').createdAt).toBe(Date.UTC(2022, 2, 1, 17, 18, 54))
  })

  it('reads a ZNote card’s ticks, in a card of words and in a checklist card, its picture and what follows it, and its links', async () => {
    const { documents, skipped } = await read(
      asZnote({
        [`${BOOK}/${ID(1)}.znote`]: znote(
          ID(1),
          znel(
            'Mine',
            `<div><div>I am a note.<br/></div><div class="checklist"><div><checkbox checked="false">and this is awesome<br/></checkbox></div><div><checkbox checked="true">trying this out<br/></checkbox></div></div><div><znresource height="3356" local-id="${ID(60)}" relative-path="${ID(60)}.jpeg" type="image/jpeg" width="2384"/>Seen from the quay.<br/></div><div>After the picture, see <a class="zn-link editor-note-link" href="zohonotebook://notes/${ID(2)}" target="_blank">the list</a>.<br/></div></div>`,
          ),
          { [`${ID(60)}.jpeg`]: bytesOf(RED) },
        ),
        [`${BOOK}/${ID(2)}.znote`]: znote(ID(2), znel('Checklist', '<div><checkbox checked="false">rope</checkbox></div><div><checkbox checked="true">lamp oil</checkbox></div>', { type: 'note/checklist' })),
        [`${BOOK}/${ID(3)}.znote`]: znote(ID(3), znel('Untitled', `<znresource consumers="com.zoho.notebook.sketch" local-id="${ID(61)}" relative-path="${ID(61)}.png" type="image/png"/>`, { type: 'note/sketch' }), { [`${ID(61)}.png`]: bytesOf(GREY) }),
      }),
    )
    expect(skipped).toEqual([])
    const mine = called(documents, 'Mine')
    expect(nodes(mine.body, 'taskItem').map((item) => [plainText({ type: 'doc', content: [item] }), item.attrs?.checked])).toEqual([['and this is awesome', false], ['trying this out', true]])
    expect(images(mine)).toEqual([`data:image/jpeg;base64,${RED}`])
    // Words on the picture's own line aren't lost inside it.
    expect(lines(mine).slice(-2)).toEqual(['Seen from the quay.', 'After the picture, see [[Checklist|the list]].'])
    expect(nodes(called(documents, 'Checklist').body, 'taskList')).toHaveLength(1)
    expect(nodes(called(documents, 'Checklist').body, 'taskItem').map((item) => item.attrs?.checked)).toEqual([false, true])
    const sketch = documents.find((doc) => images(doc)[0] === `data:image/png;base64,${GREY}`)!
    expect(plainText(sketch.body)).not.toContain('Untitled')
  })

  it('says a file a card holds that is no picture was left, and that a card it can’t read couldn’t be', async () => {
    const { documents, skipped } = await read(
      asZnote({
        [`${BOOK}/${ID(1)}.znote`]: znote(ID(1), znel('Manual', `<div>Kept here: <znresource local-id="${ID(62)}" relative-path="${ID(62)}.pdf" type="application/pdf"/></div>`, { type: 'note/file' }), { [`${ID(62)}.pdf`]: new Uint8Array([37, 80, 68, 70]) }),
        [`${BOOK}/${ID(2)}.znote`]: 'Not a tar at all.',
        [`${BOOK}/${ID(3)}.znote`]: tarOf([{ name: `${ID(3)}/Other.txt`, data: 'No card in here.' }]),
        [`${BOOK}/${ID(4)}.znote`]: znote(ID(4), '<Other><ZTitle>Not a card</ZTitle></Other>'),
        [`${BOOK}/${ID(5)}.znote`]: znote(ID(5), 'not xml at all <'),
      }),
    )
    expect(documents.map((doc) => lines(doc))).toEqual([['Manual', 'Kept here:']])
    expect(skipped.sort()).toEqual([`1 file attached in Zoho Notebook`, ...[2, 3, 4, 5].map((n) => `20098146652/${BOOK}/${ID(n)}.znote: couldn’t be read`)].sort())
  })

  it('runs nothing a card carries, in either form', async () => {
    const bad = '<div onclick="globalThis.zohoRan = true">Words<script>globalThis.zohoRan = true</script></div>'
    const html = await read(asHtml({ [`${ID(1)}.html`]: card('Bad', bad) }))
    const tar = await read(asZnote({ [`${BOOK}/${ID(1)}.znote`]: znote(ID(1), znel('Bad', bad)) }))
    expect(lines(html.documents[0])).toEqual(['Bad', 'Words'])
    expect(lines(tar.documents[0])).toEqual(['Bad', 'Words'])
    expect((globalThis as { zohoRan?: boolean }).zohoRan).toBeUndefined()
  })
})

describe('FuseBase', () => {
  // FuseBase (Nimbus Note, before) exports a page at a time (the page's menu, Download, HTML): a zip of `note.html` and an
  // `assets` folder holding the page's pictures and files among FuseBase's own stylesheet and some fifty font files. The
  // page's words are in `#note-editor .nedit-root`, written as FuseBase draws them: a list flat, each item saying how
  // far in it is; a table with its row numbers and its totals. Shapes from public sample exports of 2024 and 2025
  // (read 2026-11-11).
  const P = (inner: string) => `<div class="editable-text paragraph indent-0" style="text-align:left;">${inner}</div>`
  const CAPTION = '<div class="editable-text attachment-caption empty-caption empty-caption-hidden" style="text-align: center; width: 50px;"><br></div>'
  const note = (title: string, inner: string) =>
    `<!doctype html>\n<html>\n<head>\n<title>${title}</title>\n<meta charset="utf-8">\n<link rel="stylesheet" type="text/css" href="./assets/theme.css">\n<link rel="stylesheet" type="text/css" href="./assets/fonts/fonts.css">\n</head>\n<body>\n<div id="note-editor" class="note-container theme-light is-safari" style="position: relative;">\n<div class="editor-body">\n<div class="export-mode nedit-root notranslate size-normal style-normal" id="note-root">${inner}</div>\n</div>\n</div>\n</body>\n</html>`
  const OWN = { 'assets/theme.css': '.nedit-root {}', 'assets/fonts/fonts.css': '@font-face {}', 'assets/fonts/icomoon.woff': new Uint8Array([1, 2]), 'assets/fonts/google-fonts/Caveat.css': '@font-face {}', 'assets/fonts/google-fonts/KFOmCnqEu92Fr1Mu4WxKOzY.woff2': new Uint8Array([3]) }
  const exported = (title: string, inner: string, held: Record<string, string | Uint8Array> = {}, under = '') =>
    zip(Object.fromEntries(Object.entries({ 'note.html': note(title, inner), ...OWN, ...Object.fromEntries(Object.entries(held).map(([name, value]) => [`assets/${name}`, value])) }).map(([name, value]) => [under + name, value])), 'New_page.zip')
  const marked = (doc: Imported, type: string) => nodes(doc.body, 'text').filter((node) => node.marks?.some((mark) => mark.type === type)).map((node) => node.text)

  it('reads a page: its title and its words, and says nothing of FuseBase’s own stylesheet and fonts', async () => {
    const { documents, skipped } = await read(exported('Tides', `${P('High at <strong>07:40</strong>.')}${P('<br/>')}<h2 class="nedit-heading editable-text paragraph indent-0" style="text-align:left;">Springs</h2>${P('After the <em>new</em> moon.')}`))
    expect(skipped).toEqual([])
    expect(documents).toHaveLength(1)
    const [doc] = documents
    expect(doc.kind).toBe('page')
    expect(headings(doc)).toEqual(['Tides', 'Springs'])
    expect(lines(doc)).toEqual(['Tides', 'High at 07:40.', '', 'Springs', 'After the new moon.'])
    expect([marked(doc, 'bold'), marked(doc, 'italic')]).toEqual([['07:40'], ['new']])
    expect(doc.folder).toBeUndefined()
  })

  it('makes a checklist of a list with ticks, a numbered list of a numbered one, and puts each item as far in as it says', async () => {
    const item = (kind: string, indent: number, text: string, more = '') => `<li class="list-item-${kind} editable-text list-item indent-${indent}" style="text-align: left;"${more}>${text}</li>`
    const list = (...items: string[]) => `<ul class="editor-list number-template-decimal-all">${items.join('')}</ul>`
    const { documents } = await read(
      exported(
        'Lists',
        list(item('checkbox', 0, 'todo item 1', ' data-checked="false"'), item('checkbox', 0, 'todo item 2', ' data-checked="true"')) +
          list(item('bullet', 0, 'item 1'), item('bullet', 1, 'nested'), item('bullet', 2, 'even more'), item('bullet', 2, 'nested too'), item('bullet', 0, 'item 2')) +
          list(item('number', 0, 'first item'), item('number', 1, 'sub item'), item('number', 0, 'second item')),
      ),
    )
    const [doc] = documents
    expect(nodes(doc.body, 'taskItem').map((one) => [plainText({ type: 'doc', content: [one] }), one.attrs?.checked])).toEqual([['todo item 1', false], ['todo item 2', true]])
    const outline = (list: JSONContent): unknown[] => list.content!.map((one) => [plainText({ type: 'doc', content: [one.content![0]] }), ...(one.content ?? []).filter((child) => child.type === list.type).map(outline)])
    const bullets = doc.body.content!.find((block) => block.type === 'bulletList')!
    expect(outline(bullets)).toEqual([['item 1', [['nested', [['even more'], ['nested too']]]]], ['item 2']])
    const numbers = doc.body.content!.find((block) => block.type === 'orderedList')!
    expect(outline(numbers)).toEqual([['first item', [['sub item']]], ['second item']])
  })

  it('keeps a table’s own cells, without the row numbers, the gap beside them and the totals FuseBase draws around it', async () => {
    const head = (name: string, index: number) => `<th class="table-head-item" data-index="${index}" width="180"><div class="item-ui"><div class="item-title" style="max-width: 136px;">${name}</div></div></th>`
    const row = (number: number, ...cells: string[]) => `<tr height="36"><td class="table-head-item" height="36" data-index="${number - 1}"><div class="item-ui"><div class="item-title">${number}</div></div></td><td>\n</td>${cells.map((cell) => `<td><div class="table-text-common">${cell}\n</div></td>`).join('')}</tr>`
    const total = '<td><div class="summary-wrap"><div class="summary-item"><span class="summary-name">All</span>:<div class="summary-value">2</div></div></div></td>'
    const table = `<div class="embed-wrapper table-wrapper export"><div class="table-blot" contenteditable="false"><div class="table-embed"><table class="table-component"><thead style="--htop:0px;"><tr><th class="table-head-start"><div class="table-header-circle"></div></th><th>\n</th>${head('A', 0)}${head('B', 1)}</tr></thead><tbody class="">${row(1, 'table', 'cells')}${row(2, '', 'd')}<tr height="36"><td class="table-head-item" height="36" data-index="2"><div class="item-ui"><div class="item-title">3</div></div></td><td><div class="table-text-common">no gap\n</div></td><td><div class="table-text-common">here\n</div></td></tr></tbody><tfoot><tr><td class="add-row"></td><td></td>${total}${total}</tr></tfoot></table></div></div>${CAPTION}</div>`
    const { documents } = await read(exported('Table', P('Before.') + table + P('After.')))
    const [doc] = documents
    const [made] = nodes(doc.body, 'table')
    expect(made.content!.map((line) => line.content!.map((cell) => plainText({ type: 'doc', content: cell.content }).trim()))).toEqual([['A', 'B'], ['table', 'cells'], ['', 'd'], ['no gap', 'here']])
    expect(lines(doc).filter(Boolean).at(-1)).toBe('After.')
    expect(plainText(doc.body)).not.toContain('All')
  })

  it('brings in a page’s pictures from its assets, and of a file it holds keeps the name, counted, never taking the file for a note', async () => {
    const image = '<DIV class="embed-wrapper image-wrapper indent-0" data-content-align="center"><div class="image" contenteditable="false"><div class="resize-container disabled-resize" style="width: 200px;"><div class="image-container" contenteditable="false"><a href="./assets/e1GHfrAAh4S96o7k.png" target="_blank"><img class="img-hide" src="./assets/e1GHfrAAh4S96o7k.png"></a><div class="image-comments-counter disabled"></div></div></div></div>' + CAPTION + '</DIV>'
    const held = '<DIV class="embed-wrapper file-wrapper"><div class="file"><div contenteditable="false" class="file-container view-mode-compact"><div class="file-info file-name-trim-end"><div><span data-editor-toolip="Download plain text.txt" class="file-name"><a href="./assets/XfOyFr3jQ92lni7u.txt" target="_blank"><span>\n<span class="file-name-main">plain text.</span>\n<span class="file-name-ext">txt</span>\n</span></a></span><span class="file-size">(34 B)</span></div></div></div></div>' + CAPTION + '</DIV>'
    const { documents, skipped } = await read(exported('Held', P('A picture:') + image + P('A file:') + held + P('The end.'), { 'e1GHfrAAh4S96o7k.png': bytesOf(RED), 'XfOyFr3jQ92lni7u.txt': 'plaintext content\nmultiple lines', 'unused.png': bytesOf(GREY) }))
    expect(documents).toHaveLength(1)
    expect(images(documents[0])).toEqual([`data:image/png;base64,${RED}`])
    // No empty line where FuseBase leaves room for a caption nobody wrote; the picture's own line is the one between.
    expect(lines(documents[0])).toEqual(['Held', 'A picture:', '', 'A file:', 'plain text.txt', 'The end.'])
    expect(nodes(documents[0].body, 'text').some((node) => node.marks?.some((mark) => mark.type === 'link'))).toBe(false)
    expect(JSON.stringify(documents[0].body)).not.toContain('./assets/')
    expect(skipped).toEqual(['1 file attached in FuseBase'])
  })

  it('keeps code without the name of its language over it, a bookmark as a link by the page’s name, and a link to another page as one to it on the web', async () => {
    const code = '<DIV class="embed-wrapper syntax-wrapper"><syntax class="syntax-main editor-syntax" spellcheck="false" data-nimbus-language="python"><div class="syntax-cm-container"><div><div class="syntax-control-wrapper" contenteditable="false"><div class="syntax-control-wrap no-margin" contenteditable="false"><span class="syntax-control-label">Python</span></div></div><pre style="white-space: pre-wrap; ">first line\n<span class="hljs-comment"># comment</span>\n</pre></div></div></syntax>' + CAPTION + '</DIV>'
    const bookmark = '<div class="nimbus-bookmark"><div contenteditable="false" class="nimbus-bookmark-container"><a href="https://example.com/tides" style="display: contents;"><div class="nimbus-bookmark-content is-card"><div class="nimbus-bookmark__info"><div class="nimbus-bookmark__info__name">Tide tables for the north harbour</div><a class="nimbus-bookmark__info__src" href="https://example.com/tides"><div class="nimbus-bookmark__icon"><img src="https://example.com/icon.png"></div><div class="nimbus-bookmark__info__src-text">https://example.com/tides</div></a><div class="nimbus-bookmark__info__desc">High and low water.</div></div><div class="nimbus-bookmark__preview"><img src="./assets/preview.png"></div></div></a></div></div>'
    const mention = '<mention class="mention" data-mention-type="note" data-mention-name="abc" data-mention-object_id="2Wjy">\ufeff<span contenteditable="false" class="mention-link" data-mention-type="note" data-mention-name="New page"><a href="https://example.nimbusweb.me/ws/39de/note/2Wjy" target="_blank">abc</a></span>\ufeff</mention>'
    const { documents, skipped } = await read(exported('Blocks', code + bookmark + P(`See ${mention} there.`), { 'preview.png': bytesOf(GREY) }))
    const [doc] = documents
    expect(skipped).toEqual([])
    expect(nodes(doc.body, 'codeBlock').map((block) => plainText({ type: 'doc', content: [block] }))).toEqual(['first line\n# comment'])
    expect(plainText(doc.body)).not.toContain('Python')
    expect(lines(doc).filter(Boolean)).toEqual(['Blocks', 'first line', '# comment', 'Tide tables for the north harbour', 'See abc there.'])
    expect(nodes(doc.body, 'text').flatMap((node) => (node.marks ?? []).filter((mark) => mark.type === 'link').map((mark) => [node.text, mark.attrs?.href]))).toEqual([
      ['Tide tables for the north harbour', 'https://example.com/tides'],
      ['abc', 'https://example.nimbusweb.me/ws/39de/note/2Wjy'],
    ])
    expect(images(doc)).toEqual([])
  })

  it('reads several pages their owner zipped together, each with its own assets', async () => {
    const one = Object.entries({ 'Pages/One/note.html': note('One', P('First.') + '<div class="image-container"><a href="./assets/a.png"><img src="./assets/a.png"></a></div>'), 'Pages/One/assets/a.png': bytesOf(RED), 'Pages/One/assets/theme.css': 'x {}', 'Pages/Two/note.html': note('Two', P('Second.') + '<div class="image-container"><a href="./assets/a.png"><img src="./assets/a.png"></a></div>'), 'Pages/Two/assets/a.png': bytesOf(GREY), 'Pages/Two/assets/theme.css': 'x {}', 'Mine/assets/words.txt': 'A note of my own, in a folder called assets.' })
    const { documents, skipped } = await read(zip(Object.fromEntries(one)))
    expect(skipped).toEqual([])
    // Only what is beside a page of FuseBase's is that page's: another folder of the name holds what it holds.
    expect(documents.map((doc) => [lines(doc)[0], images(doc)]).sort()).toEqual([['A note of my own, in a folder called assets.', []], ['One', [`data:image/png;base64,${RED}`]], ['Two', [`data:image/png;base64,${GREY}`]]])
  })

  it('reads a page called note.html that isn’t FuseBase’s as any page, and says what its folder of assets held, as it always did', async () => {
    const { documents, skipped } = await read(zip({ 'note.html': '<html><head><title>Mine</title></head><body><p>A page of my own.</p></body></html>', 'assets/theme.css': 'p {}', 'assets/notes.txt': 'Kept beside it.' }))
    expect(documents.map((doc) => plainText(doc.body)).sort()).toEqual(['Kept beside it.', 'Mine\nA page of my own.'])
    expect(skipped).toEqual(['assets/theme.css: not a format Nib reads'])
  })

  it('reads a page’s HTML picked by itself, and runs nothing it carries', async () => {
    const { documents } = await read(file(note('Alone', '<ul class="editor-list"><li class="list-item-checkbox editable-text list-item indent-0" data-checked="true">Done</li></ul>' + P('Words<script>globalThis.fuseRan = true</script>') + '<div class="editable-text paragraph indent-0" onclick="globalThis.fuseRan = true">More</div>'), 'note.html'))
    expect(lines(documents[0])).toEqual(['Alone', 'Done', 'Words', 'More'])
    expect(nodes(documents[0].body, 'taskItem').map((one) => one.attrs?.checked)).toEqual([true])
    expect((globalThis as { fuseRan?: boolean }).fuseRan).toBeUndefined()
  })
})

describe('ColorNote', () => {
  // ColorNote's backup (lib/colornote opens it), the only way its notes leave it. A note as ColorNote keeps one, from
  // real backups of 2024 and 2026 (public samples, read 2026-11-11): its words are plain, a checklist's lines open
  // `[ ]` or `[V]`, and what it is and where it is are numbers.
  const note = (id: number, title: string, text: string, more: Record<string, unknown> = {}) => ({ _id: id, title, note: text, encrypted: 0, modified_date: 1728922218086, active_state: 0, folder_id: 0, status: 0, space: 0, type: 0, note_ext: '', color_index: 3, created_date: 1728765229751, reminder_base: 0, tags: '', uuid: `c2ddffef-eff3-418b-9c01-${String(id).padStart(12, '0')}`, ...more })
  const SETTINGS = [note(90, 'syncable_settings', '{"T":1,"V":1,"D":{}}', { active_state: 256, folder_id: 256, type: 256 }), note(91, 'name_master_password', '{"T":1,"V":1,"D":{"BACKUP_SECRET_KEY":{"V":"KYtZmvBUrV0MfYBoBBk3iw=="}}}', { active_state: 256, folder_id: 256, type: 256 })]
  const backup = async (notes: unknown[], password?: string) => file(await colornoteOf(notes, password), 'colornote-20241014.backup')
  const called = (documents: Imported[], title: string) => documents.find((doc) => lines(doc)[0] === title)!
  const never = vi.fn(async () => null)

  it('reads a backup ColorNote made by itself without asking for anything: each note with its title, its words and its dates', async () => {
    const { documents, skipped } = await readImportFile(await backup([note(1, 'Test note', 'Content\nPinned\n\nNote link: [[Title only]]\n'), note(3, 'Title only', ''), ...SETTINGS]), 'note', never)
    expect(never).not.toHaveBeenCalled()
    expect(skipped).toEqual([])
    expect(documents).toHaveLength(2)
    const test = called(documents, 'Test note')
    expect(test.kind).toBe('note')
    expect(lines(test)).toEqual(['Test note', 'Content', 'Pinned', '', 'Note link: [[Title only]]'])
    expect(test.createdAt).toBe(1728765229751)
    expect(test.updatedAt).toBe(1728922218086)
    expect(test.archived).toBeUndefined()
    expect(lines(called(documents, 'Title only'))[0]).toBe('Title only')
  })

  it('asks for the password of a backup its owner made, again while it’s wrong, and reads it once it’s right', async () => {
    const ask = vi.fn<(about: { name: string; again: boolean }) => Promise<string | null>>().mockResolvedValueOnce('12345').mockResolvedValueOnce('1234')
    const { documents, skipped } = await readImportFile(await backup([note(1, 'Tides', 'High at 07:40.')], '1234'), 'note', ask)
    expect(ask.mock.calls).toEqual([[{ name: 'colornote-20241014.backup', again: false }], [{ name: 'colornote-20241014.backup', again: true }]])
    expect(skipped).toEqual([])
    expect(documents.map(lines)).toEqual([['Tides', 'High at 07:40.']])
  })

  it('says a backup wasn’t opened when its password isn’t given, or can’t be asked for', async () => {
    const locked = await backup([note(1, 'Tides', 'High.')], '1234')
    const cancelled = vi.fn(async () => null)
    expect(await readImportFile(locked, 'note', cancelled)).toEqual({ documents: [], skipped: ['colornote-20241014.backup: not opened, without its password'] })
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(await readImportFile(locked, 'note')).toEqual({ documents: [], skipped: ['colornote-20241014.backup: not opened, without its password'] })
  })

  it('makes a checklist of a checklist, ticked where it was', async () => {
    const { documents } = await readImportFile(await backup([note(2, 'Test checklist', '[ ] Item 1\n[V] Item 2\n[ ] 345\n', { type: 16 }), note(7, '(12.10.2024)', '[V] A\n[V] B\n', { type: 16 })]), 'note')
    const list = called(documents, 'Test checklist')
    expect(nodes(list.body, 'taskList')).toHaveLength(1)
    expect(nodes(list.body, 'taskItem').map((item) => [plainText({ type: 'doc', content: [item] }), item.attrs?.checked])).toEqual([['Item 1', false], ['Item 2', true], ['345', false]])
    // And one ColorNote named by its day alone has no title: it opens with its first item.
    const other = documents.find((doc) => doc !== list)!
    expect(lines(other)).toEqual(['A', 'B'])
    expect(nodes(other.body, 'taskItem').map((item) => item.attrs?.checked)).toEqual([true, true])
  })

  it('leaves a note of words its words, though a line of it opens like a tick; and loses only a note it can’t read', async () => {
    const parse = DOMParser.prototype.parseFromString
    DOMParser.prototype.parseFromString = function (this: DOMParser, text: string, type: DOMParserSupportedType) {
      if (text.includes('UNREADABLE')) throw new Error('No')
      return parse.call(this, text, type)
    }
    try {
      const { documents, skipped } = await readImportFile(await backup([note(1, 'Brackets', '[ ] not a box\n[V] nor this'), note(2, 'Broken', 'UNREADABLE'), note(3, 'Last', 'Here too.')]), 'note')
      expect(documents.map(lines)).toEqual([['Brackets', '[ ] not a box', '[V] nor this'], ['Last', 'Here too.']])
      expect(nodes(documents[0].body, 'taskItem')).toEqual([])
      expect(skipped).toEqual(['1 note that couldn’t be read'])
    } finally {
      DOMParser.prototype.parseFromString = parse
    }
  })

  it('takes a title ColorNote made of the note’s own first words, or of its day, as no title; and keeps one its owner wrote', async () => {
    const { documents } = await readImportFile(
      await backup([
        note(1, 'this is a note created as a Note that I sent to', 'this is a note created as a Note that I sent to the archive'),
        note(2, '(6/15/2026)', 'No title'),
        note(3, 'Harbour', 'this is a note about the harbour'),
        note(4, 'Same', 'Same\nSecond line'),
      ]),
      'note',
    )
    expect(documents.map(lines)).toEqual([['this is a note created as a Note that I sent to the archive'], ['No title'], ['Harbour', 'this is a note about the harbour'], ['Same', 'Second line']])
  })

  it('leaves out what’s in ColorNote’s trash and what it locked, counted; says nothing of what it deleted or of its own settings; and keeps the archive archived', async () => {
    const { documents, skipped } = await readImportFile(
      await backup([
        note(1, 'Kept', 'Here.'),
        note(2, 'Binned', 'Gone.', { active_state: 16 }),
        note(3, 'Binned too', 'Gone.', { active_state: 16, folder_id: 16 }),
        note(4, '', '', { active_state: 32 }),
        note(5, 'Put away', 'In the archive.', { space: 16 }),
        note(6, 'On the calendar', 'For Thursday.', { folder_id: 16, reminder_base: 1781481600000 }),
        note(7, 'Secret', 'kq0zXn1+9Q==', { encrypted: 1 }),
        ...SETTINGS,
      ]),
      'note',
    )
    expect(documents.map((doc) => [lines(doc)[0], doc.archived])).toEqual([['Kept', undefined], ['Put away', true], ['On the calendar', undefined]])
    expect(skipped.sort()).toEqual(['1 note locked in ColorNote', '2 notes in ColorNote’s trash'])
  })

  it('says a .backup that isn’t ColorNote’s is no format it reads, without asking for anything', async () => {
    const ask = vi.fn(async () => 'x')
    expect(await readImportFile(file('Some other app’s backup, of plain words and long enough to look at.', 'notes.backup'), 'note', ask)).toEqual({ documents: [], skipped: ['notes.backup: not a format Nib reads'] })
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('HTML files', () => {
  it('promotes a first line that is the title instead of repeating it', async () => {
    const html = '<html><head><title>Plan</title></head><body><p>Plan</p><h2>Steps</h2><p>One</p></body></html>'
    const [doc] = (await read(file(html, 'plan.html'))).documents
    expect(doc.kind).toBe('page')
    expect(firstBlock(doc)).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(lines(doc)).toEqual(['Plan', 'Steps', 'One'])
  })

  it('takes the title from the first h1 when there is no <title>', async () => {
    const [doc] = (await read(file('<body><h1>Notes</h1><p>Body text</p></body>', 'n.htm'))).documents
    expect(doc.kind).toBe('note')
    expect(lines(doc)).toEqual(['Notes', 'Body text'])
  })
})

describe('files Nib does not import', () => {
  it('points a Nib backup at Restore instead', async () => {
    const backup = JSON.stringify({ kind: 'nib-backup', version: 1, items: [] })
    expect(await read(file(backup, 'nib-backup-2026-10-08.json'))).toEqual({
      documents: [],
      skipped: ['This is a Nib backup. Use Restore from a backup in Settings instead.'],
    })
  })

  it('names any other file', async () => {
    expect(await read(file('…', 'photo.heic'))).toEqual({ documents: [], skipped: ['photo.heic: not a format Nib reads'] })
    expect(await read(file('{"a":1}', 'data.json'))).toEqual({ documents: [], skipped: ['data.json: not a format Nib reads'] })
  })
})
