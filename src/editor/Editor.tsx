import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, type Editor as TiptapEditor, type EditorOptions, type JSONContent } from '@tiptap/react'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { withoutDefaultAlignment } from '../lib/alignment'
import { asBlock } from '../lib/links'
import { copyText, SEALED_COPY } from '../lib/clipboard'
import { DOC_BUDGET, allowedImageSrc, imageBytes, toDataUrl } from '../lib/image'
import { keepOriginal } from '../lib/originals'
import { ATTACH_PROBLEMS, insertAttached, keepAttached, NAME_ONLY, withoutFiles } from './attach'
import { useLook } from '../lib/look'
import type { NoticeAction } from '../lib/notices'
import { wordsIn } from '../lib/pictureText'
import { countWords } from '../lib/stats'
import { macApp, nativeApp, touchApp } from '../lib/platform'
import { isLocked } from '../lib/vault'
import type { Item, Kind } from '../db/db'
import { OutlineRail } from './OutlineRail'
import type { DailyGoal } from '../lib/goal'
import { EditorStatus, type GoalControls } from './EditorStatus'
import { FindBar } from './FindBar'
import { FormatBar } from './FormatBar'
import { fitted, nibEditor, textClass } from './extensions'
import { arrive, arriveKey } from './arrive'
import { linkPicker, linkPickerKey } from './linkPicker'
import { NoteCard } from './NoteCard'
import { restoreNote, type NotePiece } from './NoteToSelf'
import { SelectionToolbar } from './SelectionToolbar'
import { dim, dimKey } from './dim'
import { fold, foldKey } from './fold'
import { reading, readingKey } from './reading'
import { styleCheck as styleCheckPlugin, styleCheckKey, withRules } from './styleCheck/plugin'
import { rulesOn, subscribe } from './styleCheck/settings'
import { scrollerOf } from './scroller'
import { useEditorPlugin } from './useEditorPlugin'
import { useKeptEditor, type KeptAs } from './useKeptEditor'

/** Where the caret sits vertically in focus mode, as a fraction of the pane. */
const TYPEWRITER_ANCHOR = 0.4

function copyOut(view: EditorView, event: ClipboardEvent, sealed: boolean): boolean {
  const { selection } = view.state
  if (selection.empty) return false
  const { dom, text } = view.serializeForClipboard(selection.content())
  event.preventDefault()
  void copyText(text, dom.innerHTML, sealed ? SEALED_COPY : undefined).catch((error) => console.warn('Nib: could not copy', error))
  if (event.type === 'cut' && view.editable) view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'))
  return true
}

/** Nothing here takes what's dropped while it's read-only, and left alone the browser would open a file in Nib's place. */
function refuseDrop(view: EditorView, event: DragEvent): boolean {
  if (view.editable) return false
  event.preventDefault()
  return true
}

/** A pasted picture that went in as its words, and where those words are now. */
type TypedOut = { file: File; words: string[]; from: number; to: number }

/**
 * Puts `words` in at the selection, a paragraph each, the way pasted text
 * goes in, and says where they went. With `ownParagraph` they start one of
 * their own: a paste's second picture, so its words don't run on from the
 * first's.
 */
function typeOut(view: EditorView, file: File, words: string[], ownParagraph: boolean): TypedOut {
  const { schema, selection } = view.state
  const paragraphs = (ownParagraph ? ['', ...words] : words).map((text) =>
    schema.nodes.paragraph.create(null, text ? schema.text(text) : null),
  )
  const tr = view.state.tr.replaceSelection(new Slice(Fragment.from(paragraphs), 1, 1))
  view.dispatch(tr.scrollIntoView())
  return { file, words, from: selection.from, to: tr.selection.to }
}

