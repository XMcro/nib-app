// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { generateHTML, generateJSON } from '@tiptap/html'
import type { JSONContent } from '@tiptap/react'
import { markdownToBody } from '../lib/import'
import { nibExtensions } from './extensions'

function shouldAutoLink(url: string): boolean {
  const link = nibExtensions(false).find((extension) => extension.name === 'link')
  if (!link) throw new Error('the link extension is no longer registered')
  const { shouldAutoLink: rule } = link.options as { shouldAutoLink: (url: string) => boolean }
  return rule(url)
}

/** The link mark on the first inline child, if there is one. */
function linkAttrs(markdown: string) {
  const body = markdownToBody(markdown, 'note')
  const marks = (body.content?.[0].content ?? []).flatMap((child) => child.marks ?? [])
  return marks.find((mark) => mark.type === 'link')?.attrs
}

describe('the schema', () => {
  // A document is written out by these names in five places, and what one of them doesn't
  // know it drops or flattens, without a word: reader/render (a shared draft), lib/markdown,
  // lib/documentExport, lib/compare and lib/text. A new name fails here until all five have been looked at.
  it('has the nodes and marks the writers have been looked at for', () => {
    const { nodes, marks } = getSchema(nibExtensions(true))
    expect(Object.keys(nodes).sort()).toEqual(['attachment', 'blockquote', 'bulletList', 'callout', 'codeBlock', 'doc', 'footnote', 'hardBreak', 'heading', 'image', 'listItem', 'mathBlock', 'mathInline', 'noteLink', 'orderedList', 'paragraph', 'table', 'tableCell', 'tableHeader', 'tableRow', 'taskItem', 'taskList', 'text'])
    expect(Object.keys(marks).sort()).toEqual(['bold', 'code', 'highlight', 'italic', 'link', 'noteToSelf', 'strike', 'underline'])
  })
})

describe('code blocks', () => {
  const block = (language: string): JSONContent => ({
    type: 'doc',
    content: [{ type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text: 'x' }] }],
  })
  const language = (html: string) => generateJSON(html, nibExtensions(false)).content?.[0].attrs?.language

  // A block's language becomes its class, so one with spaces in it (pasted
  // from VS Code, or synced) brought in any classes at all, Tailwind's too.
  it('render only a language’s name as their class', () => {
    expect(generateHTML(block('x fixed inset-0 z-50'), nibExtensions(false))).not.toContain('fixed')
    expect(generateHTML(block('c++'), nibExtensions(false))).toContain('<code class="language-c++">')
  })

  it('read only a language’s name from pasted HTML', () => {
    expect(language('<pre><code class="language-typescript">x</code></pre>')).toBe('typescript')
    expect(language(`<pre><code class="language-${'x'.repeat(40)}">x</code></pre>`)).toBeNull()
  })
})

describe('SafeLink', () => {
  // marked passes raw HTML straight through, so an imported file decides these
  // attributes unless parseHTML refuses to read them.
  it('ignores target, rel and class on an imported anchor', () => {
    const attrs = linkAttrs(
      '<a href="https://evil.test" class="fixed inset-0 z-50" rel="opener" target="_self">x</a>',
    )
    expect(attrs?.href).toBe('https://evil.test')
    expect(attrs?.class).toBeNull()
    expect(attrs?.rel).toBe('noopener noreferrer nofollow')
    expect(attrs?.target).toBe('_blank')
  })

  // Synced, restored or stored, a link never goes through parseHTML. One with
  // these attributes drew as an invisible link over the whole page, which
  // swallowed every tap, and HTML export carried them along.
  it('renders the safe target and rel, and no class, whatever a stored link says', () => {
    const stored: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://good.test', class: 'fixed inset-0 z-50 opacity-0', target: '_self', rel: 'opener' } }] }],
        },
      ],
    }
    const html = generateHTML(stored, nibExtensions(false))
    expect(html).not.toContain('fixed')
    expect(html).not.toContain('_self')
    expect(html).not.toMatch(/rel="opener"/)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
  })

  it('still refuses a javascript: href', () => {
    expect(linkAttrs('<a href="javascript:alert(1)">x</a>')).toBeUndefined()
    expect(linkAttrs('[x](javascript:alert(1))')).toBeUndefined()
  })

  it('keeps ordinary links working', () => {
    expect(linkAttrs('[x](https://good.test/a)')?.href).toBe('https://good.test/a')
  })
})

/**
 * THIS IS A SECURITY GUARD. The image node declares only `src` and `alt`, and
 * refuses any src that is not one of our own data URIs — so an imported file
 * cannot make the editor fetch a remote address, and cannot smuggle `class`,
 * `style` or `onerror` onto an element. Do not loosen these without a reason
 * written down beside them.
 */
