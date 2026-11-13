import type { Editor } from '@tiptap/core'
import type { Alignment } from '../lib/alignment'
import { CALLOUT_KINDS, CALLOUT_NAMES, type CalloutKind } from '../lib/callouts'
import { shortcut } from '../lib/platform'

/**
 * Every way Nib shapes text, in one list, so a style cannot exist in one place
 * and be missing from another. The Aa panel above the keyboard, the palette and
 * the Mac's Format menu all read it; the ids are the palette's and the menu's
 * (ios/App/App/AppDelegate.swift). The keys are the editor's own shortcuts,
 * shown as hints, not bound here.
 */
export type Format = {
  id: string
  label: string
  keys?: string
  /** What a chip on the Aa panel says, where the label would crowd it. */
  short?: string
  /** Headings are what makes a page a page; notes do not have them. Nor tables. */
  pagesOnly?: boolean
  /** Offered only with the caret in a table: adding and removing rows and columns. */
  inTable?: boolean
  run: (editor: Editor) => void
  active: (editor: Editor) => boolean
}

const inList = (editor: Editor) => ['bulletList', 'orderedList', 'taskList'].some((type) => editor.isActive(type))
// Indent and outdent move whichever kind of item the caret is in.
const listItem = (editor: Editor) => (editor.isActive('taskItem') ? 'taskItem' : 'listItem')
const never = () => false
// Each kind from the palette and the Mac's menu: makes a callout of it, turns one into it, or takes it off.
const calloutOf = (kind: CalloutKind): Format => ({
  id: `format-callout-${kind}`,
  label: `Callout: ${CALLOUT_NAMES[kind]}`,
  run: (editor) => {
    if (editor.isActive('callout', { kind })) editor.chain().focus().lift('callout').run()
    else if (editor.isActive('callout')) editor.chain().focus().updateAttributes('callout', { kind }).run()
    else editor.chain().focus().wrapIn('callout', { kind }).run()
  },
  active: (editor) => editor.isActive('callout', { kind }),
})
const smallHeading = (id: string, level: 4 | 5 | 6): Format => ({
  id,
  label: `Heading ${level}`,
  short: `H${level}`,
  keys: shortcut(String(level), { alt: true }),
  pagesOnly: true,
  run: (editor) => editor.chain().focus().toggleHeading({ level }).run(),
  active: (editor) => editor.isActive('heading', { level }),
})
// Every line of the selection, in a table's cells too. Chosen again, it's back to where its words put it.
const align = (textAlign: Alignment) => ({
  run: (editor: Editor) => {
    const value = editor.isActive({ textAlign }) ? null : textAlign
    editor.chain().focus().updateAttributes('paragraph', { textAlign: value }).updateAttributes('heading', { textAlign: value }).run()
  },
  active: (editor: Editor) => editor.isActive({ textAlign }),
})

