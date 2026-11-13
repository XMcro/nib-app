import { findChildrenInRange, getChangedRanges, type NodeViewRendererProps } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { JSONContent } from '@tiptap/react'
import { COMMON_LANGUAGES, MORE_LANGUAGES } from '../lib/codeLanguages'
import { codeReader, languageName, MOST_COLOURED } from '../lib/codeReader'
import type { Stretch } from './codeWorker'

/** What each block's text has been read as, by language and text. Nothing to colour, for a language with no grammar or a read stopped for taking too long. */
const read = new Map<string, Stretch[]>()
const MOST_REMEMBERED = 200

/** The open editors, and what an export is waiting for: the worker reads whichever is next unread, so a block typed on quickly is only read as it now stands. */
const views = new Set<EditorView>()
const waiting = new Map<string, (() => void)[]>()
/** What the export under way needs kept. */
let held = new Set<string>()

const isCode = (node: ProseMirrorNode) => node.type.name === 'codeBlock'

const keyFor = (language: unknown, text: string) => {
  const name = languageName(language)
  return name && text.length <= MOST_COLOURED ? `${name}\n${text}` : null
}
const keyOf = (node: ProseMirrorNode) => keyFor(node.attrs.language, node.textContent)

function eachOpenKey(visit: (key: string) => boolean | void) {
  for (const view of views) {
    let going = true
    view.state.doc.descendants((node) => {
      const key = going && isCode(node) ? keyOf(node) : null
      if (key !== null && visit(key)) going = false
      return going && !node.isTextblock
    })
    if (!going) return
  }
}

function unread() {
  for (const key of waiting.keys()) if (!read.has(key)) return key
  let found = null as string | null
  eachOpenKey((key) => {
    if (read.has(key)) return false
    found = key
    return true
  })
  return found
}

/** The oldest first, but never what's in an open document or the export under way: those would only be read again, and again. */
function forgetOld() {
  if (read.size < MOST_REMEMBERED) return
  const inUse = new Set(held)
  eachOpenKey((key) => void inUse.add(key))
  for (const key of read.keys()) {
    if (read.size < MOST_REMEMBERED) break
    if (!inUse.has(key)) read.delete(key)
  }
}

const readNext = codeReader<{ key: string; language: string; text: string }>(
  () => {
    const key = unread()
    if (key === null) return null
    const split = key.indexOf('\n')
    return { key, language: key.slice(0, split), text: key.slice(split + 1) }
  },
  ({ key }, found) => {
    read.set(key, found ?? [])
    forgetOld()
    for (const settle of waiting.get(key) ?? []) settle()
    waiting.delete(key)
    for (const view of views) view.dispatch(view.state.tr.setMeta(codeColoursKey, key))
  },
)

