import type { Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { Suggestion, exitSuggestion, type SuggestionProps } from '@tiptap/suggestion'
import { markPart } from '../lib/blockLinks'
import { linkable, newBlock, partsOf, WORDS_KEPT, type Linkable, type Part } from '../lib/links'

export const linkPickerKey = new PluginKey('nibLinkPicker')

/** Enough to choose from without a list that runs off a phone's screen. */
const SHOWN = 8

/** The documents `query` could mean, nearest first: titles that start with it, then any that contain it. */
export function matches(query: string, self: string | null): Linkable[] {
  const needle = query.trim().toLowerCase()
  const others = linkable().filter((one) => one.id !== self && one.title)
  if (!needle) return others.slice(0, SHOWN)
  const starts = others.filter((one) => one.title.toLowerCase().startsWith(needle))
  const contains = others.filter((one) => !starts.includes(one) && one.title.toLowerCase().includes(needle))
  return [...starts, ...contains].slice(0, SHOWN)
}

/** A document to link to, or one line of it. */
export type Choice = { of: Linkable; part?: Part }

/**
 * The document named before a `#` in what's typed, and the words after it.
 * The last `#` with a document's name before it: a name can have one of its own.
 */
function named(query: string, self: string | null): { of: Linkable; words: string } | undefined {
  for (let hash = query.lastIndexOf('#'); hash > 0; hash = query.lastIndexOf('#', hash - 1)) {
    const of = query.slice(0, hash).trim() ? matches(query.slice(0, hash), self)[0] : undefined
    if (of) return { of, words: query.slice(hash + 1).trim().toLowerCase() }
  }
}

/**
 * What `query` could mean: documents; or, after a document's name and a `#`,
 * the headings and paragraphs of it that hold the words typed next. Documents
 * come first, so a note called "C# notes" is still found by its name. A
 * read-only one offers only lines that something links to already: no marker
 * can be written in it for another (lib/blockLinks).
 */
export function choices(query: string, self: string | null): Choice[] {
  const documents = matches(query, self)
  const lines = documents.length ? undefined : named(query, self)
  if (!lines) return documents.map((of) => ({ of }))
  const { of, words } = lines
  return partsOf(of.id)
    .filter((part) => (part.block || !of.readOnly) && part.text.toLowerCase().includes(words))
    .slice(0, SHOWN)
    .map((part) => ({ of, part }))
}

/**
 * Typing `[[` lists the notes and pages to link to, narrowing as you type;
 * choosing one puts a link to it in place of what was typed. A `#` after a
 * name lists that document's headings and paragraphs, for a link to one of
 * them. Registered on the live editor only (Editor.tsx), never in the schema
 * the importer and exports share. `self` is the document being edited, which
 * is never offered.
 */
export function linkPicker(editor: Editor, self: () => string | null) {
  return Suggestion<Choice, Choice>({
    editor,
    pluginKey: linkPickerKey,
    char: '[[',
    allowSpaces: true,
    // Anywhere in a line, as `[[` never starts anything else.
    allowedPrefixes: null,
    items: ({ query }) => choices(query, self()),
    command: ({ editor, range, props: { of, part } }) => {
      // The line's marker, a new one if nothing links to it yet: written to its document after the link is, which holds it either way.
      const block = part ? (part.block ?? newBlock()) : null
      if (part && block && !part.block) void markPart(of.id, part, block).catch((error: unknown) => console.error('Nib: could not mark the line a link goes to', error))
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: 'noteLink', attrs: { id: of.id, title: of.title, ...(part && { block, part: part.text.slice(0, WORDS_KEPT) }) } },
          { type: 'text', text: ' ' },
        ])
        .run()
    },
    render: () => {
      let props: SuggestionProps<Choice, Choice> | null = null
      let selected = 0
      let unmount: (() => void) | undefined
      const list = document.createElement('div')
      list.setAttribute('role', 'listbox')
      list.setAttribute('aria-label', 'Link to a note')
      list.className = 'nib-link-picker nib-float origin-top-left z-50 w-64 overflow-hidden rounded-md border border-line bg-shell py-1 shadow-lg'
      // Choosing must not take focus from the text, or on a phone the keyboard drops.
      list.addEventListener('mousedown', (event) => event.preventDefault())

      const choose = (index: number) => {
        const item = props?.items[index]
        if (item) props!.command(item)
      }

      const note = (words: string) => Object.assign(document.createElement('p'), { className: 'px-3 py-1.5 text-[12px] text-muted', textContent: words })

      const draw = () => {
        const items = props?.items ?? []
        const of = items[0]?.part ? items[0].of : items.length ? undefined : named(props?.query ?? '', self())?.of
        selected = Math.min(selected, Math.max(0, items.length - 1))
        const options = items.map((item, index) => {
          const option = document.createElement('button')
          option.type = 'button'
          option.setAttribute('role', 'option')
          option.setAttribute('aria-selected', String(index === selected))
          option.className = `flex w-full cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-left text-[13px] text-ink pointer-coarse:py-2.5 ${
            index === selected ? 'bg-item-hover' : ''
          }`
          const title = document.createElement('span')
          title.className = 'truncate'
          title.textContent = item.part ? item.part.text : item.of.title
          const kind = document.createElement('span')
          kind.className = 'flex-none text-[11px] text-faint'
          kind.textContent = item.part ? (item.part.heading ? 'Heading' : 'Paragraph') : item.of.kind === 'page' ? 'Page' : 'Note'
          option.append(title, kind)
          option.addEventListener('click', () => choose(index))
          return option
        })
        list.replaceChildren(
          // Whose lines these are: the name typed may be only the start of it.
          ...(of ? [note(`In ${of.title}`)] : []),
          ...options,
          ...(options.length ? [] : [note(of ? (of.readOnly ? 'It’s read-only: its lines can’t be linked to' : 'No heading or paragraph with those words') : 'No note or page by that name')]),
          ...(options.length && !of ? [note('# after a name, for one line of it')] : []),
        )
      }

      return {
        onStart: (next) => {
          props = next
          selected = 0
          draw()
          unmount = next.mount(list)
        },
        onUpdate: (next) => {
          props = next
          selected = 0
          draw()
        },
        onKeyDown: ({ event, view }) => {
          const count = props?.items.length ?? 0
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!count) return true
            selected = (selected + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
            draw()
            return true
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            if (!count) return false
            choose(selected)
            return true
          }
          if (event.key === 'Escape') {
            exitSuggestion(view, linkPickerKey)
            return true
          }
          return false
        },
        onExit: () => {
          unmount?.()
          unmount = undefined
          props = null
        },
      }
    },
  })
}
