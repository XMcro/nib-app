import type { Editor } from '@tiptap/core'
import { coverOf } from './components/stampCover'
import type { Item, Kind } from './db/db'
import * as items from './db/items'
import { CSV_ACCEPT, insertTable, pickFile, rowsOf, tableAtCaret, tableFromCsv, toCsv } from './editor/tableCsv'
import { BackupError, restoreBackup, takeBackup } from './lib/backup'
import { count } from './lib/counts'
import { bookFilename, compileDocx, csvFilename, compileHtml, documentFilename, makeFile, standardDocx, standardHtml, toDocx, toHtml, type BookFormat, type RichFormat } from './lib/documentExport'
import { download, SaveRefused } from './lib/download'
import { asCategories, asFolder } from './lib/folders'
import { compileEpub } from './lib/epub'
import { buildExport, exportFilename } from './lib/export'
import { forPlus, zipOf, type ManyFormat } from './lib/exportMany'
import { importedWords, readImportFile, type AskPassword, type Imported } from './lib/importApps'
import { linkWikiLinks } from './lib/links'
import { ACCENTS, type Accent } from './lib/look'
import { bookOf, partPage, runningHead, titlePage, type Part } from './lib/manuscript'
import { readFolderSettings } from './lib/folderSettings'
import { mathFor } from './lib/math'
import { withOriginals } from './lib/originals'
import { coloursFor } from './editor/codeColours'
import { gathered } from './lib/placed'
import type { Sort } from './lib/sort'
import { countWords } from './lib/stats'
import { plainText, titleOf } from './lib/text'
import type { Theme } from './lib/theme'
import type { OpenDocument } from './lib/useOpenDocument'
import * as vault from './lib/vault'

/** Why the Plus sheet opened, when a manuscript was to be compiled without it. */
const COMPILE_PLUS = 'Compiling a manuscript into one Word, PDF or EPUB file is part of Nib Plus.'

/** Why the Plus sheet opened, when Word, PDF or HTML was asked for without it. */
export const RICH_EXPORT_PLUS = 'Word, PDF and HTML export are part of Nib Plus. Markdown export is free, always.'

/** A locked document asked for with the vault shut. */
const LOCKED_EXPORT = 'This is locked. Open the vault to export it.'

/** What to say when a file didn't leave Nib: on the Mac, a folder that wouldn't take it (lib/download), else `otherwise`. */
const notHanded = (error: unknown, otherwise: string) => (error instanceof SaveRefused ? 'That folder wouldn’t take the file. Try another, such as Downloads.' : otherwise)

