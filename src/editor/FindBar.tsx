import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { type Command, type EditorState, TextSelection } from '@tiptap/pm/state'
import { type Editor, useEditorState } from '@tiptap/react'
import { findNext, findPrev, getMatchHighlights, replaceAll, replaceNext, search, SearchQuery, type SearchResult, setSearchState } from 'prosemirror-search'
import { touchApp } from '../lib/platform'
import { checkPattern, PATTERN_TROUBLE, type PatternTrouble } from './patternCheck'
import { Replacing } from './replacing'
import { scrollerOf } from './scroller'
import { useEditorPlugin } from './useEditorPlugin'

/** Draws the matches, on the live editor and only while the bar is open, so the document is never touched. */
const highlighting = search()

/**
 * What the bar opens on when a book's find (components/BookFind) opens a
 * chapter at one of its matches: its words, its switches, and which match,
 * the first being 0, counted as the bar counts them.
 */
export type FindSeed = { words: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean; index: number }

const opening = new WeakMap<Editor, (seed?: FindSeed) => void>()
/** A seed for an editor whose bar isn't there yet, the chapter having only just opened: taken as it comes. */
const waiting = new WeakMap<Editor, FindSeed>()

/** ⌘F, the Mac's Edit menu, and Commands. Again with the bar open, the field takes the keyboard back. With a seed, it opens on that. */
export function openFind(editor: Editor, seed?: FindSeed) {
  const open = opening.get(editor)
  if (open) open(seed)
  else if (seed) waiting.set(editor, seed)
}

/** The match at `index` in the document's order, the first being 0, or null if there aren't that many. */
function nth(query: SearchQuery, state: EditorState, index: number): SearchResult | null {
  let found = query.findNext(state, 0)
  for (let i = 0; found && i < index; i++) found = query.findNext(state, found.to)
  return found
}

/** How far down the scroller a match has to be to clear the bar, with one row and with two. */
const CLEAR_OF_BAR = 64
const CLEAR_OF_BOTH_ROWS = 100

/** ProseMirror scrolls to a selection only when it has the focus, and here a field has it. */
function reveal(editor: Editor, pos: number, clear: number) {
  const scroller = scrollerOf(editor)
  if (!scroller) return
  const match = editor.view.coordsAtPos(pos)
  const pane = scroller.getBoundingClientRect()
  if (match.top < pane.top + clear || match.bottom > pane.bottom - 16) scroller.scrollBy({ top: match.top - (pane.top + pane.height / 3) })
}

/** Find in the note or page that's open. Held by the Editor, so it goes with its document. */
export function FindBar({ editor, readOnly }: { editor: Editor; readOnly: boolean }) {
  // Counted, so each ⌘F reaches an open bar. None is closed.
  const [asked, setAsked] = useState(0)
  // A seed starts the bar afresh, on what it says.
  const [seeded, setSeeded] = useState<{ seed: FindSeed; at: number } | null>(null)
  useEffect(() => {
    const open = (seed?: FindSeed) => {
      if (seed) setSeeded((was) => ({ seed, at: (was?.at ?? 0) + 1 }))
      setAsked((times) => times + 1)
    }
    opening.set(editor, open)
    const early = waiting.get(editor)
    waiting.delete(editor)
    if (early) open(early)
    return () => void opening.delete(editor)
  }, [editor])
  function close() {
    setAsked(0)
    setSeeded(null)
  }
  return asked > 0 ? <Bar key={seeded?.at ?? 0} editor={editor} asked={asked} seed={seeded?.seed} readOnly={readOnly} onClose={close} /> : null
}

