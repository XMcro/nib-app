import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { type Editor, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Transaction } from '@tiptap/pm/state'
import { toMarkdown } from '../lib/markdown'
import { copyText, SEALED_COPY } from '../lib/clipboard'
import { shortcut, showsShortcuts, touchApp } from '../lib/platform'
import { IMAGE_SIZES, asImageSize, type ImageSize } from '../lib/image'
import { TOOLBAR_TOOLS, useLook, type ToolbarTool } from '../lib/look'
import { AlignIcon, ListIcon, TextGlyph } from './FormatGlyph'
import { formatById } from './formats'
import { nibWindow } from '../lib/keyboard'
import { ASK_FOR_NOTE, NOTE_TO_SELF } from './NoteToSelf'

type Hint = { label: string; keys?: string }
type Tool = { label: string; keys?: string; wide?: boolean; group: 'words' | 'blocks'; active: boolean; run: () => void; glyph: ReactNode }

// The row's buttons that are styles from editor/formats as they stand.
const FROM_FORMATS = TOOLBAR_TOOLS.map((tool) => tool.id).filter((id) => formatById(id))
type Prompt = { field: 'link' | 'footnote' | 'note'; value: string }

/** A picture's sizes, as its row names them (lib/image IMAGE_SIZES). */
const SIZE_NAMES: Record<ImageSize, { label: string; short: string }> = {
  small: { label: 'Small', short: 'S' },
  medium: { label: 'Medium', short: 'M' },
  large: { label: 'Large', short: 'L' },
  full: { label: 'Full width', short: 'Full' },
}
/** Where a picture sits on its line: its line's alignment (editor/formats), which index.css has move the picture too. */
const PICTURE_ALIGN = ['format-align-left', 'format-align-center', 'format-align-right']

const PLACEHOLDER: Record<Prompt['field'], string> = {
  link: 'Paste a link, then press Return',
  footnote: 'Write the footnote, then press Return',
  note: 'Write the note, then press Return',
}

