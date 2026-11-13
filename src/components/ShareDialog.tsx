import { useEffect, useState } from 'react'
import { DEFAULT_DAYS, FREE_DAYS, SHARE_DAYS } from '../../worker/wire.mjs'
import type { Item, ShareRef } from '../db/db'
import { copyText } from '../lib/clipboard'
import { CANT_REACH } from '../lib/notices'
import {
  createShare,
  extendShare,
  liveShare,
  revokeShare,
  ShareError,
  shareUrl,
  shareStatus,
  stopSharingQuestion,
} from '../share'
import { MAX_PASSWORD } from '../share/crypto'
import { Sheet } from './Sheet'

/**
 * Share a draft. Says in plain words what happens before anything does; then
 * the link, how long it lasts, the readers' notes, and a way to stop. One live
 * share per document; sharing again later means a new link. Without Nib Plus
 * the link is free: read-only, for FREE_DAYS, and one at a time. With it, a
 * link can be one to be read once (worker/share); any other counts how many
 * times it's opened; and the dialog asks the server which, or how many.
 */
export function ShareDialog({
  item,
  subscribed,
  jws,
  freeHolder,
  onShares,
  onOpenNotes,
  onPlus,
  onClose,
}: {
  item: Item
  subscribed: boolean
  /** The App Store's receipt, which the server checks before it stores a Plus share. */
  jws: string | undefined
  /** Without Plus: the title of another document holding the one free link. */
  freeHolder?: string
  /** The document's share records changed; the caller saves them. */
  onShares: (shares: ShareRef[]) => void
  onOpenNotes: () => void
  /** More than the free link asked for: Plus, saying why. */
  onPlus: (reason: string) => void
  onClose: () => void
}) {
  const live = liveShare(item)
  const [days, setDays] = useState<number>(DEFAULT_DAYS)
  const [password, setPassword] = useState('')
  const [once, setOnce] = useState(false)
  // Of the link it was asked about: another made after isn't answered for by the last one's.
  const [told, setTold] = useState<{ slug: string; read: boolean; opens?: number } | null>(null)
  // A free link has nothing to tell: it isn't counted.
  const [asked, owner] = live && !live.free ? [live.slug, live.owner] : []
  useEffect(() => {
    if (!asked || !owner) return
    let closed = false
    // Not being able to ask says nothing either way.
    const ask = () => void shareStatus({ slug: asked, owner }).then((status) => void (closed || setTold({ slug: asked, ...status })), () => {})
    ask()
    // And again when Nib comes back to the front: the link is sent from another app, and read while this is still open.
    const back = () => document.visibilityState === 'visible' && ask()
    document.addEventListener('visibilitychange', back)
    return () => {
      closed = true
      document.removeEventListener('visibilitychange', back)
    }
  }, [asked, owner])
  const status = live && told?.slug === live.slug ? told : null
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState<'link' | 'password' | null>(null)
  const kept = (item.shares ?? []).filter((share) => share.expiresAt > Date.now())

  async function attempt(action: () => Promise<void>) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
    } catch (error) {
      setMessage(error instanceof ShareError && error.status !== 500 ? error.message : CANT_REACH)
    } finally {
      setBusy(false)
    }
  }

  const share = () =>
    attempt(async () => {
      if (subscribed && !jws) throw new ShareError(402, 'Nib Plus isn’t active.')
      onShares([...kept, subscribed ? await createShare(item, days, jws, { password: password.trim(), once }) : await createShare(item, FREE_DAYS, undefined)])
    })
  const extend = (next: number) =>
    attempt(async () => {
      const expiresAt = await extendShare(live!, next)
      onShares(kept.map((share) => (share.slug === live!.slug ? { ...share, expiresAt } : share)))
    })
  const stop = () => {
    if (!confirm(stopSharingQuestion(live!))) return
    void attempt(async () => {
      await revokeShare(live!)
      onShares(kept.filter((share) => share.slug !== live!.slug))
    })
  }
  async function copy(what: 'link' | 'password') {
    try {
      // A password, unlike a link, is a secret kept on the clipboard only a while.
      await copyText(what === 'link' ? shareUrl(live!) : live!.password!, undefined, what === 'link' ? undefined : { expires: true })
      setCopied(what)
    } catch {
      setMessage('Couldn’t copy. Select it and copy it.')
    }
  }

  const until = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const quiet = 'nib-tap cursor-pointer text-[12px] text-muted hover:text-ink disabled:cursor-default disabled:opacity-50'
  return (
    <Sheet label="Share a draft" onClose={onClose} className="nib-pop h-fit w-[min(440px,90vw)] rounded-lg border border-line bg-paper p-4">
      <div className="text-[14px] font-medium">Share a draft</div>
      <p className="mt-2 text-[12px] leading-[1.5] text-muted">
        {/* Of the link there is, or of the one about to be made. */}
        {(live ? live.once : once)
          ? 'The server stores this encrypted, until one reader opens it. They can leave notes.'
          : `The server stores this encrypted. Anyone with the link can read it${live ? (live.free ? '' : ' and leave notes') : subscribed ? ' and leave notes' : ''}.`}
      </p>

      {live ? (
        <>
          <input
            readOnly
            value={shareUrl(live)}
            aria-label="Link to this draft"
            onFocus={(event) => event.target.select()}
            className="mt-3 w-full rounded-md border border-line bg-transparent px-2 py-1.5 font-mono text-[11px] text-muted outline-none pointer-coarse:text-[16px]"
          />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={() => void copy('link')} className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper">
              {copied === 'link' ? 'Copied' : 'Copy link'}
            </button>
            <span className="flex-1 text-[12px] text-muted">Shared as it was {until(live.createdAt)}, until {until(live.expiresAt)}</span>
          </div>
          {live.once ? (
            <p className="mt-2 text-[12px] text-muted">
              {!status
                ? 'To be read once.'
                : status.read
                  ? 'It has been read, and is deleted from Nib’s server. The link no longer works.'
                  : 'To be read once. Not read yet.'}
            </p>
          ) : (
            status?.opens !== undefined && (
              <p className="mt-2 text-[12px] text-muted">
                {status.opens === 0 ? 'Not opened yet.' : status.opens === 1 ? 'Opened once.' : `Opened ${status.opens} times.`} Readers are told that Nib counts this.
              </p>
            )
          )}
          {live.password && (
            <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
              <span>
                Readers also need the password <span className="font-mono text-ink">{live.password}</span>
              </span>
              <button onClick={() => void copy('password')} className={quiet}>
                {copied === 'password' ? 'Copied' : 'Copy password'}
              </button>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
            {/* A free link stays one, Plus or not: notes and extending need a new link. */}
            {live.free ? (
              !subscribed && (
                <button onClick={() => onPlus('Readers’ notes and links that last longer are part of Nib Plus.')} className={quiet}>
                  Readers’ notes and longer links · Plus ›
                </button>
              )
            ) : (
              <>
                <button onClick={onOpenNotes} className={quiet}>
                  Notes from readers
                </button>
                <label className="flex items-center gap-1.5 text-[12px] text-muted">
                  Extend
                  <select
                    value=""
                    disabled={busy}
                    onChange={(event) => void extend(Number(event.target.value))}
                    aria-label="Keep it shared for"
                    className="cursor-pointer bg-transparent text-[12px] text-ink outline-none pointer-coarse:text-[16px]"
                  >
                    <option value="" disabled>
                      to…
                    </option>
                    {SHARE_DAYS.map((option) => (
                      <option key={option} value={option}>
                        {option} days from today
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <span className="flex-1" />
            <button onClick={stop} disabled={busy} className={quiet}>
              Stop sharing
            </button>
          </div>
        </>
      ) : !subscribed && freeHolder !== undefined ? (
        <>
          <p className="mt-1 text-[12px] leading-[1.5] text-muted">
            Your free link is sharing “{freeHolder}”. Stop sharing that one first, or share more than one at a time with Nib Plus.
          </p>
          <div className="mt-4 flex items-center justify-end gap-4">
            <button onClick={onClose} className={quiet}>
              Cancel
            </button>
            <button
              onClick={() => onPlus('With Nib Plus, share as many drafts as you like at once.')}
              className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper"
            >
              See Nib Plus
            </button>
          </div>
        </>
      ) : !subscribed ? (
        <>
          <p className="mt-1 text-[12px] leading-[1.5] text-muted">
            Readers see it as it is now, for {FREE_DAYS} days. What you write after stays here.
          </p>
          <button
            onClick={() => onPlus('A password, readers’ notes, longer links and more than one at a time are part of Nib Plus.')}
            className={`${quiet} mt-3 text-left`}
          >
            A password, readers’ notes, longer links and more than one at a time are part of Nib Plus ›
          </button>
          <div className="mt-4 flex items-center justify-end gap-4">
            <button onClick={onClose} className={quiet}>
              Cancel
            </button>
            <button
              onClick={() => void share()}
              disabled={busy}
              className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:cursor-default disabled:opacity-50"
            >
              {busy ? 'Sharing…' : 'Create link'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[12px] leading-[1.5] text-muted">
            Readers see it as it is now. What you write after stays here.
            {!once && ' Nib counts how many times the link is opened, and tells readers so.'}
          </p>
          <div className="mt-3 flex items-center gap-2 text-[12px] text-muted" role="radiogroup" aria-label="Keep it shared for">
            <span>For</span>
            {SHARE_DAYS.map((option) => (
              <button
                key={option}
                role="radio"
                aria-checked={days === option}
                onClick={() => setDays(option)}
                className={`nib-tap cursor-pointer rounded-md border px-2 py-0.5 ${days === option ? 'border-ink text-ink' : 'border-line hover:text-ink'}`}
              >
                {option} days
              </button>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-[12px] text-muted">
            <span className="flex-none">Password</span>
            <input
              type="text"
              value={password}
              maxLength={MAX_PASSWORD}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Optional"
              onChange={(event) => setPassword(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 py-1 font-mono text-[12px] text-ink outline-none pointer-coarse:text-[16px]"
            />
          </label>
          {password.trim() && (
            <p className="mt-1 text-[11px] leading-[1.5] text-muted">
              Readers need it as well as the link. Tell them separately: it isn’t in the link, and Nib’s server never sees it.
            </p>
          )}
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={once} onChange={(event) => setOnce(event.target.checked)} />
            Delete it after one reading
          </label>
          {once && (
            <p className="mt-1 text-[11px] leading-[1.5] text-muted">
              The first reader to open it sees it. Then it’s deleted from Nib’s server, and the link stops working.
            </p>
          )}
          <div className="mt-4 flex items-center justify-end gap-4">
            <button onClick={onClose} className={quiet}>
              Cancel
            </button>
            <button
              onClick={() => void share()}
              disabled={busy}
              className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:cursor-default disabled:opacity-50"
            >
              {busy ? 'Sharing…' : 'Create link'}
            </button>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="mt-3 text-[12px] text-ink">
          {message}
        </p>
      )}
    </Sheet>
  )
}
