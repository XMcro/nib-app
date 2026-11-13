import { strToU8, zipSync, type Zippable } from 'fflate'
import type { Item } from '../db/db'
import { endnotes, markupOf } from './documentExport'
import { IMAGE_SRC, IMAGE_SIZE_RULES } from './image'
import { titleOf } from './text'
import { CALLOUT_CSS } from './callouts'
import { CODE_CSS } from './codeLanguages'

/**
 * A manuscript (lib/manuscript) as an EPUB 3 e-book, for Nib Plus: each
 * chapter a page of XHTML of its own, in book order, a table of contents of
 * their titles, and the pictures as files beside them, each once however
 * often it's used. Footnotes are numbered through the book, each chapter's
 * listed at its end. Styled lightly, so a reader's own font, size and dark
 * mode still apply.
 */

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STYLE = `
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.5em; }
p { margin: 0 0 0.8em; }
img { max-width: 100%; height: auto; }
${IMAGE_SIZE_RULES}
blockquote { margin: 0 0 0.8em; padding-left: 1em; border-left: 3px solid #999; }
pre { white-space: pre-wrap; font-family: monospace; font-size: 0.88em; }
code { font-family: monospace; font-size: 0.88em; }
table { border-collapse: collapse; margin: 0 0 0.8em; }
th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; vertical-align: top; }
th > p, td > p { margin: 0; }
ul[data-type="taskList"] { list-style: none; padding-left: 0.3em; }
li > p { margin: 0 0 0.3em; }
${CALLOUT_CSS}
${CODE_CSS}
div[data-math] { margin: 0 0 0.8em; }
math { font-family: 'STIX Two Math', 'Cambria Math', 'Latin Modern Math', math; }
.notes { font-size: 0.9em; }
hr { border: 0; border-top: 1px solid #999; margin: 2em 0 1em; }
`

function page(title: string, lang: string, body: string, extra = '') {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"${extra} lang="${xml(lang)}" xml:lang="${xml(lang)}">
<head>
<title>${xml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`
}

/** `lang`, the book's language, as BCP 47: the device's, unless said. */
export function compileEpub(title: string, chapters: Item[], lang = navigator.language || 'en', author?: string): Blob {
  // First, and stored as it is: that is how a reader knows what it's been given.
  const files: Zippable = { mimetype: [strToU8('application/epub+zip'), { level: 0 }] }
  const later: Zippable = {}
  const pictures = new Map<string, string>() // a picture's data URI, and its file
  const contents: { file: string; title: string; math: boolean }[] = []
  const serializer = new XMLSerializer()
  let notes = 1

  chapters.forEach((chapter, index) => {
    // Parsed, not assigned to a live element: nothing in it loads or runs.
    const { body } = new DOMParser().parseFromString(`<body>${markupOf(chapter)}</body>`, 'text/html')
    notes += endnotes(body, notes)
    for (const img of body.querySelectorAll('img')) {
      const src = img.getAttribute('src') ?? ''
      let file = pictures.get(src)
      if (!file) {
        const [, type] = IMAGE_SRC.exec(src) ?? []
        if (!type) {
          img.remove()
          continue
        }
        file = `images/picture-${pictures.size + 1}.${type === 'jpeg' ? 'jpg' : type}`
        pictures.set(src, file)
        // Already compressed: stored as it is.
        later[`OEBPS/${file}`] = [Uint8Array.from(atob(src.slice(src.indexOf(',') + 1)), (char) => char.charCodeAt(0)), { level: 0 }]
      }
      img.setAttribute('src', file)
      if (!img.hasAttribute('alt')) img.setAttribute('alt', '')
    }
    const file = `chapter-${index + 1}.xhtml`
    const named = titleOf(chapter.body) || `Chapter ${index + 1}`
    contents.push({ file, title: named, math: body.querySelector('math') !== null })
    // As XML, so it's XHTML: every element closed, every entity one XML knows.
    later[`OEBPS/${file}`] = strToU8(page(named, lang, [...body.childNodes].map((node) => serializer.serializeToString(node)).join('')))
  })

  files['META-INF/container.xml'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`)
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${xml(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">urn:uuid:${crypto.randomUUID()}</dc:identifier>
<dc:title>${xml(title)}</dc:title>
${author ? `<dc:creator>${xml(author)}</dc:creator>\n` : ''}<dc:language>${xml(lang)}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="style" href="style.css" media-type="text/css"/>
${contents.map(({ file, math }, i) => `<item id="chapter-${i + 1}" href="${file}" media-type="application/xhtml+xml"${math ? ' properties="mathml"' : ''}/>`).join('\n')}
${[...pictures.values()].map((file, i) => `<item id="picture-${i + 1}" href="${file}" media-type="image/${file.slice(file.lastIndexOf('.') + 1).replace('jpg', 'jpeg')}"/>`).join('\n')}
</manifest>
<spine>
${contents.map((_, i) => `<itemref idref="chapter-${i + 1}"/>`).join('\n')}
</spine>
</package>
`)
  files['OEBPS/nav.xhtml'] = strToU8(
    page(
      'Contents',
      lang,
      `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${contents.map(({ file, title: named }) => `<li><a href="${file}">${xml(named)}</a></li>`).join('')}</ol></nav>`,
      ' xmlns:epub="http://www.idpf.org/2007/ops"',
    ),
  )
  files['OEBPS/style.css'] = strToU8(STYLE)
  Object.assign(files, later)
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/epub+zip' })
}
