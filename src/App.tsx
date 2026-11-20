import { type CSSProperties, type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/react'
import { CommandPalette, type Command } from './components/CommandPalette'
import { WritingStamps } from './components/StampPage'
import { ImportReport } from './components/ImportReport'
import { VaultDialog } from './components/VaultDialog'
import { LinkedFrom } from './components/LinkedFrom'
import { UpgradeDialog } from './components/UpgradeDialog'
import { FilingDialog } from './components/FilingDialog'
import { PlusWelcome } from './components/PlusWelcome'
import { CountsAsk, FeedbackDialog, FeedbackOffer } from './components/TellUs'
import { BuddyCorner, BuddyOffer, BuddyPanel } from './components/Buddy'
import { setBuddy, useBuddy } from './lib/buddy'
import { useCheers } from './lib/cheers'
import { Banner } from './components/Banner'
import { Gear, Library } from './components/Library'
import { useDocumentExpiry } from './components/useDocumentExpiry'
import { useDocumentReminder } from './components/useDocumentReminder'
import { dueOn } from './lib/expiry'
import { localDay } from './lib/time'
import { useExpiring } from './lib/useExpiring'
import { useLibraryPanels } from './components/useLibraryPanels'
import { useRewardSheets } from './components/useRewardSheets'
import { useSideBySide } from './components/useSideBySide'
import { useTabs } from './components/useTabs'
import { PasswordDialog } from './components/PasswordDialog'
import { PictureLinkDialog } from './components/PictureLinkDialog'
import { ATTACH_PROBLEMS, attachFile } from './editor/attach'
import { useWelcome } from './components/useWelcome'
import { Settings } from './components/Settings'
import { FolderMark } from './components/Places'
import { goToBlock } from './editor/arrive'
import { Editor } from './editor/Editor'
import type { GoalControls } from './editor/EditorStatus'
import { type FindSeed, openFind } from './editor/FindBar'
import { formatById, formatsAt } from './editor/formats'
import { askForNote } from './editor/NoteToSelf'
import { ReadingBar } from './components/ReadingBar'
import { checking, setChecking, useStyleSettings } from './editor/styleCheck/settings'
import type { Item, Kind, Placed } from './db/db'
import * as items from './db/items'
import { FORMAT_NAMES, RICH_FORMATS } from './lib/documentExport'
import { setLinkable } from './lib/links'
import { remindersAvailable, useKeptReminders } from './lib/reminders'
import { useDailyGoal } from './lib/goal'
import { SPRINT_LENGTHS, useSprint } from './lib/sprint'
import { useFirsts } from './lib/firsts'
import { useStamps } from './lib/useStamps'
import { useEndOpening } from './lib/opening'
import * as vault from './lib/vault'
import { store, useEntitled, usePlus, type Entitlement } from './lib/plus'
import { aboutToType, cardCame, quiet, sheetUp } from './lib/quiet'
import { keptHere, watchUpsell } from './lib/upsell'
import { useLaunchServices } from './lib/useLaunchServices'
import { useLibraryView } from './lib/useLibraryView'
import { keepOriginals } from './lib/originals'
import { isDefaultStart, useStart } from './lib/startAt'
import { useStartAt } from './lib/useStartAt'
import { useOpenDocument } from './lib/useOpenDocument'
import { useReadAloud } from './lib/useReadAloud'
import { useShortcuts } from './lib/useShortcuts'
import { useTheme } from './lib/useTheme'
import { useUnprompted } from './lib/useUnprompted'
import { canSaveTemplate, TEMPLATES_PLUS } from './lib/templates'
import { filing, filingHidden, filingOf, FREE_CATEGORIES, FREE_FOLDERS, lookOf, saidAs, sameName, type Look } from './lib/folders'
import { useSync } from './sync'
import { fileActions, RICH_EXPORT_PLUS } from './fileActions'
import { useSharing } from './share/useSharing'
import { lock } from './lib/lock'
import { CANT_SAVE, COPY_KEPT, NOTE_DELETED, NOTE_IN_TRASH, useNotice } from './lib/notices'
import { count, setCountsAnswer, useCounted } from './lib/counts'
import { NEW_NOTE_SHORTCUT, LIBRARY_SHORTCUT, macApp, nativeApp, shortcut, touchApp } from './lib/platform'
import { countWords } from './lib/stats'
import { plainText, titleOf } from './lib/text'

/** Why the Plus sheet opened, when a table's CSV was asked for without it. */
const CSV_PLUS = 'Bringing a CSV into a table, and taking a table out to one, are part of Nib Plus.'

/** One empty list while the database answers, so effects keyed on the lists don't run every render. */
const NONE: Item[] = []

export function App() {
  const [libraryOpen, setLibraryOpen] = useState(true)
  // A refused paste or drop. Transient, and shown whether or not the library is
  // up: the writer just tried to do something and nothing happened.
  const [notice, setNotice] = useNotice()
  const [focusMode, setFocusMode] = useState(false)
  const [subscription, setSubscription, plusKnown] = usePlus()
  // Stamps, free: a pack a day, the first time Nib opens that day, in the app, and coins for coming back.
  const rewards = useStamps(subscription.active)
  const entitled = useEntitled(subscription, plusKnown, rewards.market.plusUntil, setNotice)
  const { theme, look, changeTheme, rereadTheme, themeCommands } = useTheme({ active: entitled.features, known: entitled.known })
  // Where a draft goes when it's first saved: what the list shows then.
  const filingRef = useRef<ReturnType<typeof filing>>({})
  const session = useOpenDocument({ setNotice, filingRef, onDraft: () => panels.closeHistory(), onId: (id) => tabs.follow(id) })
  const { kind, activeId, doc, saveFailed, conflict, setConflict, sharedLocked, setSharedLocked, sealedOpen, vaultAsk, setVaultAsk, currentId, currentKind, startTyping, typeInDraft, seatDraft } = session
  const { flush, whenSaved, guarded, handleChange, select, resetToDraft, refreshFromSync, changeKind: changeOpenKind, restoreTrashed, leaveTrashed, lockCurrent, unlockCurrent, closeVault, answerVault } = session
  // The folder for what's new (lib/startAt), for a note made of a post to the inbox (sync/inbox): known further down, asked as each is made.
  const postsFolder = useRef<string | undefined>(undefined)
  const sync = useSync(
    subscription,
    (ids, copies) => {
      void refreshFromSync(ids)
      if (copies) keptCopies()
    },
    () => postsFolder.current,
  )
  // How the palette was opened decides whether it takes the keyboard: from ⌘K
  // the writer is typing already, from a tap iOS would raise one over it.
  const [palette, setPalette] = useState<'keyboard' | 'touch' | null>(null)

  // The open document's editor, for the formats in the palette and the Mac's Format menu.
  const editorRef = useRef<TiptapEditor | null>(null)
  // Focus mode hides the library without forgetting that it was up, so
  // leaving focus mode puts it back exactly as it was.
  const showLibrary = libraryOpen && !focusMode
  const aloud = useReadAloud(editorRef, doc.key, setNotice, showLibrary)

  // Every document in one read, sorted out here (items.sortOut). Each save
  // reads it again, so it's once, not once a list. Those no write has touched
  // stay the objects they were, whatever had them read afresh (items.keepSame).
  const lastListed = useRef<Item[] | undefined>(undefined)
  const listed = useLiveQuery(async () => (lastListed.current = items.keepSame(lastListed.current, await items.listAll())))
  const lists = useMemo(() => (listed ? items.sortOut(listed) : null), [listed])
  const notes = lists?.notes ?? NONE
  const pages = lists?.pages ?? NONE
  const trash = lists?.trash ?? NONE
  const archived = lists?.archived ?? NONE
  const templates = lists?.templates ?? NONE
  // The archive and the templates (lib/templates): apart from the lists, but documents to open, keep in tabs and find all the same.
  const setAside = useMemo(() => [...archived, ...templates], [archived, templates])
  // The daily goal and its streak are free, in the app. The calendar is counted for everyone and shown with Plus.
  const [dailyGoal, goalTarget, setGoalTarget, writtenToday] = useDailyGoal(notes, [...pages, ...archived], nativeApp)
  // A new writer's first steps (lib/firsts), each ticked as the app sees it done.
  const firsts = useFirsts({ write: writtenToday > 0, page: pages.length > 0, focus: focusMode, commands: palette !== null })
  const sprints = useSprint([...notes, ...pages], flush)
  // Requests from elsewhere for the settings panel (a "Plus" label leads to
  // Billing) and for the status line's forms (from the palette).
  const [settingsTo, setSettingsTo] = useState<{ view: 'main' | 'billing' | 'sync'; at: number; changeCode?: boolean } | null>(null)
  const [statusRequest, setStatusRequest] = useState<GoalControls['request']>(null)
  useStyleSettings()
  const [importReport, setImportReport] = useState<{ imported: Kind[]; skipped: string[] } | null>(null)
  // An import that needs a password waits here for it (lib/importApps, a ColorNote backup): what's asked, and where the answer goes.
  const [passwordAsked, setPasswordAsked] = useState<{ name: string; again: boolean; answer: (password: string | null) => void } | null>(null)
  // Plus offered of its own accord now and then (lib/upsell), or when something
  // asked for it, with why; and the welcome once it's on, then whatever was
  // waiting on it.
  const [upselling, setUpselling] = useState<{ reason?: string; then?: () => void } | null>(null)
  // The feedback form.
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  // The writing buddy (lib/buddy), in its corner once it's been said yes to, and opened from there.
  const buddy = useBuddy()
  const [buddyOpen, setBuddyOpen] = useState(false)
  // The open document's folder and categories (FilingDialog).
  const [filingOpen, setFilingOpen] = useState(false)
  // Add a picture from a link (lib/pictureLink), into the document open.
  const [pictureLink, setPictureLink] = useState(false)
  const attachInput = useRef<HTMLInputElement>(null)
  const [welcoming, setWelcoming] = useState<{ then?: () => void } | null>(null)
  vault.useVault()

  // A picture's original is kept with Plus (lib/originals): told here, as the places pictures come in by don't know.
  useEffect(() => keepOriginals(entitled.features), [entitled.features])
  // Where Nib opens and where what's new goes (lib/startAt), with Plus.
  const start = useStart()
  const libraryView = useLibraryView({ notes, pages, archived, templates, kind, open: showLibrary, filingRef, newIn: entitled.features ? start.newIn : null })
  const { query, setQuery, searching, visible, sort, shownSort, changeSort, rereadSort, setViewingTrash, place, setPlace, library } = libraryView
  useEffect(() => {
    postsFolder.current = filing(null, library, entitled.features ? start.newIn : null).folder
  })

  const everything = useMemo(() => [...notes, ...pages], [notes, pages])
  const activeItem = everything.find((item) => item.id === activeId) ?? setAside.find((item) => item.id === activeId)
  // The note or page open, to put stamps on from the Stampbook (lib/placed).
  const stampsOnto =
    activeItem && !showLibrary
      ? {
          label: activeItem.kind === 'note' ? 'this note' : 'this page',
          stamps: activeItem.stamps ?? [],
          set: (stamps: Placed[]) => void guarded(() => items.setStamps(activeItem.id, stamps)),
        }
      : null
  const beside = useSideBySide({ session, everything, activeItem, features: entitled.features, focusMode })
  const reminder = useDocumentReminder(activeItem, focusMode)
  useKeptReminders(everything, archived, listed !== undefined)
  const expiry = useDocumentExpiry(activeItem, focusMode, entitled.features)
  // The buddy cheering you on (lib/cheers): the piece open, counted unless it's locked, and the title last written in, for a welcome back.
  const openBody = activeItem && !vault.isLocked(activeItem) ? activeItem.body : null
  const openWords = useMemo(() => (openBody ? countWords(plainText(openBody)) : 0), [openBody])
  const open = useMemo(() => (activeId && openBody ? { id: activeId, words: openWords } : null), [activeId, openBody, openWords])
  useCheers({
    on: buddy,
    ready: listed !== undefined,
    last: () => {
      const latest = [...notes, ...pages].filter((item) => !vault.isLocked(item)).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      const title = latest && titleOf(latest.body)
      return title && title !== 'Untitled' ? title : undefined
    },
    goal: dailyGoal,
    sprint: sprints.done,
    open,
  })
  useExpiring(everything, archived, showLibrary ? null : activeId, guarded, setNotice)
  const sharing = useSharing({
    session,
    setNotice,
    activeItem,
    documents: [...everything, ...setAside, ...trash],
    subscribed: entitled.subscribed,
    jws: subscription.jws,
    askPlus,
    openNotes: () => panels.openReadersNotes(),
  })
  // The live list excludes trash, so a document trashed in another tab leaves
  // this editor holding an id that only `trash` still knows about. Do not
  // infer "gone" from a missing live-query hit: a draft's first save sets the
  // id before the query refreshes, and that is not a deletion.
  const activeTrashed = activeId !== null && trash.some((item) => item.id === activeId)

  // What `[[` offers and what each link on screen calls its note (lib/links).
  useEffect(() => setLinkable([...notes, ...pages, ...archived], trash), [notes, pages, archived, trash])

  /** The line a link just followed is to (lib/links Part), until its document is on screen: gone to then, once. */
  const arriving = useRef<string | null>(null)
  /** The match a book's find opened a chapter at (components/BookFind), till the chapter is on screen: its find bar opened on it then, once. */
  const findingAt = useRef<FindSeed | null>(null)

  function openAtMatch(id: string, seed: FindSeed) {
    hideListOverText()
    // Its chapter may be the one open, which `select` leaves as it is.
    if (id === activeId && editorRef.current) return openFind(editorRef.current, seed)
    findingAt.current = seed
    void select(id)
  }

  function followLink(id: string, block: string | null = null) {
    if (!everything.some((item) => item.id === id) && !archived.some((item) => item.id === id)) return setNotice(trash.some((item) => item.id === id) ? NOTE_IN_TRASH : NOTE_DELETED)
    // Its document may be the one open, which `select` leaves as it is.
    if (id === activeId) return void (block && editorRef.current && goToBlock(editorRef.current, block))
    arriving.current = block
    void select(id)
  }

  /**
   * A new draft, of `next` if it's said, with the library put away. With the
   * templates shown, a new template, within the free three or with Plus; with
   * a folder shown that has a template of this kind, a new document from it,
   * open to write in (lib/templates).
   */
  function startNew(next?: Kind) {
    if (place && 'templates' in place && !canSaveTemplate(templates.length, unlimited)) return askPlus(TEMPLATES_PLUS)
    const own = folderTemplate()
    if (own && own.kind === (next ?? currentKind())) {
      aboutToType()
      return void writeFromTemplate(own.id)
    }
    if (next) changeKind(next)
    hideListOverText()
    aboutToType()
    count(currentKind() === 'page' ? 'page_new' : 'note_new')
    flush()
    setViewingTrash(false)
    resetToDraft()
  }

  // The library covers the text, so opening a document from it has to put it
  // away, or the writer lands on the list they just left.
  function hideListOverText() {
    setLibraryOpen(false)
  }

  /** The day's prompt (lib/rewards), as the first line of a new note, with the cursor on the line below. */
  function writeFrom(prompt: string) {
    changeKind('note')
    seatDraft({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: prompt }] }, { type: 'paragraph' }] })
    hideListOverText()
    typeInDraft()
  }

  // Before what opens Nib at a note or a new one (useLaunchServices): the tabs kept on this device come back first, and that goes in them.
  const tabs = useTabs({ session, ready: listed !== undefined, everything, archived: setAside, trash, kind, features: entitled.features, focusMode, newDraft: startNew })
  // After the tabs, which bring their document back under the library, and before a link or a reminder, which opens over either.
  useStartAt({
    start,
    ready: listed !== undefined,
    features: entitled.features,
    untouched: () => session.idle() && libraryOpen && kind === 'note' && place === null && query === '',
    has: (id) => everything.some((item) => item.id === id) || setAside.some((item) => item.id === id),
    library,
    changeKind,
    setPlace,
    open: openFromLibrary,
    onScreen: showLibrary ? null : activeId,
  })
  /** What's shared into the document that's open goes in through its editor, after its last line, the cursor left where it is. */
  const addToOpen = (id: string, content: JSONContent[]) => {
    const editor = editorRef.current
    if (!editor || currentId() !== id) return false
    return editor.commands.insertContentAt(editor.state.doc.content.size, content, { updateSelection: false })
  }
  useLaunchServices({ session, libraryRead: listed !== undefined, documents: everything, addToOpen, plus: entitled.features, plusKnown: entitled.known, changeKind, hideListOverText, open: openFromLibrary, setNotice })

  /** Sync kept edits a lock beat as copies (sync/engine): say so, and seal them now if the vault is open. */
  function keptCopies() {
    setNotice(COPY_KEPT)
    void guarded(items.sealCopiesIfOpen)
  }

  // History and trash render only inside the library, so opening either has to
  // bring it back, and focus mode has to give way. From the palette, with a
  // document open, they would otherwise open unseen.
  function showInLibrary(open?: () => void) {
    setFocusMode(false)
    setLibraryOpen(true)
    open?.()
  }

  function searchLibrary() {
    showInLibrary(() => requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[data-search]')?.focus()))
  }

  // In the document on screen. With the library up, what's in view is its search.
  function find() {
    if (editorRef.current && !showLibrary) openFind(editorRef.current)
    else searchLibrary()
  }

  function toggleLibrary() {
    if (showLibrary) hideListOverText()
    else showInLibrary()
  }

  function changeKind(next: Kind) {
    changeOpenKind(next)
    setQuery('')
    setViewingTrash(false)
  }

  function showOtherVersion() {
    // The notice has done its job once the recovery surface is open.
    setConflict(null)
    panels.openHistory()
  }

  async function destroy(which: string | string[]) {
    count('trashed')
    const ids = [which].flat()
    if (ids.includes(currentId() ?? '')) {
      // Flush first: trashing is undoable, so these keystrokes belong in the
      // trash copy rather than vanishing with the remount. Dropping `pending`
      // was inherited from when × permanently destroyed the record.
      await flush()
      resetToDraft()
    }
    // A note in the trash has nothing to remind you of: this device stops waiting to ring as the library changes (lib/reminders).
    await guarded(() => items.remove(which))
  }

  function openFromLibrary(id: string) {
    hideListOverText()
    void select(id)
  }

  function openBilling() {
    showInLibrary(() => setSettingsTo({ view: 'billing', at: Date.now() }))
  }

  // Held till Plus is known when Nib is to open somewhere of the writer's choosing, so it isn't seen opening on Notes first.
  useEndOpening(listed && (isDefaultStart(start) || entitled.known) ? listed : undefined)

  const { exportAll, exportCurrent, exportTableCsv, insertTableCsv, compileManuscript, exportCurrentAs, exportMany, importFiles, backupAll, restoreFromFile } = fileActions({
    session,
    setNotice,
    features: entitled.features,
    askPlus,
    everything,
    theme,
    sort,
    setImportReport,
    askPassword: (about) => new Promise((answer) => setPasswordAsked({ ...about, answer })),
    onRestored: () => {
      rereadTheme()
      rereadSort()
      setViewingTrash(false)
      setQuery('')
      tabs.reset()
    },
  })

  const welcome = useWelcome({
    sync,
    firsts,
    entitled,
    askPlus,
    importFiles,
    // As the library's New note, with the keyboard up as from a nib:// link.
    write: () => {
      startNew()
      typeInDraft()
    },
    openSync: () => showInLibrary(() => setSettingsTo({ view: 'sync', at: Date.now() })),
  })

  // What comes up without being asked for, and when (lib/useUnprompted).
  const unprompted = useUnprompted({
    listed,
    writing: everything.length > 0,
    sync,
    plusKnown: entitled.known,
    coinsDue: rewards.market.login !== null,
    packWaiting: rewards.waiting,
    today: rewards.today,
    firsts,
    held: Boolean(welcome.greeting || welcoming || upselling || focusMode),
  })
  const { asking, endAsking } = unprompted
  const keepsakes = useRewardSheets({ rewards, firsts, unprompted, everything, subscribed: entitled.subscribed, stampsOnto, theme, changeTheme, writeFrom })

  useCounted(focusMode, 'focus_mode')
  useCounted(filingOpen, 'filing_opened')
  useCounted(upselling !== null, 'plus_offer_seen')

  // Only where Plus is sold, and only once the App Store has said it isn't on.
  // Not at all when the App Store has nothing to sell, offline say: a popup
  // Nib opened itself shouldn't only say it can't be had.
  // With enough written, it says how much is here and on nothing else
  // (lib/upsell keptHere). A locked document's words are sealed, so not counted.
  const offerPlus = useEffectEvent(async (shown: () => void) => {
    const device = await lock.status().then(
      (status) => status.device,
      () => null,
    )
    const words = everything.reduce((sum, item) => sum + (vault.isLocked(item) ? 0 : countWords(plainText(item.body))), 0)
    // Looked at again: two native calls later, something else may have come up.
    if (!quiet()) return
    shown()
    cardCame()
    // Not to a library that syncs already: it isn't all here, whoever pays for it.
    setUpselling({ reason: device && !sync.code ? keptHere(words, device) : undefined })
  })

  useEffect(() => {
    if (!nativeApp || !entitled.known || entitled.features) return
    return watchUpsell((shown) => {
      store
        .products()
        .then(({ products }) => {
          if (products.length > 0) return offerPlus(shown)
        })
        .catch(() => {})
    })
  }, [entitled.known, entitled.features])

  // Plus turned on here, by a purchase or a restore, from the popup or
  // Billing: welcomed. Not when it's only found on at launch.
  function changePlus(next: Entitlement) {
    if (next.active && !entitled.subscribed) {
      count('plus_bought')
      setUpselling(null)
      setWelcoming({ then: upselling?.then })
    }
    setSubscription(next)
  }

  // Something of Plus's asked for without it: the Plus sheet, saying why,
  // where Plus is sold, and `then` once it's on. Billing elsewhere.
  function askPlus(reason: string, then?: () => void) {
    if (nativeApp) setUpselling({ reason, then })
    else openBilling()
  }

  // Free Nib makes three folders and three categories (lib/folders); one
  // more asks for Plus.
  const unlimited = entitled.features || !entitled.known
  // Free Nib also shows a folder's colour and icon, set with Plus, and asks for it to set one.
  function atLimit(kind: 'folder' | 'category' | 'look') {
    setFilingOpen(false)
    askPlus(
      kind === 'folder'
        ? `${FREE_FOLDERS} folders is the most without Nib Plus. With it, make as many as you like.`
        : kind === 'category'
          ? `${FREE_CATEGORIES} categories is the most without Nib Plus. With it, make as many as you like.`
          : 'A colour and an icon for each folder come with Nib Plus.',
    )
  }

  const panels = useLibraryPanels({
    session,
    view: libraryView,
    activeItem,
    documents: useMemo(() => [...everything, ...setAside], [everything, setAside]),
    pages,
    trash,
    editorRef,
    setNotice,
    hideListOverText,
    showInLibrary,
    open: openFromLibrary,
    openAt: openAtMatch,
    compile: compileManuscript,
    askPlus,
    onLimit: atLimit,
    unlimited,
    features: entitled.features,
    // A synced library is a paid one, whichever device pays for it.
    keepsAll: entitled.features || sync.code !== null,
  })

  // A document's goal and sprints are Nib Plus, so only in the app, where Plus is sold.
  const goals: GoalControls | undefined = nativeApp
    ? {
        plus: entitled.features,
        sprint: sprints.sprint,
        sprintDone: sprints.done,
        onSetGoal: (goal) => {
          if (activeId) void guarded(() => items.setGoal(activeId, goal))
        },
        onStartSprint: (minutes) => void sprints.start(minutes),
        onStopSprint: () => void sprints.stop(),
        onDismissSprint: sprints.dismiss,
        onPlus: askPlus,
        request: statusRequest,
      }
    : undefined

  function toggleArchived(item: Item) {
    const on = typeof item.archivedAt !== 'number'
    void guarded(() => items.setArchived(item.id, on))
    if (on) showInLibrary()
  }

  // Kept on this device only (db Item.deviceOnly), or synced again. Said, with the way back: it comes off every other device.
  function toggleDeviceOnly(item: Item) {
    const on = item.deviceOnly !== true
    void guarded(() => items.setDeviceOnly(item.id, on))
    if (on) {
      setNotice({
        text: `This ${item.kind} is now on this device only. It comes off your other devices at the next sync, and has no copy anywhere else.`,
        action: { label: 'Undo', run: () => void guarded(() => items.setDeviceOnly(item.id, false)) },
      })
    }
  }

  function togglePin(id: string) {
    const item = everything.find((candidate) => candidate.id === id)
    if (item?.pinnedAt === undefined) count('pinned')
    void guarded(() => items.setPinned(id, item?.pinnedAt === undefined))
  }

  /** A copy of the document open, kept as a template (lib/templates), within the free three or with Plus. */
  async function saveAsTemplate() {
    if (!canSaveTemplate(templates.length, unlimited)) return askPlus(TEMPLATES_PLUS)
    await whenSaved(async (id) => {
      await guarded(async () => {
        if (await items.saveAsTemplate(id)) setNotice('Saved as a template. It’s in Templates, in the library.')
      })
    })
  }

  /** The template of the folder shown, or the one it's in (lib/folders), while it's still a template that can be read. */
  function folderTemplate() {
    const id = place && 'folder' in place ? library.folders.find((folder) => sameName(folder.name, place.folder))?.template : undefined
    return id === undefined ? undefined : usableTemplates.find((item) => item.id === id)
  }

  /**
   * A new note or page from a template (lib/templates), open to write in:
   * filed as one written now would be, or, from the templates themselves,
   * where one written with nothing shown would go.
   */
  async function writeFromTemplate(id: string) {
    const filed = place && 'templates' in place ? filing(null, library, entitled.features ? start.newIn : null) : filingRef.current
    await guarded(async () => {
      const made = await items.fromTemplate(id, filed)
      if (made) openFromLibrary(made)
    })
  }
  // Choosing a template to write from (Commands → New from template…), and how the palette was opened.
  const [pickingTemplate, setPickingTemplate] = useState<'keyboard' | 'touch' | null>(null)
  const usableTemplates = templates.filter((item) => !vault.isLocked(item))

  async function duplicateCurrent() {
    await whenSaved(async (id) => {
      count('duplicated')
      await guarded(async () => {
        const copy = await items.duplicate(id)
        if (copy) openFromLibrary(copy)
      })
    })
  }

  function buildCommands(): Command[] {
    // The row itself with Plus. Without, the row again, marked and asking for Plus, in the app, where it's sold, or `everywhere` (a browser's Billing says where).
    const plusRow = (row: Command, reason: string, { everywhere = false } = {}): Command[] =>
      entitled.features ? [row] : nativeApp || everywhere ? [{ ...row, badge: 'Plus', run: () => askPlus(reason) }] : []
    const list: Command[] = [
      { id: 'new-note', label: 'New note', hint: NEW_NOTE_SHORTCUT, run: () => startNew('note') },
      { id: 'new-page', label: 'New page', run: () => startNew('page') },
      ...(usableTemplates.length > 0 ? [{ id: 'from-template', label: 'New from template…', run: () => setPickingTemplate(palette === 'touch' ? 'touch' : 'keyboard') }] : []),
      {
        id: 'focus',
        label: focusMode ? 'Leave focus mode' : 'Focus mode',
        hint: shortcut('F', { shift: true }),
        run: () => setFocusMode((value) => !value),
      },
      { id: 'library', label: showLibrary ? 'Hide library' : 'Show library', hint: LIBRARY_SHORTCUT, run: toggleLibrary },
    ]
    // On words selected. On iPhone and iPad, it's under the selection toolbar's •••.
    const writing = editorRef.current
    if (writing?.isEditable && !touchApp && !writing.state.selection.empty) {
      list.push({ id: 'note-to-self', label: 'Add a note to self…', run: () => askForNote(writing) })
    }
    const locked = activeItem !== undefined && vault.isLocked(activeItem)
    if (activeItem) {
      list.push(
        { id: 'pin', label: activeItem.pinnedAt === undefined ? 'Pin this' : 'Unpin this', run: () => togglePin(activeItem.id) },
        // Next to Pin, near the top: on a phone the palette shows only its first few rows.
        ...reminder.commands,
        ...expiry.commands(plusRow),
        // After Remind me, which a phone has to show. On a phone this row is the only way to it.
        ...(editorRef.current && !showLibrary ? [{ id: 'find', label: `Find in this ${kind === 'page' ? 'page' : 'note'}`, hint: shortcut('F'), run: find }] : []),
        // Near the top too, after Remind me, which a phone has to show.
        ...aloud.commands,
        // A template is apart already, in Templates (lib/templates).
        ...(activeItem.template === true ? [] : [{ id: 'archive', label: typeof activeItem.archivedAt === 'number' ? 'Take out of the archive' : 'Move to the archive', run: () => toggleArchived(activeItem) }]),
        { id: 'read-only', label: activeItem.readOnly ? 'Allow editing' : 'Make read-only', run: () => void guarded(() => items.setReadOnly(activeItem.id, !activeItem.readOnly)) },
        // With sync on, where there's somewhere else for it to be; and always to take it off one that has it.
        ...(activeItem.deviceOnly
          ? [{ id: 'device-only', label: 'Sync to my other devices again', run: () => toggleDeviceOnly(activeItem) }]
          : sync.code !== null
            ? [{ id: 'device-only', label: 'Keep on this device only', run: () => toggleDeviceOnly(activeItem) }]
            : []),
        // A locked note is filed only while the vault is open (lib/folders filingHidden).
        ...(filingHidden(activeItem)
          ? []
          : [
              { id: 'folder', label: 'Move to folder…', run: () => setFilingOpen(true) },
              { id: 'categories', label: 'Categories…', run: () => setFilingOpen(true) },
            ]),
        // A locked document keeps no history, and its sealed text can't be copied.
        ...(locked
          ? []
          : [
              { id: 'duplicate', label: 'Duplicate this', run: () => void duplicateCurrent() },
              ...(activeItem.template === true ? [] : [{ id: 'save-template', label: 'Save as template', run: () => void saveAsTemplate() }]),
              { id: 'history', label: 'Version history', run: panels.openHistory },
            ]),
        { id: 'notes-to-self', label: 'Notes to self and TKs', run: panels.openNotesToSelf },
        ...beside.commands(plusRow, palette),
        { id: 'export-one', label: 'Export this one as Markdown', run: () => void exportCurrent() },
        ...RICH_FORMATS.flatMap((format) => plusRow({ id: `export-${format}`, label: `Export this one as ${FORMAT_NAMES[format]}`, run: () => void exportCurrentAs(format) }, RICH_EXPORT_PLUS)),
        { id: 'trash-this', label: 'Move this to trash', run: () => void destroy(activeItem.id) },
      )
    }
    // With or without a saved document: a draft has a tab too.
    list.push(...tabs.commands(plusRow, palette))
    // In the app alone, which is what can fetch it (lib/pictureLink), and into something that can be written in.
    if (nativeApp && !showLibrary && editorRef.current?.isEditable) list.push({ id: 'picture-link', label: 'Add a picture from a link…', run: () => setPictureLink(true) })
    // Any file, kept beside the library and named in the document where the cursor is (editor/attach).
    if (!showLibrary && editorRef.current?.isEditable) list.push(...plusRow({ id: 'attach', label: 'Attach a file…', run: () => attachInput.current?.click() }, 'Attaching files to a note or a page is part of Nib Plus.'))
    // With or without a saved document: a new page can start from a spreadsheet.
    const writingPage = !showLibrary && kind === 'page' ? editorRef.current : null
    if (writingPage?.isActive('table')) list.push(...plusRow({ id: 'csv-export', label: 'Export this table as CSV', run: () => exportTableCsv(writingPage) }, CSV_PLUS))
    else if (writingPage?.isEditable) list.push(...plusRow({ id: 'csv-insert', label: 'Insert a table from CSV…', run: () => void insertTableCsv(writingPage) }, CSV_PLUS))
    const goalRow: Command = { id: 'goal', label: 'Set a goal…', run: () => setStatusRequest({ form: 'goal', at: Date.now() }) }
    const sprintRow: Command = { id: 'sprint', label: 'Start a sprint…', run: () => setStatusRequest({ form: 'sprint', at: Date.now() }) }
    if (nativeApp && entitled.features) {
      if (activeItem) list.push({ ...goalRow, label: activeItem.goal ? 'Change the goal…' : goalRow.label })
      if (sprints.sprint) list.push({ id: 'sprint-end', label: 'End the sprint', run: () => void sprints.stop() })
      else {
        for (const minutes of SPRINT_LENGTHS) {
          list.push({ id: `sprint-${minutes}`, label: `Start a ${minutes}-minute sprint`, run: () => void sprints.start(minutes) })
        }
        list.push(sprintRow)
      }
    } else if (nativeApp) {
      list.push(
        ...plusRow(goalRow, 'A goal for each note and page, with a deadline, is part of Nib Plus.'),
        ...plusRow(sprintRow, 'Sprints are part of Nib Plus, with a calendar of your writing days.'),
      )
    }
    list.push(...keepsakes.commands())
    // Free: it counts. With Plus it underlines (Editor's styleCheck).
    if (nativeApp && activeItem) {
      const on = checking(activeItem.id)
      list.push({ id: 'style-check', label: on ? 'Stop checking style' : 'Check style', run: () => setChecking(activeItem.id, !on) })
    }
    list.push(...sharing.commands())
    // The vault: lock needs Plus; opening, unlocking and closing never do.
    if (activeItem && !locked) {
      const what = activeItem.kind === 'page' ? 'page' : 'note'
      list.push(...plusRow({ id: 'vault-lock', label: `Lock this ${what}…`, run: () => void lockCurrent() }, `Locking a ${what} behind the vault’s own passcode is part of Nib Plus.`, { everywhere: true }))
    }
    if (activeItem && locked && vault.vaultOpen()) list.push({ id: 'vault-unlock', label: 'Remove the lock', run: () => void unlockCurrent() })
    // If the code has got out: Sync, asking.
    if (nativeApp && entitled.subscribed && sync.code) {
      list.push({ id: 'sync-change-code', label: 'Change sync code…', run: () => setSettingsTo({ view: 'sync', at: Date.now(), changeCode: true }) })
    }
    if (vault.vaultOpen()) {
      list.push(
        { id: 'vault-close', label: 'Lock the vault now', run: () => void closeVault() },
        { id: 'vault-passcode', label: 'Change the vault passcode…', run: () => setVaultAsk({ mode: 'change', then: 'none' }) },
      )
    }
    list.push(
      { id: 'export-all', label: 'Export everything as Markdown', run: () => void exportAll() },
      // Attaching is Plus's; without it the list is still reached from Settings, for what was attached before.
      ...(entitled.features ? [{ id: 'attachments', label: 'Attachments…', run: panels.openAttachments }] : []),
      { id: 'trash', label: `Open trash${trash.length ? ` (${trash.length})` : ''}`, run: panels.openTrash },
      ...(nativeApp ? [{ id: 'feedback', label: 'Send feedback…', run: () => setFeedbackOpen(true) }] : []),
      ...themeCommands(rewards.winter, askPlus),
    )
    const editor = editorRef.current
    if (editor?.isEditable) {
      for (const format of formatsAt(editor, kind === 'page')) {
        list.push({ id: format.id, label: format.label, hint: format.keys, searchOnly: true, run: () => format.run(editor) })
      }
    }
    return list
  }

  const togglePalette = () => setPalette((open) => (open || sheetUp() ? null : 'keyboard'))
  useShortcuts({
    toggleLibrary,
    startNew,
    togglePalette,
    toggleFocus: () => setFocusMode((value) => !value),
    find,
    searchLibrary,
    // As the palette would run it, so with Plus asked for where it's missing, and not at all where the row isn't offered.
    tab: (id) => {
      const row = buildCommands().find((candidate) => candidate.id === id)
      row?.run()
      return row !== undefined
    },
  })

  // The Mac app's menu bar (ios/App/App/AppDelegate.swift) sends each choice
  // here by the id of the matching palette command, plus a few of its own.
  const menu = useRef<(id: string) => void>(() => {})
  menu.current = (id) => {
    if (id === 'palette') return togglePalette()
    if (sheetUp()) return
    if (id === 'backup') return void backupAll()
    if (id === 'find') return find()
    if (id === 'search') return searchLibrary()
    const command = buildCommands().find((candidate) => candidate.id === id)
    if (command) return command.run()
    // The Format menu is the same for both; a note just has no headings or
    // tables, and the row and column commands need the caret in a table.
    const format = formatById(id)
    if (format && editorRef.current && !editorRef.current.isEditable) return setNotice('This is read-only. To change it, choose Allow editing in Commands.')
    if (format && kind === 'note' && format.pagesOnly) {
      return setNotice(id.startsWith('table-') ? 'Tables are for pages.' : 'Titles and headings are for pages.')
    }
    if (format?.inTable) return setNotice('Put the cursor in a table first.')
    if (id === 'share-draft') {
      return setNotice(activeItem && vault.isLocked(activeItem) ? 'A locked note can’t be shared. Remove its lock first.' : 'Write something first, then share it.')
    }
    if (id === 'remind') return setNotice('Write something first, then set a reminder.')
    if (RICH_FORMATS.some((format) => id === `export-${format}`) && !entitled.features) {
      askPlus(RICH_EXPORT_PLUS)
    }
  }
  useEffect(() => {
    if (!macApp) return
    const onMenu = (event: Event) => menu.current((event as Event & { id?: string }).id ?? '')
    window.addEventListener('nibmenu', onMenu)
    return () => window.removeEventListener('nibmenu', onMenu)
  }, [])

  const openSettings = () => setSettingsTo({ view: 'main', at: Date.now() })

  return (
    <div className={`flex h-dvh bg-paper pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]`}>
      {palette && (
        <CommandPalette
          items={everything}
          commands={buildCommands()}
          onSelectItem={openFromLibrary}
          onClose={() => setPalette(null)}
          focusSearch={palette === 'keyboard'}
        />
      )}
      {beside.picker}
      {pickingTemplate && (
        <CommandPalette
          items={usableTemplates}
          commands={[]}
          listItems
          placeholder="New from template: search your templates"
          onSelectItem={(id) => void writeFromTemplate(id)}
          onClose={() => setPickingTemplate(null)}
          focusSearch={pickingTemplate === 'keyboard'}
        />
      )}
      {tabs.picker}
      {importReport && <ImportReport {...importReport} onClose={() => setImportReport(null)} />}
      {passwordAsked && (
        <PasswordDialog
          // Asked again, it starts empty again.
          key={String(passwordAsked.again)}
          name={passwordAsked.name}
          again={passwordAsked.again}
          onPassword={(password) => {
            setPasswordAsked(null)
            passwordAsked.answer(password)
          }}
        />
      )}
      {keepsakes.sheets}
      {welcome.sheet}
      {asking === 'counts' && (
        <CountsAsk
          onAnswer={(yes) => {
            setCountsAnswer(yes)
            endAsking()
          }}
        />
      )}
      {asking === 'feedback' && (
        <FeedbackOffer
          gift={!entitled.subscribed}
          onLater={endAsking}
          onSend={() => {
            endAsking()
            setFeedbackOpen(true)
          }}
        />
      )}
      {asking === 'buddy' && (
        <BuddyOffer
          plus={entitled.features}
          onAnswer={(yes) => {
            setBuddy(yes)
            endAsking()
            if (yes) setBuddyOpen(true)
          }}
        />
      )}
      {/* In Nib Plus's colours with Plus (components/Buddy). */}
      {buddy && !focusMode && <BuddyCorner onOpen={() => setBuddyOpen(true)} plus={entitled.features} />}
      {buddyOpen && <BuddyPanel onClose={() => setBuddyOpen(false)} plus={entitled.features} />}
      {feedbackOpen && <FeedbackDialog subscribed={entitled.subscribed} onGift={rewards.market.giftPlus} onClose={() => setFeedbackOpen(false)} />}
      {upselling && <UpgradeDialog reason={upselling.reason} onEntitlement={changePlus} onClose={() => setUpselling(null)} />}
      {welcoming && (
        <PlusWelcome
          onDone={() => {
            setWelcoming(null)
            welcoming.then?.()
          }}
        />
      )}
      {filingOpen && activeItem && !filingHidden(activeItem) && <FilingDialog targets={[activeItem]} library={library} run={(action) => void guarded(action)} onClose={() => setFilingOpen(false)} unlimited={unlimited} onLimit={atLimit} />}
      {pictureLink && editorRef.current && <PictureLinkDialog editor={editorRef.current} onClose={() => setPictureLink(false)} />}
      {/* The system's own picker for Attach a file…, which the command opens. */}
      <input
        ref={attachInput}
        type="file"
        aria-label="A file to attach"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          const editor = editorRef.current
          if (file && editor) void attachFile(editor, file).then((went) => went !== 'added' && setNotice(ATTACH_PROBLEMS[went]))
        }}
      />
      {vaultAsk && <VaultDialog mode={vaultAsk.mode} onSubmit={answerVault} onClose={() => setVaultAsk(null)} />}
      {reminder.dialog}
      {expiry.dialog}
      {sharing.dialog}
      {/* A screen of its own, opened by a gear. */}
      <Settings
        theme={theme}
        onThemeChange={changeTheme}
        folders={library.folders.map((folder) => folder.name)}
        onExport={exportAll}
        onExportCurrent={exportCurrent}
        onExportCurrentAs={(format) => void exportCurrentAs(format)}
        goal={goalTarget}
        onGoalChange={setGoalTarget}
        daily={remindersAvailable ? keepsakes.daily : undefined}
        winter={rewards.winter}
        canExportCurrent={activeId !== null}
        onImport={importFiles}
        onBackup={backupAll}
        onRestore={restoreFromFile}
        onAttachments={panels.openAttachments}
        subscription={subscription}
        plus={entitled.features}
        pointsPlus={entitled.pointsUntil}
        onPlusChange={changePlus}
        sync={sync}
        openTo={settingsTo}
        onFeedback={nativeApp ? () => setFeedbackOpen(true) : undefined}
        />
      {/* The two a sheet covers (components/Sheet holds them out of reach). No box of its own. */}
      <div className="contents" data-under-sheets>
      {/* Always mounted, over the text: `inert` keeps it out of the tab order
          and off the pointer while a document has the window. */}
      <Library
        open={showLibrary}
        onOpenSettings={openSettings}
        stamps={keepsakes.library}
        kind={kind}
        onKindChange={changeKind}
        query={query}
        onQueryChange={setQuery}
        searching={searching}
        items={visible}
        activeId={activeId}
        onSelect={openFromLibrary}
        onDelete={destroy}
        onTogglePin={togglePin}
        onNew={startNew}
        onUseTemplate={(id) => void writeFromTemplate(id)}
        sort={shownSort}
        onSortChange={changeSort}
        trash={trash}
        onViewTrash={setViewingTrash}
        place={place}
        onPlaceChange={setPlace}
        library={library}
        archived={archived.length}
        templates={templates.length}
        all={[...everything, ...setAside]}
        run={(action) => void guarded(action)}
        onExport={exportMany}
        unlimited={unlimited}
        onLimit={atLimit}
        saveFailed={saveFailed}
        notice={showLibrary && notice ? notice.text : null}
        // One that isn't about the document in front: Undo, for what expired (lib/useExpiring).
        noticeAction={notice?.docKey === undefined ? notice?.action : undefined}
        onDismissNotice={() => setNotice(null)}
        plus={entitled.features}
        sync={sync}
        panel={panels.panel}
        manuscript={panels.manuscript}
        onManage={panels.manageFolders}
        />
      {/* main stays put so the outline rail does not scroll with the text. */}
      {/* Under the library while it's open, so out of reach as well as out of sight. */}
      {/* With a document beside, the writing has the left half of main, and
          what keeps to the writing (its count, its outline, the reading bar)
          is placed by that half: its middle, and the pane's width from the
          screen's right edge. main is the window less its safe areas. */}
      <main
        className={`relative min-w-0 flex-1 ${beside.item ? 'flex' : ''} ${tabs.shown ? '[--nib-tabs:2.25rem] pointer-coarse:[--nib-tabs:2.75rem]' : ''}`}
        inert={showLibrary}
        style={beside.item ? ({ '--nib-centre': '75%', '--nib-beside': 'calc((100vw - env(safe-area-inset-left) - env(safe-area-inset-right)) / 2)' } as CSSProperties) : undefined}
      >
        {aloud.reading && <ReadingBar beside={beside.item !== undefined} {...aloud.bar} />}
        {/* Both can be true at once and both are actionable, so they stack.
            pointer-events sit on the children, or the gap between them would
            swallow clicks meant for the text underneath. */}
        <div className="pointer-events-none absolute top-3 right-3 z-10 flex flex-col items-end gap-2 max-sm:left-3">
          {/* A touch screen has no ⌘K, and history, focus mode and duplicate
              live only in the palette. Kept through focus mode, which has no
              other way out without a keyboard. */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPalette('touch')}
              className="nib-tap pointer-events-auto hidden cursor-pointer rounded-md px-2 py-1 text-[11px] text-faint hover:text-muted pointer-coarse:block"
            >
              Commands
            </button>
            {!focusMode && (
              <button
                aria-label="Settings"
                data-plus-landing
                onClick={openSettings}
                className="nib-tap nib-gear pointer-events-auto flex size-8 cursor-pointer items-center justify-center rounded-md text-faint hover:text-muted"
              >
                <Gear />
              </button>
            )}
          </div>
          {/* The library's footer carries this warning, but writing with it
              put away is exactly when a writer is least likely to look
              at it — and a persistent storage failure would otherwise go
              unannounced for the whole session. */}
          {saveFailed && !showLibrary && <Banner text={CANT_SAVE} />}
          {notice !== null && !showLibrary && (
            // Keyed by its words: a new notice in place of another arrives too.
            <Banner
              key={notice.text}
              text={notice.text}
              actions={[
                ...(notice.action && (notice.docKey === undefined || notice.docKey === doc.key)
                  ? [
                      {
                        label: notice.action.label,
                        run: () => {
                          notice.action!.run()
                          setNotice(null)
                        },
                      },
                    ]
                  : []),
                { label: 'Dismiss', run: () => setNotice(null) },
              ]}
            />
          )}
          {activeTrashed && (
            <Banner
              // Its expiry date came (lib/expiry), here or on another device: put back, it comes without it.
              text={dueOn(trash, localDay(Date.now())).some((item) => item.id === activeId) ? 'This expired and is in the trash.' : 'This was moved to the trash.'}
              actions={[
                { label: 'Restore', run: () => void restoreTrashed() },
                { label: 'Leave it there', run: () => void leaveTrashed() },
              ]}
            />
          )}
          {/* Scoped to its document by holding an id rather than a flag, so it
              cannot mis-target after an async write resolves. It stays until
              acted on: the overwritten copy lives only in version history,
              which the export file does not carry. */}
          {sharedLocked !== null && sharedLocked === activeId && (
            <Banner
              text="Locked. Its shared draft is still online, as it was shared."
              actions={[
                { label: 'Stop sharing', run: () => void sharing.stopLocked(sharedLocked) },
                { label: 'Leave it online', run: () => setSharedLocked(null) },
              ]}
            />
          )}
          {conflict !== null && conflict === activeId && (
            <Banner
              text="Also edited elsewhere. Yours is what’s saved."
              actions={[
                { label: 'Keep mine', run: () => setConflict(null) },
                { label: 'See the other version', run: showOtherVersion },
              ]}
            />
          )}
        </div>
        <div className="nib-chrome" data-hidden={showLibrary || focusMode}>
          <BackToLibrary kind={kind} folder={activeItem && filingOf(activeItem).folder} look={activeItem ? lookOf(library, filingOf(activeItem).folder ?? '') : undefined} onShow={() => setLibraryOpen(true)}>
            {!focusMode && keepsakes.buttons}
          </BackToLibrary>
        </div>
        {tabs.strip}
        {/* data-scroll is the seam the outline rail uses to track position. It
            starts below the row of ••• and Commands, and below the tabs when
            there are two (--nib-tabs), so text scrolls away under the row
            rather than behind them. On iPhone and iPad it runs
            on under the keyboard and the formatting bar, as text does on iOS,
            with room at the end for its last line to clear them
            (`--nib-covered`, editor/FormatBar). And half a screen more: with
            the last line pinned to the bottom, every line deleted there made
            the whole text jump down to fill the space. The column is as tall
            as what it holds (self-start), or that room would sit inside the
            scroller's own height with the text running out past it. */}
        <div data-scroll className="mt-[calc(2.75rem+var(--nib-tabs,0px))] flex h-[calc(100%-2.75rem-var(--nib-tabs,0px))] min-w-0 flex-1 justify-center overflow-y-auto px-8">
          <div className="w-full max-w-[var(--nib-column,680px)] self-start pt-[70px] pb-[calc(50dvh+var(--nib-covered,0px))]">
            {activeItem?.stamps?.length && !focusMode && sealedOpen !== activeId ? <WritingStamps stamps={activeItem.stamps} onOpen={keepsakes.lookAt} /> : null}
            {sealedOpen !== null && sealedOpen === activeId ? (
              <div className="mt-[18vh] flex flex-col items-center gap-3 text-center">
                <p className="text-[13px] text-muted">This is locked in the vault.</p>
                <button
                  onClick={() => setVaultAsk({ mode: 'open', then: 'open' })}
                  className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper"
                >
                  Open the vault
                </button>
              </div>
            ) : (
              <Editor
                key={doc.key}
                docKey={doc.key}
                keptAs={session.keptAs}
                kind={kind}
                initialBody={doc.body}
                item={activeItem}
                readOnly={activeItem?.readOnly === true}
                focus={focusMode}
                onChange={handleChange}
                onBlur={flush}
                onNotice={(text, action) => setNotice({ text, action, docKey: doc.key })}
                goal={dailyGoal}
                goals={goals}
                onEditor={(next) => {
                  editorRef.current = next
                  if (next && findingAt.current) {
                    openFind(next, findingAt.current)
                    findingAt.current = null
                  }
                  if (!next || !arriving.current) return
                  goToBlock(next, arriving.current)
                  arriving.current = null
                }}
                startTyping={startTyping}
                styleCheck={nativeApp && activeId !== null && checking(activeId) && (entitled.features ? 'underline' : 'count')}
                onOpenLink={followLink}
              />
            )}
            {reminder.row}
            {expiry.row}
            {activeId && !focusMode && look.linkedFrom && <LinkedFrom key={`linked-from-${activeId}`} id={activeId} items={everything} onOpen={(id) => void select(id)} />}
          </div>
        </div>
        {beside.pane}
      </main>
      </div>
    </div>
  )
}

/** The way back to the library, with the folder this is in, and beside it today's pack while it waits, and the presents. */
function BackToLibrary({ kind, folder, look, onShow, children }: { kind: Kind; folder?: string | null; look?: Look; onShow: () => void; children?: ReactNode }) {
  return (
    <div className="absolute top-3 left-3 flex items-center gap-2">
      <button
        onClick={onShow}
        className="nib-tap flex cursor-pointer items-center gap-1 rounded-md bg-item-hover py-1 pr-2.5 pl-1.5 text-[12px] font-medium text-muted hover:text-ink"
      >
        <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {kind === 'note' ? 'Notes' : 'Pages'}
      </button>
      {folder && (
        <span className="flex items-center gap-1 text-[12px] text-faint">
          <FolderMark look={look} />
          {/* A name can run to 60 characters, under Commands and past what's beside it. */}
          <span className="max-w-[28vw] truncate">{saidAs(folder)}</span>
        </span>
      )}
      {children}
    </div>
  )
}
