import { attachedIn, hasAttachment } from './attachment'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { JSONContent } from '@tiptap/react'
import type { Item, Kind } from '../db/db'
import * as items from '../db/items'
import * as revisionStore from '../db/revisions'
import { liveShare } from '../share'
import { count } from './counts'
import type { filing } from './folders'
import { notWrittenHere, startedHere } from './writtenHere'
import { filterBodyImages } from './image'
import { COPY_KEPT, type Notice } from './notices'
import { aboutToType, caretInText } from './quiet'
import { createSaveQueue } from './saveQueue'
import { countWords } from './stats'
import { plainText } from './text'
import * as vault from './vault'

const SAVE_DELAY = 400

/**
 * What the editor is keyed by, and so what remounts it: a draft by its
 * generation, a document by its version or as sealed, a restore by its count.
 */
const editorKey = {
  draft: (generation: number) => `new-${generation}`,
  sealed: (id: string) => `${id}:sealed`,
  at: (id: string, version: number) => `${id}:${version}`,
  restore: (nth: number) => `restore-${nth}`,
}

/** Everything locked, trash included: the vault's passcode proves against these, and changing it reseals them all. */
async function lockedItems() {
  return (await items.listAll()).flatMap((item) => (item.vault ? [{ id: item.id, vault: item.vault }] : []))
}

/**
 * `write` again, from a fresh read, while sync keeps changing what it read
 * first (items.ChangedSince). Three tries: a sync pass lands far less often.
 */
async function afresh(write: () => Promise<void>) {
  for (let tries = 1; ; tries++) {
    try {
      return await write()
    } catch (error) {
      if (!(error instanceof items.ChangedSince) || tries === 3) throw error
    }
  }
}

/**
 * The document open in the editor and the saving of it: what is on screen, the
 * debounce and the save queue, opening another, and the vault's locking and
 * unlocking of it, which change the same versions and the same screen.
 */
