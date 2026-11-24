import { CLIPPER_OUT } from '../lib/clipperOut'
import { useEffect, useState } from 'react'
import { copyText } from '../lib/clipboard'
import { nativeApp } from '../lib/platform'
import { INBOX_HELP_URL, PRIVACY_URL } from '../lib/plus'
import type { Sync } from '../sync'
import { SyncHttpError } from '../sync/api'
import type { InboxAt } from '../sync/inbox'
import { describeSync } from '../sync/status'
import { parseCode } from '../sync/crypto'

export function SyncPanel({
  sync,
  subscribed,
  startJoining = false,
  startChanging = false,
  onBack,
  onOpenBilling,
}: {
  sync: Sync
  subscribed: boolean
  /** Open at the form for another device's code, rather than "Turn on sync". */
  startJoining?: boolean
  /** Open asking to change the code (the palette's "Change sync code…"). */
  startChanging?: boolean
  onBack: () => void
  onOpenBilling: () => void
}) {
  const [fresh, setFresh] = useState<string | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [entry, setEntry] = useState('')
  const [joining, setJoining] = useState(startJoining)
  const [confirm, setConfirm] = useState<'off' | 'wipe' | 'change' | 'fetch' | null>(startChanging ? 'change' : null)
  const [changing, setChanging] = useState(false)
  const [changed, setChanged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
    } catch (error) {
      setMessage(error instanceof Error && /code|library|Plus/.test(error.message) ? error.message : failure)
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    run(async () => {
      setFresh(await sync.create())
    }, 'Couldn’t reach the sync server. Try again when you’re online.')

  const change = () =>
    run(async () => {
      setChanging(true)
      try {
        setFresh(await sync.changeCode())
        setChanged(true)
      } finally {
        setChanging(false)
      }
    }, 'Couldn’t reach the sync server to change the code. Nothing has changed.')

  const join = () => {
    const code = parseCode(entry)
    if (!code) {
      setMessage('That isn’t a sync code. It’s six groups of four letters and numbers.')
      return
    }
    void run(async () => {
      await sync.join(code)
      setEntry('')
      setJoining(false)
    }, 'Couldn’t reach the sync server. Try again when you’re online.')
  }

  async function copy(code: string) {
    try {
      // The key to everything synced: off the clipboard again in a while.
      await copyText(code, undefined, { expires: true })
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setMessage('Couldn’t copy. Select the code and copy it by hand.')
    }
  }

  const quiet = 'nib-tap cursor-pointer text-[11px] text-muted hover:text-ink disabled:cursor-default'
  const primary =
    'nib-tap w-full cursor-pointer rounded-md bg-ink py-2 text-[12px] font-medium text-paper disabled:cursor-default disabled:opacity-50'
  const secondary =
    'nib-tap w-full cursor-pointer rounded-md border border-line py-2 text-[12px] hover:bg-item-hover disabled:cursor-default disabled:opacity-50'

  const codeBox = (code: string) => (
    <div className="mt-2 rounded-md border border-line bg-item-active px-2.5 py-2">
      <div className="font-mono text-[13px] tracking-[0.5px] select-all">{code}</div>
      <button onClick={() => void copy(code)} className={`${quiet} mt-1`}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )

  const codeForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        join()
      }}
      className="mt-2 flex flex-col gap-1.5"
    >
      {/* Two lines: one held about four of a code's six groups, and on a phone
          the text must stay 16px or iOS zooms in. Return still connects. */}
      <textarea
        value={entry}
        onChange={(event) => setEntry(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (!busy && entry.trim()) join()
        }}
        rows={2}
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        aria-label="Sync code"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="w-full resize-none rounded-md border border-line bg-paper px-[9px] py-[5px] font-mono text-[12px] leading-[1.5] outline-none placeholder:text-faint pointer-coarse:text-[16px]"
      />
      <button type="submit" disabled={busy || !entry.trim()} className={secondary}>
        Connect
      </button>
    </form>
  )

  return (
    <div>
      <div className="flex items-center justify-between">
        <button onClick={onBack} className={quiet}>
          ← Back
        </button>
        <span className="text-[11px] text-faint">Sync</span>
      </div>

      {sync.code ? (
        <>
          <div className="mt-3 text-[12px] font-medium">{describeSync(sync.status)}</div>
          {sync.status.message && (
            <p className="mt-1 text-[11px] leading-[1.5] text-muted">{sync.status.message}</p>
          )}
          {sync.status.state === 'synced' && sync.status.at && (
            <p className="mt-0.5 text-[11px] text-muted">
              Last synced {new Date(sync.status.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </p>
          )}
          <div className="mt-2.5 flex flex-col items-start gap-1.5">
            <button onClick={sync.syncNow} disabled={sync.status.state === 'syncing' || sync.status.state === 'elsewhere'} className={secondary}>
              Sync now
            </button>
            {/* "Your writing": opening this panel still asks the server whether the library takes signed requests only (SignedSync). */}
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink">
              <input type="checkbox" checked={sync.manual} onChange={(event) => sync.setManual(event.target.checked)} />
              Sync only when I ask
            </label>
            <p className="text-[10.5px] leading-[1.5] text-faint">On this device, Nib then sends and fetches your writing only when you choose Sync now.</p>
            {/* What a card's "This device only" is, and where it's set (App's toggleDeviceOnly). */}
            <p className="text-[10.5px] leading-[1.5] text-faint">
              To keep one note or page off your other devices and the server, open it and choose Commands → Keep on this device only. Its card then says This device only.
            </p>
          </div>

          {fresh ? (
            <>
              <p className="mt-3 text-[11px] leading-[1.5] text-ink">
                {changed
                  ? 'This is your new sync code. Your other devices have stopped syncing: on each, turn sync off, then enter this code.'
                  : 'This is your sync code. Enter it on your other devices.'}{' '}
                Keep a copy somewhere safe: Nib can’t show it to anyone else or recover it.
              </p>
              {codeBox(fresh)}
              <button
                onClick={() => {
                  setFresh(null)
                  setChanged(false)
                }}
                className={`${primary} mt-2.5`}
              >
                I’ve saved my code
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setShowCode((value) => !value)} className={`${quiet} mt-3`}>
                {showCode ? 'Hide code' : 'Show code'}
              </button>
              {showCode && codeBox(sync.code)}
              <SignedSync sync={sync} />
              <Inbox sync={sync} />

              <div className="mt-3 flex flex-col items-start gap-2 border-t border-line pt-2.5">
                {nativeApp && subscribed && (
                  <>
                    <button
                      onClick={() => (confirm === 'change' ? void change() : setConfirm('change'))}
                      onBlur={() => setConfirm(null)}
                      autoFocus={startChanging}
                      disabled={busy}
                      className={`${quiet} ${confirm === 'change' ? 'font-medium text-ink' : ''}`}
                    >
                      {changing ? 'Changing the code…' : confirm === 'change' ? 'Change the code for every device?' : 'Change the sync code'}
                    </button>
                    {confirm === 'change' && (
                      <p className="text-[10.5px] leading-[1.5] text-faint">
                        Everything moves to a new library under a new code, and the old library is deleted. Pictures and attached files that aren’t on this device yet are downloaded first, so none is left behind. If you use the inbox, its address stops working: turn it on again afterwards for a new one. Your other devices stop syncing until you enter the new code on them.
                      </p>
                    )}
                  </>
                )}
                <button
                  onClick={() => (confirm === 'fetch' ? (setConfirm(null), void run(() => sync.refetch(), 'Couldn’t start fetching it again.')) : setConfirm('fetch'))}
                  onBlur={() => setConfirm(null)}
                  disabled={busy}
                  className={`${quiet} ${confirm === 'fetch' ? 'font-medium text-ink' : ''}`}
                >
                  {confirm === 'fetch' ? 'Fetch it all again?' : 'Fetch everything again'}
                </button>
                {confirm === 'fetch' && (
                  <p className="text-[10.5px] leading-[1.5] text-faint">
                    This device reads the whole library from the server again and merges it with what’s here. Where the two differ, the newer stays and the other goes into that note’s history. Nothing is deleted.
                  </p>
                )}
                <button
                  onClick={() =>
                    confirm === 'off' ? void run(() => sync.turnOff(), 'Couldn’t turn off sync.') : setConfirm('off')
                  }
                  onBlur={() => setConfirm(null)}
                  disabled={busy}
                  className={`${quiet} ${confirm === 'off' ? 'font-medium text-ink' : ''}`}
                >
                  {confirm === 'off' ? 'Turn off on this device?' : 'Turn off sync on this device'}
                </button>
                <button
                  onClick={() =>
                    confirm === 'wipe'
                      ? void run(() => sync.wipe(), 'Couldn’t reach the sync server to delete it.')
                      : setConfirm('wipe')
                  }
                  onBlur={() => setConfirm(null)}
                  disabled={busy}
                  className={`${quiet} ${confirm === 'wipe' ? 'font-medium text-ink' : ''}`}
                >
                  {confirm === 'wipe' ? 'Delete it all from the server?' : 'Delete everything on the server'}
                </button>
                <p className="text-[10.5px] leading-[1.5] text-faint">
                  Either way, the writing on this device stays.
                </p>
              </div>
            </>
          )}
        </>
      ) : nativeApp && !subscribed ? (
        <>
          <p className="mt-3 text-[11px] leading-[1.5] text-muted">
            Keep your writing on your iPhone, iPad and Mac, encrypted before it leaves each
            device. Sync is part of Nib Plus.
          </p>
          <button onClick={onOpenBilling} className={`${secondary} mt-2.5`}>
            See Nib Plus
          </button>
        </>
      ) : nativeApp && !joining ? (
        <>
          <p className="mt-3 text-[11px] leading-[1.5] text-muted">
            Your writing is encrypted on this device with a code only you hold, then kept in step
            across your iPhone, iPad and Mac.
          </p>
          <button onClick={create} disabled={busy} className={`${primary} mt-2.5`}>
            Turn on sync
          </button>
          <button onClick={() => setJoining(true)} disabled={busy} className={`${secondary} mt-1.5`}>
            Use a code from another device
          </button>
        </>
      ) : (
        <>
          <p className="mt-3 text-[11px] leading-[1.5] text-muted">
            {nativeApp
              ? 'Enter the sync code from your other device.'
              : 'Sync is part of Nib Plus, which is sold in the Nib app for iPhone, iPad and Mac. If you have it, enter your sync code to bring your writing here.'}
          </p>
          {codeForm}
          {nativeApp && (
            <button onClick={() => setJoining(false)} className={`${quiet} mt-2`}>
              Cancel
            </button>
          )}
        </>
      )}

      {message && (
        <p role="status" className="mt-2 text-[11px] leading-[1.5] text-ink">
          {message}
        </p>
      )}

      <p className="mt-3 text-[10.5px] leading-[1.5] text-faint">
        The server stores only encrypted copies it cannot read.{' '}
        <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="underline">
          Privacy Policy
        </a>
      </p>
    </div>
  )
}

