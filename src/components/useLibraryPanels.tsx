import { useState, type RefObject } from 'react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import type { Item } from '../db/db'
import * as items from '../db/items'
import { notesAndTks, showNote } from '../editor/NoteToSelf'
import { useCounted } from '../lib/counts'
import type { BookFormat } from '../lib/documentExport'
import { moved, under } from '../lib/folders'
import { bookOf, partsOf, type Part } from '../lib/manuscript'
import { readFolderSettings } from '../lib/folderSettings'
import { submissionsOf, SUBMISSIONS_PLUS, useSubmissions, type Piece } from '../lib/submissions'
import type { Trim } from '../lib/printBook'
import { gathered } from '../lib/placed'
import { isLocked, shownTitle, vaultOpen } from '../lib/vault'
import { nativeApp } from '../lib/platform'
import { useHistory } from '../lib/useHistory'
import { AttachmentsPanel } from './AttachmentsPanel'
import type { useLibraryView } from '../lib/useLibraryView'
import type { OpenDocument } from '../lib/useOpenDocument'
import { liveShare, stopSharing } from '../share'
import { findQuote } from '../share/anchor'
import { HistoryPanel } from './HistoryPanel'
import { ManuscriptPanel } from './ManuscriptPanel'
import type { FindSeed } from '../editor/FindBar'
import { NotesPanel } from './NotesPanel'
import { NotesToSelfPanel } from './NotesToSelfPanel'
import { SubmissionsPanel } from './SubmissionsPanel'
import { FoldersPanel } from './Places'
import { TrashList } from './TrashList'

/**
 * What the library shows in place of its cards, and the ways to each. More
 * than one can be asked for at once, so which wins is said once, here: notes
 * on the document, then folders, then History, then attachments, then the trash. Each flag
 * stays as it was under another, and shows when that one closes.
 */
