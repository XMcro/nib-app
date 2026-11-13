import { Node, mergeAttributes } from '@tiptap/core'
import { asBlock, linked, onLinkableChange, shownLink, shownTitle } from '../lib/links'
import { isInVault } from '../lib/text'

/** What an id from pasted or imported HTML may look like: Nib's own are UUIDs. */
const ID = /^[\w-]{1,64}$/

/**
 * A link to another note or page, typed as `[[` (see linkPicker). It holds the
 * id of what it points to and the title that had when it was linked. On
 * screen it shows the title as it is now, and looks gone once its note is in
 * the trash. Everywhere else, in exports and search, it is its title.
 *
 * One to a single line of its note (lib/links Part) also holds that line's
 * marker, `block`, and the words it had when linked, `part`.
 */
export const NoteLink = Node.create({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      // Drawn by hand below: as plain attributes they would become an HTML id and a tooltip.
      id: { default: '', rendered: false },
      title: { default: '', rendered: false },
      block: { default: null, rendered: false },
      part: { default: null, rendered: false },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-note-link]',
        getAttrs: (element) => {
          const span = element as HTMLElement
          const id = span.getAttribute('data-note-link') ?? ''
          if (!ID.test(id)) return false
          const block = asBlock(span.getAttribute('data-note-block'))
          // What it shows is its title, and after it its line's words: each is kept apart, to be told apart when it comes back.
          return { id, title: span.getAttribute('data-note-title') ?? span.textContent ?? '', block, part: block ? span.getAttribute('data-note-part') : null }
        },
      },
    ]
  },

  // Copied text and exported HTML carry the title as it is now.
  renderHTML({ node, HTMLAttributes }) {
    const { id, title, block, part } = node.attrs
    // Nothing more of a note in the vault than a link to all of it gives: not its line, nor the title and words the link still holds.
    const line = asBlock(block) && !isInVault(id) ? { 'data-note-block': block, 'data-note-title': shownTitle(id, title), 'data-note-part': part ?? '' } : {}
    return ['span', mergeAttributes({ 'data-note-link': id, class: 'nib-note-link', ...line }, HTMLAttributes), shownLink(node.attrs)]
  },

  renderText: ({ node }) => shownLink(node.attrs),

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.className = 'nib-note-link'
      dom.setAttribute('data-note-link', node.attrs.id)
      dom.setAttribute('role', 'link')
      const draw = () => {
        dom.textContent = shownLink(node.attrs)
        dom.toggleAttribute('data-missing', !linked(node.attrs.id))
      }
      draw()
      const stop = onLinkableChange(draw)
      return { dom, destroy: stop }
    }
  },
})
