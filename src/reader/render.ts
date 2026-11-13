import { attachedName, NOT_INCLUDED } from '../lib/attachment'
import { asAlignment } from '../lib/alignment'
import { asCalloutKind } from '../lib/callouts'
import { allowedImageSrc, asImageSize } from '../lib/image'
import { colourCode } from './code'
import { drawFormula } from './math'

/**
 * A shared draft, drawn for its reader. The document arrives from the network,
 * so it's treated as hostile however it was made: only Nib's own nodes and
 * marks are drawn, each with `createElement` and `textContent`, and nothing
 * from the payload is ever parsed as markup. Anything unknown is unwrapped to
 * its text, or dropped. The page's CSP stands behind this, not in for it.
 */

type Node = { type?: unknown; attrs?: Record<string, unknown>; content?: unknown; text?: unknown; marks?: unknown }

// Maps, not objects: a node of type `constructor` or `__proto__` must not
// find Object's own properties, which were taken for tags and threw.
const BLOCKS = new Map([
  ['paragraph', 'p'],
  ['blockquote', 'blockquote'],
  ['callout', 'div'],
  ['bulletList', 'ul'],
  ['orderedList', 'ol'],
  ['listItem', 'li'],
  ['taskList', 'ul'],
  ['table', 'table'],
  ['tableRow', 'tr'],
  ['tableHeader', 'th'],
  ['tableCell', 'td'],
])
const MARKS = new Map([
  ['bold', 'strong'],
  ['italic', 'em'],
  ['strike', 's'],
  ['underline', 'u'],
  ['highlight', 'mark'],
  ['code', 'code'],
])
// A hostile document could nest far deeper than any written one, to exhaust the stack.
const MAX_DEPTH = 64

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && !Array.isArray(value)
const children = (node: Node): Node[] => (Array.isArray(node.content) ? node.content.filter(isNode) : [])

