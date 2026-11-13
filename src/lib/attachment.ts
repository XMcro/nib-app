import type { JSONContent } from '@tiptap/core'
import { asFileRef, type FileRef } from './fileRef'

/**
 * An attachment (Nib Plus): any file, kept in the file store beside the
 * library (lib/files) as a picture's original is, and named in its document
 * by a block of its own (editor/Attachment) that holds which file it is and
 * what it was called. Nothing here touches the store, so what checks a
 * document, the reader's page too, can use it.
 */
export type Attached = { file: FileRef | null; name: string }
/** One that still has its file. */
export type WithFile = { file: FileRef; name: string }

const MAX_NAME = 120

/** A file's name as Nib shows it: one line, no folders, not too long. Null for none at all. */
export function asFileName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .split(/[\\/]/)
    .pop()!
    .trim()
    .slice(0, MAX_NAME)
  return name || null
}

/**
 * What an attachment's block holds: its name, and its file if what's said of
 * it is one (lib/fileRef). Without a file it's its name alone, which is how
 * it leaves Nib in a shared draft or an export (lib/image `withoutAboutIn`).
 * Null with no name: nothing to show.
 */
export function asAttached(attrs: unknown): Attached | null {
  const { file, name } = (typeof attrs === 'object' && attrs !== null ? attrs : {}) as Record<string, unknown>
  const named = asFileName(name)
  return named ? { file: asFileRef(file), name: named } : null
}

/** What's said after an attachment's name wherever its document goes without it: a shared draft, an export. */
export const NOT_INCLUDED = 'attached file, not included'

/** An attachment's name as a document's writers show it, whatever is stored there. */
export const attachedName = (node: { attrs?: Record<string, unknown> }) => asFileName(node.attrs?.name) ?? 'Attachment'

/** Whether a body holds an attachment, anywhere in it. */
export const hasAttachment = (body: JSONContent): boolean => body.type === 'attachment' || (body.content ?? []).some(hasAttachment)

/** A body's attachments that still have their files, in the order it has them. */
export function attachedIn(body: JSONContent, found: WithFile[] = []): WithFile[] {
  const attached = body.type === 'attachment' ? asAttached(body.attrs) : null
  if (attached?.file) found.push({ file: attached.file, name: attached.name })
  body.content?.forEach((child) => attachedIn(child, found))
  return found
}

/**
 * The note that an edit's attachments are kept in when a lock beats the edit
 * (db/items `addCopy`): the edit's text becomes a locked note, which can't
 * hold them, and without this their files would have nothing naming them.
 */
export const keptApart = (attached: Attached[]): JSONContent => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Files from a locked note' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'These were attached to a note as it was being locked. A locked note can’t hold attachments, so they’re kept here.' }] },
    ...attached.map((attrs) => ({ type: 'attachment', attrs })),
    // A line to write on: opened with a file as its last block, the note came up with that file's card selected.
    { type: 'paragraph' },
  ],
})

/** A size as a writer reads one: KB, MB to the nearest, or GB to a tenth. The number stays on a line with its unit: a phone broke "2 GB" in two. */
export const sizeText = (bytes: number) =>
  bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : bytes < 1_000_000_000 ? `${Math.round(bytes / 1_000_000)} MB` : `${(bytes / 1_000_000_000).toFixed(1).replace(/\.0$/, '')} GB`

const KINDS: [RegExp, string][] = [
  [/^application\/pdf$/, 'PDF'],
  [/^audio\//, 'Audio'],
  [/^video\//, 'Video'],
  [/^image\//, 'Picture'],
  [/^text\/csv$|spreadsheet|ms-excel/, 'Spreadsheet'],
  [/wordprocessing|msword|rtf$/, 'Document'],
  [/presentation|ms-powerpoint/, 'Presentation'],
  [/^text\//, 'Text'],
  [/zip|compressed|x-tar|gzip/, 'Archive'],
]

/** What kind of file it is, in a word, from its media type: "File" where that says nothing. */
export const kindOf = (type: string) => KINDS.find(([test]) => test.test(type.toLowerCase()))?.[1] ?? 'File'

/** What's said with an attachment's name: its kind and its size, or, where it has gone without its file, that it has. */
export const aboutOf = ({ file }: Attached) => (file ? `${kindOf(file.type)} · ${sizeText(file.size)}` : NOT_INCLUDED)
