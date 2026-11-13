import { attachedName } from './attachment'
import type { JSONContent } from '@tiptap/react'
import { asBlock, shownLink } from './links'

/**
 * What changed between two versions of a document, for History: an earlier
 * one ("then") and the text as it is ("now"). Compared paragraph by
 * paragraph, each list item, quoted paragraph and table cell one of its own,
 * so one changed item in a long list is all that shows; then word by word
 * inside a paragraph that changed. Empty paragraphs are only spacing, and
 * aren't compared.
 */

/** A paragraph as compared. */
export type Paragraph = {
  node: JSONContent
  /** Where the node is in its document: the index at each level, from the top. */
  path: number[]
  /** The blocks it sits in, outermost first: `bulletList`, `listItem`, say. A ticked task item is `taskItem:ticked`. */
  within: string[]
  /** Its words as shown, a picture as [Picture] and a footnote as [Note: …]. */
  text: string
}

/** A stretch of a changed paragraph: in both versions, or in only one. */
export type Run = { text: string; change?: 'removed' | 'added' }

/** In the order they come in the document, a removed paragraph where it was. */
export type Part =
  | { kind: 'same'; paragraphs: Paragraph[] }
  | { kind: 'changed'; then: Paragraph; now: Paragraph; runs: Run[]; formatOnly: boolean }
  | { kind: 'removed'; then: Paragraph }
  | { kind: 'added'; now: Paragraph }

export function compare(then: JSONContent, now: JSONContent): Part[] {
  const before = paragraphsOf(then)
  const after = paragraphsOf(now)
  const parts: Part[] = []
  let gap: { removed: Compared[]; added: Compared[] } = { removed: [], added: [] }
  const closeGap = () => {
    parts.push(...settle(gap.removed, gap.added))
    gap = { removed: [], added: [] }
  }
  let i = 0
  let j = 0
  for (const op of edits(before.map((one) => one.key), after.map((one) => one.key))) {
    if (op === '-') gap.removed.push(before[i++])
    else if (op === '+') gap.added.push(after[j++])
    else {
      closeGap()
      const last = parts.at(-1)
      if (last?.kind === 'same') last.paragraphs.push(after[j])
      else parts.push({ kind: 'same', paragraphs: [after[j]] })
      i++
      j++
    }
  }
  closeGap()
  return parts
}

/** Holders of one entry of a list: a removed paragraph that was one comes back as one. */
const ITEMS = new Set(['listItem', 'taskItem'])
const kindOf = (block: string) => block.replace(/:ticked$/, '')

/**
 * The text as it is now with one paragraph of `parts` (compare(then, now))
 * as it was then: a changed one with its earlier wording, formatting and
 * tick, or a removed one put back where it was, beside the nearest
 * paragraph still there, in the same list or quote where it shares one.
 * A list item comes back as an item of its own. Null for a removed
 * paragraph of a table, whose rows and cells can't be told apart once gone.
 */
export function bringBack(then: JSONContent, now: JSONContent, parts: Part[], index: number): JSONContent | null {
  const part = parts[index]
  if (part?.kind !== 'changed' && part?.kind !== 'removed') return null
  const body = structuredClone(now)
  const earlier = holders(then, part.then.path)

  if (part.kind === 'changed') {
    const later = holders(body, part.now.path)
    const parent = later.at(-1) ?? body
    parent.content![part.now.path.at(-1)!] = structuredClone(part.then.node)
    // A task's tick is on its item, not the paragraph.
    later.forEach((holder, depth) => {
      if (holder.type === 'taskItem' && earlier[depth]?.type === 'taskItem') holder.attrs = { ...holder.attrs, checked: earlier[depth].attrs?.checked ?? false }
    })
    return body
  }

  const gone = part.then
  if (gone.within.includes('table')) return null
  // How deep it can go in beside a paragraph still there: as far as their
  // blocks are the same kinds, short of an item, which it comes back beside.
  const depthBeside = (other: Paragraph) => {
    let depth = 0
    while (depth < gone.within.length && depth < other.within.length && kindOf(gone.within[depth]) === kindOf(other.within[depth])) depth++
    while (depth > 0 && ITEMS.has(kindOf(gone.within[depth - 1]))) depth--
    return depth
  }
  const nowOf = (one: Part | undefined) => (one?.kind === 'same' ? one.paragraphs : one?.kind === 'changed' || one?.kind === 'added' ? [one.now] : [])
  const before = parts.slice(0, index).flatMap(nowOf).at(-1)
  const after = parts.slice(index + 1).flatMap(nowOf)[0]
  const beside = before && (!after || depthBeside(before) >= depthBeside(after)) ? before : after
  const depth = beside ? depthBeside(beside) : 0

  // The paragraph in the blocks it was in, from that depth down.
  let node = structuredClone(gone.node)
  for (let level = gone.within.length - 1; level >= depth; level--) node = { ...structuredClone({ ...earlier[level], content: [] }), content: [node] }
  const parent = beside ? (holders(body, beside.path)[depth - 1] ?? body) : body
  parent.content ??= []
  const at = beside ? beside.path[depth] + (beside === before ? 1 : 0) : parent.content.length
  parent.content.splice(at, 0, node)
  return body
}