describe('images from imported markup', () => {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  /** Through the import path, which rewrites unusable images before the schema. */
  const imageIn = (html: string) => {
    const body = markdownToBody(html, 'note')
    return (body.content?.[0].content ?? []).find((node) => node.type === 'image')
  }

  /**
   * Straight at the schema, bypassing that rewrite. This is what pins the
   * node's OWN guard: without it the import rewrite alone would keep these
   * tests green, and the schema would happily accept a remote src from any
   * other caller.
   */
  const parsedDirectly = (html: string) => {
    const body = generateJSON(html, nibExtensions(false)) as JSONContent
    return (body.content?.[0].content ?? []).find((node) => node.type === 'image')
  }

  it('accepts one of our own data URIs', () => {
    expect(imageIn(`<p><img src="${PNG}" alt="a cat"></p>`)?.attrs).toEqual({
      src: PNG,
      alt: 'a cat',
      drawing: null,
      full: null,
    })
  })

  it.each([
    'https://evil.test/pixel.png',
    'blob:https://evil.test/abc',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  ])('creates no node for %s, on the import path', (src) => {
    expect(imageIn(`<p><img src="${src}"></p>`)).toBeUndefined()
  })

  it.each([
    'https://evil.test/pixel.png',
    'blob:https://evil.test/abc',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'javascript:alert(1)',
  ])('creates no node for %s, straight at the schema', (src) => {
    expect(parsedDirectly(`<p><img src="${src}"></p>`)).toBeUndefined()
  })

  it('accepts one of ours straight at the schema', () => {
    expect(parsedDirectly(`<p><img src="${PNG}" alt="ok"></p>`)?.attrs).toEqual({
      src: PNG,
      alt: 'ok',
      drawing: null,
      full: null,
      size: null,
    })
  })

  // A size is one of four words, for the stylesheet: never a width a file brings.
  it('reads a size it knows, and no width of a file’s own', () => {
    expect(parsedDirectly(`<p><img src="${PNG}" data-size="medium"></p>`)?.attrs?.size).toBe('medium')
    for (const odd of ['data-size="huge"', 'data-size="50%"', 'width="900"', 'style="width: 900px"', 'size="small"']) {
      expect(parsedDirectly(`<p><img src="${PNG}" ${odd}></p>`)?.attrs?.size).toBeNull()
    }
    // Through an import, a picture with no size is stored as it always was, and one with a size keeps it.
    expect(imageIn(`<p><img src="${PNG}" alt="x" data-size="large"></p>`)?.attrs).toEqual({ src: PNG, alt: 'x', drawing: null, full: null, size: 'large' })
  })

  it('writes a size as the one attribute the stylesheet reads, and none it doesn’t know', () => {
    const html = (size: unknown) => generateHTML({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: PNG, alt: '', size } }] }] }, nibExtensions(false))
    expect(html('small')).toContain('data-size="small"')
    expect(html(null)).not.toContain('data-size')
    expect(html('100%" onerror="alert(1)')).not.toContain('data-size')
  })

  it('reads no attribute it does not declare, and never a sketch\'s drawing', () => {
    const attrs = imageIn(
      `<p><img src="${PNG}" alt="x" class="fixed inset-0" style="position:fixed" onerror="alert(1)" drawing="QUJD" data-drawing="QUJD"></p>`,
    )?.attrs
    // Nor an original in the file store that markup from elsewhere claims with anything but an id, a kind and a size (editor/original.browser.test).
    expect(attrs).toEqual({ src: PNG, alt: 'x', drawing: null, full: null })
  })
})

/**
 * THIS IS A SECURITY GUARD. Stored JSON never goes through parseHTML —
 * `Node.fromJSON` copies `src` onto the node and `renderHTML` is what would
 * put it on an `<img>`. IndexedDB is not a trusted renderer input.
 */
describe('images from stored JSON', () => {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  const rendered = (src: string) =>
    generateHTML(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'image', attrs: { src, alt: 'x' } }],
          },
        ],
      },
      nibExtensions(false),
    )

  it('still renders one of our own data URIs', () => {
    expect(rendered(PNG)).toContain(`src="${PNG}"`)
  })

  it.each([
    'https://evil.test/pixel.png',
    'javascript:alert(1)',
    'blob:https://evil.test/abc',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  ])('does not emit a fetchable src for %s', (src) => {
    const html = rendered(src)
    expect(html).not.toContain(src)
    expect(html).not.toMatch(/<img\b/i)
  })
})

// ProseMirror needs layout, which jsdom does not have, so a real editor cannot
// be typed into here. These cover the rule the autolink plugin is given, which
// receives the text as written rather than the resolved href.
describe('autolink', () => {
  it.each(['README.md', 'build.sh', 'main.py', 'setup.py', 'notes.md'])(
    'leaves the filename %s alone',
    (text) => expect(shouldAutoLink(text)).toBe(false),
  )

  it.each(['https://good.test/a', 'http://good.test', 'www.good.test', 'someone@good.test'])(
    'still links %s',
    (text) => expect(shouldAutoLink(text)).toBe(true),
  )
})
