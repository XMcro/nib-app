import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * Where a reader's quote sits in the document now, ignoring differences in
 * whitespace: a selection on the reader page reads paragraph breaks as line
 * breaks, the editor as block boundaries. Null once the passage has been
 * rewritten, which makes the note one "on an earlier draft".
 */
export function findQuote(doc: ProseMirrorNode, quote: string): { from: number; to: number } | null {
  const needle = quote.replace(/\s+/g, ' ').trim()
  if (!needle) return null
  // The document's text with runs of whitespace as one space, and where each
  // character came from.
  let text = ''
  const at: number[] = []
  const space = (pos: number) => {
    if (text && !text.endsWith(' ')) {
      text += ' '
      at.push(pos)
    }
  }
  doc.descendants((node, pos) => {
    if (node.isText) {
      for (let i = 0; i < node.text!.length; i++) {
        if (/\s/.test(node.text![i])) space(pos + i)
        else {
          text += node.text![i]
          at.push(pos + i)
        }
      }
    } else if (node.isBlock) space(pos)
  })
  const index = text.indexOf(needle)
  return index < 0 ? null : { from: at[index], to: at[index + needle.length - 1] + 1 }
}
