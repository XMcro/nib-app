// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { Item } from '../db/db'
import { compileEpub } from './epub'

/** What of an EPUB needs no real browser. The rest, pictures among it, is in epub.browser.test.ts. */

describe('a manuscript as an EPUB', () => {
  // XML has no way to write most control characters: one pasted or imported into a chapter, and a strict reader refused the book.
  it('leaves out the control characters XML can’t hold, in the text and in the titles', async () => {
    const words = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const chapter: Item = { id: 'one', kind: 'page', body: { type: 'doc', content: [words('A bell\u0007 rang\u000B\u0001'), words('kept\ttab')] }, createdAt: 1, updatedAt: 1, version: 1 }
    const files = unzipSync(new Uint8Array(await compileEpub('The\u0001 Harbour', [chapter], 'en-GB').arrayBuffer()))
    for (const name of ['OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/chapter-1.xhtml']) {
      const text = strFromU8(files[name])
      // eslint-disable-next-line no-control-regex
      expect(text, name).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/)
      expect(new DOMParser().parseFromString(text, 'application/xml').getElementsByTagName('parsererror'), name).toHaveLength(0)
    }
    expect(strFromU8(files['OEBPS/chapter-1.xhtml'])).toContain('A bell rang')
    expect(strFromU8(files['OEBPS/chapter-1.xhtml'])).toContain('kept\ttab')
    expect(strFromU8(files['OEBPS/content.opf'])).toContain('The Harbour')
  })

  // Only a backup made by hand can hold one: reading it threw, and no book was made.
  it('goes without a picture that isn’t base64 through and through', async () => {
    const chapter: Item = { id: 'one', kind: 'page', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Words' }, { type: 'image', attrs: { src: 'data:image/png;base64,A' } }] }] }, createdAt: 1, updatedAt: 1, version: 1 }
    const files = unzipSync(new Uint8Array(await compileEpub('Book', [chapter], 'en-GB').arrayBuffer()))
    expect(strFromU8(files['OEBPS/chapter-1.xhtml'])).toContain('Words')
    expect(strFromU8(files['OEBPS/chapter-1.xhtml'])).not.toContain('<img')
    expect(Object.keys(files).filter((name) => name.includes('images/'))).toEqual([])
  })
})