export function useOpenDocument({
  setNotice,
  filingRef,
  onDraft,
  onId,
}: {
  setNotice: (notice: string | Notice) => void
  /** Where a draft goes when it's first saved. */
  filingRef: RefObject<ReturnType<typeof filing>>
  /** Back to a new draft: what was showing about the last document closes. */
  onDraft: () => void
  /** The open document is now this one, or a draft: each change, in the order made (tabs follow it, lib/tabs). */
  onId?: (id: string | null) => void
}) {
  const [kind, setKind] = useState<Kind>('note')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  // The document another tab wrote while this editor held it. An id rather than
  // a flag, so the notice scopes itself to its own document for free.
  const [conflict, setConflict] = useState<string | null>(null)
  // `key` remounts the editor on select/new; it must NOT change when a blank
  // draft is first persisted, or the caret would jump mid-sentence.
  const [doc, showDoc] = useState<{ key: string; body?: JSONContent }>({ key: editorKey.draft(0) })
  // A note just locked whose shared draft is still online, by id (see lockCurrent).
  const [sharedLocked, setSharedLocked] = useState<string | null>(null)
  // The vault (lib/vault): a locked document on screen while the vault is
  // shut, and the passcode dialog, with what to do once it is given.
  const [sealedOpen, setSealedOpen] = useState<string | null>(null)
  const [vaultAsk, setVaultAsk] = useState<{ mode: vault.VaultMode; then: 'lock' | 'open' | 'none' } | null>(null)
  // The draft a nib:// link opened, whose editor brings the keyboard up at once.
  const [typingKey, setTypingKey] = useState<string | null>(null)

  const idRef = useRef<string | null>(null)
  // The key of what's on screen as of now, and the document last left for another: what its editor was on screen as,
  // and what the document will next be opened as, if nothing changes it meanwhile (keptAs).
  const keyRef = useRef(doc.key)
  const left = useRef<{ from: string; key: string; id: string } | null>(null)
  // The version this editor was seeded with. A write that finds a different
  // one in the database is overwriting somebody else's — another tab, usually.
  const versionRef = useRef<number | null>(null)
  // Whether this editor's text was opened locked. Text opened unlocked isn't
  // saved into its document once that is locked elsewhere (keepLocked).
  const seededLocked = useRef(false)
  const kindRef = useRef<Kind>(kind)
  const pending = useRef<JSONContent | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const drafts = useRef(0)
  // The document a draft's first save created. A save queued before that one
  // landed still holds a null id, and has to update it rather than create the
  // draft a second time.
  const createdDraft = useRef<{ draft: number; id: string } | null>(null)
  // Keeps restores' keys apart: a restore is no new draft.
  const restores = useRef(0)
  // What was typed into locked documents after their passcode changed on
  // another device, by id, with the version the save was refused at, kept
  // until the new passcode is given (see keepLocked).
  const lockedElsewhere = useRef(new Map<string, { kind: Kind; body: JSONContent; version?: number; copy: string }>())
  // Counts selections, so one still opening (a locked document takes a while)
  // when a later one has started knows to drop what it found.
  const selections = useRef(0)
  const enqueue = useRef(
    createSaveQueue((error: unknown) => {
      console.error('Nib: save failed', error)
      setSaveFailed(true)
    }),
  )
  // The latest render's, for the debounce's timer and what listens for Nib leaving.
  const latest = useRef({ flush, closeVault })
  latest.current = { flush, closeVault }

  function setId(id: string | null) {
    idRef.current = id
    setActiveId(id)
    onId?.(id)
  }

  function setDoc(next: { key: string; body?: JSONContent }) {
    keyRef.current = next.key
    showDoc(next)
  }

  /**
   * Called as the document on screen is left for another, after the save:
   * what it will be opened as when it's come back to, for its editor to be
   * kept under (editor/kept). Not a draft with nothing saved, nor a locked
   * document, whose words mustn't outlast the vault being shut.
   */
  function leave() {
    const id = idRef.current
    left.current = id !== null && versionRef.current !== null && !seededLocked.current ? { from: keyRef.current, key: editorKey.at(id, versionRef.current), id } : null
  }

  /** For the editor on screen as `from`, as it goes: what to be kept as, if its document was left for another. Once. */
  function keptAs(from: string) {
    const was = left.current
    if (was?.from !== from) return null
    left.current = null
    return { key: was.key, id: was.id }
  }

  function setOpenKind(next: Kind) {
    kindRef.current = next
    setKind(next)
  }

  // Returns the write it enqueued, so callers that go on to read the database
  // can wait for it. The queue never rejects, so ignoring the result is safe.
  function flush(): Promise<void> {
    clearTimeout(timer.current)
    const body = pending.current
    // Not Promise.resolve(): with nothing pending there may still be a write in
    // flight on the queue — a blur enqueues one and clears `pending` — and
    // `await flush()` is what export, the only backup this app has, relies on
    // to be reading the newest text. Join the queue rather than skipping it.
    if (!body) return enqueue.current(async () => {})
    pending.current = null

    const id = idRef.current
    const writeKind = kindRef.current
    // Captured here rather than read inside the task: a select() landing first
    // would otherwise hand this write the *incoming* document's version, and
    // the mismatch would look exactly like another tab having raced us.
    const expected = versionRef.current ?? undefined
    const wasLocked = seededLocked.current
    // `idRef.current === null` alone cannot tell "still this draft" from "a
    // different, newer draft" — resetToDraft restores that same null. The
    // generation counter is what distinguishes them.
    const draft = drafts.current
    return enqueue.current(async () => {
      // Not idRef inside the task: a select() since would hand this draft's
      // text to the document now on screen.
      const target = id ?? (createdDraft.current?.draft === draft ? createdDraft.current.id : null)
      if (target === null) {
        const created = await items.create(writeKind, body, filingRef.current)
        createdDraft.current = { draft, id: created }
        startedHere(created) // for the daily goal: all of its words are today's
        if (idRef.current === null && drafts.current === draft) {
          setId(created)
          versionRef.current = 1
        }
      } else {
        const next = await items
          .update(target, body, { expectedVersion: expected, wasLocked })
          .catch((error: unknown) => keepLocked(error, target, writeKind, body))
        if (next === null) return
        // Guarded for the same reason: a write resolving after the user has
        // moved on must not stamp this document's version over the one now on
        // screen.
        if (idRef.current === target) versionRef.current = next
        // update() always increments by exactly one (pinned in items.test.ts),
        // so overshooting means a foreign writer landed between our seed and
        // our write. Their text is preserved as a revision; say so. A locked
        // note keeps no history, so there it became a locked copy instead.
        if (expected !== undefined && next !== expected + 1) {
          const saved = await items.get(target)
          if (!saved || !vault.isLocked(saved)) setConflict(target)
          else {
            await items.sealCopiesIfOpen()
            setNotice(COPY_KEPT)
          }
        }
      }
      setSaveFailed(false)
    })
  }

  /**
   * A save another device's lock got to first. `pending` is already spent, and
   * the editor's text goes when the writer leaves, so it is kept. Text opened
   * unlocked, into a document locked since: the lock wins, as in sync, and the
   * text becomes a separate locked note. Text opened locked, after the vault's
   * passcode changed: kept here until the new one is given (answerVault).
   */
  async function keepLocked(error: unknown, id: string, kind: Kind, body: JSONContent): Promise<null> {
    if (error instanceof items.LockedElsewhere) {
      // What was typed since this save was queued goes with it.
      if (idRef.current === id && pending.current) {
        body = pending.current
        pending.current = null
        clearTimeout(timer.current)
      }
      await items.addCopy(kind, { body })
      setNotice(`This note was locked on another device. What you typed is kept as a separate locked note${attachedIn(body).length ? ', and its attachments in a note of their own' : ''}.`)
      await items.sealCopiesIfOpen()
      // Not awaited: select() waits for this save queue, which this is on.
      if (idRef.current === id) void select(id)
      return null
    }
    if (!(error instanceof vault.VaultError)) throw error
    // Kept as a copy too, so it outlives Nib closing before the passcode is
    // given; then it is a separate locked note. One copy, of the latest text.
    const before = lockedElsewhere.current.get(id)
    const copy = await items.addCopy(kind, { body })
    if (before) await items.purge(before.copy)
    lockedElsewhere.current.set(id, { kind, body, version: (await items.get(id))?.version, copy })
    // Not the passcode's dialog straight off: this comes in the middle of typing, the words are safe in the copy, and the keys would go into it.
    setNotice({ text: 'The vault’s passcode was changed on another device. Give the new one to save what you’ve typed.', action: { label: 'Open the vault', run: () => setVaultAsk({ mode: 'open', then: 'none' }) } })
    return null
  }

  // Every caller saves what is typed first, bar a backup being restored, which
  // throws it away instead (dropPending).
  function resetToDraft() {
    onDraft()
    leave()
    setSealedOpen(null)
    selections.current += 1 // a selection still opening must not land on the draft
    drafts.current += 1
    setId(null)
    versionRef.current = null
    seededLocked.current = false
    setDoc({ key: editorKey.draft(drafts.current) })
  }

  // However the vault shuts, a locked document on screen closes with it.
  useEffect(
    () =>
      vault.onVaultChange(() => {
        const id = idRef.current
        if (!id || vault.vaultOpen()) return
        void items.get(id).then((item) => {
          if (!item?.vault || idRef.current !== id || vault.vaultOpen()) return
          showSealed(id)
        })
      }),
    [],
  )

  // What's typed is saved as Nib leaves the screen and as the page goes.
  useEffect(() => {
    const onHide = () => latest.current.flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  useEffect(() => {
    // The vault shuts when Nib leaves the screen; what was being written is saved first.
    const onHidden = () => document.visibilityState === 'hidden' && void latest.current.closeVault()
    // And when Lock Nib covers it without its leaving, as it covers a Mac
    // window left showing behind another app's (NibLockPlugin.swift `lock`).
    const onLocked = () => void latest.current.closeVault()
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('niblock', onLocked)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('niblock', onLocked)
    }
  }, [])

  useEffect(() => {
    // IndexedDB writes started during unload are not guaranteed to finish.
    // Warn while a debounce is still pending or a write is on the queue, so
    // closing the tab cannot silently drop the only copy of the last edit.
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (pending.current === null && !enqueue.current.busy()) return
      void latest.current.flush()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  function handleChange(body: JSONContent) {
    pending.current = body
    clearTimeout(timer.current)
    timer.current = setTimeout(() => latest.current.flush(), SAVE_DELAY)
  }

  async function select(id: string) {
    const selection = ++selections.current
    // Awaited: the body read below has to include what was just typed.
    await flush()
    try {
      const item = await items.get(id)
      if (!item) return
      // Already on screen, at the version stored: remounting would only move
      // the caret to the end and lose the undo history.
      if (id === idRef.current && item.version === versionRef.current && sealedOpen !== id) return
      const readable = await items.opened(item)
      // Nothing changes before this point, so a selection overtaken while it
      // opened leaves no trace.
      if (selection !== selections.current) return
      // Typed while this opened, into the document still on screen: saved to
      // it now, while it is the one flush() reads, not to this one later.
      if (pending.current) void flush()
      // A search result may live in the other tab; follow it there.
      if (item.kind !== kindRef.current) setOpenKind(item.kind)
      if (id !== idRef.current) leave()
      setId(id)
      seat(item, readable)
    } catch (error) {
      console.error('Nib: could not open item', error)
      setSaveFailed(true)
    }
  }

  /**
   * A stored document on screen: `readable` its text, or null while the vault
   * is shut to it. `keepSealed`, for sync alone, leaves `sealedOpen` as it is.
   */
  function seat(item: Item, readable: Item | null, { keepSealed = false } = {}) {
    versionRef.current = item.version
    seededLocked.current = Boolean(item.vault)
    if (!readable) {
      // Locked, with the vault shut: no editor, only the way to open it.
      showSealed(item.id)
      return
    }
    if (!keepSealed) setSealedOpen(null)
    // Keyed by version too, so re-opening the document on screen after
    // someone else changed it shows their text instead of writing over it.
    setDoc({ key: editorKey.at(item.id, item.version), body: readable.body })
  }

  function showSealed(id: string) {
    setSealedOpen(id)
    setDoc({ key: editorKey.sealed(id) })
  }

  /** The key of the draft on screen, or the one a new document has just made. */
  const draftKey = () => editorKey.draft(drafts.current)

  /** The draft on screen, opened to be typed in. */
  function typeInDraft() {
    setTypingKey(draftKey())
    aboutToType()
  }

  /** Words for the draft on screen to open with. */
  function seatDraft(body: JSONContent) {
    setDoc({ key: draftKey(), body })
  }

  /** What every "save, then act on this document" starts with: saved, then `then` with its id; a draft nothing was typed in has none. */
  async function whenSaved(then: (id: string) => Promise<unknown>, noDocument?: () => void) {
    await flush()
    const id = idRef.current
    if (!id) return noDocument?.()
    await then(id)
  }

  /** Throws away what's waiting to be saved, ahead of a backup replacing the database. */
  function dropPending() {
    clearTimeout(timer.current)
    pending.current = null
  }

  /** Lock this note or page, asking for the vault's passcode first if the vault is shut. */
  async function lockCurrent() {
    await whenSaved(async (id) => {
      count('vault_locked')
      if (!vault.vaultOpen()) {
        setVaultAsk({ mode: (await lockedItems()).length ? 'open' : 'create', then: 'lock' })
        return
      }
      await guarded(() => afresh(async () => {
        const item = await items.get(id)
        if (!item || vault.isLocked(item)) return
        // A lock seals the text; a file is kept beside the library, where it wouldn't cover it.
        if (hasAttachment(item.body)) return setNotice('A note with attachments can’t be locked. Take them out first.')
        // Before the lock, not after: a save made while it finishes is of this
        // note as locked here, not an edit a lock from elsewhere beat
        // (keepLocked), nor another tab's write.
        seededLocked.current = true
        versionRef.current = item.version + 1
        try {
          await items.lock(id, item.body, item.version)
        } catch (error) {
          if (idRef.current === id) {
            seededLocked.current = false
            versionRef.current = item.version
          }
          throw error
        }
        // Hidden by the lock, not unwritten: today's count keeps them.
        notWrittenHere(id, -countWords(plainText(item.body)))
        // A lock stops nothing already online: the link still serves the draft
        // as it was shared. Said, with the way to stop it, rather than done.
        if (liveShare(item)) setSharedLocked(id)
        else setNotice('Locked. Only the vault’s passcode opens it now, and its past versions are gone.')
      }))
    }, () => setNotice('Write something first, then lock it.'))
  }

  async function unlockCurrent() {
    await whenSaved(async (id) => {
      await guarded(() => afresh(async () => {
        const item = await items.get(id)
        const readable = item && (await items.opened(item))
        if (!item || !readable) return
        await items.unlock(id, readable.body, item.version)
        notWrittenHere(id, countWords(plainText(readable.body)))
        if (idRef.current === id) {
          versionRef.current = item.version + 1
          seededLocked.current = false
        }
        setNotice('Unlocked. It’s stored like any other note again.')
      }))
    })
  }

  /** Saves what is on screen, then forgets the vault's key: locked documents close. */
  async function closeVault() {
    await flush()
    vault.closeVault()
  }

  async function answerVault(passcode: string) {
    const ask = vaultAsk!
    if (ask.mode === 'change') {
      await afresh(async () => {
        const locked = await lockedItems()
        const { sealed, adopt } = await vault.changePasscode(passcode, locked)
        await items.reseal(sealed, locked)
        adopt() // only once the new seals are saved
      })
      setNotice('The vault’s passcode is changed.')
      return
    }
    await vault.openVault(passcode, await lockedItems())
    const kept = [...lockedElsewhere.current]
    lockedElsewhere.current.clear()
    for (const [id, { kind, body, version, copy }] of kept) {
      await enqueue.current(async () => {
        // Changed again since the save was refused: not this text's to write
        // over, so its copy stays, a separate locked note.
        if ((await items.get(id))?.version !== version) {
          setNotice('This note changed again on another device. What you typed is kept as a separate locked note.')
          return
        }
        const next = await items.update(id, body, { expectedVersion: version }).catch((error: unknown) => keepLocked(error, id, kind, body))
        // Saved, or kept again, as a copy of its own: this one is spent.
        await items.purge(copy)
        if (next !== null && idRef.current === id) versionRef.current = next
      })
    }
    // After, so a copy just spent isn't sealed, and sent, first.
    await guarded(() => items.sealCopies())
    if (ask.then === 'lock') await lockCurrent()
    if (idRef.current && sealedOpen === idRef.current) await select(idRef.current)
    // Set before passcodes were asked to be longer and more than digits
    // (vault checkPasscode), it still opens the vault.
    if (vault.checkPasscode(passcode)) {
      setNotice('The vault’s passcode could be guessed from a copy of your library. Change it from the palette.')
    }
  }

  function guarded(action: () => Promise<unknown>) {
    return action().catch((error: unknown) => {
      console.error('Nib: storage action failed', error)
      setSaveFailed(true)
    })
  }

  async function restoreTrashed() {
    // Read before the save, not after (so not whenSaved): it's the document the banner is about that comes back, whatever opens meanwhile.
    const id = idRef.current
    if (!id) return
    await flush()
    await guarded(() => items.restore(id))
  }

  async function leaveTrashed() {
    // Flush first: these keystrokes were not the writer's delete, so they
    // belong in the trash copy rather than vanishing with the remount.
    await flush()
    resetToDraft()
  }

  // Another device changed the document on screen. If this one is not in the
  // middle of it — nothing pending, caret elsewhere — show the new text. If it
  // is, leave it: the next save meets the version sync bumped, and the
  // conflict path keeps both.
  async function refreshFromSync(ids: string[]) {
    const id = idRef.current
    if (!id || !ids.includes(id) || pending.current !== null) return
    if (caretInText()) return
    // Not a selection of its own: a sync pass ending must not cancel the
    // writer's click. But a click, or typing, while this opens wins.
    const selection = selections.current
    const overtaken = () => selection !== selections.current || idRef.current !== id || pending.current !== null
    const item = await items.get(id)
    if (overtaken()) return
    if (!item) {
      resetToDraft()
      return
    }
    const readable = await items.opened(item)
    if (overtaken()) return
    seat(item, readable, { keepSealed: true })
  }

  function changeKind(next: Kind) {
    flush() // saves under the outgoing kind
    setOpenKind(next)
    resetToDraft()
  }

  async function putBack(id: string, current: Item | undefined, body: JSONContent) {
    // Snapshot what is on screen first, so restoring is itself undoable.
    // Both revisions are forced and the write is told not to record, or the
    // save would fold into the snapshot and overwrite the draft.
    if (current) await revisionStore.record(id, current.body, { force: true })
    const next = filterBodyImages(body)
    const version = await items.update(id, next, { record: false })
    // Another document opened during these writes: this one is restored, and
    // what's on screen, with its version, stays that one's.
    if (idRef.current === id) versionRef.current = version
    await revisionStore.record(id, next, { force: true })
    if (idRef.current === id) showAnew(next)
  }

  /**
   * The document on screen, with words it's been given from outside its
   * editor. A fresh key every time: restoring the same revision twice must
   * still remount, or the editor keeps the text the restore just replaced and
   * writes it straight back on the next keystroke.
   */
  function showAnew(body: JSONContent) {
    restores.current += 1
    setDoc({ key: editorKey.restore(restores.current), body })
  }

  /**
   * Documents given new words from outside their editor, by a book's Replace
   * all (components/BookFind): what's typed saved first, then each read
   * afresh and `change`d, null leaving it as it is. Each is kept as a restore
   * keeps one (putBack), its words before in History; a locked one sealed,
   * with none, as a locked document keeps none. The one on screen is shown
   * with its new words. Gives each one changed, its words before and after
   * as stored; one that couldn't be written stops it there, and says so.
   */
  async function rewrite(ids: string[], change: (body: JSONContent, id: string) => JSONContent | null): Promise<Rewritten[]> {
    await flush()
    const done: Rewritten[] = []
    try {
      for (const id of ids) {
        const current = await items.get(id)
        const readable = current && (await items.opened(current))
        const after = readable && change(readable.body, id)
        if (!current || !readable || !after) continue
        if (vault.isLocked(current)) {
          const version = await items.update(id, after)
          if (idRef.current === id) {
            versionRef.current = version
            showAnew(after)
          }
        } else await putBack(id, current, after)
        const stored = await items.get(id)
        const now = stored && (await items.opened(stored))
        if (now) done.push({ id, before: readable.body, after: now.body })
      }
    } catch (error) {
      console.error('Nib: could not rewrite a document', error)
      setSaveFailed(true)
    }
    return done
  }

  return {
    kind,
    activeId,
    doc,
    saveFailed,
    setSaveFailed,
    conflict,
    setConflict,
    sharedLocked,
    setSharedLocked,
    sealedOpen,
    vaultAsk,
    setVaultAsk,
    /** The document on screen as of now, not as of this render. */
    currentId: () => idRef.current,
    /** Likewise: a tab just changed hasn't rendered yet. */
    currentKind: () => kindRef.current,
    /** A draft with nothing written in it is all that's open: what the tabs kept on this device can take the place of. */
    idle: () => idRef.current === null && pending.current === null,
    keptAs,
    /** The editor on screen brings the keyboard up at once. */
    startTyping: doc.key === typingKey,
    typeInDraft,
    seatDraft,
    dropPending,
    flush,
    whenSaved,
    guarded,
    handleChange,
    select,
    resetToDraft,
    refreshFromSync,
    changeKind,
    restoreTrashed,
    leaveTrashed,
    putBack,
    rewrite,
    lockCurrent,
    unlockCurrent,
    closeVault,
    answerVault,
  }
}

export type OpenDocument = ReturnType<typeof useOpenDocument>

/** A document a book's Replace all changed (`rewrite`): its words before and after, as stored. */
export type Rewritten = { id: string; before: JSONContent; after: JSONContent }
