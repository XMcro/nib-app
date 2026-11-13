import { strToU8, zipSync, type Zippable } from 'fflate'
import type { Item } from '../db/db'
import { fileNamed, printPdf, toHtml } from './documentExport'
import { withoutAboutIn } from './image'
import { toMarkdown } from './markdown'
import { mathFor } from './math'
import { withOriginals } from './originals'
import { coloursFor } from '../editor/codeColours'
import { titleOf } from './text'

/** What several documents picked in the library export as (components/ExportDialog). */
export type ManyFormat = 'md' | 'html' | 'pdf'

export const MANY_FORMATS: ManyFormat[] = ['md', 'html', 'pdf']
export const MANY_NAMES: Record<ManyFormat, string> = { md: 'Markdown', html: 'HTML', pdf: 'PDF' }

/** Markdown is free, always. The others are Nib Plus, as they are for one document. */
export const forPlus = (format: ManyFormat) => format !== 'md'

/**
 * Several documents as one zip, a file each, named for its title: a second of
 * the same name is numbered, whatever its capitals, as a Mac's folder would
 * take the two for one. The system prints a PDF at a time
 * (ios/App/App/NibPdfPlugin.swift), so `making` hears of each as it starts.
 */
export async function zipOf(documents: Item[], format: ManyFormat, making: (which: number, of: number) => void): Promise<Blob> {
  const files: Zippable = {}
  const taken = new Set<string>()
  // Formulas are drawn in HTML and a PDF; Markdown has their LaTeX.
  if (format !== 'md') {
    await mathFor(documents.map((item) => item.body))
    await coloursFor(documents.map((item) => item.body))
  }
  for (const [i, item] of documents.entries()) {
    making(i + 1, documents.length)
    const first = fileNamed(titleOf(item.body), format)
    let name = first
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${first.slice(0, -format.length - 1)} ${n}.${format}`
    taken.add(name.toLowerCase())
    if (format === 'md') {
      files[name] = strToU8(toMarkdown(withoutAboutIn(item.body)))
      continue
    }
    // Its pictures as their originals (lib/originals), a document at a time. Markdown keeps them as the note has them.
    const html = toHtml({ ...item, body: await withOriginals(item.body) })
    files[name] = format === 'pdf' ? await printPdf(html, name) : strToU8(html)
  }
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
}