/** The blocks holding the node at `path`, outermost first. */
function holders(doc: JSONContent, path: number[]): JSONContent[] {
  const found: JSONContent[] = []
  let node = doc
  for (const index of path.slice(0, -1)) {
    node = node.content![index]
    found.push(node)
  }
  return found
}

type Token = { text: string; key: string }
type Compared = Paragraph & { tokens: Token[]; words: Map<string, number>; key: string; textKey: string }

// A formula on its own lines is compared by its LaTeX, as a code block is by its code; an attachment, by its file's name.
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'mathBlock', 'attachment'])
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })

function paragraphsOf(doc: JSONContent): Compared[] {
  const found: Compared[] = []
  const walk = (node: JSONContent, path: number[], within: string[]) => {
    if (!Array.isArray(node.content)) return
    node.content.forEach((child: unknown, index) => {
      if (typeof child !== 'object' || child === null) return
      const block = child as JSONContent
      const at = [...path, index]
      if (TEXTBLOCKS.has(block.type ?? '')) {
        const tokens = tokensOf(block)
        if (tokens.every((token) => !token.text.trim())) return
        const textKey = tokens.map((token) => token.key).join('\u0000')
        found.push({
          node: block,
          path: at,
          within,
          text: tokens.map((token) => token.text).join(''),
          tokens,
          words: wordsOf(tokens),
          textKey,
          key: `${within.join(' ')}\u0001${canonical(block)}`,
        })
      } else if (typeof block.text !== 'string') {
        walk(block, at, [...within, block.type === 'taskItem' && block.attrs?.checked === true ? 'taskItem:ticked' : (block.type ?? '')])
      }
    })
  }
  walk(doc, [], [])
  return found
}

/**
 * A paragraph's words, the spaces and marks between them, and what sits in
 * the line. Its text is joined before it's split, so a word half in bold
 * is still one word.
 */
function tokensOf(block: JSONContent): Token[] {
  // One thing, whole, by its name. Another file under the same name shows too: the block itself is no longer the same (`canonical`).
  if (block.type === 'attachment') return [{ text: `[Attached: ${attachedName(block)}]`, key: `\u0002attachment ${attachedName(block)}` }]
  const tokens: Token[] = []
  let text = ''
  const flush = () => {
    for (const { segment } of segmenter.segment(text)) tokens.push({ text: segment, key: segment })
    text = ''
  }
  for (const inline of block.content ?? []) {
    if (typeof inline?.text === 'string') {
      text += inline.text
      continue
    }
    flush()
    if (inline?.type === 'hardBreak') tokens.push({ text: '\n', key: '\n' })
    else if (inline?.type === 'image') tokens.push({ text: '[Picture]', key: `\u0002image ${inline.attrs?.src ?? ''}` })
    else if (inline?.type === 'footnote') {
      const note = String(inline.attrs?.text ?? '').trim()
      tokens.push({ text: `[Note: ${note}]`, key: `\u0002footnote ${note}` })
    } else if (inline?.type === 'noteLink') {
      // By the line it's to as well: a link moved to another line of the same note has changed.
      tokens.push({ text: shownLink(inline.attrs ?? {}), key: `\u0002noteLink ${inline.attrs?.id ?? ''} ${inline.attrs?.title ?? ''} ${asBlock(inline.attrs?.block) ?? ''}` })
    } else if (inline?.type === 'mathInline') {
      // One thing in the line, by its LaTeX: changed, it's the formula that changed, not a word in it.
      const tex = (Array.isArray(inline.content) ? inline.content : []).map((child) => (typeof child?.text === 'string' ? child.text : '')).join('')
      tokens.push({ text: tex, key: `\u0002math ${tex}` })
    }
  }
  flush()
  return tokens
}