/**
 * Signed sync (sync/api): where this device can, each request is signed
 * with a key from the code, and nothing in it is the secret. Required, the
 * server takes nothing else, so a request caught in passing can't be sent
 * again to read or delete the library; every device syncing it has to sign
 * by then.
 */
function SignedSync({ sync }: { sync: Sync }) {
  const [state, setState] = useState<{ device: boolean; required: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void sync.signing().then((found) => live && setState(found))
    return () => {
      live = false
    }
  }, [sync])

  if (!state?.device) return null

  async function toggle(on: boolean) {
    setBusy(true)
    setMessage(null)
    try {
      await sync.requireSigned(on)
      setState((now) => now && { ...now, required: on })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Couldn’t reach the sync server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-2.5">
      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-ink">
        <input type="checkbox" checked={state.required} disabled={busy} onChange={(event) => void toggle(event.target.checked)} />
        Require signed sync
      </label>
      <p className="mt-1 text-[10.5px] leading-[1.5] text-faint">
        This device signs what it sends with a key from your code, so nothing in it can be sent again by someone who catches it. Required, the server
        takes nothing else. Turn it on once every device that syncs this library is updated, on iOS 17 or macOS 14 or later.
      </p>
      {message && <p className="mt-1 text-[11px] text-ink">{message}</p>}
    </div>
  )
}

