// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { renderDocument } from '../reader/render'
import { snapshot } from '../share'
import { compare } from './compare'
import { toMarkdown } from './markdown'
import { plainText, searchable, titleOf } from './text'

/**
 * An attachment wherever a document is written out without the editor: each
 * says its file's name, and none says which file it is or brings it along
 * (the rule the schema's test in editor/extensions.test holds a new block to).
 */

const ID = '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d'
const attachment = (name: unknown, id = ID): JSONContent => ({ type: 'attachment', attrs: { file: { id, type: 'application/pdf', size: 2_400_000 }, name } })
const para = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

describe('an attachment, written out', () => {
  it('is found by its file’s name in a search, and names a note that holds nothing else; it isn’t counted as writing', () => {
    const body = doc(attachment('Quarterly report.pdf'), para('Read before Friday.'))
    expect(searchable(body)).toContain('quarterly report.pdf')
    // The words are the writer's: the editor's own count leaves a file's name out, and so does this.
    expect(plainText(body).trim()).toBe('Read before Friday.')
    expect(titleOf(body)).toBe('Read before Friday.')
    expect(titleOf(doc(attachment('Quarterly report.pdf'), attachment('Other.pdf')))).toBe('Quarterly report.pdf')
    expect(titleOf(doc(attachment(42)))).toBe('Attachment')
  })

  it('is a line of Markdown that names it and says it isn’t there', () => {
    expect(toMarkdown(doc(para('Minutes'), attachment('Q3 *final* [v2].pdf')))).toBe('Minutes\n\n*Q3 \\*final\\* \\[v2\\].pdf* (attached file, not included)')
    expect(toMarkdown(doc(attachment('report.pdf')))).not.toContain(ID)
  })

  it('is a line in a shared draft that names it, with nothing of the file: the draft is sent without which file it is', () => {
    const sent = snapshot({ kind: 'note', body: doc(para('Minutes'), attachment('report.pdf')) })
    expect(JSON.stringify(sent)).not.toContain(ID)
    expect(sent.body.content![1]).toEqual({ type: 'attachment', attrs: { file: null, name: 'report.pdf' } })
    const into = document.createElement('article')
    renderDocument(sent.body, into)
    const line = into.querySelector('p.attachment')!
    expect(line.textContent).toBe('report.pdf (attached file, not included)')
    expect(line.querySelector('strong')!.textContent).toBe('report.pdf')
    // Whatever a draft says of one, the reader's page draws a name and no more: no link, nothing to fetch.
    const odd = document.createElement('article')
    renderDocument(doc({ type: 'attachment', attrs: { name: '<img src=x onerror=alert(1)>', file: { id: 'https://example.com/a.pdf' }, href: 'https://example.com' } }), odd)
    expect(odd.querySelector('img, a')).toBeNull()
    expect(odd.textContent).toBe('<img src=x onerror=alert(1)> (attached file, not included)')
  })

  it('is compared by its name and its file: one added, taken out or swapped for another shows', () => {
    const then = doc(para('Minutes'), attachment('report.pdf'))
    expect(compare(then, then).every((part) => part.kind === 'same')).toBe(true)
    const added = compare(doc(para('Minutes')), then)
    expect(JSON.stringify(added)).toContain('[Attached: report.pdf]')
    expect(added.some((part) => part.kind !== 'same')).toBe(true)
    expect(compare(then, doc(para('Minutes'))).some((part) => part.kind !== 'same')).toBe(true)
    // The same name over another file is another attachment.
    expect(compare(then, doc(para('Minutes'), attachment('report.pdf', '8c1f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1e'))).some((part) => part.kind !== 'same')).toBe(true)
  })
})