const WORD = /[\p{L}\p{N}]/u

function wordsOf(tokens: Token[]): Map<string, number> {
  const words = new Map<string, number>()
  for (const { key } of tokens) if (WORD.test(key)) words.set(key, (words.get(key) ?? 0) + 1)
  return words
}

/**
 * A node as text, its keys in order and empty attributes left out, so a
 * version saved before an attribute existed still matches one saved after.
 */
function canonical(node: JSONContent): string {
  return JSON.stringify(node, (_, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, inner]) => inner !== null && inner !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : value,
  )
}

/**
 * How alike two paragraphs are, 0 to 1, if alike enough to be one paragraph
 * edited rather than one taken out and another put in; otherwise 0. That's
 * half their words or more in common, or one kept nearly whole inside the
 * other, as a sentence is when it's written on.
 */
function likeness(a: Compared, b: Compared): number {
  let shared = 0
  let sizeA = 0
  let sizeB = 0
  for (const [word, count] of a.words) {
    shared += Math.min(count, b.words.get(word) ?? 0)
    sizeA += count
  }
  for (const count of b.words.values()) sizeB += count
  if (sizeA + sizeB === 0) return a.textKey === b.textKey ? 1 : 0
  const alike = (2 * shared) / (sizeA + sizeB)
  return alike >= 0.5 || (shared >= 3 && shared >= 0.8 * Math.min(sizeA, sizeB)) ? alike : 0
}

/** Past this many pairings to weigh, a stretch is left as removed and added. */
const MOST_PAIRINGS = 10_000

/**
 * A stretch where the versions differ: which paragraphs were edited (each
 * paired with its earlier self, keeping their order) and which were only
 * taken out or put in. One for one is always an edit.
 */
function settle(removed: Compared[], added: Compared[]): Part[] {
  const pairs: [number, number][] = []
  if (removed.length === 1 && added.length === 1) pairs.push([0, 0])
  else if (removed.length && added.length && removed.length * added.length <= MOST_PAIRINGS) {
    // The pairing with the most likeness in all, in order.
    const width = added.length + 1
    const best = new Float64Array((removed.length + 1) * width)
    for (let i = 1; i <= removed.length; i++) {
      for (let j = 1; j <= added.length; j++) {
        const alike = likeness(removed[i - 1], added[j - 1])
        best[i * width + j] = Math.max(
          best[(i - 1) * width + j],
          best[i * width + j - 1],
          alike > 0 ? best[(i - 1) * width + j - 1] + alike : 0,
        )
      }
    }
    for (let i = removed.length, j = added.length; i > 0 && j > 0; ) {
      if (best[i * width + j] === best[(i - 1) * width + j]) i--
      else if (best[i * width + j] === best[i * width + j - 1]) j--
      else pairs.unshift([--i, --j])
    }
  }

  const parts: Part[] = []
  let i = 0
  let j = 0
  for (const [then, now] of [...pairs, [removed.length, added.length]]) {
    while (i < then) parts.push({ kind: 'removed', then: removed[i++] })
    while (j < now) parts.push({ kind: 'added', now: added[j++] })
    if (then < removed.length) parts.push(changed(removed[i++], added[j++]))
  }
  return parts
}

