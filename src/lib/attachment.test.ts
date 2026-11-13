import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { aboutOf, asAttached, asFileName, attachedIn, attachedName, hasAttachment, keptApart, kindOf, sizeText } from './attachment'
import { asFileRef, MAX_FILE } from './fileRef'
import { filesIn, filterBodyImages, originalsIn, withoutAboutIn, withoutOriginals } from './image'

/** An attachment as a document holds it (lib/attachment): its name, and which file it is, each checked. */

const ID = '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d'
const file = { id: ID, type: 'application/pdf', size: 2_400_000 }
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const attachment = (attrs: Record<string, unknown>): JSONContent => ({ type: 'attachment', attrs })

describe('a file as a document names it', () => {
  it('is an id of the store’s, a media type and a size a file can be, and nothing else', () => {
    expect(asFileRef({ ...file, more: 'x' })).toEqual(file)
    expect(asFileRef({ ...file, type: 'audio/mpeg' })).toEqual({ ...file, type: 'audio/mpeg' })
    expect(asFileRef({ ...file, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).not.toBeNull()
    expect(asFileRef({ ...file, size: MAX_FILE })).not.toBeNull()
    for (const not of [
      null,
      'a file',
      { ...file, id: '../index' },
      { ...file, id: 'https://example.com/a.pdf' },
      { ...file, type: 'application/pdf; charset=x' },
      { ...file, type: 'text/html onload=alert(1)' },
      { ...file, type: 'pdf' },
      { ...file, type: 42 },
      { ...file, size: 0 },
      { ...file, size: 1.5 },
      { ...file, size: MAX_FILE + 1 },
      { ...file, size: '100' },
    ]) {
      expect(asFileRef(not), JSON.stringify(not)).toBeNull()
    }
  })
})

describe('an attachment’s name', () => {
  it('is one line, without the folders it came from, and not too long', () => {
    expect(asFileName('report.pdf')).toBe('report.pdf')
    expect(asFileName('  Chapter one — draft.docx ')).toBe('Chapter one — draft.docx')
    expect(asFileName('/Users/someone/Documents/report.pdf')).toBe('report.pdf')
    expect(asFileName('C:\\Users\\someone\\report.pdf')).toBe('report.pdf')
    expect(asFileName('re\nport\u0000.pdf\u202e')).toBe('report.pdf')
    expect(asFileName('x'.repeat(500))).toHaveLength(120)
    for (const not of ['', '   ', '/', '\n', 42, null, undefined, { name: 'x' }]) expect(asFileName(not)).toBeNull()
  })
})

describe('an attachment as its document holds it', () => {
  it('is its name and its file; without a file that’s one, its name alone; without a name, nothing', () => {
    expect(asAttached({ file, name: 'report.pdf', onclick: 'x' })).toEqual({ file, name: 'report.pdf' })
    expect(asAttached({ file: { ...file, id: '../index' }, name: 'report.pdf' })).toEqual({ file: null, name: 'report.pdf' })
    expect(asAttached({ name: 'report.pdf' })).toEqual({ file: null, name: 'report.pdf' })
    for (const not of [{ file }, { file, name: '' }, null, 'report.pdf', undefined]) expect(asAttached(not)).toBeNull()
    expect(attachedName({ attrs: { name: 'a/b/report.pdf' } })).toBe('report.pdf')
    expect(attachedName({ attrs: { name: 7 } })).toBe('Attachment')
    expect(attachedName({})).toBe('Attachment')
  })

  it('says what kind of file it is and how big, or that it isn’t included', () => {
    expect(aboutOf({ file, name: 'report.pdf' })).toBe('PDF · 2\u00a0MB')
    expect(aboutOf({ file: null, name: 'report.pdf' })).toBe('attached file, not included')
    expect(['application/pdf', 'audio/mpeg', 'AUDIO/M4A', 'video/mp4', 'image/heic', 'text/csv', 'application/vnd.ms-excel', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint', 'text/plain', 'application/zip', 'application/octet-stream'].map(kindOf)).toEqual([
      'PDF', 'Audio', 'Audio', 'Video', 'Picture', 'Spreadsheet', 'Spreadsheet', 'Document', 'Document', 'Presentation', 'Text', 'Archive', 'File',
    ])
  })

  it('reads sizes as a writer would, the number kept with its unit', () => {
    expect([1, 400, 12_300, 999_499, 1_000_000, 48_200_000, 999_400_000, 1_000_000_000, 1_260_000_000, 2_000_000_000].map(sizeText)).toEqual([
      '1\u00a0KB', '1\u00a0KB', '12\u00a0KB', '999\u00a0KB', '1\u00a0MB', '48\u00a0MB', '999\u00a0MB', '1\u00a0GB', '1.3\u00a0GB', '2\u00a0GB',
    ])
  })
})

describe('a body with attachments', () => {
  const body = doc(
    { type: 'paragraph', content: [{ type: 'text', text: 'Before' }, { type: 'image', attrs: { src: PNG, full: { id: '8c1f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1e', type: 'image/png', size: 5 } } }] },
    attachment({ file, name: 'report.pdf' }),
    { type: 'blockquote', content: [attachment({ file: { ...file, id: '9d2f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1f' }, name: 'voice.m4a' })] },
  )

  it('names its attachments’ files with its pictures’ originals, wherever they are', () => {
    expect(filesIn(body).map((named) => named.id)).toEqual(['8c1f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1e', ID, '9d2f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1f'])
    expect(hasAttachment(body)).toBe(true)
    expect(hasAttachment(doc({ type: 'paragraph', content: [{ type: 'text', text: 'None' }] }))).toBe(false)
    // Its pictures' originals alone, which a lock arriving lets go of at once (sync/engine).
    expect(originalsIn(body).map((named) => named.id)).toEqual(['8c1f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1e'])
  })

  it('gives its attachments that still have their files, in order; and a note to keep them in when a lock beats the edit they were in', () => {
    const voice = { file: { ...file, id: '9d2f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1f' }, name: 'voice.m4a' }
    const with_ = doc(...body.content!, attachment({ file: null, name: 'gone.pdf' }), attachment({ file: { id: '../index', type: 'x/y', size: 1 }, name: 'bad.pdf' }), attachment({ file, name: 'a/b/c.pdf', onclick: 'x' }))
    expect(attachedIn(with_)).toEqual([{ file, name: 'report.pdf' }, voice, { file, name: 'c.pdf' }])
    expect(attachedIn(doc({ type: 'paragraph' }))).toEqual([])

    const kept = keptApart(attachedIn(body))
    expect(kept.content!.map((block) => block.type)).toEqual(['paragraph', 'paragraph', 'attachment', 'attachment', 'paragraph'])
    expect(kept.content!.at(-1)).toEqual({ type: 'paragraph' })
    // Titled by its first line, and saying why it's there.
    expect(kept.content![0].content![0].text).toBe('Files from a locked note')
    expect(kept.content![1].content![0].text).toContain('A locked note can’t hold attachments')
    expect(filesIn(kept).map((named) => named.id)).toEqual([ID, voice.file.id])
    // A body as any other: taken in whole.
    expect(filterBodyImages(kept)).toEqual(kept)
  })

  it('is taken in with each attachment as its name and its file and nothing more, and without one that has no name', () => {
    const taken = filterBodyImages(
      doc(
        attachment({ file, name: 'a/b/report.pdf', href: 'https://example.com/x', onclick: 'alert(1)' }),
        attachment({ file: { ...file, id: 'https://example.com/a.pdf' }, name: 'report.pdf' }),
        attachment({ file }),
        { type: 'attachment', attrs: { file, name: 'kept.pdf' }, content: [{ type: 'text', text: 'never inside one' }] },
      ),
    )
    expect(taken.content).toEqual([attachment({ file, name: 'report.pdf' }), attachment({ file: null, name: 'report.pdf' }), attachment({ file, name: 'kept.pdf' })])
  })

  it('leaves Nib with each attachment’s name and nothing of its file, what’s stored as it was', () => {
    const stored = JSON.stringify(body)
    for (const left of [withoutAboutIn(body), withoutOriginals(body)]) {
      expect(JSON.stringify(left)).not.toContain(ID)
      expect(JSON.stringify(left)).not.toContain('9d2f6f0e')
      expect(left.content![1]).toEqual(attachment({ file: null, name: 'report.pdf' }))
      expect(left.content![2].content![0].attrs).toEqual({ file: null, name: 'voice.m4a' })
    }
    expect(JSON.stringify(body)).toBe(stored)
  })
})
