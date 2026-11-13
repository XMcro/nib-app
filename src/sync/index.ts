import { readJson, writeJson } from '../lib/jsonStorage'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SERVER } from '../lib/server'
import type { Entitlement } from '../lib/plus'
import { httpApi } from './api'
import { changeLibrary } from './changeLibrary'
import { codeStore } from './codeStore'
import { deriveKeys, newCode } from './crypto'
import { resetSyncState } from './engine'
import { inboxAddress, newInboxAddress, type InboxAt } from './inbox'
import { Session } from './session'
import type { SyncStatus } from './status'

/**
 * Sync as the app sees it: whether it is on, how it is doing, and the four
 * things a writer can do with it. The engine (./engine) does the work.
 */

export type Sync = {
  status: SyncStatus
  code: string | null
  /** Whether `code` has been read from storage yet. Until then, null means "not known", not "off". */
  known: boolean
  /** In the app, with Plus: a new library under a fresh code. */
  create(): Promise<string>
  /** Any device: join the library behind an existing code. */
  join(code: string): Promise<void>
  /** Stop syncing here. Documents stay; the server copy stays too. */
  turnOff(): Promise<void>
  /** Delete the server copy, then stop. Documents on this device stay. */
  wipe(): Promise<void>
  /** In the app, with Plus: everything moved to a new library under a fresh code, and the old one deleted (changeLibrary). */
  changeCode(): Promise<string>
  /**
   * Signed sync (sync/api): whether this device signs its requests, and
   * whether the library takes nothing else. Null with sync off, or the server
   * out of reach.
   */
  signing(): Promise<{ device: boolean; required: boolean } | null>
  /** Requires signed sync, or stops requiring it: every device syncing the library has to sign by then. */
  requireSigned(on: boolean): Promise<void>
  /** The room the library's files take on the server, of what they may (worker/files). Null with sync off, or the server out of reach. */
  filesRoom(): Promise<{ bytes: number; limit: number } | null>
  /** This device syncs only when asked (`syncNow`): nothing is sent or fetched by itself. Kept on this device. */
  manual: boolean
  setManual(on: boolean): void
  /** Sync now: one look, whichever way `manual` is. */
  syncNow(): void
  /**
   * Fetch everything again: what this device knows of the server is forgotten
   * (sync/engine `resetSyncState`), and a look made, which reads the whole
   * library and merges it with what's here as a device joining would: where
   * they differ the newer stays and the other is kept in the document's
   * history; what's only here is sent. For a device that looks out of step.
   */
  refetch(): Promise<void>
  /**
   * The library's inbox (sync/inbox): where it is, or null if it has none.
   * Undefined with sync off, the server out of reach, or Plus not current.
   */
  inboxAddress(): Promise<InboxAt | null | undefined>
  /** An inbox for the library, or a new address for the one it has, which stops the old at once. Where it is now. */
  newInboxAddress(): Promise<InboxAt>
  /** No inbox: its address stops, and posts waiting on the server are deleted. */
  endInbox(): Promise<void>
}

const MANUAL_KEY = 'nib-sync-manual'

/**
 * `onApplied`: the documents another device changed, and how many edits a lock beat were kept as copies (sync/engine).
 * `postsFolder`: the folder a note made of a post to the inbox goes in, if any, asked as each is made.
 */