export const FORMATS: Format[] = [
  {
    id: 'format-title',
    label: 'Title',
    keys: shortcut('1', { alt: true }),
    pagesOnly: true,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    active: (editor) => editor.isActive('heading', { level: 1 }),
  },
  {
    id: 'format-heading',
    label: 'Heading',
    keys: shortcut('2', { alt: true }),
    pagesOnly: true,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    active: (editor) => editor.isActive('heading', { level: 2 }),
  },
  {
    id: 'format-subheading',
    label: 'Subheading',
    keys: shortcut('3', { alt: true }),
    pagesOnly: true,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    active: (editor) => editor.isActive('heading', { level: 3 }),
  },
  smallHeading('format-heading-four', 4),
  smallHeading('format-heading-five', 5),
  smallHeading('format-heading-six', 6),
  {
    id: 'format-body',
    label: 'Body',
    keys: shortcut('0', { alt: true }),
    // As in Notes: plain text, out of any heading, list, quote or code block.
    run: (editor) => editor.chain().focus().clearNodes().run(),
    active: (editor) => editor.isActive('paragraph') && !inList(editor) && !editor.isActive('blockquote'),
  },
  {
    id: 'format-mono',
    label: 'Monostyled',
    keys: shortcut('C', { alt: true }),
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    active: (editor) => editor.isActive('codeBlock'),
  },
  {
    id: 'format-quote',
    label: 'Quote',
    keys: shortcut('B', { shift: true }),
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
    active: (editor) => editor.isActive('blockquote'),
  },
  {
    id: 'format-callout',
    label: 'Callout',
    run: (editor) => void (editor.isActive('callout') ? editor.chain().focus().lift('callout').run() : editor.chain().focus().wrapIn('callout').run()),
    active: (editor) => editor.isActive('callout'),
  },
  ...CALLOUT_KINDS.map(calloutOf),
  {
    id: 'format-bold',
    label: 'Bold',
    keys: shortcut('B'),
    run: (editor) => editor.chain().focus().toggleBold().run(),
    active: (editor) => editor.isActive('bold'),
  },
  {
    id: 'format-italic',
    label: 'Italic',
    keys: shortcut('I'),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
    active: (editor) => editor.isActive('italic'),
  },
  {
    id: 'format-underline',
    label: 'Underline',
    keys: shortcut('U'),
    run: (editor) => editor.chain().focus().toggleUnderline().run(),
    active: (editor) => editor.isActive('underline'),
  },
  {
    id: 'format-strike',
    label: 'Strikethrough',
    keys: shortcut('S', { shift: true }),
    run: (editor) => editor.chain().focus().toggleStrike().run(),
    active: (editor) => editor.isActive('strike'),
  },
  {
    id: 'format-highlight',
    label: 'Highlight',
    keys: shortcut('H', { shift: true }),
    run: (editor) => editor.chain().focus().toggleHighlight().run(),
    active: (editor) => editor.isActive('highlight'),
  },
  {
    id: 'format-checklist',
    label: 'Checklist',
    keys: shortcut('9', { shift: true }),
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
    active: (editor) => editor.isActive('taskList'),
  },
  {
    id: 'format-bullets',
    label: 'Bulleted list',
    keys: shortcut('8', { shift: true }),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
    active: (editor) => editor.isActive('bulletList'),
  },
  {
    id: 'format-numbers',
    label: 'Numbered list',
    keys: shortcut('7', { shift: true }),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
    active: (editor) => editor.isActive('orderedList'),
  },
  {
    id: 'table-insert',
    label: 'Table',
    pagesOnly: true,
    run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    active: (editor) => editor.isActive('table'),
  },
  {
    id: 'table-add-row',
    label: 'Add row',
    pagesOnly: true,
    inTable: true,
    run: (editor) => editor.chain().focus().addRowAfter().run(),
    active: never,
  },
  {
    id: 'table-add-column',
    label: 'Add column',
    pagesOnly: true,
    inTable: true,
    run: (editor) => editor.chain().focus().addColumnAfter().run(),
    active: never,
  },
  {
    id: 'table-delete-row',
    label: 'Delete row',
    pagesOnly: true,
    inTable: true,
    run: (editor) => editor.chain().focus().deleteRow().run(),
    active: never,
  },
  {
    id: 'table-delete-column',
    label: 'Delete column',
    pagesOnly: true,
    inTable: true,
    run: (editor) => editor.chain().focus().deleteColumn().run(),
    active: never,
  },
  {
    id: 'table-delete',
    label: 'Delete table',
    pagesOnly: true,
    inTable: true,
    run: (editor) => editor.chain().focus().deleteTable().run(),
    active: never,
  },
  {
    id: 'format-indent',
    label: 'Indent',
    keys: 'Tab',
    run: (editor) => editor.chain().focus().sinkListItem(listItem(editor)).run(),
    active: never,
  },
  {
    id: 'format-outdent',
    label: 'Outdent',
    keys: '⇧Tab',
    run: (editor) => editor.chain().focus().liftListItem(listItem(editor)).run(),
    active: never,
  },
  { id: 'format-align-left', label: 'Align left', ...align('left') },
  { id: 'format-align-center', label: 'Align center', ...align('center') },
  { id: 'format-align-right', label: 'Align right', ...align('right') },
  { id: 'format-justify', label: 'Justify', ...align('justify') },
]

/** The formats a note or a page offers. */
export function formatsFor(page: boolean): Format[] {
  return FORMATS.filter((format) => page || !format.pagesOnly)
}

/** What makes sense where the caret is: the row and column commands only inside a table. */
export function formatsAt(editor: Editor, page: boolean): Format[] {
  const inTable = editor.isActive('table')
  return formatsFor(page).filter((format) => !format.inTable || inTable)
}

/** One format by id, for the palette and the Mac menu. */
export function formatById(id: string): Format | undefined {
  return FORMATS.find((format) => format.id === id)
}