export function SelectionToolbar({
  editor,
  showHeading,
  sealed = false,
}: {
  editor: Editor
  showHeading: boolean
  /** A locked note's: copied for this device alone, and only for a while (lib/clipboard SEALED_COPY). */
  sealed?: boolean
}) {
  const { toolbar } = useLook()
  const [hint, setHint] = useState<Hint | null>(null)
  const [more, setMore] = useState(false)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const promptField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const ask = ({ transaction }: { transaction: Transaction }) => transaction.getMeta(ASK_FOR_NOTE) && setPrompt({ field: 'note', value: '' })
    editor.on('transaction', ask)
    return () => void editor.off('transaction', ask)
  }, [editor])

  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      code: editor.isActive('code'),
      link: editor.isActive('link'),
      formats: Object.fromEntries(FROM_FORMATS.map((id) => [id, formatById(id)!.active(editor)])),
      footnote: editor.isActive('footnote'),
      footnoteText: (editor.getAttributes('footnote').text as string) ?? '',
      // A picture selected: its own row, in place of the styles, which are for words.
      picture: editor.isActive('image'),
      size: asImageSize(editor.getAttributes('image').size),
      aligned: Object.fromEntries(PICTURE_ALIGN.map((id) => [id, formatById(id)!.active(editor)])),
    }),
  })

  // Clicking a footnote selects the atom; show its text for editing rather
  // than formatting controls, which do not apply to it.
  const [footnoteDraft, setFootnoteDraft] = useState<string | null>(null)
  useEffect(() => {
    setFootnoteDraft(active.footnote ? active.footnoteText : null)
  }, [active.footnote, active.footnoteText])

  function saveFootnote(event: React.FormEvent) {
    event.preventDefault()
    const text = footnoteDraft?.trim()
    if (text) editor.chain().focus().updateAttributes('footnote', { text }).run()
    else editor.chain().focus().deleteSelection().run()
  }

  function run(fn: () => void) {
    fn()
    setMore(false)
  }

  // The picture chosen, at this size or, for null, its own. By the one attribute, so it's still the picture chosen after,
  // with its row: given new attributes whole (updateAttributes), a picture is put in afresh, and nothing is chosen.
  function resize(size: ImageSize | null) {
    editor
      .chain()
      .focus()
      .command(({ tr, state }) => {
        if (state.doc.nodeAt(state.selection.from)?.type.name !== 'image') return false
        tr.setNodeAttribute(state.selection.from, 'size', size)
        return true
      })
      .run()
  }

  // Every button the row can hold (lib/look TOOLBAR_TOOLS). The ones from the
  // shared list of styles (editor/formats) run and light up as it says.
  const format = (id: ToolbarTool, group: Tool['group'], glyph: ReactNode): Tool => {
    const style = formatById(id)!
    return { label: style.label, keys: style.keys, group, glyph, active: active.formats[id], run: () => style.run(editor) }
  }
  const letter = (id: ToolbarTool) => format(id, 'words', <TextGlyph id={id} small />)
  const list = (id: ToolbarTool) => format(id, 'blocks', <ListIcon id={id} />)
  const tools: Record<ToolbarTool, Tool> = {
    'format-bold': letter('format-bold'),
    'format-italic': letter('format-italic'),
    'format-strike': letter('format-strike'),
    link: {
      label: active.link ? 'Remove link' : 'Add a link',
      group: 'words',
      active: active.link,
      run: () => {
        if (active.link) editor.chain().focus().unsetLink().run()
        else setPrompt({ field: 'link', value: '' })
      },
      glyph: <LinkIcon />,
    },
    'format-heading': { ...format('format-heading', 'blocks', <span className="text-[12.5px] font-semibold">H2</span>), wide: true },
    'format-quote': format('format-quote', 'blocks', <span className="pt-1.5 font-serif text-[17px] leading-none font-semibold">”</span>),
    code: { label: 'Code', keys: shortcut('E'), group: 'blocks', active: active.code, run: () => editor.chain().focus().toggleCode().run(), glyph: <span className="font-mono text-[12px]">‹›</span> },
    'format-underline': letter('format-underline'),
    'format-highlight': letter('format-highlight'),
    'format-checklist': list('format-checklist'),
    'format-bullets': list('format-bullets'),
    'format-numbers': list('format-numbers'),
  }
  // A note has no headings.
  const offered = TOOLBAR_TOOLS.map((tool) => tool.id).filter((id) => showHeading || id !== 'format-heading')
  const row = toolbar.flatMap((id) => offered.find((tool) => tool === id) ?? [])

  function submitPrompt(event: React.FormEvent) {
    event.preventDefault()
    const value = prompt?.value.trim()
    if (value && prompt?.field === 'link') {
      editor.chain().focus().setLink({ href: value }).run()
    } else if (value && prompt?.field === 'footnote') {
      // Collapse first: insertContent would otherwise replace the selection
      // that opened this toolbar.
      editor
        .chain()
        .focus()
        .setTextSelection(editor.state.selection.to)
        .insertContent({ type: 'footnote', attrs: { text: value } })
        .run()
    } else if (value && prompt?.field === 'note') {
      editor.chain().focus().setMark(NOTE_TO_SELF, { id: crypto.randomUUID(), text: value }).run()
    }
    setPrompt(null)
  }

  // Every mark but a note to self, which isn't formatting.
  function clearFormatting() {
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        const marks = Object.values(tr.doc.type.schema.marks).filter((type) => type.name !== NOTE_TO_SELF)
        for (const { $from, $to } of tr.selection.ranges) for (const type of marks) tr.removeMark($from.pos, $to.pos, type)
        return true
      })
      .clearNodes()
      .run()
  }

  function copyAsMarkdown() {
    const fragment = editor.state.selection.content().content.toJSON()
    const content = Array.isArray(fragment) ? fragment : []
    void copyText(toMarkdown({ type: 'doc', content }), undefined, sealed ? SEALED_COPY : undefined).catch((error) => console.warn('Nib: could not copy', error))
    setMore(false)
  }

  return (
    <BubbleMenu
      editor={editor}
      // flip/shift keep the pill on screen when the selection sits near an edge.
      // Asked for from ⌘K, the field was made while the toolbar was away, and
      // takes the focus once it's back.
      options={{ placement: 'top', offset: 10, flip: true, shift: { padding: 4 }, onShow: () => promptField.current?.focus() }}
    >
      {/* column-reverse: the ••• panel sits above, the toolbar row below. */}
      <div className="nib-float flex origin-bottom flex-col-reverse items-start gap-[6px]">
        {/* The hover label sits beside the pill, not above it (design 1d). */}
        <div className="flex items-center gap-[9px]">
          {footnoteDraft !== null ? (
            <form onSubmit={saveFootnote} className="flex items-center rounded-lg border border-line bg-paper p-1">
              <input
                autoFocus
                value={footnoteDraft}
                onChange={(event) => setFootnoteDraft(event.target.value)}
                onKeyDown={(event) => event.key === 'Escape' && editor.commands.focus()}
                placeholder="Empty to remove this footnote"
                className="h-7 w-[250px] bg-transparent px-2 pointer-coarse:h-11 text-[12px] outline-none placeholder:text-faint pointer-coarse:text-[16px]"
              />
            </form>
          ) : active.picture ? (
            <div role="toolbar" aria-label="Picture" className="flex items-center gap-px rounded-lg border border-line bg-paper p-1 pointer-coarse:gap-0">
              {/* Chosen again, a size is taken off, and the picture is its own size once more. */}
              {IMAGE_SIZES.map((size) => (
                <Button key={size} label={SIZE_NAMES[size].label} wide active={active.size === size} onHint={setHint} onClick={() => resize(active.size === size ? null : size)}>
                  <span className="text-[12px] font-medium">{SIZE_NAMES[size].short}</span>
                </Button>
              ))}
              <Separator />
              {PICTURE_ALIGN.map((id) => (
                <Button key={id} label={formatById(id)!.label} active={active.aligned[id]} onHint={setHint} onClick={() => formatById(id)!.run(editor)}>
                  <AlignIcon id={id} />
                </Button>
              ))}
            </div>
          ) : prompt === null ? (
            <div role="toolbar" aria-label="Selection" className="flex items-center gap-px rounded-lg border border-line bg-paper p-1 pointer-coarse:gap-0">
              {/* On touch every button is 44pt, and the gaps and separator margins
                  give way so all eight still fit a 375pt iPhone: 8 × 44 + 12 = 364.
                  Customize can choose up to seven of them, beside More; a
                  separator stands wherever the row passes from styling words
                  to shaping blocks. */}
              {row.map((id, index) => (
                <Fragment key={id}>
                  {index > 0 && tools[id].group !== tools[row[index - 1]].group && <Separator />}
                  <Button label={tools[id].label} keys={tools[id].keys} wide={tools[id].wide} active={tools[id].active} onHint={setHint} onClick={() => run(tools[id].run)}>
                    {tools[id].glyph}
                  </Button>
                </Fragment>
              ))}

              {row.length > 0 && <Separator />}

              <Button
                label="More"
                active={more}
                onHint={setHint}
                onClick={() => {
                  // On iPhone and iPad the system's Cut, Copy and Paste menu sits by
                  // the selection, over the panel's rows: put away while it's open.
                  if (!more && touchApp) nibWindow.hideEditMenu().catch(() => {})
                  setMore(!more)
                }}
              >
                <span className="text-[12px] tracking-[0.5px] text-muted">•••</span>
              </Button>
            </div>
          ) : (
            <form onSubmit={submitPrompt} className="flex items-center rounded-lg border border-line bg-paper p-1">
              <input
                ref={promptField}
                autoFocus
                value={prompt.value}
                onChange={(event) => setPrompt({ ...prompt, value: event.target.value })}
                onKeyDown={(event) => event.key === 'Escape' && setPrompt(null)}
                placeholder={PLACEHOLDER[prompt.field]}
                className="h-7 w-[250px] bg-transparent px-2 pointer-coarse:h-11 text-[12px] outline-none placeholder:text-faint pointer-coarse:text-[16px]"
              />
            </form>
          )}

          {hint && (prompt === null || active.picture) && (
            <div className="inline-flex items-baseline gap-2 rounded-md border border-line bg-paper px-[9px] py-[5px]">
              <span className="text-[11.5px] whitespace-nowrap">{hint.label}</span>
              {hint.keys && showsShortcuts && (
                <span className="font-mono text-[11px] whitespace-nowrap text-[#8E8E8A] dark:text-[#7C7C82]">
                  {hint.keys}
                </span>
              )}
            </div>
          )}
        </div>

        {more && prompt === null && !active.picture && (
          <div className="nib-float flex w-[262px] origin-bottom-left flex-wrap gap-[2px] rounded-lg border border-line bg-paper p-1">
            {/* Whatever isn't on the row above, in Customize's order. */}
            {offered.filter((id) => !row.includes(id)).map((id) => (
              <MoreItem key={id} onClick={() => run(tools[id].run)}>
                {tools[id].label}
              </MoreItem>
            ))}
            <MoreItem onClick={() => run(() => setPrompt({ field: 'footnote', value: '' }))}>
              Add a footnote
            </MoreItem>
            <MoreItem onClick={() => run(() => setPrompt({ field: 'note', value: '' }))}>
              Add a note to self
            </MoreItem>
            <MoreItem onClick={copyAsMarkdown}>Copy as Markdown</MoreItem>
            <MoreItem muted onClick={() => run(clearFormatting)}>
              Clear formatting
            </MoreItem>
          </div>
        )}
      </div>
    </BubbleMenu>
  )
}