/** Everything that leaves Nib as a file or comes in from one: saved first, then read from the database, then handed over. */
export function fileActions({
  session,
  setNotice,
  features,
  askPlus,
  everything,
  theme,
  sort,
  setImportReport,
  onRestored,
  askPassword,
}: {
  session: OpenDocument
  setNotice: (notice: string) => void
  /** Plus's features are open. */
  features: boolean
  askPlus: (reason: string) => void
  everything: Item[]
  theme: Theme
  sort: Sort
  setImportReport: (report: { imported: Kind[]; skipped: string[] }) => void
  /** A backup has replaced the library: the theme and sort it brought take effect, and the library shows it from the top. */
  onRestored: () => void
  /** Asks the writer for the password of a file being imported that needs one (ColorNote's backup). */
  askPassword?: AskPassword
}) {
  const { flush, whenSaved, guarded, currentKind, dropPending, resetToDraft, setConflict, setSaveFailed } = session

  // Not awaited inside guarded(): handing a file over is not storage, and a
  // failed share reported as "Can't save to this device" would be a lie.
  function handOver(content: string, filename: string, type?: string) {
    download(content, filename, type).catch((error: unknown) => {
      console.warn('Nib: could not hand the file over', error)
      setNotice(notHanded(error, 'Couldn’t hand that file over. Your writing is safe here.'))
    })
  }

  async function exportAll() {
    count('export_all')
    // Wait for the edit still sitting in the debounce, then read the database
    // rather than this render's live-query arrays, which have not refreshed yet.
    await flush()
    await guarded(async () => {
      const at = Date.now()
      const { notes, pages, archived, templates } = items.sortOut(await items.listAll())
      // The archive and the templates are put away, not left behind.
      const apart = [...archived, ...templates]
      const savedNotes = [...notes, ...apart.filter((item) => item.kind === 'note')]
      const savedPages = [...pages, ...apart.filter((item) => item.kind === 'page')]
      // Locked documents stay locked: their text isn't in the file. A backup carries them, sealed.
      const unlocked = (list: Item[]) => list.filter((item) => !vault.isLocked(item))
      handOver(buildExport(unlocked(savedNotes), unlocked(savedPages), at), exportFilename(at))
      if ([...savedNotes, ...savedPages].some(vault.isLocked)) {
        setNotice('Locked notes aren’t in the export. Remove a lock to export that note.')
      }
    })
  }

  function exportTableCsv(editor: Editor) {
    const table = tableAtCaret(editor)
    if (table) handOver(toCsv(rowsOf(table)), csvFilename(editor.getJSON()), 'text/csv;charset=utf-8')
  }

  async function insertTableCsv(editor: Editor) {
    const file = await pickFile(CSV_ACCEPT)
    if (!file) return
    try {
      const read = tableFromCsv(new Uint8Array(await file.arrayBuffer()))
      if ('problem' in read) setNotice(read.problem)
      else insertTable(editor, read.table)
    } catch (error) {
      console.warn('Nib: could not read that CSV', error)
      setNotice('Couldn’t read that file.')
    }
  }

  async function exportCurrent() {
    // Awaited so a draft that has never been saved has an id by now, rather
    // than exporting nothing at all.
    await whenSaved(async (id) => {
      count('export_markdown')
      await guarded(async () => {
        const stored = await items.get(id)
        // A locked document exports only while the vault is open to it, as it is on screen.
        const item = stored && (await items.opened(stored))
        if (!item) {
          if (stored) setNotice(LOCKED_EXPORT)
          return
        }
        const at = Date.now()
        const [notesOnly, pagesOnly] = item.kind === 'note' ? [[item], []] : [[], [item]]
        handOver(buildExport(notesOnly, pagesOnly, at), exportFilename(at))
      })
    })
  }

  /**
   * A manuscript (lib/manuscript) as one Word, PDF or EPUB file, for Nib Plus: its
   * chapters as stored once the open one is saved, locked ones as the open
   * vault lets them out. One it can't open is left out, and said so. Before
   * them, a cover with their stamps, if they wear any (components/stampCover).
   */
  /** `standard`: in standard manuscript format (lib/manuscript Standard), as Word or PDF, with no cover. */
  async function compileManuscript(folder: string, parts: Part[], format: BookFormat, standard = false) {
    if (!features) return askPlus(COMPILE_PLUS)
    const chapters = parts.flatMap((part) => part.chapters)
    // As it's been given in its Manuscript (lib/manuscript bookOf), on a page of its own after the cover.
    const { title, author } = bookOf(folder, readFolderSettings())
    await flush()
    let readable: Item[] = []
    await guarded(async () => {
      const stored = await Promise.all(chapters.map((chapter) => items.get(chapter.id)))
      const open = await Promise.all(stored.map((item) => (item ? items.opened(item) : null)))
      readable = open.filter((item): item is Item => item !== null)
      if (readable.length === 0 && stored.some(Boolean)) setNotice('Every page in this book is locked. Open the vault to compile it.')
    })
    if (readable.length === 0) return
    // A cover that can't be drawn is left off, not the book. A standard manuscript has none.
    const cover = standard
      ? null
      : await coverOf(title, gathered(readable)).catch((error: unknown) => {
          console.warn('Nib: could not draw the cover', error)
          return null
        })
    // Each part under its name, on a page of its own before its first chapter: those of its chapters that could be opened, and none of a part with none.
    const opened = new Map(readable.map((chapter) => [chapter.id, chapter]))
    const pages = parts.flatMap((part) => {
      const own = part.chapters.flatMap((chapter) => opened.get(chapter.id) ?? [])
      return part.name !== null && own.length > 0 ? [partPage(part.name), ...own] : own
    })
    // Each picture as its original, where this device has it (lib/originals).
    const book: Item[] = []
    // A standard manuscript makes its own first page (lib/documentExport standardDocx).
    for (const page of standard ? pages : [...(cover ? [cover] : []), titlePage(title, author), ...pages]) book.push({ ...page, body: await withOriginals(page.body) })
    // Its formulas are drawn in a PDF and an e-book; Word has their LaTeX.
    if (format !== 'docx') await mathFor(book.map((chapter) => chapter.body))
    await coloursFor(book.map((chapter) => chapter.body))
    const name = bookFilename(title, format)
    // Its length as the Manuscript gives it: the chapters' words, those that could be opened.
    const manuscript = { title, author, words: readable.reduce((sum, chapter) => sum + countWords(plainText(chapter.body)), 0) }
    const made =
      format === 'epub'
        ? Promise.resolve().then(() => download(compileEpub(title, book, undefined, author), name))
        : standard
          ? makeFile(format, name, { docx: () => standardDocx(manuscript, book), html: () => standardHtml(manuscript, book), header: runningHead(manuscript) })
          : makeFile(format, name, { docx: () => compileDocx(title, book), html: () => compileHtml(title, book) })
    const handed = await made.then(
      () => true,
      (error: unknown) => {
        console.warn('Nib: could not compile', error)
        setNotice(notHanded(error, 'Couldn’t compile that. Your writing is safe here.'))
        return false
      },
    )
    const left = chapters.length - readable.length
    if (handed && left > 0) setNotice(left === 1 ? 'One locked page couldn’t be opened, so it isn’t in the book.' : `${left} locked pages couldn’t be opened, so they aren’t in the book.`)
  }

  /** Word, PDF or HTML, for Nib Plus. The system prints the PDF (ios/App/App/NibPdfPlugin.swift). */
  async function exportCurrentAs(format: RichFormat) {
    await whenSaved(async (id) => {
      if (!features) return
      let item: Item | undefined | null
      await guarded(async () => {
        const stored = await items.get(id)
        item = stored && (await items.opened(stored))
        if (stored && !item) setNotice(LOCKED_EXPORT)
      })
      if (!item) return
      count(format === 'docx' ? 'export_word' : format === 'pdf' ? 'export_pdf' : 'export_html')
      const written = { ...item, body: await withOriginals(item.body) }
      if (format !== 'docx') await mathFor([written.body])
      await coloursFor([written.body])
      const made = makeFile(format, documentFilename(written, format), { docx: () => toDocx(written), html: () => toHtml(written) })
      // Making or handing over the file, not storage: see handOver.
      await made.catch((error: unknown) => {
        console.warn('Nib: could not export', error)
        setNotice(notHanded(error, 'Couldn’t export that. Your writing is safe here.'))
      })
    })
  }

  /**
   * The documents picked in the library (components/Library) as one zip, a
   * file each (lib/exportMany): Markdown, or HTML or PDF for Nib Plus. As
   * stored once the open one is saved, locked ones as the open vault lets
   * them out. One it can't open is left out, and said so.
   */
  async function exportMany(ids: string[], format: ManyFormat, making: (which: number, of: number) => void) {
    if (forPlus(format) && !features) return askPlus(RICH_EXPORT_PLUS)
    await flush()
    let readable: Item[] = []
    let left = 0
    await guarded(async () => {
      const stored = (await Promise.all(ids.map((id) => items.get(id)))).filter((item) => item !== undefined)
      const open = await Promise.all(stored.map((item) => items.opened(item)))
      readable = open.filter((item) => item !== null)
      left = stored.length - readable.length
    })
    if (readable.length === 0) {
      if (left) setNotice(left === 1 ? LOCKED_EXPORT : 'These are locked. Open the vault to export them.')
      return
    }
    count(format === 'md' ? 'export_markdown' : format === 'pdf' ? 'export_pdf' : 'export_html')
    // Making or handing over the file, not storage: see handOver.
    const handed = await zipOf(readable, format, making)
      .then((zip) => download(zip, exportFilename(Date.now(), 'zip')))
      .then(
        () => true,
        (error: unknown) => {
          console.warn('Nib: could not export', error)
          setNotice(notHanded(error, 'Couldn’t export those. Your writing is safe here.'))
          return false
        },
      )
    if (handed && left > 0) setNotice(left === 1 ? 'One locked note couldn’t be opened, so it isn’t in the zip.' : `${left} locked notes couldn’t be opened, so they aren’t in the zip.`)
  }

  /** Markdown, or another app's export (lib/importApps). Says what came in, and what didn't and why. */
  async function importFiles(files: File[]) {
    count('import_started')
    flush()
    await guarded(async () => {
      const imported: Imported[] = []
      const skipped: string[] = []
      for (const file of files) {
        const result = await readImportFile(file, currentKind(), askPassword)
        imported.push(...result.documents)
        skipped.push(...result.skipped)
      }
      // [[Title]] becomes a link where a note has that title: one already
      // here, or, first, one from this same import.
      const ids = imported.map(() => crypto.randomUUID())
      const byTitle = new Map<string, string>()
      for (const item of everything) byTitle.set(titleOf(item.body).toLowerCase(), item.id)
      imported.forEach((document, i) => byTitle.set(titleOf(document.body).toLowerCase(), ids[i]))
      // An Obsidian vault's folders and tags, and Keep's labels, come in with Nib Plus: a folder as one, and a
      // tag or a label as a category, in the colour one of its name has here already, or the next of Customize's.
      const colors = new Map<string, Accent>()
      for (const item of everything) for (const category of item.categories ?? []) colors.set(category.name.toLocaleLowerCase(), category.color)
      const accents = Object.keys(ACCENTS) as Accent[]
      const colored = (name: string) => {
        const key = name.toLocaleLowerCase()
        if (!colors.has(key)) colors.set(key, accents[colors.size % accents.length])
        return { name, color: colors.get(key)! }
      }
      const bodies = linkWikiLinks(
        imported.map((document, i) => ({ id: ids[i], body: document.body, vault: document.vault })),
        (title) => byTitle.get(title.toLowerCase()),
      )
      await items.createMany(
        imported.map((document, i) => ({
          kind: document.kind,
          body: bodies[i],
          id: ids[i],
          createdAt: document.createdAt,
          updatedAt: document.updatedAt ?? document.createdAt,
          pinnedAt: document.pinned ? Date.now() : undefined,
          archivedAt: document.archived ? Date.now() : undefined,
          folder: features ? (asFolder(document.folder) ?? undefined) : undefined,
          categories: features ? asCategories(document.tags?.map(colored)) : undefined,
        })),
      )
      // Said once for each place they came from, in its own words for them.
      if (!features) for (const what of new Set(imported.filter((document) => document.folder || document.tags?.length).map((document) => document.filing ?? 'Folders and tags'))) skipped.push(`${what}, which come in with Nib Plus`)
      if (skipped.length) setImportReport({ imported: imported.map((document) => document.kind), skipped })
      else setNotice(`Imported ${importedWords(imported.map((document) => document.kind))}.`)
    })
  }

  async function backupAll() {
    await flush()
    await guarded(async () => {
      const { content, filename, type } = await takeBackup({ theme, sort })
      handOver(content, filename, type)
    })
  }

  /** Says whether it was restored. */
  async function restoreFromFile(file: File): Promise<boolean> {
    // Drop anything still in the debounce: the backup is about to replace the
    // database, and a later flush must not write the old editor into it.
    dropPending()
    await flush()
    try {
      await restoreBackup(await file.text())
      onRestored()
      setConflict(null)
      resetToDraft()
      setNotice('Your backup is restored.')
      return true
    } catch (error) {
      // Deliberately not `guarded`: a rejected backup is almost always the
      // writer picking the wrong file, and "Can’t save to this device" sends
      // them hunting a storage fault that is not there — and stays up until
      // the next successful save. BackupError already says what is wrong, so
      // show that. Anything else really is the database failing.
      console.error('Nib: could not restore backup', error)
      if (error instanceof BackupError) setNotice(error.message)
      else setSaveFailed(true)
      return false
    }
  }

  return { exportAll, exportCurrent, exportTableCsv, insertTableCsv, compileManuscript, exportCurrentAs, exportMany, importFiles, backupAll, restoreFromFile }
}