/** Only links a reader can safely follow, and never with the page as their opener or referrer. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null
  try {
    const url = new URL(href)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

/** Draws `body` into `into`, with its footnotes numbered and listed at the end. */
export function renderDocument(body: unknown, into: HTMLElement): void {
  const footnotes: string[] = []

  /**
   * In page, by script: following `#fn-1` the ordinary way put it in the
   * address in place of the link's key, so a reload, or the address copied,
   * then said the link was incomplete.
   */
  function goesTo(link: HTMLAnchorElement, id: string) {
    link.href = `#${id}`
    link.addEventListener('click', (event) => {
      event.preventDefault()
      into.ownerDocument.getElementById(id)?.scrollIntoView({ block: 'center' })
    })
  }

  function inline(node: Node, parent: HTMLElement, depth: number) {
    if (depth > MAX_DEPTH) return
    if (node.type === 'text' && typeof node.text === 'string') {
      let target: HTMLElement = parent
      const marks = Array.isArray(node.marks) ? node.marks.filter(isNode) : []
      // Each kind once: 15,000 bold marks nested 15,000 elements deep, past
      // any depth limit, and the reader's tab crashed laying them out.
      const drawn = new Set<unknown>()
      for (const mark of marks) {
        if (drawn.has(mark.type)) continue
        drawn.add(mark.type)
        const tag = typeof mark.type === 'string' ? MARKS.get(mark.type) : undefined
        let element: HTMLElement | null = tag ? document.createElement(tag) : null
        if (mark.type === 'link') {
          const href = safeHref(mark.attrs?.href)
          if (href) {
            const link = document.createElement('a')
            link.href = href
            link.rel = 'noopener noreferrer nofollow'
            link.target = '_blank'
            element = link
          }
        }
        if (element) {
          target.append(element)
          target = element
        }
      }
      target.append(document.createTextNode(node.text))
    } else if (node.type === 'hardBreak') {
      parent.append(document.createElement('br'))
    } else if (node.type === 'image') {
      const src = node.attrs?.src
      if (!allowedImageSrc(src)) return
      const image = document.createElement('img')
      image.src = src
      image.alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
      // Drawn black on clear, so dark mode inverts it as the app does.
      if (node.attrs?.sketch === true) image.className = 'sketch'
      // As wide as the writer set it: one of four words for the stylesheet, never a width from the payload.
      const size = asImageSize(node.attrs?.size)
      if (size) image.dataset.size = size
      parent.append(image)
    } else if (node.type === 'footnote') {
      footnotes.push(typeof node.attrs?.text === 'string' ? node.attrs.text : '')
      const n = footnotes.length
      const marker = document.createElement('sup')
      const link = document.createElement('a')
      goesTo(link, `fn-${n}`)
      link.id = `fnref-${n}`
      link.textContent = String(n)
      link.setAttribute('aria-label', `Footnote ${n}`)
      marker.append(link)
      parent.append(marker)
    } else if (node.type === 'mathInline') {
      const formula = document.createElement('span')
      formula.className = 'math'
      drawFormula(texOf(node), formula, false)
      parent.append(formula)
    } else {
      // Unknown inline content: its text, if it has any.
      for (const child of children(node)) inline(child, parent, depth + 1)
    }
  }

  /** A formula's LaTeX: the node's own text. */
  const texOf = (node: Node) => children(node).map((child) => (typeof child.text === 'string' ? child.text : '')).join('')

  function aligned(line: HTMLElement, node: Node) {
    const textAlign = asAlignment(node.attrs?.textAlign)
    if (textAlign) line.style.textAlign = textAlign
  }

  function block(node: Node, parent: HTMLElement, depth: number) {
    if (depth > MAX_DEPTH) return
    const type = typeof node.type === 'string' ? node.type : ''
    if (type === 'heading') {
      const level = [1, 2, 3, 4, 5, 6].includes(node.attrs?.level as number) ? node.attrs!.level : 2
      const heading = document.createElement(`h${level}`)
      heading.dir = 'auto'
      aligned(heading, node)
      for (const child of children(node)) inline(child, heading, depth + 1)
      parent.append(heading)
    } else if (type === 'attachment') {
      // Its name alone: the file stays on the writer's devices (share `snapshot`).
      const line = document.createElement('p')
      line.className = 'attachment'
      const name = document.createElement('strong')
      name.textContent = attachedName(node)
      line.append(name, ` (${NOT_INCLUDED})`)
      parent.append(line)
    } else if (type === 'mathBlock') {
      const formula = document.createElement('div')
      formula.className = 'math'
      drawFormula(texOf(node), formula, true)
      parent.append(formula)
    } else if (type === 'codeBlock') {
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.textContent = children(node).map((child) => (typeof child.text === 'string' ? child.text : '')).join('')
      colourCode(code, node.attrs?.language, code.textContent)
      pre.append(code)
      parent.append(pre)
    } else if (type === 'taskItem') {
      const item = document.createElement('li')
      item.className = 'task'
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.disabled = true
      box.checked = node.attrs?.checked === true
      item.append(box)
      for (const child of children(node)) block(child, item, depth + 1)
      parent.append(item)
    } else if (type === 'paragraph') {
      const paragraph = document.createElement('p')
      paragraph.dir = 'auto'
      aligned(paragraph, node)
      for (const child of children(node)) inline(child, paragraph, depth + 1)
      parent.append(paragraph)
    } else if (BLOCKS.has(type)) {
      const element = document.createElement(BLOCKS.get(type)!)
      if (type === 'taskList') element.className = 'tasks'
      // Always open here: a reader has no reason to be shown less than the words.
      if (type === 'callout') element.dataset.callout = asCalloutKind(node.attrs?.kind) ?? 'note'
      if (type === 'orderedList' && Number.isInteger(node.attrs?.start) && (node.attrs!.start as number) > 1) {
        element.setAttribute('start', String(node.attrs!.start))
      }
      if (type === 'tableHeader' || type === 'tableCell') {
        for (const name of ['colspan', 'rowspan']) {
          const span = node.attrs?.[name]
          if (Number.isInteger(span) && (span as number) > 1 && (span as number) <= 100) element.setAttribute(name, String(span))
        }
      }
      for (const child of children(node)) block(child, element, depth + 1)
      parent.append(element)
    } else if (type === 'text' || type === 'image' || type === 'footnote' || type === 'hardBreak') {
      // Inline content where a block belongs: give it a paragraph.
      const paragraph = document.createElement('p')
      inline(node, paragraph, depth + 1)
      parent.append(paragraph)
    } else {
      // Unknown, or the document itself: keep what's inside.
      for (const child of children(node)) block(child, parent, depth + 1)
    }
  }

  if (isNode(body)) block(body, into, 0)

  // The editor shows footnotes on hover, which a touch screen can't reach.
  // Here they're numbered, and listed at the end.
  if (footnotes.length) {
    const section = document.createElement('section')
    section.className = 'footnotes'
    section.setAttribute('aria-label', 'Footnotes')
    const list = document.createElement('ol')
    footnotes.forEach((text, index) => {
      const n = index + 1
      const item = document.createElement('li')
      item.id = `fn-${n}`
      item.append(document.createTextNode(`${text} `))
      const back = document.createElement('a')
      goesTo(back, `fnref-${n}`)
      back.textContent = '↩'
      back.setAttribute('aria-label', 'Back to the text')
      item.append(back)
      list.append(item)
    })
    section.append(list)
    into.append(section)
  }
}