export function Editor({
  kind,
  initialBody,
  item,
  focus,
  onChange,
  onBlur,
  onNotice,
  goal,
  goals,
  onEditor,
  startTyping = false,
  styleCheck = false,
  onOpenLink,
  readOnly = false,
  docKey,
  keptAs,
}: {
  kind: Kind
  initialBody?: JSONContent
  item?: Item
  focus: boolean
  onChange: (body: JSONContent) => void
  onBlur?: () => void
  onNotice?: (message: string, action?: NoticeAction) => void
  goal?: DailyGoal | null
  goals?: GoalControls
  /** The live editor, for what acts on it from outside: the palette and the Mac's Format menu. */
  onEditor?: (editor: TiptapEditor | null) => void
  /** Bring the keyboard up at once, even on iPhone and iPad: a note opened from a widget or Shortcuts is opened to be typed in. */
  startTyping?: boolean
  /** The style check (styleCheck/): Nib Plus underlines what might read better; without it, only a count. */
  styleCheck?: false | 'underline' | 'count'
  /** A link to another note was tapped or clicked: open that note, at the line the link is to if it's to one (`block`, lib/links Part). */
  onOpenLink?: (id: string, block: string | null) => void
  /** To be read and copied, and not changed. */
  readOnly?: boolean
  /** What its document is opened as (lib/useOpenDocument), and, as it's left for another, what its editor is kept as for the tab it stays in (editor/kept). */
  docKey?: string
  keptAs?: KeptAs
}) {
  const page = kind === 'page'

  /**
   * Shared by paste and drop. Returns true when the event carried files, so
   * ProseMirror stops and the browser does not handle it — for a drop that
   * matters even when we refuse the file, because otherwise the browser
   * navigates the window to it and unloads the app with an edit possibly still
   * sitting in the save debounce.
   */
  function handleFiles(view: EditorView, files: FileList | null | undefined): boolean {
    const list = [...(files ?? [])]
    if (list.length === 0) return false

    void (async () => {
      let budget = DOC_BUDGET - imageBytes(view.state.doc)
      const typed: TypedOut[] = []
      for (const file of list) {
        // A picture with words in it goes in as its words, to be written
        // with; the notice offers the picture back.
        const words = await wordsIn(file)
        // TipTap defers destroy() by a tick (StrictMode), so `isDestroyed`
        // is still false after unmount. The editable is already out of the
        // document, and dispatching into it would either throw or call
        // onChange on a component that is gone.
        if (!view.dom.isConnected) return
        if (words) {
          typed.push(typeOut(view, file, words, typed.length > 0))
          continue
        }
        const src = await toDataUrl(file)
        if (!view.dom.isConnected) return
        if (!src || !allowedImageSrc(src)) {
          // Not a picture Nib can hold in a document: with Nib Plus it goes in as an attachment (editor/attach).
          const attached = await keepAttached(file, sealed.current)
          if (!view.dom.isConnected) return
          if (typeof attached === 'string') {
            onNotice?.(attached === 'plus' ? `Can’t add ${file.name || 'that file'}` : ATTACH_PROBLEMS[attached])
            continue
          }
          insertAttached(view, attached)
          continue
        }
        if (src.length > budget) {
          onNotice?.('This document is full — no more images fit')
          break
        }
        budget -= src.length
        // With Nib Plus, the picture as it came is kept beside the library (lib/originals).
        const full = await keepOriginal(file, sealed.current)
        if (!view.dom.isConnected) return
        const node = view.state.schema.nodes.image.create({ src, alt: '', full })
        view.dispatch(view.state.tr.replaceSelectionWith(node))
      }
      if (typed.length === 0) return
      typedOut.current = typed
      const count = countWords(typed.flatMap((one) => one.words).join(' '))
      const many = typed.length > 1
      onNotice?.(`Typed out ${count === 1 ? 'one word' : `${count} words`} from the ${many ? 'pictures' : 'picture'}.`, {
        label: many ? 'Keep the pictures' : 'Keep the picture',
        run: () => void keepPictures(view, typed),
      })
    })()
    return true
  }

  /**
   * The last paste's pictures that went in as their words, followed through
   * every change since (onTransaction), so the notice can still put them back
   * after more writing.
   */
  const typedOut = useRef<TypedOut[]>([])

  /** The note last taken off with Done, followed the same way, so the notice's Undo puts that back and nothing else. */
  const takenOff = useRef<NotePiece[]>([])

  /** The notice's Keep the picture: each picture back in place of its words. */
  async function keepPictures(view: EditorView, typed: TypedOut[]) {
    const srcs = await Promise.all(typed.map(({ file }) => toDataUrl(file)))
    // Each one's original too, with Nib Plus (lib/originals).
    const fulls = await Promise.all(typed.map(({ file }, index) => (srcs[index] ? keepOriginal(file, sealed.current) : null)))
    // Gone, or a later paste's notice is the one that counts now.
    if (!view.dom.isConnected || typedOut.current !== typed) return
    typedOut.current = []
    let budget = DOC_BUDGET - imageBytes(view.state.doc)
    const tr = view.state.tr
    // The last first, so each one's place is still where it was for the next.
    const order = [...typed.keys()].sort((a, b) => typed[b].from - typed[a].from)
    for (const index of order) {
      const { file, from, to } = typed[index]
      const src = srcs[index]
      if (!src || !allowedImageSrc(src)) {
        onNotice?.(`Can’t add ${file.name || 'that file'}`)
        continue
      }
      if (src.length > budget) {
        onNotice?.('This document is full — no more images fit')
        continue
      }
      budget -= src.length
      tr.replaceRangeWith(from, Math.max(from, to), view.state.schema.nodes.image.create({ src, alt: '', full: fulls[index] }))
    }
    if (tr.docChanged) view.dispatch(tr)
  }

  const look = useLook()

  // Read when copying: the note can be locked while it's open.
  const sealed = useRef(false)
  sealed.current = item ? isLocked(item) : false

  // The same objects from one render to the next, the extensions and the props:
  // Tiptap compares them, and new ones have it reconfigure the view each time
  // App draws. So the props reach the rest through refs (`files`, `openLink`).
  const made = useMemo(() => nibEditor(page), [page])
  const files = useRef(handleFiles)
  files.current = handleFiles
  const notice = useRef(onNotice)
  notice.current = onNotice
  const editorProps = useMemo<EditorOptions['editorProps']>(
    () => ({
      attributes: {
        class: textClass(page),
        // On the Mac, macOS's inline predictions put provisional text into the
        // page that the editor doesn't know about: typing came out garbled, and
        // text deleted with ⌘A and Delete came back. MainViewController turns
        // them off for the web view too.
        ...(macApp && { writingsuggestions: 'false' }),
      },
      // A card from another note, into a locked one: its name, and not its file (editor/attach).
      transformPasted: (slice) => {
        const kept = sealed.current ? withoutFiles(slice) : slice
        if (kept !== slice) notice.current?.(NAME_ONLY)
        return kept
      },
      handlePaste: (view, event) => files.current(view, event.clipboardData?.files),
      handleDrop: (view, event) => files.current(view, (event as DragEvent).dataTransfer?.files),
      handleDOMEvents: {
        dragover: refuseDrop,
        drop: refuseDrop,
        // In the app, copy through the native pasteboard (lib/clipboard), with
        // the same HTML and text ProseMirror would have written itself.
        ...(nativeApp && {
          copy: (view, event) => copyOut(view, event, sealed.current),
          cut: (view, event) => copyOut(view, event, sealed.current),
        }),
      },
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name !== 'noteLink') return false
        openLink.current?.(String(node.attrs.id), asBlock(node.attrs.block))
        return true
      },
    }),
    [page],
  )

  // Made once: the editor is remounted (keyed) whenever its document changes. Or not made, but the one kept for its tab, as it was left.
  const { editor, scroll: leftAt } = useKeptEditor({
    docKey,
    keptAs,
    // Its body is read once, here.
    make: () => ({ ...made, content: initialBody ? fitted(initialBody, page) : undefined }),
    editable: !readOnly,
    editorProps,
    told: {
      onUpdate: ({ editor }) => onChange(withoutDefaultAlignment(editor.getJSON())),
      // Words that stand in for a picture: text typed against either end stays
      // outside them, so it stays when the picture goes back.
      onTransaction: ({ transaction }) => {
        if (!transaction.docChanged) return
        for (const one of [...typedOut.current, ...takenOff.current]) {
          one.from = transaction.mapping.map(one.from, 1)
          one.to = transaction.mapping.map(one.to, -1)
        }
      },
      // Leaving the editor is a natural save point, and narrows the window in
      // which a debounced write could still be pending.
      onBlur: () => onBlur?.(),
    },
  })

  // "Cursor ready" is the whole point of Notes. The `autofocus` option and
  // `commands.focus()` both defer the DOM focus to requestAnimationFrame, which
  // never fires while the tab is hidden — so focus the node directly too.
  // Not in the app on iPhone or iPad: there focus raises the keyboard over the
  // note you just opened. It comes up when the writer taps into the text, and
  // not before. The Mac app has a keyboard, so the cursor is ready there too.
  // Nor in something that's only to be read, which opens at its start.
  // One kept for its tab has its cursor where it was, and isn't scrolled to it: it's put back where it was scrolled to, below.
  const readingOnly = useRef(readOnly)
  readingOnly.current = readOnly
  // For what puts a picture in from outside (addPicture): the note can be locked while it's open.
  if (editor) editor.storage.image.locked = sealed.current

  useEffect(() => {
    if (!editor || (touchApp && !startTyping) || readingOnly.current) return
    if (leftAt === null) editor.commands.focus('end')
    else editor.commands.focus(null, { scrollIntoView: false })
    editor.view.dom.focus({ preventScroll: leftAt !== null })
  }, [editor, startTyping, leftAt])

  // Turned on or off with the document open. No update, as the text didn't change.
  useEffect(() => {
    if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly, false)
  }, [editor, readOnly])

  // Refs, so the editor (made once) always reaches the current ones.
  const openLink = useRef(onOpenLink)
  openLink.current = onOpenLink
  const self = useRef(item?.id ?? null)
  self.current = item?.id ?? null

  // `[[` lists notes to link to. On the live editor only, like the style check.
  // First, so its Return and arrow keys come before the editor's own.
  useEditorPlugin(editor, (live) => linkPicker(live, () => self.current), linkPickerKey, { first: true })

  // A page's headings fold their sections away, and a list's lines what is under them, on this device (fold.ts).
  useEditorPlugin(editor, () => fold(() => self.current), foldKey)
  useEditorPlugin(editor, arrive, arriveKey)

  // The sentence being read aloud, highlighted (lib/readAloud, through lib/useReadAloud).
  useEditorPlugin(editor, reading, readingKey)

  // One kept for its tab, back as far down as it was left. After what was folded is folded again, which moves every line below it,
  // and before the editor is announced, so a link followed to one of its lines still ends at that line.
  useEffect(() => {
    const scroller = leftAt === null ? null : scrollerOf(editor)
    if (scroller) scroller.scrollTop = leftAt!
  }, [editor, leftAt])

  // Held in a ref so a new callback each render does not re-announce the editor.
  const announce = useRef(onEditor)
  announce.current = onEditor
  useEffect(() => {
    if (!editor) return
    announce.current?.(editor)
    return () => announce.current?.(null)
  }, [editor])

  // The style check draws on the live editor and is never part of its
  // schema, so turning it on or off leaves the document exactly as it was.
  useEditorPlugin(editor, () => styleCheckPlugin(rulesOn(), { underline: styleCheck === 'underline' }), styleCheckKey, { when: styleCheck })
  useEffect(() => {
    if (!editor || !styleCheck) return
    let rules = rulesOn()
    // The same signal covers which documents are checked; only the rules matter here.
    return subscribe(() => {
      const next = rulesOn()
      if (editor.isDestroyed || [...next].join() === [...rules].join()) return
      rules = next
      editor.view.dispatch(editor.state.tr.setMeta(styleCheckKey, withRules(rules)))
    })
  }, [editor, styleCheck])

  // Typewriter scrolling: hold the caret at a fixed height so the line you are
  // writing never drifts to the bottom of the screen. In focus mode, or all
  // the time if Customize says so (Nib Plus).
  const typewriter = focus || look.typewriter
  useEffect(() => {
    if (!editor || !typewriter) return
    const scroller = scrollerOf(editor)
    if (!scroller) return

    function recentre() {
      const { from } = editor!.state.selection
      const caret = editor!.view.coordsAtPos(from)
      const pane = scroller!.getBoundingClientRect()
      const anchor = pane.top + pane.height * TYPEWRITER_ANCHOR
      const drift = caret.top - anchor
      // Set outright, not scrolled by: iOS 26.5's web view took a scrollBy from anywhere but typing twice over,
      // so going into focus mode, or folding a section above the caret, left the line as far off the other way.
      if (Math.abs(drift) > 1) scroller!.scrollTop += drift
    }

    // Lines folded away or brought back above the caret move it, with no change to the text or to where it is in it.
    const refolded = ({ transaction }: { transaction: Transaction }) => transaction.getMeta(foldKey) !== undefined && recentre()
    editor.on('selectionUpdate', recentre)
    editor.on('update', recentre)
    editor.on('transaction', refolded)
    recentre()
    return () => {
      editor.off('selectionUpdate', recentre)
      editor.off('update', recentre)
      editor.off('transaction', refolded)
    }
  }, [editor, typewriter])

  // In focus mode, everything but the paragraph being written fades back, if
  // Customize says so (Nib Plus).
  useEditorPlugin(editor, dim, dimKey, { when: focus && look.dim })

  return (
    <>
      {editor && <FindBar editor={editor} readOnly={readOnly} />}
      {/* `relative`: the selection toolbar is placed inside this box, so it
          scrolls with the text. Placed against the window instead, it stayed
          put while the text slid under it, over the lines it then covered. */}
      <EditorContent editor={editor} className="relative" />
      {editor && <SelectionToolbar editor={editor} showHeading={page} sealed={item ? isLocked(item) : false} />}
      {editor && (
        <NoteCard
          editor={editor}
          readOnly={readOnly}
          onDone={(removed) => {
            takenOff.current = removed
            onNotice?.('Note to self taken off.', { label: 'Undo', run: () => restoreNote(editor.view, takenOff.current) })
          }}
        />
      )}
      {editor && page && !focus && look.outline && <OutlineRail editor={editor} />}
      {editor && <EditorStatus editor={editor} item={item} goal={goal} goals={goals} readOnly={readOnly} />}
      {editor && touchApp && <FormatBar editor={editor} page={page} />}
    </>
  )
}