function Separator() {
  return <span role="separator" className="mx-1 h-4 w-px shrink-0 bg-line pointer-coarse:mx-0" />
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5.9 8.1a2.4 2.4 0 0 0 3.4 0l1.9-1.9a2.4 2.4 0 1 0-3.4-3.4l-.8.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M8.1 5.9a2.4 2.4 0 0 0-3.4 0L2.8 7.8a2.4 2.4 0 1 0 3.4 3.4l.8-.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function Button({
  label,
  keys,
  active,
  wide,
  onClick,
  onHint,
  children,
}: {
  label: string
  keys?: string
  active: boolean
  wide?: boolean
  onClick: () => void
  onHint: (hint: Hint | null) => void
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      onMouseEnter={() => onHint({ label, keys })}
      onMouseLeave={() => onHint(null)}
      className={`flex h-7 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-item-hover pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:px-0 ${
        wide ? 'px-2' : 'w-[30px]'
      } ${active ? 'bg-item-hover' : ''}`}
    >
      {children}
    </button>
  )
}

function MoreItem({
  onClick,
  muted,
  children,
}: {
  onClick: () => void
  muted?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`h-[26px] cursor-pointer rounded-[5px] px-2 text-[12px] hover:bg-item-hover pointer-coarse:h-11 ${
        muted ? 'text-muted' : ''
      }`}
    >
      {children}
    </button>
  )
}
