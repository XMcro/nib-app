import { Extension, getSchema, mergeAttributes, type Attributes } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import type { JSONContent } from '@tiptap/react'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Strike from '@tiptap/extension-strike'
import Code from '@tiptap/extension-code'
import Blockquote from '@tiptap/extension-blockquote'
import CodeBlock from '@tiptap/extension-code-block'
import { languageName } from '../lib/codeReader'
import { codeBlockView, codeColours } from './codeColours'
import Link from '@tiptap/extension-link'
import Heading from '@tiptap/extension-heading'
import HardBreak from '@tiptap/extension-hard-break'
import {
  BulletList,
  ListItem,
  ListKeymap,
  OrderedList,
  TaskItem,
  TaskList,
} from '@tiptap/extension-list'
import { TableCell, TableHeader, TableKit } from '@tiptap/extension-table'
import { UndoRedo, Placeholder } from '@tiptap/extensions'
import { Attachment } from './Attachment'
import { Callout } from './Callout'
import { Footnote } from './Footnote'
import { Highlight } from './Highlight'
import { MathBlock, MathInline } from './Math'
import { NibImage } from './NibImage'
import { NoteLink } from './NoteLink'
import { NoteToSelf } from './NoteToSelf'
import { GfmTaskList } from './GfmTaskList'
import { Underline } from './Underline'
import { fitSchema } from './fitSchema'
import { asAlignment } from '../lib/alignment'
import { asSpan, filterBodyImages } from '../lib/image'
import { asBlock } from '../lib/links'
import { Screenplay } from './Screenplay'

/**
 * Link, with the two things imported markup could otherwise decide for itself.
 *
 * `target`, `rel` and `class` ship only as defaults, so TipTap reads them off
 * an imported `<a>` and `mergeAttributes` puts those node attributes last —
 * beating the safe values. A `class` of Tailwind utilities that already exist
 * in our own bundle is enough to stretch one anchor across the whole viewport
 * and swallow every click, and `rel="opener"` hands back `window.opener`.
 * Pinning them in `parseHTML` means an import cannot set them at all, and in
 * `renderHTML`, that a stored link can't either: synced or restored, a link
 * never goes through parseHTML.
 *
 * Autolinking is narrowed to things that are actually addresses: `.md`, `.sh`
 * and `.py` are live TLDs, so the default rule quietly turned filenames like
 * `README.md` into links that then rode along into exported Markdown.
 */
const SafeLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      target: { default: '_blank', parseHTML: () => '_blank', renderHTML: () => ({ target: '_blank' }) },
      rel: {
        default: 'noopener noreferrer nofollow',
        parseHTML: () => 'noopener noreferrer nofollow',
        renderHTML: () => ({ rel: 'noopener noreferrer nofollow' }),
      },
      class: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
    }
  },
}).configure({
  openOnClick: false,
  shouldAutoLink: (url) =>
    /^(https?|mailto):/i.test(url) || /^www\./i.test(url) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url),
})

/**
 * A code block's language becomes the class on its code, so it is pinned to a
 * language's name, as SafeLink pins `class`: one with spaces in it (pasted
 * from VS Code, synced, imported) was any classes at all, Tailwind's
 * utilities among them.
 */
const SafeCodeBlock = CodeBlock.extend({
  addAttributes() {
    const parent = this.parent?.() as Attributes | undefined
    return {
      ...parent,
      language: { ...parent?.language, parseHTML: (element: HTMLElement) => languageName(parent?.language?.parseHTML?.(element)) },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    const language = languageName(node.attrs.language)
    return [
      'pre',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      ['code', { class: language ? this.options.languageClassPrefix + language : null }, 0],
    ]
  },
  addNodeView: () => codeBlockView,
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), codeColours()]
  },
})

/**
 * A checklist item whose box ticks that item and does nothing else.
 *
 * TipTap's own box focuses the editor before ticking, which puts the caret
 * back wherever it last was. On an iPhone or iPad that brought the keyboard
 * up and scrolled the text away to that line, from the box that was tapped.
 * Here the tick goes in as a change to the one item: the caret stays where it
 * is, and a writer who wasn't typing still isn't.
 */
