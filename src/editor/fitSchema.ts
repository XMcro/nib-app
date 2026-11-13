import type { Schema } from '@tiptap/pm/model'
import type { JSONContent } from '@tiptap/react'

/**
 * A document written by a newer Nib can hold a mark or a node this version has
 * never heard of. ProseMirror refuses a whole document over one unknown type,
 * and TipTap's answer is to load an empty one instead: the writer sees a blank
 * page, and anything typed into it is saved over the real text and synced
 * everywhere. So before a body reaches the editor, whatever this schema cannot
 * hold is taken off and the words are kept.
 *
 * Only the copy on screen is fitted, never what is stored: an untouched
 * document keeps its formatting for the devices that understand it. Editing it
 * here saves the fitted copy, which loses that formatting and nothing else.
 */
export function fitSchema(body: JSONContent, schema: Schema): JSONContent {
  // Exactly the check TipTap makes. A document it accepts is passed through as
  // it is, so nothing that loads today can load differently.
  if (accepts(schema, body)) return body
  try {
    const fitted: JSONContent = { type: 'doc', content: asBlocks(fitAll(children(body), schema, false), schema) }
    if (accepts(schema, fitted)) return fitted
  } catch {
    // Stored JSON is not a trusted input. Whatever went wrong, fall back to the words.
  }
  return plainParagraphs(body)
}

/** A node's children, or none if what is stored there is not a list. */
const children = (node: JSONContent): JSONContent[] => (Array.isArray(node.content) ? node.content : [])

function accepts(schema: Schema, body: JSONContent): boolean {
  try {
    schema.nodeFromJSON(body)
    return true
  } catch {
    return false
  }
}

function fitAll(nodes: JSONContent[], schema: Schema, inline: boolean): JSONContent[] {
  return nodes.flatMap((node) => fit(node, schema, inline))
}

function fit(node: JSONContent, schema: Schema, inline: boolean): JSONContent[] {
  const type = node.type ? schema.nodes[node.type] : undefined
  if (node.type === 'text' && !node.text) return []
  if (type) {
    const fitted: JSONContent = { ...node }
    const marks = node.marks?.filter((mark) => mark.type !== undefined && mark.type in schema.marks)
    if (marks?.length) fitted.marks = marks
    else delete fitted.marks
    if (node.content !== undefined) {
      const inner = fitAll(children(node), schema, type.inlineContent)
      fitted.content = type.inlineContent ? inner : asBlocks(inner, schema)
    }
    return [fitted]
  }
  // Unknown: keep what is inside it. Where a line is expected, its words still
  // need one to sit in; asBlocks gives them a paragraph.
  return fitAll(children(node), schema, inline)
}

const isInline = (node: JSONContent, schema: Schema) =>
  node.type === 'text' || Boolean(node.type && schema.nodes[node.type]?.isInline)

/** Runs of loose inline content, wrapped in a paragraph each, among the blocks. */
function asBlocks(nodes: JSONContent[], schema: Schema): JSONContent[] {
  const out: JSONContent[] = []
  let run: JSONContent[] = []
  const close = () => {
    if (run.length) out.push({ type: 'paragraph', content: run })
    run = []
  }
  for (const node of nodes) {
    if (isInline(node, schema)) run.push(node)
    else {
      close()
      out.push(node)
    }
  }
  close()
  return out
}

/** The last resort: every line of text, as plain paragraphs. Never blank if there were words. */
function plainParagraphs(body: JSONContent): JSONContent {
  const lines: string[] = []
  const walk = (node: JSONContent) => {
    if (typeof node.text === 'string' && node.text) lines.push(node.text)
    children(node).forEach(walk)
  }
  walk(body)
  return { type: 'doc', content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) }
}
