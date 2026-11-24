import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { type Editor, useEditorState } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { useKeyboard } from '../lib/keyboard'
import { useLook } from '../lib/look'
import { AlignIcon, ListIcon, TextGlyph } from './FormatGlyph'
import { formatById, formatsFor, type Format } from './formats'
import { ELEMENT_NAMES, SETTABLE, type Element, type Settable } from '../lib/fountain'
import { screenplayKey } from './Screenplay'
import { scrollerOf } from './scroller'
import { useEditorPlugin } from './useEditorPlugin'

const PARAGRAPH = ['format-title', 'format-heading', 'format-subheading', 'format-heading-four', 'format-heading-five', 'format-heading-six', 'format-body', 'format-mono', 'format-quote']
const TEXT = ['format-bold', 'format-italic', 'format-underline', 'format-strike', 'format-highlight']
const LISTS = ['format-checklist', 'format-bullets', 'format-numbers', 'format-outdent', 'format-indent']
const ALIGN = ['format-align-left', 'format-align-center', 'format-align-right', 'format-justify']
// A table on a page, or with the caret in one, what can be done to it.
const TABLE_EDITS = ['table-add-row', 'table-add-column', 'table-delete-row', 'table-delete-column', 'table-delete']

const clearOfBar = new PluginKey('clearOfBar')

/** The elements' names on the bar, short enough for a phone. */
const SHORT: Record<Settable, string> = { scene: 'Scene', action: 'Action', character: 'Character', parenthetical: '( )', dialogue: 'Dialogue', transition: 'Transition' }

/** What the caret's line in a screenplay is, as the bar lights it. */
function lineElement(editor: Editor): Element | null {
  const { $from } = editor.state.selection
  return $from.depth >= 1 ? (screenplayKey.getState(editor.state)?.lines[$from.index(0)]?.element ?? null) : null
}

/** How long after a finger lifts from the text the bar can be pressed again. */
const SETTLE_MS = 100

/**
 * On an iPhone or iPad the selection toolbar appears only over selected text.
 * With nothing but a caret, which on a phone is most of the time, there was no
 * way to start a checklist or a numbered list short of typing the Markdown.
 * This bar sits on the keyboard while the text has focus, as in Notes, and Aa
 * opens every style.
 *
 * It rides up and down on the keyboard (lib/keyboard), and the text runs on
 * beneath both, as text does on iOS: the caret is kept clear of them instead.
 *
 * Every press is kept from taking focus (onMouseDown), or the editor would
 * blur, the keyboard would drop, and the bar would vanish under the finger.
 *
 * In a screenplay (editor/Screenplay) its row is the elements instead, the
 * caret's line's lit, and Aa has only the text's styles.
 */
