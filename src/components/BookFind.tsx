import { useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import * as items from '../db/items'
import { docOf, matchesIn, queryOf, replacedIn, replacingOf, type Match } from '../editor/bookFind'
import { FindSwitches, type FindSeed } from '../editor/FindBar'
import { checkPattern, PATTERN_TROUBLE, type PatternTrouble } from '../editor/patternCheck'
import type { Rewritten } from '../lib/useOpenDocument'
import { onVaultChange, shownTitle } from '../lib/vault'

/** At most this many of a chapter's matches are listed; the rest are counted. */
const LISTED = 50
/** How long typing rests before the book is looked through again. */
const REST_MS = 150

/** A chapter of the book, numbered through it as the Manuscript numbers it. */
export type Numbered = { item: Item; number: number }

type Readable = { chapter: Numbered; doc: ReturnType<typeof docOf> }
type Found = { chapter: Numbered; matches: Match[] }
/** What Replace all last did, for its Undo, till something else is done here. */
type Replaced = { changed: Rewritten[]; count: number; readOnly: number }

const inChapters = (n: number) => (n === 1 ? '1 chapter' : `${n.toLocaleString()} chapters`)

/**
 * Find and replace across a book, Nib Plus, in the Manuscript
 * (components/ManuscriptPanel): every match in its chapters, by chapter, each
 * with the words either side of it. One tapped opens its chapter at it, with
 * the chapter's own find bar open on the same words and switches
 * (editor/FindBar). Replace all changes every chapter at once, each keeping
 * its words before in History (`onRewrite`), and Undo puts back those not
 * changed since. Its chapters only, not the notes beside them; a locked one
 * while the vault is open, and none while it's shut; a read-only one is found
 * in, and left as it is.
 */
export function BookFind({
  chapters,
  onOpenAt,
  onRewrite,
  onClose,
}: {
  chapters: Numbered[]
  onOpenAt: (id: string, seed: FindSeed) => void
  /** Each chapter given new words, the one on screen too (lib/useOpenDocument `rewrite`). */
  onRewrite: (ids: string[], change: (body: JSONContent, id: string) => JSONContent | null) => Promise<Rewritten[]>
  onClose: () => void
}) {
  const [words, setWords] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  // Null till something's looked for.
  const [found, setFound] = useState<Found[] | null>(null)
  const [trouble, setTrouble] = useState<PatternTrouble | 'invalid' | null>(null)
  // What Replace all last said, till something else is done here.
  const [replaced, setReplaced] = useState<Replaced | null>(null)
  // What Undo can put back: the last Replace all's, kept while anything else is done here, till it's undone, another is done or find is closed.
  const [undoable, setUndoable] = useState<Replaced | null>(null)
  // What Undo did, till something else is done here.
  const [putBack, setPutBack] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  // A locked chapter's words, read while the vault is open; null till they've been read.
  const [vaultTurn, setVaultTurn] = useState(0)
  useEffect(() => onVaultChange(() => setVaultTurn((turn) => turn + 1)), [])
  const [readable, setReadable] = useState<Readable[] | null>(null)
  useEffect(() => {
    let live = true
    void Promise.all(
      chapters.map(async (chapter) => {
        const open = await items.opened(chapter.item).catch(() => null)
        return open ? { chapter: { ...chapter, item: open }, doc: docOf(open.body) } : null
      }),
    ).then((all) => live && setReadable(all.filter((one): one is Readable => one !== null)))
    return () => {
      live = false
    }
  }, [chapters, vaultTurn])
  const locked = readable ? chapters.length - readable.length : 0

  useEffect(() => {
    if (!readable) return
    let cancel = () => {}
    const timer = setTimeout(() => {
      setTrouble(null)
      if (!words) return setFound(null)
      const query = queryOf({ words, caseSensitive, wholeWord, regex })
      if (!query.valid) {
        setTrouble('invalid')
        return setFound([])
      }
      const look = () => setFound(readable.map(({ chapter, doc }) => ({ chapter, matches: matchesIn(doc, query) })).filter(({ matches }) => matches.length > 0))
      if (!regex) return look()
      // As the bar does: a pattern is tried in a worker first, as it could freeze the app (editor/patternCheck).
      const check = checkPattern(words, readable.map(({ doc }) => doc))
      cancel = check.cancel
      void check.done.then((wrong) => {
        setTrouble(wrong)
        if (wrong) setFound([])
        else look()
      })
    }, REST_MS)
    return () => {
      clearTimeout(timer)
      cancel()
    }
  }, [readable, words, caseSensitive, wholeWord, regex])

  /** Anything done here but Undo: what Replace all or Undo said goes; what Undo can put back stays. */
  const anew = () => {
    setReplaced(null)
    setPutBack(null)
  }
  const toggle = (set: (change: (on: boolean) => boolean) => void) => {
    field.current?.focus()
    anew()
    set((on) => !on)
  }
  const openAt = (id: string, index: number) => onOpenAt(id, { words, caseSensitive, wholeWord, regex, index })

  async function replaceAll() {
    if (!found) return
    const query = replacingOf({ words, caseSensitive, wholeWord, regex }, replacement)
    const writable = found.filter(({ chapter }) => chapter.item.readOnly !== true)
    let count = 0
    setBusy(true)
    // Each read afresh, with what's been typed in the one on screen.
    const changed = await onRewrite(
      writable.map(({ chapter }) => chapter.item.id),
      (body) => {
        const done = replacedIn(body, query)
        count += done?.count ?? 0
        return done?.body ?? null
      },
    )
    setBusy(false)
    setPutBack(null)
    const done = { changed, count, readOnly: found.length - writable.length }
    setReplaced(done)
    setUndoable(changed.length > 0 ? done : null)
  }

  async function undo() {
    if (!undoable) return
    const was = new Map(undoable.changed.map((one) => [one.id, one]))
    setBusy(true)
    // Only those as Replace all left them: one written in since keeps what was written.
    const back = await onRewrite([...was.keys()], (body, id) => (JSON.stringify(body) === JSON.stringify(was.get(id)!.after) ? was.get(id)!.before : null))
    setBusy(false)
    const kept = was.size - back.length
    setReplaced(null)
    setUndoable(null)
    setPutBack(kept === 0 ? `Put back ${inChapters(back.length)}` : `Put back ${inChapters(back.length)}; ${kept === 1 ? 'one was' : `${kept} were`} changed since, and kept as ${kept === 1 ? 'it is' : 'they are'}`)
  }

  const total = found?.reduce((sum, { matches }) => sum + matches.length, 0) ?? 0
  const said = replaced
    ? `Replaced ${replaced.count.toLocaleString()} in ${inChapters(replaced.changed.length)}${replaced.readOnly ? ` · ${replaced.readOnly === 1 ? 'a read-only one' : `${replaced.readOnly} read-only ones`} left as ${replaced.readOnly === 1 ? 'it is' : 'they are'}` : ''}`
    : putBack
      ? putBack
      : trouble === 'invalid'
        ? 'Invalid pattern'
        : trouble
          ? PATTERN_TROUBLE[trouble]
          : found === null
            ? ''
            : total === 0
              ? 'No matches'
              : `${total.toLocaleString()} in ${inChapters(found.length)}`

  const input = 'h-[30px] min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-muted pointer-coarse:h-11 pointer-coarse:text-[16px]'
  const box = 'flex items-center gap-1 rounded-md border border-line bg-paper pl-[9px]'
  const wordButton = 'nib-tap shrink-0 cursor-pointer rounded-md px-2 py-1 text-[12px] font-medium text-ink hover:bg-item-hover disabled:cursor-default disabled:opacity-40'

  return (
    <div className="px-4">
      <div role="search" aria-label="Find in this book">
        <div className={box}>
          <input
            ref={field}
            autoFocus
            value={words}
            onChange={(event) => {
              anew()
              setWords(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              // The first match, as Return in a find goes to one.
              else if (event.key === 'Enter' && !event.nativeEvent.isComposing && found?.[0]) openAt(found[0].chapter.item.id, 0)
            }}
            aria-label="Find in this book"
            placeholder={regex ? 'Pattern' : 'Find in this book'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={input}
          />
          <button aria-label="Close find" onClick={onClose} className="nib-tap flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:text-ink">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
            </svg>
          </button>
        </div>
        <div className={`${box} mt-1 pr-1`}>
          <input
            value={replacement}
            onChange={(event) => {
              anew()
              setReplacement(event.target.value)
            }}
            onKeyDown={(event) => event.key === 'Escape' && onClose()}
            aria-label="Replace with"
            placeholder="Replace with"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={input}
          />
          <button disabled={busy || total === 0 || replaced !== null} onClick={() => void replaceAll()} className={wordButton}>
            Replace all
          </button>
          {/* Always here beside it, greyed till there's a Replace all to undo. */}
          <button disabled={busy || !undoable} onClick={() => void undo()} className={wordButton}>
            Undo
          </button>
        </div>
        <div className="mt-1 flex items-center gap-1">
          <FindSwitches caseSensitive={caseSensitive} wholeWord={wholeWord} regex={regex} onCase={() => toggle(setCaseSensitive)} onWhole={() => toggle(setWholeWord)} onRegex={() => toggle(setRegex)} />
          <span role="status" className="ml-auto text-right text-[11px] text-muted tabular-nums">
            {said}
          </span>
        </div>
        {locked > 0 && <p className="mt-1 text-[11px] text-faint">{locked === 1 ? 'One locked chapter isn’t looked in.' : `${locked} locked chapters aren’t looked in.`} Open the vault to find in them.</p>}
      </div>
      {found && found.length > 0 && !replaced && (
        <ol aria-label="Matches" className="mt-3 flex flex-col gap-3 pb-6 phone:pb-24">
          {found.map(({ chapter, matches }) => (
            <li key={chapter.item.id}>
              <h3 className="flex items-baseline gap-2.5 text-[13px]">
                <span className="w-5 shrink-0 text-right text-[11px] text-faint tabular-nums">{chapter.number}</span>
                <span className="min-w-0 flex-1 truncate">{shownTitle(chapter.item)}</span>
                <span className="shrink-0 text-[11px] text-muted tabular-nums">{matches.length.toLocaleString()}</span>
              </h3>
              <ul className="mt-1 flex flex-col pl-[30px]">
                {matches.slice(0, LISTED).map((match, index) => (
                  <li key={index}>
                    <button onClick={() => openAt(chapter.item.id, index)} className="nib-tap w-full cursor-pointer rounded-md px-1.5 py-1 text-left text-[12px] leading-[1.45] text-muted hover:bg-item-hover hover:text-ink pointer-coarse:py-2">
                      {match.before}
                      <mark className="rounded-[2px] bg-[var(--color-highlight)] px-px text-ink">{match.text}</mark>
                      {match.after}
                    </button>
                  </li>
                ))}
                {matches.length > LISTED && <li className="px-1.5 py-1 text-[11px] text-faint">and {(matches.length - LISTED).toLocaleString()} more in this chapter</li>}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