const ChecklistItem = TaskItem.extend({
  addNodeView() {
    const nodeView = this.parent!()!
    return (props) => {
      const view = nodeView(props)
      const label = (view.dom as HTMLElement).querySelector<HTMLLabelElement>(':scope > label')!
      const box = label.querySelector('input')!
      // The label is a line tall and the box sits in its middle, so a finger
      // often lands on the label. TipTap only keeps the box from taking focus.
      label.addEventListener('mousedown', (event) => event.preventDefault())
      // On the label, in capture, so TipTap's own listener on the box never runs.
      label.addEventListener(
        'change',
        (event) => {
          event.stopPropagation()
          const { editor, getPos } = props
          const at = getPos()
          const item = typeof at === 'number' ? editor.state.doc.nodeAt(at) : null
          if (!editor.isEditable || !item) {
            box.checked = !box.checked
            return
          }
          editor.view.dispatch(editor.state.tr.setNodeMarkup(at!, undefined, { ...item.attrs, checked: box.checked }))
        },
        { capture: true },
      )
      return view
    }
  },
})

/**
 * `dir="auto"` on paragraphs and headings, so each takes its direction from
 * its own words, and Arabic or Hebrew reads from the right beside English from
 * the left. Only in what's drawn: an extension's HTMLAttributes aren't node
 * attributes, so a body is stored as it always was, and the apps already out
 * there read it. Lists and quotations follow their first line (index.css): a
 * dir="auto" on them as well wouldn't see text inside one of its own.
 */
/** A cell that reads its spans as the body filter does (asSpan): a pasted table sets them too, and reaches no filter. */
const withSpans = (cell: typeof TableCell) =>
  cell.extend({
    addAttributes() {
      const span = (name: string) => ({ default: 1, parseHTML: (element: HTMLElement) => asSpan(Number(element.getAttribute(name))) })
      return { ...this.parent?.(), colspan: span('colspan'), rowspan: span('rowspan') }
    },
  })

const OWN_DIRECTION = { HTMLAttributes: { dir: 'auto' } }

/** A paragraph's or heading's alignment (lib/alignment), kept off a body that has none. Stored JSON isn't trusted, and this goes into a style. */
const BlockAlignment = Extension.create({
  name: 'blockAlignment',
  addGlobalAttributes: () => [
    {
      types: ['paragraph', 'heading'],
      attributes: {
        textAlign: {
          default: null,
          parseHTML: (element) => asAlignment(element.style.textAlign),
          renderHTML: (attributes) => {
            const textAlign = asAlignment(attributes.textAlign)
            return textAlign ? { style: `text-align: ${textAlign}` } : {}
          },
        },
      },
    },
  ],
})

/**
 * The marker a paragraph or heading carries once a link goes to it (lib/links
 * Part). Stored and pasted markers aren't trusted, and this goes into an attribute.
 *
 * One line to a marker. Return in the middle of a line gives both halves the
 * line's attributes (`keepOnSplit` is asked only at a line's end), and a copy
 * of a line pasted in has its marker too: the first with words keeps it,
 * where the link went before (Return at a line's start leaves an empty half
 * above its words), and the other loses it in the same step, to be undone with it.
 */
const BlockMarker = Extension.create({
  name: 'blockMarker',
  addGlobalAttributes: () => [
    {
      types: ['paragraph', 'heading'],
      attributes: {
        blockId: {
          default: null,
          keepOnSplit: false,
          parseHTML: (element) => asBlock(element.getAttribute('data-block')),
          renderHTML: (attributes) => {
            const block = asBlock(attributes.blockId)
            return block ? { 'data-block': block } : {}
          },
        },
      },
    },
  ],
  addProseMirrorPlugins: () => [
    new Plugin({
      key: new PluginKey('nibBlockMarker'),
      appendTransaction(transactions, _before, state) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null
        const holder = new Map<string, { pos: number; empty: boolean }>()
        let tr: Transaction | null = null
        state.doc.descendants((node, pos) => {
          const block: unknown = node.attrs.blockId
          if (typeof block === 'string') {
            const had = holder.get(block)
            const taken = had?.empty && node.content.size > 0
            if (had) (tr ??= state.tr).setNodeAttribute(taken ? had.pos : pos, 'blockId', null)
            if (!had || taken) holder.set(block, { pos, empty: !node.content.size })
          }
          return !node.isTextblock
        })
        return tr
      },
    }),
  ],
})