/**
 * The library's inbox (sync/inbox): an address other apps and services can
 * send notes to. Turning it on is asked twice, with what it means said in
 * between: it is the one way writing reaches the server before it's sealed.
 * Not shown until the server has said whether the library has one, nor when
 * it can't be asked.
 */
function Inbox({ sync }: { sync: Sync }) {
  const [inbox, setInbox] = useState<InboxAt | null | undefined>(undefined)
  const [confirm, setConfirm] = useState<'on' | 'new' | 'off' | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  /** Which was just copied: the address, or the code for the browser extension. */
  const [copied, setCopied] = useState<'address' | 'clipper' | null>(null)

  // Asked once, as the panel opens, and again only if the library changes: `sync` itself is made anew each time Nib draws.
  const { inboxAddress } = sync
  useEffect(() => {
    let live = true
    void inboxAddress().then((found) => live && setInbox(found))
    return () => {
      live = false
    }
  }, [inboxAddress])

  if (inbox === undefined) return null

  async function run(action: () => Promise<InboxAt | null>) {
    setBusy(true)
    setMessage(null)
    setConfirm(null)
    try {
      setInbox(await action())
    } catch (error) {
      setMessage(error instanceof SyncHttpError ? error.message : 'Couldn’t reach the sync server. Nothing has changed.')
    } finally {
      setBusy(false)
    }
  }

  async function copy(which: 'address' | 'clipper', text: string) {
    try {
      // Whoever has it can send notes here: off the clipboard again in a while, as the sync code is.
      await copyText(text, undefined, { expires: true })
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setMessage(which === 'address' ? 'Couldn’t copy. Select the address and copy it by hand.' : 'Couldn’t copy the code.')
    }
  }

  const quiet = 'nib-tap cursor-pointer text-[11px] text-muted hover:text-ink disabled:cursor-default'
  const asked = (which: typeof confirm) => `${quiet} ${confirm === which ? 'font-medium text-ink' : ''}`
  const note = 'text-[10.5px] leading-[1.5] text-faint'

  return (
    <div className="mt-3 flex flex-col items-start gap-2 border-t border-line pt-2.5">
      <div className="text-[11px] text-ink">Inbox</div>
      {inbox === null ? (
        <>
          <p className={note}>An address other apps and services can send notes to. Each one becomes a note here.</p>
          <button onClick={() => (confirm === 'on' ? void run(() => sync.newInboxAddress()) : setConfirm('on'))} onBlur={() => setConfirm(null)} disabled={busy} className={asked('on')}>
            {confirm === 'on' ? 'Turn on the inbox?' : 'Turn on the inbox'}
          </button>
          {confirm === 'on' && (
            <p className={note}>
              A note sent to the address reaches Nib’s server readable, because the service sending it can’t encrypt it. The server seals it at once with a key only your
              devices hold, and keeps nothing it can read. Anyone who has the address can send notes to it.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="w-full rounded-md border border-line bg-item-active px-2.5 py-2">
            <div aria-label="Inbox address" className="font-mono text-[11px] leading-[1.5] break-all select-all">
              {inbox.address}
            </div>
            <button onClick={() => void copy('address', inbox.address)} className={`${quiet} mt-1`}>
              {copied === 'address' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className={note}>
            Send it a title, text or url. Text is read as Markdown. Anyone who has the address can send notes to it.{' '}
            <a href={INBOX_HELP_URL} target="_blank" rel="noreferrer" className="underline">
              How to send to it
            </a>
          </p>
          {/* The address with the inbox's public key (worker/inbox-seal `clipperCode`): the extension seals a clip with it before sending, so the server never sees one. Once it's in the stores (lib/clipperOut). */}
          {CLIPPER_OUT && (
            <button onClick={() => void copy('clipper', inbox.clipper)} className={quiet}>
              {copied === 'clipper' ? 'Copied' : 'Copy the code for Nib’s browser extension'}
            </button>
          )}
          <button onClick={() => (confirm === 'new' ? void run(() => sync.newInboxAddress()) : setConfirm('new'))} onBlur={() => setConfirm(null)} disabled={busy} className={asked('new')}>
            {confirm === 'new' ? 'Replace the address?' : 'New address'}
          </button>
          {confirm === 'new' && <p className={note}>The address in use now stops working at once.</p>}
          <button
            onClick={() => (confirm === 'off' ? void run(async () => (await sync.endInbox(), null)) : setConfirm('off'))}
            onBlur={() => setConfirm(null)}
            disabled={busy}
            className={asked('off')}
          >
            {confirm === 'off' ? 'Turn off the inbox?' : 'Turn off the inbox'}
          </button>
          {confirm === 'off' && <p className={note}>Its address stops working, and notes waiting on the server are deleted.</p>}
        </>
      )}
      {message && (
        <p role="status" className="text-[11px] text-ink">
          {message}
        </p>
      )}
    </div>
  )
}
