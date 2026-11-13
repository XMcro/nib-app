import { Node, mergeAttributes } from '@tiptap/core'
import { aboutOf, asAttached, asFileName, type Attached } from '../lib/attachment'
import { asFileRef, type FileRef } from '../lib/fileRef'
import { attachmentCard, cardsOwn } from './attachmentCard'

/**
 * An attached file (lib/attachment): a block of its own, with nothing inside
 * it to write in. The document holds which file it is and what it was called;
 * the file itself is in the store beside the library (lib/files), and never an
 * address. It's written into HTML as its name, with which file only in
 * `data-file`, so one cut and pasted within Nib keeps its file, and an export
 * or a shared draft, which leave without it (lib/image `withoutAboutIn`), say
 * its name and no more.
 */

/** `data-file`: "<id> <size> <type>", and back; nothing that isn't all three is one. */
const fileOut = (file: FileRef) => `${file.id} ${file.size} ${file.type}`
const fileIn = (raw: string | null) => {
  const [id, size, type, ...rest] = (raw ?? '').split(' ')
  return rest.length ? null : asFileRef({ id, size: Number(size), type })
}

export const Attachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      file: {
        default: null,
        parseHTML: (element) => fileIn(element.getAttribute('data-file')),
        renderHTML: (attributes) => {
          const file = asFileRef(attributes.file)
          return file ? { 'data-file': fileOut(file) } : {}
        },
      },
      name: {
        default: '',
        parseHTML: (element) => asFileName(element.getAttribute('data-name')) ?? '',
        renderHTML: (attributes) => ({ 'data-name': asFileName(attributes.name) ?? '' }),
      },
    }
  },

  // Only Nib's own: a name, on a block that says it's one.
  parseHTML: () => [{ tag: 'div[data-attachment][data-name]' }],

  // As it's copied and exported: a line that reads by itself, its name and what it is.
  renderHTML({ node, HTMLAttributes }) {
    const attached = shown(node.attrs)
    return ['div', mergeAttributes(HTMLAttributes, { 'data-attachment': '', class: 'nib-attachment' }), ['strong', {}, attached.name], ` (${aboutOf(attached)})`]
  },

  /** In the editor, a card (editor/attachmentCard): made anew whenever the node changes, and its button and its player its own to handle. */
  addNodeView() {
    return ({ node }) => ({ dom: attachmentCard(shown(node.attrs)), stopEvent: cardsOwn })
  },
})

const shown = (attrs: unknown): Attached => asAttached(attrs) ?? { file: null, name: 'Attachment' }