export function useSync(plus: Entitlement, onApplied: (ids: string[], copies: number) => void, postsFolder: () => string | undefined = () => undefined): Sync {
  const [code, setCode] = useState<string | null>(null)
  const [known, setKnown] = useState(false)
  const [status, setStatus] = useState<SyncStatus>({ state: 'off' })
  const session = useRef<Session | null>(null)
  const applied = useRef(onApplied)
  applied.current = onApplied
  const folder = useRef(postsFolder)
  folder.current = postsFolder
  const receipt = useRef<string | undefined>(undefined)
  receipt.current = plus.active ? plus.jws : undefined
  const [manual, setManualState] = useState(() => readJson(MANUAL_KEY, false))
  const asked = useRef(manual)
  asked.current = manual

  useEffect(() => {
    let live = true
    codeStore
      .get()
      .then((stored) => live && setCode(stored))
      .catch((error: unknown) => console.warn('Nib: could not read the sync code', error))
      .finally(() => live && setKnown(true))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!code) {
      setStatus({ state: 'off' })
      return
    }
    let current: Session | null = null
    let cancelled = false
    void deriveKeys(code).then((keys) => {
      if (cancelled) return
      current = new Session(keys, {
        onStatus: setStatus,
        onApplied: (ids, copies) => applied.current(ids, copies),
        receipt: () => receipt.current,
        manual: () => asked.current,
        postsFolder: () => folder.current(),
      })
      session.current = current
      current.start()
    })
    return () => {
      cancelled = true
      current?.stop()
      session.current = null
    }
  }, [code])

  // A renewal or a first purchase: tell the server now, not at the next tick.
  useEffect(() => {
    session.current?.nudge()
  }, [plus.jws])

  const setManual = useCallback((on: boolean) => {
    writeJson(MANUAL_KEY, on)
    asked.current = on
    setManualState(on)
    // Off again: a look at once, and by itself from there. On: said where sync's state is shown.
    if (on) setStatus((status) => (status.state === 'synced' || status.state === 'offline' ? { state: 'manual' } : status))
    else session.current?.nudge()
  }, [])

  const syncNow = useCallback(() => session.current?.run(), [])

  const refetch = useCallback(async () => {
    const running = session.current
    if (!running) throw new Error('Sync isn’t running on this device yet.')
    // With no pass under way: one in the middle would stop, having found its state gone (SyncReset).
    await running.hold(() => resetSyncState())
    running.run()
  }, [])

  const create = useCallback(async () => {
    if (!plus.jws) throw new Error('Nib Plus is needed to turn on sync.')
    const fresh = newCode()
    await httpApi(SERVER, await deriveKeys(fresh)).create(plus.jws)
    await resetSyncState()
    await codeStore.set(fresh)
    setCode(fresh)
    return fresh
  }, [plus])

  const join = useCallback(
    async (next: string) => {
      const api = httpApi(SERVER, await deriveKeys(next))
      // Either reports "no library for that code" before anything is saved.
      if (plus.jws) await api.entitle(plus.jws)
      else await api.status()
      await resetSyncState()
      await codeStore.set(next)
      setCode(next)
    },
    [plus],
  )

  const turnOff = useCallback(async () => {
    await codeStore.clear()
    await resetSyncState()
    setCode(null)
  }, [])

  const wipe = useCallback(async () => {
    if (!code) return
    await httpApi(SERVER, await deriveKeys(code)).wipe()
    await turnOff()
  }, [code, turnOff])

  const changeCode = useCallback(async () => {
    const running = session.current
    if (!plus.jws) throw new Error('Nib Plus is needed to change the sync code.')
    if (!code || !running) throw new Error('Sync isn’t running on this device yet.')
    const jws = plus.jws
    const fresh = await running.hold(async () => {
      const next = await changeLibrary(code, jws)
      // Its code is no longer kept: it mustn't take up again after the hold.
      running.stop()
      return next
    })
    setCode(fresh)
    return fresh
  }, [code, plus])

  const signing = useCallback(async () => {
    if (!code) return null
    const keys = await deriveKeys(code)
    const server = await httpApi(SERVER, keys).status().catch(() => null)
    return server && { device: keys.sign !== undefined, required: server.signedOnly === true }
  }, [code])

  const filesRoom = useCallback(async () => {
    if (!code) return null
    return httpApi(SERVER, await deriveKeys(code))
      .files()
      .then(({ bytes, limit }) => ({ bytes, limit }))
      .catch(() => null)
  }, [code])

  const requireSigned = useCallback(
    async (on: boolean) => {
      if (code) await httpApi(SERVER, await deriveKeys(code)).requireSigned(on)
    },
    [code],
  )

  const inbox = useCallback(async () => {
    if (!code) return undefined
    const keys = await deriveKeys(code)
    return inboxAddress(keys, httpApi(SERVER, keys)).catch(() => undefined)
  }, [code])

  const newAddress = useCallback(async () => {
    if (!code) throw new Error('Sync isn’t on.')
    const keys = await deriveKeys(code)
    return newInboxAddress(keys, httpApi(SERVER, keys))
  }, [code])

  const endInbox = useCallback(async () => {
    if (code) await httpApi(SERVER, await deriveKeys(code)).endInbox()
  }, [code])

  return { status, code, known, create, join, turnOff, wipe, changeCode, signing, requireSigned, filesRoom, manual, setManual, syncNow, refetch, inboxAddress: inbox, newInboxAddress: newAddress, endInbox }
}