function changed(then: Compared, now: Compared): Part {
  if (then.textKey === now.textKey) return { kind: 'changed', then, now, runs: [{ text: now.text }], formatOnly: true }
  // Each stretch kept, or changed: what it said then, and says now.
  const stretches: ({ same: string } | { removed: string; added: string })[] = []
  let i = 0
  let j = 0
  for (const op of edits(then.tokens.map((token) => token.key), now.tokens.map((token) => token.key))) {
    const last = stretches.at(-1)
    if (op === '=') {
      const text = now.tokens[j].text
      if (last && 'same' in last) last.same += text
      else stretches.push({ same: text })
      i++
      j++
    } else {
      const change = last && 'removed' in last ? last : { removed: '', added: '' }
      if (change !== last) stretches.push(change)
      if (op === '-') change.removed += then.tokens[i++].text
      else change.added += now.tokens[j++].text
    }
  }
  // Only a space between two changes joins them, so "quick brown" reads as one change, not two.
  for (let k = 1; k < stretches.length - 1; k++) {
    const [before, space, after] = stretches.slice(k - 1, k + 2)
    if ('same' in space && !space.same.trim() && 'removed' in before && 'removed' in after) {
      stretches.splice(k - 1, 3, { removed: before.removed + space.same + after.removed, added: before.added + space.same + after.added })
      k--
    }
  }
  const runs: Run[] = []
  for (const stretch of stretches) {
    if ('same' in stretch) runs.push({ text: stretch.same })
    else {
      // Spaces alone aren't worth marking, but those put in are still in the text.
      if (stretch.removed.trim()) runs.push({ text: stretch.removed, change: 'removed' })
      if (stretch.added) runs.push(stretch.added.trim() ? { text: stretch.added, change: 'added' } : { text: stretch.added })
    }
  }
  return { kind: 'changed', then, now, runs, formatOnly: false }
}

type Op = '=' | '-' | '+'

/** Past this many changes, two lists are too different to be worth working through: all of one out, all of the other in. */
const MOST_CHANGES = 1000

/**
 * The fewest changes that turn `a` into `b`, as each item kept, taken out
 * or put in, in order (Myers, 1986).
 */
function edits(a: string[], b: string[]): Op[] {
  // The ends in common first: most edits touch a little of a long text.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const middle = (midA.length && midB.length ? shortest(midA, midB) : null) ?? [...midA.map((): Op => '-'), ...midB.map((): Op => '+')]
  return [...a.slice(0, start).map((): Op => '='), ...middle, ...a.slice(endA).map((): Op => '=')]
}

function shortest(a: string[], b: string[]): Op[] | null {
  const n = a.length
  const m = b.length
  // For each number of changes d, how far along each diagonal k (x − y)
  // the furthest path reaches: x at index k + d.
  const trace: Int32Array[] = []
  for (let d = 0; d <= Math.min(n + m, MOST_CHANGES); d++) {
    const reach = new Int32Array(2 * d + 1)
    const before = trace[d - 1]
    for (let k = -d; k <= d; k += 2) {
      let x = d === 0 ? 0 : k === -d || (k !== d && before[k - 1 + d - 1] < before[k + 1 + d - 1]) ? before[k + 1 + d - 1] : before[k - 1 + d - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      reach[k + d] = x
      if (x >= n && y >= m) {
        trace.push(reach)
        return back(trace, n, m)
      }
    }
    trace.push(reach)
  }
  return null
}

/** The path found, walked back from its end. */
function back(trace: Int32Array[], n: number, m: number): Op[] {
  const ops: Op[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d > 0; d--) {
    const before = trace[d - 1]
    const k = x - y
    const down = k === -d || (k !== d && before[k - 1 + d - 1] < before[k + 1 + d - 1])
    const fromK = down ? k + 1 : k - 1
    const fromX = before[fromK + d - 1]
    while (x > (down ? fromX : fromX + 1)) {
      ops.push('=')
      x--
      y--
    }
    ops.push(down ? '+' : '-')
    x = fromX
    y = fromX - fromK
  }
  while (x > 0) {
    ops.push('=')
    x--
  }
  return ops.reverse()
}
