import { Node, mergeAttributes } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { originalUrl } from '../lib/originals'
import { allowedDrawing, allowedImageSrc, asFull, asImageSize, withoutAbout, type Full } from '../lib/image'

declare module '@tiptap/core' {
  interface Storage {
    image: { locked: boolean }
  }
}

/**
 * Inline rather than a block, for two concrete reasons: `marked` emits
 * `<p><img></p>`, which an inline node reproduces with no stray empty paragraph
 * and so needs no import rewrite; and an inline atom always has a caret
 * position either side of it inside its paragraph, so no gapcursor is needed to
 * type past one.
 *
 * Only `src`, `alt` and `size` are declared. That is the security boundary:
 * an attribute TipTap never declares is never read, so `class`, `style` or
 * `onerror` on an imported `<img>` cannot reach the DOM. A size is one of
 * four words (lib/image IMAGE_SIZES), checked coming in and going out, shown
 * as `data-size` for the stylesheet to read: never a width of the writer's,
 * or a file's, own. `parseHTML` refuses
 * any src that is not one of our own data URIs, so an imported file cannot make
 * the editor fetch a remote address.
 *
 * `renderHTML` checks again. Stored JSON never goes through `parseHTML`, and
 * IndexedDB is not a trusted renderer input: a hostile `src` on the node would
 * otherwise become a network fetch. An empty `img src` would request this
 * document, so a rejected src becomes a placeholder with no src at all.
 *
 * A sketch is this same node with a `drawing` beside the picture. Nib no
 * longer draws them, but one made in an earlier build keeps its drawing, so
 * export, backup, sync, the budget and the src check apply to it unchanged. The drawing is never read from HTML and
 * never written into it: a sketch shows as `data-sketch`, which the dark theme
 * inverts, and as the width it was drawn at.
 *
 * `full` names the picture's original in the file store (lib/originals, Nib
 * Plus): an id, a kind and a size, checked coming in and going out, and
 * written as `data-full` only so a picture cut and pasted within Nib keeps
 * it. No address is ever taken from it: the store makes one from the id, for
 * a file that is on this device, and the picture is then shown from that
 * (the node's own view, below); anywhere else it shows as the note has it.
 */

/** `data-full`: "<id> <type> <size>", and back; nothing that isn't all three is one. */
const fullOut = (full: Full) => `${full.id} ${full.type} ${full.size}`
const fullIn = (raw: string | null) => {
  const [id, type, size] = (raw ?? '').split(' ')
  return asFull({ id, type, size: Number(size) })
}

export const NibImage = Node.create({
  name: 'image',

  /** Whether the document being written is locked, as its editor says (Editor): a picture going into one keeps no original (lib/originals). */
  addStorage() {
    return { locked: false }
  },
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: '',
        // Where it was taken, and when, stay behind: HTML pasted or imported doesn't pass through toDataUrl.
        parseHTML: (element) => withoutAbout(element.getAttribute('src') ?? ''),
        renderHTML: (attributes) =>
          allowedImageSrc(attributes.src) ? { src: attributes.src } : {},
      },
      alt: { default: '' },
      size: {
        default: null,
        parseHTML: (element) => asImageSize(element.getAttribute('data-size')),
        renderHTML: (attributes) => (asImageSize(attributes.size) ? { 'data-size': attributes.size as string } : {}),
      },
      drawing: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
      full: {
        default: null,
        parseHTML: (element) => fullIn(element.getAttribute('data-full')),
        renderHTML: (attributes) => {
          const full = asFull(attributes.full)
          return full ? { 'data-full': fullOut(full) } : {}
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (element) => {
          const src = (element as HTMLElement).getAttribute('src') ?? ''
          // `false` rejects the match, so the node is simply not created.
          if (!allowedImageSrc(src) || !withoutAbout(src)) return false
          return { src, alt: (element as HTMLElement).getAttribute('alt') ?? '' }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    if (!allowedImageSrc(node.attrs.src)) return ['span']
    if (!allowedDrawing(node.attrs.drawing)) return ['img', mergeAttributes(HTMLAttributes)]
    const width = sketchWidth(node.attrs.src)
    return ['img', mergeAttributes(HTMLAttributes, { 'data-sketch': '', ...(width ? { width } : {}) })]
  },

  /**
   * The picture as renderHTML makes it, then shown from its original once
   * that's on this device, fetched if it has to be (lib/originals). Made anew
   * whenever the node changes, so there's nothing to keep in step; and what's
   * done to it here is no change to the document, as a picture has nothing
   * inside it for the editor to read back. Not in a locked document, which
   * keeps none: one just locked still names its originals till it's next
   * opened, and asking would fetch back the file the lock deleted.
   */
  addNodeView() {
    return ({ node, editor }) => {
      const { dom } = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node))
      const full = dom instanceof HTMLImageElement && !editor.storage.image.locked ? asFull(node.attrs.full) : null
      if (full) void originalUrl(full).then((url) => void (url && ((dom as HTMLImageElement).src = url)))
      return { dom }
    }
  },
})

/**
 * A sketch's picture is drawn at twice its size for sharp ink, so it is shown
 * at half its pixel width: the size it was drawn at, or the column if smaller.
 * The width comes from the PNG's own header (bytes 16 to 19), so no attribute
 * has to be stored or trusted for it.
 */
function sketchWidth(src: string): number | null {
  const prefix = 'data:image/png;base64,'
  if (!src.startsWith(prefix)) return null
  const header = atob(src.slice(prefix.length, prefix.length + 32))
  const pixels = [16, 17, 18, 19].reduce((width, at) => width * 256 + header.charCodeAt(at), 0)
  return pixels > 0 ? Math.round(pixels / 2) : null
}