function Bar({ editor, asked, seed, readOnly, onClose }: { editor: Editor; asked: number; seed?: FindSeed; readOnly: boolean; onClose: () => void }) {
  useEditorPlugin(editor, () => highlighting, highlighting.spec.key!)

  // What was selected on one line is what's looked for, as anywhere on a Mac.
  const [words, setWords] = useState(() => {
    if (seed) return seed.words
    const { from, to } = editor.state.selection
    const picked = editor.state.doc.textBetween(from, to, '\n')
    return picked.includes('\n') ? '' : picked
  })
  // Each letter looks again from where the search began, so it doesn't creep down the document.
  const start = useRef(editor.state.selection.from)
  // A seed's match, gone to once.
  const goTo = useRef(seed?.index ?? null)
  const field = useRef<HTMLInputElement>(null)
  const replaceField = useRef<HTMLInputElement>(null)
  // Seeded, its switches are to be seen, in the row they're in.
  const [replacing, setReplacing] = useState(Boolean(seed))
  const [replacement, setReplacement] = useState('')
  // How many the last Replace All changed, until the next thing done here.
  const [replaced, setReplaced] = useState<number | null>(null)
  const [regex, setRegex] = useState(seed?.regex ?? false)
  // "Ann" and not "ann"; "Ann" and not "Anne" or "Annual".
  const [caseSensitive, setCaseSensitive] = useState(seed?.caseSensitive ?? false)
  const [wholeWord, setWholeWord] = useState(seed?.wholeWord ?? false)
  const [trouble, setTrouble] = useState<PatternTrouble | null>(null)
  const clear = useRef(CLEAR_OF_BAR)
  clear.current = replacing ? CLEAR_OF_BOTH_ROWS : CLEAR_OF_BAR

  useEffect(() => {
    // Opened at a match on a phone or an iPad, the match is what's to be seen, not the keyboard.
    if (seed && touchApp) return
    const take = () => {
      field.current?.focus()
      field.current?.select()
    }
    if (!seed) return take()
    // A chapter just opened takes the focus a frame on (./Editor), which would show the formatting bar over the match: taken back after it.
    const frame = requestAnimationFrame(take)
    return () => cancelAnimationFrame(frame)
  }, [asked, seed])

  // The row opened by a seed doesn't take the keyboard from the field.
  const rowOpened = useRef(replacing)
  useEffect(() => {
    if (replacing && !rowOpened.current) replaceField.current?.focus()
    rowOpened.current = false
  }, [replacing])

  useEffect(() => {
    function show(query: SearchQuery) {
      const { state, view } = editor
      const seeded = goTo.current !== null && query.valid ? nth(query, state, goTo.current) : null
      goTo.current = null
      if (seeded) start.current = seeded.from
      const found = seeded ?? (query.valid ? (query.findNext(state, start.current) ?? query.findNext(state)) : null)
      const tr = setSearchState(state.tr, query)
      if (found) tr.setSelection(TextSelection.create(state.doc, found.from, found.to))
      view.dispatch(tr)
      if (found) reveal(editor, found.from, clear.current)
    }
    const query = new SearchQuery({ search: words, regexp: regex, literal: true, caseSensitive, wholeWord })
    if (!regex || !query.valid) return show(query)
    const check = checkPattern(words, editor.state.doc)
    void check.done.then((wrong) => {
      setTrouble(wrong)
      show(wrong ? new SearchQuery({ search: '' }) : query)
    })
    return check.cancel
  }, [editor, words, regex, caseSensitive, wholeWord])

  const { total, at } = useEditorState({
    editor,
    selector: ({ editor: live }) => {
      const { from, to } = live.state.selection
      const matches = getMatchHighlights(live.state).find().sort((a, b) => a.from - b.from)
      return { total: matches.length, at: matches.findIndex((match) => match.from === from && match.to === to) + 1 }
    },
  })

  function step(command: Command) {
    setReplaced(null)
    if (command(editor.state, editor.view.dispatch)) reveal(editor, editor.state.selection.from, clear.current)
  }

  // What to put in travels with the query, so it's brought up to date just before it's used.
  function withReplacement() {
    editor.view.dispatch(setSearchState(editor.state.tr, new Replacing({ search: words, replace: replacement, regexp: regex, literal: true, caseSensitive, wholeWord })))
  }

  function replaceOne() {
    withReplacement()
    step(replaceNext)
  }

  // One change, so one Undo brings them all back.
  function replaceEvery() {
    withReplacement()
    replaceAll(editor.state, editor.view.dispatch)
    setReplaced(total)
  }

  function toggleReplacing() {
    // The switches go with their row, so a closed row can't leave words being read as a pattern, or capitals or whole words still counting.
    if (replacing) {
      field.current?.focus()
      setRegex(false)
      setCaseSensitive(false)
      setWholeWord(false)
      setTrouble(null)
    }
    setReplacing(!replacing)
  }

  function toggle(set: (change: (on: boolean) => boolean) => void) {
    field.current?.focus()
    setTrouble(null)
    set((on) => !on)
  }

  const invalid = regex && words !== '' && !new SearchQuery({ search: words, regexp: true }).valid

  function close() {
    onClose()
    // Back to the writing, at what was found. Not on iPhone or iPad, where that would raise the keyboard.
    if (!touchApp) editor.view.focus()
  }

  function onKeyDown(event: KeyboardEvent, enter: (shift: boolean) => void) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      enter(event.shiftKey)
    }
  }

  return (
    // No height of its own, so opening it doesn't move the text, until the
    // second row would cover the first line. It stays at the top as the text scrolls.
    <div className={`sticky top-[52px] z-20 ${replacing ? 'h-9' : 'h-0'}`}>
      <div role="search" className="relative -top-[52px] ml-auto w-[min(340px,100%)] rounded-lg border border-line bg-paper p-1 shadow-md">
        <div className="flex items-center gap-1">
          <BarButton label={`${replacing ? 'Hide' : 'Show'} ${readOnly ? 'options' : 'replace'}`} expanded={replacing} onClick={toggleReplacing}>
            <path d={replacing ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4'} />
          </BarButton>
          <input
            ref={field}
            value={words}
            onChange={(event) => {
              setReplaced(null)
              setTrouble(null)
              setWords(event.target.value)
            }}
            onKeyDown={(event) => onKeyDown(event, (shift) => step(shift ? findPrev : findNext))}
            aria-label="Find in this document"
            placeholder={regex ? 'Pattern' : 'Find'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={FIELD}
          />
          <span role="status" className="shrink-0 text-[11px] text-muted tabular-nums">
            {replaced !== null
              ? `Replaced ${replaced}`
              : invalid
                ? 'Invalid pattern'
                : trouble
                  ? PATTERN_TROUBLE[trouble]
                  : words && (total === 0 ? 'No matches' : at ? `${at} of ${total}` : `${total} found`)}
          </span>
          <BarButton label="Previous match" disabled={total === 0} onClick={() => step(findPrev)}>
            <path d="M4 10l4-4 4 4" />
          </BarButton>
          <BarButton label="Next match" disabled={total === 0} onClick={() => step(findNext)}>
            <path d="M4 6l4 4 4-4" />
          </BarButton>
          <BarButton label="Close find" onClick={close}>
            <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
          </BarButton>
        </div>
        {replacing && (
          <div className="flex items-center gap-1 pt-1">
            <FindSwitches caseSensitive={caseSensitive} wholeWord={wholeWord} regex={regex} onCase={() => toggle(setCaseSensitive)} onWhole={() => toggle(setWholeWord)} onRegex={() => toggle(setRegex)} />
            {!readOnly && (
              <>
                <input
                  ref={replaceField}
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                  onKeyDown={(event) => onKeyDown(event, replaceOne)}
                  aria-label="Replace with"
                  placeholder="Replace with"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className={FIELD}
                />
                <WordButton disabled={total === 0} onClick={replaceOne}>
                  Replace
                </WordButton>
                <WordButton label="Replace all" disabled={total === 0} onClick={replaceEvery}>
                  All
                </WordButton>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const FIELD = 'min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint pointer-coarse:text-[16px]'

// The field keeps the focus, and on iPhone and iPad the keyboard stays up.
const keepFocus = (event: MouseEvent) => event.preventDefault()

/** Match case, Whole words and a pattern: here, and in a book's find (components/BookFind). */
export function FindSwitches({ caseSensitive, wholeWord, regex, onCase, onWhole, onRegex }: { caseSensitive: boolean; wholeWord: boolean; regex: boolean; onCase: () => void; onWhole: () => void; onRegex: () => void }) {
  return (
    <>
      <BarButton label="Match case" pressed={caseSensitive} onClick={onCase}>
        <text x="8" y="12" textAnchor="middle" fontSize="10.5" fill="currentColor" stroke="none">
          Aa
        </text>
      </BarButton>
      <BarButton label="Whole words" pressed={wholeWord} onClick={onWhole}>
        <text x="8" y="10" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">
          ab
        </text>
        <path d="M3.5 11.5v2h9v-2" />
      </BarButton>
      <BarButton label="Regular expression" pressed={regex} onClick={onRegex}>
        <text x="8" y="12" textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fill="currentColor" stroke="none">
          .*
        </text>
      </BarButton>
    </>
  )
}

function BarButton({ label, expanded, pressed, disabled, onClick, children }: { label: string; expanded?: boolean; pressed?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      aria-expanded={expanded}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={keepFocus}
      className="nib-tap flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:text-ink disabled:cursor-default disabled:opacity-40 aria-pressed:bg-item-active aria-pressed:text-ink"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}

function WordButton({ label, disabled, onClick, children }: { label?: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={keepFocus}
      className="nib-tap shrink-0 cursor-pointer rounded-md px-2 py-1 text-[12px] font-medium text-ink hover:bg-item-hover disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  )
}