export function useLibraryPanels({ session, view, activeItem, documents, pages, trash, editorRef, setNotice, hideListOverText, showInLibrary, open, openAt, compile, listen, askPlus, onLimit, unlimited, features, keepsAll }: {
  session: OpenDocument
  view: Pick<ReturnType<typeof useLibraryView>, 'viewingTrash' | 'setViewingTrash' | 'place' | 'setPlace' | 'library'>
  activeItem: Item | undefined
  /** Every note and page not in the trash, the archive's too: what the attachments list goes through. */
  documents: Item[]
  pages: Item[]
  trash: Item[]
  /** The open document's editor. */
  editorRef: RefObject<TiptapEditor | null>
  setNotice: (notice: string) => void
  hideListOverText: () => void
  /** Brings the library up, out of focus mode, around whatever `open` puts in it. */
  showInLibrary: (open: () => void) => void
  /** A document opened from the library. */
  open: (id: string) => void
  /** A chapter opened at a match of its book's find, its find bar open on it. */
  openAt: (id: string, seed: FindSeed) => void
  /** A manuscript as one Word, PDF or EPUB file (Nib Plus). */
  compile: (folder: string, parts: Part[], format: BookFormat, standard?: boolean, print?: { trim: Trim; dropCaps: boolean }) => Promise<unknown>
  /** The book as audio (fileActions listenToManuscript). */
  listen: (folder: string, parts: Part[]) => Promise<unknown>
  askPlus: (reason: string) => void
  onLimit: (kind: 'folder' | 'category' | 'look') => void
  /** Nib Plus: no limit on folders and categories. */
  unlimited: boolean
  /** Plus's features are open. */
  features: boolean
  /** Nib Plus, or a synced library: History shows every version, not the last 30 days. */
  keepsAll: boolean
}) {
  const { kind, activeId, guarded } = session
  const { viewingTrash, setViewingTrash, place, setPlace, library } = view
  const [viewingHistory, setViewingHistory] = useState(false)
  // Readers' notes on a shared draft, or the writer's own and the TKs: in the library, like History.
  const [viewingNotes, setViewingNotes] = useState<false | 'readers' | 'self'>(false)
  const [managing, setManaging] = useState(false)
  const [viewingAttachments, setViewingAttachments] = useState(false)
  // The submission tracker (lib/submissions): one piece's, or all of them.
  const [viewingSubmissions, setViewingSubmissions] = useState<Piece | 'all' | null>(null)
  const submissions = useSubmissions()

  /** A piece as the library says it: a document's title, a locked one's as the vault lets it be said, a book's own. */
  function pieceTitle(piece: Piece): string {
    if ('book' in piece) return bookOf(piece.book, readFolderSettings()).title
    const item = [...documents, ...trash].find((one) => one.id === piece.document)
    return item ? shownTitle(item) : 'A deleted note'
  }

  /** A submission's piece: a document opened, or a book's folder shown in Pages, its Manuscript a tap away. */
  function openPiece(piece: Piece) {
    setViewingSubmissions(null)
    if ('document' in piece) open(piece.document)
    else setPlace({ folder: piece.book })
  }
  useCounted(viewingNotes === 'self', 'notes_to_self_opened')
  const history = useHistory({ viewing: viewingHistory, close: () => setViewingHistory(false), session, setNotice })

  function showQuote(quote: string) {
    const editor = editorRef.current
    const range = editor && findQuote(editor.state.doc, quote)
    if (!range) return
    hideListOverText()
    editor!.chain().focus().setTextSelection(range).scrollIntoView().run()
  }

  /** A row of the Notes list, found again in the text as it is now. */
  function showNoteOrTk(key: string) {
    const editor = editorRef.current
    const entry = editor && notesAndTks(editor.state.doc).find((one) => one.key === key)
    if (!entry) return
    hideListOverText()
    if (entry.kind === 'note') showNote(editor!, entry.id, entry.from)
    else editor!.chain().focus().setTextSelection({ from: entry.from, to: entry.to }).scrollIntoView().run()
  }

  const panel =
    // Not a locked document's once the vault is shut: the editor that held its text is still there for one more drawing.
    viewingNotes === 'self' && activeItem && editorRef.current && !(isLocked(activeItem) && !vaultOpen()) ? (
      <NotesToSelfPanel doc={editorRef.current.state.doc} onBack={() => setViewingNotes(false)} onShow={showNoteOrTk} />
    ) : viewingNotes === 'readers' && activeItem && liveShare(activeItem) ? (
      <NotesPanel
        share={liveShare(activeItem)!}
        onBack={() => setViewingNotes(false)}
        isCurrent={(quote) => (editorRef.current ? findQuote(editorRef.current.state.doc, quote) !== null : true)}
        onShow={showQuote}
      />
    ) : managing ? (
      <FoldersPanel
        library={library}
        onBack={() => setManaging(false)}
        run={(action) => void guarded(action)}
        unlimited={unlimited}
        onLimit={onLimit}
        templates={documents.filter((item) => item.template === true && !isLocked(item))}
        onRenamed={(from, to) => {
          // A folder shown goes on showing under its new name, and one inside a folder renamed, under that one's.
          if (place && 'folder' in place && under(place.folder, from)) setPlace({ folder: moved(place.folder, from, to)! })
          else if (place && 'category' in place && place.category === from) setPlace({ category: to })
        }}
      />
    ) : viewingHistory && activeId !== null ? (
      // A fragment even with no versions read yet: the panel's place is taken, blank, not the cards shown for a moment.
      <>
        {history.versions && (
          <HistoryPanel
            revisions={history.versions}
            times={history.times}
            onMore={history.showMore}
            now={activeItem?.body}
            keepsAll={keepsAll}
            onBack={() => setViewingHistory(false)}
            onRestore={(revision) => void history.restore(revision)}
            onBringBack={(revision, basis, body) => void history.bringBack(revision, basis, body)}
            readOnly={activeItem?.readOnly === true}
            onPlus={askPlus}
            compares={features}
          />
        )}
      </>
    ) : viewingSubmissions ? (
      <SubmissionsPanel piece={viewingSubmissions === 'all' ? undefined : viewingSubmissions} titleOf={pieceTitle} onBack={() => setViewingSubmissions(null)} onOpen={openPiece} onPlus={features ? undefined : () => askPlus(SUBMISSIONS_PLUS)} />
    ) : viewingAttachments ? (
      <AttachmentsPanel items={documents} trash={trash} onBack={() => setViewingAttachments(false)} onOpen={open} />
    ) : viewingTrash ? (
      <TrashList
        items={trash}
        onBack={() => setViewingTrash(false)}
        onRestore={(id) => void guarded(() => items.restore(id))}
        onPurge={(id) => {
          stopSharing(trash.filter((item) => item.id === id))
          void guarded(() => items.purge(id))
        }}
        onPurgeAll={() => {
          stopSharing(trash)
          void guarded(() => items.purgeAll())
        }}
      />
    ) : undefined

  // A folder's pages as its manuscript, there while Pages shows a folder with some, its own or in the folders inside it.
  const folder = kind === 'page' && place && 'folder' in place ? place.folder : null
  const parts = folder === null ? [] : partsOf(pages, folder)
  const chapters = parts.flatMap((part) => part.chapters)
  const manuscript =
    folder !== null && chapters.length > 0
      ? (onBack: () => void) => (
          <ManuscriptPanel
            folder={folder}
            parts={parts}
            onBack={onBack}
            onOpen={open}
            onMove={(places) => void guarded(() => items.setPositions(places))}
            onSummary={(id, summary) => void guarded(() => items.setSummary(id, summary))}
            onStatus={(id, status) => void guarded(() => items.setStatus(id, status))}
            // Offered as the palette offers Word and PDF: with Plus, or in the app, where Plus can be had.
            onCompile={features || nativeApp ? (format, standard) => compile(folder, parts, format, standard) : undefined}
            // Only in the app: the system prints it.
            onPrint={nativeApp ? (trim, dropCaps) => compile(folder, parts, 'pdf', false, { trim, dropCaps }) : undefined}
            // Only in the app: the system's voice makes it.
            onListen={nativeApp ? () => listen(folder, parts) : undefined}
            stamps={gathered(chapters)}
            plus={features}
            // As a document's goal is: with Plus, or in the app, where Plus can be had.
            onPlus={features || nativeApp ? askPlus : undefined}
            onOpenAt={features || nativeApp ? openAt : undefined}
            onRewrite={features || nativeApp ? session.rewrite : undefined}
            // With Plus, or where Plus can be had. Those the book already has stay to open without it.
            onSubmissions={features || submissionsOf(submissions, { book: folder }).length > 0 ? () => setViewingSubmissions({ book: folder }) : nativeApp ? () => askPlus(SUBMISSIONS_PLUS) : undefined}
          />
        )
      : null

  return {
    panel,
    manuscript,
    manageFolders: () => setManaging(true),
    /** Back to a new draft: there's no document for History to be of. */
    closeHistory: () => setViewingHistory(false),
    openHistory: () => showInLibrary(() => setViewingHistory(true)),
    openReadersNotes: () => showInLibrary(() => setViewingNotes('readers')),
    openNotesToSelf: () => showInLibrary(() => setViewingNotes('self')),
    openTrash: () => showInLibrary(() => setViewingTrash(true)),
    openAttachments: () => showInLibrary(() => setViewingAttachments(true)),
    /** One piece's submissions, or all of them. */
    openSubmissions: (piece?: Piece) => showInLibrary(() => setViewingSubmissions(piece ?? 'all')),
  }
}