export function FormatBar({ editor, page, screenplay = false }: { editor: Editor; page: boolean; screenplay?: boolean }) {
  const [focused, setFocused] = useState(editor.isFocused)
  const [open, setOpen] = useState(false)
  const { over, sliding } = useKeyboard()
  const { keyboardBar } = useLook()
  const bar = useRef<HTMLDivElement>(null)

  // What the bar and the keyboard cover of the foot of the text, and where the bar's top is headed.
  const [room] = useState(() => ({ covered: 0, top: Infinity }))
  // A finger down anywhere but on the bar, and whether the caret waits for it to lift.
  const [finger] = useState(() => ({ down: false, waiting: false }))
  // The caret is scrolled clear of them here rather than by ProseMirror, a
  // frame after the keystroke, and only in the text. iOS's web view put a
  // scroll made in the keystroke itself back where the last other scroll had
  // left the text (often this bar's own, as the keyboard rose), so a new last
  // line stayed under the bar. And ProseMirror scrolled the page as well, which
  // the app holds still; done out of a keystroke, the web view then went on
  // taking the page as scrolled.
  useEditorPlugin(
    editor,
    () =>
      new Plugin({
        key: clearOfBar,
        props: {
          handleScrollToSelection(view) {
            requestAnimationFrame(() => {
              if (view.isDestroyed) return
              const scroller = scrollerOf(editor)
              if (!scroller) return
              const caret = view.coordsAtPos(view.state.selection.head, 1)
              const { top, bottom } = scroller.getBoundingClientRect()
              if (caret.bottom > bottom - room.covered) scroller.scrollTop += caret.bottom - bottom + room.covered + 8
              else if (caret.top < top) scroller.scrollTop -= top - caret.top + 5
            })
            return true
          },
        },
      }),
    clearOfBar,
  )

  // The caret, or the end of the words chosen, brought up clear of the bar.
  // Where the page has it: the tap or press that raised the keyboard has put
  // it there, and the editor reads it only a moment later, so its own was
  // still where the last writing left it, often the end of the text.
  const bringClear = useEffectEvent(() => {
    const scroller = scrollerOf(editor)
    const chosen = getSelection()
    if (!scroller || !chosen?.focusNode || !editor.view.dom.contains(chosen.focusNode)) return
    let caret: { bottom: number }
    try {
      caret = editor.view.coordsAtPos(editor.view.posAtDOM(chosen.focusNode, chosen.focusOffset))
    } catch {
      return
    }
    if (caret.bottom > room.top - 8) scroller.scrollBy({ top: caret.bottom - room.top + 8, behavior: 'smooth' })
  })

  // Measured where the bar is headed, not where it is mid-slide. When the
  // keyboard arrives, or Aa opens more rows, the caret is brought up clear of
  // them: the tap that raised the keyboard was often on a line it now covers.
  useLayoutEffect(() => {
    const element = bar.current
    const scroller = scrollerOf(editor)
    // Unfocused, the room is left as it was: taking it away would pull the
    // end of the text down as the keyboard went.
    if (!focused || !element || !scroller) return
    const safe = parseFloat(getComputedStyle(element).paddingBottom) || 0
    const top = innerHeight - element.offsetHeight - Math.max(0, over - safe)
    const covered = Math.max(0, Math.round(scroller.getBoundingClientRect().bottom - top))
    room.covered = covered
    room.top = top
    document.documentElement.style.setProperty('--nib-covered', `${covered}px`)
    // Not from under a finger still down, as a long press that raised the
    // keyboard is: the words it was choosing ran on to wherever the text had
    // gone beneath it. Once it lifts.
    if (finger.down) finger.waiting = true
    else bringClear()
  }, [editor, room, finger, focused, over, open])

  // A finger that came down anywhere but on the bar isn't pressing it. Drawn
  // down over it while choosing words, it reaches the text beneath instead:
  // taken for somewhere past the text, the bar had iOS choose to the end.
  useEffect(() => {
    const element = bar.current
    if (!element) return
    let settling: ReturnType<typeof setTimeout> | undefined
    const down = (event: TouchEvent) => {
      if (element.contains(event.target as Node)) return
      clearTimeout(settling)
      finger.down = true
      element.style.pointerEvents = 'none'
    }
    // A moment after it lifts: iOS settles the words chosen where it lifted just after.
    const up = (event: TouchEvent) => {
      if (!finger.down || event.touches.length > 0) return
      finger.down = false
      settling = setTimeout(() => {
        element.style.pointerEvents = ''
        if (finger.waiting && editor.isFocused) bringClear()
        finger.waiting = false
      }, SETTLE_MS)
    }
    const options = { capture: true, passive: true }
    window.addEventListener('touchstart', down, options)
    window.addEventListener('touchend', up, options)
    window.addEventListener('touchcancel', up, options)
    return () => {
      clearTimeout(settling)
      window.removeEventListener('touchstart', down, options)
      window.removeEventListener('touchend', up, options)
      window.removeEventListener('touchcancel', up, options)
    }
  }, [editor, finger])

  useEffect(() => {
    const onFocus = () => setFocused(true)
    const onBlur = () => {
      setFocused(false)
      setOpen(false)
    }
    editor.on('focus', onFocus)
    editor.on('blur', onBlur)
    return () => {
      editor.off('focus', onFocus)
      editor.off('blur', onBlur)
    }
  }, [editor])

  // Up with the keyboard's own curve, down with its quicker fall; not at all
  // when only the page changed size beneath it.
  const target = focused ? over : -1
  const last = useRef(target)
  const lastFocused = useRef(focused)
  const motion = !sliding && focused === lastFocused.current ? '' : target >= last.current ? 'nib-bar-up' : 'nib-bar-down'
  useEffect(() => {
    last.current = target
    lastFocused.current = focused
  })

  const formats = formatsFor(page)
  const active = useEditorState({
    editor,
    selector: ({ editor }) => Object.fromEntries(formats.map((format) => [format.id, format.active(editor)])),
  })

  const element = useEditorState({ editor, selector: ({ editor }) => (screenplay ? lineElement(editor) : null) })
  const offered = (ids: string[]) => ids.filter((id) => formats.some((format) => format.id === id)).map((id) => formatById(id)!)
  const press = (format: Format) => format.run(editor)

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Formatting"
      aria-hidden={!focused}
      inert={!focused}
      onMouseDown={(event) => event.preventDefault()}
      // On the keyboard, the home indicator's padding lies behind it; with
      // none, or a floating one, the bar sits at the bottom of the screen.
      // Away, below it.
      style={{ transform: focused ? `translateY(min(0px, calc(env(safe-area-inset-bottom) - ${over}px)))` : 'translateY(100%)' }}
      // Its colour carries on below it, so a moment out of step with the
      // keyboard never shows the text through a gap.
      className={`${motion} fixed inset-x-0 bottom-0 z-20 border-t border-line bg-shell pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] after:absolute after:inset-x-0 after:top-full after:h-[400px] after:bg-shell after:content-['']`}
    >
      {open && screenplay && (
        <div className="flex gap-1 border-b border-line px-2 py-2">
          {offered(TEXT).map((format) => (
            <Square key={format.id} format={format} active={active[format.id]} onPress={press}>
              <TextGlyph id={format.id} />
            </Square>
          ))}
        </div>
      )}
      {open && !screenplay && (
        <div className="flex flex-col gap-1.5 border-b border-line px-2 py-2">
          <div className="flex flex-wrap gap-1">
            {offered(PARAGRAPH).map((format) => (
              <Chip key={format.id} format={format} active={active[format.id]} onPress={press} />
            ))}
          </div>
          <div className="flex gap-1">
            {offered(TEXT).map((format) => (
              <Square key={format.id} format={format} active={active[format.id]} onPress={press}>
                <TextGlyph id={format.id} />
              </Square>
            ))}
          </div>
          <div className="flex gap-1">
            {offered(LISTS).map((format) => (
              <Square key={format.id} format={format} active={active[format.id]} onPress={press}>
                <ListIcon id={format.id} />
              </Square>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {offered(ALIGN).map((format) => (
              <Square key={format.id} format={format} active={active[format.id]} onPress={press}>
                <AlignIcon id={format.id} />
              </Square>
            ))}
            {offered(['format-callout']).map((format) => (
              <Chip key={format.id} format={format} active={active[format.id]} onPress={press} />
            ))}
            {page &&
              offered(active['table-insert'] ? TABLE_EDITS : ['table-insert']).map((format) => (
                <Chip key={format.id} format={format} active={false} onPress={press} />
              ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-1 px-2">
        <button
          aria-label="Text styles"
          aria-pressed={open}
          onClick={() => setOpen((value) => !value)}
          className={`h-11 cursor-pointer rounded-md px-3 text-[15px] font-semibold ${open ? 'bg-item-active text-ink' : 'text-muted'}`}
        >
          Aa
        </button>
        {/* Lists, unless Customize chose others. More than fit a small
            iPhone scroll sideways rather than push Hide keyboard off. */}
        <div className="flex min-w-0 gap-1 overflow-x-auto">
          {screenplay &&
            SETTABLE.map((one) => (
              <button
                key={one}
                aria-label={ELEMENT_NAMES[one]}
                aria-pressed={element === one}
                onClick={() => editor.chain().focus().setLineElement(one).run()}
                className={`h-11 shrink-0 cursor-pointer rounded-md px-2.5 text-[14px] whitespace-nowrap ${element === one ? 'bg-item-active text-ink' : 'text-muted'}`}
              >
                {SHORT[one]}
              </button>
            ))}
          {!screenplay && offered(keyboardBar).map((format) => (
            <Square key={format.id} format={format} active={active[format.id]} onPress={press}>
              {TEXT.includes(format.id) ? <TextGlyph id={format.id} /> : <ListIcon id={format.id} />}
            </Square>
          ))}
        </div>
        <span className="flex-1" />
        <button
          aria-label="Hide keyboard"
          onClick={() => editor.commands.blur()}
          className="flex size-11 cursor-pointer items-center justify-center rounded-md text-muted"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 6.5 8 10.5l4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function Chip({ format, active, onPress }: { format: Format; active: boolean; onPress: (format: Format) => void }) {
  return (
    <button
      aria-label={format.short && format.label}
      aria-pressed={active}
      onClick={() => onPress(format)}
      className={`h-11 cursor-pointer rounded-md border px-3 text-[14px] ${
        active ? 'border-accent bg-item-active text-ink' : 'border-line text-ink'
      } ${format.id === 'format-title' ? 'font-semibold' : ''} ${format.id === 'format-mono' ? 'font-mono text-[13px]' : ''}`}
    >
      {format.short ?? format.label}
    </button>
  )
}

function Square({
  format,
  active,
  onPress,
  children,
}: {
  format: Format
  active: boolean
  onPress: (format: Format) => void
  children: ReactNode
}) {
  return (
    <button
      aria-label={format.label}
      aria-pressed={active}
      onClick={() => onPress(format)}
      className={`flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md ${active ? 'bg-item-active text-ink' : 'text-muted'}`}
    >
      {children}
    </button>
  )
}