/**
 * The single definition of Nib's document schema. The editor and the Markdown
 * importer both build from this, so an imported file can never contain a node
 * the editor cannot render.
 *
 * Extensions are listed one by one rather than via StarterKit: it is smaller
 * and ships nothing that hasn't been asked for. Each carries its own markdown
 * input rule, so `**x**`, `1. `, `- [ ] `, `> ` and `` `x` `` work while typing.
 */
export function nibExtensions(page: boolean) {
  return [
    Document,
    Paragraph.configure(OWN_DIRECTION),
    BlockAlignment,
    BlockMarker,
    Text,
    Bold,
    Italic,
    Strike,
    Underline,
    Highlight,
    NoteToSelf,
    Code,
    Blockquote,
    Callout,
    SafeCodeBlock,
    BulletList,
    OrderedList,
    ListItem,
    TaskList,
    ChecklistItem.configure({ nested: true }),
    ListKeymap,
    GfmTaskList,
    SafeLink,
    Footnote,
    // Formulas, written as LaTeX (Math.ts).
    MathInline,
    MathBlock,
    // Links between notes, in notes and pages alike (linkPicker adds the `[[`).
    NoteLink,
    // Not gated on `page`: a Markdown note carrying an image would otherwise
    // have it silently dropped on import.
    NibImage,
    Attachment,
    HardBreak,
    UndoRedo,
    // Headings are what makes a Page a Page. Tables are for pages too: a
    // note is a thought caught in a line or two. Columns are as wide as their
    // text, with no drag handles, which a finger could not find anyway.
    ...(page ? [Heading.configure({ levels: [1, 2, 3, 4, 5, 6], ...OWN_DIRECTION }), TableKit.configure({ table: { resizable: false }, tableCell: false, tableHeader: false }), withSpans(TableCell), withSpans(TableHeader)] : []),
    Placeholder.configure({ placeholder: 'Start writing…' }),
  ]
}

/** The text's own look: a page's, a screenplay's, or a note's, as the editor shows it and the document beside it does. */
export const textClass = (page: boolean, screenplay = false) =>
  screenplay
    ? 'nib-editor nib-editor-page nib-screenplay text-[16px] leading-[1.5]'
    : page
      ? 'nib-editor nib-editor-page text-[17px] leading-[1.65]'
      : 'nib-editor font-mono text-[15px] leading-[1.7] pointer-coarse:text-[16px]'

/** In a screenplay, only the shortcuts for bold, italic and the like: #, >, - and = start Fountain's lines, not headings, quotes and lists. */
const SCREENPLAY_RULES = ['bold', 'italic', 'strike', 'underline', 'highlight', 'code']

/** What every editor on a document is made from. A screenplay's (lib/fountain) reads its lines as Fountain (./Screenplay). */
export const nibEditor = (page: boolean, screenplay = false) => ({
  extensions: screenplay ? [...nibExtensions(page), Screenplay] : nibExtensions(page),
  ...(screenplay && { enableInputRules: SCREENPLAY_RULES }),
  // Its rules are in index.css: a <style> added now would be refused (lib/csp).
  injectCSS: false,
})

/** A stored body as an editor of this kind can load it: its pictures checked, and fitted to what the editor holds (./fitSchema). */
export const fitted = (body: JSONContent, page: boolean) => fitSchema(filterBodyImages(body), getSchema(nibExtensions(page)))