/** Before an export of these documents: has each block of code in them read, for `coloursOf`. */
export async function coloursFor(bodies: JSONContent[]): Promise<void> {
  const keys = new Set<string>()
  const walk = (node: JSONContent) => {
    const key = node.type === 'codeBlock' ? keyFor(node.attrs?.language, (node.content ?? []).map((part) => part.text ?? '').join('')) : null
    if (key !== null) keys.add(key)
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  bodies.forEach(walk)
  held = keys
  const pending = [...keys].filter((key) => !read.has(key)).map((key) => new Promise<void>((settle) => waiting.set(key, [...(waiting.get(key) ?? []), settle])))
  readNext()
  await Promise.all(pending)
}

/** The colours of a block of code an export has waited for (`coloursFor`): none if it hasn't. */
export function coloursOf(language: unknown, text: string): Stretch[] {
  const key = keyFor(language, text)
  return (key !== null && read.get(key)) || []
}

/** A block's colours as far as known: none if it has none to have, and undefined if it hasn't been read yet. */
const known = (node: ProseMirrorNode) => {
  const key = keyOf(node)
  return key === null ? [] : read.get(key)
}

const drawn = (stretches: Stretch[], pos: number) => stretches.map(({ from, to, colour }) => Decoration.inline(pos + 1 + from, pos + 1 + to, { class: `nib-code-${colour}` }))

function coloured(doc: ProseMirrorNode) {
  const found: Decoration[] = []
  doc.descendants((node, pos) => {
    if (isCode(node)) found.push(...drawn(known(node) ?? [], pos))
    return !node.isTextblock
  })
  return DecorationSet.create(doc, found)
}

const repainted = (set: DecorationSet, doc: ProseMirrorNode, node: ProseMirrorNode, pos: number, stretches: Stretch[]) => set.remove(set.find(pos, pos + node.nodeSize)).add(doc, drawn(stretches, pos))

export const codeColoursKey = new PluginKey<DecorationSet>('codeColours')

/** The colours over a code block's text, drawn and never stored: a document is the same with them or without. */
export function codeColours() {
  return new Plugin<DecorationSet>({
    key: codeColoursKey,
    state: {
      init: (_, { doc }) => coloured(doc),
      apply(tr, set) {
        const justRead = tr.getMeta(codeColoursKey) as string | undefined
        if (justRead !== undefined) {
          let next = set
          tr.doc.descendants((node, pos) => {
            if (isCode(node) && keyOf(node) === justRead) next = repainted(next, tr.doc, node, pos, read.get(justRead) ?? [])
            return !node.isTextblock
          })
          return next
        }
        if (!tr.docChanged) return set
        // Only the blocks this changed: another block's colours are where they were.
        let next = set.map(tr.mapping, tr.doc)
        for (const { newRange } of getChangedRanges(tr)) {
          for (const { node, pos } of findChildrenInRange(tr.doc, newRange, (block) => block.isTextblock)) {
            // Any kind of line, as one that has just stopped being code carries its colours with it.
            const stretches = isCode(node) ? known(node) : []
            // Not read yet: what it had, moved along with the text, till it is, so it doesn't blink at each key.
            if (stretches) next = repainted(next, tr.doc, node, pos, stretches)
          }
        }
        return next
      },
    },
    props: { decorations: (state) => codeColoursKey.getState(state) },
    view(view) {
      views.add(view)
      readNext()
      return {
        update: (_, previous) => void (view.state.doc !== previous.doc && readNext()),
        destroy: () => void views.delete(view),
      }
    },
  })
}

let options: HTMLTemplateElement | null = null

/** One list for every block: a document can have many, and there are over three hundred lines in it. */
function languageOptions() {
  if (!options) {
    options = document.createElement('template')
    const group = (label: string, entries: [string, string][]) => {
      const list = document.createElement('optgroup')
      list.label = label
      list.append(...entries.map(([value, name]) => new Option(name, value)))
      return list
    }
    options.content.append(new Option('Plain text', ''), group('Common', Object.entries(COMMON_LANGUAGES)), group('More', MORE_LANGUAGES.map((name) => [name, name])))
  }
  return options.content.cloneNode(true)
}

/** A code block with the name of its language in the corner, over a native menu, so a phone and a Mac each show their own. */
export function codeBlockView({ node: first, getPos, editor }: NodeViewRendererProps) {
  let node = first
  const dom = document.createElement('pre')

  const language = dom.appendChild(document.createElement('div'))
  language.className = 'nib-code-language'
  language.contentEditable = 'false'
  language.spellcheck = false
  const name = language.appendChild(document.createElement('span'))
  const menu = language.appendChild(document.createElement('select'))
  menu.setAttribute('aria-label', 'Code language')
  menu.append(languageOptions())

  const contentDOM = dom.appendChild(document.createElement('code'))

  const paint = () => {
    const chosen = languageName(node.attrs.language) ?? ''
    menu.value = chosen
    // One the menu doesn't name, as a fence wrote it: `js`, say, or a language Nib has no grammar for.
    if (menu.value !== chosen) {
      menu.add(new Option(chosen, chosen), 1)
      menu.value = chosen
    }
    name.textContent = menu.selectedOptions[0].text
    language.toggleAttribute('data-plain', !chosen)
    // A red line under `def`: code isn't words. A block with no language is usually text set in mono, and still is.
    contentDOM.spellcheck = !chosen
  }
  paint()

  menu.addEventListener('change', () => {
    const at = getPos()
    if (!editor.isEditable || typeof at !== 'number') return paint()
    editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, language: menu.value || null }))
  })

  return {
    dom,
    contentDOM,
    update(updated: ProseMirrorNode) {
      if (updated.type !== node.type) return false
      node = updated
      paint()
      return true
    },
    stopEvent: (event: Event) => language.contains(event.target as globalThis.Node),
  }
}
